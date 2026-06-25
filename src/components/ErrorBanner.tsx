import { Show } from "solid-js";
import { AlertTriangle, AlertCircle, WifiOff, Clock } from "lucide-solid";
import type { Component } from "solid-js";
import { store } from "../state/store";
import type { ErrorCode } from "../state/store";
import { t } from "../i18n";

type Tone = "warn" | "info" | "danger";

type BannerInfo = {
  title: string;
  hint: string;
  tone: Tone;
  Icon: Component<{ size?: number; style?: Record<string, string> }>;
};

export function bannerFor(code: ErrorCode): BannerInfo | null {
  const s = t();
  switch (code) {
    case "TOKEN_EXPIRED":
      return { title: s.tokenExpired, hint: s.tokenExpiredHint, tone: "warn", Icon: AlertTriangle };
    case "NO_CREDENTIALS":
      return { title: s.noCredentials, hint: s.noCredentialsHint, tone: "warn", Icon: AlertCircle };
    case "RATE_LIMITED":
      return { title: s.rateLimited, hint: s.rateLimitedHint, tone: "info", Icon: Clock };
    case "NETWORK":
      return { title: s.networkError, hint: s.networkErrorHint, tone: "danger", Icon: WifiOff };
    default:
      return null;
  }
}

/** Fallback when a sync failed but parseErrorCode didn't recognize it (e.g.
 *  JSON_PARSE_ERROR, HTTP 5xx). The red status dot lights on any `syncError`,
 *  so without this an unmatched error shows a red dot with no on-screen
 *  explanation. Keeps the banner in sync with the dot. */
function genericSyncError(): BannerInfo | null {
  if (!store.syncError) return null;
  const s = t();
  return { title: s.syncFailed, hint: s.syncFailedHint, tone: "danger", Icon: AlertTriangle };
}

// Color tokens per tone — `--accent` already covers the warn/info path
// (Liquid Glass design system has one accent color), so warn/info share the
// same tint and only differ in icon. danger gets the dedicated red.
function toneStyles(tone: Tone) {
  if (tone === "danger") {
    return {
      border: "1px solid var(--danger, rgba(255, 59, 48, 0.5))",
      iconColor: "var(--danger, #ff3b30)",
    };
  }
  return {
    border: "1px solid var(--accent-tint-strong)",
    iconColor: "var(--accent)",
  };
}

export function ErrorBanner() {
  const info = () => bannerFor(store.errorCode) ?? genericSyncError();

  return (
    <Show when={info()}>
      {(i) => {
        const styles = () => toneStyles(i().tone);
        const Icon = i().Icon;
        return (
          <div
            role="status"
            class="t-caption"
            style={{
              // Overlay the top of the content (floating, like the toast)
              // instead of taking a flex slot that pushes content down —
              // anchored to the relative content wrapper in WidgetChrome.
              // Frosted card (not the light tone tint) so it stays readable
              // over the donut; tone is carried by the border + icon color.
              position: "absolute",
              top: "var(--s-1)",
              left: "var(--s-2)",
              right: "var(--s-2)",
              "z-index": 10,
              "pointer-events": "none",
              display: "flex",
              "align-items": "flex-start",
              gap: "var(--s-2)",
              padding: "var(--s-2) var(--s-3)",
              "border-radius": "var(--r-md)",
              background: "rgba(var(--glass-card-rgb), 0.94)",
              "backdrop-filter": "blur(18px) saturate(180%)",
              "-webkit-backdrop-filter": "blur(18px) saturate(180%)",
              color: "var(--label)",
              border: styles().border,
              "box-shadow": "var(--shadow-card)",
            }}
          >
            <Icon
              size={14}
              style={{
                color: styles().iconColor,
                "flex-shrink": "0",
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
              <span style={{ "font-weight": 600 }}>{i().title}</span>
              <span class="label-secondary">{i().hint}</span>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
