# Генерация PWA-иконок Recartly (изумрудный градиент «Сметы» + монограмма R).
# Запуск: pwsh -File frontend/scripts/generate-icons.ps1
param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'public\icons')
)

Add-Type -AssemblyName System.Drawing

function New-RecartlyIcon {
    param(
        [int]$Size,
        [string]$Path,
        [double]$LogoScale = 0.60
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    # Изумруд «Сметы»: primary-400 → primary-700
    $from = [System.Drawing.Color]::FromArgb(255, 47, 193, 136)
    $to = [System.Drawing.Color]::FromArgb(255, 10, 112, 70)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $from, $to, 45.0
    $g.FillRectangle($brush, $rect)

    # Монограмма
    $fontSize = [single]($Size * $LogoScale)
    $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF 0, ($Size * 0.02), $Size, $Size
    $g.DrawString('R', $font, [System.Drawing.Brushes]::White, $textRect, $sf)

    # Акцентная точка — «искра» в правом верхнем углу
    $dotR = [single]($Size * 0.055)
    $dotX = [single]($Size * 0.74)
    $dotY = [single]($Size * 0.24)
    $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
    $g.FillEllipse($dotBrush, $dotX, $dotY, $dotR * 2, $dotR * 2)

    if (-not (Test-Path $OutDir)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $brush.Dispose()
    $font.Dispose()
    $dotBrush.Dispose()
    $bmp.Dispose()

    Write-Host "created $Path ($Size px)"
}

New-RecartlyIcon -Size 192 -Path (Join-Path $OutDir 'icon-192.png')
New-RecartlyIcon -Size 512 -Path (Join-Path $OutDir 'icon-512.png')
New-RecartlyIcon -Size 192 -Path (Join-Path $OutDir 'icon-maskable-192.png') -LogoScale 0.46
New-RecartlyIcon -Size 512 -Path (Join-Path $OutDir 'icon-maskable-512.png') -LogoScale 0.46
New-RecartlyIcon -Size 180 -Path (Join-Path $OutDir 'apple-touch-icon.png')
New-RecartlyIcon -Size 32 -Path (Join-Path $OutDir 'favicon-32.png') -LogoScale 0.66
