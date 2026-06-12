import { createSignal, createMemo, Show, For } from "solid-js";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, setMode, syncNow } from "../state/store";
import { t } from "../i18n";
import {
  projectLimit,
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  type LimitProjection,
} from "../utils/project";
import { startWindowDrag } from "../utils/drag";

/** Plain-text projection summary for the badge tooltip (no markup — it's a
 *  native title attribute). Mirrors RiskCaption's day/hour split. */
function projText(p: LimitProjection | null): string {
  if (!p) return "";
  if (!p.hitsBeforeReset) return t().projSafe(Math.floor(p.projectedPct));
  const ms = p.msToLimit;
  return ms >= 48 * 3_600_000
    ? t().projRiskDays(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000))
    : t().projRisk(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
}

function MiniRow(props: { label: string; value: number; projected?: number | null }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "baseline",
          "justify-content": "space-between",
        }}
      >
        <span class="t-caption label-secondary">{props.label}</span>
        <span class="t-caption tabular-nums">
          {Math.round(props.value || 0)}
          <span style={{ opacity: 0.55 }}>%</span>
        </span>
      </div>
      <div style={{ "margin-top": "3px" }}>
        <CapsuleProgress value={props.value} size="sm" projected={props.projected} />
      </div>
    </div>
  );
}

