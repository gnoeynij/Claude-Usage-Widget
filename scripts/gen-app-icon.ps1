# 새 .exe 임베드용 아이콘 source.png 생성 (1024×1024)
# 디자인: 트레이 아이콘과 일관 — amber halo + 흰 픽셀 크랩 + 검은 1px outline
# .exe 임베드 icon 은 트레이 런타임 갱신과 별개로 *정적* 이라 amber(중간값) 채택.

Add-Type -AssemblyName System.Drawing

$size = 1024
$crabPath = "D:\workspace\code\personal\Claude-Usage-Widget\src\assets\claude-header.png"
$crab = [System.Drawing.Image]::FromFile($crabPath)
$crabW = $crab.Width; $crabH = $crab.Height

$amber = [System.Drawing.Color]::FromArgb(255, 0xff, 0x9f, 0x0a)

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.Clear([System.Drawing.Color]::Transparent)

# Radial halo — 다단계 ring fade (Gaussian-ish)
# canvas 1024, halo radius 500 (가득 차게)
$cx = $size / 2
$cy = $size / 2
$haloR = 500
$steps = 240

# 톤: 0~0.3 까지 92%, 0.55 까지 65%, 0.8 까지 30%, 1.0 까지 0
for ($i = $steps; $i -ge 0; $i--) {
    $t = $i / $steps
    $r = $haloR * $t
    # Piecewise linear approximation of the 5-stop curve
    if ($t -le 0.3) {
        $alphaFactor = 1.0 - ($t / 0.3) * 0.1   # 1.0 → 0.9
    } elseif ($t -le 0.55) {
        $alphaFactor = 0.9 - (($t - 0.3) / 0.25) * 0.25  # 0.9 → 0.65
    } elseif ($t -le 0.8) {
        $alphaFactor = 0.65 - (($t - 0.55) / 0.25) * 0.35  # 0.65 → 0.30
    } else {
        $alphaFactor = 0.30 - (($t - 0.8) / 0.2) * 0.30   # 0.30 → 0
    }
    $a = [int](235 * $alphaFactor)
    if ($a -lt 2) { continue }
    $col = [System.Drawing.Color]::FromArgb($a, $amber.R, $amber.G, $amber.B)
    $brush = New-Object System.Drawing.SolidBrush $col
    $g.FillEllipse($brush, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    $brush.Dispose()
}

# Crab — 흰색 (Crab 본체)
$cw = 720
$ch = [int]($cw * $crabH / $crabW)
$crabX = ($size - $cw) / 2
$crabY = ($size - $ch) / 2

# 1. 검은 stroke layer — 약간 큰 사이즈로 먼저 그린 후
$strokePadding = 8  # 약 1024 기준, 작은 사이즈에서 약 0.8px
$swBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 0, 0, 0))

# White tint matrix
$matrixData = New-Object 'single[][]' 5
for ($i = 0; $i -lt 5; $i++) { $matrixData[$i] = New-Object 'single[]' 5 }
$matrixData[3][3] = 1
$matrixData[4][0] = 1
$matrixData[4][1] = 1
$matrixData[4][2] = 1
$matrixData[4][4] = 1
$whiteMatrix = New-Object System.Drawing.Imaging.ColorMatrix (, $matrixData)
$whiteAttrs = New-Object System.Drawing.Imaging.ImageAttributes
$whiteAttrs.SetColorMatrix($whiteMatrix)

# Black tint matrix (for stroke layer underneath)
$matrixData2 = New-Object 'single[][]' 5
for ($i = 0; $i -lt 5; $i++) { $matrixData2[$i] = New-Object 'single[]' 5 }
$matrixData2[3][3] = 0.86  # alpha 220/255
$blackMatrix = New-Object System.Drawing.Imaging.ColorMatrix (, $matrixData2)
$blackAttrs = New-Object System.Drawing.Imaging.ImageAttributes
$blackAttrs.SetColorMatrix($blackMatrix)

# Stroke: 8 방향 offset 으로 검정 crab 다중 그리기 (1px outline 효과)
$offsets = @(
    @(-1,-1),@(-1,0),@(-1,1),
    @(0,-1),         @(0,1),
    @(1,-1), @(1,0), @(1,1)
)
foreach ($offset in $offsets) {
    $dx = $offset[0] * $strokePadding
    $dy = $offset[1] * $strokePadding
    $rect = New-Object System.Drawing.Rectangle ([int]($crabX + $dx)), ([int]($crabY + $dy)), $cw, $ch
    $g.DrawImage($crab, $rect, 0, 0, $crabW, $crabH, [System.Drawing.GraphicsUnit]::Pixel, $blackAttrs)
}

# White crab on top
$crabRect = New-Object System.Drawing.Rectangle ([int]$crabX), ([int]$crabY), $cw, $ch
$g.DrawImage($crab, $crabRect, 0, 0, $crabW, $crabH, [System.Drawing.GraphicsUnit]::Pixel, $whiteAttrs)

$outPath = "D:\workspace\code\personal\Claude-Usage-Widget\src-tauri\icons\source.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $crab.Dispose()
"saved $outPath"
