todo:

- **The iOS app, past its base.** 0.216.0 builds an unsigned LifeLog.ipa
  on every release (.github/workflows/ios.yml). Left:
  - Install it once with AltStore or SideStore and go through it on a real
    iPhone: safe areas under the notch and the home bar, the pull to sync
    against WKWebView's own bounce, the QR scanner's camera, the phone
    backup showing in Files, Steam without the proxy.
  - Widgets and reminders are Android code (native/widgets). iOS would need
    a WidgetKit extension in Swift and local notifications — a project of
    its own, worth it only once the app is used daily on an iPhone.
  - With a developer account ($99/year): sign in CI, upload to TestFlight,
    and the 7-day re-signing goes away.

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, a habits tab of its own, times-per-week habits and streak
  milestones. Reminders were there too until the Android app gave them a
  way in; they shipped in 0.183.0.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
