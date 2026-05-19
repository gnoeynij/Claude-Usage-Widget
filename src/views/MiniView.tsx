import { Maximize2 } from "lucide-solid";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { store, setMode } from "../state/store";
import { t } from "../i18n";

function MiniRow(props: { label: string; value: number }) {
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
        <CapsuleProgress value={props.value} size="sm" />
      </div>
    </div>
  );
}

export function MiniView() {
  return (
    <main
      class="drag view-in"
      style={{
        position: "relative",
        display: "flex",
        "align-items": "center",
        gap: "var(--s-3)",
        padding: "var(--s-3)",
        flex: 1,
      }}
      ondblclick={() => setMode("normal")}
    >
      <button
        class="no-drag ring-hover"
        onClick={(e) => {
          e.stopPropagation();
          setMode("normal");
        }}
        title={t().normal}
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          width: "22px",
          height: "22px",
          "border-radius": "6px",
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          color: "var(--label-tertiary)",
        }}
      >
        <Maximize2 size={12} />
      </button>
      <Donut
        value={store.usage.five_hour}
        size={96}
        stroke={7}
        label={t().session.toLowerCase()}
      />
      <div
        style={{
          flex: 1,
          display: "flex",
          "flex-direction": "column",
          gap: "var(--s-2)",
        }}
      >
        <MiniRow label={t().allModels} value={store.usage.seven_day} />
        <MiniRow
          label={t().sonnetOnly}
          value={store.usage.seven_day_sonnet}
        />
      </div>
    </main>
  );
}
