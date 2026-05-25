# 2026-05-24 — macOS 배경 투명도 (opacity slider) 10시간 시도 회고

**상태**: 폐기 (사용자 v2.1.1 으로 원복). 향후 동일 영역 재시도 시 *사전 read 의무* 자료.
**관련**: CLAUDE.md 회귀 사례 §17, BACKLOG P2 "macOS opacity slider 재시도", v2.1.1 (Windows 정상 동작 마지막 상태)

---

## 시도 흐름

### 1차: NSVisualEffectView 의 alpha + isHidden 토글
- **접근**: `vibrancy_mac.rs::clear_vibrancy` 를 *NSVisualEffectView 제거* 대신 `alphaValue = 0 + isHidden = YES`
- **가설**: layer composing 유지하면서 시각만 사라지면 WKWebView 검은 backing 안 노출
- **결과**: 효과 없음. AppKit vibrancy material 이 view backing 과 *별개 layer* 에 paint — alpha/hidden 무시
- **시각**: 위젯이 vibrancy 색 그대로, fade 안 됨

### 2차: WKWebView 에 `setValue:NO forKey:@"drawsBackground"`
- **접근**: iOS UIWebView 의 KVC 패턴
- **결과**: **crash** — `NSUnknownKeyException` (macOS WKWebView 에 `drawsBackground` KVC key 없음, iOS 잔재)

### 3차: WKWebView + 모든 subview 재귀로 `setOpaque:NO + layer.backgroundColor = clearColor.CGColor`
- **접근**: 자식 view 의 backing 까지 모두 clear
- **결과**: **crash + content render 도 invisible** — Apple private subclass 가 NSException throw + content layer 까지 transparent

### 4차: 위 3차의 *재귀 제거* (WKWebView 자체만)
- **결과**: **crash 같음** — `_postDidFinishNotification` observer 안 NSException

### 5차: wry production pattern + `objc2::exception::catch`
- **접근**: wry crate (Tauri 의 webview crate) 가 사용하는 *진짜 패턴* — `setValue: clearColor.CGColor forKey: @"backgroundColor"` (NSValue 의 KVC, `drawsBackground` 아닌 `backgroundColor`) + `setOpaque:NO`
- **추가 안전책**: `objc2::exception::catch` 로 NSException 잡으려 함
- **결과**: **crash** — catch 가 우회됨 (observer 안의 NSException 이 catch frame 밖에서 fire — Cocoa 의 notification 이 unwind 과정 다름)

### 6차 (차선): NSWindow.alphaValue 토글
- **접근**: WKWebView 자체 안 건드림. NSWindow.alphaValue 직접 토글 (공식 property, NSException 위험 거의 없음)
- **결과**: crash 없음. 단 *content 도 같이 fade* — Windows 의 *background only fade + content opaque* 와 다름
- **range 시도**: `1.0 → 0` (완전 사라짐) vs `1.0 → 0.35` (희미하지만 visible) — 후자가 Windows reference 100% 시각과 더 가까움

### 7차 (실제 성공 영역): `WebviewWindow::with_webview` at setup
- **핵심 깨달음**: 1~5차 시도 모두 *frontend boot 후 IPC* 시점에 호출 — `_postDidFinishNotification` observer 안 영역. *setup 시점* (Tauri setup hook + `with_webview` callback) 은 observer *전* 이라 NSException 영역 회피
- **접근**: setup hook 에서 `window.with_webview(|webview| { setBackgroundColor:clearColor + setOpaque:NO })`
- **3중 안전**: `respondsToSelector:` + `objc2::exception::catch` + `AssertUnwindSafe`
- **결과**: **crash 없음! WKWebView 진짜 transparent 동작**. Log: `force_webview_transparent_at_setup: applied`

