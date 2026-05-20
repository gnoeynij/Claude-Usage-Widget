# generate-icon.ps1 — render the source icon as 1024×1024 PNG.
# Concept: iOS-style rounded square + analog gauge (track + filled arc +
# needle + hub). Static icon shows a 50% baseline so the metaphor reads
# even at small sizes; the runtime tray/taskbar icon is regenerated on
# every usage fetch (see src-tauri/src/tray.rs render_gauge_icon).
# Output is fed to `npm run tauri icon` to produce every platform size.
#
# Usage:
#   pwsh scripts/generate-icon.ps1

param([string]$OutPath = "src-tauri/icons/source.png")

Add-Type -AssemblyName System.Drawing

$size = 1024
$radius = 220                          # iOS-like corner radius
$strokeW = 96                          # thicker than v1's donut for readability
$gaugeR = 320                          # arc radius
$cx = $size / 2
$gaugeCy = ($size / 2) + 60            # shift down to leave room for sweep top
$baselinePct = 0.50                    # static icon shows 50% baseline

$accent = [System.Drawing.Color]::FromArgb(255, 217, 119, 87)
$accentDim = [System.Drawing.Color]::FromArgb(255, 197, 100, 74)
$bg1 = [System.Drawing.Color]::FromArgb(255, 28, 28, 32)
$bg2 = [System.Drawing.Color]::FromArgb(255, 18, 18, 22)
$track = [System.Drawing.Color]::FromArgb(255, 70, 70, 76)
$white = [System.Drawing.Color]::White

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded-rectangle background — vertical gradient for depth.
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseAllFigures()

$bgRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect, $bg1, $bg2,
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillPath($bgBrush, $path)

# Gauge track — full half-circle, low contrast.
$arcRect = New-Object System.Drawing.RectangleF (
    [float]($cx - $gaugeR),
    [float]($gaugeCy - $gaugeR),
    [float]($gaugeR * 2),
    [float]($gaugeR * 2)
)
$trackPen = New-Object System.Drawing.Pen $track, $strokeW
$trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($trackPen, $arcRect, 180, 180)

# Gauge fill — accent gradient, baseline percent of the 180° sweep.
$sweep = 180 * $baselinePct
$arcGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect, $accent, $accentDim,
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
)
$fillPen = New-Object System.Drawing.Pen $arcGrad, $strokeW
$fillPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$fillPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($fillPen, $arcRect, 180, $sweep)

# Needle — white, from hub to fill endpoint.
$needleLen = $gaugeR - 20
$angle = 180 + $sweep
$rad = $angle * [Math]::PI / 180
$nx = $cx + $needleLen * [Math]::Cos($rad)
$ny = $gaugeCy + $needleLen * [Math]::Sin($rad)
$needlePen = New-Object System.Drawing.Pen $white, 28
$needlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$needlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($needlePen, [float]$cx, [float]$gaugeCy, [float]$nx, [float]$ny)

# Hub — small white disk on the pivot.
$hubR = 42
$hubBrush = New-Object System.Drawing.SolidBrush $white
$g.FillEllipse($hubBrush, [float]($cx - $hubR), [float]($gaugeCy - $hubR), [float]($hubR * 2), [float]($hubR * 2))

$dir = Split-Path $OutPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Output "saved $OutPath ($size x $size)"
