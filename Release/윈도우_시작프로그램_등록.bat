@echo off
chcp 65001 > nul
echo ===================================================
echo   Claude Widget 자동 실행(시작 프로그램) 등록 스크립트
echo ===================================================
echo.

set "TARGET=%~dp0Claude-Widget.exe"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Claude-Widget.lnk"

if not exist "%TARGET%" (
    echo [오류] Claude-Widget.exe 파일을 찾을 수 없습니다!
    echo 이 스크립트가 실행 파일과 같은 폴더에 있는지 확인해주세요.
    pause
    exit /b
)

echo '%TARGET%' 파일의 바로 가기를 생성합니다...

powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $shortcut = $wshell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = '%TARGET%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.WindowStyle = 1; $shortcut.Save()"

echo.
echo [완료] 성공적으로 시작 프로그램에 등록되었습니다!
echo 다음 PC 부팅 시부터 위젯이 자동으로 켜집니다.
echo.
pause
