# Adds LifeLog's app extensions to the generated iOS project: the widgets
# (0.217.0) and the Share sheet entry (0.250.0).
#
#   ruby tools/ios-widgets.rb
#
# `npx cap add ios` makes a project with one target, the app. The widgets are
# a second, an app extension, built from native/widgets/ios/Extension plus the
# shared files the app's plugin compiles too (native/widgets/ios/Shared) —
# referenced where they are, not copied, so the repo holds one copy. The
# share extension is a third, from native/widgets/ios/Share, the same way.
# Each is embedded in the app, shares an App Group with it, and carries the
# app's version, as iOS requires of an extension.
#
# Run after tools/ios-project.js (it reads the version that stamps) and
# before `npx cap sync ios` (pod install then adds its build phases after
# ours; the other way round is the build-cycle error Xcode is known for).
# Uses the xcodeproj gem, which is CocoaPods' own. Idempotent, per target.
require 'xcodeproj'

ROOT = File.expand_path('..', __dir__)
PROJECT = File.join(ROOT, 'ios', 'App', 'App.xcodeproj')
# From ios/App, where the project's paths start.
SRC = '../../native/widgets/ios'
SHARED = %w[Shared/LifeLogShared.swift Shared/LifeLogReminders.swift]

EXTENSIONS = [
  {
    name: 'LifeLogWidgets',
    bundle_id: 'io.github.danielnoam.lifelog.widgets',
    min_ios: '17.0', # interactive widgets (Button(intent:)) are iOS 17
    sources: %w[Extension/LifeLogWidgets.swift] + SHARED,
    plist: 'Extension/Info.plist',
    entitlements: 'Extension/LifeLogWidgets.entitlements',
  },
  {
    name: 'LifeLogShare',
    bundle_id: 'io.github.danielnoam.lifelog.share',
    min_ios: '15.5', # the app's own floor (tools/ios-project.js)
    sources: %w[Share/ShareViewController.swift] + SHARED,
    plist: 'Share/Info.plist',
    entitlements: 'Share/LifeLogShare.entitlements',
  },
]

project = Xcodeproj::Project.open(PROJECT)
app = project.targets.find { |t| t.name == 'App' } or abort('ios: no App target')
app_settings = app.build_configurations.first.build_settings
app.build_configurations.each do |c|
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = "#{SRC}/App.entitlements"
end

def add_extension(project, app, app_settings, x)
  if project.targets.any? { |t| t.name == x[:name] }
    puts "ios: #{x[:name]} is already in the project"
    return
  end
  ext = project.new_target(:app_extension, x[:name], :ios, x[:min_ios])
  group = project.main_group.new_group(x[:name], SRC)
  ext.add_file_references(x[:sources].map { |f| group.new_file(f) })
  [x[:plist], x[:entitlements]].each { |f| group.new_file(f) }

  ext.build_configurations.each do |c|
    s = c.build_settings
    s['PRODUCT_NAME'] = '$(TARGET_NAME)'
    s['PRODUCT_BUNDLE_IDENTIFIER'] = x[:bundle_id]
    s['INFOPLIST_FILE'] = "#{SRC}/#{x[:plist]}"
    s['GENERATE_INFOPLIST_FILE'] = 'NO'
    s['CODE_SIGN_ENTITLEMENTS'] = "#{SRC}/#{x[:entitlements]}"
    s['SWIFT_VERSION'] = '5.0'
    s['IPHONEOS_DEPLOYMENT_TARGET'] = x[:min_ios]
    s['TARGETED_DEVICE_FAMILY'] = '1,2'
    s['SKIP_INSTALL'] = 'YES'
    s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
    s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
    s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
    s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  end

  # Built before the app, and copied into its PlugIns folder. One copy
  # phase for all the extensions, straight after Resources, ahead of any
  # script phase.
  app.add_dependency(ext)
  embed = app.build_phases.find { |p| p.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) && p.name == 'Embed Foundation Extensions' }
  unless embed
    embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
    embed.symbol_dst_subfolder_spec = :plug_ins
    phases = app.build_phases
    phases.delete(embed)
    at = phases.index { |p| p.is_a?(Xcodeproj::Project::Object::PBXResourcesBuildPhase) }
    phases.insert(at ? at + 1 : phases.length, embed)
  end
  embed.add_file_reference(ext.product_reference, true).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts "ios: added #{x[:name]} (#{x[:bundle_id]}, iOS #{x[:min_ios]}+) and embedded it in the app"
end

EXTENSIONS.each { |x| add_extension(project, app, app_settings, x) }
project.save
