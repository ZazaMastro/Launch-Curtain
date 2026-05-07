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
from typing import Any, Dict, List, Optional

import decky


PLAYHUB_YELLOW = "#FCCC01"

DEFAULT_SETTINGS: Dict[str, Any] = {
    "auto_mode": False,
    "curtain_timeout": 45,
    "launch_curtain_max_seconds": 12,
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


def _process_name(pid: int) -> str:
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
        return os.path.basename(buffer.value)
    finally:
        kernel32.CloseHandle(handle)


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


class Plugin:
    def __init__(self) -> None:
        self.settings: Dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.overlay_process: Optional[subprocess.Popen[Any]] = None
        self.monitor_task: Optional[asyncio.Task[Any]] = None
        self.last_curtain_started_at = 0.0
        self.launch_pending_until = 0.0
        self.game_seen_since = 0.0
        self.known_processes: Dict[int, Dict[str, Any]] = {}
        self.launch_chain_pids: Dict[int, float] = {}
        self.launch_game_candidates: Dict[int, float] = {}

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
            settings = dict(DEFAULT_SETTINGS)
            settings.update(data)
            if str(settings.get("accent", "")).lower() in {"", "#ffffff", "white"}:
                settings["accent"] = PLAYHUB_YELLOW
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

    def _is_curtain_running(self) -> bool:
        return self.overlay_process is not None and self.overlay_process.poll() is None

    def _overlay_script(self) -> str:
        return os.path.join(os.path.dirname(__file__), "helpers", "curtain_overlay.ps1")

    def _logo_path(self) -> str:
        custom_logo = str(self.settings.get("custom_logo_path", "")).strip()
        if custom_logo and os.path.exists(custom_logo):
            return custom_logo
        return os.path.join(os.path.dirname(__file__), "assets", "base_logo.png")

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
        return dict(self.settings)

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

    async def show_curtain(self, timeout_override: Optional[int] = None) -> Dict[str, Any]:
        if not _is_windows():
            return {"ok": False, "message": "Launch Curtain currently targets Windows only."}

        if self._is_curtain_running():
            return {"ok": True, "message": "Curtain already visible."}

        script = self._overlay_script()
        if not os.path.exists(script):
            return {"ok": False, "message": f"Overlay helper not found: {script}"}

        timeout = int(timeout_override or self.settings.get("curtain_timeout", DEFAULT_SETTINGS["curtain_timeout"]))
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
            str(max(5, timeout))
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

    async def launch_requested(self, reason: str = "steam") -> Dict[str, Any]:
        timeout = int(self.settings.get("launch_curtain_max_seconds", DEFAULT_SETTINGS["launch_curtain_max_seconds"]))
        pending_seconds = min(max(6, timeout), 16)
        self.launch_pending_until = time.time() + pending_seconds
        self.game_seen_since = 0.0

        result = await self.show_curtain(timeout_override=pending_seconds)
        if result.get("ok"):
            result["message"] = f"Curtain started for launch: {reason}."
        return result

    async def hide_curtain(self) -> Dict[str, Any]:
        if self._is_curtain_running() and self.overlay_process is not None:
            self.overlay_process.terminate()
            try:
                self.overlay_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.overlay_process.kill()

        self.overlay_process = None
        self.launch_pending_until = 0.0
        self.game_seen_since = 0.0
        self.launch_game_candidates = {}
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

            timeout = int(self.settings.get("launch_curtain_max_seconds", DEFAULT_SETTINGS["launch_curtain_max_seconds"]))
            pending_seconds = min(max(6, timeout), 16)
            self.launch_pending_until = now + pending_seconds
            self.game_seen_since = 0.0
            if process_name not in launcher_names:
                self.launch_game_candidates[pid] = now
            await self.show_curtain(timeout_override=pending_seconds)
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
            pid: first_seen
            for pid, first_seen in self.launch_game_candidates.items()
            if pid in processes and now - first_seen <= 30
        }

        for _pid, first_seen in self.launch_game_candidates.items():
            if now - first_seen >= game_settle and visible_long_enough:
                self.launch_pending_until = 0.0
                self.game_seen_since = 0.0
                self.launch_game_candidates = {}
                await self.hide_curtain()
                return

    async def _hide_expired_launch_curtain(self) -> None:
        if not self._is_curtain_running() or self.launch_pending_until <= 0:
            return

        if time.time() >= self.launch_pending_until:
            self.launch_pending_until = 0.0
            self.game_seen_since = 0.0
            self.launch_game_candidates = {}
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

            is_launcher = process in launcher_names
            is_overlay = process in {"powershell.exe", "pwsh.exe"} and "launch curtain" in title
            is_steam = process in {"steam.exe", "steamwebhelper.exe"}
            is_launch_pending = time.time() < self.launch_pending_until
            looks_like_game = bool(process) and not is_launcher and not is_overlay and not is_steam
            min_visible = float(self.settings.get("min_visible_seconds", 2))
            game_settle = float(self.settings.get("game_settle_seconds", 2))

            if is_launcher and not self._is_curtain_running():
                await self.show_curtain()

            if self._is_curtain_running() and looks_like_game:
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

            if self._is_curtain_running() and not is_launch_pending and not looks_like_game and not is_launcher and not is_overlay:
                if time.time() - self.last_curtain_started_at >= min_visible:
                    await self.hide_curtain()

            await asyncio.sleep(0.5)
