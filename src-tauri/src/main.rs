// LifeLog on Windows and Linux: the same files as the web app and the phone
// apps (tools/build-www.js), in the system's own WebView. Everything the app
// does lives in src/; this only opens the window, keeps one copy running,
// and owns the tray, which is what lets reminders ring with the window shut.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

mod datafolder;
mod oauth;
mod portable;
mod toast;

// Start at login (Settings → Notifications) launches with this, straight
// into the tray.
const HIDDEN_ARG: &str = "--hidden";

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// The tray's Add entry / Add expense and a clicked notification: the app's own runAction, through
// src/desktop.js, the same actions the phone's shortcuts send.
fn act(app: &AppHandle, action: &str) {
    show(app);
    let _ = app.emit("lifelog-action", action);
}

// Settings → Desktop (src/desktop.js tells these on start).
// Closing the window: hide to the tray (the default) or quit.
struct CloseToTray(AtomicBool);
// Opened by Start at login, so the page can decide whether to show itself.
struct LaunchedHidden(bool);

#[tauri::command]
fn set_close_to_tray(on: bool, state: State<CloseToTray>) {
    state.0.store(on, Ordering::Relaxed);
}

#[tauri::command]
fn launched_hidden(state: State<LaunchedHidden>) -> bool {
    state.0
}

#[tauri::command]
fn show_main(app: AppHandle) {
    show(&app);
}

// Settings → Desktop's Data folder (src/datafolder.rs). Windows only: on
// Linux this is None and the WebView keeps its own default.
struct Folder(Mutex<Option<datafolder::DataFolder>>);

#[tauri::command]
fn data_folder(state: State<Folder>) -> serde_json::Value {
    state.0.lock().ok().and_then(|f| f.as_ref().map(|f| f.describe())).unwrap_or(serde_json::Value::Null)
}

// The page restarts the app when this says the folder changed.
#[tauri::command]
fn choose_data_folder(mode: String, custom: String, state: State<Folder>) -> Result<bool, String> {
    let mut f = state.0.lock().map_err(|e| e.to_string())?;
    f.as_mut().ok_or("Not on this computer")?.choose(&mode, &custom)
}

#[tauri::command]
fn open_data_folder(app: AppHandle, state: State<Folder>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = state.0.lock().ok().and_then(|f| f.as_ref().map(|f| f.dir.clone())).ok_or("Not on this computer")?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_old_data_copy(state: State<Folder>) -> Result<(), String> {
    let mut f = state.0.lock().map_err(|e| e.to_string())?;
    f.as_mut().ok_or("Not on this computer")?.remove_old()
}

// The pinned window (src/pin.js): the same window, small and on top of
// everything, then back to where and how big it was. The pinned size and
// place are kept too, so pinning again lands where it was left.
#[derive(Default)]
struct PinState {
    was: Option<(PhysicalPosition<i32>, PhysicalSize<u32>, bool)>,
    pinned: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
}
struct Pin(Mutex<PinState>);

#[tauri::command]
fn pin_window(on: bool, app: AppHandle, state: State<Pin>) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("No window")?;
    let mut p = state.0.lock().map_err(|e| e.to_string())?;
    let e = |e: tauri::Error| e.to_string();
    if on {
        if p.was.is_none() {
            p.was = Some((w.outer_position().map_err(e)?, w.outer_size().map_err(e)?, w.is_maximized().map_err(e)?));
        }
        w.unmaximize().map_err(e)?;
        w.set_min_size(Some(LogicalSize::new(320.0, 420.0))).map_err(e)?;
        match p.pinned {
            Some((pos, size)) => {
                w.set_size(size).map_err(e)?;
                w.set_position(pos).map_err(e)?;
            }
            None => {
                w.set_size(LogicalSize::new(380.0, 620.0)).map_err(e)?;
                // Top right of the screen it's on, clear of the edge.
                if let Some(m) = w.current_monitor().map_err(e)? {
                    let scale = m.scale_factor();
                    let x = m.position().x + m.size().width as i32 - (404.0 * scale) as i32;
                    let y = m.position().y + (24.0 * scale) as i32;
                    w.set_position(PhysicalPosition::new(x, y)).map_err(e)?;
                }
            }
        }
        w.set_always_on_top(true).map_err(e)?;
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        p.pinned = Some((w.outer_position().map_err(e)?, w.outer_size().map_err(e)?));
        w.set_always_on_top(false).map_err(e)?;
        w.set_min_size(Some(LogicalSize::new(360.0, 560.0))).map_err(e)?;
        if let Some((pos, size, max)) = p.was.take() {
            w.set_size(size).map_err(e)?;
            w.set_position(pos).map_err(e)?;
            if max {
                w.maximize().map_err(e)?;
            }
        }
    }
    Ok(())
}

// Google Drive's sign-in (src/oauth.rs): a port on 127.0.0.1 to come back
// to, then the one answer that comes there.
#[tauri::command]
fn oauth_listen(state: State<oauth::Loopback>) -> Result<u16, String> {
    oauth::listen(&state)
}

