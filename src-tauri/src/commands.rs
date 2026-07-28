use crate::jsonl_aggregator;
use crate::usage_api;

#[tauri::command]
pub async fn fetch_usage() -> Result<usage_api::UsageOutput, String> {
    usage_api::fetch_usage().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_plan() -> usage_api::PlanOutput {
    usage_api::read_plan()
}

/// Cloud-synced folder roots detected on this machine (Settings picker).
#[tauri::command]
pub fn detect_sync_folders() -> Vec<String> {
    crate::device_sync::detect_folders()
}

/// Write this device's lifetime cost + daily history into the shared folder
/// and return the combined totals across all devices found there.
#[tauri::command]
pub fn sync_device_cost(
    folder: String,
    device_id: String,
    cost: f64,
    daily: crate::device_sync::DailyMap,
) -> Result<crate::device_sync::CombinedOut, String> {
    crate::device_sync::sync(&folder, &device_id, cost, daily).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credentials_mtime() -> Option<f64> {
    usage_api::credentials_mtime_ms()
}

/// Locate the Claude Code CLI across its install shapes: PATH (probing
/// `claude.exe` AND the npm shim `claude.cmd` on Windows — npm global
/// installs ship no .exe), then fixed fallbacks for launch contexts where a
/// GUI process sees a narrower PATH than the user's shell: the native
/// installer's `~/.local/bin`, the migrate-installer's `~/.claude/local`,
/// and (macOS, where launchd PATH lacks them) Homebrew/`/usr/local/bin`.
fn find_claude_bin() -> Option<std::path::PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let probe = |dir: &std::path::Path| -> Option<std::path::PathBuf> {
        names.iter().map(|n| dir.join(n)).find(|c| c.is_file())
    };
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            if let Some(hit) = probe(&dir) {
                return Some(hit);
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        for rel in [&[".local", "bin"][..], &[".claude", "local"][..]] {
            let dir = rel.iter().fold(home.clone(), |p, seg| p.join(seg));
            if let Some(hit) = probe(&dir) {
                return Some(hit);
            }
        }
    }
    #[cfg(target_os = "macos")]
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        if let Some(hit) = probe(std::path::Path::new(dir)) {
            return Some(hit);
        }
    }
    None
}

/// Spawn a minimal Claude Code call so the CLI silently refreshes an expired
/// OAuth token (it does so on any real API call — verified 2026-07-03, see
/// docs/plans/2026-05-20-oauth-refresh.md addendum). Neutral temp cwd keeps
/// project CLAUDE.md context out (~$0.015/call measured vs $0.107 from a
/// project dir); --no-session-persistence keeps the call's own JSONL out of
/// ~/.claude/projects so the widget's *local cost stats* never count it (the
/// call still consumes the server-side 5h/weekly windows like any API call).
/// Returns the CLI exit code; non-zero means the token was likely not
/// refreshed (stderr tail goes to the log). Callers re-sync afterwards — the
/// sync result decides the new state (recovered, or NO_CREDENTIALS when the
/// refresh token itself is dead and the CLI wiped it).
///
/// Deliberately no kill-timeout: SIGKILL landing between the server rotating
/// the refresh token and the CLI writing .credentials.json would strand a
/// consumed one-time token on disk — the regression-§21 chain-revocation
/// scenario. A hung CLI parks one blocking thread instead, and the frontend's
/// in-flight/per-episode guards prevent pile-up.
#[tauri::command]
pub async fn trigger_token_refresh() -> Result<i32, String> {
    let bin = find_claude_bin().ok_or("CLAUDE_BIN_NOT_FOUND")?;
    let cwd = std::env::temp_dir().join("claude-widget-refresh");
    let _ = std::fs::create_dir_all(&cwd);
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(bin);
        cmd.args(["-p", "ok", "--model", "haiku", "--no-session-persistence", "--tools", ""])
            .current_dir(cwd)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            // Piped so a failure is diagnosable; read only after exit. The CLI's
            // error output is small (a usage/auth line), nowhere near the 64KB
            // pipe buffer that could deadlock a pre-exit reader.
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
        }
        let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
        let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
        let code = status.code().unwrap_or(-1);
        if code != 0 {
            use std::io::Read;
            let mut tail = String::new();
            if let Some(mut err) = child.stderr.take() {
                let _ = err.read_to_string(&mut tail);
            }
            let tail = tail.trim();
            // Char-boundary-safe last ~300 chars (byte slicing could panic mid-UTF-8).
            let start = tail.char_indices().rev().nth(299).map_or(0, |(i, _)| i);
            log::warn!("claude refresh run exited {code}: {}", &tail[start..]);
        }
        Ok(code)
    })
    .await
    .map_err(|e| format!("join failed: {e}"))?
}

