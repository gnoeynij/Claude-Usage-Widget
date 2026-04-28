# Claude Usage Widget

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![PyQt6](https://img.shields.io/badge/PyQt6-Framework-green.svg)
![Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

**Claude Usage Widget**은 바탕화면 한 구석에 띄워두고 Anthropic Claude API의 사용량(현재 세션 한도, 주간 할당량 등)을 실시간으로 추적·모니터링할 수 있는 독립형 데스크탑 위젯입니다. 크롬 웹 브라우저나 콘솔 패널에 접속할 필요 없이 컴퓨터 위에서 즉각적으로 상태를 확인하세요.

---

## ✨ Features (주요 기능)

- **실시간 모니터링**: Claude API의 현재 세션 이용량과 모델별(All Models, Sonnet 등) 주간 한도를 직관적인 퍼센트 UI로 제공
- **풀 모드 / 미니 모드 전환**:
  - `풀 모드`: 카드 기반 자세한 사용량 + 진행바 + 초기화 시각
  - `미니 모드`: Claude 아이콘 + 항목별 % 만 보이는 미니멀 디자인 (가로 폭 ≈18cm까지 축소 가능)
  - 헤더의 Claude 아이콘 클릭 → 미니 진입 / 미니뷰의 아이콘 클릭 → 풀 모드 복귀
- **독립된 데스크탑 위젯**: Windows 환경에서 거슬리지 않도록 설계된 무테(Frameless) 글래스모피즘 디자인 (다크 모드 / 라이트 모드 지원)
- **자유로운 조작 및 트레이 융합**:
  - `상단 바 드래그`: 화면 어디로든 위치 이동
  - `창 모서리 드래그`: 위젯 크기 자유 조절 (콘텐츠 반응형 스케일 + 잘림 없는 최소 크기 보장)
  - `리사이즈 커서 힌트`: 모서리/가장자리 진입 시 마우스 포인터 자동 변경
  - `상단 바 더블클릭`: 바탕화면에서 즉시 숨기기
  - `백그라운드 모니터링`: 위젯을 닫아도 Windows 우측 하단 시스템 트레이에 상주하여 지속 작동
- **표시/가독성 커스터마이징**:
  - `옵션 패널`: ⚙ 버튼으로 언어 / 인증 / 자동 동기화 / 항상 위 / 다크 모드 / 투명도 일괄 관리
  - `배경 투명도 슬라이더`: 0% = 완전 불투명, 100% = 완전 투명
  - `한국어/영어 즉시 전환`: 모든 텍스트(상태/요일/AM-PM 포함) 동적 재번역
  - `SUIT SemiBold` 폰트 번들: 깔끔한 한글 가독성
- **다중 PC 안전 (v1.3.0+)**:
  - 시작 시 0–2초 랜덤 지연 (동시 부팅 thundering-herd 방지)
  - 매 sync 주기마다 ±10% jitter (PC 간 호출 시점 자연 분산)
  - `429 Rate Limited` 시 지수 백오프 (2× → 4× → 8× → 16× 상한, 성공 즉시 복귀)
- **최적화된 성능**:
  - API 연속 새로고침 시 TCP/TLS Handshake 지연을 없애는 통신 최적화 적용
  - 리사이즈 중 quantized 0.05 단위 스케일링 + 아이콘 캐싱으로 매끄러운 드래그
  - QThread 메모리 반환 회로(Memory Leak 방지)를 구축하여 하루 종일 켜두어도 가볍고 쾌적한 상태 유지
- **자동 인증**: 로컬 PC의 `~/.claude/.credentials.json`을 자동 식별하여 복잡한 로그인 과정 불필요

---

## 🚀 Installation & Usage (설치 및 사용법)

1. **다운로드**: [Releases](../../releases) 탭에서 최신 `Claude-Widget.exe` 파일을 다운로드합니다.
2. **실행**: `Claude-Widget.exe`를 더블클릭하여 실행합니다.
   > **Note**: 실행하려면 PC에 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)가 1회 이상 로그인된 인증 정보(`~/.claude/.credentials.json`)가 필요합니다.
3. **앱 조작**:
   - **풀모드 ↔ 미니모드 전환**: 헤더(또는 미니뷰)의 Claude 아이콘 클릭
   - **이동**: 상단 회색 바 드래그
   - **리사이즈**: 창 모서리/가장자리 드래그
   - **숨기기**: 상단 바 더블클릭 또는 푸터 [닫기]
   - **완전 종료**: 시스템 트레이 우클릭 → `프로그램 종료`
   - **설정**: 헤더 ⚙ 버튼 (옵션 패널 토글)
4. **자동 동기화**: 옵션 패널 → Auto-sync 항목 → `Off / 5m / 10m / 30m / 1h` 선택. **기본값은 10분** — 다중 PC 환경에서도 부담이 적습니다.

---

## 🛠️ Build from Source (직접 빌드하기)

이 프로젝트는 파이썬(Python 3.10 이상)과 PyQt6로 제작되었습니다.

```bash
# 1. 저장소 클론 및 폴더 이동
git clone https://github.com/gnoeynij/Claude-Usage-Widget.git
cd Claude-Usage-Widget/Source

# 2. 필수 라이브러리 설치
pip install -r requirements.txt
pip install pyinstaller

# 3. (선택) SUIT SemiBold 폰트를 번들하려면
#    https://sun.fo/suit/ 또는 https://github.com/sun-typeface/SUIT 에서 다운로드 후
#    SUIT-SemiBold.ttf를 Source/assets/fonts/ 에 배치
#    (없으면 Segoe UI 폴백)

# 4. PyInstaller 빌드
python -m PyInstaller claude_widget.spec --noconfirm --clean

# 5. 빌드 완료 확인
# Source/dist/Claude-Widget.exe 실행
```

---

## 📝 Change Log

**v1.3.0** (현재)
- **미니 모드 추가**: Claude 아이콘 + 항목별 %만 표시하는 미니멀 뷰. 헤더/미니 아이콘 클릭으로 전환
- **SUIT SemiBold 폰트 번들**: 깔끔한 한글 렌더링, 별도 설치 불필요
- **API 안전성**: jitter (±10%) + 시작 지연 (0–2s) + 429 지수 백오프
- **자동 동기화 기본값**: **10분**
- **자동 동기화 옵션 위치 변경**: 콘텐츠 영역 → 옵션 패널로 이동
- **주간 reset 시각 i18n**: 한국어에서도 "월요일 오후 5:30"으로 자연스럽게 표시
- **헤더 status 텍스트 wrap**: "Token expired..." 같은 긴 메시지 잘림 방지
- **미니 모드 미연결 시 0% 표시** (이전 `--`)
- **풀모드 최소 크기 합리화** (280×450) — weekly 카드 잘림 해결
- **리사이즈 성능 최적화**: quantized scale (0.05 step) + 아이콘 캐싱
- **버전 색상 가시성 개선** (브랜드 오렌지)
- **코드 리팩토링**

**v1.2.0**
- 위젯 크기 조절 방식을 설정 슬라이더에서 창 모서리/가장자리 드래그 방식으로 전환
- 모서리 리사이즈 시 커서 힌트(가로/세로/대각선) 추가
- 리사이즈 시 카드/텍스트/진행바가 창 폭에 맞춰 반응형으로 스케일되도록 개선
- 배경 투명도 옵션 동작 정비 (0% 불투명, 100% 투명)
- 배경 투명도 100% 설정 시 마우스 클릭이 통과되는 현상 수정
- 현재 세션 진행바 눈금 숫자(0/25/50/75/100) 잘림 문제 수정
- 설정 패널 토글 닫힘 시 위젯 높이가 이전 크기로 복원되도록 수정
- 프레임리스 리사이즈 처리 안정화 및 실행 크래시 이슈 개선

**v1.1.0**
- 창 모서리 투명 여백 현상 제거 (라운드 굴곡 해제)
- 위젯 하단 버튼 역할을 '종료(Quit)'에서 백그라운드로 전환되는 '닫기'로 명확하게 분리
- 시스템 트레이 메뉴의 '설정' 버튼을 걷어내고, 위젯 상단 (⚙) 톱니바퀴 조작으로 일원화
- 시스템 트레이 내 '프로그램 종료' 분리 독립
- 공식 한글 도움말 연결 링크 업데이트 (`https://support.claude.com/ko/`)
- 배포용(`Release`)과 소스용(`Source`) 코드 시스템 물리적 분할 적용
- 쓰레드 메모리 찌꺼기 릴리즈 처리 완비 및 API 통신 속도 지연(Handshake) 방지 세션 객체 패치

---

"※ 본 프로그램은 개인 오픈소스 프로젝트로 디지털 서명이 되어있지 않아 Windows SmartScreen 경고 창이 뜰 수 있습니다. 악성코드가 아니니 안심하시고 추가 정보 → 실행을 눌러주세요!"

## 📄 License
이 프로젝트는 [MIT License](LICENSE)를 따릅니다. 누구나 자유롭게 수정 및 배포할 수 있습니다.

폰트: [SUIT](https://sun.fo/suit/) by Sun (SIL Open Font License)
