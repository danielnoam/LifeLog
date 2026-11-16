// LifeLog: backups in Google Drive, beside GitHub sync rather than
// instead of it, through keel's drive.js (src/keel/drive.js, shared with
// Waypage). What goes in a backup and when one runs are LifeLog's own
// (src/settings.js); this sets keel's Drive up for LifeLog and gives
// Settings the shape it uses.
//
// A backup is one JSON file, the same shape as Import & export →
// Everything (lifelog.json without its keys, with boards and the
// watchlist), in a "LifeLog" folder in the person's Drive. The scope is
// drive.file. Android signs in through the Drive plugin (native/widgets),
// a browser through Google's popup, the Windows and Linux app through the
// browser and a one-off 127.0.0.1 address (src-tauri/src/oauth.rs).
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // From the LifeLog Google Cloud project's clients (lifelog-514817). Neither is a secret:
  // the Desktop client's "secret" is one Google says can't be kept in an
  // app and isn't treated as one. Empty means Drive isn't offered there.
  const WEB_CLIENT = "475402488283-cdhuke98k7u66h2vapg6dgntssi9hbsi.apps.googleusercontent.com";
  const DESKTOP_CLIENT = "475402488283-9d4mh32vbj09031jb78pjj8d19pikioh.apps.googleusercontent.com";
  const DESKTOP_SECRET = "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";

  const Keel = window.Keel && window.Keel.drive;
  if (!Keel) return;
  const P = () => window.LifeLogPlatform || {};
  const drive = Keel.create({
    name: "LifeLog", tag: "lldrive", mime: "application/json",
    keys: { cfg: "lifelog-drive-v1", token: "lifelog-drive-token-v1", hand: "lifelog-drive-hand", ask: "lifelog-drive-ask" },
    webClient: WEB_CLIENT, desktopClient: DESKTOP_CLIENT, desktopSecret: DESKTOP_SECRET,
    native: () => !!P().native, desktop: () => !!P().desktop,
    plugin: () => (P().native && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Drive) || null,
    tauri: () => (P().desktop && window.__TAURI__) || null,
    openOutside: (url) => P().openOutside(url),
  });

  window.LifeLogDrive = {
    DriveError: Keel.DriveError,
    connect: () => drive.connect(),
    disconnect: () => drive.disconnect(),
    list: () => drive.list(),
    remove: (id) => drive.remove(id),
    getToken: (ask, then) => drive.getToken(ask, then),
    // Sends one backup's JSON; it becomes `last`.
    async upload(text, device) {
      const made = await drive.upload({ text }, { device });
      const out = { id: made.id, size: made.size || text.length, at: Date.now() };
      drive.last = out;
      return out;
    },
    // A backup's data, parsed.
    async download(id) {
      const blob = await drive.download(id);
      try { return JSON.parse(await blob.text()); } catch (e) { throw new Keel.DriveError(i18n.t("That backup can't be read."), "bad"); }
    },
    get available() { return drive.available; },
    get on() { return drive.on; },
    get email() { return drive.email; },
    get auto() { return drive.auto; },
    set auto(v) { drive.auto = v; },
    get every() { return drive.every; },
    set every(v) { drive.every = v; },
    get last() { const l = drive.last; return l && l.at ? l : null; },
    get due() { return drive.due; },
    get signedIn() { return drive.signedIn; },
    get closing() { return drive.closing; },
    get resume() { return drive.resume; },
  };
})();
