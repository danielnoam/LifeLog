// LifeLog's iOS home-screen widgets (0.217.0): Habits, To-do, Quick add,
// This month and a Note — Android's set, drawn from the same snapshot
// (native/widgets/ios/Shared). Habits and To-do tick from the home screen
// (interactive widgets, iOS 17); the tick is queued and the app applies it
// the next time it opens, as on Android. Everything else opens the app on the
// thing tapped, through lifelog:// links.
import AppIntents
import SwiftUI
import WidgetKit

// ---- looks: the app's dark theme ----
private let bgColor = Color(red: 0x11 / 255, green: 0x14 / 255, blue: 0x1a / 255)
private let dimText = Color.white.opacity(0.55)
private let accent = Color(red: 0x5b / 255, green: 0x8c / 255, blue: 0xff / 255)

private func hex(_ s: String, _ fallback: Color = accent) -> Color {
    var h = s.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return fallback }
    return Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

private struct Empty: View {
    let text: String
    var body: some View {
        Text(text).font(.caption).foregroundStyle(dimText).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Ticks made here reach GitHub only through the app — said, while any wait.
private struct Waiting: View {
    var body: some View {
        let n = LLStore.pendingCount
        if n > 0 {
            Text(n == 1 ? "1 tick syncs when LifeLog opens" : "\(n) ticks sync when LifeLog opens")
                .font(.system(size: 10)).foregroundStyle(dimText).lineLimit(1)
        }
    }
}

// ---- the timeline: redrawn at midnight, so "today" turns over ----
struct LLEntry: TimelineEntry {
    let date: Date
    let snap: [String: Any]?
    let queue: [[String: Any]]
    var today: String { LLDate.today(date) }
}

struct LLProvider: TimelineProvider {
    func placeholder(in context: Context) -> LLEntry { LLEntry(date: Date(), snap: nil, queue: []) }
    func getSnapshot(in context: Context, completion: @escaping (LLEntry) -> Void) {
        completion(LLEntry(date: Date(), snap: LLStore.snapshot(), queue: LLStore.queue()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LLEntry>) -> Void) {
        let now = Date()
        let entry = LLEntry(date: now, snap: LLStore.snapshot(), queue: LLStore.queue())
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

// ---- ticking from the widget ----
struct TickHabitIntent: AppIntent {
    static var title: LocalizedStringResource = "Tick a habit"
    @Parameter(title: "Habit") var habitId: String
    init() {}
    init(habitId: String) { self.habitId = habitId }
    func perform() async throws -> some IntentResult {
        LLHabits.tick(habitId)
        LLReminders.reschedule()
        return .result()
    }
}

struct TickTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Tick a checklist item"
    @Parameter(title: "Item") var itemId: String
    init() {}
    init(itemId: String) { self.itemId = itemId }
    func perform() async throws -> some IntentResult {
        LLTodos.tick(itemId, done: true)
        return .result()
    }
}

// ---- Habits ----
struct HabitsView: View {
    let entry: LLEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let rows = LLHabits.rows(entry.snap, entry.queue, entry.today)
        let limit = family == .systemLarge ? 8 : 3
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Habits").font(.headline).foregroundStyle(.white)
                Spacer()
                if !rows.isEmpty {
                    Text("\(rows.filter { $0.done }.count) of \(rows.count)").font(.caption.bold()).foregroundStyle(accent)
                }
            }
            if entry.snap == nil { Empty(text: "Open LifeLog once") }
            else if LLHabits.all(entry.snap).isEmpty { Empty(text: "No habits yet") }
            else if rows.isEmpty { Empty(text: "Nothing due today") }
            else {
                ForEach(Array(rows.prefix(limit))) { h in row(h) }
                Spacer(minLength: 0)
                Waiting()
            }
        }
        .widgetURL(LLLink.action("open-habits"))
    }

    @ViewBuilder func row(_ h: LLHabit) -> some View {
        HStack(spacing: 8) {
            Link(destination: LLLink.action("open-habit:" + h.id)) {
                HStack(spacing: 6) {
                    Circle().fill(hex(h.color)).frame(width: 8, height: 8)
                    Text(h.name).font(.subheadline).foregroundStyle(.white).lineLimit(1)
                    if h.streak > 0 && family != .systemSmall {
                        Text("🔥\(h.streak)").font(.caption2).foregroundStyle(dimText)
                    }
                }
            }
            Spacer(minLength: 4)
            Button(intent: TickHabitIntent(habitId: h.id)) { tick(h) }.buttonStyle(.plain)
        }
    }

    @ViewBuilder func tick(_ h: LLHabit) -> some View {
        let c = hex(h.color)
        if h.avoid {
            Text(h.value == 0 ? "Kept" : "\(h.value)✕")
                .font(.caption2.bold()).padding(.horizontal, 6).frame(height: 22)
                .foregroundStyle(h.done ? c : .red)
                .overlay(Capsule().stroke(h.done ? c : .red, lineWidth: 1))
        } else if h.target > 1 && !h.done {
            Text("\(h.value)/\(h.target)").font(.caption2.bold()).frame(minWidth: 34, minHeight: 22)
                .foregroundStyle(c).overlay(Capsule().stroke(c, lineWidth: 1))
        } else {
            ZStack {
                Circle().stroke(c, lineWidth: 1.5)
                if h.done { Circle().fill(c); Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
            }.frame(width: 22, height: 22)
        }
    }
}

struct HabitsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeLogHabits", provider: LLProvider()) { entry in
            HabitsView(entry: entry).containerBackground(bgColor, for: .widget)
        }
        .configurationDisplayName("Habits")
        .description("Today's habits. Tap the circle to tick one.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// ---- To-do ----
struct TodosView: View {
    let entry: LLEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let panels = LLTodos.panels(entry.snap, entry.queue).filter { !$0.open.isEmpty }
        let budget = family == .systemLarge ? 11 : 4
        VStack(alignment: .leading, spacing: 5) {
            if entry.snap == nil { Empty(text: "Open LifeLog once") }
            else if panels.isEmpty {
                Text("Checklist").font(.headline).foregroundStyle(.white)
                Empty(text: "Nothing left to do")
            } else {
                ForEach(layout(panels, budget)) { slice in
                    let panel = slice.panel
                    Link(destination: LLLink.action("add-todo:" + panel.id)) {
                        HStack {
                            Text(panel.name).font(.subheadline.bold()).foregroundStyle(panel.color.isEmpty ? .white : hex(panel.color))
                            Spacer()
                            Text("\(panel.open.count) left").font(.caption2).foregroundStyle(dimText)
                        }
                    }
                    ForEach(slice.items) { t in
                        HStack(spacing: 8) {
                            Button(intent: TickTodoIntent(itemId: t.id)) {
                                Circle().stroke(dimText, lineWidth: 1.5).frame(width: 16, height: 16)
                            }.buttonStyle(.plain)
                            Text(t.text).font(.subheadline).foregroundStyle(.white).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
                Waiting()
            }
        }
        .widgetURL(LLLink.action("open-todos"))
    }

    struct Slice: Identifiable {
        let panel: LLPanel
        let items: [LLTodo]
        var id: String { panel.id }
    }

    /// As many lists as fit, each with as many open items as fit.
    func layout(_ panels: [LLPanel], _ budget: Int) -> [Slice] {
        var left = budget
        var out: [Slice] = []
        for p in panels where left > 1 {
            let take = Array(p.open.prefix(left - 1))
            out.append(Slice(panel: p, items: take))
            left -= take.count + 1
        }
        return out
    }
}

struct TodosWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeLogTodos", provider: LLProvider()) { entry in
            TodosView(entry: entry).containerBackground(bgColor, for: .widget)
        }
        .configurationDisplayName("Checklist")
        .description("Your checklists' open items. Tap the circle when one's done.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// ---- Quick add ----
private let actionLabels: [String: (String, String)] = [
    "add-note": ("Note", "square.and.pencil"),
    "add-todo": ("Checklist", "checklist"),
    "add-entry": ("Entry", "plus.circle"),
    "add-expense": ("Expense", "creditcard"),
    "add-backlog": ("Backlog", "star"),
]

struct QuickAddView: View {
    let entry: LLEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let acts = LLOther.actions(entry.snap).filter { actionLabels[$0] != nil }
        let shown = Array((acts.isEmpty ? ["add-note", "add-todo", "add-entry", "add-expense"] : acts).prefix(family == .systemSmall ? 4 : 5))
        let cols = family == .systemSmall ? 2 : shown.count
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: max(1, cols)), spacing: 8) {
            ForEach(shown, id: \.self) { a in
                Link(destination: LLLink.action(a)) {
                    VStack(spacing: 4) {
                        Image(systemName: actionLabels[a]!.1).font(.title3)
                        Text(actionLabels[a]!.0).font(.caption2)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                }
            }
        }
    }
}

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeLogQuickAdd", provider: LLProvider()) { entry in
            QuickAddView(entry: entry).containerBackground(bgColor, for: .widget)
        }
        .configurationDisplayName("Quick add")
        .description("Open LifeLog straight onto a new note, checklist item, entry or expense.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// ---- This month ----
struct SpendView: View {
    let entry: LLEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let s = LLOther.spend(entry.snap) {
                Text(s.label).font(.caption).foregroundStyle(dimText)
                Text(s.total).font(.system(size: 26, weight: .bold)).foregroundStyle(.white).minimumScaleFactor(0.5).lineLimit(1)
                if !s.compare.isEmpty { Text(s.compare).font(.caption2).foregroundStyle(dimText).lineLimit(2) }
                Spacer(minLength: 0)
                if family != .systemSmall {
                    ForEach(s.cats.indices, id: \.self) { i in
                        HStack(spacing: 6) {
                            Circle().fill(hex(s.cats[i].color)).frame(width: 7, height: 7)
                            Text(s.cats[i].name).font(.caption).foregroundStyle(.white).lineLimit(1)
                            Spacer()
                            Text(s.cats[i].amount).font(.caption).foregroundStyle(dimText)
                        }
                    }
                }
            } else {
                Empty(text: entry.snap == nil ? "Open LifeLog once" : "The Ledger is off")
            }
        }
        .widgetURL(LLLink.action("open-finance"))
    }
}

