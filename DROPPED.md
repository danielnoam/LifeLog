# Dropped

Things decided against, and things that turned out not to be possible. Kept
here so the same idea doesn't get re-litigated every few months, and so
TODO.md stays a list of work actually worth doing.

Nothing here is forbidden forever — each entry says *why*, so if the reason
stops being true (an API opens up, the misses pile up, the shape of the app
changes) it can move back to TODO.md. What it isn't is an idea waiting for a
free afternoon.

Format: what it was, and the reason it isn't happening.

---

## Income tracking (Finance)

**Removed in v0.85.0.** The Type field on entries, the income/expense/net
stats, the savings-rate stat and the "Income by category" card are all gone;
every amount is a plain expense with no +/- sign, and CSV export dropped its
Type column.

Finance here answers "what am I spending", and income made every screen carry
a second axis to answer a question already answered better by a bank app. A
handful of irregular income rows never told the truth about a salary, so the
net and savings-rate numbers it enabled were confidently wrong.

Not coming back unless the app's purpose changes — a real budgeting tool is a
different app, not a wider Finance tab.

## Fuzzy title matching

`titleKey` (media.js) folds case, accents, punctuation, spacing and `&` vs
"and", and normalizes season markers. It deliberately stops short of
edit-distance matching, so "Re:ZERO -Starting Life in Another World-" and
"ReZero Starting Life in Another World" still key apart — "re zero" and
"rezero" differ once punctuation goes.

Edit distance would catch that pair and would also start hiding things that
only *look* similar, which is the worse failure: a Discover row silently
missing because it resembles something already owned. Revisit only if the
misses actually pile up.

## Rotten Tomatoes, Metacritic and Netflix as sources

**Not possible.** None has a public API. Metacritic scores do arrive
second-hand through RAWG, which is where the app's game ratings come from.

The Netflix half — "what's hot on the services I actually have" — is
answerable through TMDB's watch-provider filter instead, and that idea lives
in TODO.md as real work.

## "Hot books" and "hot music" in Discover

**No source.** Open Library and Google Books publish no popularity data and
MusicBrainz none at all, so those categories get no Discover list.

The NYT Books API (free key, bestseller lists) is the one candidate that
would actually add something; it's in TODO.md rather than here, because it's
possible — just another key to set up.

## Early Access for non-Steam games

Early Access is readable only through Steam, which files it as genre id 70
(see `steamEarlyAccess` in media.js). A RAWG- or SteamGridDB-only game has no
way to say so: RAWG has no field for it — its `early-access` tag is a stale
mirror of Steam's that never clears at 1.0 — and SteamGridDB states nothing
but artwork and a date.

IGDB has a real `status` enum that includes it, but wiring IGDB means a whole
new media source behind Twitch OAuth for one boolean. Not worth it. Games
without a Steam App ID simply don't get the flag.

## Blocking saves when a device is behind

The version guard (v0.117.0) warns and nothing more. A blocking mode — refuse
to save from a device older than the data — would have to be worth losing
offline edits for, and since v0.116.0 made every sanitizer carry unknown
fields through, being behind isn't destructive any more.

The hook is there if this ever changes: `versionBehind()` is one call away
from `persist()`.
