### Changed
- The Windows app is now portable, with no installer: download LifeLog-windows.zip, unzip it anywhere and open LifeLog.exe. Its data stays in the `data` folder beside it, so moving the folder moves the data. Settings → Desktop → Data folder still switches it to AppData or a folder you pick. The web app's "Get the Windows app" links to the zip.
- The Windows app updates itself without an installer: it downloads the new LifeLog.exe, checks its signature, swaps it in for the running one and restarts. In a folder it can't write to (such as Program Files) the bar says so and opens the release page.
- A copy the old installer put on a PC takes one last installer update, then updates the portable way in the same folder, with the same data. Its Start menu entry and uninstaller keep working.
- Notifications on Windows keep LifeLog's name and icon without the installer's Start menu shortcut.

### Fixed
- Opening LifeLog.exe straight from inside the zip no longer starts an app whose data would be lost with Windows' temp folder: it says to unzip first.

Windows only: the web app, Android and Linux are unchanged. Unreleased builds on Windows download the zip in the browser; put its LifeLog.exe over the one in your LifeLog folder.
