import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store as TauriStore } from "@tauri-apps/plugin-store";
import { info, warn } from "@tauri-apps/plugin-log";
import { checkForUpdate } from "./updater";
import { toErrorMessage } from "../utils/error";

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

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdateInfo = {
  version: string;
  notes?: string;
  date?: string;
};

export type ModeSize = { w: number; h: number };
export type ModeSizes = Record<Mode, ModeSize | null>;

/** Per-mode default (w, h, minW, minH). Mini covers donut + 2 capsule rows.
 *  Normal keeps the historical 360×420. Detail's width clears the 560px
 *  container-query breakpoint that switches the detail grid to 2 columns. */
const MODE_DEFAULTS: Record<Mode, [number, number, number, number]> = {
  mini: [240, 112, 240, 112],
  normal: [360, 420, 320, 360],
  detail: [600, 680, 520, 520],
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
  updateStatus: UpdateStatus;
  updateInfo: UpdateInfo | null;
  updateDownloadPct: number;
  modeSizes: ModeSizes;
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
  updateStatus: "idle",
  updateInfo: null,
  updateDownloadPct: 0,
  modeSizes: { mini: null, normal: null, detail: null },
});

export { store, setStore };

let syncTimer: number | null = null;
let lastCredentialsMtime: number | null = null;
// While we're applying a programmatic resize via setMode, suppress the
// onResized listener — otherwise we'd record the *new* mode's auto-resize as
// if the user had dragged the window to that size.
let resizeSuppressUntil = 0;
let resizeDebounce: number | null = null;
let persistStorePromise: Promise<TauriStore> | null = null;

function getPersistStore(): Promise<TauriStore> {
  if (!persistStorePromise) {
    persistStorePromise = TauriStore.load("widget-settings.json");
  }
  return persistStorePromise;
}

async function persistModeSizes() {
  try {
    const ps = await getPersistStore();
    await ps.set("modeSizes", store.modeSizes);
    await ps.save();
  } catch (e) {
    console.error("persist modeSizes failed", e);
  }
}

async function loadModeSizes() {
  try {
    const ps = await getPersistStore();
    const v = await ps.get<ModeSizes>("modeSizes");
    if (v && typeof v === "object") {
      setStore("modeSizes", {
        mini: v.mini ?? null,
        normal: v.normal ?? null,
        detail: v.detail ?? null,
      });
    }
  } catch (e) {
    console.error("load modeSizes failed", e);
  }
}

function applyModeSize(mode: Mode) {
  const saved = store.modeSizes[mode];
  const [dw, dh, mw, mh] = MODE_DEFAULTS[mode];
  const w = saved?.w ?? dw;
  const h = saved?.h ?? dh;
  resizeSuppressUntil = Date.now() + 1000;
  void invoke("set_window_size", {
    width: w,
    height: h,
    minWidth: mw,
    minHeight: mh,
  }).catch((e) => console.error("set_window_size failed", e));
}

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

  // Restore per-mode sizes from disk before wiring the resize listener — we
  // don't want our own load to be picked up as a "user resize".
  await loadModeSizes();

  // Watch user-driven resizes. Debounce so a drag doesn't write 100 times,
  // and ignore any change within ~1s of a programmatic setMode invoke.
  const win = getCurrentWindow();
  await win.onResized(({ payload }) => {
    if (Date.now() < resizeSuppressUntil) return;
    if (resizeDebounce != null) window.clearTimeout(resizeDebounce);
    resizeDebounce = window.setTimeout(async () => {
      try {
        const scale = await win.scaleFactor();
        const w = Math.round(payload.width / scale);
        const h = Math.round(payload.height / scale);
        // Ignore degenerate sizes from minimize/maximize edge events.
        if (w < 100 || h < 100) return;
        setStore("modeSizes", store.mode, { w, h });
        void persistModeSizes();
      } catch (e) {
        console.error("onResized handler failed", e);
      }
    }, 500);
  });

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

  // Apply persisted opacity once on boot so Mica state + CSS mult are in sync
  // with the slider value the user left things at last time.
  setOpacity(store.opacity);

  // Silent auto-check 3s after boot — avoids racing the first usage sync and
  // keeps perceived startup snappy. Errors and "no update" stay silent.
  window.setTimeout(() => void checkForUpdate(false), 3000);
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
  const t0 = Date.now();
  try {
    const usage = await invoke<UsagePayload>("fetch_usage");
    setStore("usage", usage);
    setStore("lastSyncAt", new Date().toISOString());
    if (store.mode === "detail") {
      await refreshDetail();
    }
    // Re-paint tray + taskbar icon with the fresh 5-hour session percent so
    // the gauge in the tray matches the one in the widget. Best-effort —
    // failure is non-fatal (icon stays on previous render).
    void invoke("set_usage_icon", { pct: usage.five_hour }).catch(() => {});
    void info(`sync ok ${Date.now() - t0}ms`);
  } catch (e) {
    const msg = toErrorMessage(e);
    setStore("syncError", msg);
    const code = parseErrorCode(msg);
    setStore("errorCode", code);
    void warn(`sync failed ${Date.now() - t0}ms code=${code ?? "UNKNOWN"} msg=${msg}`);
    // Swap the tray icon to the error state (grey outline + red "!") so the
    // user sees "disconnected" at a glance instead of a stale usage gauge.
    // -1 is the sentinel for render_error() on the Rust side.
    void invoke("set_usage_icon", { pct: -1 }).catch(() => {});
  } finally {
    setStore("syncing", false);
  }
}

export function setMode(mode: Mode) {
  setStore("mode", mode);
  applyModeSize(mode);
  if (mode === "detail") {
    void refreshDetail();
  }
}

export async function refreshDetail() {
  try {
    const detail = await invoke<DetailPayload>("aggregate_detail");
    setStore("detail", detail);
  } catch (e) {
    setStore("syncError", toErrorMessage(e));
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
  // Background-only fade: drive --bg-alpha-mult so glass panel/cards thin
  // out while text/donut/capsule stay fully opaque. Mica toggles in tandem
  // — kept on at 0% (full Liquid Glass) and cleared as soon as the user
  // dials any transparency, otherwise Mica paints the panel white-ish on
  // bright desktops and masks the fade entirely (see 23222cf retro).
  const mult = 1 - clamped / 100;
  document.documentElement.style.setProperty("--bg-alpha-mult", String(mult));
  void invoke("set_mica_enabled", { enabled: clamped === 0 }).catch(() => {});
  // Legacy paths cleaned up (v1.5 CSS opacity + OS-level layered alpha).
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
