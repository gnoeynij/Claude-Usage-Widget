use crate::jsonl_aggregator;
use crate::usage_api;

#[tauri::command]
pub async fn fetch_usage() -> Result<usage_api::UsageOutput, String> {
    usage_api::fetch_usage().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_plan() -> usage_api::PlanOutput {
    usage_api::read_plan()
}

/// Cloud-synced folder roots detected on this machine (Settings picker).
#[tauri::command]
pub fn detect_sync_folders() -> Vec<String> {
    crate::device_sync::detect_folders()
}

/// Write this device's lifetime cost + daily history into the shared folder
/// and return the combined totals across all devices found there.
#[tauri::command]
pub fn sync_device_cost(
    folder: String,
    device_id: String,
    cost: f64,
    daily: crate::device_sync::DailyMap,
) -> Result<crate::device_sync::CombinedOut, String> {
    crate::device_sync::sync(&folder, &device_id, cost, daily).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credentials_mtime() -> Option<f64> {
    usage_api::credentials_mtime_ms()
}

/// Open (or focus) the standalone guide window. `lang`/`dark` are passed from
/// the widget so the guide matches the current theme/language; the frontend
/// renders `<GuideApp>` when the URL carries `?guide`.
#[tauri::command]
pub async fn open_guide_window(app: tauri::AppHandle, lang: String, dark: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("guide") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = format!("index.html?guide&lang={lang}&dark={}", if dark { 1 } else { 0 });
    let window = tauri::WebviewWindowBuilder::new(&app, "guide", tauri::WebviewUrl::App(url.into()))
        .title("Claude Usage Widget — Guide")
        .inner_size(1180.0, 920.0)
        .min_inner_size(1100.0, 760.0)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    // Frameless glass to match the widget (Mica on Win11; rounds the corners).
    #[cfg(target_os = "windows")]
    {
        let _ = crate::vibrancy_win::apply_mica(&window);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = crate::vibrancy_mac::apply_mica(&window);
    }
    let _ = &window;
    Ok(())
}

#[tauri::command]
pub async fn aggregate_detail(counted_until_ms: f64) -> Result<jsonl_aggregator::AggregateOut, String> {
    match tauri::async_runtime::spawn_blocking(move || jsonl_aggregator::aggregate(counted_until_ms)).await {
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
    #[cfg(target_os = "macos")]
    {
        if enabled {
            crate::vibrancy_mac::apply_mica(&window)?;
        } else {
            crate::vibrancy_mac::clear_vibrancy(&window)?;
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = (window, enabled);
    }
    Ok(())
}

/// trayicon 을 정상(ok) 또는 비정상(err) 상태로 전환. frontend 가 sync 결과·
/// TOKEN_EXPIRED·네트워크 실패 시 호출.
#[tauri::command]
pub fn set_tray_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let s = match state.as_str() {
        "err" => crate::tray::TrayState::Err,
        _ => crate::tray::TrayState::Ok,
    };
    crate::tray::set_tray_state(&app, s);
    Ok(())
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
    always_on_top: bool,
) -> Result<(), String> {
    use tauri::LogicalSize;
    window
        .set_min_size(Some(LogicalSize::new(min_width, min_height)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    // Windows drops WS_EX_TOPMOST when a window is resized via SetWindowPos, so
    // re-assert always-on-top right here — same command, so there's no IPC race
    // with a separate set_always_on_top call. This keeps AOT through every
    // resize path (boot, mode switch, macOS compositor nudge) without a
    // standalone re-assert.
    if always_on_top {
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}
