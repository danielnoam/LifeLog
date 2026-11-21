### Fixed
- Stremio: Add to my Stremio account said "Session does not exist" even when you were signed in. The proxy (and the Android app's route) cut what it passed on to Stremio at 4 KB, and your add-on list is far bigger, so Stremio got broken JSON and never saw your key. Both now pass up to 1 MB.
