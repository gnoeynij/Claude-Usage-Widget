// One-shot migration from the legacy PyQt6 QSettings store
// (HKCU\Software\ClaudeWidget\Claude-Widget-Cross) into tauri-plugin-store.
//
// Only the cross-version settings are migrated — language, sync interval,
// always-on-top, dark mode, opacity, mini/detail mode. Window position and
// size are intentionally not migrated; tauri-plugin-window-state handles
// them and the geometry primitives QPoint/QSize use Qt's binary format which
// would be brittle to parse from outside Qt.
//
// **Target file = "widget-settings.json"** (same name store.ts loads at boot).
// Key names are translated PyQt6 snake_case → store.ts camelCase, and the
// `sync_interval` PyQt6 unit (seconds; v1.5.1 _shared.py
// `DEFAULT_SYNC_INTERVAL_SEC = 600`) is converted to minutes to match the
// new `syncIntervalMin` segmented-control values (0/5/10/30/60).

use tauri::App;

#[cfg(target_os = "windows")]
const LEGACY_KEY: &str = r"Software\ClaudeWidget\Claude-Widget-Cross";

#[cfg(target_os = "windows")]
const MARKER_FILENAME: &str = ".migrated_from_pyqt6";

pub fn run_once(app: &App) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        run_windows(&app.handle().clone())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn run_windows(app: &tauri::AppHandle) -> anyhow::Result<()> {
    use tauri_plugin_store::StoreExt;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let marker = marker_path()?;
    if marker.exists() {
        return Ok(());
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(LEGACY_KEY) {
        Ok(k) => k,
        Err(_) => {
            // No legacy data — still write the marker so we never probe again.
            write_marker(&marker)?;
            return Ok(());
        }
    };

    let store = app.store("widget-settings.json")?;

    // String values — `lang` is the only one store.ts consumes. Other
    // PyQt6 string keys (last_sync_time, bg_opacity_mode, widget_size,
    // widget_size_mini, pos) are intentionally dropped: either transient or
    // Qt-specific binary-string formats with no v2 equivalent.
    if let Ok(v) = key.get_value::<String, _>("lang") {
        // v1.5 wrote raw values — accept only "en" / "ko", else skip and let
        // store.ts default to "en".
        if v == "en" || v == "ko" {
            store.set("lang", serde_json::Value::String(v));
        }
    }

    // Integer values — PyQt6 stored numbers may be either u32 or stringified.
    // `sync_interval` (seconds) → `syncIntervalMin` (minutes).
    // `bg_opacity` (0-100) → `opacity` (same scale).
    if let Some(secs) = read_u32_loose(&key, "sync_interval") {
        let mins = (secs / 60) as i64;
        store.set("syncIntervalMin", serde_json::json!(mins));
    }
    if let Some(o) = read_u32_loose(&key, "bg_opacity") {
        let clamped = o.min(100) as i64;
        store.set("opacity", serde_json::json!(clamped));
    }

    // Boolean values — accept either string ("true"/"false") or u32 (0/1).
    if let Some(v) = read_bool_loose(&key, "always_on_top") {
        store.set("alwaysOnTop", serde_json::Value::Bool(v));
    }
    if let Some(v) = read_bool_loose(&key, "dark_mode") {
        store.set("dark", serde_json::Value::Bool(v));
    }

    // mini_mode + detail_mode → mode string ("mini" / "detail" / "normal").
    // detail_mode wins over mini_mode if both are true (defensive — PyQt6 UI
    // shouldn't have allowed both, but the registry may carry stale state).
    let mini = read_bool_loose(&key, "mini_mode").unwrap_or(false);
    let detail = read_bool_loose(&key, "detail_mode").unwrap_or(false);
    let mode = if detail {
        "detail"
    } else if mini {
        "mini"
    } else {
        "normal"
    };
    store.set("mode", serde_json::Value::String(mode.to_string()));

    store.save()?;
    write_marker(&marker)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_u32_loose(key: &winreg::RegKey, name: &str) -> Option<u32> {
    if let Ok(v) = key.get_value::<u32, _>(name) {
        return Some(v);
    }
    if let Ok(s) = key.get_value::<String, _>(name) {
        if let Ok(n) = s.parse::<u32>() {
            return Some(n);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn read_bool_loose(key: &winreg::RegKey, name: &str) -> Option<bool> {
    if let Ok(s) = key.get_value::<String, _>(name) {
        return Some(s.eq_ignore_ascii_case("true"));
    }
    if let Ok(v) = key.get_value::<u32, _>(name) {
        return Some(v != 0);
    }
    None
}

#[cfg(target_os = "windows")]
fn marker_path() -> anyhow::Result<std::path::PathBuf> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no local data dir"))?
        .join("com.gnoeynij.claude-widget");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(MARKER_FILENAME))
}

#[cfg(target_os = "windows")]
fn write_marker(path: &std::path::Path) -> anyhow::Result<()> {
    std::fs::write(path, "1")?;
    Ok(())
}
