# click-mode.ps1 — simulate a click on the SegmentedControl in the footer.
# Used only for headless verification of mode-switch resize. Coordinates assume
# the SegmentedControl is 192px wide, anchored 12+26+8=46px from the window's
# right edge, with the footer vertical center at ~24px above the window bottom.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/click-mode.ps1 -Mode mini

param([string]$Mode = "normal")

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClickApi {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, uint extra);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int x, int y, int cx, int cy, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x02
$MOUSEEVENTF_LEFTUP = 0x04

$proc = Get-Process -Name claude-widget -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "widget not running"; exit 1 }
$hwnd = $proc.MainWindowHandle

$r = New-Object ClickApi+RECT
[ClickApi]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top

# Hoist topmost so the click reaches the widget.
$TOPMOST = [IntPtr]::new(-1)
$SWP = 0x1 -bor 0x2 -bor 0x10
[ClickApi]::SetWindowPos($hwnd, $TOPMOST, 0,0,0,0, $SWP) | Out-Null
Start-Sleep -Milliseconds 300

# SegmentedControl center is at (window_right - 142). Each button ~64px wide.
$cx = $r.Left + $w - 142
$cy = $r.Top + $h - 24

switch ($Mode) {
    "mini"   { $tx = $cx - 64 }
    "normal" { $tx = $cx }
    "detail" { $tx = $cx + 64 }
    default  { Write-Output "unknown mode: $Mode"; exit 1 }
}
$ty = $cy

[ClickApi]::SetCursorPos($tx, $ty) | Out-Null
Start-Sleep -Milliseconds 100
[ClickApi]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[ClickApi]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

Write-Output "clicked $Mode at ($tx, $ty) [window $w x $h at ($($r.Left), $($r.Top))]"
