from __future__ import annotations

import asyncio
import ctypes
import json
import os
import subprocess
import sys
import time
import shutil
from ctypes import wintypes
from urllib.parse import unquote, urlparse
from typing import Any, Dict, List, Optional, Tuple

import decky


PLAYHUB_YELLOW = "#FCCC01"

DEFAULT_SETTINGS: Dict[str, Any] = {
    "settings_version": 2,
    "auto_mode": True,
    "curtain_timeout": 15,
    "launch_curtain_max_seconds": 15,
    "min_visible_seconds": 2,
    "game_settle_seconds": 2,
    "title": "",
    "subtitle": "",
    "accent": PLAYHUB_YELLOW,
    "custom_logo_path": "",
    "launcher_processes": [
        "EpicGamesLauncher.exe",
        "EADesktop.exe",
        "EALauncher.exe",
        "UbisoftConnect.exe",
        "UbisoftGameLauncher.exe",
        "Battle.net.exe",
        "Agent.exe",
        "RockstarService.exe",
        "LauncherPatcher.exe"
    ]
}


SW_RESTORE = 9
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
WM_CLOSE = 0x0010
MONITOR_DEFAULTTONEAREST = 0x00000002
FULLSCREEN_TOLERANCE = 18
APP_ID_MAX = 0x100000000

STEAM_PROCESS_NAMES = {
    "steam.exe",
    "steamwebhelper.exe",
    "steamservice.exe"
}

IGNORED_LAUNCH_CHILDREN = {
    "steam.exe",
    "steamwebhelper.exe",
    "steamservice.exe",
    "gameoverlayui.exe",
    "steamerrorreporter.exe",
    "steamerrorreporter64.exe",
    "crashhandler.exe",
    "crashpad_handler.exe",
    "cefsharp.browsersubprocess.exe",
    "conhost.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "windowsterminal.exe",
    "explorer.exe",
    "rundll32.exe",
    "dllhost.exe",
    "msedgewebview2.exe",
    "applicationframehost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "searchapp.exe"
}


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260)
    ]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD)
    ]


def _settings_path() -> str:
    settings_dir = getattr(decky, "DECKY_SETTINGS_DIR", os.path.dirname(__file__))
    os.makedirs(settings_dir, exist_ok=True)
    return os.path.join(settings_dir, "launch-curtain.json")


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def _process_snapshot() -> Dict[int, Dict[str, Any]]:
    if not _is_windows():
        return {}

    kernel32 = ctypes.windll.kernel32
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == INVALID_HANDLE_VALUE:
        return {}

    processes: Dict[int, Dict[str, Any]] = {}
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        has_entry = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))

        while has_entry:
            pid = int(entry.th32ProcessID)
            processes[pid] = {
                "pid": pid,
                "parent_pid": int(entry.th32ParentProcessID),
                "process": entry.szExeFile
            }
            has_entry = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)

    return processes


def _process_image_path(pid: int) -> str:
    if not _is_windows() or pid <= 0:
        return ""

    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD)
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""

    try:
        buffer_size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(buffer_size.value)
        ok = kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(buffer_size))
        if not ok:
            return ""
        return buffer.value
    finally:
        kernel32.CloseHandle(handle)


def _process_name(pid: int) -> str:
    image_path = _process_image_path(pid)
    return os.path.basename(image_path) if image_path else ""


def _window_title(hwnd: int) -> str:
    user32 = ctypes.windll.user32
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int

    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _window_pid(hwnd: int) -> int:
    user32 = ctypes.windll.user32
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def _foreground_window() -> Dict[str, Any]:
    if not _is_windows():
        return {"hwnd": 0, "title": "", "pid": 0, "process": "", "platform": sys.platform}

    user32 = ctypes.windll.user32
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = wintypes.HWND

    hwnd = user32.GetForegroundWindow()
    pid = _window_pid(hwnd)
    return {
        "hwnd": int(hwnd),
        "title": _window_title(hwnd),
        "pid": pid,
        "process": _process_name(pid),
        "platform": sys.platform
    }


