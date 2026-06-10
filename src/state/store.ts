import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store as TauriStore } from "@tauri-apps/plugin-store";
import { info, warn } from "@tauri-apps/plugin-log";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { checkForUpdate } from "./updater";
import { toErrorMessage } from "../utils/error";
import { t } from "../i18n";

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
  /** Opus-specific weekly cap; null when the plan has none (row hidden). */
  seven_day_opus?: number | null;
  /** 2026-06-15 separate-credit pool; shown only when enabled. */
  extra_usage_enabled?: boolean;
  extra_usage?: number | null;
  session_resets_at?: string | null;
  weekly_resets_at?: string | null;
};

export type PlanPayload = {
  subscription_type: string | null;
  rate_limit_tier: string | null;
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
  new_cost_since: number;
  max_ts_ms: number;
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

/** Transient in-widget Liquid Glass toast — used for usage-threshold alerts
 *  while the widget is on screen; OS notifications cover the tray-hidden case. */
export type Toast = { id: number; title: string; body: string; tone: "warn" | "danger" };

/** Per-mode default (w, h, minW, minH). Mini covers donut + 2 capsule rows.
 *  Normal keeps the historical 360×420. Detail's width clears the 560px
 *  container-query breakpoint that switches the detail grid to 2 columns. */
const MODE_DEFAULTS: Record<Mode, [number, number, number, number]> = {
  mini: [240, 112, 240, 112],
  normal: [320, 360, 320, 360],
  detail: [592, 619, 520, 520],
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
  plan: PlanPayload | null;
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
  /** Increments every 1s for live countdowns (session reset, active block).
   *  Only consumers that read it re-render (Solid fine-grained), so the cost
   *  is one timer + a couple of text nodes. */
  tickSecond: number;
  /** Non-decreasing per-device lifetime cost — sum of every record ever seen,
   *  kept even after their JSONL files are cleaned. Accumulated incrementally
   *  via lifetimeCountedUntilMs. */
  lifetimeCost: number;
  /** Newest record ts (ms) already folded into lifetimeCost. */
  lifetimeCountedUntilMs: number;
  /** Stable per-device id (generated once) for cross-device combining. */
  deviceId: string;
  /** Shared cloud-synced folder for cross-device combining ("" = off). */
  syncFolder: string;
  /** Combined lifetime cost across all devices in syncFolder (0 when off). */
  combinedCost: number;
  combinedDevices: number;
  updateStatus: UpdateStatus;
  updateInfo: UpdateInfo | null;
  updateDownloadPct: number;
  modeSizes: ModeSizes;
  /** Per-session-block memory of which 85% / 95% thresholds already fired,
   *  so the OS notification doesn't repeat on every sync. Reset when
   *  `usage.session_resets_at` changes (new 5h block started). Notification
   *  enable/disable itself is the OS's responsibility — no widget-side
   *  toggle since v2.1.0+. */
  notifiedBlock: string | null;
  notifiedLevels: number[]; // e.g. [85] or [85, 95]
  /** Same shape, but for the 7-day weekly limit (`usage.seven_day` +
   *  `weekly_resets_at`). Tracked separately so a fresh weekly window
   *  doesn't clear pending session notifications and vice versa. */
  notifiedWeek: string | null;
  notifiedWeekLevels: number[];
  /** Active in-widget toasts (transient — not persisted). */
  toasts: Toast[];
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
  plan: null,
  detail: null,
  lastSyncAt: null,
  syncing: false,
  syncError: null,
  errorCode: null,
  version: "2.2.0",
  tickMinute: 0,
  tickSecond: 0,
  lifetimeCost: 0,
  lifetimeCountedUntilMs: 0,
  deviceId: "",
  syncFolder: "",
  combinedCost: 0,
  combinedDevices: 0,
  updateStatus: "idle",
  updateInfo: null,
  updateDownloadPct: 0,
  modeSizes: { mini: null, normal: null, detail: null },
  notifiedBlock: null,
  notifiedLevels: [],
  notifiedWeek: null,
  notifiedWeekLevels: [],
  toasts: [],
});

export { store, setStore };

