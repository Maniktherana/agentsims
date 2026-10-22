# Install Agentsims on Windows.
# Usage: irm https://agentsims.dev/install.ps1 | iex
# To keep PATH unchanged, set AGENTSIMS_NO_MODIFY_PATH=1 or pass -NoModifyPath.
# To skip the coding agent skill, set AGENTSIMS_NO_SKILL=1 or pass -NoSkill.
param([switch]$NoModifyPath, [switch]$NoSkill)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Fail([string]$Message) {
  throw "Agentsims install failed: $Message"
}

$Version = "__AGENTSIMS_RELEASE_VERSION__"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "The release version is invalid." }
# The x64 runtime also runs on Windows on Arm through x64 emulation.
if (-not [Environment]::Is64BitOperatingSystem) { Fail "Agentsims requires 64-bit Windows." }

$Root = if ($env:AGENTSIMS_INSTALL_DIR) { $env:AGENTSIMS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Agentsims" }
$Archive = "agentsims-windows-x64.tar.gz"
$Base = "https://github.com/Maniktherana/agentsims/releases/download/v$Version"
$Versions = Join-Path $Root "versions"
$Release = Join-Path $Versions $Version
$Bin = Join-Path $Root "bin"

function Test-Release([string]$Directory) {
  $Executable = Join-Path $Directory "dist\agentsims.exe"
  if (-not (Test-Path $Executable)) { return $false }
  $Reported = (& $Executable --version 2>$null | Out-String).Trim()
  return $Reported -eq $Version
}

if (-not (Test-Release $Release)) {
  if (Test-Path $Release) { Fail "The existing version is incomplete. It was not changed: $Release" }
  New-Item -ItemType Directory -Force $Versions | Out-Null
  # Stage beside the final directory so the last move stays on one volume.
  $Stage = Join-Path $Versions (".install-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory $Stage | Out-Null
  try {
    $ArchivePath = Join-Path $Stage $Archive
    $SumsPath = Join-Path $Stage "SHA256SUMS"
    Invoke-WebRequest "$Base/$Archive" -OutFile $ArchivePath -UseBasicParsing
    Invoke-WebRequest "$Base/SHA256SUMS" -OutFile $SumsPath -UseBasicParsing
    $Line = Get-Content $SumsPath | Where-Object { ($_ -split '\s+')[1] -eq $Archive } | Select-Object -First 1
    if (-not $Line) { Fail "The archive checksum is missing." }
    $Expected = ($Line -split '\s+')[0]
    $Actual = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) { Fail "The archive checksum does not match." }
    $Content = Join-Path $Stage "content"
    New-Item -ItemType Directory $Content | Out-Null
    & (Join-Path $env:SystemRoot "System32\tar.exe") -xzf $ArchivePath -C $Content
    if ($LASTEXITCODE -ne 0) { Fail "Archive extraction failed." }
    if (-not (Test-Release $Content)) { Fail "The runtime files are incomplete or have the wrong version." }
    Move-Item $Content $Release
  } finally {
    Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
  }
}

# The executable loads its browser and platform assets from its own directory,
# so the command is a launcher instead of a copy of the executable.
New-Item -ItemType Directory -Force $Bin | Out-Null
$Launcher = "@echo off`r`n`"%~dp0..\versions\$Version\dist\agentsims.exe`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $Bin "agentsims.cmd"), $Launcher, [Text.Encoding]::ASCII)

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$UserEntries = if ($UserPath) { $UserPath -split ';' | Where-Object { $_ } } else { @() }
$ModifyPath = -not ($NoModifyPath -or $env:AGENTSIMS_NO_MODIFY_PATH -eq "1")
if ($ModifyPath -and ($UserEntries -notcontains $Bin)) {
  [Environment]::SetEnvironmentVariable("Path", (@($UserEntries) + $Bin) -join ';', "User")
}
# This script runs in the caller's session, so the command works at once.
if ($ModifyPath -and (($env:Path -split ';') -notcontains $Bin)) { $env:Path = "$Bin;$env:Path" }

Write-Host "Installed Agentsims $Version in $Root"
if ($ModifyPath) {
  Write-Host "Added $Bin to your user PATH. New terminals find agentsims."
} else {
  Write-Host "PATH was not changed. Command: $Bin\agentsims.cmd"
}
if (-not ($NoSkill -or $env:AGENTSIMS_NO_SKILL -eq "1")) {
  Write-Host ""
  Write-Host "Agentsims skill for Claude Code, Codex, Cursor, and other coding agents"
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js 20 or newer is necessary for the skill. Install Node.js, then run:"
    Write-Host "  agentsims skill"
  } else {
    & (Join-Path $Bin "agentsims.cmd") skill --global
    if ($LASTEXITCODE -ne 0) {
      Write-Host "The skill was not installed. To try again, run:"
      Write-Host "  agentsims skill"
    }
  }
  Write-Host ""
}
Write-Host "Next: agentsims doctor --platform android"
