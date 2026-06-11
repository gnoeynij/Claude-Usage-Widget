import { Show } from "solid-js";
import { clamp } from "../utils/math";
import { thresholdColor } from "../utils/color";

export type CapsuleTone = "threshold" | "accent" | "neutral";

type Props = {
  value: number;
  size?: "sm" | "md";
  /** "threshold" (default) = green/amber/red by value; "accent" = solid brand;
   *  "neutral" = subtle gray. Used to separate limit-style gauges from
   *  comparison-style bars (e.g. periods, models). */
  tone?: CapsuleTone;
  /** Explicit color override — takes precedence over tone. Used by the
   *  Models card to color bars by model family. */
  color?: string;
  /** Projected value at reset (may exceed 100). Renders a faint ghost fill
   *  out to the projection capped by a dot — neutral when safe, amber once it
   *  projects past the limit. The dot lives outside the clipped track so it
   *  isn't cut off at the 100% edge. */
  projected?: number | null;
};

function colorFor(v: number, tone: CapsuleTone, override?: string) {
  if (override) return override;
  if (tone === "accent") return "var(--accent)";
  if (tone === "neutral") return "var(--label-tertiary)";
  return thresholdColor(v);
}

export function CapsuleProgress(props: Props) {
  const v = () => clamp(props.value);
  const tone = () => props.tone ?? "threshold";
  const h = () => (props.size === "sm" ? "var(--capsule-h-sm)" : "var(--capsule-h)");
  const c = () => colorFor(v(), tone(), props.color);

  const pv = () => (props.projected == null ? null : clamp(props.projected));
  const over = () => (props.projected ?? 0) >= 100;
  const showProj = () => pv() != null && (pv() as number) > v() + 0.5;
  const ghostC = () => (over() ? "var(--warning)" : "var(--label-tertiary)");

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
              opacity: over() ? 0.4 : 0.28,
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
            width: h(),
            height: h(),
            "border-radius": "50%",
            background: ghostC(),
            "box-shadow": "0 0 0 1.5px var(--fill-1)",
            transition: "left var(--dur-xslow) var(--ease-swift)",
          }}
        />
      </Show>
    </div>
  );
}
