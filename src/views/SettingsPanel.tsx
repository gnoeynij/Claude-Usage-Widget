import { createSignal, onCleanup, onMount, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { warn } from "@tauri-apps/plugin-log";
import { RefreshCw, X, BookOpen } from "lucide-solid";
import { Switch } from "../components/Switch";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  store,
  setStore,
  setLang,
  setTheme,
  setDark,
  setAlwaysOnTop,
  setSyncIntervalMin,
  setOpacity,
  setSyncFolder,
  detectSyncFolders,
  planLabel,
  type Lang,
  type Theme,
} from "../state/store";
import { checkForUpdate, installUpdate } from "../state/updater";
import { formatCost } from "../utils/format";
import { t } from "../i18n";

/** Apple-style inset group: caps label above a filled card of hairline rows. */
function Group(props: { label: string; children: JSX.Element; guide?: string }) {
  return (
    <div
      data-guide={props.guide}
      style={{ display: "flex", "flex-direction": "column", gap: "6px" }}
    >
      <div class="t-section">{props.label}</div>
      <div class="inset-group">{props.children}</div>
    </div>
  );
}

function SwitchRow(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div class="inset-row">
      <span class="t-body">{props.label}</span>
      <Switch checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

function close() {
  setStore("settingsOpen", false);
}

function UpdateRows() {
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
    <>
      <Show when={store.updateStatus === "idle"}>
        <button
          class="inset-row ring-hover"
          data-guide="set-update"
          onClick={() => void onClickCheck()}
        >
          <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
            <RefreshCw size={12} />
            <span class="t-body">{t().checkForUpdates}</span>
          </span>
          <span class="t-caption label-tertiary tabular-nums">v{store.version}</span>
        </button>
        <Show when={flash() === "up_to_date"}>
          <div class="inset-row">
            <span class="t-caption label-secondary">{t().updateUpToDate(store.version)}</span>
          </div>
        </Show>
        <Show when={flash() === "error"}>
          <div class="inset-row">
            <span class="t-caption" style={{ color: "var(--danger)" }}>
              {t().updateError}
            </span>
          </div>
        </Show>
      </Show>

      <Show when={store.updateStatus === "checking"}>
        <div class="inset-row">
          <span
            class="t-body label-secondary"
            style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}
          >
            <RefreshCw size={12} class="spin" />
            {t().updateChecking}
          </span>
        </div>
      </Show>

      <Show
        when={
          store.updateStatus === "available" ||
          store.updateStatus === "downloading"
        }
      >
        <div class="inset-row inset-row--stack">
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
              background: "var(--fill-2)",
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
        <div class="inset-row inset-row--stack">
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
        <div class="inset-row inset-row--stack">
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
              background: "var(--fill-3)",
              color: "var(--label-secondary)",
              "align-self": "flex-start",
            }}
          >
            <RefreshCw size={12} />
            <span class="t-body">{t().checkForUpdates}</span>
          </button>
        </div>
      </Show>
    </>
  );
}

function DeviceSyncRows() {
  const [detected, setDetected] = createSignal<string[]>([]);
  const [manual, setManual] = createSignal("");
  onMount(() => {
    void detectSyncFolders().then(setDetected).catch(() => {});
  });
  const pick = (p: string) => {
    const v = p.trim();
    if (v) setSyncFolder(v);
  };
  // Row shows just the folder name — the full path lives in the tooltip so
  // the group isn't dominated by a wrapped path string.
  const folderName = () =>
    store.syncFolder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? store.syncFolder;
  return (
    <Show
      when={store.syncFolder}
      fallback={
        <>
          <div class="inset-row">
            <span class="t-caption label-tertiary">{t().deviceSyncHint}</span>
          </div>
          <For each={detected()}>
            {(f) => (
              <button class="inset-row ring-hover" onClick={() => pick(f)}>
                <span class="t-caption" style={{ "word-break": "break-all" }}>{f}</span>
              </button>
            )}
          </For>
          <div class="inset-row">
            <input
              type="text"
              placeholder={t().folderManual}
              value={manual()}
              onInput={(e) => setManual(e.currentTarget.value)}
              onChange={(e) => pick(e.currentTarget.value)}
              style={{
                flex: 1,
                padding: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--label)",
              }}
            />
          </div>
        </>
      }
    >
      <div class="inset-row" title={store.syncFolder}>
        <span class="t-body">{folderName()}</span>
        <Show when={store.combinedDevices > 0}>
          <span class="t-caption label-tertiary tabular-nums">
            {t().deviceCount(store.combinedDevices)} · {formatCost(store.combinedCost)}
          </span>
        </Show>
      </div>
      <button class="inset-row ring-hover" onClick={() => setSyncFolder("")}>
        <span class="t-caption label-secondary">{t().disableSync}</span>
      </button>
    </Show>
  );
}

