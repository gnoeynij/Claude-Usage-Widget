import { createSignal } from "solid-js";
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
  const [expandHover, setExpandHover] = createSignal(false);
  return (
    <main
      class="drag view-in"
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
      {/* visionOS-style sheet handle: thin bar at top-center hints "drag-down
          to dismiss" affordance. Default opacity is just visible enough to
          register; hover expands width + opacity to make the affordance
          unambiguous. Clicking returns to normal mode. */}
      <button
        class="no-drag"
        onClick={(e) => {
          e.stopPropagation();
          setMode("normal");
        }}
        onMouseEnter={() => setExpandHover(true)}
        onMouseLeave={() => setExpandHover(false)}
        title={t().miniExpand}
        style={{
          position: "absolute",
          top: 0,
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
      <Donut
        value={store.usage.five_hour}
        size={96}
        stroke={7}
        label={t().session.toLowerCase()}
      />
      <div
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
        <MiniRow label={t().allModels} value={store.usage.seven_day} />
        <MiniRow
          label={t().sonnetOnly}
          value={store.usage.seven_day_sonnet}
        />
      </div>
    </main>
  );
}
