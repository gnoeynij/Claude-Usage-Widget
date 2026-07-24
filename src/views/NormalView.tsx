import { For, Show, createMemo } from "solid-js";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, syncNow } from "../state/store";
import { t } from "../i18n";
import { clamp } from "../utils/math";
import { formatCountdown, projText } from "../utils/format";
import {
  projectLimit,
  riskTone,
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  type LimitProjection,
} from "../utils/project";
import { startWindowDrag } from "../utils/drag";

/** Projection appended INLINE to the reset caption — one line per limit (safe
 *  = calm "· 예상 N%", risk = amber "· ⚠ 한도 …") instead of a separate stacked
 *  line, so the limit messaging doesn't sprawl vertically. Gated on the same
 *  `projected > value + 0.5` as the donut/bar marker (near reset, projected ≈
 *  current → suppressed) — EXCEPT an over-limit projection (hitsBeforeReset)
 *  always shows, so the ⚠ warning isn't swallowed at 99.x%. floor so 99.6%
 *  never shows "100%". Called inside a JSX expression so it stays reactive. */
function riskText(ms: number) {
  return ms >= 24 * 3_600_000
    ? t().projRiskDays(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000))
    : t().projRisk(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
}

function projInline(proj: LimitProjection | null, value: number) {
  if (!proj || (proj.projectedPct <= value + 0.5 && !proj.hitsBeforeReset)) return null;
  if (!proj.hitsBeforeReset) {
    return ` · ${t().projSafe(Math.floor(proj.projectedPct))}`;
  }
  return (
    <>
      {" · "}
      {/* nowrap: when the caption wraps (double-risk state), each warning
          breaks as a whole unit instead of splitting mid-phrase. */}
      <span style={{ color: "var(--warning)", "font-weight": 600, "white-space": "nowrap" }}>
        {riskText(proj.msToLimit)}
      </span>
    </>
  );
}

function formatResetsIn(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return null;
  // ≥ 24h (weekly is days away) → show days + hours so it doesn't read as a
  // huge "121시간" number; matches the projection caption's day format.
  if (ms >= 86_400_000) {
    const days = Math.floor(ms / 86_400_000);
    const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
    return t().resetsInDays(days, hrs);
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return t().resetsIn(h, m);
}

function MiniMetric(props: { label: string; value: number; projected?: number | null }) {
  const v = () => Math.round(clamp(props.value));
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "76px 1fr 44px",
        "align-items": "center",
        gap: "var(--s-3)",
        padding: "var(--s-1) 0",
      }}
    >
      <span class="t-caption label-secondary">{props.label}</span>
      <CapsuleProgress value={props.value} size="sm" projected={props.projected} />
      {/* Numbers stay neutral — the gauge gradient + ghost dot already carry
          risk, and a tinted % beside a bold one read as washed-out text, not
          hierarchy. Warning text lives in the chip alone. */}
      <span class="t-caption tabular-nums" style={{ "text-align": "right" }}>
        {v()}
        <span style={{ opacity: 0.55, "margin-left": "1px" }}>%</span>
      </span>
    </div>
  );
}

