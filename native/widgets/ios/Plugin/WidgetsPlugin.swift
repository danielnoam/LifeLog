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
    ]

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

    @objc func takeLaunchAction(_ call: CAPPluginCall) { call.resolve([:]) }

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
}
