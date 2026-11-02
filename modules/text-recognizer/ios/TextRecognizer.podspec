Pod::Spec.new do |s|
  s.name           = 'TextRecognizer'
  s.version        = '1.0.0'
  s.summary        = 'On-device text recognition (Apple Vision) for the card scanner'
  s.description    = 'On-device text recognition (Apple Vision) for the card scanner'
  s.license        = 'MIT'
  s.author         = 'Pokesammlung'
  s.homepage       = 'https://github.com/BlackH3ro/pokesammlung'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/BlackH3ro/pokesammlung.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
