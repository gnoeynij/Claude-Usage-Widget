import { X } from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import { SegmentedControl } from "../components/SegmentedControl";
import { store, setMode, type Mode } from "../state/store";
import { t } from "../i18n";

export function FooterBar() {
  return (
    <footer
      style={{
        display: "flex",
        "align-items": "center",
        gap: "var(--s-2)",
        padding: "var(--s-2) var(--s-3)",
        "min-height": "32px",
      }}
    >
      <span class="t-caption label-tertiary">v{store.version}</span>
      <div style={{ flex: 1 }} />
      {/* Explicit width — without it, SegmentedControl's flex children fall
          back to intrinsic content widths and lose equal sizing. */}
      <div style={{ width: "192px", "flex-shrink": 0 }}>
        <SegmentedControl<Mode>
          value={store.mode}
          onChange={setMode}
          options={[
            { value: "mini", label: t().mini },
            { value: "normal", label: t().normal },
            { value: "detail", label: t().detail },
          ]}
        />
      </div>
      <button
        class="ring-hover"
        onClick={() => invoke("quit_app").catch(() => {})}
        title={t().quit}
        style={{
          width: "26px",
          height: "26px",
          "border-radius": "8px",
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          color: "var(--label-tertiary)",
        }}
      >
        <X size={14} />
      </button>
    </footer>
  );
}
