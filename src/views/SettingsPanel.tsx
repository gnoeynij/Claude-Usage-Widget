import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { RefreshCw, X } from "lucide-solid";
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
  setBreatheEnabled,
  type Lang,
} from "../state/store";
import { checkForUpdate, installUpdate } from "../state/updater";
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

function UpdateSection() {
  // Ephemeral "최신 버전입니다" toast — only after a manual check finds nothing.
  // The persistent updateStatus reverts to "idle" so we need a local flash
  // to confirm the click actually checked.
  const [flash, setFlash] = createSignal<null | "up_to_date" | "error">(null);
  let flashTimer: number | null = null;
  onCleanup(() => {
    if (flashTimer != null) window.clearTimeout(flashTimer);
  });

  async function onClickCheck() {
    const result = await checkForUpdate(true);
    if (result === "up_to_date" || result === "error") {
      setFlash(result);
      if (flashTimer != null) window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => setFlash(null), 3000);
    }
  }

  return (
    <Section label={t().checkForUpdates}>
      <Show when={store.updateStatus === "idle"}>
        <button
          class="ring-hover"
          onClick={() => void onClickCheck()}
          style={{
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "6px",
            padding: "6px 10px",
            "border-radius": "8px",
            background: "var(--accent-tint)",
            color: "var(--accent)",
            "font-weight": 500,
            "align-self": "flex-start",
          }}
        >
          <RefreshCw size={12} />
          <span class="t-body">{t().checkForUpdates}</span>
        </button>
        <Show when={flash() === "up_to_date"}>
          <span class="t-body label-secondary">{t().updateUpToDate}</span>
        </Show>
        <Show when={flash() === "error"}>
          <span class="t-body" style={{ color: "var(--danger)" }}>
            {t().updateError}
          </span>
        </Show>
      </Show>

      <Show when={store.updateStatus === "checking"}>
        <span
          class="t-body label-secondary"
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <RefreshCw size={12} class="spin" />
          {t().updateChecking}
        </span>
      </Show>

      <Show
        when={
          store.updateStatus === "available" ||
          store.updateStatus === "downloading"
        }
      >
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <span class="t-body">
            {store.updateInfo
              ? t().updateNewVersion(store.updateInfo.version)
              : t().updateAvailable}
          </span>
          <div
            style={{
              position: "relative",
              height: "4px",
              "border-radius": "2px",
              background: "var(--fill-tertiary, rgba(255,255,255,0.08))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                width: `${store.updateDownloadPct}%`,
                background: "var(--accent)",
                transition: "width var(--dur-fast) var(--ease-smooth)",
              }}
            />
          </div>
          <span class="t-caption label-tertiary">
            {t().updateDownloading} {store.updateDownloadPct}%
          </span>
        </div>
      </Show>

      <Show when={store.updateStatus === "ready"}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <span class="t-body">
            {store.updateInfo
              ? t().updateNewVersion(store.updateInfo.version)
              : t().updateReady}
          </span>
          <button
            class="ring-hover"
            onClick={() => void installUpdate()}
            style={{
              display: "inline-flex",
              "align-items": "center",
              "justify-content": "center",
              padding: "6px 10px",
              "border-radius": "8px",
              background: "var(--accent)",
              color: "white",
              "font-weight": 500,
              "align-self": "flex-start",
            }}
          >
            <span class="t-body">{t().updateRestart}</span>
          </button>
        </div>
      </Show>

      <Show when={store.updateStatus === "error"}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <span class="t-body" style={{ color: "var(--danger)" }}>
            {t().updateError}
          </span>
          <button
            class="ring-hover"
            onClick={() => void onClickCheck()}
            style={{
              display: "inline-flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "6px",
              padding: "6px 10px",
              "border-radius": "8px",
              background: "var(--accent-tint)",
              color: "var(--accent)",
              "font-weight": 500,
              "align-self": "flex-start",
            }}
          >
            <RefreshCw size={12} />
            <span class="t-body">{t().checkForUpdates}</span>
          </button>
        </div>
      </Show>
    </Section>
  );
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
        <SwitchRow
          label={t().breathe}
          checked={store.breatheEnabled}
          onChange={setBreatheEnabled}
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
        <UpdateSection />
      </div>
    </div>
  );
}
