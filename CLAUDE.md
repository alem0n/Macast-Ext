# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Macast is a cross-platform DLNA Media Renderer (v0.7, GPL3). It uses mpv to play media pushed from DLNA-compatible clients (phones, tablets) to your computer. Runs on macOS, Windows, and Linux as a system tray/menu bar application.

- **Repo**: https://github.com/xfangfang/Macast
- **Python**: >= 3.6
- **Entry**: `Macast.py` → `gui()` (tray) or `cli()` (headless)

## Virtual Environment (REQUIRED)

Always use the project's `.venv` virtual environment. Do NOT install dependencies globally.

```bash
# Create the venv (one-time)
python -m venv .venv

# Activate (every session)
# Windows (Git Bash / MSYS2):
source .venv/Scripts/activate
# Windows (CMD):
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
```

## Install Dependencies

```bash
# Upgrade pip first
.venv/Scripts/pip install --upgrade pip

# Install runtime dependencies (Windows)
pip install requests appdirs cherrypy lxml netifaces pillow pyperclip pystray pywin32

# Install Macast itself in editable mode
pip install -e .

# Or use requirements files:
pip install -r requirements/common.txt
```

### Platform-specific dependencies

| Platform | Extra Packages |
|---|---|
| macOS (`darwin`) | `rumps`, `pyperclip` |
| Windows (`win32`) | `pillow`, `pyperclip`, `pystray`, `pywin32` |
| Linux | `pillow`, `pystray` (xfangfang fork), `pyperclip` (xfangfang fork) |

## Run (Debug Mode)

```bash
# GUI mode (system tray) — always use .venv Python
.venv/Scripts/python Macast.py

# Linux: may need to set pystray backend
export PYSTRAY_BACKEND=gtk && .venv/bin/python Macast.py
```

### Runtime dependencies

**mpv** is required for media playback. The app will start without it but cannot play media.

- **Download**: https://github.com/shinchiro/mpv-winbuild-cmake/releases (Windows)
- **Place** `mpv.exe` at `bin/mpv.exe` (Windows) or `bin/MacOS/mpv` (macOS)
- On Linux, install via `sudo apt install mpv`

## Package / Compile

### Windows — `build.ps1` (recommended)

A PowerShell 7 build script automates the full process:

```powershell
.\build.ps1                  # Clean build with mpv bundled
.\build.ps1 -SkipMpv         # Build without mpv (~24MB exe)
.\build.ps1 -Clean:$false    # Skip cleaning previous build
```

The script handles: venv activation, dependency install, .po→.mo compilation, clean, and PyInstaller packaging.

### Windows (PyInstaller) — manual

```bash
pip install pyinstaller

# Clean previous builds first
rm -rf build dist Macast.spec

# Compile .po to .mo before building (i18n)
pip install polib
.venv/Scripts/python -c "
import polib
for lang in ['zh_CN', 'fi', 'it']:
    po = polib.pofile(f'i18n/{lang}/LC_MESSAGES/macast.po')
    po.save_as_mofile(f'i18n/{lang}/LC_MESSAGES/macast.mo')
"

# Build (with mpv bundled)
# IMPORTANT: Use directory mode (macast/xml not macast/xml/*) or files will be missing.
pyinstaller --noconfirm -F -w \
  --additional-hooks-dir=. \
  --add-data="macast/.version;." \
  --add-data="macast/xml;macast/xml" \
  --add-data="i18n;i18n" \
  --add-data="macast/assets;macast/assets" \
  --add-binary="bin/mpv.exe;bin" \
  --icon=macast/assets/icon.ico \
  Macast.py

# Output: dist/Macast.exe (~68MB with mpv, ~24MB without)
```

Key PyInstaller flags:
- `-F`: single file
- `-w`: no console window (GUI app)
- `--additional-hooks-dir=.`: picks up `hook-pystray.py` for hidden imports
- `--add-data`: `source;dest` separator is `;` on Windows, `:` on Linux/macOS
- **`--add-data` directory mode** (e.g. `macast/xml;macast/xml`) recursively includes every file. Glob mode (`macast/xml/*`) is unreliable — it may skip `.html`/`.csv` files and won't recurse into subdirectories.

### macOS (py2app)

```bash
pip install py2app
python setup.py py2app
cp -R bin dist/Macast.app/Contents/Resources/
```

### Linux (PyInstaller)

```bash
pip install pyinstaller
pyinstaller --noconfirm -F -w \
  --additional-hooks-dir=. \
  --add-data=".version:." \
  --add-data="macast/xml:macast/xml" \
  --add-data="i18n:i18n" \
  --add-data="assets:assets" \
  Macast.py
```

