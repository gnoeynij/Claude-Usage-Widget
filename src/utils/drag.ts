import { getCurrentWindow } from "@tauri-apps/api/window";
import { error as logError } from "@tauri-apps/plugin-log";

// macOS WKWebView 가 `-webkit-app-region: drag` 미지원 (Chromium-only) →
// JS API `getCurrentWindow().startDragging()` 로 보강. Capabilities 에
// `core:window:allow-start-dragging` 필요 — 없으면 ACL silent fail.
// Interactive children (button / role=button / input) 은 자동 opt-out 해
// 클릭 의미 보존. Windows 는 CSS `-webkit-app-region: drag` 가 동작하므로
// onMouseDown 핸들러는 사실상 no-op 영역에서만 실행.
export function startWindowDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest("button, [role='button'], input")) return;
  getCurrentWindow()
    .startDragging()
    .catch((err) => void logError(`startDragging failed: ${err}`));
}
