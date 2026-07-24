import { For, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyDarkClass } from "../state/store";

// Strings live here on purpose — not in the i18n dictionaries.
const TXT = {
  en: {
    title: (n: string) => `${n} burned, lifetime.`,
    body: "Congratulations — this device has now converted that much money into tokens. Claude thanks you for your service. 🫡",
    close: "I'm proud",
  },
  ko: {
    title: (n: string) => `평생 ${n} 태우셨습니다.`,
    body: "축하합니다 — 이 기기에서 그만큼의 돈이 토큰이 되었습니다. Claude가 당신의 헌신에 경의를 표합니다. 🫡",
    close: "뿌듯하다",
  },
};

const PARTICLES = Array.from({ length: 14 }, (_, i) => i);

export function MilestoneApp() {
  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang") === "ko" ? "ko" : "en";
  const dark = params.get("dark") === "1";
  const amount = Number(params.get("amount") ?? 0);
  applyDarkClass(dark);
  document.documentElement.lang = lang;
  const s = TXT[lang];
  const pretty = `$${amount.toLocaleString("en-US")}`;

  onMount(() => {
    // Focus so ESC can close it like a real dialog.
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") void getCurrentWindow().close();
    });
  });

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        display: "flex",
        overflow: "hidden",
        "border-radius": "var(--r-window)",
      }}
    >
      <div
        class="glass-card panel-reveal"
        style={{
          flex: 1,
          margin: "8px",
          padding: "14px 16px",
          display: "flex",
          "flex-direction": "column",
          gap: "6px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <For each={PARTICLES}>
          {(i) => (
            <span
              style={{
                position: "absolute",
                top: "20%",
                left: `${6 + i * 7}%`,
                width: "5px",
                height: "5px",
                "border-radius": i % 3 === 0 ? "50%" : "1px",
                background:
                  i % 4 === 0
                    ? "var(--accent)"
                    : i % 4 === 1
                      ? "var(--success-dim, #4ade80)"
                      : i % 4 === 2
                        ? "var(--warning, #fbbf24)"
                        : "var(--label-tertiary)",
                animation: `ms-fall ${1.6 + (i % 5) * 0.35}s ${(i % 7) * 0.12}s var(--ease-smooth) forwards`,
                opacity: 0,
                "pointer-events": "none",
              }}
            />
          )}
        </For>
        <style>{`@keyframes ms-fall {
          0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
          15% { opacity: 0.9; }
          100% { transform: translateY(150px) rotate(240deg); opacity: 0; }
        }`}</style>
        <div class="t-headline" style={{ "font-weight": 700 }}>
          🎉 {s.title(pretty)}
        </div>
        <div class="t-caption label-secondary" style={{ "line-height": 1.5, flex: 1 }}>
          {s.body}
        </div>
        <button
          class="ring-hover"
          onClick={() => void getCurrentWindow().close()}
          style={{
            "align-self": "flex-end",
            padding: "5px 12px",
            "border-radius": "8px",
            background: "var(--accent-tint)",
            color: "var(--accent)",
            "font-weight": 600,
          }}
        >
          {s.close}
        </button>
      </div>
    </div>
  );
}
