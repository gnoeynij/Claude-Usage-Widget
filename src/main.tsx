/* @refresh reload */
import { render } from "solid-js/web";
import "virtual:uno.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { App } from "./App";
import { GuideApp } from "./views/GuideView";
import { store, usageSummaryText } from "./state/store";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Separate guide window (opened from Settings) loads the same bundle with
// `?guide` — render the standalone guide instead of the widget.
const isGuide = new URLSearchParams(window.location.search).has("guide");

// Right-click: suppress the WebView's default browser menu everywhere
// (reload/print/inspect make no sense on a desktop widget) and open the
// native popup instead. Two entry points feed the same menu: the DOM
// `contextmenu` event for regular surfaces, and `nc://contextmenu` from the
// Rust subclass (nc_menu_win.rs) for Windows drag regions — there WebView2
// hands the hit to the OS caption (HTCAPTION), so the DOM never sees it and
// the system menu would pop without that hook. Guide window stays silent.
const showContextMenu = () => {
  void invoke("show_context_menu", {
    lang: store.lang,
    summary: usageSummaryText(),
  }).catch(() => {});
};
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!isGuide) showContextMenu();
});
if (!isGuide) {
  void listen("nc://contextmenu", showContextMenu);
}

// macOS: tag the document *before first paint* so `:root.mac` strips
// backdrop-filter (see glass.css). If the class lands after the panel's first
// paint, WKWebView keeps the frosted backdrop-filter compositing until the next
// relayout — boot showed opaque until the first mode change.
if (/Mac/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("mac");
}

render(() => (isGuide ? <GuideApp /> : <App />), root);