def _visible_windows(limit: int = 18) -> List[Dict[str, Any]]:
    if not _is_windows():
        return []

    user32 = ctypes.windll.user32
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL

    windows: List[Dict[str, Any]] = []

    def callback(hwnd: int, _lparam: int) -> bool:
        if len(windows) >= limit:
            return False
        if not user32.IsWindowVisible(hwnd):
            return True

        title = _window_title(hwnd).strip()
        if not title:
            return True

        pid = _window_pid(hwnd)
        windows.append({
            "hwnd": int(hwnd),
            "title": title,
            "pid": pid,
            "process": _process_name(pid)
        })
        return True

    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(callback)
    user32.EnumWindows(enum_proc, 0)
    return windows


def _windows_for_pid(pid: int, limit: int = 24) -> List[int]:
    if not _is_windows() or pid <= 0:
        return []

    user32 = ctypes.windll.user32
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL

    windows: List[int] = []

    def callback(hwnd: int, _lparam: int) -> bool:
        if len(windows) >= limit:
            return False
        if user32.IsWindowVisible(hwnd) and _window_pid(hwnd) == pid:
            windows.append(int(hwnd))
        return True

    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(callback)
    user32.EnumWindows(enum_proc, 0)
    return windows


def _window_rect(hwnd: int) -> Optional[wintypes.RECT]:
    if not _is_windows() or hwnd <= 0:
        return None

    user32 = ctypes.windll.user32
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL

    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return rect


def _monitor_rect_for_window(hwnd: int) -> Optional[wintypes.RECT]:
    if not _is_windows() or hwnd <= 0:
        return None

    user32 = ctypes.windll.user32
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HANDLE
    user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
    user32.GetMonitorInfoW.restype = wintypes.BOOL

    monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
    if not monitor:
        return None

    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    if not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
        return None
    return info.rcMonitor


def _window_is_fullscreen(hwnd: int) -> bool:
    rect = _window_rect(hwnd)
    monitor = _monitor_rect_for_window(hwnd)
    if rect is None or monitor is None:
        return False

    window_width = rect.right - rect.left
    window_height = rect.bottom - rect.top
    monitor_width = monitor.right - monitor.left
    monitor_height = monitor.bottom - monitor.top

    if window_width < monitor_width - FULLSCREEN_TOLERANCE:
        return False
    if window_height < monitor_height - FULLSCREEN_TOLERANCE:
        return False

    return (
        rect.left <= monitor.left + FULLSCREEN_TOLERANCE
        and rect.top <= monitor.top + FULLSCREEN_TOLERANCE
        and rect.right >= monitor.right - FULLSCREEN_TOLERANCE
        and rect.bottom >= monitor.bottom - FULLSCREEN_TOLERANCE
    )


def _pid_has_fullscreen_window(pid: int) -> bool:
    return any(_window_is_fullscreen(hwnd) for hwnd in _windows_for_pid(pid))


def _post_close_to_process_windows(pid: int) -> bool:
    if not _is_windows() or pid <= 0:
        return False

    user32 = ctypes.windll.user32
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL

    posted = False
    for hwnd in _windows_for_pid(pid, limit=12):
        if user32.PostMessageW(hwnd, WM_CLOSE, 0, 0):
            posted = True
    return posted


def _focus_window(hwnd: int) -> bool:
    if not _is_windows() or hwnd <= 0:
        return False

    user32 = ctypes.windll.user32
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL

    user32.ShowWindow(hwnd, SW_RESTORE)
    return bool(user32.SetForegroundWindow(hwnd))


def _find_steam_window() -> Optional[int]:
    for window in _visible_windows(limit=80):
        process = str(window.get("process", "")).lower()
        title = str(window.get("title", "")).lower()
        if process in {"steam.exe", "steamwebhelper.exe"} and ("steam" in title or "big picture" in title):
            return int(window["hwnd"])
    return None