/** Human-readable plan label, e.g. "Max 20×", or null when not signed in.
 *  A `rate_limit_tier` like "default_claude_max_20x" supplies the "20×". */
export function planLabel(p: PlanPayload | null): string | null {
  const raw = p?.subscription_type;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const name =
    lower === "max" ? "Max"
    : lower === "pro" ? "Pro"
    : lower === "free" ? "Free"
    : lower === "team" ? "Team"
    : lower === "enterprise" ? "Enterprise"
    : raw.charAt(0).toUpperCase() + raw.slice(1);
  const mult = p?.rate_limit_tier?.match(/(\d+)x/i)?.[1];
  return mult ? `${name} ${mult}×` : name;
}

let syncTimer: number | null = null;
let lastCredentialsMtime: number | null = null;
// While we're applying a programmatic resize via setMode, suppress the
// onResized listener — otherwise we'd record the *new* mode's auto-resize as
// if the user had dragged the window to that size.
let resizeSuppressUntil = 0;
let resizeDebounce: number | null = null;
let persistStorePromise: Promise<TauriStore> | null = null;

// macOS WKWebView 는 wry `transparent` feature (macos-private-api opt-in) 가
// 켜졌을 때 `drawsBackground=NO` 로 진짜 transparent 가 되지만, content
// (text/donut) 도 desktop blending 으로 invisible 해지는 부작용이 있다.
// `--bg-alpha-mult` 의 minimum floor 를 둬서 panel 이 약하게 paint 되어
// content layer 가 anchor 되도록 한다. Windows WebView2 는 다르게 합성하므로
// floor 0. 회고: docs/sessions/2026-05-24-macos-opacity-attempts.md 8차.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const MAC_FLOOR_LIGHT = 0.05;
const MAC_FLOOR_DARK = 0.3;

function effectiveBgAlphaMult(opacityPct: number, dark: boolean): number {
  const raw = 1 - opacityPct / 100;
  if (!IS_MAC) return raw;
  const floor = dark ? MAC_FLOOR_DARK : MAC_FLOOR_LIGHT;
  return Math.max(floor, raw);
}

function getPersistStore(): Promise<TauriStore> {
  if (!persistStorePromise) {
    persistStorePromise = TauriStore.load("widget-settings.json");
  }
  return persistStorePromise;
}

async function persistSetting<K extends keyof StoreShape>(
  key: K,
  value: StoreShape[K],
) {
  try {
    const ps = await getPersistStore();
    await ps.set(key as string, value);
    await ps.save();
  } catch (e) {
    console.error(`persist ${String(key)} failed`, e);
  }
}

async function loadSetting<T>(
  key: string,
  apply: (v: T) => void,
  validate?: (v: unknown) => v is T,
) {
  try {
    const ps = await getPersistStore();
    const v = await ps.get<T>(key);
    if (v === undefined || v === null) return;
    if (validate && !validate(v)) return;
    apply(v);
  } catch (e) {
    console.error(`load ${key} failed`, e);
  }
}

async function persistModeSizes() {
  return persistSetting("modeSizes", store.modeSizes);
}

const NOTIFY_LEVELS = [85, 95] as const;

// Session-scoped flag: once the OS reports `denied`, don't keep re-prompting
// every sync. The user can change the decision in OS Settings; we'll pick it
// up on the next widget restart (isPermissionGranted will re-read OS state).
let notificationPermissionDenied = false;

type NotifyScope = "session" | "weekly";

type ScopeKeys = {
  block: "notifiedBlock" | "notifiedWeek";
  levels: "notifiedLevels" | "notifiedWeekLevels";
};

const SCOPE_KEYS: Record<NotifyScope, ScopeKeys> = {
  session: { block: "notifiedBlock", levels: "notifiedLevels" },
  weekly: { block: "notifiedWeek", levels: "notifiedWeekLevels" },
};

/** Determine which thresholds need firing for a scope and roll the
 *  fired-list forward when a new block starts. Returns the levels actually
 *  due to fire (after dedup), or [] if nothing is pending. */
