use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
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

/// Round the window's content-view layer to match macOS native windows
/// (~13px, mirrors `:root.mac --r-window` in tokens.css). NSVisualEffectView paints a
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

        // Force the window itself transparent — tauri.conf.json's
        // `transparent: true` ought to do this, but in combination with
        // NSVisualEffectView the corner regions still paint as black on
        // some macOS builds. Setting opaque=false + clear backgroundColor
        // explicitly makes the 4 corners outside the rounded mask show the
        // desktop instead of the window's default fill.
        let _: () = msg_send![ns_window, setOpaque: false];
        let clear_color: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear_color];

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        apply_corner_to_view(content_view);

        // NSVisualEffectView (added by window-vibrancy under the WebView)
        // and the WebView itself each have their own backing layer. The
        // content view's `masksToBounds` doesn't clip *sibling* layers that
        // sit beside the content view in the window's layer tree, so the
        // square vibrancy material bleeds into the 4 corner regions and
        // reads as black on the HudWindow material. Apply the same corner
        // mask to every direct subview to clip them in lock-step.
        let subviews: *mut AnyObject = msg_send![content_view, subviews];
        if !subviews.is_null() {
            let count: usize = msg_send![subviews, count];
            for i in 0..count {
                let subview: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
                apply_corner_to_view(subview);
            }
        }
    }
}

unsafe fn apply_corner_to_view(view: *mut AnyObject) {
    let _: () = msg_send![view, setWantsLayer: true];
    let layer: *mut AnyObject = msg_send![view, layer];
    if layer.is_null() {
        return;
    }
    let _: () = msg_send![layer, setCornerRadius: 13.0_f64];
    // Match macOS native windows' continuous (squircle) corner instead of
    // CALayer's default circular arc. kCACornerCurveContinuous == the string
    // "continuous"; build it at runtime so we don't link QuartzCore for one const.
    let curve: *mut AnyObject =
        msg_send![class!(NSString), stringWithUTF8String: c"continuous".as_ptr()];
    let _: () = msg_send![layer, setCornerCurve: curve];
    let _: () = msg_send![layer, setMasksToBounds: true];
}

