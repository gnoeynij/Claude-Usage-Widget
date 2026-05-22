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
    .map_err(|e| e.to_string())
}

/// Drop the NSVisualEffectView so the WebView's transparent root is what the
/// user sees through the .glass-panel fill — needed when the opacity slider
/// moves off 0% so the CSS-driven fade isn't masked by the OS blur.
pub fn clear_vibrancy(window: &WebviewWindow) -> Result<(), String> {
    wv_clear_vibrancy(window)
        .map(|_| ())
        .map_err(|e| e.to_string())
}
