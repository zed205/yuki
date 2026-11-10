#requires -Version 5.0
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# The live install lives outside the dev working tree; deploys are produced
# by scripts/deploy.ps1 (npm run deploy). This tray only launches/stops it.
$liveRoot = "D:\Apps\YukiWeb"
$logFile = Join-Path $liveRoot "server.log"
$nodeExe = "node"
$serverScript = Join-Path $liveRoot "dist\server\index.js"
$startupRegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startupRegName = "YukiWeb"

# Local llama-server launcher (manual only — started from the tray submenu)
$llamaExe = "d:\llama\b10642\llama-server.exe"
$llamaArgs = '--host 0.0.0.0 --port 1234 -m C:\AIModels\unsloth\Qwen3.5-9B-GGUF\Qwen3.5-9B-Q4_K_M.gguf --mmproj C:\AIModels\unsloth\Qwen3.5-9B-GGUF\mmproj-F16.gguf -c 128000 -ctk q4_0 -ctv q4_0 --flash-attn on --kv-unified  --parallel 1'
#$llamaArgs = '--host 0.0.0.0 --port 1234 -m C:\AIModels\unsloth\gemma-4-E4B-it-GGUF\gemma-4-E4B-it-Q4_K_M.gguf --mmproj C:\AIModels\unsloth\gemma-4-E4B-it-GGUF\mmproj-F16.gguf -c 128000 -ctk q4_0 -ctv q4_0 --cache-ram 2048 --flash-attn on --kv-unified --kv-offload'

$serverProcess = $null
$trayIcon = $null

# C# handlers for capturing the child process output and exit status. These
# must be pure C# (not PowerShell scriptblocks): .NET raises the
# OutputDataReceived/ErrorDataReceived/Exited events on threadpool threads that
# have no PowerShell runspace, so a scriptblock handler throws
# PSInvalidOperationException and kills the tray process.
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Diagnostics;

public class ProcLog {
    public static void Attach(Process p, string outFile) {
        p.OutputDataReceived += (s, e) => {
            if (!String.IsNullOrEmpty(e.Data))
                File.AppendAllText(outFile, String.Format("[{0}] {1}{2}", DateTime.Now.ToString("HH:mm:ss.fff"), e.Data, Environment.NewLine));
        };
        p.ErrorDataReceived += (s, e) => {
            if (!String.IsNullOrEmpty(e.Data))
                File.AppendAllText(outFile, String.Format("[{0}][ERR] {1}{2}", DateTime.Now.ToString("HH:mm:ss.fff"), e.Data, Environment.NewLine));
        };
        p.Exited += (s, e) => {
            File.AppendAllText(outFile, String.Format("[{0}] Server process exited (code {1}){2}", DateTime.Now.ToString("HH:mm:ss.fff"), p.ExitCode, Environment.NewLine));
        };
    }
}
"@

