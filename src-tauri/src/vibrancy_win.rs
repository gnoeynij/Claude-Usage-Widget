use tauri::WebviewWindow;
use window_vibrancy::{
    apply_acrylic, apply_mica as vibrancy_apply_mica, clear_acrylic, clear_mica,
};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};

/// Try Windows 11 Mica first, fall back to Acrylic on Windows 10.
/// Also asks DWM to round the OS window corners so the four corner squares
/// behind our CSS-rounded panel disappear.
pub fn apply_mica(window: &WebviewWindow) -> Result<(), String> {
    vibrancy_apply_mica(window, Some(false))
        .or_else(|_| apply_acrylic(window, Some((18, 18, 18, 125))))
        .map_err(|e| e.to_string())?;
    apply_rounded_corners(window);
    Ok(())
}

/// Drop the vibrancy backdrop so the WebView2 transparent root is what the
/// user sees through the .glass-panel fill. Needed when the opacity slider
/// moves off 0% — otherwise Mica paints the panel area opaque-ish and the
/// CSS-driven fade has no visible effect on bright desktops (23222cf retro).
pub fn clear_vibrancy(window: &WebviewWindow) -> Result<(), String> {
    // Both clear calls are no-ops if the corresponding effect wasn't applied,
    // so calling both is safe and handles the Mica + Acrylic fallback paths.
    let _ = clear_mica(window);
    let _ = clear_acrylic(window);
    apply_rounded_corners(window);
    Ok(())
}

fn apply_rounded_corners(window: &WebviewWindow) {
    // DWMWA_WINDOW_CORNER_PREFERENCE is Win11 22000+ only; older builds will
    // silently fail (HRESULT < 0) — we ignore the result either way.
    if let Ok(hwnd) = window.hwnd() {
        let pref: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const _ as _,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            );
        }
    }
}