function pickDueAndReset(
  scope: NotifyScope,
  pct: number,
  blockId: string | null | undefined,
): number[] {
  const block = blockId ?? null;
  if (block === null) return [];
  const keys = SCOPE_KEYS[scope];
  if (block !== store[keys.block]) {
    setStore(keys.block, block);
    setStore(keys.levels, []);
    void persistSetting(keys.block, block);
    void persistSetting(keys.levels, []);
  }
  return NOTIFY_LEVELS.filter(
    (level) => pct >= level && !store[keys.levels].includes(level),
  );
}

let toastSeq = 0;
const TOAST_TTL_MS = 6000;

/** Show a transient in-widget toast and auto-dismiss it after TOAST_TTL_MS. */
export function pushToast(title: string, body: string, tone: "warn" | "danger") {
  const id = ++toastSeq;
  setStore("toasts", (ts) => [...ts, { id, title, body, tone }]);
  window.setTimeout(() => dismissToast(id), TOAST_TTL_MS);
}

export function dismissToast(id: number) {
  setStore("toasts", (ts) => ts.filter((toast) => toast.id !== id));
}

function fire(scope: NotifyScope, due: number[], pct: number, hidden: boolean) {
  const isWeekly = scope === "weekly";
  // One sync can cross both thresholds at once (e.g. usage jumps 0% → 100%).
  // Alert only the highest level so the user sees a single toast; the lower
  // levels are still recorded as fired below so they never alert afterwards.
  const level = Math.max(...due);
  const title = isWeekly
    ? t().notifyTitleWeekly(Math.round(pct))
    : t().notifyTitle(Math.round(pct));
  const body = isWeekly
    ? level >= 95
      ? t().notifyBodyWeekly95
      : t().notifyBodyWeekly85
    : level >= 95
      ? t().notifyBody95
      : t().notifyBody85;
  if (hidden) {
    // Widget is in the tray — fall back to an OS notification.
    try {
      sendNotification({ title, body });
    } catch (e) {
      void warn(`notification send failed: ${toErrorMessage(e)}`);
    }
  } else {
    // Widget is on screen — in-widget Liquid Glass toast (matches the
    // widget look, needs no OS permission).
    pushToast(title, body, level >= 95 ? "danger" : "warn");
  }
  void info(
    `threshold fired ${scope} at ${level}% (actual ${pct.toFixed(1)}%, due [${due.join(",")}]) via ${hidden ? "OS" : "toast"}`,
  );
  const keys = SCOPE_KEYS[scope];
  const next = [...store[keys.levels], ...due];
  setStore(keys.levels, next);
  void persistSetting(keys.levels, next);
}

/** Alert when 5h session or 7-day weekly crosses 85% / 95%. Idempotent per
 *  block. While the widget is on screen it shows an in-widget Liquid Glass
 *  toast (no OS permission); when hidden to the tray it falls back to an OS
 *  notification (permission requested lazily on first crossing). */
async function maybeNotifyThreshold(usage: UsagePayload) {
  const sessionDue = pickDueAndReset(
    "session",
    usage.five_hour,
    usage.session_resets_at,
  );
  const weeklyDue = pickDueAndReset(
    "weekly",
    usage.seven_day,
    usage.weekly_resets_at,
  );
  if (sessionDue.length === 0 && weeklyDue.length === 0) return;

  // Visible → in-widget toast; hidden (tray) → OS notification.
  const hidden = typeof document !== "undefined" && document.hidden;

  if (hidden) {
    if (notificationPermissionDenied) return;
    let granted = false;
    try {
      granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
    } catch (e) {
      void warn(`notification permission failed: ${toErrorMessage(e)}`);
      return;
    }
    if (!granted) {
      notificationPermissionDenied = true;
      void info("notification permission denied — won't re-prompt this session");
      return;
    }
  }

  if (sessionDue.length > 0) fire("session", sessionDue, usage.five_hour, hidden);
  if (weeklyDue.length > 0) fire("weekly", weeklyDue, usage.seven_day, hidden);
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

// Boot 시점 setter 호출이 다시 persist 를 트리거하면 read-after-write 가 의미
// 없는 디스크 I/O 가 됨. load 흐름에선 이 플래그가 true 인 동안 persist 를
// skip 한다.
let suppressPersist = false;

// `setDark` 가 사용자에 의해 호출됐는지 (boot load / OS 자동 감지 가 아닌)
// 추적. true 가 되면 prefers-color-scheme watcher 가 OS 변경을 무시 — 사용자
// 명시 선택을 덮어쓰지 않는다.
let userTouchedDark = false;

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
  // The Rust side wraps all reqwest send failures as `.context("network
  // error")` and `commands.rs` stringifies via anyhow Display, which only
  // surfaces that top-level context — the underlying timeout/dns text never
  // reaches here, so matching "network error" alone covers every network case.
  if (message.includes("network error")) return "NETWORK";
  return null;
}

