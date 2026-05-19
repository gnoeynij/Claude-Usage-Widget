import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { X } from "lucide-solid";
import { Switch } from "../components/Switch";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  store,
  setStore,
  setLang,
  setDark,
  setAlwaysOnTop,
  setSyncIntervalMin,
  setOpacity,
  type Lang,
} from "../state/store";
import { t } from "../i18n";

function Section(props: { label: string; children: JSX.Element }) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "6px",
      }}
    >
      <div class="t-section">{props.label}</div>
      {props.children}
    </div>
  );
}

function SwitchRow(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
      }}
    >
      <span class="t-body">{props.label}</span>
      <Switch checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

function close() {
  setStore("settingsOpen", false);
}

export function SettingsPanel() {
  // Close on ESC for visionOS-style "press to dismiss" feel.
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  onMount(() => window.addEventListener("keydown", handleKey));
  onCleanup(() => window.removeEventListener("keydown", handleKey));

  return (
    <div
      class="fade-in"
      onClick={close}
      style={{
        position: "absolute",
        inset: 0,
        "z-index": 20,
        display: "flex",
        // column direction makes `flex: 1` on the inner glass-card grow along
        // the height axis (main axis), so it fills the whole widget rather
        // than collapsing to its content height and leaking the view behind.
        "flex-direction": "column",
        padding: "var(--s-2)",
        background: "rgba(0, 0, 0, 0.32)",
        "backdrop-filter": "blur(12px) saturate(140%)",
        "-webkit-backdrop-filter": "blur(12px) saturate(140%)",
        "border-radius": "inherit",
      }}
    >
      <div
        class="glass-card panel-reveal"
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: "flex",
          "flex-direction": "column",
          gap: "var(--s-3)",
          padding: "var(--s-3) var(--s-4)",
          "max-height": "100%",
          "overflow-y": "auto",
        }}
      >
        {/* Header row — title + close button as normal flex children so the
            X's visual rectangle equals its hit rectangle (no absolute drift). */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "var(--s-2)",
          }}
        >
          <span class="t-headline">{t().settings}</span>
          <button
            class="ring-hover"
            onClick={close}
            title={t().quit}
            style={{
              width: "28px",
              height: "28px",
              padding: 0,
              "line-height": 0,
              "border-radius": "8px",
              display: "inline-flex",
              "align-items": "center",
              "justify-content": "center",
              color: "var(--label-secondary)",
              "flex-shrink": 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        <Section label={t().language}>
          <SegmentedControl<Lang>
            value={store.lang}
            onChange={setLang}
            options={[
              { value: "en", label: "English" },
              { value: "ko", label: "한국어" },
            ]}
          />
        </Section>
        <Section label={t().autoSync}>
          <SegmentedControl
            value={String(store.syncIntervalMin)}
            onChange={(v) => setSyncIntervalMin(Number(v))}
            options={[
              { value: "0", label: t().off },
              { value: "5", label: t().m5 },
              { value: "10", label: t().m10 },
              { value: "30", label: t().m30 },
              { value: "60", label: t().h1 },
            ]}
          />
        </Section>
        <SwitchRow
          label={t().alwaysOnTop}
          checked={store.alwaysOnTop}
          onChange={(v) => void setAlwaysOnTop(v)}
        />
        <SwitchRow
          label={t().darkMode}
          checked={store.dark}
          onChange={setDark}
        />
        <Section label={t().opacity}>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={store.opacity}
            onInput={(e) => setOpacity(Number(e.currentTarget.value))}
          />
        </Section>
      </div>
    </div>
  );
}
