param(
    [string]$Title = "",
    [string]$Subtitle = "",
    [string]$Accent = "#FFFFFF",
    [string]$Logo = "",
    [int]$Timeout = 45,
    [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

function Write-OverlayLog {
    param([string]$Message)
    if (-not $LogPath) {
        return
    }

    try {
        $logDir = Split-Path -Parent $LogPath
        if ($logDir) {
            New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        }
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] [OVERLAY] $Message" -Encoding UTF8
    }
    catch {
    }
}

Write-OverlayLog "Overlay script starting timeout=$Timeout logo=$Logo"

try {
    Add-Type -AssemblyName PresentationFramework
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName WindowsBase
    Write-OverlayLog "WPF assemblies loaded"
}
catch {
    Write-OverlayLog "WPF assembly load failed: $($_.Exception.Message)"
    throw
}

$script:XInputAvailable = $false
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class LaunchCurtainXInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_GAMEPAD
    {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_STATE
    {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }

    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    public static extern int XInputGetState(int dwUserIndex, out XINPUT_STATE pState);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int nIndex);

    public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
    }

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong)
    {
        return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong) : SetWindowLongPtr32(hWnd, nIndex, dwNewLong);
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
    $script:XInputAvailable = $true
}
catch {
    $script:XInputAvailable = $false
    Write-OverlayLog "XInput helper unavailable: $($_.Exception.Message)"
}
$script:KeyboardApiAvailable = $script:XInputAvailable

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
$window.Focusable = $false
$hiddenCursor = [System.Windows.Input.Cursors]::None
$window.Cursor = $hiddenCursor

function Set-WindowNoActivate {
    try {
        $handle = (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle
        if ($handle -eq [IntPtr]::Zero) {
            return
        }

        $GWL_EXSTYLE = -20
        $WS_EX_TOOLWINDOW = 0x00000080
        $WS_EX_NOACTIVATE = 0x08000000
        $HWND_TOPMOST = [IntPtr](-1)
        $SWP_NOSIZE = 0x0001
        $SWP_NOMOVE = 0x0002
        $SWP_NOACTIVATE = 0x0010
        $SWP_SHOWWINDOW = 0x0040

        $style = [LaunchCurtainXInput]::GetWindowLongPtr($handle, $GWL_EXSTYLE).ToInt64()
        $newStyle = [IntPtr]($style -bor $WS_EX_TOOLWINDOW -bor $WS_EX_NOACTIVATE)
        [LaunchCurtainXInput]::SetWindowLongPtr($handle, $GWL_EXSTYLE, $newStyle) | Out-Null
        [LaunchCurtainXInput]::SetWindowPos($handle, $HWND_TOPMOST, 0, 0, 0, 0, [uint32]($SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) | Out-Null
    }
    catch {
        # Best effort: the overlay still works even if no-activate styling fails.
    }
}

$script:allowClose = $false
$script:isClosing = $false
$script:closeButtonDown = $false
$script:escapeDown = $false

function Start-CurtainClose {
    if ($script:isClosing) {
        return
    }

    $script:isClosing = $true
    Write-OverlayLog "Overlay closing"
    if ($timer) {
        $timer.Stop()
    }

    $screenFade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $screenFade.To = 0
    $screenFade.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(500))
    $screenFade.Add_Completed({
        $script:allowClose = $true
        $window.Close()
    })
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $screenFade)
}

$root = New-Object System.Windows.Controls.Grid
$root.Background = [System.Windows.Media.Brushes]::Black
$root.Cursor = $hiddenCursor
$window.Content = $root

$stack = New-Object System.Windows.Controls.StackPanel
$stack.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$stack.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$stack.Orientation = [System.Windows.Controls.Orientation]::Vertical
$stack.Margin = New-Object System.Windows.Thickness 0, 0, 0, 0
$stack.Cursor = $hiddenCursor
$root.Children.Add($stack) | Out-Null

