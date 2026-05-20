import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Mode = "mini" | "normal" | "detail";
export type Lang = "en" | "ko";
export type ErrorCode =
  | "TOKEN_EXPIRED"
  | "NO_CREDENTIALS"
  | "RATE_LIMITED"
  | "NETWORK"
  | null;

export type UsagePayload = {
  five_hour: number;
  seven_day: number;
  seven_day_sonnet: number;
  session_resets_at?: string | null;
  weekly_resets_at?: string | null;
};

export type DetailActive = {
  start: string;
  cost_usd: number;
  elapsed_min: number;
  remaining_min: number;
  total_min: number;
};

export type DetailPeriods = {
  today_cost: number;
  yesterday_cost: number;
  week_cost: number;
  month_cost: number;
};

export type DetailBlock = {
  start: string;
  cost_usd: number;
};

export type DetailFamily = {
  family: string;
  cost: number;
  tokens: number;
};

export type DetailStats = {
  total_cost: number;
  total_messages: number;
  avg_block_cost: number;
  cache_hit_pct: number;
};

export type DetailPayload = {
  active: DetailActive | null;
  peak_block_cost: number;
  periods: DetailPeriods;
  recent: DetailBlock[];
  by_family: DetailFamily[];
  stats: DetailStats;
};

type StoreShape = {
  mode: Mode;
  lang: Lang;
  dark: boolean;
  alwaysOnTop: boolean;
  syncIntervalMin: number;
  opacity: number;
  settingsOpen: boolean;
  usage: UsagePayload;
  detail: DetailPayload | null;
  lastSyncAt: string | null;
  syncing: boolean;
  syncError: string | null;
  errorCode: ErrorCode;
  version: string;
  /** Increments every 60s so reactive consumers (e.g. the header status
   *  dot) can fade based on the age of `lastSyncAt` without needing their
   *  own timer. */
  tickMinute: number;
};

const [store, setStore] = createStore<StoreShape>({
  mode: "normal",
  lang: "en",
  dark: false,
  alwaysOnTop: false,
  syncIntervalMin: 5,
  opacity: 0,
  settingsOpen: false,
  usage: { five_hour: 0, seven_day: 0, seven_day_sonnet: 0 },
  detail: null,
  lastSyncAt: null,
  syncing: false,
  syncError: null,
  errorCode: null,
  version: "2.0.0-alpha.1",
  tickMinute: 0,
});

export { store, setStore };

let syncTimer: number | null = null;
let lastCredentialsMtime: number | null = null;

function parseErrorCode(message: string): ErrorCode {
  // Rust errors come through as `String(e)` — e.g. `"TOKEN_EXPIRED"`. anyhow's
  // Display preserves the bare message we set in usage_api.rs, but be lenient
  // about leading namespace prefixes that some Tauri builds prepend.
  if (message.includes("TOKEN_EXPIRED")) return "TOKEN_EXPIRED";
  if (message.includes("NO_CREDENTIALS")) return "NO_CREDENTIALS";
  if (message.includes("RATE_LIMITED")) return "RATE_LIMITED";
  if (
    message.includes("network error") ||
    message.includes("timeout") ||
    message.includes("dns")
  ) {
    return "NETWORK";
  }
  return null;
}

export async function initStore() {
  // Best-effort one-shot migration from the legacy QSettings registry keys.
  try {
    await invoke<boolean>("run_migration");
  } catch {
    /* migration is non-fatal */
  }
  applyDarkClass(store.dark);
  document.documentElement.lang = store.lang;

  // Tray menu → frontend bridge
  await listen<string>("tray://mode", (e) => {
    const v = e.payload;
    if (v === "mini" || v === "normal" || v === "detail") setMode(v);
  });
  await listen("tray://sync", () => {
    void syncNow();
  });

  // Minute heartbeat for time-based UI (header dot freshness, "X min ago"
  // labels). Independent of sync — never causes network traffic.
  window.setInterval(() => setStore("tickMinute", (v) => v + 1), 60_000);

  // Watch `.credentials.json` for refresh events. When Claude Code CLI
  // rotates the token, mtime changes — that's our signal to retry a failed
  // sync without waiting for the next auto-sync interval. Read-only.
  window.setInterval(() => void pollCredentialsMtime(), 60_000);
  void pollCredentialsMtime(true);

  await syncNow();
  scheduleAutoSync();
}

async function pollCredentialsMtime(initial = false) {
  try {
    const mtime = await invoke<number | null>("credentials_mtime");
    if (mtime == null) return;
    if (initial) {
      lastCredentialsMtime = mtime;
      return;
    }
    if (lastCredentialsMtime != null && mtime > lastCredentialsMtime) {
      lastCredentialsMtime = mtime;
      // Token file was refreshed — retry immediately even if the prior sync
      // had failed with TOKEN_EXPIRED.
      void syncNow();
    } else {
      lastCredentialsMtime = mtime;
    }
  } catch {
    /* polling is best-effort */
  }
}

export async function syncNow() {
  if (store.syncing) return;
  setStore("syncing", true);
  setStore("syncError", null);
  setStore("errorCode", null);
  try {
    const usage = await invoke<UsagePayload>("fetch_usage");
    setStore("usage", usage);
    setStore("lastSyncAt", new Date().toISOString());
    if (store.mode === "detail") {
      await refreshDetail();
    }
  } catch (e) {
    const msg = String(e);
    setStore("syncError", msg);
    setStore("errorCode", parseErrorCode(msg));
  } finally {
    setStore("syncing", false);
  }
}

export function setMode(mode: Mode) {
  setStore("mode", mode);
  if (mode === "detail") {
    void refreshDetail();
  }
}

export async function refreshDetail() {
  try {
    const detail = await invoke<DetailPayload>("aggregate_detail");
    setStore("detail", detail);
  } catch (e) {
    setStore("syncError", String(e));
  }
}

export function toggleSettings() {
  setStore("settingsOpen", (v) => !v);
}

export function setDark(value: boolean) {
  setStore("dark", value);
  applyDarkClass(value);
}

export function setLang(value: Lang) {
  setStore("lang", value);
  document.documentElement.lang = value;
}

export async function setAlwaysOnTop(value: boolean) {
  setStore("alwaysOnTop", value);
  try {
    await invoke("set_always_on_top", { value });
  } catch (e) {
    console.error(e);
  }
}

export function setSyncIntervalMin(minutes: number) {
  setStore("syncIntervalMin", minutes);
  scheduleAutoSync();
}

export function setOpacity(opacityPct: number) {
  const clamped = Math.max(0, Math.min(100, opacityPct));
  setStore("opacity", clamped);
  // OS-level whole-window alpha — same behavior as v1.5.x setWindowOpacity.
  // The Rust side toggles WS_EX_LAYERED + SetLayeredWindowAttributes; at 0%
  // the layered bit is removed so Mica/Acrylic vibrancy paints normally.
  const alpha = Math.max(0.15, 1 - clamped / 100);
  void invoke("set_window_opacity", { value: alpha }).catch(() => {});
  // Clean up any css-level fallbacks from previous builds.
  document.documentElement.style.opacity = "";
  document.documentElement.style.removeProperty("--blur-mult");
}

function applyDarkClass(dark: boolean) {
  const html = document.documentElement;
  if (dark) html.classList.add("dark");
  else html.classList.remove("dark");
}

function scheduleAutoSync() {
  if (syncTimer != null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  const m = store.syncIntervalMin;
  if (m > 0) {
    syncTimer = window.setInterval(() => void syncNow(), m * 60_000);
  }
}