export function NormalView() {
  // Session reset ticks live (per-second, store.tickSecond). Weekly stays
  // minute-granular (it's days away) via the HeaderBar tickMinute pattern.
  const sessionCountdown = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickSecond;
    return formatCountdown(store.usage.session_resets_at);
  };
  const weeklyReset = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return formatResetsIn(store.usage.weekly_resets_at);
  };
  // "At this pace …" projections. Session re-evaluates per-second (tickSecond),
  // weekly per-minute (it's days away) — same cadence as their countdowns.
  const sessionProj = createMemo(() => {
    // Per-minute (not tickSecond): the projection is an estimate, so a
    // per-second recompute only adds flicker (64↔65%). It still updates
    // immediately on sync via store.usage. The countdown below stays
    // per-second. eslint-disable-next-line @typescript-eslint/no-unused-expressions
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
      // Weekly uses the week-to-date average only. A burst during work hours
      // shouldn't extrapolate to "rest of the week at this rate" — over a 7d
      // window the wall-clock average already absorbs the user's duty cycle.
      undefined,
      0.1, // weekly's 7d window banks enough data sooner — see projectLimit
    );
  });
  // Scoped caps ride the weekly cadence (2026-07-21 probe: their resets_at
  // matches the weekly reset) — average-only, same rationale as weeklyProj.
  // Plain function, not a memo: called inside JSX so tickMinute keeps it live.
  const scopedProj = (row: { percent: number; resets_at?: string | null }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(row.percent, row.resets_at, WEEKLY_WINDOW_MS, Date.now(), undefined, 0.1);
  };
  // Imminent (<24h) weekly limits for the warning chip, in ROW order so the
  // list mirrors the bars above it. Distant risks stay text-free — their
  // signal is the tinted % number (riskTone) plus the hover tooltip; text
  // shows up only when a limit is a today-problem.
  const imminentRisks = () => {
    const risks: Array<{ label: string; msToLimit: number }> = [];
    const w = weeklyProj();
    if (riskTone(w) === "imminent")
      risks.push({ label: t().allModels, msToLimit: w!.msToLimit });
    for (const r of store.usage.scoped_limits ?? []) {
      const p = scopedProj(r);
      if (riskTone(p) === "imminent") risks.push({ label: r.label, msToLimit: p!.msToLimit });
    }
    return risks;
  };
  const durText = (ms: number) =>
    ms >= 24 * 3_600_000
      ? t().durDH(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000))
      : t().durHM(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
  // Hours-only variant for the chip when it lists 2+ limits — the full "~22시간
  // 10분 / ~3시간 5분" form overflows the 320px panel in Korean and wraps the
  // pill to two lines. Minutes only matter inside the final hour anyway.
  const durTextCompact = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    return h > 0 ? t().durH(h) : t().durHM(0, Math.floor(ms / 60_000));
  };
  // Hover tooltip on the weekly caption: every tracked weekly limit with its
  // own projection. The caption text carries only the soonest risk, so the
  // rest (e.g. all-models' ETA while a scoped cap runs out first) lives here.
  const weeklyTooltip = () => {
    const rows = [
      { label: t().allModels, pct: store.usage.seven_day, proj: weeklyProj() },
      ...(store.usage.scoped_limits ?? []).map((r) => ({
        label: r.label,
        pct: r.percent,
        proj: scopedProj(r),
      })),
    ];
    return rows
      .map((r) => {
        const pj = projText(r.proj);
        return `${r.label} ${Math.round(r.pct || 0)}%${pj ? ` · ${pj}` : ""}`;
      })
      .join("\n");
  };
  return (
    <main
      class="view-in"
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        gap: "0",
        padding: "0 var(--s-2)",
      }}
    >
      {/* 상단 drag region — 시각적 표시 없음, 위젯 이동용. height 28px 로
          마우스 조준 영역 확보. Donut 상단 일부가 drag 로 흡수되지만 sync 는
          헤더 ↻ 로 대체 가능. Windows 는 CSS `drag` 클래스가 처리, macOS 는
          data-tauri-drag-region + onMouseDown 폴백 필요 (utils/drag.ts). */}
      <div
        class="drag"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "28px",
          "z-index": 1,
        }}
      />
      {/* Hero — session donut as the focal element. Clicking it triggers a
          manual sync (the same as the header ↻) so the largest visual is
          also the largest target. */}
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "padding-top": "var(--s-2)",
          gap: "var(--s-2)",
        }}
      >
        <div data-guide="donut">
          <Donut
            value={store.usage.five_hour}
            size={144}
            stroke={8}
            label={t().session.toLowerCase()}
            projected={sessionProj()?.projectedPct ?? null}
            onClick={() => void syncNow()}
          />
        </div>
        <Show when={sessionCountdown()}>
          {(c) => (
            <span class="t-caption label-tertiary" data-guide="session-caption" style={{ "text-align": "center" }}>
              {t().resetsInLive(c().h, c().m, c().s)}
              {projInline(sessionProj(), store.usage.five_hour)}
            </span>
          )}
        </Show>
      </div>

      {/* Secondary metrics — weekly limits as thin rows */}
      <div
        data-guide="weekly"
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "0",
          padding: "0 var(--s-2)",
        }}
      >
        <MiniMetric
          label={t().allModels}
          value={store.usage.seven_day}
          projected={weeklyProj()?.projectedPct ?? null}
        />
        {/* Scoped weekly caps arrive labeled from the API (`limits` array —
            e.g. "Fable" while that promo cap runs); the legacy fixed
            sonnet/opus rows only render when the server sends none. */}
        <Show
          when={(store.usage.scoped_limits?.length ?? 0) > 0}
          fallback={
            <>
              <Show when={store.usage.seven_day_sonnet != null}>
                <MiniMetric label={t().sonnetOnly} value={store.usage.seven_day_sonnet ?? 0} />
              </Show>
              <Show when={store.usage.seven_day_opus != null}>
                <MiniMetric label={t().opusOnly} value={store.usage.seven_day_opus ?? 0} />
              </Show>
            </>
          }
        >
          <For each={store.usage.scoped_limits}>
            {(row) => (
              <MiniMetric
                label={row.label}
                value={row.percent}
                projected={scopedProj(row)?.projectedPct ?? null}
              />
            )}
          </For>
        </Show>
        <Show when={weeklyReset()}>
          {(s) => (
            <span
              data-guide="weekly-caption"
              class="t-caption label-tertiary"
              title={weeklyTooltip()}
              style={{
                "text-align": "center",
              }}
            >
              {s()}
              {/* Inline safe projection only while all-models is genuinely
                  safe — once it's at risk (any tier) the tinted % and the
                  chip take over the messaging. */}
              <Show when={!weeklyProj()?.hitsBeforeReset}>
                {projInline(weeklyProj(), store.usage.seven_day)}
              </Show>
            </span>
          )}
        </Show>
        {/* Warning chip — imminent (<24h) limits only. Outside the reset
            <Show>: a scoped cap carries its own resets_at, so its chip must
            survive even a missing weekly_resets_at. */}
        <Show when={imminentRisks().length > 0}>
          <div style={{ "text-align": "center", "margin-top": "3px" }}>
            {/* Apple warning grammar: neutral glass pill + amber icon only —
                the text stays label-colored. A tinted pill with tinted text
                read as a mustard slab against the already-warm gauges. */}
            <span
              class="t-caption"
              title={weeklyTooltip()}
              style={{
                display: "inline-block",
                background: "var(--fill-2)",
                "font-weight": 600,
                padding: "2px 10px",
                "border-radius": "var(--r-pill)",
              }}
            >
              <span style={{ color: "var(--warning)" }}>{"⚠ "}</span>
              {t().riskLine(
                imminentRisks()
                  .map((r, _i, all) =>
                    `${r.label} ${(all.length > 1 ? durTextCompact : durText)(r.msToLimit)}`,
                  )
                  .join(" / "),
              )}
            </span>
          </div>
        </Show>
        <Show when={store.usage.extra_usage_enabled}>
          <span
            class="t-caption label-tertiary"
            style={{ "text-align": "center" }}
          >
            {t().extraCredits(Math.round(store.usage.extra_usage ?? 0))}
          </span>
        </Show>
      </div>
    </main>
  );
}
