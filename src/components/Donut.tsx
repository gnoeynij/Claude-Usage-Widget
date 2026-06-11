import { Show } from "solid-js";
import { clamp } from "../utils/math";
import { thresholdColor } from "../utils/color";

type Props = {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  showPercent?: boolean;
  /** Projected utilization at reset (may exceed 100). Renders a faint "ghost"
   *  arc from the current value out to the projection, capped by a dot — the
   *  "at this pace you'll land here" marker. Neutral when safe, amber once it
   *  projects past the limit. Null/absent = no projection drawn. */
  projected?: number | null;
  /** Optional click handler — when provided, the donut becomes a button
   *  with a `cursor: pointer` and a subtle hover lift. Used in Normal view
   *  to make the hero donut also trigger a manual sync. */
  onClick?: () => void;
};

export function Donut(props: Props) {
  const size = () => props.size ?? 96;
  const stroke = () => props.stroke ?? 8;
  const r = () => (size() - stroke()) / 2;
  const circ = () => 2 * Math.PI * r();
  const v = () => clamp(props.value);
  const offset = () => circ() * (1 - v() / 100);
  // Hide the fill stroke entirely below 1% so the round line-cap doesn't
  // render as a stray dot at the 12 o'clock position.
  const fillVisible = () => v() >= 1;

  // Projection ghost arc + dot. Drawn between track and fill so the solid
  // fill covers 0→current and only current→projected shows as the ghost.
  const pv = () => (props.projected == null ? null : clamp(props.projected));
  const over = () => (props.projected ?? 0) >= 100;
  const showProj = () => pv() != null && (pv() as number) > v() + 0.5;
  // Colored by the PROJECTED threshold (green/amber/red), never gray — so the
  // ghost stays distinct from the gray empty track (which a neutral ghost would
  // blend into) and conveys where the projection lands ("amber now, red soon").
  const ghostColor = () => thresholdColor(pv() ?? 0);
  const ghostOffset = () => circ() * (1 - (pv() ?? 0) / 100);
  const dotAngle = () => ((pv() ?? 0) / 100) * 360;

  const handleKey = (e: KeyboardEvent) => {
    if (!props.onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onClick();
    }
  };
  return (
    <div
      class={props.onClick ? "donut-clickable" : ""}
      onClick={props.onClick}
      onKeyDown={props.onClick ? handleKey : undefined}
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      style={{
        position: "relative",
        width: `${size()}px`,
        height: `${size()}px`,
        cursor: props.onClick ? "pointer" : "default",
        "user-select": "none",
        transition: "transform var(--dur-fast) var(--ease-spring)",
      }}
    >
      <svg
        width={size()}
        height={size()}
        viewBox={`0 0 ${size()} ${size()}`}
        // overflow visible so the projection dot — which is larger than the
        // stroke and centered on the ring centerline (whose outer edge touches
        // the viewBox) — isn't clipped on its outer side, which read as the dot
        // sitting inward of the line.
        style={{ display: "block", overflow: "visible" }}
      >
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={r()}
          fill="none"
          stroke="var(--fill-2)"
          stroke-width={stroke()}
        />
        <Show when={showProj()}>
          <circle
            cx={size() / 2}
            cy={size() / 2}
            r={r()}
            fill="none"
            stroke={ghostColor()}
            stroke-width={stroke()}
            stroke-linecap="round"
            stroke-dasharray={String(circ())}
            stroke-dashoffset={String(ghostOffset())}
            stroke-opacity={over() ? 0.55 : 0.42}
            transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
            style={{ transition: "stroke-dashoffset var(--dur-xslow) var(--ease-swift)" }}
          />
        </Show>
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={r()}
          fill="none"
          stroke={thresholdColor(v())}
          stroke-width={stroke()}
          stroke-linecap="round"
          stroke-dasharray={String(circ())}
          stroke-dashoffset={String(offset())}
          stroke-opacity={fillVisible() ? 1 : 0}
          transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
          style={{
            transition:
              "stroke-dashoffset var(--dur-xslow) var(--ease-swift), stroke var(--dur-base) var(--ease-smooth), stroke-opacity var(--dur-fast) var(--ease-smooth)",
          }}
        />
        <Show when={showProj()}>
          {/* White center (both themes — matches the slider thumb tone) so the
              marker reads on a same-color arc without the stark look a theme-
              flipped dark fill gives in light mode; the ghost-color ring carries
              the safe/risk color. */}
          <g transform={`rotate(${dotAngle()} ${size() / 2} ${size() / 2})`}>
            <circle
              cx={size() / 2}
              cy={size() / 2 - r()}
              r={stroke() * 0.72}
              fill="white"
              stroke={ghostColor()}
              stroke-width="2"
            />
          </g>
        </Show>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <Show when={props.showPercent !== false}>
          <div
            class="t-title2 tabular-nums"
            style={{ "line-height": "1" }}
          >
            {Math.round(v())}
            <span style={{ "font-size": "55%", opacity: 0.55, "margin-left": "1px" }}>%</span>
          </div>
        </Show>
        <Show when={props.label}>
          <div
            class="t-caption label-secondary"
            style={{ "margin-top": "3px" }}
          >
            {props.label}
          </div>
        </Show>
      </div>
    </div>
  );
}
