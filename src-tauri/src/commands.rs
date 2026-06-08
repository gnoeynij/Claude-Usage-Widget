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

#[tauri::command]
pub fn credentials_mtime() -> Option<f64> {
    usage_api::credentials_mtime_ms()
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
