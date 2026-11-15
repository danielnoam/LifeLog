// Where the Windows app keeps its data: the WebView's profile (localStorage,
// this device's copy in IndexedDB, images, the GitHub token), which is all
// LifeLog writes on this computer. Settings → Desktop picks one of:
//
//   lifelog  a `data` folder beside LifeLog.exe (the default from 0.316):
//            %LOCALAPPDATA%\LifeLog\data with the per-user installer. An
//            update replaces only the app's own files, so it stays.
//   appdata  %LOCALAPPDATA%\io.github.danielnoam.lifelog, Tauri's default
//            and where every install before this one kept it.
//   custom   any folder. Only the EBWebView folder inside it is LifeLog's.
//
// The choice takes effect at the next start, before the window exists: the
// profile can't be copied while the WebView has it open. The copy leaves
// the old profile renamed EBWebView-old, so a failed or unwanted move loses
// nothing, and switching back later never opens a stale copy by mistake.
//
// The uninstaller's "Delete the application data" box removes the folders
// named in HKCU\Software\LifeLog (windows/hooks.nsh): only EBWebView and
// EBWebView-old in them, never the folder itself unless it's left empty.
#![cfg_attr(not(windows), allow(dead_code))]
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const PROFILE: &str = "EBWebView";
pub const OLD: &str = "EBWebView-old";
const FILE: &str = "data-folder.json";
// Chromium rebuilds these, so a move doesn't carry them; the lock files are
// held by a WebView still closing down after a restart.
const SKIP: &[&str] = &[
    "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
    "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "Crashpad", "LOCK", "lockfile",
];

pub struct DataFolder {
    pub mode: String,
    pub custom: String,
    pub dir: PathBuf,
    pub old: Option<PathBuf>,
    pub note: String,
    local: PathBuf,
}

fn lifelog_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|d| d.join("data"))
}

