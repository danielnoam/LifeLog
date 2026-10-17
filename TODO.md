# To do

Only the work that's left. When an item ships it leaves this file in the
same commit and becomes a line in DONE.md (and the changelog); when Daniel
says no, it moves to DROPPED.md with his reason.

## Next

Picked by Daniel on 2026-10-17. Items 1 and 2 share the native reminder
work, so they'd go out as one release.

1. **A heads-up before a recurring charge.** A notification a few days
   before a recurring expense charges, so a yearly or monthly plan can be
   cancelled in time. Plan: in the Ledger, a "Remind me" choice on a
   recurring expense (off, 1, 3 or 7 days before), kept on this phone like
   habit reminders (reminders.js), not synced. The next charge date is
   already worked out for the Ledger; widgets.js puts the upcoming charges
   (title, amount, day, days before) in the snapshot, and the native side
   schedules them beside the habit alarms (Reminders.java's one next
   alarm, LifeLogReminders.swift's scheduled-ahead list). Tapping opens the
   plan. Skipped or stopped plans drop out. Phones only; a desktop has
   nothing to buzz. No data change, so the bridge is untouched.
2. **A buzz on release day for starred Backlog items.** Out today only
   helps once you open the app. Plan: the snapshot also carries starred
   items with a release or next-episode date known to the day (`nextAt`,
   or `releaseDate` at day precision), and the native side schedules one
   morning notification per day naming what's out (several in one). A
   switch in Settings → Release dates, on this phone. Since 0.271.0 the
   app re-checks those dates when the day comes, so a slipped date moves
   the alarm the next time the snapshot is written. TBA, month and year
   dates get nothing.
3. **NYT bestsellers in Discover for Books.** Open Library and Google
   Books have no popularity data (DROPPED.md, "Hot books"). Plan: the NYT
   Books API (free key, `lists/current/{list}.json`) as Discover's Popular
   list for a Books category, with the list (fiction, non-fiction…) picked
   in the category's source settings; each title matched through the
   category's normal source for its cover. Key in Settings → media keys
   (synced like the others, blanked in exports), a credit in Settings →
   About, and nothing asked for without the key.

## Decisions waiting on Daniel

From the security pass (audits/2026-10-09-security-pass.md in the project
folder). Each changes how data is stored, so each is his call first.

- **Optional encryption of the data file before it is committed.** Daniel
  leans no; mandatory encryption is in DROPPED.md (Data encryption).
  Plan if yes (the audit's item 6): the whole file encrypted with a random
  data key (AES-GCM, Web Crypto), that key wrapped by a PBKDF2 key from a
  passphrase, with a printed recovery key; History decrypts GitHub's saves
  in-app, and the bridge needs the passphrase to read. Cost: a forgotten
  passphrase and lost recovery key is the data gone, and the file mirror
  and GitHub's diffs become ciphertext.
- **Encrypting this device's copy (IndexedDB) with a key from the PIN.**
  Mainly for the desktop browser. Plan if yes: derive a key from the app
  lock PIN (PBKDF2, needs a 6+ digit PIN), encrypt the stored copy, decrypt
  after unlock. Cost: a forgotten PIN means re-syncing from GitHub, and
  launch waits for the unlock before drawing.

## iOS

- **An Apple developer account ($99/year)**, if the iOS app is ever used
  for real. Plan: sign in CI with the account's certificate and profile,
  upload to TestFlight from ios.yml, drop the AltStore/SideStore 7-day
  re-signing. Everything else for iOS is built (0.216.0 the app, 0.217.0
  widgets, reminders and Face ID).
