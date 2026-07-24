import { For, Show } from "solid-js";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, syncNow } from "../state/store";
import { t } from "../i18n";
import { clamp } from "../utils/math";
import { formatCountdown } from "../utils/format";
import { createLimitsVm, durText, formatResetsIn, riskText } from "./limitsVm";
import type { LimitProjection } from "../utils/project";
import { startWindowDrag } from "../utils/drag";

/** Projection appended INLINE to the reset caption — one line per limit (safe
 *  = calm "· 예상 N%", risk = amber "· ⚠ 한도 …") instead of a separate stacked
 *  line, so the limit messaging doesn't sprawl vertically. Gated on the same
 *  `projected > value + 0.5` as the donut/bar marker (near reset, projected ≈
 *  current → suppressed) — EXCEPT an over-limit projection (hitsBeforeReset)
 *  always shows, so the ⚠ warning isn't swallowed at 99.x%. floor so 99.6%
 *  never shows "100%". Called inside a JSX expression so it stays reactive. */
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

/** Amber inline warning appended to the caption (" · <amber text>"); the text
 *  carries its own ⚠. Used by the priority weekly message below. */
function amberMsg(text: string) {
  return (
    <>
      {" · "}
      <span style={{ color: "var(--warning)", "font-weight": 600, "white-space": "nowrap" }}>
        {text}
      </span>
    </>
  );
}

/** Priority projection for the weekly caption's single inline slot: All models
 *  projected over 100% owns it (its ETA — the primary weekly limit). When All
 *  models is safe, the scoped (Fable) cap takes over — its ETA, "…at limit"
 *  once maxed (projectLimit returns null at 100%, so it's handled here), or its
 *  projected %. Falls back to All models' safe % when no scoped cap is active. */
function weeklyProjMsg(vm: ReturnType<typeof createLimitsVm>) {
  const seven = store.usage.seven_day;
  const am = vm.weeklyProj();
  if (am?.hitsBeforeReset) return projInline(am, seven); // All models over → priority
  const scoped = store.usage.scoped_limits?.[0];
  if (scoped) {
    if (scoped.percent >= 100) return amberMsg(t().projReached(scoped.label)); // maxed
    const sp = vm.scopedProj(scoped);
    if (sp?.hitsBeforeReset)
      return amberMsg(`⚠ ${scoped.label} ${t().riskLine(durText(sp.msToLimit))}`); // Fable ETA
    if (sp && sp.projectedPct > scoped.percent + 0.5)
      return ` · ${scoped.label} ${t().projSafe(Math.floor(sp.projectedPct))}`; // Fable rising %
  }
  return projInline(am, seven); // no active scoped cap → All models safe %
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
  const vm = createLimitsVm();
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
            projected={vm.sessionProj()?.projectedPct ?? null}
            onClick={() => void syncNow()}
          />
        </div>
        <Show when={sessionCountdown()}>
          {(c) => (
            <span class="t-caption label-tertiary" data-guide="session-caption" style={{ "text-align": "center" }}>
              {t().resetsInLive(c().h, c().m, c().s)}
              {projInline(vm.sessionProj(), store.usage.five_hour)}
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
          projected={vm.weeklyProj()?.projectedPct ?? null}
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
                projected={vm.scopedProj(row)?.projectedPct ?? null}
              />
            )}
          </For>
        </Show>
        <Show when={weeklyReset()}>
          {(s) => (
            <span
              data-guide="weekly-caption"
              class="t-caption label-tertiary"
              title={vm.weeklyTooltip()}
              style={{ "text-align": "center" }}
            >
              {s()}
              {weeklyProjMsg(vm)}
            </span>
          )}
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
