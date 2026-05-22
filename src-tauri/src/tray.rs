use std::io::Cursor;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Emitter, Manager};

pub const TRAY_ID: &str = "main-tray";

// 트레이 전용 PNG. bundle.icon[0] (32x32.png) 은 가로:세로 1.56:1
// 직사각형 디자인이라 정사각형 트레이 슬롯에 fit 시 세로가 59%만
// 차지해 다른 시스템 트레이 아이콘들 대비 작아 보였다. 이 PNG 는
// alpha bbox(940x602) 만 잘라 minimal padding 으로 재배치한 것.
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray.png");

fn load_tray_icon() -> Image<'static> {
    let img = image::ImageReader::new(Cursor::new(TRAY_ICON_PNG))
        .with_guessed_format()
        .expect("in-memory cursor never errors")
        .decode()
        .expect("embedded tray.png must decode")
        .to_rgba8();
    let (w, h) = img.dimensions();
    Image::new_owned(img.into_raw(), w, h)
}

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

    let icon = load_tray_icon();
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
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            // Left click (mouse-up) toggles. DoubleClick 도 같이 fire 되지만
            // 한 번의 single click 으로 toggle 충분. 사용자 신고: "X 로
            // hide 한 후 다시 못 부름" — 트레이 좌클릭 미구현이 원인.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
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