def _steam_root_candidates(processes: Optional[Dict[int, Dict[str, Any]]] = None) -> List[str]:
    candidates: List[str] = []

    for process in (processes or _process_snapshot()).values():
        if str(process.get("process", "")).lower() != "steam.exe":
            continue
        image_path = _process_image_path(int(process.get("pid", 0)))
        if image_path:
            candidates.append(os.path.dirname(image_path))

    try:
        import winreg

        for root, subkey in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam")
        ):
            try:
                with winreg.OpenKey(root, subkey) as key:
                    for value_name in ("SteamPath", "InstallPath"):
                        try:
                            value, _value_type = winreg.QueryValueEx(key, value_name)
                            if value:
                                candidates.append(str(value))
                        except OSError:
                            pass
            except OSError:
                pass
    except Exception:
        pass

    candidates.extend([
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam"
    ])

    unique: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = os.path.normpath(candidate)
        key = normalized.lower()
        if key not in seen and os.path.isdir(normalized):
            unique.append(normalized)
            seen.add(key)
    return unique


def _find_steam_app_logo_exact(app_id: Optional[int], processes: Optional[Dict[int, Dict[str, Any]]] = None) -> str:
    if not app_id:
        return ""

    app_id_text = str(app_id)
    custom_grid_names = [
        f"{app_id_text}_logo.png",
        f"{app_id_text}_logo.jpg",
        f"{app_id_text}_logo.jpeg",
        f"{app_id_text}_logo.webp",
        f"{app_id_text}.png",
        f"{app_id_text}.jpg",
        f"{app_id_text}.jpeg",
        f"{app_id_text}.webp",
        f"{app_id_text}p.png",
        f"{app_id_text}p.jpg",
        f"{app_id_text}p.jpeg",
        f"{app_id_text}p.webp",
        f"{app_id_text}_hero.png",
        f"{app_id_text}_hero.jpg",
        f"{app_id_text}_hero.jpeg",
        f"{app_id_text}_hero.webp",
        f"{app_id_text}_icon.png",
        f"{app_id_text}_icon.jpg",
        f"{app_id_text}_icon.ico"
    ]
    library_cache_names = [
        f"{app_id_text}_logo.png",
        f"{app_id_text}_logo.jpg",
        f"{app_id_text}_logo.jpeg",
        f"{app_id_text}_logo.webp",
        f"{app_id_text}_library_logo.png",
        f"{app_id_text}_header.jpg",
        f"{app_id_text}_capsule_616x353.jpg",
        f"{app_id_text}_library_600x900.jpg",
        f"{app_id_text}_library_hero.jpg"
    ]
    extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".ico")

    for steam_root in _steam_root_candidates(processes):
        userdata_dir = os.path.join(steam_root, "userdata")
        grid_dirs: List[str] = []
        if os.path.isdir(userdata_dir):
            try:
                grid_dirs = [
                    os.path.join(userdata_dir, user_id, "config", "grid")
                    for user_id in os.listdir(userdata_dir)
                    if os.path.isdir(os.path.join(userdata_dir, user_id, "config", "grid"))
                ]
            except OSError:
                grid_dirs = []

        for grid_dir in grid_dirs:
            for name in custom_grid_names:
                path = os.path.join(grid_dir, name)
                if os.path.exists(path):
                    return path

            try:
                matches = [
                    os.path.join(grid_dir, name)
                    for name in os.listdir(grid_dir)
                    if _filename_belongs_to_app_id(name, app_id_text, extensions)
                ]
            except OSError:
                matches = []

            if matches:
                def custom_art_priority(path: str) -> Tuple[int, str]:
                    basename = os.path.basename(path).lower()
                    stem, _extension = os.path.splitext(basename)
                    if "_logo" in stem:
                        return (0, basename)
                    if stem == app_id_text:
                        return (1, basename)
                    if stem == f"{app_id_text}p":
                        return (2, basename)
                    if "_hero" in stem:
                        return (3, basename)
                    if "_icon" in stem:
                        return (4, basename)
                    return (5, basename)

                matches.sort(key=custom_art_priority)
                return matches[0]

        cache_dir = os.path.join(steam_root, "appcache", "librarycache")
        if not os.path.isdir(cache_dir):
            continue

        for name in library_cache_names:
            path = os.path.join(cache_dir, name)
            if os.path.exists(path):
                return path

        try:
            matches = [
                os.path.join(cache_dir, name)
                for name in os.listdir(cache_dir)
                if _filename_belongs_to_app_id(name, app_id_text, extensions)
            ]
        except OSError:
            matches = []

        if matches:
            matches.sort(key=lambda path: (
                "logo" not in os.path.basename(path).lower(),
                "header" not in os.path.basename(path).lower(),
                os.path.basename(path).lower()
            ))
            return matches[0]

    return ""