### 8차 (보완): `--bg-alpha-mult` floor (light 0.05 / dark 0.3)
- **접근**: 7차 후 *content visible 보장* 위해 CSS mult 의 최소 floor 추가
- **이유**: macOS WKWebView transparent + .glass-panel alpha 0 합성 시 content (text/donut) 도 desktop blending 으로 invisible. floor 로 background 가 약하게 paint 되어 content layer anchor
- **다크/라이트 분기**: 다크 panel rgb(38,40,52) 의 *어두운 톤* 이 light floor (0.05) 면 *밝은 desktop blending* 으로 흰 톤 paint → Windows reference 의 *어두운 wash* 와 어긋남. 다크 floor 0.3 로 매치
- **결과**: content visible OK. Windows reference 와 *시각상 유사* 하지만 *desktop blending 차이로 100% 일치 X*

## 부수 시도 (지원 코드)

- `set_window_alpha` IPC 신설 + lib.rs invoke_handler 등록 (6차)
- `clear_vibrancy` 가 진짜 NSVisualEffectView 제거 ↔ no-op 사이 4번 왕복
- `apply_mica` idempotent check (NSVisualEffectView 이미 있으면 skip)
- Cargo.toml 의 `objc2 features = ["exception"]` 추가 (5차)
- `AssertUnwindSafe` wrap (`AnyObject` pointer 의 UnwindSafe 미만족)
- 재귀 view tree dump (진단 용)
- `class!(NSVisualEffectView)` `isKindOfClass` 검사 (subview 탐색)
- 캡처 자동화 (light/dark × 0/50/100 = 6 컷)

## 진짜 root cause

**macOS WKWebView 는 *opaque system 색 backing*** (라이트=흰색, 다크=어두운 회색) — Apple WebKit 의 default 동작. Windows WebView2 (Chromium) 가 *natively transparent* 인 것과 fundamentally 다름.

Tauri 의 `transparent: true` 설정이 *NSWindow 만* transparent 처리하고 *WKWebView 까지 안 닿음*. wry 가 *attribute.transparent = true* 시 `setBackgroundColor:clearColor + setOpaque:NO` 호출하지만 *Tauri 에서 그 attribute 가 wry 로 전달되는 경로 누락* (추정 — 정확한 확인 안 함).

## 깨달은 핵심

1. **타이밍이 첫 결정 변수** — 같은 코드라도 setup 시점 (observer 전) 에 호출하면 OK, runtime IPC 시점에 호출하면 NSException
2. **KVC key 영역 잘못 선택** — `drawsBackground` (iOS) ≠ `backgroundColor` (macOS WKWebView). 1-5차 의 시간 손실 원인
3. **`objc2::exception::catch` 가 만능 아님** — AppKit notification observer 안의 NSException 은 catch frame 밖에서 fire
4. **macOS NSWindow.alphaValue 가 *safe fallback*** — 공식 property, NSException 영역 없음. 단 *전체 윈도우 fade* 라 *background only fade* 모방 불가
5. **content paint 와 background fade 가 macOS 에선 합성 차이** — Windows 처럼 *.glass-panel alpha 0 + content opaque* 시각 만들려면 CSS floor 필요

## 폐기 시점

사용자가 `v2.1.1` 으로 원복 요청 → 전부 폐기. 모든 시도 코드 `git reset --hard HEAD~1` 으로 사라짐. 단 *위 정리* 가 *향후 동일 영역 작업* 시 *시간 절약* 정보.

---

## 향후 재시도 시 권장 순서 (이 회고 기반)

1. **7차 패턴 + 8차 CSS floor 묶음으로 다시 시도** — `with_webview` at setup + `respondsToSelector:` + `catch` + `AssertUnwindSafe` + CSS floor 라이트/다크 분기. *이미 작동 확인된 영역*.
2. **단점 인정**: macOS 에서는 *Windows reference 와 100% 시각 일치 불가능*. desktop blending 차이로 *유사* 까지만.
3. **사용자 동의 확인**: *유사 동작 + macOS 시각 약간 다름* vs *기능 비활성 + slider 숨김* 중 선택. 사용자가 *원복* 신호 줬다는 건 *유사 동작도 만족 X* 가능성.
4. **대안 path**: Tauri / wry 의 `transparent` 옵션이 *향후 wry → WKWebView 까지 닿게* 패치되면 자연 해결. 그 시점에 재시도가 가장 ROI 높음.
