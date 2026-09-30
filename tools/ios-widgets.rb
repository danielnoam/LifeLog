# Adds LifeLog's widget extension to the generated iOS project (0.217.0).
#
#   ruby tools/ios-widgets.rb
#
# `npx cap add ios` makes a project with one target, the app. The widgets are
# a second, an app extension, built from native/widgets/ios/Extension plus the
# shared files the app's plugin compiles too (native/widgets/ios/Shared) —
# referenced where they are, not copied, so the repo holds one copy. It's
# embedded in the app, shares an App Group with it, and carries the app's
# version, as iOS requires of an extension.
#
# Run after tools/ios-project.js (it reads the version that stamps) and
# before `npx cap sync ios` (pod install then adds its build phases after
# ours; the other way round is the build-cycle error Xcode is known for).
# Uses the xcodeproj gem, which is CocoaPods' own. Idempotent.
require 'xcodeproj'

ROOT = File.expand_path('..', __dir__)
PROJECT = File.join(ROOT, 'ios', 'App', 'App.xcodeproj')
NAME = 'LifeLogWidgets'
BUNDLE_ID = 'io.github.danielnoam.lifelog.widgets'
# From ios/App, where the project's paths start.
SRC = '../../native/widgets/ios'
MIN_IOS = '17.0' # interactive widgets (Button(intent:)) are iOS 17

project = Xcodeproj::Project.open(PROJECT)
if project.targets.any? { |t| t.name == NAME }
  puts "ios: #{NAME} is already in the project"
  exit 0
end
app = project.targets.find { |t| t.name == 'App' } or abort('ios: no App target')
app_settings = app.build_configurations.first.build_settings

ext = project.new_target(:app_extension, NAME, :ios, MIN_IOS)
group = project.main_group.new_group(NAME, SRC)
sources = %w[Extension/LifeLogWidgets.swift Shared/LifeLogShared.swift Shared/LifeLogReminders.swift]
ext.add_file_references(sources.map { |f| group.new_file(f) })
%w[Extension/Info.plist Extension/LifeLogWidgets.entitlements App.entitlements].each { |f| group.new_file(f) }

ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['INFOPLIST_FILE'] = "#{SRC}/Extension/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{SRC}/Extension/LifeLogWidgets.entitlements"
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = MIN_IOS
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
end

app.build_configurations.each do |c|
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = "#{SRC}/App.entitlements"
end

# Built before the app, and copied into its PlugIns folder.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext.product_reference, true).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
# Straight after Resources, ahead of any script phase.
phases = app.build_phases
phases.delete(embed)
at = phases.index { |p| p.is_a?(Xcodeproj::Project::Object::PBXResourcesBuildPhase) }
phases.insert(at ? at + 1 : phases.length, embed)

project.save
puts "ios: added #{NAME} (#{BUNDLE_ID}, iOS #{MIN_IOS}+) and embedded it in the app"
