// The Windows app is a folder, not an install (2026-11-20): LifeLog.exe
// unzipped anywhere, its data in `data` beside it (src/datafolder.rs).
// Without an installer there's nothing to run an update, so the app updates
// itself:
//
//   - Tauri's updater finds the release and downloads LifeLog.exe, checking
//     its signature with the key built into the app, under its own key in
//     latest.json (TARGET), so a copy still installed by the old setup.exe
//     keeps getting the installer under `windows-x86_64-nsis`;
//   - the new exe is written beside the running one, the running one is
//     renamed aside (Windows allows that, not overwriting it), the new one
//     takes its name, and LifeLog starts again from it;
//   - the next start removes the copy set aside.
//
// A folder LifeLog can't write to (Program Files) answers "readonly" before
// anything downloads; the page then sends you to the download.
//
// What the installer used to do once, done on every start instead: the
// name notifications show under (AUMID), and a refusal to run from inside
// the zip, where Windows unpacks into a temp folder that gets emptied.
#![cfg_attr(not(windows), allow(dead_code))]
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

pub const TARGET: &str = "windows-x86_64-portable";
const ASIDE: &str = ".old";
const INCOMING: &str = ".new";

// This LifeLog.exe, as it was started: once renamed aside, the running
// copy's own path would name the old file.
pub struct Exe(pub PathBuf);

