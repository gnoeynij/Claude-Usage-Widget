import { Show } from "solid-js";
import { clamp } from "../utils/math";
import { thresholdColor } from "../utils/color";

type Props = {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  showPercent?: boolean;
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
        style={{ display: "block" }}
      >
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={r()}
          fill="none"
          stroke="var(--fill-2)"
          stroke-width={stroke()}
        />
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
