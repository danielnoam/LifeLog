# To do

Only the work that's left. When an item ships it leaves this file in the
same commit and becomes a line in DONE.md (and the changelog); when Daniel
says no, it moves to DROPPED.md with his reason.

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

- **A tapped notification opens the right place.** On iPhone a habit
  reminder, a charge heads-up or a release-day notification only opens the
  app; Android goes to the habit, the Ledger or Upcoming. Plan: a
  UNUserNotificationCenterDelegate in the app (tools/ios-project.js adds
  it to the AppDelegate) that leaves `userInfo.action` where
  `takeLaunchAction` reads it, the way the share extension does.
- **An Apple developer account ($99/year)**, if the iOS app is ever used
  for real. Plan: sign in CI with the account's certificate and profile,
  upload to TestFlight from ios.yml, drop the AltStore/SideStore 7-day
  re-signing. Everything else for iOS is built (0.216.0 the app, 0.217.0
  widgets, reminders and Face ID).
