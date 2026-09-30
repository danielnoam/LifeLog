// What the iOS widgets draw from, and what they hand back (0.217.0) — the
// Swift twin of the Android side's WidgetStore.java, compiled into both the
// app's Widgets plugin and the widget extension.
//
// The app writes a snapshot whenever its data changes (src/widgets.js,
// snapshotOf); a widget can't run the app or reach GitHub, so a tick made on
// one is queued here, shown at once by laying the queue over the snapshot,
// and applied by the app the next time it runs (applyQueue). The queue keeps
// the latest entry per thing ticked. Rules for what's due, what's kept and
// how long a run is are Android's, which are the app's habits.js — keep them
// in step.
//
// The two processes share files through an App Group. AltStore and SideStore
// register it under a name of their own when they sign the app, and write
// that name into Info.plist's ALTAppGroups, so the name is read from there
// first.
import Foundation

enum LLGroup {
    static let fallback = "group.io.github.danielnoam.lifelog"

    static var candidates: [String] {
        var out: [String] = []
        if let alt = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] { out += alt }
        out.append(fallback)
        return out
    }

    static var container: URL? {
        for id in candidates {
            if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) { return url }
        }
        return nil
    }
}

enum LLStore {
    static let snapshotFile = "snapshot.json"
    static let queueFile = "queue.json"

    private static func url(_ name: String) -> URL? { LLGroup.container?.appendingPathComponent(name) }

    static var available: Bool { LLGroup.container != nil }

    static func saveSnapshot(_ json: String) {
        guard let u = url(snapshotFile), let d = json.data(using: .utf8) else { return }
        try? d.write(to: u, options: .atomic)
    }

    static func snapshot() -> [String: Any]? {
        guard let u = url(snapshotFile), let d = try? Data(contentsOf: u) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    static func queue() -> [[String: Any]] {
        guard let u = url(queueFile), let d = try? Data(contentsOf: u) else { return [] }
        return ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]]) ?? []
    }

    private static func saveQueue(_ q: [[String: Any]]) {
        guard let u = url(queueFile) else { return }
        if q.isEmpty { try? FileManager.default.removeItem(at: u); return }
        if let d = try? JSONSerialization.data(withJSONObject: q) { try? d.write(to: u, options: .atomic) }
    }

    static func takeQueue() -> [[String: Any]] {
        let q = queue()
        saveQueue([])
        return q
    }

    private static func key(_ o: [String: Any]) -> String {
        "\(o["kind"] as? String ?? ""):\(o["id"] as? String ?? ""):\(o["date"] as? String ?? "")"
    }

    static func enqueue(_ item: [String: Any]) {
        let k = key(item)
        var q = queue().filter { key($0) != k }
        q.append(item)
        saveQueue(q)
    }

    static var pendingCount: Int { queue().count }
}

// ---- dates, the way the app writes them ----
enum LLDate {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func today(_ now: Date = Date()) -> String { formatter.string(from: now) }

    static func date(_ s: String) -> Date? { formatter.date(from: s) }

    static func add(_ s: String, _ days: Int) -> String {
        guard let d = date(s), let n = Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: d) else { return s }
        return formatter.string(from: n)
    }

    /// 0 = Sunday, as JavaScript's getDay() and the snapshot's `days` count.
    static func weekday(_ s: String) -> Int {
        guard let d = date(s) else { return -1 }
        return Calendar(identifier: .gregorian).component(.weekday, from: d) - 1
    }

    static func nowIso() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}

private func int(_ v: Any?) -> Int {
    if let n = v as? NSNumber { return n.intValue }
    if let s = v as? String, let n = Int(s) { return n }
    return 0
}

private func str(_ v: Any?) -> String { v as? String ?? "" }

// ---- habits ----
struct LLHabit: Identifiable {
    let id: String
    let name: String
    let color: String
    let target: Int
    let value: Int
    let avoid: Bool
    let limit: Int
    let done: Bool
    let streak: Int
    let remind: String
}

enum LLHabits {
    static func dueOn(_ h: [String: Any], _ date: String) -> Bool {
        let started = str(h["startedAt"])
        if !started.isEmpty && date < started { return false }
        guard let days = h["days"] as? [Any] else { return true }
        let wd = LLDate.weekday(date)
        return days.contains { int($0) == wd }
    }

    /// A date's mark: the widget's latest tick for it, else what the app sent.
    static func markOn(_ h: [String: Any], _ q: [[String: Any]], _ date: String) -> Int {
        let id = str(h["id"])
        if let o = q.last(where: { str($0["kind"]) == "habit" && str($0["id"]) == id && str($0["date"]) == date }) {
            return int(o["value"])
        }
        return int((h["marks"] as? [String: Any])?[date])
    }

    static func keptWith(_ h: [String: Any], _ mark: Int) -> Bool {
        (h["avoid"] as? Bool ?? false) ? mark <= max(0, int(h["limit"])) : mark >= max(1, int(h["target"]))
    }

    /// habits.js's streakOf: `runBefore` covers up to the day before the
    /// snapshot's own today; the days since are walked from its week of marks.
    static func streakOn(_ h: [String: Any], _ q: [[String: Any]], _ snapToday: String, _ day: String) -> Int {
        var run = 0
        var broken = false
        var d = LLDate.add(day, -1)
        var guardN = 0
        while guardN < 400 && d >= snapToday {
            if dueOn(h, d) {
                if keptWith(h, markOn(h, q, d)) { run += 1 } else { broken = true; break }
            }
            d = LLDate.add(d, -1)
            guardN += 1
        }
        if !broken { run += max(0, int(h["runBefore"])) }
        if dueOn(h, day) && keptWith(h, markOn(h, q, day)) { run += 1 }
        return run
    }

