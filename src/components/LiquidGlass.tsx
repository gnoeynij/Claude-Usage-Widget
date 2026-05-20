import type { JSX } from "solid-js";
import { createEffect } from "solid-js";
import { store } from "../state/store";

const PANEL_BASE_ALPHA = 0.78;

export function LiquidGlass(props: { children: JSX.Element; padding?: string }) {
  let el: HTMLDivElement | undefined;
  // The pure-CSS path via --bg-alpha-mult + calc() works for .glass-card but,
  // on this WebView2 version, .glass-panel keeps its first-paint background
  // despite the variable updating — backdrop-filter appears to cache the
  // background layer separately, and even an inline-template-literal style
  // didn't reliably re-flow. Driving setProperty inside createEffect is the
  // path that *definitely* re-paints on store.opacity changes.
  createEffect(() => {
    if (!el) return;
    const mult = 1 - store.opacity / 100;
    el.style.setProperty(
      "background-color",
      `rgba(var(--glass-base-rgb), ${PANEL_BASE_ALPHA * mult})`,
    );
  });
  return (
    <div
      ref={(node) => (el = node)}
      class="glass-panel"
      style={{
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        gap: "var(--s-2)",
        padding: props.padding ?? "var(--s-3)",
      }}
    >
      {props.children}
    </div>
  );
}