$fallbackLogoPath = Join-Path (Split-Path -Parent $PSScriptRoot) "assets\base_logo.png"
$logoLoaded = $false
$logoCandidates = @($Logo, $fallbackLogoPath) | Where-Object { $_ -and ((Test-Path -LiteralPath $_) -or ($_ -match '^https?://')) }
foreach ($logoCandidate in $logoCandidates) {
    try {
        $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
        $bitmap.BeginInit()
        $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bitmap.UriSource = New-Object System.Uri $logoCandidate
        $bitmap.EndInit()
        $bitmap.Freeze()

        $image = New-Object System.Windows.Controls.Image
        $image.Source = $bitmap
        $image.Stretch = [System.Windows.Media.Stretch]::Uniform
        $image.Width = [Math]::Min($screenWidth * 0.42, 720)
        $image.MaxHeight = [Math]::Min($screenHeight * 0.2, 180)
        $image.Opacity = 0.94
        $image.Cursor = $hiddenCursor
        $stack.Children.Add($image) | Out-Null
        $logoLoaded = $true
        Write-OverlayLog "Logo loaded from $logoCandidate"
        break
    }
    catch {
        $logoLoaded = $false
        Write-OverlayLog "Logo load failed from $logoCandidate : $($_.Exception.Message)"
    }
}

if (-not $logoLoaded) {
    Write-OverlayLog "Using text fallback logo"
    $fallback = New-Object System.Windows.Controls.TextBlock
    $fallback.Text = "PLAYHUB"
    $fallback.Foreground = [System.Windows.Media.Brushes]::White
    $fallback.FontFamily = "Segoe UI"
    $fallback.FontSize = 48
    $fallback.FontWeight = [System.Windows.FontWeights]::Bold
    $fallback.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $fallback.Cursor = $hiddenCursor
    $stack.Children.Add($fallback) | Out-Null
}

$startedAt = [DateTime]::UtcNow
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$timer.Add_Tick({
    $elapsed = ([DateTime]::UtcNow - $startedAt).TotalSeconds

    if ($Timeout -gt 0 -and $elapsed -ge $Timeout) {
        Start-CurtainClose
        return
    }

    if ($script:KeyboardApiAvailable) {
        try {
            $escapePressed = (([LaunchCurtainXInput]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0)
            if ($escapePressed -and -not $script:escapeDown) {
                $script:escapeDown = $true
                Start-CurtainClose
                return
            }
            $script:escapeDown = $escapePressed
        }
        catch {
            $script:escapeDown = $false
        }
    }

    if ($script:XInputAvailable) {
        $anyCloseButtonDown = $false
        for ($controller = 0; $controller -lt 4; $controller++) {
            $state = New-Object LaunchCurtainXInput+XINPUT_STATE
            try {
                $result = [LaunchCurtainXInput]::XInputGetState($controller, [ref]$state)
            }
            catch {
                $script:XInputAvailable = $false
                break
            }
            if ($result -ne 0) {
                continue
            }

            $buttons = $state.Gamepad.wButtons
            $closeButtonDown = (($buttons -band 0x2000) -ne 0) -or (($buttons -band 0x1000) -ne 0)
            $anyCloseButtonDown = $anyCloseButtonDown -or $closeButtonDown
            if ($closeButtonDown -and -not $script:closeButtonDown) {
                $script:closeButtonDown = $true
                Start-CurtainClose
                return
            }
        }
        $script:closeButtonDown = $anyCloseButtonDown
    }

})

$window.Add_KeyDown({
    param($sender, $event)
    if ($event.Key -eq [System.Windows.Input.Key]::Escape) {
        Start-CurtainClose
    }
})

$window.Add_Closing({
    param($sender, $event)
    if (-not $script:allowClose) {
        $event.Cancel = $true
        Start-CurtainClose
    }
})

$window.Add_SourceInitialized({
    Set-WindowNoActivate
})

$window.Add_Loaded({
    Set-WindowNoActivate
    Write-OverlayLog "Overlay window loaded"
    $screenFade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $screenFade.To = 1
    $screenFade.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(500))
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $screenFade)
})

$dispatcher = [System.Windows.Threading.Dispatcher]::CurrentDispatcher
$window.Add_Closed({
    Write-OverlayLog "Overlay window closed"
    if ($timer) {
        $timer.Stop()
    }
    $dispatcher.BeginInvokeShutdown([System.Windows.Threading.DispatcherPriority]::Background)
})

$timer.Start()
$window.Show() | Out-Null
[System.Windows.Threading.Dispatcher]::Run()
