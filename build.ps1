#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build Macast into a standalone Windows executable (dist/Macast.exe).

.DESCRIPTION
    Checks prerequisites, sets up the Python virtual environment, installs
    dependencies, compiles translations, and bundles everything with PyInstaller.
    The resulting exe includes mpv and is ready for distribution.

.PARAMETER Clean
    Remove build/dist/Macast.spec before building (default: true).

.PARAMETER SkipMpv
    Build without bundling mpv (smaller exe, but mpv must be installed separately).

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Clean:$false
    .\build.ps1 -SkipMpv
#>

param(
    [bool]$Clean = $true,
    [switch]$SkipMpv
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$VenvDir = Join-Path $ProjectRoot ".venv"
$BinDir = Join-Path $ProjectRoot "bin"
$MpvExe = Join-Path $BinDir "mpv.exe"

# ── helpers ──────────────────────────────────────────────────────────

function Write-Step($msg) {
    Write-Host "`n>>> " -NoNewline -ForegroundColor Cyan
    Write-Host $msg -ForegroundColor White
}

function Write-Err($msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
}

function Ensure-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Err "'$name' is not available. Install it and try again."
        exit 1
    }
}

# ── check mpv ────────────────────────────────────────────────────────

if (-not $SkipMpv) {
    if (-not (Test-Path $MpvExe)) {
        Write-Err "mpv.exe not found at: $MpvExe"
        Write-Host @"

mpv is required for media playback. Download it from:
  https://github.com/shinchiro/mpv-winbuild-cmake/releases

Choose a build (e.g. mpv-x86_64-YYYYMMDD-git-XXXX.7z), extract it,
and place mpv.exe at:

  $MpvExe

Then re-run this script. Alternatively, build without mpv:

  .\build.ps1 -SkipMpv

"@
        exit 1
    }
    Write-Host "[ok] mpv.exe found" -ForegroundColor Green
}

# ── check python ─────────────────────────────────────────────────────

Ensure-Command python

$pyVer = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
Write-Host "[ok] Python $pyVer detected" -ForegroundColor Green

# ── venv ─────────────────────────────────────────────────────────────

if (-not (Test-Path (Join-Path $VenvDir "Scripts" "python.exe"))) {
    Write-Step "Creating virtual environment..."
    & python -m venv $VenvDir
}

$Python = Join-Path $VenvDir "Scripts" "python.exe"
$Pip = Join-Path $VenvDir "Scripts" "pip.exe"

Write-Step "Upgrading pip..."
& $Python -m pip install --upgrade pip --quiet

# ── dependencies ─────────────────────────────────────────────────────

Write-Step "Installing runtime dependencies..."
& $Pip install requests appdirs cherrypy lxml netifaces pillow pyperclip pystray pywin32 --quiet

Write-Step "Installing build tools..."
& $Pip install pyinstaller polib --quiet

Write-Step "Installing Macast in editable mode..."
& $Pip install -e $ProjectRoot --quiet

# ── translations ─────────────────────────────────────────────────────

Write-Step "Compiling translations (.po -> .mo)..."
$ProjectRootFwd = $ProjectRoot -replace '\\', '/'
& $Python -c @"
import polib, pathlib
root = pathlib.Path(r'$ProjectRootFwd')
for lang in ['zh_CN', 'fi', 'it']:
    po = polib.pofile(str(root / 'i18n' / lang / 'LC_MESSAGES' / 'macast.po'))
    po.save_as_mofile(str(root / 'i18n' / lang / 'LC_MESSAGES' / 'macast.mo'))
    print(f'  compiled: {lang}')
"@

# ── clean ────────────────────────────────────────────────────────────

if ($Clean) {
    Write-Step "Cleaning previous build..."
    @("build", "dist", "Macast.spec") | ForEach-Object {
        $p = Join-Path $ProjectRoot $_
        if (Test-Path $p) {
            try { Remove-Item -Recurse -Force $p -ErrorAction Stop }
            catch {
                Write-Host "  Warning: Could not remove $p (file in use). Skip." -ForegroundColor Yellow
            }
        }
    }
}

# ── build ────────────────────────────────────────────────────────────

Write-Step "Running PyInstaller..."

$pyiArgs = @(
    "--noconfirm", "-F", "-w",
    "--additional-hooks-dir=.",
    "--add-data=macast/.version;.",
    "--add-data=macast/xml;macast/xml",
    "--add-data=i18n;i18n",
    "--add-data=macast/assets;macast/assets",
    "--icon=macast/assets/icon.ico"
)

if (-not $SkipMpv) {
    $pyiArgs += "--add-binary=bin/mpv.exe;bin"
}

$pyiArgs += "Macast.py"

& $Python -m PyInstaller $pyiArgs

if ($LASTEXITCODE -ne 0) {
    Write-Err "PyInstaller failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# ── result ───────────────────────────────────────────────────────────

$ExePath = Join-Path $ProjectRoot "dist" "Macast.exe"
if (Test-Path $ExePath) {
    $size = "{0:N0} MB" -f ((Get-Item $ExePath).Length / 1MB)
    Write-Host "`n>>> Build complete:" -ForegroundColor Green
    Write-Host "    $ExePath" -ForegroundColor White
    Write-Host "    Size: $size" -ForegroundColor White
} else {
    Write-Err "Output exe not found at $ExePath"
    exit 1
}
