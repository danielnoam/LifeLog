// Windows toasts LifeLog builds itself, rather than the notification
// plugin's. The plugin's only report a click while the toast is on screen;
// once it has gone to the Action Center, or LifeLog was quit, a click did
// nothing. These open a lifelog://toast/ link instead, which Windows hands to
// LifeLog.exe whether or not it's running: a second launch is passed on to
// the running copy by the single-instance plugin, a first one reads it from
// its own arguments.
//
// The link carries a key made once on this computer, so a web page that
// opens lifelog://toast/... can't tick a habit: only a toast LifeLog showed
// knows it.
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

const PREFIX: &str = "lifelog://toast/";

static KEY: OnceLock<String> = OnceLock::new();

// Done on a habit reminder: done without bringing the window up.
pub fn is_quiet(action: &str) -> bool {
    action.starts_with("done-")
}

// The key, read from `dir` or made there the first time.
pub fn init(dir: &Path) {
    let file = dir.join("toast-key");
    let key = fs::read_to_string(&file)
        .ok()
        .map(|k| k.trim().to_owned())
        .filter(|k| k.len() == 32 && k.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_else(|| {
            let k = new_key();
            let _ = fs::create_dir_all(dir);
            let _ = fs::write(&file, &k);
            k
        });
    let _ = KEY.set(key);
    #[cfg(windows)]
    register_scheme();
}

// 128 bits from the system: each RandomState is seeded from it.
fn new_key() -> String {
    use std::hash::{BuildHasher, Hasher};
    let half = || {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.finish()
    };
    format!("{:016x}{:016x}", half(), half())
}

pub fn link(key: &str, action: &str) -> String {
    let mut s = String::from(PREFIX);
    s.push_str(key);
    s.push('/');
    for b in action.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.:".contains(&b) {
            s.push(b as char);
        } else {
            s.push_str(&format!("%{:02X}", b));
        }
    }
    s
}

// The action a launch was asked for: Some("") for a toast that only opens
// LifeLog, None when no argument is a link carrying `key`.
pub fn action_in<S: AsRef<str>>(args: &[S], key: &str) -> Option<String> {
    args.iter().find_map(|a| {
        let rest = a.as_ref().strip_prefix(PREFIX)?;
        let (k, action) = rest.split_once('/')?;
        if k.is_empty() || k != key {
            return None;
        }
        decode(action.trim_end_matches('/'))
    })
}

pub fn launch_action<S: AsRef<str>>(args: &[S]) -> Option<String> {
    action_in(args, KEY.get()?)
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

// The toast's XML: a click opens `action`, each button its own.
pub fn toast_xml(key: &str, title: &str, body: &str, action: &str, buttons: &[(String, String)]) -> String {
    let mut x = format!(
        "<toast activationType=\"protocol\" launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text>",
        xml(&link(key, action)),
        xml(title)
    );
    if !body.is_empty() {
        x.push_str(&format!("<text>{}</text>", xml(body)));
    }
    x.push_str("</binding></visual>");
    if !buttons.is_empty() {
        x.push_str("<actions>");
        for (label, act) in buttons {
            x.push_str(&format!(
                "<action content=\"{}\" activationType=\"protocol\" arguments=\"{}\"/>",
                xml(label),
                xml(&link(key, act))
            ));
        }
        x.push_str("</actions>");
    }
    x.push_str("</toast>");
    x
}

#[cfg(windows)]
mod win {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    const GROUP: &str = "lifelog";

    // The installer gives the Start menu shortcut this app id, which is what
    // lets a toast show under LifeLog's name and icon. A copy run from
    // target\ has no shortcut, so it borrows PowerShell's, as the
    // notification plugin does.
    fn app_id(identifier: &str) -> String {
        let dev = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.to_string_lossy().to_lowercase()))
            .is_some_and(|d| d.ends_with("\\target\\debug") || d.ends_with("\\target\\release"));
        if dev {
            "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe".to_owned()
        } else {
            identifier.to_owned()
        }
    }

    pub fn show(identifier: &str, tag: &str, xml: &str) -> windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        toast.SetTag(&HSTRING::from(tag))?;
        toast.SetGroup(&HSTRING::from(GROUP))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id(identifier)))?.Show(&toast)
    }

    pub fn clear(identifier: &str, tag: &str) -> windows::core::Result<()> {
        ToastNotificationManager::History()?.RemoveGroupedTagWithId(
            &HSTRING::from(tag),
            &HSTRING::from(GROUP),
            &HSTRING::from(app_id(identifier)),
        )
    }
}

