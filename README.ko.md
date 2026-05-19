[English](README.md) | **한국어**

# Claude Usage Widget

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![PyQt6](https://img.shields.io/badge/PyQt6-Framework-green.svg)
![Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

> 이 프로젝트는 [INNO-HI/ClaudeUsageWidget](https://github.com/INNO-HI/ClaudeUsageWidget)의 Windows 전용 개인 포크입니다. 원작자 [@khwee2000](https://velog.io/@khwee2000)의 양해를 구하여 공개합니다. 원본 저작권은 [INNO-HI](https://github.com/INNO-HI)에 있으며, 라이선스 조건은 [LICENSE](LICENSE)를 참고하세요.

Claude Usage Widget은 바탕화면 한 구석에 띄워두고 Anthropic Claude API의 사용량을 실시간으로 확인할 수 있는 데스크탑 위젯입니다. 브라우저나 콘솔에 접속할 필요 없이 화면에서 바로 현재 세션과 주간 한도를 볼 수 있습니다.

---

## ✨ Features

- 실시간 모니터링 — 현재 세션과 주간 사용량(All Models / Sonnet)을 퍼센트로 표시
- 풀 모드 / 미니 모드 — 카드 기반 풀 모드와 아이콘 + 퍼센트만 보이는 미니 모드. 헤더의 Claude 아이콘 클릭으로 상호 전환
- 글래스모피즘 디자인 — Windows 환경에 어울리는 무테 위젯, 다크/라이트 모드 지원
- 자유로운 위치·크기 조절 — 상단 바 드래그로 이동, 모서리/가장자리 드래그로 리사이즈, 더블클릭으로 즉시 숨김
- 시스템 트레이 상주 — 위젯을 닫아도 트레이에서 백그라운드 동작
- 옵션 패널 — 언어, 인증, 자동 동기화, 항상 위, 다크 모드, 투명도, 업데이트 확인을 한 곳에서 관리
- 한국어/영어 즉시 전환 — 모든 텍스트(요일·AM/PM 포함)가 동적으로 재번역
- SUIT SemiBold 폰트 번들 — 깔끔한 한글 가독성
- API 호출 안정성 — 시작 시 0–2초 랜덤 지연, 매 sync 주기마다 ±10% jitter, 429 응답 시 지수 백오프(2× → 16× 상한)
- 자동 업데이트 — 옵션 패널의 업데이트 확인 버튼으로 새 버전을 받아 자동 재시작
- 자동 인증 — `~/.claude/.credentials.json`을 자동 감지하여 별도 로그인이 필요 없음

---

## 🚀 Installation & Usage

1. 다운로드 — [Releases](../../releases) 탭에서 최신 `Claude-Widget.exe`를 받습니다.
2. 실행 — `Claude-Widget.exe`를 더블클릭합니다. 실행에는 PC에 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)가 1회 이상 로그인된 인증 정보(`~/.claude/.credentials.json`)가 필요합니다.
3. 조작
   - 풀 ↔ 미니 전환 — 헤더 또는 미니뷰의 Claude 아이콘 클릭
   - 이동 — 상단 회색 바 드래그
   - 리사이즈 — 창 모서리/가장자리 드래그
   - 숨기기 — 상단 바 더블클릭 또는 푸터의 `닫기`
   - 완전 종료 — 시스템 트레이 우클릭 → `프로그램 종료`
   - 설정 — 헤더의 ⚙ 버튼
4. 자동 동기화 — 옵션 패널의 Auto-sync에서 `Off / 5m / 10m / 30m / 1h` 중 선택합니다. 기본값은 10분입니다.

<p align="center">
  <img src="docs/claude_widget_full_mode.png" alt="Full Mode" width="32%">
  <img src="docs/claude_widget_options.png" alt="Options Panel" width="32%">
  <img src="docs/claude_widget_mini_mode.png" alt="Mini Mode" width="32%">
</p>
<p align="center"><sub>풀 모드 · 옵션 패널 · 미니 모드</sub></p>

본 프로그램은 개인 오픈소스 프로젝트로 디지털 서명이 되어 있지 않아 Windows SmartScreen 경고가 표시될 수 있습니다. 악성코드가 아니므로 `추가 정보 → 실행`을 눌러 진행하시면 됩니다.

> ⚠️ 본 위젯은 Claude Code의 OAuth 사용량 엔드포인트를 호출합니다. Anthropic 측에서 해당 엔드포인트가 변경되거나 정책이 바뀔 경우 동작이 멈출 수 있습니다.

---

## 🛠️ Build from Source

> **v2.0+부터 Tauri 2 + Rust + SolidJS** 스택을 사용합니다. 기존 PyQt6 코드는
> 참조용으로 `Source/`에 남겨져 있습니다. 아래는 현재 `main` 브랜치(Liquid
> Glass 재설계 빌드) 기준입니다.

사전 요구: Node ≥ 20, Rust 툴체인(`rustup`), Windows의 경우 Microsoft C++
Build Tools. Windows 11에는 WebView2 런타임이 기본 탑재되어 있고, Windows 10에서는
인스톨러 부트스트래퍼가 자동으로 받아옵니다.

```bash
# 1. 저장소 클론
git clone https://github.com/gnoeynij/Claude-Usage-Widget.git
cd Claude-Usage-Widget

# 2. 의존성 설치
npm install

# 3. 개발 실행
npm run tauri dev

# 4. 프로덕션 빌드
npm run tauri build

# 5. 산출물
#   src-tauri/target/release/bundle/nsis/Claude Widget_<ver>_x64-setup.exe
#   src-tauri/target/release/Claude Widget.exe   (포터블)
```

---

## 📝 Change Log

변경 내역은 [Releases](../../releases) 페이지 또는 영문 README의 [Change Log](README.md#-change-log)를 참고하세요.

---

## 📄 License

이 프로젝트는 [MIT License](LICENSE)를 따릅니다.

- 원본 저작권 © 2026 [INNO-HI](https://github.com/INNO-HI/ClaudeUsageWidget) — Original work
- 수정·추가 저작권 © 2026 choi jinyeong — Modifications and additional features

원작자에게 사전 양해를 구하고 공개되었습니다. MIT 라이선스의 저작권 고지 보존 조건에 따라 본 포크의 사용, 수정, 재배포가 자유롭습니다.

본 프로그램은 [PyQt6](https://www.riverbankcomputing.com/software/pyqt/)(GPL-3.0)를 사용합니다. PyQt6의 GPL-3.0 의무에 따라 본 프로젝트의 전체 소스 코드는 본 GitHub 레포지토리에서 확인할 수 있습니다.

폰트: [SUIT](https://sun.fo/suit/) by Sun (SIL Open Font License)