def _normalize_app_id(app_id: Any) -> Optional[int]:
    if app_id is None:
        return None

    try:
        normalized = int(app_id)
    except (TypeError, ValueError):
        return None

    if normalized < 0:
        normalized = ctypes.c_uint32(normalized).value
    elif normalized >= APP_ID_MAX:
        upper_app_id = (normalized >> 32) & 0xFFFFFFFF
        normalized = upper_app_id if upper_app_id >= 0x80000000 else 0

    if 0 < normalized < APP_ID_MAX:
        return normalized
    return None


def _app_id_candidates(app_id: Optional[int], include_shortcut_aliases: bool = False) -> List[int]:
    normalized = _normalize_app_id(app_id)
    if normalized is None:
        return []

    candidates = [normalized]
    if include_shortcut_aliases:
        if 0 < normalized < 0x80000000:
            candidates.append(normalized | 0x80000000)
        if normalized >= 0x80000000:
            candidates.append(normalized & 0x7FFFFFFF)

    unique: List[int] = []
    seen: set[int] = set()
    for candidate in candidates:
        if 0 < candidate < APP_ID_MAX and candidate not in seen:
            unique.append(candidate)
            seen.add(candidate)
    return unique


def _find_steam_app_logo(
    app_id: Optional[int],
    processes: Optional[Dict[int, Dict[str, Any]]] = None,
    include_shortcut_aliases: bool = False
) -> str:
    for candidate in _app_id_candidates(app_id, include_shortcut_aliases):
        logo = _find_steam_app_logo_exact(candidate, processes)
        if logo:
            return logo
    return ""


def _filename_belongs_to_app_id(filename: str, app_id_text: str, extensions: Tuple[str, ...]) -> bool:
    lower = filename.lower()
    if not lower.endswith(extensions):
        return False

    stem, _extension = os.path.splitext(lower)
    return (
        stem == app_id_text
        or stem == f"{app_id_text}p"
        or stem.startswith(f"{app_id_text}_")
        or stem.startswith(f"{app_id_text}-")
    )


def _local_path_from_logo_source(source: str) -> str:
    if not source:
        return ""

    source = source.strip().strip('"').strip("'")
    if source.startswith("url(") and source.endswith(")"):
        source = source[4:-1].strip().strip('"').strip("'")

    parsed = urlparse(source)
    if parsed.scheme == "file":
        path = unquote(parsed.path)
        if parsed.netloc:
            path = f"//{parsed.netloc}{path}"
        if len(path) >= 3 and path[0] == "/" and path[2] == ":":
            path = path[1:]
        path = path.replace("/", os.sep)
        return path if os.path.exists(path) else ""

    if parsed.scheme:
        return ""

    maybe_path = source.replace("/", os.sep)
    return maybe_path if os.path.exists(maybe_path) else ""


def _remote_logo_source(source: str) -> str:
    parsed = urlparse(source.strip()) if source else None
    if parsed and parsed.scheme in {"http", "https"}:
        return source.strip()
    return ""


