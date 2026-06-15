use std::io::Cursor;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager};

pub const TRAY_ID: &str = "main-tray";

// 32x32 PNG 두 상태 — Tauri 2 Image API 가 single-resolution 만 받으므로
// (multi-size ICO 의 OS 자동 픽 미지원), 32x32 가 100% DPI 16x16 트레이엔
// 2x down-scale (깨끗), 200% DPI 32x32 트레이엔 1:1, 300% DPI 48x48 엔
// 1.5x up-scale (acceptable). 기존 940x940 → 16 (58x) 대비 큰 개선.
// dot 합성은 scripts/make-tray-icons.py 가 처리.
const TRAY_OK_PNG: &[u8] = include_bytes!("../icons/tray-ok-32.png");
const TRAY_ERR_PNG: &[u8] = include_bytes!("../icons/tray-err-32.png");

#[derive(Clone, Copy)]
pub enum TrayState {
    Ok,
    Err,
}

fn load_png(bytes: &'static [u8]) -> Image<'static> {
    let img = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .expect("in-memory cursor never errors")
        .decode()
        .expect("embedded tray PNG must decode")
        .to_rgba8();
    let (w, h) = img.dimensions();
    Image::new_owned(img.into_raw(), w, h)
}

fn icon_for(state: TrayState) -> Image<'static> {
    let bytes = match state {
        TrayState::Ok => TRAY_OK_PNG,
        TrayState::Err => TRAY_ERR_PNG,
    };
    load_png(bytes)
}

pub fn set_tray_state(app: &AppHandle, state: TrayState) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(icon_for(state)));
    }
}

struct TrayLabels {
    show: &'static str,
    mode_mini: &'static str,
    mode_normal: &'static str,
    mode_detail: &'static str,
    sync: &'static str,
    quit: &'static str,
}

fn tray_labels(lang: &str) -> TrayLabels {
    match lang {
        "ko" => TrayLabels {
            show: "표시 / 숨김",
            mode_mini: "Mini 모드",
            mode_normal: "Normal 모드",
            mode_detail: "Detail 모드",
            sync: "지금 동기화",
            quit: "종료",
        },
        _ => TrayLabels {
            show: "Show / Hide",
            mode_mini: "Mini mode",
            mode_normal: "Normal mode",
            mode_detail: "Detail mode",
            sync: "Sync now",
            quit: "Quit",
        },
    }
}

pub fn setup(app: &mut App, lang: &str) -> tauri::Result<()> {
    let labels = tray_labels(lang);
    let show = MenuItem::with_id(app, "show", labels.show, true, None::<&str>)?;
    let mode_mini = MenuItem::with_id(app, "mode_mini", labels.mode_mini, true, None::<&str>)?;
    let mode_normal =
        MenuItem::with_id(app, "mode_normal", labels.mode_normal, true, None::<&str>)?;
    let mode_detail =
        MenuItem::with_id(app, "mode_detail", labels.mode_detail, true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", labels.sync, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &mode_mini, &mode_normal, &mode_detail, &sync, &quit],
    )?;

    let icon = icon_for(TrayState::Ok);
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
            // Left click (mouse-up) toggles. 사용자 신고: "X 로 hide 한 후 다시
            // 못 부름" — 트레이 좌클릭 토글로 해결. 단 더블클릭 시 OS 가
            // Click(Up) 을 *두 번* fire 해 toggle 이 2회 → 표시 상태에선 깜빡임,
            // 숨김 상태에선 다시 못 부름. 300ms 내 두 번째 Click(Up) 은 디바운스.
            static LAST_TOGGLE_MS: std::sync::atomic::AtomicU64 =
                std::sync::atomic::AtomicU64::new(0);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let last = LAST_TOGGLE_MS.load(std::sync::atomic::Ordering::Relaxed);
                if now.saturating_sub(last) < 300 {
                    return;
                }
                LAST_TOGGLE_MS.store(now, std::sync::atomic::Ordering::Relaxed);
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
