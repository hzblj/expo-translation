import Foundation

/// The engine an iOS translator uses: `IOSEngineChoice` in `src/types.ts`.
public enum EngineChoice: String, Decodable, Sendable {
  case auto, apple, mlkit
}

/// Apple's translation strategy (iOS 26.4): `TranslationStrategy` in `src/types.ts`.
public enum StrategyChoice: String, Decodable, Sendable {
  case lowLatency, highFidelity
}

/// The `ios` options of a translator or a pair.
public struct IOSOptions: Decodable, Sendable, Equatable {
  public var engine: EngineChoice = .auto
  public var strategy: StrategyChoice = .lowLatency

  public init(engine: EngineChoice = .auto, strategy: StrategyChoice = .lowLatency) {
    self.engine = engine
    self.strategy = strategy
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    engine = try container.decodeIfPresent(EngineChoice.self, forKey: .engine) ?? .auto
    strategy = try container.decodeIfPresent(StrategyChoice.self, forKey: .strategy) ?? .lowLatency
  }

  private enum CodingKeys: String, CodingKey {
    case engine, strategy
  }
}

/// `TranslatorOptions` from `src/types.ts`, with its documented defaults.
public struct TranslatorOptions: Decodable, Sendable {
  public var from: String?
  public var to: String
  public var download = true
  public var wifiOnly = false
  public var ios = IOSOptions()

  public init(from: String? = nil, to: String, download: Bool = true, wifiOnly: Bool = false, ios: IOSOptions = IOSOptions()) {
    self.from = from
    self.to = to
    self.download = download
    self.wifiOnly = wifiOnly
    self.ios = ios
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    from = try container.decodeIfPresent(String.self, forKey: .from).flatMap { $0.isEmpty ? nil : $0 }
    to = try container.decode(String.self, forKey: .to)
    download = try container.decodeIfPresent(Bool.self, forKey: .download) ?? true
    wifiOnly = try container.decodeIfPresent(Bool.self, forKey: .wifiOnly) ?? false
    ios = try container.decodeIfPresent(IOSOptions.self, forKey: .ios) ?? IOSOptions()
  }

  private enum CodingKeys: String, CodingKey {
    case from, to, download, wifiOnly, ios
  }

  /// What the translation of a text depends on besides the text: the JavaScript cache's key.
  public var configurationKey: String {
    [from ?? "*", to, ios.engine.rawValue, ios.strategy.rawValue].joined(separator: "|")
  }
}

/// The options of `getStatusAsync` and `downloadAsync`.
public struct PairOptions: Decodable, Sendable {
  public var from: String
  public var to: String
  public var wifiOnly = false
  public var ios = IOSOptions()

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    from = try container.decode(String.self, forKey: .from)
    to = try container.decode(String.self, forKey: .to)
    wifiOnly = try container.decodeIfPresent(Bool.self, forKey: .wifiOnly) ?? false
    ios = try container.decodeIfPresent(IOSOptions.self, forKey: .ios) ?? IOSOptions()
  }

  private enum CodingKeys: String, CodingKey {
    case from, to, wifiOnly, ios
  }
}
