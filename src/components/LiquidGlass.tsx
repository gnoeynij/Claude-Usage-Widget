import type { JSX } from "solid-js";
import { createEffect } from "solid-js";
import { store } from "../state/store";

const PANEL_BASE_ALPHA = 1.0;

export function LiquidGlass(props: { children: JSX.Element; padding?: string }) {
  let el: HTMLDivElement | undefined;
  // The pure-CSS path via --bg-alpha-mult + calc() works for .glass-card but,
  // on this WebView2 version, .glass-panel keeps its first-paint background
  // despite the variable updating — driving setProperty inside createEffect
  // is the path that reliably re-paints on store.opacity changes. The
  // `offsetHeight` read forces a reflow because some WebView2 builds skip
  // re-paint when only the alpha channel of background-color changes on an
  // isolated stacking context.
  createEffect(() => {
    if (!el) return;
    const mult = 1 - store.opacity / 100;
    el.style.setProperty(
      "background-color",
      `rgba(var(--glass-base-rgb), ${PANEL_BASE_ALPHA * mult})`,
    );
    void el.offsetHeight;
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