export async function initStore() {
  // Restore user preferences from disk before any UI / IPC side-effects fire.
  // suppressPersist prevents the setter chain from writing the same value
  // back to disk (read-after-write loop).
  suppressPersist = true;
  try {
    await loadSetting<Lang>(
      "lang",
      (v) => setLang(v),
      (v): v is Lang => v === "en" || v === "ko",
    );
    // dark: persisted value wins; otherwise follow OS `prefers-color-scheme`.
    // A media-query listener below keeps the widget in sync if the OS theme
    // changes while the widget is running, *unless* the user has explicitly
    // toggled (tracked by `userTouchedDark`).
    let darkApplied = false;
    await loadSetting<boolean>(
      "dark",
      (v) => {
        setDark(v);
        darkApplied = true;
      },
      (v): v is boolean => typeof v === "boolean",
    );
    if (!darkApplied && typeof window.matchMedia === "function") {
      setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    await loadSetting<boolean>(
      "alwaysOnTop",
      (v) => void setAlwaysOnTop(v),
      (v): v is boolean => typeof v === "boolean",
    );
    await loadSetting<number>(
      "syncIntervalMin",
      (v) => setSyncIntervalMin(v),
      (v): v is number => typeof v === "number" && v >= 0,
    );
    // Apply — not just store — so --bg-alpha-mult + Mica are correct on first
    // paint. Deferring this to after the first sync left cards/borders opaque
    // "until I switch modes" (sibling of the main.tsx .mac first-paint note).
    // suppressPersist=true here, so setOpacity won't write the value back.
    await loadSetting<number>(
      "opacity",
      (v) => setOpacity(v),
      (v): v is number => typeof v === "number" && v >= 0 && v <= 100,
    );
    await loadSetting<Mode>(
      "mode",
      (v) => setStore("mode", v),
      (v): v is Mode => v === "mini" || v === "normal" || v === "detail",
    );
  } finally {
    suppressPersist = false;
  }

  // Apply DOM-level defaults *after* lang/dark are restored — setLang/setDark
  // already did this if a stored value was found, but call once more in case
  // neither key was persisted yet (fresh install).
  applyDarkClass(store.dark);
  document.documentElement.lang = store.lang;

  // Plan label — read once from credentials. Independent of token validity,
  // so it still shows in a TOKEN_EXPIRED state. Non-fatal on failure.
  void invoke<PlanPayload>("fetch_plan")
    .then((p) => setStore("plan", p))
    .catch(() => {});

  // Restore per-mode sizes from disk before wiring the resize listener — we
  // don't want our own load to be picked up as a "user resize".
  await loadModeSizes();
  await loadSetting<number>(
    "lifetimeCost",
    (v) => setStore("lifetimeCost", v),
    (v): v is number => typeof v === "number" && v >= 0,
  );
  await loadSetting<number>(
    "lifetimeCountedUntilMs",
    (v) => setStore("lifetimeCountedUntilMs", v),
    (v): v is number => typeof v === "number" && v >= 0,
  );
  await loadSetting<string>(
    "deviceId",
    (v) => setStore("deviceId", v),
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (!store.deviceId) {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    setStore("deviceId", id);
    void persistSetting("deviceId", id);
  }
  await loadSetting<string>(
    "syncFolder",
    (v) => setStore("syncFolder", v),
    (v): v is string => typeof v === "string",
  );
  await loadSetting<string | null>(
    "notifiedBlock",
    (v) => setStore("notifiedBlock", v),
    (v): v is string | null => v === null || typeof v === "string",
  );
  await loadSetting<number[]>(
    "notifiedLevels",
    (v) => setStore("notifiedLevels", v),
    (v): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number"),
  );
  await loadSetting<string | null>(
    "notifiedWeek",
    (v) => setStore("notifiedWeek", v),
    (v): v is string | null => v === null || typeof v === "string",
  );
  await loadSetting<number[]>(
    "notifiedWeekLevels",
    (v) => setStore("notifiedWeekLevels", v),
    (v): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number"),
  );

  // Apply current mode's size on boot — otherwise tauri.conf.json 의 초기
  // 사이즈가 그대로 보임 (사용자 신고: "처음 Normal 화면이 옛 사이즈, 모드
  // 전환해야 정상"). onResized listener 등록 *전*이라 이 호출은 자기 자신을
  // user-resize 로 잘못 기록하지 않음.
  applyModeSize(store.mode);

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

  // Second heartbeat for live countdowns (session reset, active block). Cheap —
  // WebView auto-throttles timers to ~1/min when the window is hidden to tray.
  window.setInterval(() => setStore("tickSecond", (v) => v + 1), 1_000);

  // Watch `.credentials.json` for refresh events. When Claude Code CLI
  // rotates the token, mtime changes — that's our signal to retry a failed
  // sync without waiting for the next auto-sync interval. Read-only.
  window.setInterval(() => void pollCredentialsMtime(), 60_000);
  void pollCredentialsMtime(true);

  await syncNow();
  scheduleAutoSync();

  // Silent auto-check 3s after boot — avoids racing the first usage sync and
  // keeps perceived startup snappy. Errors and "no update" stay silent.
  window.setTimeout(() => void checkForUpdate(false), 3000);

  // Follow OS theme changes unless the user has explicitly picked a theme.
  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = (e: MediaQueryListEvent) => {
      if (userTouchedDark) return;
      setStore("dark", e.matches);
      applyDarkClass(e.matches);
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onSchemeChange);
    }
  }
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
    void maybeNotifyThreshold(usage);
    void invoke("set_tray_state", { state: "ok" }).catch(() => {});
    void info(`sync ok ${Date.now() - t0}ms`);
  } catch (e) {
    const msg = toErrorMessage(e);
    setStore("syncError", msg);
    const code = parseErrorCode(msg);
    setStore("errorCode", code);
    void warn(`sync failed ${Date.now() - t0}ms code=${code ?? "UNKNOWN"} msg=${msg}`);
    void invoke("set_tray_state", { state: "err" }).catch(() => {});
  } finally {
    setStore("syncing", false);
  }
}

