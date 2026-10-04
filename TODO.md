todo:

- **A travel mode: places and an itinerary.** A trip with the places you
  want to go and a day-by-day plan. To decide: whether it's its own tab or
  part of an existing one (the Ledger already has projects, which a trip
  could share for its spending), and what a place holds (name, address or
  map link, notes, visited).

- **Books as notes.** PDFs and EPUBs come in as text since 0.236.0, but
  only up to 300,000 characters, because every note lives in the one data
  file that syncs on each save and is cached in localStorage (about 5MB). A
  whole book needs its text kept apart: in IndexedDB and a file of its own
  in the sync repo, written once, with the note holding the title and a
  reader that loads the rest.

- **An AI chat about your data.** A section where you ask questions ("what
  did I spend on food this year?", "what did I finish in March?") and an AI
  answers from your LifeLog data. Connect to one of your choosing: a local
  model (Ollama or LM Studio on your computer, reached over your home
  network; the phone can't run one itself) or a hosted API with your own
  key. To decide: how much data goes in each question (all of it won't fit
  a small local model, so likely a summary plus the rows that match), and
  making it plain what leaves the device when the model isn't local.

- **An Apple developer account ($99/year)**, if the iOS app is ever used
  for real: sign in CI, upload to TestFlight, and the 7-day re-signing that
  AltStore/SideStore do goes away. Everything else for iOS is built (0.216.0
  the app, 0.217.0 the widgets, reminders and Face ID).

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
