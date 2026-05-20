mod commands;
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
            commands::quit_app,
            commands::run_migration,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");

            #[cfg(target_os = "windows")]
            {
                let _ = vibrancy_win::apply_mica(&window);
            }

            tray::setup(app)?;
            let _ = migration::run_once(app);

            // Silence unused-variable warning on platforms without vibrancy.
            let _ = &window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