    static func all(_ snap: [String: Any]?) -> [[String: Any]] { (snap?["habits"] as? [[String: Any]]) ?? [] }

    /// Today's due habits, in the app's order.
    static func rows(_ snap: [String: Any]?, _ q: [[String: Any]], _ today: String) -> [LLHabit] {
        guard let snap = snap else { return [] }
        let snapToday = str(snap["today"]).isEmpty ? today : str(snap["today"])
        return all(snap).filter { dueOn($0, today) }.map { h in
            let value = markOn(h, q, today)
            let avoid = h["avoid"] as? Bool ?? false
            return LLHabit(
                id: str(h["id"]), name: str(h["name"]), color: str(h["color"]),
                target: max(1, int(h["target"])), value: value,
                avoid: avoid, limit: max(0, int(h["limit"])),
                done: keptWith(h, value), streak: streakOn(h, q, snapToday, today), remind: str(h["remind"]))
        }
    }

    /// A tap moves the mark on by one and wraps — habits.js's nextMark: at
    /// the target, or one past an avoided habit's limit.
    static func tick(_ id: String) {
        let today = LLDate.today()
        guard let r = rows(LLStore.snapshot(), LLStore.queue(), today).first(where: { $0.id == id }) else { return }
        let cap = r.avoid ? r.limit + 1 : r.target
        LLStore.enqueue(["kind": "habit", "id": id, "date": today, "value": r.value >= cap ? 0 : r.value + 1, "at": LLDate.nowIso()])
    }
}

// ---- to-dos: the list notes, as panels ----
struct LLTodo: Identifiable {
    let id: String
    let text: String
    let done: Bool
}

struct LLPanel: Identifiable {
    let id: String   // the list's id
    let name: String
    let color: String
    let open: [LLTodo]
    let doneCount: Int
}

enum LLTodos {
    /// A panel per list, open items in the list's order. A tick made on the
    /// widget moves an item out at once; one unticked there comes back.
    static func panels(_ snap: [String: Any]?, _ q: [[String: Any]]) -> [LLPanel] {
        guard let snap = snap else { return [] }
        let todos = (snap["todos"] as? [[String: Any]]) ?? []
        let lists = (snap["lists"] as? [[String: Any]]) ?? []
        let doneCount = (snap["doneCount"] as? [String: Any]) ?? [:]
        func tickState(_ t: [String: Any]) -> Bool {
            let id = str(t["id"])
            if let o = q.last(where: { str($0["kind"]) == "todo" && str($0["id"]) == id }) { return o["done"] as? Bool ?? false }
            return t["done"] as? Bool ?? false
        }
        return lists.map { l in
            let lid = str(l["id"])
            let mine = todos.filter { str($0["list"]) == lid }
            let open = mine.filter { !tickState($0) }.map { LLTodo(id: str($0["id"]), text: str($0["text"]), done: false) }
            let doneNow = mine.filter { tickState($0) }.count
            let base = int(doneCount[str(l["name"])])
            return LLPanel(id: lid, name: str(l["name"]), color: str(l["color"]), open: open,
                           doneCount: max(base, doneNow))
        }
    }

    static func tick(_ id: String, done: Bool) {
        LLStore.enqueue(["kind": "todo", "id": id, "done": done, "at": LLDate.nowIso()])
    }
}

// ---- the other widgets' shares of the snapshot ----
struct LLSpend {
    let label: String
    let total: String
    let compare: String
    let cats: [(name: String, amount: String, color: String)]
}

struct LLNote: Identifiable {
    let id: String
    let kind: String
    let title: String
    let text: String
    let author: String
    let items: [String]
    let color: String
    let date: String
}

enum LLOther {
    static func spend(_ snap: [String: Any]?) -> LLSpend? {
        guard let s = snap?["spend"] as? [String: Any] else { return nil }
        let cats = ((s["cats"] as? [[String: Any]]) ?? []).map { (name: str($0["name"]), amount: str($0["amount"]), color: str($0["color"])) }
        return LLSpend(label: str(s["label"]), total: str(s["total"]), compare: str(s["compare"]), cats: cats)
    }

    static func notes(_ snap: [String: Any]?) -> [LLNote] {
        ((snap?["notes"] as? [[String: Any]]) ?? []).map { n in
            LLNote(id: str(n["id"]), kind: str(n["kind"]), title: str(n["title"]), text: str(n["text"]),
                   author: str(n["author"]), items: (n["items"] as? [String]) ?? [],
                   color: str(n["color"]), date: str(n["date"]))
        }
    }

    static func actions(_ snap: [String: Any]?) -> [String] { (snap?["actions"] as? [String]) ?? [] }
}

/// Where a tap on a widget goes: the app, told what to open, through the
/// lifelog:// scheme (tools/ios-project.js registers it; src/widgets.js
/// hands it to runAction, the same actions Android's widgets send).
enum LLLink {
    static func action(_ a: String) -> URL {
        let enc = a.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? a
        return URL(string: "lifelog://action/" + enc) ?? URL(string: "lifelog://action/open-habits")!
    }
}
