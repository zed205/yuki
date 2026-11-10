' Launch the YukiWeb tray icon without leaving any console window visible.
' wscript.exe runs this windowless; shell.Run with windowstyle 0 (hidden) and
' False (don't wait) keeps the tray PowerShell process in the background.
Option Explicit
Dim fso, scriptDir, shell, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptDir & "\tray.ps1"""
shell.Run cmd, 0, False