Note: On Linux, use `:` instead of `;` as the path separator in `--add-data`.

## Architecture

```
Macast.py (entry, locale setup, mpv path)
  └── gui() / cli()  [macast/macast.py]
        └── Macast(App) — system tray app, plugin manager, settings menu
              └── Service [macast/server.py] — CherryPy HTTP server
                    ├── AutoPortServer — port-fallback HTTP server
                    ├── SSDPPlugin [macast/plugin.py] → SSDPServer [macast/ssdp.py]
                    ├── RendererPlugin → MPVRenderer [macast_renderer/mpv.py]
                    ├── ProtocolPlugin → DLNAProtocol [macast/protocol.py]
                    └── DLNAHandler — SOAP/event endpoints at /
```

### CherryPy Bus Events (Pub/Sub)

The app uses CherryPy's event bus extensively. Key events:

| Event | Publisher | Subscribers |
|---|---|---|
| `ssdp_notify` | Service (every 3s) | SSDPPlugin |
| `ssdp_update_ip` | Service (every 30s / on IP change) | SSDPPlugin, Macast |
| `renderer_start` | MPVRenderer (IPC connected) | — |
| `renderer_av_stop` | MPVRenderer (end-file event) | Macast |
| `renderer_av_uri` | MPVRenderer (start-file event) | Macast |
| `app_notify` | Various (status/error messages) | Macast.notification |
| `reload_renderer` | MPVRendererSetting | RendererPlugin |
| `get_plugin_info` | Macast | MacastPluginManager |

### Startup Sequence

1. `Macast.py`: clear logs → load locale → set mpv path → call `gui()`
2. `gui()`: create `MPVRenderer` + `DLNAProtocol` → instantiate `Macast(App)`
3. `Macast.__init__()`:
   - Create `MacastPluginManager` (scans custom plugins)
   - Load settings from `~/.config/Macast/macast_setting.json`
   - Create `Service(renderer, protocol)` → `run_async()`
   - Build system tray menu → `App.start()`
4. `Service.run()`:
   - Start AutoPortServer (CherryPy HTTP)
   - Start SSDPPlugin (UDP multicast on 239.255.255.250:1900)
   - Start RendererPlugin (launches mpv process + IPC thread)
   - Start ProtocolPlugin (DLNA state machine)
   - SSDP Monitor every 3s: send NOTIFY, check IP changes every 30s
   - `cherrypy.engine.block()` — main thread waits

## HTTP API Endpoints

