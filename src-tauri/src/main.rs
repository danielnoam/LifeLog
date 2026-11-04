// LifeLog on Windows and Linux: the same files as the web app and the phone
// apps (tools/build-www.js), in the system's own WebView. Everything the app
// does lives in src/; this only opens the window, keeps one copy running,
// and owns the tray, which is what lets reminders ring with the window shut.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

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

// The tray's Add entry / Add expense: the app's own runAction, through
// src/desktop.js, the same actions the phone's shortcuts send.
fn act(app: &AppHandle, action: &str) {
    show(app);
    let _ = app.emit("lifelog-action", action);
}

fn main() {
    tauri::Builder::default()
        // First, so a second launch (a click on the Start menu entry while it
        // sits in the tray) brings the running one back instead of opening a
        // second copy that would sync against the first.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
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
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open LifeLog", true, None::<&str>)?;
            let entry = MenuItem::with_id(app, "add-entry", "Add entry", true, None::<&str>)?;
            let expense = MenuItem::with_id(app, "add-expense", "Add expense", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &entry, &expense, &sep, &quit])?;
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

            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                show(app.handle());
            }
            Ok(())
        })
        // Closing the window hides it: the app keeps running in the tray, so
        // a habit reminder or a charge heads-up still rings. Quit is in the
        // tray's menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("LifeLog failed to start");
}
