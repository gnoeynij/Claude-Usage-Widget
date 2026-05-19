# probe-opacity.ps1
# Reads the Claude Widget's OS-level window attributes — primarily the
# WS_EX_LAYERED bit and current layered alpha — so we can verify that
# Settings → Background opacity actually drove the Rust code path.
#
# Usage:
#   pwsh scripts/probe-opacity.ps1
#
# Expected: with slider at 0%, LAYERED=False. With slider > 0%, LAYERED=True
# and alpha matches (1 - slider/100) * 255 (floored at 0.15 → alpha ≈ 38).

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WidgetProbe {
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr hWnd, out uint pcrKey, out byte pbAlpha, out uint pdwFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process -Name claude-widget -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "widget not running"; exit 1 }
$hwnd = $proc.MainWindowHandle
$GWL_EXSTYLE = -20
$flags = @{ LAYERED = 0x00080000; TOPMOST = 0x00000008; TOOLWINDOW = 0x00000080 }

$ex = [WidgetProbe]::GetWindowLongPtrW($hwnd, $GWL_EXSTYLE).ToInt64()
$r = New-Object WidgetProbe+RECT
[WidgetProbe]::GetWindowRect($hwnd, [ref]$r) | Out-Null

Write-Output "PID:        $($proc.Id)"
Write-Output "HWND:       0x$($hwnd.ToString('X'))"
Write-Output "ex-style:   0x$($ex.ToString('X8'))"
foreach ($k in $flags.Keys) {
    $set = ($ex -band $flags[$k]) -ne 0
    Write-Output ("  {0,-11} {1}" -f "${k}:", $set)
}
if (($ex -band $flags.LAYERED) -ne 0) {
    $key=0; $a=0; $f=0
    [WidgetProbe]::GetLayeredWindowAttributes($hwnd, [ref]$key, [ref]$a, [ref]$f) | Out-Null
    Write-Output "alpha:      $a / 255 ($([math]::Round($a*100/255,1))%)"
}
Write-Output "rect:       $($r.Left),$($r.Top)  $($r.Right - $r.Left) x $($r.Bottom - $r.Top)"
