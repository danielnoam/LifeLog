// Habit reminders on iOS (0.217.0). Android keeps one alarm and decides when
// it rings whether the habit is still undone (Reminders.java); iOS runs no
// code of ours at that moment, so this schedules ahead instead: today's and
// tomorrow's reminder for each due habit with a time, and none for a day
// that's already kept. It's redone whenever the snapshot changes (the app
// saved) or a widget ticks, so a habit kept anywhere that has reached this
// phone stops its reminder. Tomorrow's is there so a day nobody opens the
// app still rings.
import Foundation
import UserNotifications

enum LLReminders {
    static let prefix = "lifelog-habit-"

    static func reschedule() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let ours = pending.map { $0.identifier }.filter { $0.hasPrefix(prefix) }
            center.removePendingNotificationRequests(withIdentifiers: ours)
            let snap = LLStore.snapshot()
            let q = LLStore.queue()
            let today = LLDate.today()
            let now = Date()
            for h in LLHabits.all(snap) {
                let remind = h["remind"] as? String ?? ""
                if remind.isEmpty || (h["avoid"] as? Bool ?? false) { continue }
                let hm = remind.split(separator: ":").compactMap { Int($0) }
                guard hm.count == 2 else { continue }
                for day in [today, LLDate.add(today, 1)] {
                    guard LLHabits.dueOn(h, day), let d = LLDate.date(day) else { continue }
                    if LLHabits.keptWith(h, LLHabits.markOn(h, q, day)) { continue }
                    var parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: d)
                    parts.hour = hm[0]
                    parts.minute = hm[1]
                    guard let at = Calendar(identifier: .gregorian).date(from: parts), at > now else { continue }
                    let content = UNMutableNotificationContent()
                    content.title = h["name"] as? String ?? "Habit"
                    content.body = "Not done yet today"
                    content.sound = .default
                    content.userInfo = ["action": "open-habit:" + (h["id"] as? String ?? "")]
                    let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
                    let id = prefix + (h["id"] as? String ?? "") + "-" + day
                    center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
                }
            }
        }
    }

    /// "granted", "denied" or "prompt", as reminders.js reads Android's.
    static func state(_ done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: done("granted")
            case .denied: done("denied")
            default: done("prompt")
            }
        }
    }

    static func ask(_ done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            state(done)
        }
    }
}
