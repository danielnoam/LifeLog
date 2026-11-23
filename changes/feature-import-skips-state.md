### Added
- An import remembers where a title was when you skipped it (Steam games played, AniList, Stremio, Hardcover). It stays out while it's there, and is asked about again once it moves on: more episodes or chapters, another hour played, or finished. The row says "skipped at 5, moved on since", and a title that comes back always goes through the review, never straight in. A Steam wishlist skip stays a skip.
- A sync with nothing new but things you skipped says so, with Show skipped to change your mind. A review with nothing ticked can be confirmed as Skip these.
- Bridge: `lifelog_import_skips` lists what each import remembers you skipped, and `lifelog_unskip_import` makes the next sync offer one again.

### Fixed
- AniList and Hardcover reviews, and any connection set to Add straight away, now show what you skipped under "Show what you skipped before"; before, skipped titles never reached the review at all.