# Hidden window that receives a global hotkey (RegisterHotKey) message.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class YukiHotkeyForm : Form
{
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 0xA3F3;
    private Action _handler;

    public YukiHotkeyForm(Action handler)
    {
        _handler = handler;
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        Opacity = 0;
    }

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public bool RegisterGlobal(uint modifiers, uint vk)
    {
        return RegisterHotKey(this.Handle, HOTKEY_ID, modifiers, vk);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && (int)m.WParam == HOTKEY_ID)
        {
            if (_handler != null) _handler();
            return;
        }
        base.WndProc(ref m);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms

function Write-Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Start-Server {
    if ($script:serverProcess -and !$script:serverProcess.HasExited) {
        Write-Log "Server already running (PID $($script:serverProcess.Id))"
        return
    }
    if (Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue) {
        Write-Log "Server already running (port 3210 in use)"
        return
    }
    if (-not (Test-Path $serverScript)) {
        Write-Log "Server script not found: $serverScript. Run 'npm run deploy' first."
        return
    }
    Write-Log "Starting server: $nodeExe $serverScript"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeExe
    $psi.Arguments = "`"$serverScript`""
    $psi.WorkingDirectory = $liveRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $script:serverProcess = New-Object System.Diagnostics.Process
    $script:serverProcess.StartInfo = $psi
    $script:serverProcess.EnableRaisingEvents = $true

    [ProcLog]::Attach($script:serverProcess, $logFile)

    $script:serverProcess.Start() | Out-Null
    $script:serverProcess.BeginOutputReadLine()
    $script:serverProcess.BeginErrorReadLine()
    Write-Log "Server started (PID $($script:serverProcess.Id))"
}

function Stop-Server {
    if ($script:serverProcess -and !$script:serverProcess.HasExited) {
        Write-Log "Stopping server (PID $($script:serverProcess.Id))"
        taskkill /F /T /PID $script:serverProcess.Id 2>&1 | Out-Null
        $script:serverProcess.WaitForExit(5000)
        Write-Log "Server stopped"
    }
    # fallback: kill anything still holding port 3210
    $portPids = netstat -ano | Select-String ":3210" | ForEach-Object { ($_ -split '\s+')[-1] }
    if ($portPids) {
        $portPids | Get-Unique | ForEach-Object {
            taskkill /F /PID $_ 2>$null
        }
        Start-Sleep 1
    }
}

function Restart-Server {
    Stop-Server
    Start-Sleep 1
    Start-Server
}

function Start-LlamaServer {
    if (Get-NetTCPConnection -LocalPort 1234 -State Listen -ErrorAction SilentlyContinue) {
        Write-Log "Llama server already running (port 1234 in use)"
        return
    }
    Write-Log "Starting llama-server in new window: $llamaExe $llamaArgs"
    Start-Process -FilePath $llamaExe -ArgumentList $llamaArgs -WorkingDirectory (Split-Path $llamaExe)
    Write-Log "Llama server launch requested"
}

function Stop-LlamaServer {
    Write-Log "Stopping llama server"
    $portPids = netstat -ano | Select-String ":1234" | ForEach-Object { ($_ -split '\s+')[-1] }
    if ($portPids) {
        $portPids | Get-Unique | ForEach-Object {
            taskkill /F /PID $_ 2>$null
        }
        Start-Sleep 1
    }
    # fallback: kill any llama-server process
    taskkill /F /IM llama-server.exe 2>$null | Out-Null
    Write-Log "Llama server stopped"
}

function Invoke-VoiceToggle {
    try {
        Invoke-RestMethod -Uri "http://localhost:3210/api/voice/global-toggle" -Method Post -TimeoutSec 5 | Out-Null
        Write-Log "Voice mode toggle requested"
    } catch {
        Write-Log "Voice mode toggle failed: $($_.Exception.Message)"
    }
}

function Get-StartupEnabled {
    $val = Get-ItemProperty -Path $startupRegPath -Name $startupRegName -ErrorAction SilentlyContinue
    return [bool]$val
}

function Set-StartupEnabled($enabled) {
    if ($enabled) {
        $scriptPath = "$PSScriptRoot\yukiweb-tray.vbs"
        Set-ItemProperty -Path $startupRegPath -Name $startupRegName -Value "`"$scriptPath`""
        Write-Log "Startup enabled: $scriptPath"
    } else {
        Remove-ItemProperty -Path $startupRegPath -Name $startupRegName -ErrorAction SilentlyContinue
        Write-Log "Startup disabled"
    }
}

function Show-Settings {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "YukiWeb Settings"
    $form.Size = New-Object Drawing.Size(320, 180)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Icon = $script:trayIcon.Icon
    $form.Topmost = $true

    $startupChk = New-Object System.Windows.Forms.CheckBox
    $startupChk.Text = "Start with Windows"
    $startupChk.Location = New-Object Drawing.Point(20, 20)
    $startupChk.Size = New-Object Drawing.Size(260, 24)
    $startupChk.Checked = (Get-StartupEnabled)

    $okBtn = New-Object System.Windows.Forms.Button
    $okBtn.Text = "OK"
    $okBtn.Location = New-Object Drawing.Point(100, 100)
    $okBtn.Size = New-Object Drawing.Size(100, 30)
    $okBtn.Add_Click({
        Set-StartupEnabled $startupChk.Checked
        $form.Close()
    })

    $form.Controls.AddRange(@($startupChk, $okBtn))
    $form.ShowDialog() | Out-Null
}

