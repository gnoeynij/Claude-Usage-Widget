import { For, Show } from "solid-js";
import { SegDigits } from "../components/SegDigits";
import { BlockGauge } from "../components/BlockGauge";
import { store, syncNow, sessionDisplay } from "../state/store";
import { t } from "../i18n";
import { formatCountdown } from "../utils/format";
import { startWindowDrag } from "../utils/drag";
import { createLimitsVm, formatResetsIn, riskText, weeklyMsgText } from "./limitsVm";
import type { LimitProjection } from "../utils/project";

/** Instrument-theme Normal view — the retro LCD panel skin. Shares all pace/
 *  risk logic with the glass NormalView via createLimitsVm(); only the
 *  presentation (7-seg session, block gauges, zones) differs. */

/** Inline projection on the session caption: safe → "· proj N%", risk → amber
 *  "· ⚠ …to limit". Same rule as the glass view (presentation copy). */
function projInline(proj: LimitProjection | null, value: number) {
  if (!proj || (proj.projectedPct <= value + 0.5 && !proj.hitsBeforeReset)) return null;
  if (!proj.hitsBeforeReset) return ` · ${t().projSafe(Math.floor(proj.projectedPct))}`;
  return (
    <>
      {" · "}
      <span style={{ color: "var(--warning)", "font-weight": 600, "white-space": "nowrap" }}>
        {riskText(proj.msToLimit)}
      </span>
    </>
  );
}

function BlockRow(props: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "grid",
        // 34px fits "100%" at 13px/600 — at 28px the global overflow-wrap:
        // break-word split it into "100"/"%" across two lines at min width.
        "grid-template-columns": "78px 1fr 34px",
        "align-items": "center",
        gap: "8px",
      }}
    >
      <span class="inst-caps" style={{ "white-space": "nowrap" }}>{props.label}</span>
      <BlockGauge value={props.value} cellW={8} cellH={13} />
      <span
        class="tabular-nums"
        style={{ "text-align": "right", "font-size": "13px", "font-weight": 600, "white-space": "nowrap" }}
      >
        {Math.round(props.value)}%
      </span>
    </div>
  );
}

export function NormalInstrument() {
  const vm = createLimitsVm();
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
  const scoped = () => store.usage.scoped_limits ?? [];
  return (
    <main
      class="view-in"
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        gap: "9px",
        padding: "2px var(--s-2) 0",
      }}
    >
      <div
        class="drag"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: "20px", "z-index": 1 }}
      />

      {/* SESSION zone — 7-seg hero. Clicking it syncs, like the glass donut. */}
      <div
        class="inst-zone no-drag"
        data-guide="donut"
        onClick={() => void syncNow(true)}
        style={{ cursor: "pointer" }}
        title={t().syncNow}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
          <span class="inst-caps">{t().session}</span>
          <Show when={sessionCountdown()}>
            {(c) => (
              <span class="inst-caps tabular-nums" data-guide="session-caption">
                {t().resetsInLive(c().h, c().m, c().s)}
              </span>
            )}
          </Show>
        </div>
        <div
          style={{
            display: "flex",
            "align-items": "flex-end",
            "justify-content": "flex-end",
            gap: "4px",
            margin: "8px 0 4px",
          }}
        >
          <SegDigits value={sessionDisplay()} size={46} />
          <span class="inst-caps" style={{ "font-size": "14px", "margin-bottom": "4px" }}>%</span>
        </div>
        <div class="inst-caps" style={{ "text-align": "right", "min-height": "12px" }}>
          {projInline(vm.sessionProj(), store.usage.five_hour)}
        </div>
      </div>

      {/* WEEKLY zone — block gauges + reset + imminent warning line. */}
      <div class="inst-zone" data-guide="weekly">
        <div
          style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline", "margin-bottom": "9px" }}
        >
          <span class="inst-caps">{t().weekly}</span>
          <Show when={weeklyReset()}>
            {(s) => (
              <span class="inst-caps tabular-nums" data-guide="weekly-caption" title={vm.weeklyTooltip()}>
                {s()}
              </span>
            )}
          </Show>
        </div>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <BlockRow label={t().allModels} value={store.usage.seven_day} />
          <Show
            when={scoped().length > 0}
            fallback={
              <>
                <Show when={store.usage.seven_day_sonnet != null}>
                  <BlockRow label={t().sonnetOnly} value={store.usage.seven_day_sonnet ?? 0} />
                </Show>
                <Show when={store.usage.seven_day_opus != null}>
                  <BlockRow label={t().opusOnly} value={store.usage.seven_day_opus ?? 0} />
                </Show>
              </>
            }
          >
            <For each={scoped()}>{(row) => <BlockRow label={row.label} value={row.percent} />}</For>
          </Show>
        </div>
        <Show when={weeklyMsgText(vm.weeklyMsg())}>
          {(m) => (
            <div
              class="inst-caps"
              title={vm.weeklyTooltip()}
              style={{
                "margin-top": "9px",
                "padding-top": "8px",
                "border-top": "1px solid var(--inst-zone-border)",
                "text-align": "right",
                color: m().warn ? "var(--warning)" : "var(--inst-label)",
              }}
            >
              {m().text}
            </div>
          )}
        </Show>
        <Show when={store.usage.extra_usage_enabled}>
          <div class="inst-caps" style={{ "margin-top": "8px", "text-align": "right" }}>
            {t().extraCredits(Math.round(store.usage.extra_usage ?? 0))}
          </div>
        </Show>
      </div>
    </main>
  );
}
