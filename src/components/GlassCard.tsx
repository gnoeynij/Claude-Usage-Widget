import type { JSX } from "solid-js";

type Props = {
  children: JSX.Element;
  padding?: number;
  /** When true, the card uses the `--glass-card-accent` material and adds a
   *  1px accent hairline at the top edge. Use for the single hero card in a
   *  group (e.g. Active session in Detail). */
  accent?: boolean;
};

export function GlassCard(props: Props) {
  return (
    <div
      class={`glass-card${props.accent ? " glass-card-accent" : ""}`}
      style={{
        padding: props.padding !== undefined ? `${props.padding}px` : undefined,
      }}
    >
      {props.children}
    </div>
  );
}
