import { clamp } from "../utils/math";

/** 7-segment LCD number for the instrument theme. Renders the value in DSEG7
 *  over a same-width "all 8s" ghost in the off-segment color — the detail that
 *  sells a real LCD. Monospace font keeps ghost and value in register. */
export function SegDigits(props: {
  value: number;
  size: number;
  color?: string;
}) {
  const n = () => Math.round(clamp(props.value));
  const ghost = () => "8".repeat(String(n()).length);
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        "font-family": "var(--font-seg)",
        "font-size": `${props.size}px`,
        "line-height": "1",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          color: "var(--inst-seg-off)",
        }}
      >
        {ghost()}
      </span>
      <span style={{ position: "relative", color: props.color ?? "var(--label)" }}>
        {n()}
      </span>
    </span>
  );
}
