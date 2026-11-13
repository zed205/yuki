// YukiWeb system-tray application (single-file C# WinForms port of the old
// PowerShell tray.ps1). Creates a tray icon, manages the Node server process
// (start/stop/restart + log to file), tails the log, starts/stops the local
// llama-server, and manages the Windows startup entry.
//
// Build:  csc.exe /nologo /target:exe /out:yukiweb-tray.exe
//         /reference:System.dll /reference:System.Drawing.dll
//         /reference:System.Windows.Forms.dll /reference:Microsoft.Win32.dll
//         yukiweb-tray.cs
//
// The .ico (yukiweb-tray.ico) is loaded next to the .exe at runtime; falls back
// to the default application icon if it is missing.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace YukiWebTray
{
    internal static class Program
    {
        // ---------------- Configuration ----------------
        private const string AppDir = @"D:\Apps\YukiWeb";
        private const string ServerJs = @"dist\server\index.js";
        private const string LogFile = @"logs\yukiweb.log";
        private const string LogDir = @"logs";
        private const string Port = "3210";

        // Startup registry (Run key) for "start with Windows".
        private const string StartupRegPath =
            @"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        private const string StartupRegName = "YukiWeb Tray";

        // Local llama.cpp server (optional; only if the exe is present).
        private const string LlamaServerExe = @"C:\Windows\System32\llama-server.exe";
        private const string LlamaModel =
            @"C:\Users\Jordan\Documents\llama\models\qwen3-vl-8b-instruct\qwen3-vl-8b-instruct.Q5_K_M.gguf";
        private const string LlamaHost = "127.0.0.1";
        private const string LlamaPort = "8082";

        // ---------------- State ----------------
        private static readonly object ProcLock = new object();
        private static readonly object LogLock = new object();
        private static NotifyIcon trayIcon;
        private static ContextMenuStrip mainMenu;
        private static ToolStripMenuItem serverStatusItem;
        private static Process serverProc;
        private static Process llamaProc;
        private static Form logsForm;
        private static bool shuttingDown;

        private static string LogPath
        {
            get { return Path.Combine(AppDir, LogFile); }
        }

        // ---------------- Entry point ----------------
        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                InitializeApp();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to start YukiWeb tray:\n" + ex.Message,
                    "YukiWeb Tray", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            Application.Run();
            return 0;
        }

        // ---------------- Init ----------------
        private static void InitializeApp()
        {
            EnsureLogDir();

            trayIcon = new NotifyIcon();
            trayIcon.Text = "YukiWeb (server starting\u2026)";
            trayIcon.Icon = LoadIcon();
            trayIcon.DoubleClick += delegate { ShowLogsWindow(); };

            mainMenu = BuildMainMenu();
            trayIcon.ContextMenuStrip = mainMenu;
            trayIcon.Visible = true;

            StartServer();
        }

        private static Icon LoadIcon()
        {
            // Prefer the embedded icon (the .exe is self-contained).
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                foreach (string name in asm.GetManifestResourceNames())
                {
                    if (name.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
                    {
                        using (Stream s = asm.GetManifestResourceStream(name))
                        {
                            if (s != null)
                                return new Icon(s);
                        }
                    }
                }
            }
            catch { }
            // Fall back to a .ico next to the .exe.
            try
            {
                string exeDir = Path.GetDirectoryName(
                    Assembly.GetExecutingAssembly().Location);
                string ico = Path.Combine(exeDir, "yukiweb-tray.ico");
                if (File.Exists(ico))
                    return new Icon(ico);
            }
            catch { }
            return SystemIcons.Application;
        }

        // ---------------- Main menu ----------------
        private static ToolStripMenuItem llamaStartItem;
        private static ToolStripMenuItem llamaStopItem;

        private static ContextMenuStrip BuildMainMenu()
        {
            var menu = new ContextMenuStrip();

            // Server status (disabled, informational).
            serverStatusItem = new ToolStripMenuItem("Server: Starting\u2026")
            {
                Enabled = false
            };
            menu.Items.Add(serverStatusItem);

            // Open the web UI.
            var openWeb = new ToolStripMenuItem("Open YukiWeb");
            openWeb.Click += delegate { OpenBrowser(); };
            menu.Items.Add(openWeb);

            menu.Items.Add(new ToolStripSeparator());

            // ---- Server submenu ----
            var serverMenu = new ToolStripMenuItem("Server");
            var srvStart = new ToolStripMenuItem("Start");
            srvStart.Click += delegate { StartServer(); };
            var srvStop = new ToolStripMenuItem("Stop");
            srvStop.Click += delegate { StopServer(); };
            var srvRestart = new ToolStripMenuItem("Restart");
            srvRestart.Click += delegate { RestartServer(); };
            serverMenu.DropDownItems.AddRange(new ToolStripItem[] { srvStart, srvStop, srvRestart });
            menu.Items.Add(serverMenu);

            // ---- Llama submenu ----
            var llamaMenu = new ToolStripMenuItem("Llama Server");
            if (!File.Exists(LlamaServerExe))
            {
                var notInstalled = new ToolStripMenuItem("Not Installed")
                {
                    Enabled = false
                };
                llamaMenu.DropDownItems.Add(notInstalled);
            }
            else
            {
                llamaStartItem = new ToolStripMenuItem("Start");
                llamaStartItem.Click += delegate { StartLlamaServer(); };
                llamaStopItem = new ToolStripMenuItem("Stop");
                llamaStopItem.Click += delegate { StopLlamaServer(); };
                llamaMenu.DropDownItems.AddRange(new ToolStripItem[] { llamaStartItem, llamaStopItem });
                UpdateLlamaMenuState();
            }
            menu.Items.Add(llamaMenu);

            // ---- Log submenu ----
            var logMenu = new ToolStripMenuItem("Logs");
            var showLogs = new ToolStripMenuItem("Show Logs");
            showLogs.Click += delegate { ShowLogsWindow(); };
            var clearLog = new ToolStripMenuItem("Clear Log");
            clearLog.Click += delegate { ClearLogFile(); };
            logMenu.DropDownItems.AddRange(new ToolStripItem[] { showLogs, clearLog });
            menu.Items.Add(logMenu);

            menu.Items.Add(new ToolStripSeparator());

            var openFolder = new ToolStripMenuItem("Open App Folder");
            openFolder.Click += delegate { OpenInExplorer(AppDir); };
            menu.Items.Add(openFolder);

            menu.Items.Add(new ToolStripSeparator());

            var settings = new ToolStripMenuItem("Settings\u2026");
            settings.Click += delegate { ShowSettingsWindow(); };
            menu.Items.Add(settings);

            menu.Items.Add(new ToolStripSeparator());

            var exit = new ToolStripMenuItem("Exit YukiWeb");
            exit.Click += delegate { ExitApp(); };
            menu.Items.Add(exit);

            return menu;
        }

        private static void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://localhost:" + Port) { UseShellExecute = true });
            }
            catch { }
        }

        private static void StartLlamaServer()
        {
            if (llamaProc != null && !llamaProc.HasExited) return;
            try
            {
                string args = "--model \"" + LlamaModel + "\""
                    + " --port " + LlamaPort
                    + " --host " + LlamaHost
                    + " --ctx-size 4096 --threads 8 --parallel 1"
                    + " --n-gpu-layers 99 --no-mmap";
                var psi = new ProcessStartInfo
                {
                    FileName = LlamaServerExe,
                    Arguments = args,
                    WorkingDirectory = @"C:\Windows\System32",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                llamaProc = Process.Start(psi);
                UpdateLlamaMenuState();
                Log("Llama server started (PID " + llamaProc.Id + ")");
            }
            catch (Exception ex)
            {
                Log("Failed to start llama-server: " + ex.Message);
            }
        }

        private static void StopLlamaServer()
        {
            if (llamaProc == null || llamaProc.HasExited)
            {
                llamaProc = null;
                UpdateLlamaMenuState();
                return;
            }
            try
            {
                KillProcessTree(llamaProc);
                llamaProc.Dispose();
            }
            catch { }
            llamaProc = null;
            UpdateLlamaMenuState();
            Log("Llama server stopped");
        }

        private static void UpdateLlamaMenuState()
        {
            if (llamaStartItem == null || llamaStopItem == null) return;
            bool running = llamaProc != null && !llamaProc.HasExited;
            llamaStartItem.Enabled = !running;
            llamaStopItem.Enabled = running;
        }

        private static void ClearLogFile()
        {
            try
            {
                if (File.Exists(LogPath))
                    File.WriteAllText(LogPath, string.Empty);
                Log("Log file cleared");
            }
            catch (Exception ex)
            {
                Log("Failed to clear log: " + ex.Message);
            }
        }

        // ---------------- Server process management ----------------
        private static void StartServer()
        {
            lock (ProcLock)
            {
                if (serverProc != null && !serverProc.HasExited)
                    return;
                try
                {
                    string js = Path.Combine(AppDir, ServerJs);
                    if (!File.Exists(js))
                    {
                        Log("Server JS not found: " + js);
                        UpdateServerStatus();
                        return;
                    }
                    var psi = new ProcessStartInfo
                    {
                        FileName = "node",
                        Arguments = "\"" + js + "\"",
                        WorkingDirectory = AppDir,
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    };
                    serverProc = new Process { StartInfo = psi };
                    serverProc.OutputDataReceived += ServerOutputHandler;
                    serverProc.ErrorDataReceived += ServerOutputHandler;
                    serverProc.Start();
                    serverProc.BeginOutputReadLine();
                    serverProc.BeginErrorReadLine();
                    Log("YukiWeb server started (PID " + serverProc.Id + ")");
                }
                catch (Exception ex)
                {
                    Log("Failed to start server: " + ex.Message);
                    try { serverProc.Dispose(); } catch { }
                    serverProc = null;
                }
                UpdateServerStatus();
            }
        }

        private static void ServerOutputHandler(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null)
                AppendLog(e.Data);
        }

        private static void StopServer()
        {
            lock (ProcLock)
            {
                if (serverProc == null)
                {
                    UpdateServerStatus();
                    return;
                }
                try
                {
                    if (!serverProc.HasExited)
                    {
                        KillProcessTree(serverProc);
                        if (!serverProc.WaitForExit(3000))
                            serverProc.Kill();
                    }
                    Log("YukiWeb server stopped");
                }
                catch { }
                try { serverProc.Dispose(); } catch { }
                serverProc = null;
                UpdateServerStatus();
            }
        }

        private static void RestartServer()
        {
            Log("Restarting server");
            StopServer();
            StartServer();
        }

        private static void KillProcessTree(Process proc)
        {
            // taskkill /T kills the process and all its children.
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = "/PID " + proc.Id + " /T /F",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process.Start(psi);
            }
            catch { }
        }

        private static void UpdateServerStatus()
        {
            if (serverStatusItem == null) return;
            bool running = false;
            int pid = -1;
            lock (ProcLock)
            {
                running = serverProc != null && !serverProc.HasExited;
                if (running) pid = serverProc.Id;
            }
            string text = running
                ? "Server: Running (port " + Port + ", PID " + pid + ")"
                : "Server: Stopped";
            // Always called on the UI thread; update directly.
            serverStatusItem.Text = text;
            trayIcon.Text = running
                ? "YukiWeb (port " + Port + ")"
                : "YukiWeb (server stopped)";
        }

        // ---------------- Logging ----------------
        private static void EnsureLogDir()
        {
            try
            {
                string dir = Path.Combine(AppDir, LogDir);
                if (!Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
            }
            catch { }
        }

        private static void Log(string message)
        {
            AppendLog(message);
        }

        private static void AppendLog(string line)
        {
            lock (LogLock)
            {
                try
                {
                    EnsureLogDir();
                    string ts = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
                    File.AppendAllText(LogPath, "[" + ts + "] [tray] " + line + Environment.NewLine);
                }
                catch { }
            }
        }

        private static string TailLog(int maxLines)
        {
            try
            {
                if (!File.Exists(LogPath))
                    return "(no log file)";
                string[] all = File.ReadAllLines(LogPath);
                int start = Math.Max(0, all.Length - maxLines);
                return string.Join(Environment.NewLine, all, start, all.Length - start);
            }
            catch (Exception ex)
            {
                return "(no log file: " + ex.Message + ")";
            }
        }

        // ---------------- Logs window ----------------
        private static void ShowLogsWindow()
        {
            if (logsForm != null && logsForm.IsHandleCreated)
            {
                logsForm.BringToFront();
                logsForm.Activate();
                return;
            }

            logsForm = new Form
            {
                Text = "YukiWeb Logs (last 200 lines)",
                Width = 760,
                Height = 540,
                StartPosition = FormStartPosition.CenterScreen,
                MinimumSize = new Size(400, 300)
            };

            var txt = new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Both,
                ReadOnly = true,
                Dock = DockStyle.Fill,
                Font = new Font("Consolas", 9F),
                BackColor = Color.FromArgb(18, 18, 18),
                ForeColor = Color.FromArgb(220, 220, 220)
            };
            logsForm.Controls.Add(txt);

            var timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += delegate
            {
                txt.Text = TailLog(200);
                ScrollToEnd(txt);
            };
            timer.Start();
            txt.Text = TailLog(200);

            logsForm.FormClosed += delegate
            {
                timer.Stop();
                logsForm = null;
            };
            logsForm.Show();
            ScrollToEnd(txt);
        }

        private static void ScrollToEnd(TextBox txt)
        {
            try
            {
                txt.SelectionStart = txt.TextLength;
                txt.ScrollToCaret();
            }
            catch { }
        }

        // ---------------- Settings window ----------------
        private static void ShowSettingsWindow()
        {
            if (Application.OpenForms["YukiWebSettings"] != null)
            {
                Application.OpenForms["YukiWebSettings"].Activate();
                return;
            }

            var form = new Form
            {
                Text = "YukiWeb Tray Settings",
                Name = "YukiWebSettings",
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
                StartPosition = FormStartPosition.CenterScreen,
                ClientSize = new Size(320, 230)
            };

            // Theme (informational; the web app owns the actual theme).
            var themeLabel = new Label
            {
                Text = "Theme (set in the web app):",
                Location = new Point(16, 20),
                AutoSize = true
            };
            form.Controls.Add(themeLabel);

            // Start with Windows.
            var startupCheck = new CheckBox
            {
                Text = "Start YukiWeb Tray with Windows",
                Location = new Point(16, 56),
                AutoSize = true,
                Checked = IsStartupEnabled()
            };
            form.Controls.Add(startupCheck);

            // Clear log.
            var clearLogBtn = new Button
            {
                Text = "Clear Log File",
                Location = new Point(16, 100),
                Size = new Size(130, 28)
            };
            clearLogBtn.Click += delegate
            {
                try
                {
                    if (File.Exists(LogPath))
                        File.WriteAllText(LogPath, string.Empty);
                    Log("Log file cleared");
                    MessageBox.Show("Log cleared.", "YukiWeb Tray",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Could not clear log: " + ex.Message,
                        "YukiWeb Tray", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };
            form.Controls.Add(clearLogBtn);

            // Open app dir.
            var openDirBtn = new Button
            {
                Text = "Open App Folder",
                Location = new Point(160, 100),
                Size = new Size(130, 28)
            };
            openDirBtn.Click += delegate { OpenInExplorer(AppDir); };
            form.Controls.Add(openDirBtn);

            // Save + Close.
            var saveBtn = new Button
            {
                Text = "Save",
                Location = new Point(120, 180),
                Size = new Size(80, 28)
            };
            saveBtn.Click += delegate
            {
                SetStartupEnabled(startupCheck.Checked);
                form.Close();
            };
            form.Controls.Add(saveBtn);

            var closeBtn = new Button
            {
                Text = "Close",
                Location = new Point(210, 180),
                Size = new Size(80, 28)
            };
            closeBtn.Click += delegate { form.Close(); };
            form.Controls.Add(closeBtn);

            form.ShowDialog();
        }

        // ---------------- Startup registry ----------------
        private static string ExePath()
        {
            try
            {
                return Process.GetCurrentProcess().MainModule.FileName;
            }
            catch
            {
                return Assembly.GetExecutingAssembly().Location;
            }
        }

        private static bool IsStartupEnabled()
        {
            // reg query returns exit code 0 if the value exists, non-zero otherwise.
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "reg",
                    Arguments = "query \"" + StartupRegPath + "\" /v \"" + StartupRegName + "\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                using (var proc = Process.Start(psi))
                {
                    proc.WaitForExit();
                    return proc.ExitCode == 0;
                }
            }
            catch { return false; }
        }

        private static void SetStartupEnabled(bool enabled)
        {
            try
            {
                if (enabled)
                {
                    string args = "add \"" + StartupRegPath + "\" /v \"" + StartupRegName
                        + "\" /t REG_SZ /d \"" + ExePath() + "\" /f";
                    RunCmd("reg", args);
                    Log("Startup enabled: " + ExePath());
                }
                else
                {
                    string args = "delete \"" + StartupRegPath + "\" /v \"" + StartupRegName + "\" /f";
                    RunCmd("reg", args);
                    Log("Startup disabled");
                }
            }
            catch (Exception ex)
            {
                Log("Failed to set startup: " + ex.Message);
            }
        }

        private static void RunCmd(string file, string args)
        {
            var psi = new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using (var proc = Process.Start(psi))
            {
                proc.WaitForExit();
            }
        }

        // ---------------- Misc ----------------
        private static void OpenInExplorer(string path)
        {
            try
            {
                if (Directory.Exists(path))
                    Process.Start("explorer.exe", "\"" + path + "\"");
                else if (File.Exists(path))
                    Process.Start("explorer.exe", "/select,\"" + path + "\"");
            }
            catch { }
        }

        private static void ExitApp()
        {
            if (shuttingDown) return;
            shuttingDown = true;
            Log("Exit requested from tray");
            StopServer();
            if (llamaProc != null && !llamaProc.HasExited)
            {
                try { KillProcessTree(llamaProc); } catch { }
            }
            if (trayIcon != null)
                trayIcon.Visible = false;
            Application.Exit();
        }
    }
}