export function setMode(mode: Mode) {
  setStore("mode", mode);
  if (!suppressPersist) void persistSetting("mode", mode);
  applyModeSize(mode);
  if (mode === "detail") {
    void refreshDetail();
  }
}

export async function refreshDetail() {
  try {
    const detail = await invoke<DetailPayload>("aggregate_detail", {
      countedUntilMs: store.lifetimeCountedUntilMs,
    });
    setStore("detail", detail);
    // Fold newly-seen cost into the non-decreasing lifetime total. The
    // counted-until guard makes this idempotent across repeated refreshes.
    if (
      detail.new_cost_since > 0 ||
      detail.max_ts_ms > store.lifetimeCountedUntilMs
    ) {
      const next = store.lifetimeCost + detail.new_cost_since;
      setStore("lifetimeCost", next);
      setStore("lifetimeCountedUntilMs", detail.max_ts_ms);
      void persistSetting("lifetimeCost", next);
      void persistSetting("lifetimeCountedUntilMs", detail.max_ts_ms);
    }
    if (store.syncFolder) void syncDevices();
  } catch (e) {
    setStore("syncError", toErrorMessage(e));
  }
}

/** Combined lifetime cost across devices via a shared cloud folder. Writes this
 *  device's total, then sums every device file found in the folder. */
async function syncDevices() {
  if (!store.syncFolder || !store.deviceId) return;
  try {
    const out = await invoke<{ total: number; devices: number }>(
      "sync_device_cost",
      { folder: store.syncFolder, deviceId: store.deviceId, cost: store.lifetimeCost },
    );
    setStore("combinedCost", out.total);
    setStore("combinedDevices", out.devices);
  } catch (e) {
    void warn(`device sync failed: ${toErrorMessage(e)}`);
  }
}