struct SpendWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeLogSpend", provider: LLProvider()) { entry in
            SpendView(entry: entry).containerBackground(bgColor, for: .widget)
        }
        .configurationDisplayName("This month")
        .description("What you've spent this month, against last month by the same day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// ---- A note: a different one every few hours ----
struct NoteEntry: TimelineEntry {
    let date: Date
    let note: LLNote?
    let empty: String
}

struct NoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> NoteEntry { NoteEntry(date: Date(), note: nil, empty: "") }
    func getSnapshot(in context: Context, completion: @escaping (NoteEntry) -> Void) {
        let notes = LLOther.notes(LLStore.snapshot())
        completion(NoteEntry(date: Date(), note: notes.first, empty: "No notes yet"))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NoteEntry>) -> Void) {
        let snap = LLStore.snapshot()
        let notes = LLOther.notes(snap)
        let empty = snap == nil ? "Open LifeLog once" : "No notes yet"
        let now = Date()
        var entries: [NoteEntry] = []
        if notes.isEmpty {
            entries.append(NoteEntry(date: now, note: nil, empty: empty))
        } else {
            // A fresh shuffle per timeline, stepped through every three hours.
            let order = notes.shuffled()
            for i in 0..<min(8, order.count) {
                entries.append(NoteEntry(date: now.addingTimeInterval(Double(i) * 3 * 3600), note: order[i], empty: empty))
            }
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct NoteView: View {
    let entry: NoteEntry
    var body: some View {
        if let n = entry.note {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    if !n.color.isEmpty { Circle().fill(hex(n.color)).frame(width: 7, height: 7) }
                    Text(n.date).font(.caption2).foregroundStyle(dimText)
                    Spacer()
                }
                if n.kind == "quote" {
                    Text("“" + n.text + "”").font(.subheadline.italic()).foregroundStyle(.white)
                    if !n.author.isEmpty { Text("— " + n.author).font(.caption).foregroundStyle(dimText) }
                } else if n.kind == "list" {
                    Text(n.text).font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1)
                    ForEach(n.items.indices, id: \.self) { i in
                        Text("· " + n.items[i]).font(.caption).foregroundStyle(.white).lineLimit(1)
                    }
                } else {
                    if !n.title.isEmpty { Text(n.title).font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1) }
                    Text(n.text).font(.subheadline).foregroundStyle(.white)
                }
                Spacer(minLength: 0)
            }
            .widgetURL(LLLink.action("open-note:" + n.id))
        } else {
            Empty(text: entry.empty)
        }
    }
}

struct NoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeLogNote", provider: NoteProvider()) { entry in
            NoteView(entry: entry).containerBackground(bgColor, for: .widget)
        }
        .configurationDisplayName("A note")
        .description("One of your notes, a different one every few hours.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct LifeLogWidgetBundle: WidgetBundle {
    var body: some Widget {
        HabitsWidget()
        TodosWidget()
        QuickAddWidget()
        SpendWidget()
        NoteWidget()
    }
}