export function MiniView() {
  const [expandHover, setExpandHover] = createSignal(false);
  // Projection markers only (no captions — Mini has no room). The amber ghost
  // arc/dot on a tracked limit is the at-a-glance "heading past the limit"
  // warning. Same cadence as NormalView (session per-second, weekly per-minute).
  const sessionProj = createMemo(() => {
    // Per-minute (not tickSecond): the projection is an estimate, so a
    // per-second recompute only adds flicker (64↔65%). It still updates
    // immediately on sync via store.usage. eslint-disable-next-line
    // @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(
      store.usage.five_hour,
      store.usage.session_resets_at,
      SESSION_WINDOW_MS,
      Date.now(),
      store.recentPaceSession,
    );
  });
  const weeklyProj = createMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(
      store.usage.seven_day,
      store.usage.weekly_resets_at,
      WEEKLY_WINDOW_MS,
      Date.now(),
      store.recentPaceWeekly,
    );
  });
  // Any tracked limit on pace to hit before reset → a small amber warning
  // badge. Icon (shape), not color, so it reads even amber-on-amber where the
  // ghost marker blends with an already-amber arc.
  const atRisk = () => Boolean(sessionProj()?.hitsBeforeReset || weeklyProj()?.hitsBeforeReset);
  const [infoOpen, setInfoOpen] = createSignal(false);
  // Each tracked limit's current % + projection — drives both the click-to-open
  // in-Mini info overlay and the native-title hover summary.
  const limitRows = (): Array<{ label: string; pct: number; proj: LimitProjection | null }> => {
    const rows = [
      { label: t().session, pct: store.usage.five_hour, proj: sessionProj() },
      { label: t().allModels, pct: store.usage.seven_day, proj: weeklyProj() },
      { label: t().sonnetOnly, pct: store.usage.seven_day_sonnet, proj: null },
    ];
    if (store.usage.seven_day_opus != null) {
      rows.push({ label: t().opusOnly, pct: store.usage.seven_day_opus, proj: null });
    }
    return rows;
  };
  const riskTooltip = () =>
    limitRows()
      .map((r) => {
        const pj = projText(r.proj);
        return `${r.label} ${Math.round(r.pct || 0)}%${pj ? ` · ${pj}` : ""}`;
      })
      .join("\n");
  return (
    <main
      class="drag view-in"
      data-tauri-drag-region
      onMouseDown={startWindowDrag}
      style={{
        position: "relative",
        display: "flex",
        "align-items": "center",
        gap: "var(--s-2)",
        padding: "var(--s-2)",
        flex: 1,
      }}
      ondblclick={() => setMode("normal")}
    >
      <Show when={atRisk()}>
        <span
          class="no-drag"
          data-guide="badge"
          role="button"
          tabindex={0}
          title={riskTooltip()}
          onClick={(e) => {
            e.stopPropagation();
            setInfoOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setInfoOpen((v) => !v);
            }
          }}
          style={{
            position: "absolute",
            // Inset past the 10px window corner radius (--r-window) so the
            // glyph lands on the painted panel, not the transparent corner.
            top: "6px",
            right: "10px",
            "font-size": "13px",
            "line-height": 1,
            color: "var(--warning)",
            "z-index": 4,
            // Click → toggle an in-Mini info overlay (stays in-bounds, no nav);
            // native title is a bonus
            // quick-peek where the OS renders it.
            cursor: "pointer",
          }}
        >
          ⚠
        </span>
      </Show>
      {/* Click-the-badge info overlay — a glass panel covering the Mini content
          (stays within the 240px window, unlike an out-of-bounds popover).
          Click anywhere on it to dismiss. */}
      <Show when={infoOpen()}>
        <div
          class="no-drag fade-in"
          onClick={(e) => {
            e.stopPropagation();
            setInfoOpen(false);
          }}
          style={{
            position: "absolute",
            inset: 0,
            "z-index": 3,
            display: "flex",
            "flex-direction": "column",
            "justify-content": "center",
            gap: "var(--s-1)",
            padding: "0 var(--s-4)",
            background: "var(--scrim-bg)",
            "backdrop-filter": "blur(12px)",
            "-webkit-backdrop-filter": "blur(12px)",
            "border-radius": "var(--r-window)",
            cursor: "default",
          }}
        >
          <For each={limitRows()}>
            {(r) => {
              const pj = projText(r.proj);
              return (
                <div
                  class="t-caption"
                  style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}
                >
                  <span class="label-secondary">{r.label}</span>{" "}
                  <span class="tabular-nums" style={{ "font-weight": 600 }}>
                    {Math.round(r.pct || 0)}%
                  </span>
                  <Show when={pj}>
                    <span
                      style={{ color: r.proj?.hitsBeforeReset ? "var(--warning)" : "var(--label-tertiary)" }}
                    >
                      {" · "}
                      {pj}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      {/* "Tap to expand" handle anchored at the bottom-center — mirrors the
          location of Normal/Detail's footer SegmentedControl so the mode
          toggle lives in the same spot across all three modes. Default
          opacity is just visible enough to register; hover expands width +
          opacity to make the affordance unambiguous. */}
      <button
        class="no-drag"
        data-guide="expand"
        onClick={(e) => {
          e.stopPropagation();
          setMode("normal");
        }}
        onMouseEnter={() => setExpandHover(true)}
        onMouseLeave={() => setExpandHover(false)}
        title={t().miniExpand}
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "56px",
          height: "14px",
          padding: 0,
          background: "transparent",
          border: "none",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "block",
            width: expandHover() ? "44px" : "32px",
            height: "4px",
            "border-radius": "2px",
            background: "var(--label-tertiary)",
            opacity: expandHover() ? 0.7 : 0.3,
            transition:
              "opacity var(--dur-fast) var(--ease-smooth), width var(--dur-fast) var(--ease-swift)",
          }}
        />
      </button>
      <div data-guide="donut">
        <Donut
          value={store.usage.five_hour}
          size={96}
          stroke={7}
          label={t().session.toLowerCase()}
          projected={sessionProj()?.projectedPct ?? null}
          onClick={() => void syncNow()}
        />
      </div>
      <div
        data-guide="weekly"
        style={{
          flex: 1,
          "align-self": "stretch",
          display: "flex",
          "flex-direction": "column",
          // space-evenly distributes the two MiniRows across the full donut
          // height (96px) instead of collapsing them to their content height
          // and centering — which read as top-heavy because text weight
          // dominates capsule weight.
          "justify-content": "space-evenly",
        }}
      >
        <MiniRow
          label={t().allModels}
          value={store.usage.seven_day}
          projected={weeklyProj()?.projectedPct ?? null}
        />
        <MiniRow
          label={t().sonnetOnly}
          value={store.usage.seven_day_sonnet}
        />
      </div>
    </main>
  );
}
