# generate-icon.ps1 — render the source icon as 1024×1024 PNG.
# Concept: iOS-style rounded square + Claude orange donut (the widget's
# defining visual). Output is then fed to `npm run tauri icon` to produce
# every platform-specific size in one pass.
#
# Usage:
#   pwsh scripts/generate-icon.ps1
#
# Output: src-tauri/icons/source.png

param([string]$OutPath = "src-tauri/icons/source.png")

Add-Type -AssemblyName System.Drawing

$size = 1024
$radius = 220        # iOS-like corner radius (~21.5% of size)
$ringR = 290         # donut outer radius
$strokeW = 88        # donut stroke width

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded-rectangle background — slight gradient to read as a Liquid Glass
# surface rather than a flat tile.
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseAllFigures()

$bgRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.Color]::FromArgb(255, 255, 252, 248),
    [System.Drawing.Color]::FromArgb(255, 240, 232, 222),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillPath($bgBrush, $path)

# Subtle inner edge so the icon doesn't read as flat at small sizes.
$edgePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 0, 0, 0)), 2
$g.DrawPath($edgePen, $path)

# Donut track — a near-full ring at low contrast establishes the gauge metaphor.
$cx = $size / 2
$cy = $size / 2
$trackColor = [System.Drawing.Color]::FromArgb(255, 220, 218, 212)
$trackPen = New-Object System.Drawing.Pen $trackColor, $strokeW
$trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$ringRect = New-Object System.Drawing.RectangleF (
    [float]($cx - $ringR),
    [float]($cy - $ringR),
    [float]($ringR * 2),
    [float]($ringR * 2)
)
$g.DrawEllipse($trackPen, $ringRect)

# Donut progress — Claude orange gradient, 72% arc, starting from 12 o'clock
# clockwise (matches the in-app Donut component).
$arcRect = New-Object System.Drawing.Rectangle (
    [int]($cx - $ringR - $strokeW / 2),
    [int]($cy - $ringR - $strokeW / 2),
    [int]($ringR * 2 + $strokeW),
    [int]($ringR * 2 + $strokeW)
)
$arcGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $arcRect,
    [System.Drawing.Color]::FromArgb(255, 217, 119, 87),
    [System.Drawing.Color]::FromArgb(255, 197, 100, 74),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
)
$arcPen = New-Object System.Drawing.Pen $arcGrad, $strokeW
$arcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
# DrawArc uses GDI angles: 0° = 3 o'clock, positive = clockwise.
# 12 o'clock = -90°. 72% of 360 = 259.2°. Start at -90, sweep 259.
$g.DrawArc($arcPen, $ringRect, -90, 259)

# Save
$dir = Split-Path $OutPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Output "saved $OutPath ($size x $size)"