/// Open a visible terminal running `claude auth login`. The CLI opens the
/// OAuth browser page itself; the terminal stays for the paste-the-code
/// fallback. Never call automatically: `auth login` wipes the stored
/// credentials the moment it starts (verified 2026-07-03), so it must stay
/// behind an explicit user click on the NO_CREDENTIALS banner. Errors
/// propagate to the frontend, which surfaces a toast — this button is the
/// recovery funnel's last resort and must not fail invisibly.
#[tauri::command]
pub fn open_login_terminal() -> Result<(), String> {
    let bin = find_claude_bin().ok_or("CLAUDE_BIN_NOT_FOUND")?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Direct argv spawn with its own console — no cmd.exe `start` line,
        // so no %VAR% expansion / quote-mangling of the path (cmd expands
        // %pairs% even inside double quotes).
        std::process::Command::new(&bin)
            .args(["auth", "login"])
            .creation_flags(0x0000_0010) // CREATE_NEW_CONSOLE — interactive window
            .spawn()
            .map_err(|e| format!("spawn failed: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        // The path is embedded in two nested string contexts — shell single
        // quotes inside an AppleScript literal — so escape both layers
        // (shell first, then AppleScript's \\ and \").
        let sh = format!("'{}' auth login", bin.display().to_string().replace('\'', r"'\''"));
        let script = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            sh.replace('\\', r"\\").replace('"', "\\\"")
        );
        // osascript returns promptly (`do script` doesn't wait for the shell),
        // so a blocking status() is fine — and it's the only way to see a TCC
        // Automation denial, which exits non-zero with no other signal.
        let out = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("spawn failed: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("osascript failed: {}", err.trim()));
        }
    }
    Ok(())
}

/// Open (or focus) the standalone guide window. `lang`/`dark` are passed from
/// the widget so the guide matches the current theme/language; the frontend
/// renders `<GuideApp>` when the URL carries `?guide`.
#[tauri::command]
pub async fn open_guide_window(app: tauri::AppHandle, lang: String, dark: bool, theme: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("guide") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = format!("index.html?guide&lang={lang}&dark={}&theme={theme}", if dark { 1 } else { 0 });
    let window = tauri::WebviewWindowBuilder::new(&app, "guide", tauri::WebviewUrl::App(url.into()))
        .title("Claude Usage Widget — Guide")
        .inner_size(1180.0, 920.0)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    // Frameless glass to match the widget (Mica on Win11; rounds the corners).
    #[cfg(target_os = "windows")]
    {
        let _ = crate::vibrancy_win::apply_mica(&window);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = crate::vibrancy_mac::apply_mica(&window);
    }
    let _ = &window;
    Ok(())
}

