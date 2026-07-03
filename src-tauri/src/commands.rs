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
pub async fn open_guide_window(app: tauri::AppHandle, lang: String, dark: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("guide") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = format!("index.html?guide&lang={lang}&dark={}", if dark { 1 } else { 0 });
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
