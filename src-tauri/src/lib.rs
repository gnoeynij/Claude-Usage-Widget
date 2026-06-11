mod commands;
mod device_sync;
mod jsonl_aggregator;
mod migration;
mod pricing;
mod tray;
mod usage_api;
#[cfg(target_os = "windows")]
mod vibrancy_win;
#[cfg(target_os = "macos")]
mod vibrancy_mac;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

/// Read the persisted `lang` value from `widget-settings.json` so the tray
/// menu can render localized labels on first paint. Falls back to "en" if
/// the store is missing, the key is absent, or the value isn't one of the
/// supported language codes.
fn read_persisted_lang(app: &tauri::App) -> String {
    let Ok(store) = app.store("widget-settings.json") else {
        return "en".to_string();
    };
    match store.get("lang") {
        Some(serde_json::Value::String(s)) if s == "en" || s == "ko" => s,
        _ => "en".to_string(),
    }
}

/// Read the persisted `opacity` (0–100) so setup can decide whether to paint
/// the NSVisualEffectView backdrop. Defaults to 0 — the slider's resting value
/// and the "solid Liquid Glass" look — on any read miss, so the backdrop stays
/// the safe fallback when the store is unreadable.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn read_persisted_opacity(app: &tauri::App) -> f64 {
    let Ok(store) = app.store("widget-settings.json") else {
        return 0.0;
    };
    match store.get("opacity") {
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance guard MUST be the first plugin registered (Tauri
        // requirement). A second launch fires this callback in the *already
        // running* process — surface its window — then the second process
        // exits, so the widget only ever runs once.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            // File logger so users can attach `widget.log` to bug reports.
            // INFO covers the failure modes that users actually report
            // (network drop, TOKEN_EXPIRED, RATE_LIMITED) without flooding
            // the file with per-frame chatter. Bumped to DEBUG only when
            // chasing a specific issue.
            tauri_plugin_log::Builder::default()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("widget".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000) // 1 MB rotation
                // Keep ~5 MB total. `KeepAll` 은 1년 사용 시 수십~수백 MB
                // 누적 위험. KeepSome(5) 로 디스크 누수 차단하면서 최근
                // sync·error·update 기록은 버그 리포트용 충분히 보관.
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::fetch_usage,
            commands::credentials_mtime,
            commands::aggregate_detail,
            commands::set_always_on_top,
            commands::set_mica_enabled,
            commands::set_tray_state,
            commands::set_window_size,
            commands::hide_window,
            commands::fetch_plan,
            commands::detect_sync_folders,
            commands::sync_device_cost,
            commands::open_guide_window,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");

            #[cfg(target_os = "windows")]
            {
                // Mirror the macOS branch below: paint Mica only when opacity
                // rests at 0. Above 0 the user wants a see-through panel, so
                // start *cleared* — applying Mica here and clearing it later
                // from the frontend's setOpacity left the wash visible until
                // the next relayout, reading as "won't go transparent until I
                // change mode". clear_vibrancy still rounds the OS corners.
                let opacity = read_persisted_opacity(app);
                let res = if opacity == 0.0 {
                    vibrancy_win::apply_mica(&window)
                } else {
                    vibrancy_win::clear_vibrancy(&window)
                };
                match res {
                    Ok(()) => log::info!("setup: vibrancy set (opacity={})", opacity),
                    Err(e) => log::warn!("setup: vibrancy failed: {}", e),
                }
            }
            #[cfg(target_os = "macos")]
            {
                // Paint the NSVisualEffectView backdrop only when opacity rests
                // at 0 (full Liquid Glass). Above 0 the user wants a see-through
                // panel, so start *cleared* — applying Mica here and clearing it
                // later from the frontend's setOpacity left the frosted state
                // visible until the next relayout, reading as "won't go
                // transparent until I change mode". clear_vibrancy still rounds
                // the corners + sets the window transparent.
                let opacity = read_persisted_opacity(app);
                let res = if opacity == 0.0 {
                    vibrancy_mac::apply_mica(&window)
                } else {
                    vibrancy_mac::clear_vibrancy(&window)
                };
                match res {
                    Ok(()) => log::info!("setup: vibrancy set (opacity={})", opacity),
                    Err(e) => log::warn!("setup: vibrancy failed: {}", e),
                }
            }

            // Tray menu labels follow the user's persisted language. Reading
            // the store synchronously at setup avoids a flash of English labels
            // while the frontend boots — and the frontend can't update menu
            // labels on `setLang` anyway without a re-create, so the labels
            // are fixed for the session (changes take effect after restart).
            let lang = read_persisted_lang(app);
            if let Err(e) = tray::setup(app, &lang) {
                log::error!("setup: tray init failed: {}", e);
                return Err(e.into());
            }
            log::info!("setup: tray ready (lang={})", lang);

            match migration::run_once(app) {
                Ok(()) => log::info!("setup: migration done"),
                Err(e) => log::warn!("setup: migration failed: {}", e),
            }

            let _ = &window;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