class Plugin:
    def __init__(self) -> None:
        self.settings: Dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.overlay_process: Optional[subprocess.Popen[Any]] = None
        self.monitor_task: Optional[asyncio.Task[Any]] = None
        self.last_curtain_started_at = 0.0
        self.launch_pending_until = 0.0
        self.game_seen_since = 0.0
        self.current_launch_app_id: Optional[int] = None
        self.current_launch_logo_path = ""
        self.current_launch_logo_source = ""
        self.known_processes: Dict[int, Dict[str, Any]] = {}
        self.launch_chain_pids: Dict[int, float] = {}
        self.launch_game_candidates: Dict[int, Dict[str, float]] = {}
        self.launch_game_fullscreen_since: Dict[int, float] = {}

    async def _main(self) -> None:
        self.settings = self._load_settings()
        self._reset_process_tracking()
        if self.settings.get("auto_mode"):
            self._ensure_monitor()
        decky.logger.info("Launch Curtain loaded")

    async def _unload(self) -> None:
        await self.stop_auto_mode()
        await self.hide_curtain()
        decky.logger.info("Launch Curtain unloaded")

    async def _uninstall(self) -> None:
        await self.hide_curtain()

    def _load_settings(self) -> Dict[str, Any]:
        path = _settings_path()
        if not os.path.exists(path):
            return dict(DEFAULT_SETTINGS)

        try:
            with open(path, "r", encoding="utf-8") as file:
                data = json.load(file)
            stored_settings_version = int(data.get("settings_version", 0) or 0)
            settings = dict(DEFAULT_SETTINGS)
            settings.update(data)
            if str(settings.get("accent", "")).lower() in {"", "#ffffff", "white"}:
                settings["accent"] = PLAYHUB_YELLOW
            try:
                settings["curtain_timeout"] = int(settings.get("curtain_timeout", 15))
            except (TypeError, ValueError):
                settings["curtain_timeout"] = 15
            try:
                settings["launch_curtain_max_seconds"] = int(settings.get("launch_curtain_max_seconds", 15))
            except (TypeError, ValueError):
                settings["launch_curtain_max_seconds"] = int(settings["curtain_timeout"])
            valid_timeouts = set(range(5, 65, 5))
            if settings["curtain_timeout"] not in valid_timeouts:
                settings["curtain_timeout"] = 15
            if settings["launch_curtain_max_seconds"] not in valid_timeouts:
                settings["launch_curtain_max_seconds"] = int(settings["curtain_timeout"])
            if stored_settings_version < 2 and settings["curtain_timeout"] == 5 and settings["launch_curtain_max_seconds"] == 5:
                settings["curtain_timeout"] = 15
                settings["launch_curtain_max_seconds"] = 15
            settings["settings_version"] = int(DEFAULT_SETTINGS["settings_version"])
            return settings
        except Exception as error:
            decky.logger.warning(f"Could not load settings: {error}")
            return dict(DEFAULT_SETTINGS)

    def _save_settings_to_disk(self) -> None:
        with open(_settings_path(), "w", encoding="utf-8") as file:
            json.dump(self.settings, file, indent=2)

    def _reset_process_tracking(self) -> None:
        self.known_processes = _process_snapshot()
        self.launch_chain_pids = {}
        self.launch_game_candidates = {}
        self.launch_game_fullscreen_since = {}

    def _is_curtain_running(self) -> bool:
        return self.overlay_process is not None and self.overlay_process.poll() is None

    def _overlay_script(self) -> str:
        return os.path.join(os.path.dirname(__file__), "helpers", "curtain_overlay.ps1")

    def _default_logo_path(self) -> str:
        return os.path.join(os.path.dirname(__file__), "assets", "base_logo.png")

    def _logo_path(self) -> str:
        if self.current_launch_logo_path and os.path.exists(self.current_launch_logo_path):
            return self.current_launch_logo_path
        if self.current_launch_logo_source:
            return self.current_launch_logo_source

        custom_logo = str(self.settings.get("custom_logo_path", "")).strip()
        if custom_logo and os.path.exists(custom_logo):
            return custom_logo
        return self._default_logo_path()

    def _powershell_path(self) -> str:
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        system_powershell = os.path.join(
            system_root,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe"
        )
        if os.path.exists(system_powershell):
            return system_powershell
        return shutil.which("powershell.exe") or "powershell.exe"

    async def get_settings(self) -> Dict[str, Any]:
        settings = dict(self.settings)
        settings["default_logo_path"] = self._default_logo_path()
        return settings

    async def save_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        for key in DEFAULT_SETTINGS:
            if key in settings:
                self.settings[key] = settings[key]

        self._save_settings_to_disk()

        if self.settings.get("auto_mode"):
            self._ensure_monitor()
        else:
            await self.stop_auto_mode()

        return dict(self.settings)

    async def get_status(self) -> Dict[str, Any]:
        return {
            "is_windows": _is_windows(),
            "curtain_running": self._is_curtain_running(),
            "auto_mode": bool(self.settings.get("auto_mode")),
            "foreground": _foreground_window(),
            "visible_windows": _visible_windows(limit=8)
        }

    async def resolve_game_logo(self, app_id: int) -> Dict[str, Any]:
        include_shortcut_aliases = False
        raw_app_id: Any = app_id
        if isinstance(app_id, dict):
            raw_app_id = app_id.get("app_id") or app_id.get("appid")
            include_shortcut_aliases = bool(app_id.get("is_shortcut"))

        normalized_app_id = _normalize_app_id(raw_app_id)
        if normalized_app_id is None:
            return {"ok": False, "logo_source": "", "message": "Invalid appid."}

        logo_path = _find_steam_app_logo(normalized_app_id, self.known_processes, include_shortcut_aliases)
        if logo_path:
            return {"ok": True, "logo_source": logo_path, "message": "Found Steam grid logo."}

        if include_shortcut_aliases:
            return {
                "ok": False,
                "logo_source": "",
                "message": "No local SteamGridDB logo found for this non-Steam shortcut."
            }

        return {
            "ok": True,
            "logo_source": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{normalized_app_id}/logo.png",
            "message": "Using Steam CDN logo."
        }

    async def show_curtain(self, timeout_override: Optional[int] = None) -> Dict[str, Any]:
        if not _is_windows():
            return {"ok": False, "message": "Launch Curtain currently targets Windows only."}

        if self._is_curtain_running():
            return {"ok": True, "message": "Curtain already visible."}

        script = self._overlay_script()
        if not os.path.exists(script):
            return {"ok": False, "message": f"Overlay helper not found: {script}"}

        timeout_value = timeout_override if timeout_override is not None else self.settings.get(
            "curtain_timeout",
            DEFAULT_SETTINGS["curtain_timeout"]
        )
        timeout = int(timeout_value)
        args = [
            self._powershell_path(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-STA",
            "-WindowStyle",
            "Hidden",
            "-File",
            script,
            "-Title",
            str(self.settings.get("title", DEFAULT_SETTINGS["title"])),
            "-Subtitle",
            str(self.settings.get("subtitle", DEFAULT_SETTINGS["subtitle"])),
            "-Accent",
            str(self.settings.get("accent", DEFAULT_SETTINGS["accent"])),
            "-Logo",
            self._logo_path(),
            "-Timeout",
            str(max(0, timeout))
        ]

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.overlay_process = subprocess.Popen(
            args,
            cwd=os.path.dirname(__file__),
            creationflags=creationflags
        )
        self.last_curtain_started_at = time.time()
        self.game_seen_since = 0.0
        return {"ok": True, "message": "Curtain visible."}

    async def launch_requested(self, request: Any = "steam") -> Dict[str, Any]:
        reason = "steam"
        app_id: Optional[int] = None
        logo_source = ""
        is_shortcut = False

        if isinstance(request, dict):
            reason = str(request.get("reason") or reason)
            is_shortcut = bool(request.get("is_shortcut"))
            raw_app_id = request.get("app_id") or request.get("appid")
            app_id = _normalize_app_id(raw_app_id)
            logo_source = str(request.get("logo_source") or request.get("logo_path") or "")
        elif isinstance(request, str):
            reason = request

        app_id_missing_is_allowed = (
            isinstance(request, dict)
            and not app_id
            and (
                reason.startswith("play button")
                or reason.startswith("SteamClient.Apps.")
            )
        )
        if isinstance(request, dict) and not app_id and not app_id_missing_is_allowed:
            return {"ok": False, "message": "Launch ignored: no Steam game appid was provided."}

        if self.settings.get("auto_mode"):
            self._ensure_monitor()

        timeout = int(self.settings.get(
            "launch_curtain_max_seconds",
            self.settings.get("curtain_timeout", DEFAULT_SETTINGS["curtain_timeout"])
        ))
        pending_seconds = min(max(5, timeout), 60)
        self.launch_pending_until = time.time() + pending_seconds
        self.game_seen_since = 0.0
        self.current_launch_app_id = app_id
        self.current_launch_logo_path = (
            _local_path_from_logo_source(logo_source)
            or _find_steam_app_logo(app_id, self.known_processes, is_shortcut)
        )
        self.current_launch_logo_source = "" if self.current_launch_logo_path else _remote_logo_source(logo_source)

        result = await self.show_curtain(timeout_override=0)
        if result.get("ok"):
            result["message"] = f"Curtain started for launch: {reason}."
        return result

    async def hide_curtain(self) -> Dict[str, Any]:
        if self._is_curtain_running() and self.overlay_process is not None:
            if not _post_close_to_process_windows(self.overlay_process.pid):
                self.overlay_process.terminate()
            try:
                self.overlay_process.wait(timeout=1.4)
            except subprocess.TimeoutExpired:
                self.overlay_process.terminate()
                try:
                    self.overlay_process.wait(timeout=0.8)
                except subprocess.TimeoutExpired:
                    self.overlay_process.kill()

        self.overlay_process = None
        self.launch_pending_until = 0.0
        self.game_seen_since = 0.0
        self.current_launch_app_id = None
        self.current_launch_logo_path = ""
        self.current_launch_logo_source = ""
        self.launch_game_candidates = {}
        self.launch_game_fullscreen_since = {}
        return {"ok": True, "message": "Curtain hidden."}

    async def focus_steam(self) -> Dict[str, Any]:
        hwnd = _find_steam_window()
        if hwnd is None:
            return {"ok": False, "message": "Steam window not found."}

        focused = _focus_window(hwnd)
        return {
            "ok": focused,
            "message": "Steam focused." if focused else "Could not focus Steam.",
            "hwnd": hwnd
        }

    async def list_windows(self) -> List[Dict[str, Any]]:
        return _visible_windows(limit=30)

    async def start_auto_mode(self) -> Dict[str, Any]:
        self.settings["auto_mode"] = True
        self._save_settings_to_disk()
        self._reset_process_tracking()
        self._ensure_monitor()
        return {"ok": True, "message": "Auto mode enabled."}

    async def stop_auto_mode(self) -> Dict[str, Any]:
        self.settings["auto_mode"] = False
        self._save_settings_to_disk()
        if self.monitor_task is not None:
            self.monitor_task.cancel()
            try:
                await self.monitor_task
            except asyncio.CancelledError:
                pass
            self.monitor_task = None
        return {"ok": True, "message": "Auto mode disabled."}

    def _ensure_monitor(self) -> None:
        if self.monitor_task is None or self.monitor_task.done():
            self.monitor_task = asyncio.get_event_loop().create_task(self._monitor_foreground())

    async def _monitor_process_launches(
        self,
        processes: Dict[int, Dict[str, Any]],
        launcher_names: set[str]
    ) -> None:
        if not processes:
            return

        now = time.time()
        self.launch_chain_pids = {
            pid: expires_at
            for pid, expires_at in self.launch_chain_pids.items()
            if expires_at > now and pid in processes
        }

        known_pids = set(self.known_processes.keys())
        new_processes = [
            process
            for pid, process in processes.items()
            if pid not in known_pids
        ]
        self.known_processes = processes

        if not new_processes:
            return

        if now >= self.launch_pending_until:
            return

        source_pids = {
            pid
            for pid, process in processes.items()
            if str(process.get("process", "")).lower() in STEAM_PROCESS_NAMES
            or str(process.get("process", "")).lower() in launcher_names
        }
        source_pids.update(self.launch_chain_pids.keys())

        for process in sorted(new_processes, key=lambda item: int(item.get("pid", 0))):
            pid = int(process.get("pid", 0))
            parent_pid = int(process.get("parent_pid", 0))
            process_name = str(process.get("process", "")).lower()
            parent_name = str(processes.get(parent_pid, {}).get("process", "")).lower()
            parent_is_launch_source = (
                parent_pid in source_pids
                or parent_name in STEAM_PROCESS_NAMES
                or parent_name in launcher_names
            )

            if not parent_is_launch_source:
                continue

            self.launch_chain_pids[pid] = now + 45

            if process_name in IGNORED_LAUNCH_CHILDREN:
                continue

            self.game_seen_since = 0.0
            if process_name not in launcher_names:
                self.launch_game_candidates[pid] = {"first_seen": now}
            decky.logger.info(f"Launch Curtain detected process launch: {process_name} from {parent_name}")
            return

    async def _hide_for_settled_process_candidate(self, processes: Dict[int, Dict[str, Any]]) -> None:
        if not self._is_curtain_running():
            return

        now = time.time()
        game_settle = float(self.settings.get("game_settle_seconds", 2))
        min_visible = float(self.settings.get("min_visible_seconds", 2))
        visible_long_enough = now - self.last_curtain_started_at >= min_visible

        self.launch_game_candidates = {
            pid: data
            for pid, data in self.launch_game_candidates.items()
            if pid in processes and now - float(data.get("first_seen", now)) <= 30
        }
        self.launch_game_fullscreen_since = {
            pid: fullscreen_since
            for pid, fullscreen_since in self.launch_game_fullscreen_since.items()
            if pid in self.launch_game_candidates
        }

        for pid, data in self.launch_game_candidates.items():
            first_seen = float(data.get("first_seen", now))
            if now - first_seen < 0.4:
                continue

            if _pid_has_fullscreen_window(pid):
                if pid not in self.launch_game_fullscreen_since:
                    self.launch_game_fullscreen_since[pid] = now
                fullscreen_long_enough = now - self.launch_game_fullscreen_since[pid] >= game_settle
            else:
                self.launch_game_fullscreen_since.pop(pid, None)
                fullscreen_long_enough = False

            if fullscreen_long_enough and visible_long_enough:
                self.launch_pending_until = 0.0
                self.game_seen_since = 0.0
                self.launch_game_candidates = {}
                self.launch_game_fullscreen_since = {}
                await self.hide_curtain()
                return

    async def _hide_expired_launch_curtain(self) -> None:
        if not self._is_curtain_running() or self.launch_pending_until <= 0:
            return

        if time.time() >= self.launch_pending_until:
            self.launch_pending_until = 0.0
            self.game_seen_since = 0.0
            self.launch_game_candidates = {}
            self.launch_game_fullscreen_since = {}
            await self.hide_curtain()

    async def _monitor_foreground(self) -> None:
        launcher_names = {
            str(name).lower()
            for name in self.settings.get("launcher_processes", DEFAULT_SETTINGS["launcher_processes"])
        }

        while bool(self.settings.get("auto_mode")):
            processes = _process_snapshot()
            await self._monitor_process_launches(processes, launcher_names)
            await self._hide_for_settled_process_candidate(processes)
            await self._hide_expired_launch_curtain()

            foreground = _foreground_window()
            process = str(foreground.get("process", "")).lower()
            title = str(foreground.get("title", "")).lower()
            foreground_hwnd = int(foreground.get("hwnd", 0) or 0)

            is_launcher = process in launcher_names
            is_overlay = process in {"powershell.exe", "pwsh.exe"} and "launch curtain" in title
            is_steam = process in {"steam.exe", "steamwebhelper.exe"}
            looks_like_game = bool(process) and not is_launcher and not is_overlay and not is_steam
            is_fullscreen_game = looks_like_game and _window_is_fullscreen(foreground_hwnd)
            min_visible = float(self.settings.get("min_visible_seconds", 2))
            game_settle = float(self.settings.get("game_settle_seconds", 2))

            if self._is_curtain_running() and is_fullscreen_game:
                if self.game_seen_since <= 0:
                    self.game_seen_since = time.time()

                game_is_settled = time.time() - self.game_seen_since >= game_settle
                curtain_was_visible = time.time() - self.last_curtain_started_at >= min_visible
                if game_is_settled and curtain_was_visible:
                    self.launch_pending_until = 0.0
                    self.game_seen_since = 0.0
                    await self.hide_curtain()
            else:
                self.game_seen_since = 0.0

            await asyncio.sleep(0.5)