export function SettingsPanel() {
  // Close on ESC for visionOS-style "press to dismiss" feel.
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  onMount(() => window.addEventListener("keydown", handleKey));
  onCleanup(() => window.removeEventListener("keydown", handleKey));

  // Launch-at-login: the OS entry (registry Run key / LaunchAgent) is the
  // source of truth, so read it on every panel open instead of persisting a
  // shadow copy that could drift when the user toggles it from the OS side.
  const [autoStart, setAutoStart] = createSignal(false);
  onMount(() => {
    void isAutostartEnabled()
      .then(setAutoStart)
      .catch((e) => void warn(`autostart read failed: ${String(e)}`));
  });
  async function toggleAutoStart(on: boolean) {
    setAutoStart(on); // optimistic — reverted below if the plugin call fails
    try {
      if (on) await enableAutostart();
      else await disableAutostart();
      setAutoStart(await isAutostartEnabled());
    } catch (e) {
      void warn(`autostart toggle failed: ${String(e)}`);
      setAutoStart(!on);
    }
  }

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
        background: "var(--scrim-bg)",
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
          // Scrolling lives on the inner wrapper below, not the card: a
          // scrollbar on the card itself runs through the rounded corners
          // and the ::before specular outline, hugging the outer edge.
          overflow: "hidden",
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
          <div style={{ display: "flex", "align-items": "center", gap: "var(--s-2)" }}>
            <span class="t-headline">{t().settings}</span>
            <Show when={planLabel(store.plan)}>
              {(label) => (
                <span
                  class="pill-accent"
                  data-guide="set-plan"
                  title={t().plan}
                  style={{
                    height: "var(--text-headline-lh)",
                    "box-sizing": "border-box",
                    "white-space": "nowrap",
                  }}
                >
                  {label()}
                </span>
              )}
            </Show>
          </div>
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

        {/* Scroll region — header above stays pinned; the bar renders inside
            the card's right padding, clear of the rounded corners. min-height
            0 lets the flex child actually shrink below content height.
            overflow-x must be explicit: with overflow-y:auto alone the spec
            computes x:visible → auto, so the vertical bar's width steal
            spawned a permanent horizontal scrollbar. */}
        <div
          style={{
            flex: 1,
            "min-height": 0,
            "overflow-y": "auto",
            "overflow-x": "hidden",
            display: "flex",
            "flex-direction": "column",
            gap: "var(--s-3)",
          }}
        >
          <Group label={t().groupAppearance} guide="set-appearance">
            <div class="inset-row">
              <span class="t-body">{t().theme}</span>
              <SegmentedControl<Theme>
                value={store.theme}
                onChange={setTheme}
                options={[
                  { value: "glass", label: t().themeGlass },
                  { value: "instrument", label: t().themeInstrument },
                ]}
              />
            </div>
            <SwitchRow label={t().darkMode} checked={store.dark} onChange={setDark} />
            <SwitchRow
              label={t().alwaysOnTop}
              checked={store.alwaysOnTop}
              onChange={(v) => void setAlwaysOnTop(v)}
            />
            <div class="inset-row inset-row--stack">
              <span class="t-body">{t().opacity}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={store.opacity}
                onInput={(e) => setOpacity(Number(e.currentTarget.value))}
              />
            </div>
          </Group>

          <Group label={t().groupGeneral} guide="set-general">
            <div class="inset-row">
              <span class="t-body">{t().language}</span>
              <SegmentedControl<Lang>
                value={store.lang}
                onChange={setLang}
                options={[
                  { value: "en", label: "English" },
                  { value: "ko", label: "한국어" },
                ]}
              />
            </div>
            <div class="inset-row inset-row--stack">
              <span class="t-body">{t().autoSync}</span>
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
            </div>
            <SwitchRow
              label={t().autoStart}
              checked={autoStart()}
              onChange={(v) => void toggleAutoStart(v)}
            />
          </Group>

          <Group label={t().deviceSync} guide="set-device-sync">
            <DeviceSyncRows />
          </Group>

          <Group label={t().groupAbout}>
            <button
              class="inset-row ring-hover"
              data-guide="set-guide"
              onClick={() =>
                void invoke("open_guide_window", { lang: store.lang, dark: store.dark, theme: store.theme })
              }
            >
              <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                <BookOpen size={12} />
                <span class="t-body">{t().guide}</span>
              </span>
            </button>
            <UpdateRows />
          </Group>
        </div>
      </div>
    </div>
  );
}
