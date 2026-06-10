import { For } from "solid-js";
import { Portal } from "solid-js/web";
import { AlertTriangle, AlertCircle } from "lucide-solid";
import { store, dismissToast } from "../state/store";

/** Transient in-widget alerts (usage thresholds) styled as Liquid Glass.
 *  Kept readable regardless of the opacity slider — an alert should stay
 *  visible even when the panel is dialed transparent. Click to dismiss.
 *
 *  Mounted via <Portal> to document.body, NOT inside .glass-panel: the panel
 *  is `overflow: hidden` + `backdrop-filter` (which makes it the containing
 *  block for fixed descendants), so a toast rendered inside it gets clipped
 *  and the `.glass-panel > *` flow rule pushed widget content down instead of
 *  overlaying it. Portaling out anchors `position: fixed` to the viewport. */
export function GlassToast() {
  return (
    <Portal>
    <div
      style={{
        position: "fixed",
        top: "var(--s-2)",
        left: "var(--s-2)",
        right: "var(--s-2)",
        "z-index": 100,
        display: "flex",
        "flex-direction": "column",
        gap: "var(--s-2)",
        "pointer-events": "none",
      }}
    >
      <For each={store.toasts}>
        {(toast) => {
          const danger = toast.tone === "danger";
          const Icon = danger ? AlertTriangle : AlertCircle;
          return (
            <div
              role="status"
              class="view-in"
              title={toast.body}
              onClick={() => dismissToast(toast.id)}
              style={{
                "pointer-events": "auto",
                cursor: "pointer",
                display: "flex",
                "align-items": "flex-start",
                gap: "var(--s-2)",
                padding: "var(--s-2) var(--s-3)",
                "border-radius": "var(--r-md)",
                background: "rgba(var(--glass-card-rgb), 0.94)",
                "backdrop-filter": "blur(18px) saturate(180%)",
                "-webkit-backdrop-filter": "blur(18px) saturate(180%)",
                border: danger
                  ? "1px solid var(--danger)"
                  : "1px solid var(--accent-tint-strong)",
                "box-shadow": "var(--shadow-card)",
                color: "var(--label)",
              }}
            >
              <Icon
                size={14}
                style={{
                  color: danger ? "var(--danger)" : "var(--accent)",
                  "flex-shrink": "0",
                  "margin-top": "2px",
                }}
              />
              <div
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  gap: "2px",
                  "min-width": 0,
                }}
              >
                <span class="t-caption" style={{ "font-weight": 600 }}>
                  {toast.title}
                </span>
                <span class="t-caption label-secondary">{toast.body}</span>
              </div>
            </div>
          );
        }}
      </For>
    </div>
    </Portal>
  );
}
