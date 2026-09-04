require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ArcPasskey'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'Apache-2.0'
  s.author         = 'Kuira Labs'
  s.homepage       = 'https://github.com/kuiralabs/arc-agent-mandate'
  # Must not exceed the app target's deployment target: CocoaPods' `supports_platform?`
  # silently SKIPS a pod whose floor is higher, and Expo autolinking then reports
  # "doesn't support iOS platform" rather than failing the build. Expo's own floor is 15.1,
  # and every AuthenticationServices API this module calls is iOS 15.0+.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
