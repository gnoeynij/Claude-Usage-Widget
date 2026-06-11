import { Settings as SettingsIcon, RefreshCw } from "lucide-solid";
import { Show } from "solid-js";
import { store, syncNow, toggleSettings } from "../state/store";
import { t } from "../i18n";
import { startWindowDrag } from "../utils/drag";

function updateDotLabel() {
  const v = store.updateInfo?.version;
  if (store.updateStatus === "ready" && v) return t().updateReady;
  if (store.updateStatus === "downloading" && v) return t().updateDownloading;
  if (v) return t().updateNewVersion(v);
  return t().updateAvailable;
}

function statusDotColor() {
  // Touch tickMinute so the dot color recomputes every minute as the last
  // sync drifts further into the past.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  store.tickMinute;
  if (store.syncing) return "var(--accent)";
  if (store.syncError) return "var(--danger)";
  if (!store.lastSyncAt) return "var(--label-quaternary)";
  const ageMin =
    (Date.now() - new Date(store.lastSyncAt).getTime()) / 60_000;
  // Scale freshness to the sync cadence so a healthy auto-sync never reads as
  // "stale". Hardcoded 5/30 made the dot grey for the back half of every
  // interval >5min (e.g. minutes 5–10 at the 10min setting). +1min grace
  // covers the scheduled sync firing and completing.
  const interval = store.syncIntervalMin;
  if (interval > 0) {
    if (ageMin < interval + 1) return "var(--success-dim)";
    if (ageMin < interval * 2 + 1) return "var(--label-secondary)";
    return "var(--label-tertiary)";
  }
  // Auto-sync off: freshness is on the user, keep the absolute-age fade.
  if (ageMin < 5) return "var(--success-dim)";
  if (ageMin < 30) return "var(--label-secondary)";
  return "var(--label-tertiary)";
}

function statusTooltip() {
  if (store.syncing) return t().syncing;
  if (store.syncError) return t().syncFailed;
  if (store.lastSyncAt) {
    const d = new Date(store.lastSyncAt);
    return `${t().lastSync} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return t().never;
}

export function HeaderBar() {
  return (
    <header
      class="drag"
      data-tauri-drag-region
      onMouseDown={startWindowDrag}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "var(--s-2)",
        padding: "var(--s-1) var(--s-2)",
        "min-height": "22px",
      }}
    >
      <span
        title={statusTooltip()}
        data-guide="status"
        style={{
          width: "8px",
          height: "8px",
          "border-radius": "50%",
          background: statusDotColor(),
          "flex-shrink": 0,
          transition: "background var(--dur-fast) var(--ease-smooth)",
          "box-shadow": store.syncing
            ? "0 0 0 4px rgba(217,119,87,0.20)"
            : "none",
        }}
      />
      <span
        class="t-body label-secondary"
        style={{ flex: 1, "font-weight": 500 }}
      >
        Claude
      </span>
      <button
        class="no-drag ring-hover"
        data-guide="sync"
        onClick={() => void syncNow()}
        title={t().syncNow}
        style={{
          width: "20px",
          height: "20px",
          "border-radius": "6px",
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          color: "var(--label-secondary)",
        }}
      >
        <RefreshCw size={12} class={store.syncing ? "spin" : ""} />
      </button>
      <button
        class="no-drag ring-hover"
        data-guide="settings"
        onClick={toggleSettings}
        title={t().settings}
        style={{
          position: "relative",
          width: "20px",
          height: "20px",
          "border-radius": "6px",
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          color: store.settingsOpen ? "var(--accent)" : "var(--label-tertiary)",
          background: store.settingsOpen ? "var(--accent-tint)" : undefined,
        }}
      >
        <SettingsIcon size={12} />
        <Show
          when={
            store.updateStatus === "available" ||
            store.updateStatus === "downloading" ||
            store.updateStatus === "ready"
          }
        >
          <span
            title={updateDotLabel()}
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "6px",
              height: "6px",
              "border-radius": "50%",
              background: "var(--accent)",
              "box-shadow": "0 0 0 1.5px var(--bg-elevated, rgba(0,0,0,0.4))",
              "pointer-events": "none",
            }}
          />
        </Show>
      </button>
    </header>
  );
}