#[tauri::command]
async fn oauth_wait(state: State<'_, oauth::Loopback>) -> Result<String, String> {
    let l = oauth::take(&state)?;
    tauri::async_runtime::spawn_blocking(move || oauth::wait(l)).await.map_err(|e| e.to_string())?
}

// A Windows toast clicked while LifeLog wasn't running (src/toast.rs): the
// page asks for it once it's ready.
struct LaunchAction(Mutex<Option<String>>);

#[tauri::command]
fn take_launch_action(state: State<LaunchAction>) -> Option<String> {
    state.0.lock().ok().and_then(|mut a| a.take())
}

// A toast's link, passed on by a second launch: Done stays in the tray,
// the rest open where they point.
fn toast_clicked(app: &AppHandle, action: &str) {
    if action.is_empty() {
        show(app);
    } else if toast::is_quiet(action) {
        let _ = app.emit("lifelog-action", action);
    } else {
        act(app, action);
    }
}

fn main() {
    #[cfg(windows)]
    portable::win::refuse_temp();
    tauri::Builder::default()
        // First, so a second launch (a click on the Start menu entry while it
        // sits in the tray) brings the running one back instead of opening a
        // second copy that would sync against the first.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| match toast::launch_action(&args) {
            Some(a) => toast_clicked(app, &a),
            None => show(app),
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CloseToTray(AtomicBool::new(true)))
        .manage(Pin(Mutex::new(PinState::default())))
        .manage(oauth::Loopback(Mutex::new(None)))
        .manage(LaunchedHidden(std::env::args().any(|a| a == HIDDEN_ARG)))
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            launched_hidden,
            show_main,
            pin_window,
            take_launch_action,
            toast::toast,
            toast::clear_toast,
            data_folder,
            choose_data_folder,
            open_data_folder,
            remove_old_data_copy,
            oauth_listen,
            oauth_wait,
            portable::portable_check,
            portable::portable_update
        ])
        .setup(|app| {
            let local = app.path().app_local_data_dir()?;
            toast::init(&local);
            #[cfg(windows)]
            {
                portable::win::register_app_id(&app.config().identifier, &local);
                portable::win::manage(app);
            }

            // The window is made here rather than from tauri.conf.json, so
            // its data folder can be chosen first.
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?;
            #[cfg(windows)]
            let window = {
                let f = datafolder::resolve(&local);
                let w = window.data_directory(f.dir.clone());
                app.manage(Folder(Mutex::new(Some(f))));
                w
            };
            #[cfg(not(windows))]
            app.manage(Folder(Mutex::new(None)));
            // WebView2 comes with Windows 10 and 11, but a stripped-down
            // copy can lack it, and with no installer to fetch it this is
            // the only place to say so.
            if let Err(e) = window.build() {
                #[cfg(windows)]
                portable::win::alert(
                    &format!("LifeLog couldn't open its window: {e}\n\nIt needs Microsoft Edge WebView2. Get it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and open LifeLog again."),
                    &format!("LifeLog לא הצליח לפתוח את החלון שלו: {e}\n\nהוא צריך את Microsoft Edge WebView2. אפשר להוריד אותו מ-https://go.microsoft.com/fwlink/p/?LinkId=2124703 ולפתוח את LifeLog שוב."),
                );
                return Err(e.into());
            }

            let args: Vec<String> = std::env::args().collect();
            let launch = toast::launch_action(&args);
            let quiet = launch.as_deref().is_some_and(toast::is_quiet);
            app.manage(LaunchAction(Mutex::new(launch.filter(|a| !a.is_empty()))));

            // A click on a reminder or a heads-up opens the window where it
            // points (the habit, the Ledger, Upcoming): src/desktop.js puts
            // the app's action in the notification's `extra`. On Windows
            // src/toast.rs shows them instead, so a click from the Action
            // Center works too; this is Linux, and Windows' fallback.
            let handle = app.handle().clone();
            app.notification().on_action(move |performed| {
                if performed.action_id() != "tap" {
                    return;
                }
                let action = performed
                    .notification()
                    .and_then(|n| n.extra().get("action"))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);
                match action {
                    Some(a) => act(&handle, &a),
                    None => show(&handle),
                }
            })?;

            let open = MenuItem::with_id(app, "open", "Open LifeLog", true, None::<&str>)?;
            let entry = MenuItem::with_id(app, "add-entry", "Add entry", true, None::<&str>)?;
            let expense = MenuItem::with_id(app, "add-expense", "Add expense", true, None::<&str>)?;
            let pin = MenuItem::with_id(app, "pin", "Pin on top", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &entry, &expense, &pin, &sep, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("LifeLog")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    id => act(app, id),
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if !quiet && !args.iter().any(|a| a == HIDDEN_ARG) {
                show(app.handle());
            }
            Ok(())
        })
        // Closing the window hides it: the app keeps running in the tray, so
        // a habit reminder or a charge heads-up still rings. Quit is in the
        // tray's menu. Settings → Desktop can make closing quit instead.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("LifeLog failed to start");
}
