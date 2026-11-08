### Fixed
- A RAWG search that comes back empty now says why (the key was refused, the monthly quota or rate limit is used up, or RAWG didn't answer) instead of just "No matches found", and each failure goes in Settings → About → Errors.
- Picking a SteamGridDB game fills it in faster: its Steam lookup and its RAWG rating, length and genres now load side by side instead of one after another, and the sync button keeps spinning until they're done.
- A game, film or book lookup that never answers gives up after 15 seconds instead of holding the sheet forever.
