import type { JSX } from "solid-js";

type Variant = "accent" | "neutral" | "warning" | "success" | "danger";

type Props = {
  children: JSX.Element;
  variant?: Variant;
};

function tokens(v: Variant) {
  switch (v) {
    case "warning":
      return { bg: "rgba(255,159,10,0.18)", fg: "var(--warning)" };
    case "success":
      return { bg: "rgba(52,199,89,0.18)", fg: "var(--success)" };
    case "danger":
      return { bg: "rgba(255,69,58,0.18)", fg: "var(--danger)" };
    case "neutral":
      return { bg: "var(--fill-2)", fg: "var(--label-secondary)" };
    case "accent":
    default:
      return { bg: "var(--accent-tint)", fg: "var(--accent)" };
  }
}

export function Badge(props: Props) {
  const t = () => tokens(props.variant ?? "accent");
  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "4px",
        padding: "2px 8px",
        "border-radius": "var(--r-pill)",
        background: t().bg,
        color: t().fg,
        "font-size": "10px",
        "font-weight": 600,
        "letter-spacing": "0.04em",
        "line-height": "14px",
      }}
    >
      {props.children}
    </span>
  );
}
