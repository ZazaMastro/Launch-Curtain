param(
    [string]$Title = "",
    [string]$Subtitle = "",
    [string]$Accent = "#FFFFFF",
    [string]$Logo = "",
    [int]$Timeout = 45
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

function Convert-ToBrush {
    param([string]$Color)

    try {
        return New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Color))
    }
    catch {
        return [System.Windows.Media.Brushes]::White
    }
}

function Convert-ToColor {
    param([string]$Color)

    try {
        return [System.Windows.Media.ColorConverter]::ConvertFromString($Color)
    }
    catch {
        return [System.Windows.Media.Color]::FromRgb(252, 204, 1)
    }
}

$accentColor = Convert-ToColor $Accent
$accentBrush = Convert-ToBrush $Accent
$dimBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(70, 255, 255, 255))

$screenWidth = [System.Windows.SystemParameters]::PrimaryScreenWidth
$screenHeight = [System.Windows.SystemParameters]::PrimaryScreenHeight

$window = New-Object System.Windows.Window
$window.Title = "Launch Curtain"
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$window.Left = 0
$window.Top = 0
$window.Width = $screenWidth
$window.Height = $screenHeight
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.Background = [System.Windows.Media.Brushes]::Black
$window.Opacity = 0

$root = New-Object System.Windows.Controls.Grid
$root.Background = [System.Windows.Media.Brushes]::Black
$window.Content = $root

$stack = New-Object System.Windows.Controls.StackPanel
$stack.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$stack.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$stack.Orientation = [System.Windows.Controls.Orientation]::Vertical
$stack.Margin = New-Object System.Windows.Thickness 0, 0, 0, 0
$root.Children.Add($stack) | Out-Null

if ($Logo -and (Test-Path -LiteralPath $Logo)) {
    $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
    $bitmap.BeginInit()
    $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bitmap.UriSource = New-Object System.Uri $Logo
    $bitmap.EndInit()
    $bitmap.Freeze()

    $image = New-Object System.Windows.Controls.Image
    $image.Source = $bitmap
    $image.Stretch = [System.Windows.Media.Stretch]::Uniform
    $image.Width = [Math]::Min($screenWidth * 0.42, 720)
    $image.MaxHeight = [Math]::Min($screenHeight * 0.2, 180)
    $image.Opacity = 0.94
    $stack.Children.Add($image) | Out-Null
}
else {
    $fallback = New-Object System.Windows.Controls.TextBlock
    $fallback.Text = "PLAYHUB"
    $fallback.Foreground = [System.Windows.Media.Brushes]::White
    $fallback.FontFamily = "Segoe UI"
    $fallback.FontSize = 48
    $fallback.FontWeight = [System.Windows.FontWeights]::Bold
    $fallback.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $stack.Children.Add($fallback) | Out-Null
}

$dots = New-Object System.Windows.Controls.StackPanel
$dots.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$dots.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$dots.Margin = New-Object System.Windows.Thickness 0, 78, 0, 0
$stack.Children.Add($dots) | Out-Null

$dotShapes = @()
$dotGlows = @()
for ($i = 0; $i -lt 3; $i++) {
    $dot = New-Object System.Windows.Shapes.Ellipse
    $dot.Width = 18
    $dot.Height = 18
    $dot.Fill = $dimBrush
    $dot.Opacity = 0.5
    $dot.Margin = New-Object System.Windows.Thickness 11, 0, 11, 0

    $glow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $glow.Color = $accentColor
    $glow.BlurRadius = 22
    $glow.ShadowDepth = 0
    $glow.Opacity = 0.62

    $dots.Children.Add($dot) | Out-Null
    $dotShapes += $dot
    $dotGlows += $glow
}

$script:activeIndex = -1
$fadeDuration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(190))
$startedAt = [DateTime]::UtcNow
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$timer.Add_Tick({
    $elapsed = ([DateTime]::UtcNow - $startedAt).TotalSeconds

    if ($elapsed -ge $Timeout) {
        $timer.Stop()
        $window.Close()
        return
    }

    $active = [Math]::Floor(($elapsed * 2.6) % 3)
    if ($active -ne $script:activeIndex) {
        for ($i = 0; $i -lt $dotShapes.Count; $i++) {
            if ($i -eq $active) {
                $dotShapes[$i].Fill = $accentBrush
                $dotShapes[$i].Effect = $dotGlows[$i]
                $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
                $animation.To = 1
                $animation.Duration = $fadeDuration
                $dotShapes[$i].BeginAnimation([System.Windows.UIElement]::OpacityProperty, $animation)
            }
            else {
                $dotShapes[$i].Fill = $dimBrush
                $dotShapes[$i].Effect = $null
                $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
                $animation.To = 0.5
                $animation.Duration = $fadeDuration
                $dotShapes[$i].BeginAnimation([System.Windows.UIElement]::OpacityProperty, $animation)
            }
        }
        $script:activeIndex = $active
    }
})

$window.Add_KeyDown({
    param($sender, $event)
    if ($event.Key -eq [System.Windows.Input.Key]::Escape) {
        $timer.Stop()
        $window.Close()
    }
})

$window.Add_Loaded({
    $screenFade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $screenFade.To = 1
    $screenFade.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(500))
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $screenFade)
})

$timer.Start()
$window.ShowDialog() | Out-Null
