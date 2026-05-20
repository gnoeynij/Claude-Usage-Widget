use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Emitter, Manager};

pub const TRAY_ID: &str = "main-tray";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let mode_mini = MenuItem::with_id(app, "mode_mini", "Mini mode", true, None::<&str>)?;
    let mode_normal =
        MenuItem::with_id(app, "mode_normal", "Normal mode", true, None::<&str>)?;
    let mode_detail =
        MenuItem::with_id(app, "mode_detail", "Detail mode", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &mode_mini, &mode_normal, &mode_detail, &sync, &quit],
    )?;

    let icon = app
        .default_window_icon()
        .expect("default window icon missing")
        .clone();
    let _ = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_window(app),
            "mode_mini" => {
                let _ = app.emit("tray://mode", "mini");
            }
            "mode_normal" => {
                let _ = app.emit("tray://mode", "normal");
            }
            "mode_detail" => {
                let _ = app.emit("tray://mode", "detail");
            }
            "sync" => {
                let _ = app.emit("tray://sync", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::TrayIconEvent;
            if let TrayIconEvent::DoubleClick { .. } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}
