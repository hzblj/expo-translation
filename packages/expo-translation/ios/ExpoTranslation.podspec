require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Google's ML Kit, for the languages Apple's framework lacks: only when the app asks for it (the config plugin's
# `ios.mlkit` writes this property). It is big, and its frameworks have no arm64 simulator slice, so it excludes arm64
# from the app's simulator builds.
podfile_properties = JSON.parse(File.read("#{Pod::Config.instance.installation_root}/Podfile.properties.json")) rescue {}
mlkit_property = podfile_properties['expo-translation.mlkit']
mlkit =
  if mlkit_property.nil?
    ['1', 'true'].include?(ENV['EXPO_TRANSLATION_MLKIT'])
  else
    mlkit_property == 'true'
  end

Pod::Spec.new do |s|
  s.name           = 'ExpoTranslation'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.license        = package['license']
  # Expo SDK 57's minimum. Apple's Translation framework translates from iOS 18; its sheet comes with iOS 17.4.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/hzblj/expo-translation.git', :tag => "@hzblj/expo-translation@#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NaturalLanguage', 'SwiftUI'
  s.weak_frameworks = 'Translation'

  xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # `Tests` is a SwiftPM package over `Core`, run on the Mac; the pod never compiles it.
  s.source_files = '*.swift', 'Core/**/*.swift'

  if mlkit
    s.dependency 'GoogleMLKit/Translate', '~> 9.0'
    s.source_files = '*.swift', 'Core/**/*.swift', 'MLKit/**/*.swift'
    xcconfig['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) EXPO_TRANSLATION_MLKIT'
    xcconfig['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'arm64'
  end

  s.pod_target_xcconfig = xcconfig
end