#[tauri::command]
pub async fn aggregate_detail(counted_until_ms: f64) -> Result<jsonl_aggregator::AggregateOut, String> {
    match tauri::async_runtime::spawn_blocking(move || jsonl_aggregator::aggregate(counted_until_ms)).await {
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

/// Toggle the Mica/Acrylic backdrop at runtime. The frontend calls this from
/// `setOpacity` so that the backdrop only paints when the slider is at 0% —
/// otherwise the system-painted Mica wash masks the CSS-driven panel fade
/// (the 23222cf "5x retry" trail diagnosed the wrong layer for this reason).
#[tauri::command]
pub async fn set_mica_enabled(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            crate::vibrancy_win::apply_mica(&window)?;
        } else {
            crate::vibrancy_win::clear_vibrancy(&window)?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if enabled {
            crate::vibrancy_mac::apply_mica(&window)?;
        } else {
            crate::vibrancy_mac::clear_vibrancy(&window)?;
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = (window, enabled);
    }
    Ok(())
}

/// trayicon 을 정상(ok) 또는 비정상(err) 상태로 전환. frontend 가 sync 결과·
/// TOKEN_EXPIRED·네트워크 실패 시 호출.
#[tauri::command]
pub fn set_tray_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let s = match state.as_str() {
        "err" => crate::tray::TrayState::Err,
        _ => crate::tray::TrayState::Ok,
    };
    crate::tray::set_tray_state(&app, s);
    Ok(())
}

/// 위젯을 트레이로 hide. FooterBar X 버튼이 frontend
/// `getCurrentWindow().hide()` 로 안 되는 신고가 있어 backend 우회.
/// 다른 command 들과 동일한 invoke 패턴으로 안정성 ↑.
#[tauri::command]
pub async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Apply a mode-specific window size + minimum size in one shot. Order
/// matters: `set_min_size` first so the subsequent `set_size` isn't clamped
/// by the *previous* mode's minimum.
#[tauri::command]
pub async fn set_window_size(
    window: tauri::Window,
    width: u32,
    height: u32,
    min_width: u32,
    min_height: u32,
    always_on_top: bool,
) -> Result<(), String> {
    use tauri::LogicalSize;
    window
        .set_min_size(Some(LogicalSize::new(min_width, min_height)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    // Windows drops WS_EX_TOPMOST when a window is resized via SetWindowPos, so
    // re-assert always-on-top right here — same command, so there's no IPC race
    // with a separate set_always_on_top call. This keeps AOT through every
    // resize path (boot, mode switch, macOS compositor nudge) without a
    // standalone re-assert.
    //
    // tao diffs window flags (apply_diff), so re-asserting `true` when the flag
    // is *already* true is a no-op — it would NOT re-issue SetWindowPos and the
    // topmost dropped by set_size above stays dropped (this is why boot left the
    // widget un-pinned even though AOT was on). Toggle false→true to force tao
    // to re-apply it, exactly like a manual OFF→ON in settings does.
    if always_on_top {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Snapshot of the usage line captured when the context menu opens, consumed
/// by the copy handler — menu events arrive after `show_context_menu` returns,
/// so the frontend can't pass it at click time.
static CTX_SUMMARY: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

struct CtxLabels {
    copy_usage: &'static str,
    sync: &'static str,
    mode_mini: &'static str,
    mode_normal: &'static str,
    mode_detail: &'static str,
    click_through: &'static str,
    hide: &'static str,
    open_logs: &'static str,
}

fn ctx_labels(lang: &str) -> CtxLabels {
    match lang {
        "ko" => CtxLabels {
            copy_usage: "사용량 요약 복사",
            sync: "지금 동기화",
            mode_mini: "Mini 모드",
            mode_normal: "Normal 모드",
            mode_detail: "Detail 모드",
            click_through: "클릭 통과 (트레이에서 해제)",
            hide: "숨기기",
            open_logs: "로그 폴더 열기",
        },
        _ => CtxLabels {
            copy_usage: "Copy usage summary",
            sync: "Sync now",
            mode_mini: "Mini mode",
            mode_normal: "Normal mode",
            mode_detail: "Detail mode",
            click_through: "Click-through (undo via tray)",
            hide: "Hide",
            open_logs: "Open log folder",
        },
    }
}

/// Native right-click menu for the widget body. The default WebView context
/// menu (reload/print/inspect — browser chrome that makes no sense on a
/// desktop widget) is suppressed by the frontend's `contextmenu` handler,
/// which then invokes this. Item events arrive in lib.rs `on_menu_event` →
/// `handle_context_menu_event`; mode/sync reuse the existing `tray://` events
/// so the frontend wiring is shared with the tray menu.
#[tauri::command]
pub fn show_context_menu(
    window: tauri::WebviewWindow,
    lang: String,
    summary: String,
) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::Manager;
    if let Ok(mut s) = CTX_SUMMARY.lock() {
        *s = summary;
    }
    let app = window.app_handle();
    let l = ctx_labels(&lang);
    let copy = MenuItem::with_id(app, "ctx_copy_usage", l.copy_usage, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sync = MenuItem::with_id(app, "ctx_sync", l.sync, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let mini = MenuItem::with_id(app, "ctx_mode_mini", l.mode_mini, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let normal = MenuItem::with_id(app, "ctx_mode_normal", l.mode_normal, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let detail = MenuItem::with_id(app, "ctx_mode_detail", l.mode_detail, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let click_through =
        MenuItem::with_id(app, "ctx_click_through", l.click_through, true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(app, "ctx_hide", l.hide, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let logs = MenuItem::with_id(app, "ctx_open_logs", l.open_logs, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep3 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(
        app,
        &[
            &copy, &sep1, &sync, &mini, &normal, &detail, &sep2, &click_through, &hide, &sep3,
            &logs,
        ],
    )
    .map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

pub fn handle_context_menu_event(app: &tauri::AppHandle, id: &str) {
    use tauri::{Emitter, Manager};
    match id {
        "ctx_copy_usage" => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            let text = CTX_SUMMARY.lock().map(|s| s.clone()).unwrap_or_default();
            if !text.is_empty() && app.clipboard().write_text(text).is_ok() {
                let _ = app.emit("ctx://copied", ());
            }
        }
        "ctx_sync" => {
            let _ = app.emit("tray://sync", ());
        }
        "ctx_mode_mini" => {
            let _ = app.emit("tray://mode", "mini");
        }
        "ctx_mode_normal" => {
            let _ = app.emit("tray://mode", "normal");
        }
        "ctx_mode_detail" => {
            let _ = app.emit("tray://mode", "detail");
        }
        "ctx_click_through" => {
            if let Some(win) = app.get_webview_window("main") {
                // Toast first: after ignore-cursor-events the widget keeps
                // rendering but no longer receives input, so the restore hint
                // must already be on its way to the screen.
                let _ = app.emit("ctx://click-through", ());
                let _ = win.set_ignore_cursor_events(true);
            }
        }
        "ctx_hide" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }
        }
        "ctx_open_logs" => {
            if let Ok(dir) = app.path().app_log_dir() {
                #[cfg(target_os = "windows")]
                let _ = std::process::Command::new("explorer").arg(&dir).spawn();
                #[cfg(target_os = "macos")]
                let _ = std::process::Command::new("open").arg(&dir).spawn();
            }
        }
        _ => {}
    }
}

/// Small always-on-top dialog near the tray corner. Opened by the frontend
/// on rare occasions; stays until the user closes it (no auto-dismiss).
#[tauri::command]
pub async fn open_milestone_window(
    app: tauri::AppHandle,
    amount: f64,
    lang: String,
    dark: bool,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("milestone") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (win_w, win_h) = (360.0, 168.0);
    // Bottom-right, near the system tray. Monitor size is physical px —
    // convert to logical before subtracting; 72px clears a standard taskbar.
    let (mut x, mut y) = (120.0, 120.0);
    if let Ok(Some(m)) = app.primary_monitor() {
        let s = m.scale_factor();
        let size = m.size().to_logical::<f64>(s);
        x = size.width - win_w - 16.0;
        y = size.height - win_h - 72.0;
    }
    let url = format!(
        "index.html?milestone&amount={amount}&lang={lang}&dark={}",
        if dark { 1 } else { 0 }
    );
    let window =
        tauri::WebviewWindowBuilder::new(&app, "milestone", tauri::WebviewUrl::App(url.into()))
            .title("Claude Widget")
            .inner_size(win_w, win_h)
            .position(x, y)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;
    // No vibrancy on purpose: the card sits inside an 8px margin, and any OS
    // material painted on the window shows there as a frame ring around the
    // toast (forced-light Mica read as a white border). Fully transparent
    // window + the CSS glass card alone is the intended look.
    let _ = &window;
    Ok(())
}
