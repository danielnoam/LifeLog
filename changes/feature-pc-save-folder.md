### Added
- Windows app: choose where LifeLog keeps its data in Settings → Desktop → Data folder: the LifeLog folder beside the app (the new default), AppData, or a folder you pick. Changing it restarts LifeLog and copies everything over; the old copy stays until you remove it there.
- Windows app: uninstalling with "Delete the application data" ticked now also removes the data from the folder you chose. In a folder you picked, only LifeLog's own data goes, never anything else in it.

### Changed
- Windows app: on its first start, this version copies your data from AppData into `LifeLog\data` beside the app. The AppData copy is kept, renamed `EBWebView-old`, until you remove it in Settings → Desktop.
