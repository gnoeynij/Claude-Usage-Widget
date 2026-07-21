//! Windows-only: forward right-clicks on drag regions to the widget's custom
//! context menu. WebView2 maps CSS `-webkit-app-region: drag` areas to the
//! window caption (HTCAPTION), so a right-click there never reaches the DOM —
//! the OS pops the window *system menu* (move/size/close) instead. Subclass
//! the top-level window, swallow caption right-clicks, and emit an event the
//! frontend answers with the same `show_context_menu` invoke as the DOM
//! `contextmenu` path (so lang + usage summary stay fresh). macOS needs none
//! of this: its drag path is JS-driven, so `contextmenu` fires everywhere.

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMenuItemCount, GetMenuItemID, SendMessageW, HMENU, WM_CANCELMODE, WM_INITMENU,
};

const SUBCLASS_ID: usize = 0xC7C7;

pub fn setup(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    // The subclass proc lives as long as the window = the whole process, so
    // leaking one AppHandle clone is the simple correct lifetime.
    let app: &'static AppHandle = Box::leak(Box::new(window.app_handle().clone()));
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(subclass_proc),
            SUBCLASS_ID,
            app as *const AppHandle as usize,
        );
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    refdata: usize,
) -> LRESULT {
    // Evidence (2026-07-21 diag log): WebView2 never routes drag-region
    // right-clicks through the host's NC pipeline (no WM_NCRBUTTON*, no
    // WM_CONTEXTMENU). It calls TrackPopupMenu(GetSystemMenu) itself, with
    // the host as menu owner — so WM_INITMENU is the earliest hook we get.
    // Cancel menu mode there and open our menu instead. Our own muda popup
    // also owner-loops through this window, so discriminate by item ids:
    // only the system menu carries SC_* command ids (0xF000..=0xF200).
    if msg == WM_INITMENU {
        let hmenu = HMENU(wparam.0 as *mut core::ffi::c_void);
        if is_system_menu(hmenu) {
            let _ = SendMessageW(hwnd, WM_CANCELMODE, Some(WPARAM(0)), Some(LPARAM(0)));
            let app = &*(refdata as *const AppHandle);
            let _ = app.emit_to("main", "nc://contextmenu", ());
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

unsafe fn is_system_menu(hmenu: HMENU) -> bool {
    let count = GetMenuItemCount(Some(hmenu));
    if count <= 0 {
        return false;
    }
    (0..count).any(|i| {
        let id = GetMenuItemID(hmenu, i);
        (0xF000..=0xF200).contains(&id)
    })
}
