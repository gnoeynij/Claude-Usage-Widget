import type { JSX } from "solid-js";

export function LiquidGlass(props: { children: JSX.Element }) {
  return (
    <div
      class="glass-panel"
      style={{
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        gap: "var(--s-2)",
        padding: "var(--s-3)",
      }}
    >
      {props.children}
    </div>
  );
}
