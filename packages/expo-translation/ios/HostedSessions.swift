import SwiftUI
import Translation
import UIKit

/// The view controller everything of ours is shown from: the top of the key window's presented stack.
@MainActor
enum Presenter {
  static func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
    var top = window?.rootViewController

    while let presented = top?.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }

  /// A one-point, invisible, untouchable view controller over `parent`, for SwiftUI modifiers that need a view in a
  /// window: `translationTask` and `translationPresentation`.
  static func attach<Content: View>(_ content: Content, centered: Bool = false) -> UIHostingController<Content>? {
    guard let parent = topViewController() else {
      return nil
    }
    let controller = UIHostingController(rootView: content)
    let size: CGFloat = 1
    let bounds = parent.view.bounds

    controller.view.frame =
      centered
      ? CGRect(x: bounds.midX - size / 2, y: bounds.midY - size / 2, width: size, height: size)
      : CGRect(x: 0, y: 0, width: size, height: size)
    controller.view.backgroundColor = .clear
    controller.view.isUserInteractionEnabled = false
    controller.view.accessibilityElementsHidden = true
    parent.addChild(controller)
    parent.view.addSubview(controller.view)
    controller.didMove(toParent: parent)
    return controller
  }

  static func detach(_ controller: UIViewController) {
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }
}

/// Work for a hosted session: runs with it, or fails if the session never comes or goes away first.
@available(iOS 18.0, *)
private struct SessionJob {
  let run: @MainActor (TranslationSession) async -> Void
  let fail: @MainActor (Error) -> Void
}

/// The jobs of one host, served one at a time by the session its view was given.
@available(iOS 18.0, *)
@MainActor
private final class SessionQueue {
  private var jobs: [SessionJob] = []
  private var waiter: CheckedContinuation<SessionJob?, Never>?
  private(set) var isClosed = false

  var isEmpty: Bool { jobs.isEmpty }

  func enqueue(_ job: SessionJob) -> Bool {
    guard !isClosed else {
      return false
    }
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: job)
    } else {
      jobs.append(job)
    }
    return true
  }

  func next() async -> SessionJob? {
    if !jobs.isEmpty {
      return jobs.removeFirst()
    }
    if isClosed {
      return nil
    }
    return await withCheckedContinuation { waiter = $0 }
  }

  func close(failing error: Error) {
    isClosed = true
    let pending = jobs

    jobs = []
    for job in pending {
      job.fail(error)
    }
    waiter?.resume(returning: nil)
    waiter = nil
  }
}

@available(iOS 18.0, *)
private struct SessionHostView: View {
  let configuration: TranslationSession.Configuration
  let serve: @MainActor (TranslationSession) async -> Void
  let disappeared: @MainActor () -> Void

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .translationTask(configuration) { session in
        await serve(session)
      }
      .onDisappear {
        disappeared()
      }
  }
}

/// A view that holds one of Apple's sessions for a pair, the only kind that can show the download sheet (and, before
/// iOS 26, the only kind there is). Apple's rule is that the session must not be used once its view is gone, so jobs
/// run inside `translationTask`'s closure, one at a time, and the view stays until the host has been idle a while.
@available(iOS 18.0, *)
@MainActor
private final class SessionHost {
  private static let idleTimeout: Duration = .seconds(20)
  /// A view that is given no session (not in a window, say) would hold its jobs forever.
  private static let startTimeout: Duration = .seconds(10)

  private let queue = SessionQueue()
  private var controller: UIHostingController<SessionHostView>?
  private var idleTask: Task<Void, Never>?
  private var startTask: Task<Void, Never>?
  private var started = false
  private let finished: @MainActor () -> Void

  init?(_ request: AppleSessionRequest, finished: @escaping @MainActor () -> Void) {
    self.finished = finished
    let configuration: TranslationSession.Configuration

    if #available(iOS 26.4, *), request.strategy == .highFidelity {
      configuration = .init(source: request.source, target: request.target, preferredStrategy: .highFidelity)
    } else {
      configuration = .init(source: request.source, target: request.target)
    }

    let view = SessionHostView(
      configuration: configuration,
      serve: { [weak self] session in await self?.serve(session) },
      disappeared: { [weak self] in
        self?.queue.close(failing: TranslationFailure(.cancelled, "The translation session's view went away"))
      }
    )