Served by `DLNAHandler` (mount at `/`):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/description.xml` | UPnP device description (dynamic UUID, friendly name) |
| `GET` | `/` | Settings page (`setting.html` — Vue.js SPA) |
| `GET` | `/api?query=log` | Return macast.log contents |
| `GET` | `/api?query=launch-param` | Return current settings JSON |
| `GET` | `/api?query=plugin-info` | Return installed plugins list |
| `POST` | `/api` | `body: {launch_param: {...}}` — save settings |
| `POST` | `/api` | `body: {url: "github/author/repo"}` — install plugin |
| `POST` | `/{service}/action` | DLNA SOAP actions (see below) |
| `SUBSCRIBE` | `/{service}/event` | UPnP event subscription |
| `UNSUBSCRIBE` | `/{service}/event` | UPnP event unsubscription |
| `GET` | `/dlna/*` | Static XML files from `macast/xml/` |
| `GET` | `/assets/*` | Static assets from `macast/assets/` |

## DLNA SOAP Endpoints

DLNA clients send SOAP requests to:

| Service Path | SOAP Actions |
|---|---|
| `/AVTransport/action` | `GetCurrentTransportActions`, `GetDeviceCapabilities`, `GetMediaInfo`, `GetPositionInfo`, `GetTransportInfo`, `GetTransportSettings`, `Next`, `Pause`, `Play`, `Previous`, `Seek`, `SetAVTransportURI`, `SetPlayMode`, `Stop` |
| `/RenderingControl/action` | `GetMute`, `GetVolume`, `GetVolumeDB`, `GetVolumeDBRange`, `ListPresets`, `SelectPreset`, `SetMute`, `SetVolume` |
| `/ConnectionManager/action` | `GetCurrentConnectionInfo`, `GetProtocolInfo`, `GetCurrentConnectionIDs` |

Handler method naming: `{Service}_{Action}`, e.g. `AVTransport_SetAVTransportURI`, `RenderingControl_SetVolume`. If no explicit handler method exists, the protocol auto-generates a response from state variables.

## mpv IPC Protocol

MPVRenderer communicates with mpv via JSON IPC:

- **Windows**: Named pipe `\\.\pipe\macast_mpvsocket{rand}`
- **macOS/Linux**: Unix domain socket `/tmp/macast_mpvsocket{rand}`

### Commands sent to mpv

JSON IPC command format: `{"command": [<name>, <arg0>, <arg1>, ...]}\n`

```
loadfile <url> replace 0 start=<seconds>   # Start playback (index=0 required before options)
set_property volume <0-100>
set_property pause true|false
set_property mute yes|no
set_property title <string>
set_property speed <0.01-100>
set_property sub-visibility yes|no
seek <position> absolute
stop
observe_property <id> <name>               # Register state observation
show-text <message> <duration_ms>
sub-add <url> select <title>
```

### Events received from mpv (JSON)

| Event | Maps to |
|---|---|
| `start-file` | → `renderer_av_uri` bus event, copy-URI menu item |
| `end-file` (reason=eof) | → `set_state_eof()` |
| `end-file` (reason=error) | → `set_state_transport_error()` |
| `end-file` (other) | → `set_state_stop()` |
| `idle` | → `set_state_stop()` |
| `playback-restart` | → `set_state_play()` or `set_state_pause()` |

### mpv startup parameters

```
mpv --input-ipc-server=<pipe/socket> --image-display-duration=inf
    --idle=yes --no-terminal --on-all-workspaces --hwdec=yes
    --save-position-on-quit=yes
    --script-opts=osc-timetotal=yes,osc-layout=bottombar,...
    [--ontop] [--geometry=X%:Y%] [--autofit=N%] [--fullscreen]
```

## SSDP Discovery Protocol

UDP multicast on `239.255.255.250:1900`.

- Device types announced: `rootdevice`, `MediaRenderer:1`, `RenderingControl:1`, `ConnectionManager:1`, `AVTransport:1`
- NOTIFY interval: every 3 seconds (via CherryPy Monitor)
- IP change detection: every 30 seconds; re-registers all devices on change
- M-SEARCH response: unicast UDP back to requester with device location URL
- Multicast membership managed per-interface via `netifaces`

## Settings System

Settings stored at `~/.config/Macast/macast_setting.json` (platform-specific via `appdirs`):

| Key | Type | Default | Description |
|---|---|---|---|
| `USN` | string | UUID | Unique device identifier |
| `CheckUpdate` | int | 1 | Auto check for updates |
| `StartAtLogin` | int | 0 | Launch at system startup |
| `MenubarIcon` | int | 0 (1 on macOS) | Icon style (0=AppIcon, 1/2=Pattern) |
| `ApplicationPort` | int | 0 (auto) | HTTP server port |
| `DLNA_FriendlyName` | string | "Macast(HOSTNAME)" | Name shown to DLNA clients |
| `Macast_Renderer` | string | "MPV Renderer" | Active renderer plugin |
| `Macast_Protocol` | string | "DLNA Protocol" | Active protocol plugin |
| `Blocked_Interfaces` | list | [] | Network interfaces to ignore |
| `Additional_Interfaces` | list | [] | Extra interface IPs to bind |

MPV-specific settings (stored separately with integer keys 100-500):
`PlayerHW` (100), `PlayerSize` (200), `PlayerPosition` (300), `PlayerOntop` (400), `PlayerDefaultVolume` (500).

## Plugin System

Custom plugins are Python files placed in:
- `{SETTING_DIR}/renderer/` — custom media renderers
- `{SETTING_DIR}/protocol/` — custom DLNA protocols

Plugin metadata via XML-style comments in the `.py` file:
```python
# <macast.title>My Plugin</macast.title>
# <macast.renderer>MyRenderer</macast.renderer>
# <macast.platform>darwin,win32,linux</macast.platform>
```

Plugins are auto-discovered on startup. Users can also install them from the settings web UI by providing a GitHub repo URL.

## Internationalization (i18n)

Gettext-based. PO files at `i18n/{locale}/LC_MESSAGES/macast.po`. Must be compiled to `.mo` before packaging:

```bash
pip install polib
python -c "
import polib
po = polib.pofile('i18n/zh_CN/LC_MESSAGES/macast.po')
po.save_as_mofile('i18n/zh_CN/LC_MESSAGES/macast.mo')
"
```

Locales: `zh_CN`, `fi`, `it`.

## Key Files

| File | Lines | Purpose |
|---|---|---|
| `Macast.py` | 61 | Entry point: locale, mpv path, launch gui |
| `macast/macast.py` | 519 | Main app class, plugin manager, tray menu, gui/cli entry |
| `macast/gui.py` | 365 | Cross-platform GUI abstraction (rumps/pystray) |
| `macast/protocol.py` | 1067 | DLNA/UPnP protocol, SOAP handling, state machine |
| `macast/server.py` | 192 | CherryPy HTTP server, Service orchestrator |
| `macast/plugin.py` | 177 | CherryPy plugins (Renderer, Protocol, SSDP) |
| `macast/ssdp.py` | 324 | SSDP/UDP multicast discovery |
| `macast/utils.py` | 431 | Settings persistence, IP detection, helpers |
| `macast/renderer.py` | 213 | Abstract renderer base class |
| `macast_renderer/mpv.py` | 646 | mpv renderer: process management, JSON IPC |
| `hook-pystray.py` | 14 | PyInstaller hook for pystray hidden imports |
| `macast/xml/*.xml` | — | DLNA service description XMLs |
| `macast/xml/setting.html` | 662 | Vue.js embedded settings page |

## Debugging PyInstaller Builds

The GUI exe (`-w` flag) has no console, so Python's standard `logging` output goes nowhere. CherryPy's `log.access_file` / `log.error_file` only capture CherryPy's own log messages — not custom logger output from `MPVRenderer`, `PLUGIN`, etc.

`Macast.py` configures a Python `FileHandler` early in startup to capture all `logging` messages into `macast_debug.log` alongside the CherryPy access log:

```
{appdirs.user_data_dir}/macast.log          # CherryPy access/error log
{appdirs.user_data_dir}/macast_debug.log    # Python logging (MPVRenderer, Protocol, etc.)
```

Check `macast_debug.log` first when diagnosing startup, mpv, or IPC issues.

### Common build issues

| Symptom | Root Cause | Fix |
|---|---|---|
| `FileNotFoundError: .../macast/xml/setting.html` | PyInstaller glob `macast/xml/*` skips `.html` files | Use directory mode: `--add-data="macast/xml;macast/xml"` |
| `FileNotFoundError: .../macast_debug.log` | `SETTING_DIR` doesn't exist at startup | `os.makedirs(SETTING_DIR, exist_ok=True)` before creating `FileHandler` |
| mpv silent / no response after `loadfile` | Missing `index` arg in IPC command — `start=0` parsed as integer index, mpv rejects | Format: `['loadfile', url, 'replace', 0, 'start=0']` (4th arg is `index`, 5th is `options`) |
| `PermissionError` on `dist/Macast.exe` during rebuild | Previous Macast.exe still running | Kill with `taskkill /f /im Macast.exe` before rebuild |
| Assets / fonts 404 in web UI | Glob `macast/assets/*` doesn't recurse into `fonts/` | Use directory mode: `--add-data="macast/assets;macast/assets"` |
| Missing translations for `fi`/`it` | Only `zh_CN` was included in `--add-data` | Use directory mode: `--add-data="i18n;i18n"` |

## Git-tracked Open Source Forks

The project uses xfangfang's forks of `pystray` and `pyperclip` (for Linux compatibility). These are cloned into `vendor/`:

```bash
mkdir -p vendor
cd vendor
git clone https://github.com/xfangfang/pystray.git
git clone https://github.com/xfangfang/pyperclip.git
```

## Notes

- **Always compile `.po` to `.mo`** before running or packaging, otherwise i18n won't work
- **Always use `.venv`** — makes dependency management reproducible
- **`pywin32` is required on Windows** but was historically missing from `requirements/common.txt` and `setup.py` (now fixed)
- **mpv IPC on Windows uses named pipes** (`_winapi.CreateFile`). The pipe path `\\.\pipe\macast_mpvsocket{rand}` is a Windows namespace path — do NOT wrap it with `Setting.get_base_path()` or `os.path.join` will corrupt it.
- **mpv IPC `loadfile` requires the `index` parameter** before `options`: `['loadfile', url, 'replace', 0, 'start=0']`. Omitting `index` (passing options as the 3rd arg) causes mpv to silently reject the command.
- **`AutoPortServer`** falls back to a random port if the preferred port is occupied; generates a new USN and temporary friendly name when port changes
- **The app blocks on `cherrypy.engine.block()`** in `Service.run()`; `run_async()` wraps it in a thread
- **`communicate()` blocks** in `start_mpv()` — mpv runs until it exits, then restarts if IPC was never connected
- Settings JSON is flat (not nested), using integer keys for MPV-specific settings to avoid collision
- On macOS, the app uses `LSUIElement: true` (menu bar only, no Dock icon)
