// One-shot migration from the legacy PyQt6 QSettings store
// (HKCU\Software\ClaudeWidget\Claude-Widget-Cross) into tauri-plugin-store.
//
// Only the cross-version settings are migrated — language, sync interval,
// always-on-top, dark mode, opacity, mini/detail mode. Window position and
// size are intentionally not migrated; tauri-plugin-window-state handles
// them and the geometry primitives QPoint/QSize use Qt's binary format which
// would be brittle to parse from outside Qt.

use tauri::App;

#[cfg(target_os = "windows")]
const LEGACY_KEY: &str = r"Software\ClaudeWidget\Claude-Widget-Cross";

#[cfg(target_os = "windows")]
const MARKER_FILENAME: &str = ".migrated_from_pyqt6";

pub fn run_once(app: &App) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        return run_windows(&app.handle().clone());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn run_once_invoked() -> anyhow::Result<bool> {
    // The real migration is performed once during App::setup(). When the
    // frontend calls this command later it's effectively a no-op — but we
    // still report success so the UI flow stays simple.
    Ok(false)
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

    let store = app.store("settings.json")?;

    for name in ["lang", "last_sync_time", "bg_opacity_mode"] {
        if let Ok(v) = key.get_value::<String, _>(name) {
            store.set(name.to_string(), serde_json::Value::String(v));
        }
    }
    for name in ["sync_interval", "bg_opacity"] {
        if let Ok(v) = key.get_value::<u32, _>(name) {
            store.set(name.to_string(), serde_json::json!(v));
        } else if let Ok(v) = key.get_value::<String, _>(name) {
            if let Ok(n) = v.parse::<i64>() {
                store.set(name.to_string(), serde_json::json!(n));
            }
        }
    }
    for name in ["always_on_top", "dark_mode", "mini_mode", "detail_mode"] {
        if let Ok(v) = key.get_value::<String, _>(name) {
            store.set(
                name.to_string(),
                serde_json::Value::Bool(v.eq_ignore_ascii_case("true")),
            );
        } else if let Ok(v) = key.get_value::<u32, _>(name) {
            store.set(name.to_string(), serde_json::Value::Bool(v != 0));
        }
    }

    store.save()?;
    write_marker(&marker)?;
    Ok(())
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
