/* @refresh reload */
import { render } from "solid-js/web";
import "virtual:uno.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css";
import { App } from "./App";
import { GuideApp } from "./views/GuideView";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Separate guide window (opened from Settings) loads the same bundle with
// `?guide` — render the standalone guide instead of the widget.
const isGuide = new URLSearchParams(window.location.search).has("guide");

// macOS: tag the document *before first paint* so `:root.mac` strips
// backdrop-filter (see glass.css). If the class lands after the panel's first
// paint, WKWebView keeps the frosted backdrop-filter compositing until the next
// relayout — boot showed opaque until the first mode change.
if (/Mac/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("mac");
}

render(() => (isGuide ? <GuideApp /> : <App />), root);
