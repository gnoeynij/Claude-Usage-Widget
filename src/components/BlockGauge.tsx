import { For } from "solid-js";
import { clamp } from "../utils/math";
import { thresholdColor } from "../utils/color";

/** Segmented block gauge for the instrument theme — the LCD answer to the
 *  glass capsule. `cells` blocks, filled by rounded tenths, colored by the
 *  same stoplight threshold as the donut/capsule. No gradient, no ghost band:
 *  a limit either lit a block or it didn't. */
export function BlockGauge(props: {
  value: number;
  cells?: number;
  cellW?: number;
  cellH?: number;
}) {
  const cells = () => props.cells ?? 10;
  const v = () => clamp(props.value);
  // Round to nearest cell, but never drop a nonzero value to zero lit blocks —
  // a barely-used limit should still show one lit cell, not read as empty.
  const filled = () => {
    if (v() <= 0) return 0;
    return Math.min(cells(), Math.max(1, Math.round((v() / 100) * cells())));
  };
  const color = () => thresholdColor(v());
  return (
    <span style={{ display: "inline-flex", gap: "2px" }}>
      <For each={Array.from({ length: cells() })}>
        {(_, i) => (
          <span
            style={{
              width: `${props.cellW ?? 9}px`,
              height: `${props.cellH ?? 12}px`,
              "border-radius": "1.5px",
              background: i() < filled() ? color() : "var(--inst-block-off)",
            }}
          />
        )}
      </For>
    </span>
  );
}
