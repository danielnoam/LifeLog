// The iOS side of the Widgets plugin (0.217.0): the same methods the app
// calls on Android (WidgetsPlugin.java), so src/widgets.js, reminders.js and
// the app lock don't know which phone they're on. What Android does and iOS
// can't is answered honestly rather than faked: there's no Markdown folder
// picker, and the widgets' taps arrive as lifelog:// links through
// Capacitor's App plugin rather than as a launch action here.
import Foundation
import Capacitor
import LocalAuthentication
import UIKit
#if canImport(WidgetKit)
import WidgetKit
#endif

@objc(WidgetsPlugin)
public class WidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetsPlugin"
    public let jsName = "Widgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeLaunchAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notePins", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askForNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickMarkdownFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "holdBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPrivacyScreen", returnType: CAPPluginReturnPromise),
    ]

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    // No iCloud backup for what the app holds (0.261.0): the WebView's
    // storage under Library/WebKit (the log, the GitHub token, the PIN
    // hash), the App Group the widgets read, and the Documents copy the
    // phone backup writes. Android's manifest says allowBackup="false" for
    // the same reason (tools/android-manifest.js). The flag lives on the
    // directory, so it is set on every launch in case one was recreated.
    public override func load() {
        var dirs: [URL] = []
        if let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first {
            dirs.append(lib.appendingPathComponent("WebKit"))
        }
        if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            dirs.append(docs)
        }
        if let group = LLGroup.container { dirs.append(group) }
        for var url in dirs {
            if !FileManager.default.fileExists(atPath: url.path) {
                try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            }
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        }
    }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    // ---- the snapshot out, the widgets' ticks in ----
    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { call.reject("No snapshot"); return }
        LLStore.saveSnapshot(json)
        reloadWidgets()
        LLReminders.reschedule()
        call.resolve()
    }

    @objc func takeQueue(_ call: CAPPluginCall) {
        let items = LLStore.takeQueue()
        if !items.isEmpty { reloadWidgets() }
        call.resolve(["items": items])
    }

    // Widgets open the app through lifelog:// links instead, so the only
    // launch action here is a share left by the share extension (LLShare).
    @objc func takeLaunchAction(_ call: CAPPluginCall) {
        if let action = LLShare.take() { call.resolve(["action": action]) } else { call.resolve([:]) }
    }

    @objc func notePins(_ call: CAPPluginCall) { call.resolve(["ids": []]) }

    // ---- reminders ----
    @objc func notificationState(_ call: CAPPluginCall) {
        LLReminders.state { call.resolve(["state": $0]) }
    }

    @objc func askForNotifications(_ call: CAPPluginCall) {
        LLReminders.ask { s in
            LLReminders.reschedule()
            call.resolve(["state": s])
        }
    }

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let name: String
            if #available(iOS 16.0, *) { name = UIApplication.openNotificationSettingsURLString } else { name = UIApplication.openSettingsURLString }
            if let url = URL(string: name) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    // ---- Face ID / Touch ID, for the app lock ----
    @objc func biometricState(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
            call.resolve(["state": "available"])
        } else if let e = err, e.code == LAError.biometryNotEnrolled.rawValue {
            call.resolve(["state": "none-enrolled"])
        } else {
            call.resolve(["state": "unsupported"])
        }
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use PIN"
        let reason = call.getString("title") ?? "Unlock LifeLog"
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
            if ok { call.resolve(["ok": true]); return }
            let code = (error as NSError?)?.code ?? 0
            let cancelled = [LAError.userCancel, .appCancel, .systemCancel, .userFallback].map { $0.rawValue }.contains(code)
            call.resolve(["ok": false, "reason": cancelled ? "cancelled" : "error", "message": error?.localizedDescription ?? ""])
        }
    }

    // ---- what iOS doesn't have ----
    @objc func pickMarkdownFolder(_ call: CAPPluginCall) {
        call.unavailable("Pick the Markdown files themselves on iOS")
    }

    // ---- work that keeps going with the app put away (0.244.0) ----
    // iOS has no foreground service: what it gives an app that asks is
    // about 30 seconds after it's put away, then it's suspended until it's
    // opened again, where src/jobs.js simply carries on. Asked for while
    // the app is still in front, so the grace starts when it's put away.
    @objc func holdBackground(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.backgroundTask == .invalid {
                self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "LifeLog work") { [weak self] in
                    self?.endBackgroundTask()
                }
            }
            call.resolve()
        }
    }

    // ---- the privacy screen (0.262.0) ----
    // iOS snapshots the app for the app switcher as it goes inactive; a
    // blur laid over the window at that moment is what the snapshot shows,
    // and it lifts as the app comes back. Screenshots can't be refused on
    // iOS, so this is the switcher only.
    private var privacyOn = false
    private var privacyCover: UIVisualEffectView?
    private var privacyObservers: [NSObjectProtocol] = []

    @objc func setPrivacyScreen(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.privacyOn = on
            if on && self.privacyObservers.isEmpty {
                let nc = NotificationCenter.default
                self.privacyObservers = [
                    nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.coverWindow() },
                    nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.uncoverWindow() },
                ]
            }
            if !on { self.uncoverWindow() }
            call.resolve()
        }
    }

    private func coverWindow() {
        guard privacyOn, privacyCover == nil, let window = self.bridge?.webView?.window else { return }
        let cover = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
        cover.frame = window.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(cover)
        privacyCover = cover
    }

    private func uncoverWindow() {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }

    @objc func releaseBackground(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endBackgroundTask()
            call.resolve()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
