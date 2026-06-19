# capture-widget.ps1
# Captures the Claude Widget as it appears on screen (OS-composited, so layered
# alpha is honored). Briefly hoists the window topmost so it isn't occluded.
#
# Usage:
#   pwsh scripts/capture-widget.ps1 [output-path]
#
# Default output: imgs/widget-capture.png on the desktop.

param([string]$OutPath = "$env:USERPROFILE\Desktop\imgs\widget-capture.png")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CaptureApi {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int x, int y, int cx, int cy, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process -Name claude-widget -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "widget not running"; exit 1 }
$hwnd = $proc.MainWindowHandle

$r = New-Object CaptureApi+RECT
[CaptureApi]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top

# Remember the window's current always-on-top state. The cleanup below must
# restore *this* state — blindly forcing NOTOPMOST would silently clobber the
# user's AOT setting on every capture (GWL_EXSTYLE=-20, WS_EX_TOPMOST=0x8).
$wasTopmost = ([CaptureApi]::GetWindowLong($hwnd, -20) -band 0x8) -ne 0

# Hoist to topmost briefly so nothing covers it during capture.
$TOPMOST = [IntPtr]::new(-1); $NOTOPMOST = [IntPtr]::new(-2)
$SWP = 0x1 -bor 0x2 -bor 0x10  # NOSIZE | NOMOVE | NOACTIVATE
[CaptureApi]::SetWindowPos($hwnd, $TOPMOST, 0,0,0,0, $SWP) | Out-Null
Start-Sleep -Milliseconds 500

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([System.Drawing.Point]::new($r.Left, $r.Top), [System.Drawing.Point]::Empty, [System.Drawing.Size]::new($w, $h))
$dir = Split-Path $OutPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# Restore the original z-order — keep AOT pinned if it was on, else drop back.
$restore = if ($wasTopmost) { $TOPMOST } else { $NOTOPMOST }
[CaptureApi]::SetWindowPos($hwnd, $restore, 0,0,0,0, $SWP) | Out-Null
Write-Output "saved $OutPath  ($w x $h)"
