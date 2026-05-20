import { Show } from "solid-js";
import { AlertTriangle } from "lucide-solid";
import { store } from "../state/store";
import { t } from "../i18n";

export function ErrorBanner() {
  return (
    <Show when={store.errorCode === "TOKEN_EXPIRED"}>
      <div
        role="status"
        class="t-caption"
        style={{
          display: "flex",
          "align-items": "flex-start",
          gap: "var(--s-2)",
          margin: "0 var(--s-2)",
          padding: "var(--s-2) var(--s-3)",
          "border-radius": "var(--r-md)",
          background: "var(--accent-tint)",
          color: "var(--label)",
          border: "1px solid var(--accent-tint-strong)",
        }}
      >
        <AlertTriangle
          size={14}
          style={{
            color: "var(--accent)",
            "flex-shrink": 0,
            "margin-top": "2px",
          }}
        />
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "2px",
            flex: 1,
            "min-width": 0,
          }}
        >
          <span style={{ "font-weight": 600 }}>{t().tokenExpired}</span>
          <span class="label-secondary">{t().tokenExpiredHint}</span>
        </div>
      </div>
    </Show>
  );
}
