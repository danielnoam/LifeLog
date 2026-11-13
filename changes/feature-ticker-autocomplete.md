### Fixed
- Watch a ticker: the search as you type no longer fails silently. It shows "Searching…" while it asks, says when no US ticker matches, and says what went wrong (no key, a key Tiingo turned down, the hourly limit, or a web proxy that needs redeploying for the search route).
- A full ticker you type (like VOO) still completes with its name when the search itself fails, through the same lookup prices use.

### Changed
- The ticker search answers a little sooner after you stop typing, and a word you've already searched answers at once without asking Tiingo again.
