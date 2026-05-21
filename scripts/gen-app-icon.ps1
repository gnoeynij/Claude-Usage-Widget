# 새 .exe 임베드용 아이콘 source.png 생성 (1024×1024)
# 디자인: halo 제거, 흰 픽셀 크랩 + 굵은 검은 stroke 만. 사용자 요청.

Add-Type -AssemblyName System.Drawing

$size = 1024
$crabPath = "D:\workspace\code\personal\Claude-Usage-Widget\src\assets\claude-header.png"
$crab = [System.Drawing.Image]::FromFile($crabPath)
$crabW = $crab.Width; $crabH = $crab.Height

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.Clear([System.Drawing.Color]::Transparent)

# Crab — canvas 가득 차게 (halo 없이 단독이라 충분히 크게)
$cw = 900
$ch = [int]($cw * $crabH / $crabW)
$crabX = ($size - $cw) / 2
$crabY = ($size - $ch) / 2

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

# Black tint matrix (stroke layer)
$matrixData2 = New-Object 'single[][]' 5
for ($i = 0; $i -lt 5; $i++) { $matrixData2[$i] = New-Object 'single[]' 5 }
$matrixData2[3][3] = 1.0
$blackMatrix = New-Object System.Drawing.Imaging.ColorMatrix (, $matrixData2)
$blackAttrs = New-Object System.Drawing.Imaging.ImageAttributes
$blackAttrs.SetColorMatrix($blackMatrix)

# Stroke: 16 방향 + 굵게 (padding 20px in 1024 canvas, 다운스케일 시 1-2px outline)
$strokePadding = 20
# 8 방향 + 16 방향 (촘촘한 outline)
$offsets = @()
for ($a = 0; $a -lt 360; $a += 22.5) {
    $rad = $a * [Math]::PI / 180
    $offsets += , @([Math]::Round([Math]::Cos($rad), 4), [Math]::Round([Math]::Sin($rad), 4))
}
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
