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

/// OS-level whole-window alpha — matches PyQt6 setWindowOpacity from v1.5.x.
/// At alpha 1.0 the layered-window bit is removed so Mica vibrancy can paint
/// through; at any lower value the window becomes a layered window so the
/// entire surface (Mica included) fades together.
#[tauri::command]
pub async fn set_window_opacity(window: tauri::Window, value: f64) -> Result<(), String> {
    let clamped = value.clamp(0.10_f64, 1.0_f64);
    let alpha = (clamped * 255.0).round() as u8;
    #[cfg(target_os = "windows")]
    {
        apply_opacity_win(&window, alpha, clamped >= 0.999).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, alpha);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_opacity_win(window: &tauri::Window, alpha: u8, fully_opaque: bool) -> windows::core::Result<()> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW,
        GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED,
    };

    let hwnd = window.hwnd().expect("main window has an HWND");
    let layered_bit = WS_EX_LAYERED.0 as isize;
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if fully_opaque {
            // Strip the layered bit so DWM Mica/Acrylic resumes painting.
            if ex_style & layered_bit != 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style & !layered_bit);
            }
        } else {
            if ex_style & layered_bit == 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | layered_bit);
            }
            SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn run_migration() -> Result<bool, String> {
    crate::migration::run_once_invoked().map_err(|e| e.to_string())
}
