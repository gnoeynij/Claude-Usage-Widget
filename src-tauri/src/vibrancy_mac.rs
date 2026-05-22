use objc2::msg_send;
use objc2::runtime::AnyObject;
use tauri::WebviewWindow;
use window_vibrancy::{
    apply_vibrancy, clear_vibrancy as wv_clear_vibrancy, NSVisualEffectMaterial,
    NSVisualEffectState,
};

/// HudWindow material — a frosted, slightly darker blur that reads well on
/// both light and dark desktops and matches the Liquid Glass look the panel
/// is designed around. `Active` keeps the effect alive even when the widget
/// loses focus (it's a floating utility, not the foreground app).
pub fn apply_mica(window: &WebviewWindow) -> Result<(), String> {
    apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        None,
    )
    .map_err(|e| e.to_string())?;
    apply_rounded_corners(window);
    Ok(())
}

/// Drop the NSVisualEffectView so the WebView's transparent root is what the
/// user sees through the .glass-panel fill — needed when the opacity slider
/// moves off 0% so the CSS-driven fade isn't masked by the OS blur.
pub fn clear_vibrancy(window: &WebviewWindow) -> Result<(), String> {
    wv_clear_vibrancy(window)
        .map(|_| ())
        .map_err(|e| e.to_string())?;
    apply_rounded_corners(window);
    Ok(())
}

/// Round the window's content-view layer to match Win11's `DWMWCP_ROUND`
/// (~10px, mirrors `--r-window` in tokens.css). NSVisualEffectView paints a
/// square rectangle without this, masking the CSS `border-radius` on
/// `.glass-panel` and giving the user "각진 꼭지점". Reapplied after both
/// `apply_vibrancy` and `clear_vibrancy` because either call can reset the
/// content view's layer flags.
fn apply_rounded_corners(window: &WebviewWindow) {
    let Ok(ns_window_raw) = window.ns_window() else {
        return;
    };
    unsafe {
        let ns_window = ns_window_raw as *mut AnyObject;
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: 10.0_f64];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}

