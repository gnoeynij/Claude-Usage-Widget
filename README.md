# Claude Usage Widget

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![PyQt6](https://img.shields.io/badge/PyQt6-Framework-green.svg)
![Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

**Claude Usage Widget**은 바탕화면 한구석에 띄워두고 Anthropic Claude API의 사용량(현재 세션 한도, 주간 할당량 등)을 실시간으로 추적·모니터링할 수 있는 독립형 데스크탑 위젯입니다. 크롬 웹 브라우저나 콘솔 패널에 접속할 필요 없이 컴퓨터 위에서 즉각적으로 상태를 확인하세요.

---

## ✨ Features (주요 기능)

- **실시간 모니터링**: Claude API의 현재 세션 이용량과 모델별(All Models, Sonnet 등) 주간 한도를 직관적인 퍼센트 UI로 제공
- **독립된 데스크탑 위젯**: Windows 환경에서 거슬리지 않도록 설계된 무테(Frameless) 글래스모피즘 디자인 (다크 모드 / 라이트 모드 지원)
- **자유로운 조작 및 트레이 융합**:
  - `상단 바 드래그`: 화면 어디로든 위치 이동
  - `상단 바 더블클릭`: 바탕화면에서 즉시 숨기기
  - `백그라운드 모니터링`: 위젯을 닫아도 Windows 우측 하단 <b>시스템 트레이</b>에 상주하여 지속 작동
- **최적화된 성능**:
  - API 연속 새로고침 시 TCP/TLS Handshake 지연을 없애는 통신 최적화 적용
  - QThread 메모리 반환 회로(Memory Leak 방지)를 구축하여 하루 종일 켜두어도 가볍고 쾌적한 상태 유지
- **자동 인증**: 로컬 PC의 `~/.claude/.credentials.json`을 자동 식별하여 복잡한 로그인 과정 불필요

---

## 🚀 Installation & Usage (설치 및 사용법)

1. **다운로드**: [Releases](../../releases) 탭에서 최신 `Claude-Widget.exe` 압축 파일을 다운로드합니다.
2. **실행**: 압축을 풀고 `Release/Claude-Widget.exe`를 더블클릭하여 실행합니다.
   > **Note**: 실행하려면 PC에 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)가 1회 이상 로그인된 인증 정보(`~/.claude/.credentials.json`)가 필요합니다.
3. **앱 조작**:
   - 화면 우측 하단 트레이 아이콘 우클릭 -> `프로그램 종료`를 눌러야 앱이 완전히 꺼집니다.
   - 앱 내 톱니바퀴 조작(⚙)으로 항상 위, 다크 모드, 언어(한국어/영어)를 설정할 수 있습니다.
4. **자동 부팅 설정 (선택)**: 폴더 안의 `윈도우_시작프로그램_등록.bat`을 관리자 권한 없이 실행하면 부팅 시 트레이에 자동으로 켜지게 설정됩니다.

---

## 🛠️ Build from Source (직접 빌드하기)

이 프로젝트는 파이썬(Python 3.10 이상)과 PyQt6로 제작되었습니다.

```bash
# 1. 저장소 클론 및 폴더 이동
git clone https://github.com/YourUsername/Claude-Usage-Widget.git
cd Claude-Usage-Widget

# 2. 필수 라이브러리 설치
pip install PyQt6 requests PyInstaller

# 3. 소스 폴더 진입 및 패키징 빌드
cd Source
python -m PyInstaller claude_widget.spec --noconfirm

# 4. 빌드 완료 확인
# Source/dist/ 내에 있는 Claude-Widget.exe 실행
```

---

## 📝 Change Log (최근 업데이트)
**v1.1.0**
- 창 모서리 투명 여백 현상 제거 (라운드 굴곡 해제)
- 위젯 하단 버튼 역할을 '종료(Quit)'에서 백그라운드로 전환되는 '닫기'로 명확하게 분리
- 시스템 트레이 메뉴의 '설정' 버튼을 걷어내고, 위젯 상단 (⚙) 톱니바퀴 조작으로 일원화
- 시스템 트레이 내 '프로그램 종료' 분리 독립
- 공식 한글 도움말 연결 링크 업데이트 (`https://support.claude.com/ko/`)
- 배포용(`Release`)과 소스용(`Source`) 코드 시스템 물리적 분할 적용
- 쓰레드 메모리 찌꺼기 릴리즈 처리 완비 및 API 통신 속도 지연(Handshake) 방지 세션 객체 패치

---

"※ 본 프로그램은 개인 오픈소스 프로젝트로 디지털 서명이 되어있지 않아 Windows SmartScreen 경고 창이 뜰 수 있습니다. 악성코드가 아니니 안심하시고 추가 정보 -> 실행을 눌러주세요!"

## 📄 License
이 프로젝트는 [MIT License](LICENSE)를 따릅니다. 누구나 자유롭게 수정 및 배포할 수 있습니다.