function Create-TrayIcon {
    $iconBitmap = New-Object Drawing.Bitmap(16, 16)
    $g = [Drawing.Graphics]::FromImage($iconBitmap)
    $g.Clear([Drawing.Color]::FromArgb(0xFF, 0xD4, 0x76, 0x0A))
    $font = New-Object Drawing.Font("Arial", 12, [Drawing.FontStyle]::Bold)
    $brush = New-Object Drawing.SolidBrush([Drawing.Color]::White)
    $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $g.DrawString("Y", $font, $brush, 1, -1)
    $g.Dispose()
    $hIcon = $iconBitmap.GetHicon()

    $script:trayIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:trayIcon.Icon = [Drawing.Icon]::FromHandle($hIcon)
    $script:trayIcon.Text = "YukiWeb"

    $menu = New-Object System.Windows.Forms.ContextMenuStrip

    $showLogsItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $showLogsItem.Text = "Show Logs"
    $showLogsItem.Add_Click({ Show-Logs })
    $menu.Items.Add($showLogsItem)

    $restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $restartItem.Text = "Restart Server"
    $restartItem.Add_Click({ Restart-Server })
    $menu.Items.Add($restartItem)

    $voiceItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $voiceItem.Text = "Toggle Voice Mode (Ctrl+Alt+V)"
    $voiceItem.Add_Click({ Invoke-VoiceToggle })
    $menu.Items.Add($voiceItem)

    $llamaMenu = New-Object System.Windows.Forms.ToolStripMenuItem
    $llamaMenu.Text = "Llama Server"

    $llamaStartItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $llamaStartItem.Text = "Start Llama Server"
    $llamaStartItem.Add_Click({ Start-LlamaServer })
    $llamaMenu.DropDownItems.Add($llamaStartItem)

    $llamaStopItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $llamaStopItem.Text = "Stop Llama Server"
    $llamaStopItem.Add_Click({ Stop-LlamaServer })
    $llamaMenu.DropDownItems.Add($llamaStopItem)

    $menu.Items.Add($llamaMenu)

    $menu.Items.Add("-")

    $settingsItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $settingsItem.Text = "Settings"
    $settingsItem.Add_Click({ Show-Settings })
    $menu.Items.Add($settingsItem)

    $menu.Items.Add("-")

    $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $exitItem.Text = "Exit"
    $exitItem.Add_Click({
        Stop-Server
        $script:trayIcon.Visible = $false
        [System.Windows.Forms.Application]::Exit()
    })
    $menu.Items.Add($exitItem)

    $script:trayIcon.ContextMenuStrip = $menu
    $script:trayIcon.Visible = $true

    $script:trayIcon.BalloonTipTitle = "YukiWeb"
    $script:trayIcon.BalloonTipText = "Server started"
    $script:trayIcon.ShowBalloonTip(2000)

    return $script:trayIcon
}

Write-Log "=== YukiWeb Tray started ==="
Start-Server
$trayIcon = Create-TrayIcon

# Register global hotkey: Ctrl+Alt+V -> toggle voice mode
$hotkeyHandler = [Action]{ Invoke-VoiceToggle }
$hotkeyForm = New-Object YukiHotkeyForm $hotkeyHandler
$registered = $hotkeyForm.RegisterGlobal(0x3, 0x56)  # MOD_CONTROL|MOD_ALT, 'V'
if ($registered) {
    Write-Log "Global hotkey registered: Ctrl+Alt+V (voice mode)"
} else {
    Write-Log "Global hotkey Ctrl+Alt+V registration FAILED (possibly in use)"
}

# Show the (invisible) hotkey window, then run the message loop. Run($form)
# returns immediately in PowerShell 7 when the form's handle was created early
# by RegisterHotKey; Show() + Run() keeps the loop alive in both shells.
$hotkeyForm.Show()
[System.Windows.Forms.Application]::Run()
