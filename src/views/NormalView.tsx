import { Show } from "solid-js";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, syncNow } from "../state/store";
import { t } from "../i18n";
import { clamp } from "../utils/math";
import { startWindowDrag } from "../utils/drag";

function formatResetsIn(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return t().resetsIn(h, m);
}

function MiniMetric(props: { label: string; value: number }) {
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
      <CapsuleProgress value={props.value} size="sm" />
      <span
        class="t-caption tabular-nums"
        style={{ "text-align": "right" }}
      >
        {v()}
        <span style={{ opacity: 0.55, "margin-left": "1px" }}>%</span>
      </span>
    </div>
  );
}

export function NormalView() {
  const sessionReset = () => formatResetsIn(store.usage.session_resets_at);
  const weeklyReset = () => formatResetsIn(store.usage.weekly_resets_at);
  return (
    <main
      class="view-in"
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        gap: "var(--s-4)",
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
          "padding-top": "var(--s-3)",
          gap: "var(--s-2)",
        }}
      >
        <Donut
          value={store.usage.five_hour}
          size={144}
          stroke={8}
          label={t().session.toLowerCase()}
          onClick={() => void syncNow()}
        />
        <Show when={sessionReset()}>
          {(s) => <span class="t-caption label-tertiary">{s()}</span>}
        </Show>
      </div>

      {/* Secondary metrics — weekly limits as thin rows */}
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "var(--s-1)",
          padding: "0 var(--s-2)",
        }}
      >
        <MiniMetric label={t().allModels} value={store.usage.seven_day} />
        <MiniMetric label={t().sonnetOnly} value={store.usage.seven_day_sonnet} />
        <Show when={weeklyReset()}>
          {(s) => (
            <span
              class="t-caption label-tertiary"
              style={{
                "padding-top": "var(--s-1)",
                "text-align": "center",
              }}
            >
              {s()}
            </span>
          )}
        </Show>
      </div>
    </main>
  );
}
