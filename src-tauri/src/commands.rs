use crate::jsonl_aggregator;
use crate::usage_api;

#[tauri::command]
pub async fn fetch_usage() -> Result<usage_api::UsageOutput, String> {
    usage_api::fetch_usage().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credentials_mtime() -> Option<f64> {
    usage_api::credentials_mtime_ms()
}

#[tauri::command]
pub async fn aggregate_detail() -> Result<jsonl_aggregator::AggregateOut, String> {
    match tauri::async_runtime::spawn_blocking(jsonl_aggregator::aggregate).await {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn set_always_on_top(window: tauri::Window, value: bool) -> Result<(), String> {
    window.set_always_on_top(value).map_err(|e| e.to_string())?;
    // When pinned on top, also hide from taskbar / Alt-Tab — matches the
    // v1.5.x behavior users expect from a "stay out of the way" widget.
    window.set_skip_taskbar(value).map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle the Mica/Acrylic backdrop at runtime. The frontend calls this from
/// `setOpacity` so that the backdrop only paints when the slider is at 0% —
/// otherwise the system-painted Mica wash masks the CSS-driven panel fade
/// (the 23222cf "5x retry" trail diagnosed the wrong layer for this reason).
#[tauri::command]
pub async fn set_mica_enabled(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            crate::vibrancy_win::apply_mica(&window)?;
        } else {
            crate::vibrancy_win::clear_vibrancy(&window)?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled);
    }
    Ok(())
}

/// Re-render the tray + main-window icon to reflect the current 5-hour
/// session usage. Called from the frontend after every successful
/// `fetch_usage`. Threshold colors match the in-app CapsuleProgress tokens
/// (accent / warning / danger).
#[tauri::command]
pub async fn set_usage_icon(
    app: tauri::AppHandle,
    pct: f64,
    alpha: Option<f32>,
) -> Result<(), String> {
    let alpha = alpha.unwrap_or(1.0);
    let (rgba, w, h) = crate::icon_render::render_gauge_rgba(pct, alpha);
    // 트레이만 동적 갱신. 작업표시줄 item icon = .exe icon 정적
    // (사용자 정책: "작업표시줄 = 윈도우 icon ≠ 시스템 트레이").
    let img_tray = tauri::image::Image::new_owned(rgba, w, h);
    if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
        tray.set_icon(Some(img_tray)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 위젯을 트레이로 hide. FooterBar X 버튼이 frontend
/// `getCurrentWindow().hide()` 로 안 되는 신고가 있어 backend 우회.
/// 다른 command 들과 동일한 invoke 패턴으로 안정성 ↑.
#[tauri::command]
pub async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Apply a mode-specific window size + minimum size in one shot. Order
/// matters: `set_min_size` first so the subsequent `set_size` isn't clamped
/// by the *previous* mode's minimum.
#[tauri::command]
pub async fn set_window_size(
    window: tauri::Window,
    width: u32,
    height: u32,
    min_width: u32,
    min_height: u32,
) -> Result<(), String> {
    use tauri::LogicalSize;
    window
        .set_min_size(Some(LogicalSize::new(min_width, min_height)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_migration() -> Result<bool, String> {
    crate::migration::run_once_invoked().map_err(|e| e.to_string())
}

/// Open the OS file explorer at the app's log directory. Used by the
/// "Open logs folder" button in Settings so users can attach `widget.log`
/// to a bug report without hunting through %LOCALAPPDATA%.
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?;
    // Make sure it exists — first call before any log line is written would
    // otherwise hand explorer an invalid path.
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
