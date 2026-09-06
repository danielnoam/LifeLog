todo:

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

- Discover could answer "what's hot on the services I actually have" via
  TMDB's watch-provider filter (/discover with with_watch_providers +
  watch_region). The nearest thing to the Netflix browsing this was
  originally asked for (see DROPPED.md)

- sync latency, remaining: SteamGridDB does an autocomplete request and then a
  second round of per-game cover fetches, both through the user's CORS proxy —
  two proxy round-trips deep before it can return anything. Could emit the
  name matches immediately and fill covers in progressively. Unmeasured (needs
  a key + proxy to test)

- the random pick weights nothing: a starred title is either the only kind
  you can draw ("Favorites only") or exactly as likely as everything else.
  Weighting stars up instead of filtering everything else out would let the
  draw lean towards what you actually want without cutting the pool

- nothing about a pick knows how long you have. `length` is free text off
  whichever media source filled it in ("12 hours", "2h 15m", "8 episodes"),
  so a "what fits in an evening" filter would need parsing that first

---

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