fn beside(exe: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = exe.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

// What the last update left: the old exe (closed by now) and any download
// that never got swapped in.
pub fn tidy(exe: &Path) {
    let (Some(dir), Some(name)) = (exe.parent(), exe.file_name()) else { return };
    let name = name.to_string_lossy().to_lowercase();
    let Ok(list) = fs::read_dir(dir) else { return };
    for e in list.flatten() {
        let f = e.file_name().to_string_lossy().to_lowercase();
        if let Some(rest) = f.strip_prefix(&name) {
            if rest.starts_with(ASIDE) || rest == INCOMING {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

pub fn writable(dir: &Path) -> bool {
    let probe = dir.join(".lifelog-write-test");
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

// Puts `bytes` where `exe` is. Either the new exe ends up there or the old
// one stays, never neither.
pub fn swap(exe: &Path, bytes: &[u8]) -> Result<(), String> {
    let incoming = beside(exe, INCOMING);
    fs::write(&incoming, bytes).map_err(|_| "readonly".to_owned())?;
    let mut old = beside(exe, ASIDE);
    if fs::remove_file(&old).is_err() && old.exists() {
        old = beside(exe, &format!("{ASIDE}-{}", std::process::id()));
    }
    if let Err(e) = fs::rename(exe, &old) {
        let _ = fs::remove_file(&incoming);
        return Err(e.to_string());
    }
    if let Err(e) = fs::rename(&incoming, exe) {
        let _ = fs::rename(&old, exe);
        let _ = fs::remove_file(&incoming);
        return Err(e.to_string());
    }
    Ok(())
}

// Inside %TEMP%: opened straight from the zip.
pub fn in_temp(exe: &Path) -> bool {
    let norm = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase();
    let temp = norm(&std::env::temp_dir());
    !temp.is_empty() && norm(exe).starts_with(&temp)
}

#[cfg(windows)]
pub mod win {
    use super::*;
    use tauri::ipc::Channel;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_updater::UpdaterExt;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn hebrew() -> bool {
        // LANG_HEBREW is 0x0D in the language id's low ten bits.
        unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() & 0x3ff == 0x0d }
    }

    pub fn alert(en: &str, he: &str) {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        let text = wide(if hebrew() { he } else { en });
        let title = wide("LifeLog");
        unsafe {
            let _ = MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | MB_ICONWARNING);
        }
    }

    // Before anything else starts: an exe opened from inside the zip would
    // keep its data in a folder Windows empties.
    pub fn refuse_temp() {
        let Ok(exe) = std::env::current_exe() else { return };
        if in_temp(&exe) {
            alert(
                "LifeLog is running from inside its zip file.\n\nUnzip it first (right-click the zip, Extract All), then open LifeLog.exe from the folder you unzipped it to. Your data is kept in that folder.",
                "LifeLog פועל מתוך קובץ ה-zip.\n\nצריך לחלץ אותו קודם (לחיצה ימנית על הקובץ, חילוץ הכול), ואז לפתוח את LifeLog.exe מהתיקייה שאליה הוא חולץ. הנתונים נשמרים באותה תיקייה.",
            );
            std::process::exit(1);
        }
    }

    // Toasts show under this app id (src/toast.rs). The installer gave it to
    // its Start menu shortcut; without one, Windows reads the name and
    // icon from here.
    pub fn register_app_id(identifier: &str, local: &Path) {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let icon = local.join("toast-icon.png");
        if !icon.exists() {
            let _ = fs::create_dir_all(local);
            let _ = fs::write(&icon, include_bytes!("../icons/128x128.png"));
        }
        let path = format!("Software\\Classes\\AppUserModelId\\{identifier}");
        if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(path) {
            let _ = key.set_value("DisplayName", &"LifeLog");
            let _ = key.set_value("IconUri", &icon.to_string_lossy().into_owned());
        }
    }

    pub async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
        let u = app.updater_builder().target(TARGET).build().map_err(|e| e.to_string())?;
        u.check().await.map_err(|e| e.to_string())
    }

    pub async fn update(app: AppHandle, exe: PathBuf, progress: Channel<f64>) -> Result<bool, String> {
        let dir = exe.parent().ok_or("readonly")?;
        if !writable(dir) {
            return Err("readonly".into());
        }
        let Some(update) = find(&app).await? else { return Ok(false) };
        let mut got = 0u64;
        let bytes = update
            .download(
                |n, total| {
                    got += n as u64;
                    if let Some(t) = total.filter(|t| *t > 0) {
                        let _ = progress.send((got as f64 / t as f64).min(1.0));
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        swap(&exe, &bytes)?;
        let handle = app.clone();
        app.run_on_main_thread(move || {
            // Lets go of the single-instance lock, so the new copy doesn't
            // hand itself over to this one and quit.
            handle.cleanup_before_exit();
            let _ = std::process::Command::new(&exe).spawn();
            std::process::exit(0);
        })
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub fn manage(app: &tauri::App) {
        if let Ok(exe) = std::env::current_exe() {
            tidy(&exe);
            app.manage(Exe(exe));
        }
    }
}

// The version waiting, or None. An error (no network, or a release
// without a portable entry) reads as None to the page.
#[tauri::command]
pub async fn portable_check(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(windows)]
    return Ok(win::find(&app).await?.map(|u| u.version));
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Windows only".into())
    }
}

// Downloads, checks, swaps and restarts; `progress` hears 0 to 1.
// Resolves false when there's nothing to install. Fails with "readonly"
// when the folder can't be written, before downloading.
#[tauri::command]
pub async fn portable_update(app: tauri::AppHandle, exe: tauri::State<'_, Exe>, progress: tauri::ipc::Channel<f64>) -> Result<bool, String> {
    #[cfg(windows)]
    return win::update(app, exe.0.clone(), progress).await;
    #[cfg(not(windows))]
    {
        let _ = (app, exe, progress);
        Err("Windows only".into())
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lifelog-portable-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn swaps_in_the_new_exe_and_sets_the_old_aside() {
        let d = scratch("swap");
        let exe = d.join("LifeLog.exe");
        fs::write(&exe, "old").unwrap();
        swap(&exe, b"new").unwrap();
        assert_eq!(fs::read_to_string(&exe).unwrap(), "new");
        assert_eq!(fs::read_to_string(d.join("LifeLog.exe.old")).unwrap(), "old");
        assert!(!d.join("LifeLog.exe.new").exists());

        // A second update before the old copy was tidied replaces it.
        swap(&exe, b"newer").unwrap();
        assert_eq!(fs::read_to_string(&exe).unwrap(), "newer");
        assert_eq!(fs::read_to_string(d.join("LifeLog.exe.old")).unwrap(), "new");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn tidy_removes_only_what_an_update_left() {
        let d = scratch("tidy");
        let exe = d.join("LifeLog.exe");
        for f in ["LifeLog.exe", "LifeLog.exe.old", "LifeLog.exe.old-42", "LifeLog.exe.new", "LifeLog.exe.notes", "other.old"] {
            fs::write(d.join(f), "").unwrap();
        }
        fs::create_dir_all(d.join("data")).unwrap();
        tidy(&exe);
        let mut left: Vec<String> = fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["LifeLog.exe", "LifeLog.exe.notes", "data", "other.old"]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_missing_exe_keeps_nothing_half_done() {
        let d = scratch("missing");
        let exe = d.join("LifeLog.exe");
        assert!(swap(&exe, b"new").is_err());
        assert!(!d.join("LifeLog.exe.new").exists());
        assert!(!exe.exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn knows_a_copy_run_from_the_temp_folder() {
        assert!(in_temp(&std::env::temp_dir().join("Temp1_LifeLog-portable.zip").join("LifeLog").join("LifeLog.exe")));
        assert!(!in_temp(Path::new("/opt/LifeLog/LifeLog.exe")));
    }

    #[test]
    fn writable_says_so() {
        let d = scratch("writable");
        assert!(writable(&d));
        assert!(!writable(&d.join("no-such-folder")));
        let _ = fs::remove_dir_all(&d);
    }
}
