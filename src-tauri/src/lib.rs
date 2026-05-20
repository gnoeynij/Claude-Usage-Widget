mod commands;
mod icon_render;
mod jsonl_aggregator;
mod migration;
mod pricing;
mod tray;
mod usage_api;
#[cfg(target_os = "windows")]
mod vibrancy_win;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::fetch_usage,
            commands::credentials_mtime,
            commands::aggregate_detail,
            commands::set_always_on_top,
            commands::set_window_opacity,
            commands::set_mica_enabled,
            commands::set_usage_icon,
            commands::set_window_size,
            commands::quit_app,
            commands::run_migration,
            commands::open_log_dir,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");

            #[cfg(target_os = "windows")]
            {
                match vibrancy_win::apply_mica(&window) {
                    Ok(()) => log::info!("setup: Mica applied"),
                    Err(e) => log::warn!("setup: Mica failed: {}", e),
                }
            }

            if let Err(e) = tray::setup(app) {
                log::error!("setup: tray init failed: {}", e);
                return Err(e.into());
            }
            log::info!("setup: tray ready");

            match migration::run_once(app) {
                Ok(()) => log::info!("setup: migration done"),
                Err(e) => log::warn!("setup: migration failed: {}", e),
            }

            // Silence unused-variable warning on platforms without vibrancy.
            let _ = &window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