    guard let controller = Presenter.attach(view) else {
      return nil
    }
    self.controller = controller
    startTask = Task { [weak self] in
      try? await Task.sleep(for: Self.startTimeout)
      guard let self, !Task.isCancelled, !self.started else {
        return
      }
      self.queue.close(failing: TranslationFailure(.unavailable, "Apple's translation service gave the app no session"))
      self.tearDown()
    }
  }

  func run<T: Sendable>(_ body: @escaping @Sendable (TranslationSession) async throws -> T) async throws -> T {
    idleTask?.cancel()
    return try await withCheckedThrowingContinuation { continuation in
      let job = SessionJob(
        run: { session in
          do {
            continuation.resume(returning: try await body(session))
          } catch {
            continuation.resume(throwing: error)
          }
        },
        fail: { continuation.resume(throwing: $0) }
      )

      if !queue.enqueue(job) {
        continuation.resume(throwing: TranslationFailure(.cancelled, "The translation session closed"))
      }
    }
  }

  var isClosed: Bool { queue.isClosed }

  private func serve(_ session: TranslationSession) async {
    started = true
    startTask?.cancel()
    while let job = await queue.next() {
      idleTask?.cancel()
      await job.run(session)
      if queue.isEmpty && !queue.isClosed {
        scheduleIdle()
      }
    }
    tearDown()
  }

  private func scheduleIdle() {
    idleTask = Task { [weak self] in
      try? await Task.sleep(for: Self.idleTimeout)
      guard let self, !Task.isCancelled, self.queue.isEmpty else {
        return
      }
      self.queue.close(failing: TranslationFailure(.cancelled, "The translation session closed"))
    }
  }

  private func tearDown() {
    idleTask?.cancel()
    startTask?.cancel()
    if let controller {
      self.controller = nil
      Presenter.detach(controller)
      finished()
    }
  }
}

/// Sessions from views in the app, one host per pair and strategy, made when first needed.
@available(iOS 18.0, *)
final class HostedSessions: AppleSessionProvider, @unchecked Sendable {
  @MainActor private var hosts: [String: SessionHost] = [:]

  @MainActor
  private func host(for request: AppleSessionRequest) throws -> SessionHost {
    let key = "\(request.source.maximalIdentifier)>\(request.target.maximalIdentifier)|\(request.strategy.rawValue)"

    if let host = hosts[key], !host.isClosed {
      return host
    }
    guard let host = SessionHost(request, finished: { [weak self] in self?.hosts[key] = nil }) else {
      throw TranslationFailure(.unavailable, "There is no window to hold Apple's translation session")
    }
    hosts[key] = host
    return host
  }

  func withSession<T: Sendable>(
    _ request: AppleSessionRequest, _ body: @escaping @Sendable (TranslationSession) async throws -> T
  ) async throws -> T {
    let host = try await MainActor.run { try self.host(for: request) }

    return try await host.run(body)
  }
}

/// iOS 26: languages already on the device get a session without any view; a download still needs a hosted one.
/// Before iOS 26 every session is hosted.
@available(iOS 18.0, *)
final class AppSessions: AppleSessionProvider, @unchecked Sendable {
  private let hosted = HostedSessions()
  private let installed: AppleSessionProvider? = {
    if #available(iOS 26.0, *) {
      return InstalledSessions()
    }
    return nil
  }()

  func withSession<T: Sendable>(
    _ request: AppleSessionRequest, _ body: @escaping @Sendable (TranslationSession) async throws -> T
  ) async throws -> T {
    if request.installed, let installed {
      return try await installed.withSession(request, body)
    }
    return try await hosted.withSession(request, body)
  }
}

/// Apple's translation sheet over the app: `translationPresentation` on a view at the window's centre (where an iPad's
/// popover points).
@available(iOS 17.4, *)
@MainActor
final class TranslationSheet: ObservableObject {
  @Published var isPresented = false
  let text: String
  let replace: Bool
  private var replacement: String?
  private var continuation: CheckedContinuation<String?, Never>?
  private var controller: UIViewController?

  private init(text: String, replace: Bool) {
    self.text = text
    self.replace = replace
  }

  static func present(text: String, replace: Bool) async throws -> String? {
    let sheet = TranslationSheet(text: text, replace: replace)

    guard let controller = Presenter.attach(TranslationSheetView(sheet: sheet), centered: true) else {
      throw TranslationFailure(.unavailable, "There is no window to show the translation sheet over")
    }
    sheet.controller = controller
    return await withCheckedContinuation { continuation in
      sheet.continuation = continuation
    }
  }

  func replaced(with translation: String) {
    replacement = translation
  }

  func dismissed() {
    if let controller {
      self.controller = nil
      Presenter.detach(controller)
    }
    continuation?.resume(returning: replacement)
    continuation = nil
  }
}

@available(iOS 17.4, *)
private struct TranslationSheetView: View {
  @ObservedObject var sheet: TranslationSheet

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .translationPresentation(
        isPresented: $sheet.isPresented,
        text: sheet.text,
        replacementAction: sheet.replace ? { sheet.replaced(with: $0) } : nil
      )
      .onAppear {
        sheet.isPresented = true
      }
      .onChange(of: sheet.isPresented) { _, presented in
        // One turn of the main queue later: "Replace with Translation" may hand over the translation as it closes.
        if !presented {
          DispatchQueue.main.async { sheet.dismissed() }
        }
      }
  }
}
