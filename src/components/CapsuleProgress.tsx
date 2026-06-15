import { Show } from "solid-js";
import { clamp } from "../utils/math";
import { thresholdColor } from "../utils/color";

type Props = {
  value: number;
  size?: "sm" | "md";
  /** Projected value at reset (may exceed 100). Renders a faint ghost fill
   *  out to the projection capped by a dot — neutral when safe, amber once it
   *  projects past the limit. The dot lives outside the clipped track so it
   *  isn't cut off at the 100% edge. */
  projected?: number | null;
};

export function CapsuleProgress(props: Props) {
  const v = () => clamp(props.value);
  const h = () => (props.size === "sm" ? "var(--capsule-h-sm)" : "var(--capsule-h)");
  const c = () => thresholdColor(v());

  const pv = () => (props.projected == null ? null : clamp(props.projected));
  const over = () => (props.projected ?? 0) >= 100;
  // `|| over()` — over-limit projection shows even at the 99.x% edge (matches Donut).
  const showProj = () => pv() != null && ((pv() as number) > v() + 0.5 || over());
  // Colored by the projected threshold (never gray) so the ghost fill stays
  // distinct from the gray empty track — matches the donut.
  const ghostC = () => thresholdColor(pv() ?? 0);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: h(),
          "border-radius": "var(--r-pill)",
          background: "var(--fill-2)",
          "box-shadow": "inset 0 0 0 1px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <Show when={showProj()}>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: `${pv()}%`,
              "border-radius": "var(--r-pill)",
              background: ghostC(),
              opacity: over() ? 0.45 : 0.36,
              transition: "width var(--dur-xslow) var(--ease-swift)",
            }}
          />
        </Show>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: `${v()}%`,
            "border-radius": "var(--r-pill)",
            background: `linear-gradient(90deg, color-mix(in oklab, ${c()} 70%, transparent), ${c()})`,
            transition:
              "width var(--dur-xslow) var(--ease-swift), background var(--dur-base) var(--ease-smooth)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${v()}%`,
            height: "1px",
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 70%)",
            transition: "width var(--dur-xslow) var(--ease-swift)",
          }}
        />
      </div>
      <Show when={showProj()}>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${Math.min(pv() as number, 100)}%`,
            transform: "translate(-50%, -50%)",
            width: `calc(${h()} + 2px)`,
            height: `calc(${h()} + 2px)`,
            "border-radius": "50%",
            // White center + ghost-color ring — matches the donut dot so the
            // projection marker reads on a same-color bar fill in both themes.
            background: "white",
            "box-shadow": `0 0 0 2px ${ghostC()}`,
            transition: "left var(--dur-xslow) var(--ease-swift)",
          }}
        />
      </Show>
    </div>
  );
}
