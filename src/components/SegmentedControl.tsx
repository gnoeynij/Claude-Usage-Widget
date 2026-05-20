import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
} from "solid-js";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
};

// Measurement-based thumb positioning. Calc-based thumb (1/N width + N×100%
// translate) drifts visually in some layouts where the parent's exact inner
// width depends on flex distribution rounding. Reading the selected button's
// actual rect via getBoundingClientRect guarantees pixel-perfect alignment.
export function SegmentedControl<T extends string>(props: Props<T>) {
  let containerEl: HTMLDivElement | undefined;
  const buttonRefs: HTMLButtonElement[] = [];

  const [thumb, setThumb] = createSignal({ left: 0, width: 0 });

  function measure() {
    const idx = props.options.findIndex((o) => o.value === props.value);
    if (idx < 0 || !buttonRefs[idx] || !containerEl) return;
    const cRect = containerEl.getBoundingClientRect();
    const bRect = buttonRefs[idx].getBoundingClientRect();
    setThumb({ left: bRect.left - cRect.left, width: bRect.width });
  }

  // Re-measure whenever the selected value, the label set, or the language
  // changes — the last one shifts button widths when "한국어" replaces "English".
  createEffect(() => {
    props.value;
    props.options.map((o) => o.label).join("|");
    requestAnimationFrame(measure);
  });

  let ro: ResizeObserver | null = null;
  onMount(() => {
    requestAnimationFrame(measure);
    if ("ResizeObserver" in window && containerEl) {
      ro = new ResizeObserver(() => measure());
      ro.observe(containerEl);
      buttonRefs.forEach((b) => b && ro!.observe(b));
    }
  });
  onCleanup(() => ro?.disconnect());

  return (
    <div
      ref={(el) => (containerEl = el)}
      style={{
        position: "relative",
        // Grid (not flex) so each segment is exactly 1fr — flex would shrink
        // shorter labels (e.g. "Mini" vs "Normal") less than longer ones,
        // making the thumb travel asymmetric and the left/right padding of
        // the floating pill unequal.
        display: "grid",
        "grid-template-columns": `repeat(${props.options.length}, 1fr)`,
        padding: "2px",
        background: "var(--fill-3)",
        "border-radius": "var(--r-pill)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          bottom: "2px",
          left: `${thumb().left}px`,
          width: `${thumb().width}px`,
          "border-radius": "var(--r-pill)",
          background: "var(--glass-card)",
          "box-shadow": "0 1px 2px rgba(0,0,0,0.10)",
          // OutQuint (swift) instead of spring — iOS segmented controls don't
          // overshoot. The spring's 1.56 overshoot factor reads as "wobbly"
          // for short, frequent segment hops.
          transition:
            "left var(--dur-base) var(--ease-swift), width var(--dur-base) var(--ease-swift)",
          "pointer-events": "none",
          "z-index": 0,
          opacity: thumb().width > 0 ? 1 : 0,
        }}
      />
      <For each={props.options}>
        {(opt, i) => {
          const selected = () => opt.value === props.value;
          return (
            <button
              ref={(el) => (buttonRefs[i()] = el)}
              class="t-caption"
              onClick={() => props.onChange(opt.value)}
              style={{
                position: "relative",
                "z-index": 1,
                // Grid handles equal-width distribution; no flex/min-width
                // hack needed. The caller still controls the SegmentedControl
                // wrapper width (Footer uses 168px, Settings stretches to the
                // Section's full width automatically).
                padding: "4px 6px",
                "border-radius": "var(--r-pill)",
                background: "transparent",
                color: selected() ? "var(--label)" : "var(--label-secondary)",
                "font-weight": selected() ? 600 : 500,
                "white-space": "nowrap",
                transition:
                  "color var(--dur-fast) var(--ease-smooth), font-weight var(--dur-fast) var(--ease-smooth)",
              }}
            >
              {opt.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
