# The iOS side of LifeLog's Widgets plugin (0.217.0): what the app calls as
# Capacitor.Plugins.Widgets. The widgets themselves are an app extension,
# added to the generated Xcode project by tools/ios-widgets.rb; the files in
# ios/Shared are compiled into both.
require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'LifelogWidgets'
  s.version = package['version']
  s.summary = 'LifeLog widgets, reminders and Face ID for iOS'
  s.license = { :type => 'Private' }
  s.homepage = 'https://github.com/danielnoam/LifeLog'
  s.author = 'LifeLog'
  s.source = { :git => 'https://github.com/danielnoam/LifeLog.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.swift', 'ios/Shared/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
