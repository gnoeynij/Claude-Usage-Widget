import { Show } from "solid-js";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, syncNow } from "../state/store";
import { t } from "../i18n";

function clamp(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

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
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        gap: "var(--s-4)",
        padding: "0 var(--s-2)",
      }}
    >
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