// lifelog:// opens this LifeLog.exe, for this Windows user only. Written on
// every start, so it follows the app if it moves; nothing is written when
// it's already right.
#[cfg(windows)]
fn register_scheme() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(exe) = std::env::current_exe() else { return };
    let command = format!("\"{}\" \"%1\"", exe.display());
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = "Software\\Classes\\lifelog";
    let current: Option<String> = hkcu
        .open_subkey(format!("{path}\\shell\\open\\command"))
        .and_then(|k| k.get_value(""))
        .ok();
    if current.as_deref() == Some(command.as_str()) {
        return;
    }
    if let Ok((root, _)) = hkcu.create_subkey(path) {
        let _ = root.set_value("", &"URL:LifeLog");
        let _ = root.set_value("URL Protocol", &"");
    }
    if let Ok((cmd, _)) = hkcu.create_subkey(format!("{path}\\shell\\open\\command")) {
        let _ = cmd.set_value("", &command);
    }
}

// The page asks for a toast (src/desktop.js). Anywhere but Windows this
// fails, and the page uses the notification plugin instead.
#[tauri::command]
pub fn toast(
    app: tauri::AppHandle,
    tag: String,
    title: String,
    body: String,
    action: String,
    buttons: Vec<(String, String)>,
) -> Result<(), String> {
    let key = KEY.get().ok_or("no key")?;
    let xml = toast_xml(key, &title, &body, &action, &buttons);
    #[cfg(windows)]
    {
        let id = app.config().identifier.clone();
        // Off the main thread, as the plugin does: Show can take a moment.
        std::thread::spawn(move || {
            let _ = win::show(&id, &tag, &xml);
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, tag, xml);
        Err("not Windows".into())
    }
}

// A habit reminder whose habit has since been kept leaves the Action Center.
#[tauri::command]
pub fn clear_toast(app: tauri::AppHandle, tag: String) {
    #[cfg(windows)]
    {
        let id = app.config().identifier.clone();
        std::thread::spawn(move || {
            let _ = win::clear(&id, &tag);
        });
    }
    #[cfg(not(windows))]
    let _ = (app, tag);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_round_trips_its_action() {
        let key = "0123456789abcdef0123456789abcdef";
        for action in ["open-habit:h1", "add-expense?amount=12.5&note=Caf\u{e9} au lait", "", "open-invest:BRK.B"] {
            let l = link(key, action);
            assert!(!l.contains(' ') && !l.contains('&'));
            assert_eq!(action_in(&["LifeLog.exe".to_owned(), l], key).as_deref(), Some(action));
        }
    }

    #[test]
    fn a_link_without_this_computers_key_is_ignored() {
        let key = "0123456789abcdef0123456789abcdef";
        let other = link("ffffffffffffffffffffffffffffffff", "done-habit:h1");
        assert_eq!(action_in(&[other], key), None);
        assert_eq!(action_in(&["lifelog://toast//done-habit:h1"], key), None);
        assert_eq!(action_in(&["lifelog://toast/done-habit:h1"], key), None);
        assert_eq!(action_in(&["--hidden"], key), None);
        assert_eq!(action_in(&[format!("lifelog://toast/{key}/bad%zz")], key), None);
    }

    #[test]
    fn the_xml_escapes_what_it_is_given() {
        let x = toast_xml("k", "Tom & <Jerry>", "\"5\"", "open-habit:a", &[("Done".into(), "done-habit:a".into())]);
        assert!(x.contains("<text>Tom &amp; &lt;Jerry&gt;</text>"));
        assert!(x.contains("<text>&quot;5&quot;</text>"));
        assert!(x.contains("launch=\"lifelog://toast/k/open-habit:a\""));
        assert!(x.contains("<action content=\"Done\" activationType=\"protocol\" arguments=\"lifelog://toast/k/done-habit:a\"/>"));
        assert!(!toast_xml("k", "t", "", "", &[]).contains("<actions>"));
    }

    #[test]
    fn a_new_key_is_32_hex_and_not_repeated() {
        let (a, b) = (new_key(), new_key());
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