export async function detectSyncFolders(): Promise<string[]> {
  try {
    return await invoke<string[]>("detect_sync_folders");
  } catch {
    return [];
  }
}

export function setSyncFolder(path: string) {
  setStore("syncFolder", path);
  if (!suppressPersist) void persistSetting("syncFolder", path);
  if (path) {
    void syncDevices();
  } else {
    setStore("combinedCost", 0);
    setStore("combinedDevices", 0);
  }
}

export function toggleSettings() {
  setStore("settingsOpen", (v) => !v);
}

export function setDark(value: boolean) {
  setStore("dark", value);
  applyDarkClass(value);
  if (!suppressPersist) {
    userTouchedDark = true;
    void persistSetting("dark", value);
  }
  // macOS floor 가 라이트/다크 분기라 dark toggle 시 mult 재계산 필요.
  // Windows / Linux 는 floor 0 이라 no-op.
  if (IS_MAC) {
    const mult = effectiveBgAlphaMult(store.opacity, value);
    document.documentElement.style.setProperty("--bg-alpha-mult", String(mult));
  }
}

export function setLang(value: Lang) {
  setStore("lang", value);
  document.documentElement.lang = value;
  if (!suppressPersist) void persistSetting("lang", value);
}

export async function setAlwaysOnTop(value: boolean) {
  setStore("alwaysOnTop", value);
  if (!suppressPersist) void persistSetting("alwaysOnTop", value);
  try {
    await invoke("set_always_on_top", { value });
  } catch (e) {
    console.error(e);
  }
}

export function setSyncIntervalMin(minutes: number) {
  setStore("syncIntervalMin", minutes);
  if (!suppressPersist) void persistSetting("syncIntervalMin", minutes);
  scheduleAutoSync();
}

// macOS WKWebView caches the composited layers of isolated stacking contexts
// (.glass-card + its ::before/::after specular layers) and skips re-paint when
// only their alpha — driven by --bg-alpha-mult — changes. A window relayout
// forces the compositor to redraw, which is why changing window *mode* visibly
// restored the opacity ("opaque until I switch modes"). LiquidGlass's
// offsetHeight reflow only revives .glass-panel's own background, not the
// cards. Nudge the window 1px and back (same set_window_size path the mode
// switch uses) to force the redraw. Debounced so a slider drag doesn't resize
// on every input event. macOS-only — Windows WebView2 repaint path is unverified.
let repaintTimer: number | null = null;
function scheduleCompositorRepaint() {
  if (!IS_MAC) return;
  if (repaintTimer != null) window.clearTimeout(repaintTimer);
  repaintTimer = window.setTimeout(async () => {
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const sz = await win.innerSize();
      const w = Math.round(sz.width / scale);
      const h = Math.round(sz.height / scale);
      const [, , mw, mh] = MODE_DEFAULTS[store.mode];
      resizeSuppressUntil = Date.now() + 1000;
      await invoke("set_window_size", { width: w, height: h + 1, minWidth: mw, minHeight: mh });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await invoke("set_window_size", { width: w, height: h, minWidth: mw, minHeight: mh });
    } catch (e) {
      console.error("compositor repaint nudge failed", e);
    }
  }, 90);
}

export function setOpacity(opacityPct: number) {
  const clamped = Math.max(0, Math.min(100, opacityPct));
  setStore("opacity", clamped);
  if (!suppressPersist) void persistSetting("opacity", clamped);
  // Background-only fade: drive --bg-alpha-mult so glass panel/cards thin
  // out while text/donut/capsule stay fully opaque. Mica toggles in tandem
  // — kept on at 0% (full Liquid Glass) and cleared as soon as the user
  // dials any transparency, otherwise Mica paints the panel white-ish on
  // bright desktops and masks the fade entirely (see 23222cf retro).
  // macOS 는 floor 적용 — effectiveBgAlphaMult 주석 참조.
  const mult = effectiveBgAlphaMult(clamped, store.dark);
  document.documentElement.style.setProperty("--bg-alpha-mult", String(mult));
  scheduleCompositorRepaint();
  void invoke("set_mica_enabled", { enabled: clamped === 0 }).catch(() => {});
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
