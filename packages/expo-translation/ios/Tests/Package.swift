// swift-tools-version:5.9
// The module's Foundation, Natural Language and Translation logic (`ios/Core`), tested on the Mac with `swift test`:
// macOS has the same frameworks, so Apple's engine is checked here against the real Translation framework.
// `Sources/ExpoTranslationCore` is a link to `../Core`, the files the pod compiles.
import PackageDescription

let package = Package(
  name: "ExpoTranslationCoreTests",
  platforms: [.macOS("26.0")],
  targets: [
    .target(name: "ExpoTranslationCore", path: "Sources/ExpoTranslationCore"),
    .testTarget(
      name: "ExpoTranslationCoreTests", dependencies: ["ExpoTranslationCore"], path: "Tests/ExpoTranslationCoreTests"),
  ]
)
