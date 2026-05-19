type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
};

export function Switch(props: Props) {
  return (
    <button
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
      style={{
        position: "relative",
        width: "42px",
        height: "26px",
        "border-radius": "var(--r-pill)",
        background: props.checked ? "var(--accent)" : "var(--fill-1)",
        transition: "background var(--dur-fast) var(--ease-smooth)",
        opacity: props.disabled ? 0.45 : 1,
        "flex-shrink": 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "2px",
          left: props.checked ? "18px" : "2px",
          width: "22px",
          height: "22px",
          "border-radius": "50%",
          background: "white",
          "box-shadow":
            "0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.04)",
          transition: "left var(--dur-base) var(--ease-spring)",
        }}
      />
    </button>
  );
}