fn read(local: &Path) -> Value {
    fs::read_to_string(local.join(FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

fn text(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_owned()
}

fn target(mode: &str, custom: &str, local: &Path) -> Option<PathBuf> {
    match mode {
        "appdata" => Some(local.to_path_buf()),
        "custom" if Path::new(custom).is_absolute() => Some(PathBuf::from(custom)),
        "lifelog" => lifelog_dir(),
        _ => None,
    }
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let name = e.file_name();
        if SKIP.iter().any(|s| name == *s) {
            continue;
        }
        let ty = e.file_type()?;
        if ty.is_dir() {
            copy_tree(&e.path(), &to.join(&name))?;
        } else if ty.is_file() {
            fs::copy(e.path(), to.join(&name))?;
        }
    }
    Ok(())
}

// A WebView from the run before a restart can take a moment to let go.
fn copy_profile(from: &Path, to: &Path) -> std::io::Result<()> {
    let tmp = to.join(format!("{PROFILE}-moving"));
    let mut last = Ok(());
    for _ in 0..5 {
        let _ = fs::remove_dir_all(&tmp);
        last = copy_tree(&from.join(PROFILE), &tmp);
        if last.is_ok() {
            return fs::rename(&tmp, to.join(PROFILE));
        }
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
    let _ = fs::remove_dir_all(&tmp);
    last
}

fn has_profile(dir: &Path) -> bool {
    dir.join(PROFILE).is_dir()
}

// Works out the folder for this start, moving the profile there first if
// the choice changed. Never fails: anything that goes wrong keeps the folder
// that has the data and says why in `note`, for Settings → Desktop to show.
pub fn resolve(local: &Path) -> DataFolder {
    let saved = read(local);
    let mut mode = if saved.is_null() { "lifelog".to_owned() } else { text(&saved, "mode") };
    let mut custom = text(&saved, "custom");
    // Where the data was last opened from; before this existed, AppData.
    let current = match text(&saved, "current") {
        c if c.is_empty() => local.to_path_buf(),
        c => PathBuf::from(c),
    };
    let mut old = match text(&saved, "old") {
        o if o.is_empty() => None,
        o => Some(PathBuf::from(o)),
    };
    let mut note = String::new();

    let mut dir = match target(&mode, &custom, local) {
        Some(d) => d,
        None => {
            mode = "appdata".into();
            local.to_path_buf()
        }
    };
    if dir != current {
        let mut kept = false;
        if let Err(e) = fs::create_dir_all(&dir) {
            note = format!("Couldn't use {}: {e}. LifeLog kept its data where it was.", dir.display());
            kept = true;
        } else if has_profile(&dir) {
            // Already LifeLog's: open it as it is.
        } else if has_profile(&current) {
            match copy_profile(&current, &dir) {
                Ok(()) => {
                    // The copy just made is newer than any earlier one.
                    if let Some(o) = old.take() {
                        let _ = fs::remove_dir_all(o.join(OLD));
                    }
                    let _ = fs::remove_dir_all(current.join(OLD));
                    if fs::rename(current.join(PROFILE), current.join(OLD)).is_ok() {
                        old = Some(current.clone());
                    }
                }
                Err(e) => {
                    note = format!("Couldn't copy your data to {}: {e}. LifeLog kept it where it was.", dir.display());
                    kept = true;
                }
            }
        }
        if kept {
            dir = current.clone();
            mode = if dir == local {
                "appdata".into()
            } else if Some(&dir) == lifelog_dir().as_ref() {
                "lifelog".into()
            } else {
                "custom".into()
            };
        }
    }
    if mode == "custom" {
        custom = dir.to_string_lossy().into_owned();
    }
    let f = DataFolder { mode, custom, dir, old, note, local: local.to_path_buf() };
    f.save();
    f
}

impl DataFolder {
    fn write(&self) -> std::io::Result<()> {
        let v = json!({
            "mode": self.mode,
            "custom": self.custom,
            "current": self.dir.to_string_lossy(),
            "old": self.old.as_ref().map(|o| o.to_string_lossy().into_owned()).unwrap_or_default(),
        });
        fs::create_dir_all(&self.local)?;
        fs::write(self.local.join(FILE), v.to_string())
    }

    fn save(&self) {
        let _ = self.write();
        #[cfg(windows)]
        self.register();
    }

    // For the uninstaller, which can't read JSON.
    #[cfg(windows)]
    fn register(&self) {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey("Software\\LifeLog") {
            let _ = key.set_value("DataFolder", &self.dir.to_string_lossy().into_owned());
            let old = self.old.as_ref().map(|o| o.to_string_lossy().into_owned()).unwrap_or_default();
            let _ = key.set_value("DataFolderOld", &old);
        }
    }

    // The choice for the next start. A custom folder inside a profile, or
    // one that is a file, is refused here rather than at the restart.
    // True when it differs from the folder in use, so a restart is due.
    pub fn choose(&mut self, mode: &str, custom: &str) -> Result<bool, String> {
        let dir = target(mode, custom, &self.local).ok_or("That isn't a folder LifeLog can use")?;
        if dir.is_file() {
            return Err("That's a file, not a folder".into());
        }
        if dir.components().any(|c| c.as_os_str() == PROFILE || c.as_os_str() == OLD) {
            return Err("That folder is inside LifeLog's own data. Pick the folder around it".into());
        }
        self.mode = mode.to_owned();
        if mode == "custom" {
            self.custom = dir.to_string_lossy().into_owned();
        }
        self.write().map_err(|e| e.to_string())?;
        Ok(dir != self.dir)
    }

    pub fn remove_old(&mut self) -> Result<(), String> {
        if let Some(o) = self.old.take() {
            let p = o.join(OLD);
            if p.is_dir() {
                fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
            }
            let _ = fs::remove_dir(&o);
        }
        self.save();
        Ok(())
    }

    pub fn describe(&self) -> Value {
        let old = self.old.as_ref().filter(|o| o.join(OLD).is_dir());
        json!({
            "mode": self.mode,
            "dir": self.dir.to_string_lossy(),
            "custom": self.custom,
            "lifelog": lifelog_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
            "appdata": self.local.to_string_lossy(),
            "old": old.map(|o| o.join(OLD).to_string_lossy().into_owned()),
            "note": self.note,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lifelog-df-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn profile(dir: &Path, marker: &str) {
        fs::create_dir_all(dir.join(PROFILE).join("Default/IndexedDB")).unwrap();
        fs::create_dir_all(dir.join(PROFILE).join("Default/Cache")).unwrap();
        fs::write(dir.join(PROFILE).join("Default/IndexedDB/data"), marker).unwrap();
        fs::write(dir.join(PROFILE).join("Default/Cache/big"), "x").unwrap();
        fs::write(dir.join(PROFILE).join("Default/LOCK"), "").unwrap();
    }

    fn choose(local: &Path, mode: &str, custom: &str) {
        let mut f = resolve(local);
        f.choose(mode, custom).unwrap();
    }

    #[test]
    fn moves_to_a_custom_folder_and_keeps_the_old_copy() {
        let root = scratch("move");
        let local = root.join("appdata");
        profile(&local, "mine");
        fs::write(local.join(FILE), r#"{"mode":"appdata"}"#).unwrap();
        let custom = root.join("Custom");
        choose(&local, "custom", custom.to_str().unwrap());
        let f = resolve(&local);
        assert_eq!(f.mode, "custom");
        assert_eq!(f.dir, custom);
        assert_eq!(fs::read_to_string(custom.join(PROFILE).join("Default/IndexedDB/data")).unwrap(), "mine");
        assert!(!custom.join(PROFILE).join("Default/Cache").exists());
        assert!(!custom.join(PROFILE).join("Default/LOCK").exists());
        assert!(!local.join(PROFILE).exists());
        assert!(local.join(OLD).join("Default/IndexedDB/data").exists());
        assert_eq!(f.old.as_deref(), Some(local.as_path()));
        assert!(f.note.is_empty());

        // Back again: the copy goes the other way, and the stale one is gone.
        choose(&local, "appdata", "");
        let f = resolve(&local);
        assert_eq!(f.dir, local);
        assert_eq!(fs::read_to_string(local.join(PROFILE).join("Default/IndexedDB/data")).unwrap(), "mine");
        assert!(custom.join(OLD).exists());
        assert!(!local.join(OLD).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_with_lifelog_data_is_opened_as_it_is() {
        let root = scratch("existing");
        let local = root.join("appdata");
        profile(&local, "here");
        fs::write(local.join(FILE), r#"{"mode":"appdata"}"#).unwrap();
        let other = root.join("Other");
        profile(&other, "there");
        choose(&local, "custom", other.to_str().unwrap());
        let f = resolve(&local);
        assert_eq!(f.dir, other);
        assert_eq!(fs::read_to_string(other.join(PROFILE).join("Default/IndexedDB/data")).unwrap(), "there");
        assert!(local.join(PROFILE).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_it_cannot_make_keeps_the_data_where_it_was() {
        let root = scratch("blocked");
        let local = root.join("appdata");
        profile(&local, "mine");
        fs::write(local.join(FILE), r#"{"mode":"appdata"}"#).unwrap();
        fs::write(root.join("file"), "").unwrap();
        let bad = root.join("file").join("sub");
        fs::write(local.join(FILE), json!({"mode":"custom","custom":bad.to_str().unwrap(),"current":local.to_str().unwrap()}).to_string()).unwrap();
        let f = resolve(&local);
        assert_eq!(f.dir, local);
        assert_eq!(f.mode, "appdata");
        assert!(!f.note.is_empty());
        assert!(local.join(PROFILE).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_a_folder_inside_the_profile() {
        let root = scratch("inside");
        let local = root.join("appdata");
        fs::create_dir_all(&local).unwrap();
        fs::write(local.join(FILE), r#"{"mode":"appdata"}"#).unwrap();
        let mut f = resolve(&local);
        assert!(f.choose("custom", local.join(PROFILE).join("Default").to_str().unwrap()).is_err());
        assert!(f.choose("custom", "relative/path").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn first_start_moves_appdata_beside_the_app() {
        let root = scratch("first");
        let local = root.join("appdata");
        profile(&local, "mine");
        let f = resolve(&local);
        assert_eq!(f.mode, "lifelog");
        let beside = lifelog_dir().unwrap();
        assert_eq!(f.dir, beside);
        assert_eq!(fs::read_to_string(beside.join(PROFILE).join("Default/IndexedDB/data")).unwrap(), "mine");
        assert!(local.join(OLD).exists());
        let _ = fs::remove_dir_all(&beside);
        let _ = fs::remove_dir_all(&root);
    }
}
