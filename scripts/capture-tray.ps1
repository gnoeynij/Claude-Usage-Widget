# Capture the system tray area (bottom-right corner of primary screen)
# to verify how the widget's tray icon actually renders at small sizes.

Add-Type -AssemblyName System.Drawing,System.Windows.Forms

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$tw = 400
$th = 60
$srcX = $screen.Width - $tw
$srcY = $screen.Height - $th

$bmp = New-Object System.Drawing.Bitmap $tw, $th
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($srcX, $srcY, 0, 0, (New-Object System.Drawing.Size $tw, $th))
$out = "$env:USERPROFILE\Desktop\imgs\tray-area.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $out ($tw x $th)"
