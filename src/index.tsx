import {
  ButtonItem,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
  ToggleField
} from "@decky/ui";
import { callable, definePlugin, openFilePicker, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaTheaterMasks } from "react-icons/fa";

type ForegroundWindow = {
  hwnd: number;
  title: string;
  pid: number;
  process: string;
  platform: string;
};

type VisibleWindow = {
  hwnd: number;
  title: string;
  pid: number;
  process: string;
};

type Settings = {
  auto_mode: boolean;
  curtain_timeout: number;
  default_logo_path?: string;
  launch_curtain_max_seconds: number;
  min_visible_seconds: number;
  game_settle_seconds: number;
  title: string;
  subtitle: string;
  accent: string;
  custom_logo_path: string;
  launcher_processes: string[];
};

type Status = {
  is_windows: boolean;
  curtain_running: boolean;
  auto_mode: boolean;
  foreground: ForegroundWindow;
  visible_windows: VisibleWindow[];
};

type ActionResult = {
  ok: boolean;
  message: string;
};

type LaunchRequest = {
  reason: string;
  app_id?: number;
  is_shortcut?: boolean;
  logo_source?: string;
};

type LogoResult = {
  ok: boolean;
  logo_source: string;
  message: string;
};

type LogoRequest = {
  app_id: number;
  is_shortcut?: boolean;
};

type SteamAppOverviewLike = Record<string, unknown>;

type SteamAppDetailsLike = {
  libraryAssets?: {
    strLogoImage?: string;
  };
};

const getSettings = callable<[], Settings>("get_settings");
const saveSettings = callable<[settings: Partial<Settings>], Settings>("save_settings");
const getStatus = callable<[], Status>("get_status");
const hideCurtain = callable<[], ActionResult>("hide_curtain");
const launchRequested = callable<[request?: string | LaunchRequest], ActionResult>("launch_requested");
const resolveGameLogo = callable<[request: number | LogoRequest], LogoResult>("resolve_game_logo");
const startAutoMode = callable<[], ActionResult>("start_auto_mode");
const stopAutoMode = callable<[], ActionResult>("stop_auto_mode");
const FILE_SELECTION_FILE = 0;

type I18n = {
  curtain: string;
  automation: string;
  timeout: string;
  foreground: string;
  showCurtain: string;
  hideCurtain: string;
  focusSteam: string;
  autoLaunchCurtain: string;
  windowsOnly: string;
  noForeground: string;
  logo: string;
  chooseLogo: string;
  useDefaultLogo: string;
  defaultLogo: string;
  customLogo: string;
  logoPickerError: string;
  timeoutHelp?: string;
  seconds25: string;
  seconds45: string;
  seconds75: string;
  toastTitle: string;
  toastAttention: string;
};

const I18N: Record<string, I18n> = {
  en: {
    curtain: "Curtain",
    automation: "Settings",
    timeout: "Timeout",
    foreground: "Foreground",
    showCurtain: "Show curtain",
    hideCurtain: "Hide curtain",
    focusSteam: "Focus Steam",
    autoLaunchCurtain: "Enable launch screen",
    windowsOnly: "Windows-only backend. This system is not Windows.",
    noForeground: "No foreground window detected",
    logo: "Logo",
    chooseLogo: "Choose custom logo",
    useDefaultLogo: "Use default logo",
    defaultLogo: "Default Playhub logo",
    customLogo: "Custom logo",
    logoPickerError: "Could not choose a logo.",
    timeoutHelp: "How long the launch screen can stay visible while waiting for the game to become fullscreen.",
    seconds25: "25 seconds",
    seconds45: "45 seconds",
    seconds75: "75 seconds",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain needs attention"
  },
  it: {
    curtain: "Schermata",
    automation: "Impostazioni",
    timeout: "Timeout",
    foreground: "Finestra attiva",
    showCurtain: "Mostra schermata",
    hideCurtain: "Nascondi schermata",
    focusSteam: "Riporta Steam davanti",
    autoLaunchCurtain: "Attiva la schermata di avvio",
    windowsOnly: "Backend solo per Windows. Questo sistema non e Windows.",
    noForeground: "Nessuna finestra attiva rilevata",
    logo: "Logo",
    chooseLogo: "Scegli logo custom",
    useDefaultLogo: "Usa logo predefinito",
    defaultLogo: "Logo Playhub predefinito",
    customLogo: "Logo custom",
    logoPickerError: "Non sono riuscito a scegliere un logo.",
    timeoutHelp: "Per quanto tempo la schermata di avvio puo restare visibile mentre aspetta che il gioco passi a schermo intero.",
    seconds25: "25 secondi",
    seconds45: "45 secondi",
    seconds75: "75 secondi",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain richiede attenzione"
  },
  fr: {
    curtain: "Rideau",
    automation: "Automatisation",
    timeout: "Delai",
    foreground: "Fenetre active",
    showCurtain: "Afficher le rideau",
    hideCurtain: "Masquer le rideau",
    focusSteam: "Remettre Steam devant",
    autoLaunchCurtain: "Rideau automatique au lancement",
    windowsOnly: "Backend Windows uniquement. Ce systeme n'est pas Windows.",
    noForeground: "Aucune fenetre active detectee",
    logo: "Logo",
    chooseLogo: "Choisir un logo personnalise",
    useDefaultLogo: "Utiliser le logo par defaut",
    defaultLogo: "Logo Playhub par defaut",
    customLogo: "Logo personnalise",
    logoPickerError: "Impossible de choisir un logo.",
    seconds25: "25 secondes",
    seconds45: "45 secondes",
    seconds75: "75 secondes",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain demande votre attention"
  },
  es: {
    curtain: "Cortina",
    automation: "Automatizacion",
    timeout: "Tiempo limite",
    foreground: "Ventana activa",
    showCurtain: "Mostrar cortina",
    hideCurtain: "Ocultar cortina",
    focusSteam: "Enfocar Steam",
    autoLaunchCurtain: "Cortina automatica al iniciar",
    windowsOnly: "Backend solo para Windows. Este sistema no es Windows.",
    noForeground: "No se detecto ninguna ventana activa",
    logo: "Logo",
    chooseLogo: "Elegir logo personalizado",
    useDefaultLogo: "Usar logo predeterminado",
    defaultLogo: "Logo Playhub predeterminado",
    customLogo: "Logo personalizado",
    logoPickerError: "No se pudo elegir un logo.",
    seconds25: "25 segundos",
    seconds45: "45 segundos",
    seconds75: "75 segundos",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain necesita atencion"
  },
  pt: {
    curtain: "Cortina",
    automation: "Automacao",
    timeout: "Tempo limite",
    foreground: "Janela ativa",
    showCurtain: "Mostrar cortina",
    hideCurtain: "Ocultar cortina",
    focusSteam: "Focar Steam",
    autoLaunchCurtain: "Cortina automatica ao iniciar",
    windowsOnly: "Backend apenas para Windows. Este sistema nao e Windows.",
    noForeground: "Nenhuma janela ativa detectada",
    logo: "Logotipo",
    chooseLogo: "Escolher logotipo personalizado",
    useDefaultLogo: "Usar logotipo padrao",
    defaultLogo: "Logotipo Playhub padrao",
    customLogo: "Logotipo personalizado",
    logoPickerError: "Nao foi possivel escolher um logotipo.",
    seconds25: "25 segundos",
    seconds45: "45 segundos",
    seconds75: "75 segundos",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain precisa de atencao"
  },
  "pt-br": {
    curtain: "Cortina",
    automation: "Automacao",
    timeout: "Tempo limite",
    foreground: "Janela ativa",
    showCurtain: "Mostrar cortina",
    hideCurtain: "Ocultar cortina",
    focusSteam: "Focar Steam",
    autoLaunchCurtain: "Cortina automatica ao iniciar",
    windowsOnly: "Backend apenas para Windows. Este sistema nao e Windows.",
    noForeground: "Nenhuma janela ativa detectada",
    logo: "Logo",
    chooseLogo: "Escolher logo personalizado",
    useDefaultLogo: "Usar logo padrao",
    defaultLogo: "Logo Playhub padrao",
    customLogo: "Logo personalizado",
    logoPickerError: "Nao foi possivel escolher um logo.",
    seconds25: "25 segundos",
    seconds45: "45 segundos",
    seconds75: "75 segundos",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain precisa de atencao"
  },
  de: {
    curtain: "Vorhang",
    automation: "Automatisierung",
    timeout: "Zeitlimit",
    foreground: "Aktives Fenster",
    showCurtain: "Vorhang anzeigen",
    hideCurtain: "Vorhang ausblenden",
    focusSteam: "Steam fokussieren",
    autoLaunchCurtain: "Automatischer Startvorhang",
    windowsOnly: "Backend nur fur Windows. Dieses System ist nicht Windows.",
    noForeground: "Kein aktives Fenster erkannt",
    logo: "Logo",
    chooseLogo: "Eigenes Logo wahlen",
    useDefaultLogo: "Standardlogo verwenden",
    defaultLogo: "Standard-Playhub-Logo",
    customLogo: "Eigenes Logo",
    logoPickerError: "Logo konnte nicht ausgewahlt werden.",
    seconds25: "25 Sekunden",
    seconds45: "45 Sekunden",
    seconds75: "75 Sekunden",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain braucht Aufmerksamkeit"
  },
  nl: {
    curtain: "Gordijn",
    automation: "Automatisering",
    timeout: "Time-out",
    foreground: "Actief venster",
    showCurtain: "Gordijn tonen",
    hideCurtain: "Gordijn verbergen",
    focusSteam: "Steam naar voren",
    autoLaunchCurtain: "Automatisch startgordijn",
    windowsOnly: "Backend alleen voor Windows. Dit systeem is geen Windows.",
    noForeground: "Geen actief venster gevonden",
    logo: "Logo",
    chooseLogo: "Eigen logo kiezen",
    useDefaultLogo: "Standaardlogo gebruiken",
    defaultLogo: "Standaard Playhub-logo",
    customLogo: "Eigen logo",
    logoPickerError: "Kon geen logo kiezen.",
    seconds25: "25 seconden",
    seconds45: "45 seconden",
    seconds75: "75 seconden",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain vraagt aandacht"
  },
  uk: {
    curtain: "Завіса",
    automation: "Автоматизація",
    timeout: "Час очікування",
    foreground: "Активне вікно",
    showCurtain: "Показати завісу",
    hideCurtain: "Сховати завісу",
    focusSteam: "Повернути Steam на передній план",
    autoLaunchCurtain: "Автоматична завіса запуску",
    windowsOnly: "Backend працює лише у Windows. Ця система не Windows.",
    noForeground: "Активне вікно не знайдено",
    logo: "Логотип",
    chooseLogo: "Вибрати власний логотип",
    useDefaultLogo: "Використати типовий логотип",
    defaultLogo: "Типовий логотип Playhub",
    customLogo: "Власний логотип",
    logoPickerError: "Не вдалося вибрати логотип.",
    seconds25: "25 секунд",
    seconds45: "45 секунд",
    seconds75: "75 секунд",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain потребує уваги"
  },
  zh: {
    curtain: "启动幕布",
    automation: "自动化",
    timeout: "超时",
    foreground: "前台窗口",
    showCurtain: "显示幕布",
    hideCurtain: "隐藏幕布",
    focusSteam: "聚焦 Steam",
    autoLaunchCurtain: "启动时自动显示幕布",
    windowsOnly: "后端仅支持 Windows。当前系统不是 Windows。",
    noForeground: "未检测到前台窗口",
    logo: "标志",
    chooseLogo: "选择自定义标志",
    useDefaultLogo: "使用默认标志",
    defaultLogo: "默认 Playhub 标志",
    customLogo: "自定义标志",
    logoPickerError: "无法选择标志。",
    seconds25: "25 秒",
    seconds45: "45 秒",
    seconds75: "75 秒",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain 需要注意"
  },
  ja: {
    curtain: "カーテン",
    automation: "自動化",
    timeout: "タイムアウト",
    foreground: "前面のウィンドウ",
    showCurtain: "カーテンを表示",
    hideCurtain: "カーテンを非表示",
    focusSteam: "Steam を前面へ",
    autoLaunchCurtain: "起動時に自動表示",
    windowsOnly: "バックエンドは Windows 専用です。このシステムは Windows ではありません。",
    noForeground: "前面のウィンドウが見つかりません",
    logo: "ロゴ",
    chooseLogo: "カスタムロゴを選択",
    useDefaultLogo: "既定のロゴを使用",
    defaultLogo: "既定の Playhub ロゴ",
    customLogo: "カスタムロゴ",
    logoPickerError: "ロゴを選択できませんでした。",
    seconds25: "25 秒",
    seconds45: "45 秒",
    seconds75: "75 秒",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain に注意が必要です"
  }
};

function getLocaleKey(): string {
  const rawLanguage = navigator.language.toLowerCase();
  if (rawLanguage.startsWith("pt-br")) return "pt-br";
  if (rawLanguage.startsWith("zh")) return "zh";
  const baseLanguage = rawLanguage.split("-")[0];
  return I18N[baseLanguage] ? baseLanguage : "en";
}

function getStrings(): I18n {
  return I18N[getLocaleKey()] ?? I18N.en;
}

const PLAY_LABELS = new Set([
  "play",
  "gioca",
  "jouer",
  "jugar",
  "jogar",
  "spielen",
  "spelen",
  "грати",
  "开始",
  "开始游戏",
  "啟動",
  "開始遊戲",
  "プレイ",
  "ゲームをプレイ"
]);

declare global {
  interface Window {
    SteamClient?: {
      Apps?: Record<string, unknown>;
    };
  }
}

class PlayButtonLaunchHook {
  private enabled = false;
  private setupDone = false;
  private lastTriggerAt = 0;
  private pollTimer: number | undefined;
  private patchedApps: Record<string, unknown> | undefined;
  private methodRestorers: Array<() => void> = [];
  private instantCurtainTimer: number | undefined;
  private instantCurtainElement: HTMLDivElement | undefined;
  private instantCurtainExpiresAt = 0;
  private backendLaunchTimer: number | undefined;
  private backendLaunchToken = 0;
  private activeInstantAppId: number | undefined;
  private gamepadCloseFrame: number | undefined;
  private gamepadClosePressed = false;
  private logoPath = "";
  private defaultLogoPath = "";

  setup(): void {
    if (this.setupDone) {
      return;
    }

    this.setupDone = true;
    document.addEventListener("pointerdown", this.handlePointerDown, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleWindowFocus);
    this.patchSteamClient();
    this.pollTimer = window.setInterval(() => this.patchSteamClient(), 1000);
  }

  cleanup(): void {
    document.removeEventListener("pointerdown", this.handlePointerDown, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("focus", this.handleWindowFocus);
    this.restoreMethodPatches();
    this.hideInstantCurtain();
    if (this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.clearPendingBackendLaunch();
    this.patchedApps = undefined;
    this.setupDone = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setLogoPath(path: string): void {
    this.logoPath = path;
  }

  setDefaultLogoPath(path: string): void {
    this.defaultLogoPath = path;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.isPlayButtonEvent(event.target, event.composedPath())) {
      const appId = this.findAppIdForEvent(event.target, event.composedPath());
      const logoSource = appId ? this.findGameLogoSource(appId) : undefined;
      this.trigger("play button pointerdown", appId, logoSource, false);
    }
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.isPlayButtonEvent(event.target, event.composedPath())) {
      const appId = this.findAppIdForEvent(event.target, event.composedPath());
      const logoSource = appId ? this.findGameLogoSource(appId) : undefined;
      this.trigger("play button click", appId, logoSource, false);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.instantCurtainElement) {
      event.preventDefault();
      event.stopPropagation();
      this.requestCloseAllCurtains();
      return;
    }

    if (!["Enter", " "].includes(event.key)) {
      return;
    }

    if (this.isPlayButtonEvent(document.activeElement, [])) {
      const appId = this.findAppIdForEvent(document.activeElement, []);
      const logoSource = appId ? this.findGameLogoSource(appId) : undefined;
      this.trigger("play button keydown", appId, logoSource, false);
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.hideInstantCurtain();
      return;
    }

    this.hideExpiredInstantCurtain();
  };

  private readonly handleWindowFocus = (): void => {
    this.hideExpiredInstantCurtain();
  };

  private isPlayButtonEvent(target: EventTarget | null, composedPath: EventTarget[]): boolean {
    const candidates = this.getCandidateElements(target, composedPath);
    return candidates.some((element) => this.isExactPlayButton(element));
  }

  private getCandidateElements(target: EventTarget | null, composedPath: EventTarget[]): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    const path = composedPath.length > 0 ? composedPath : this.parentPath(target);

    for (const item of path.slice(0, 10)) {
      if (!(item instanceof HTMLElement)) {
        continue;
      }

      const isCandidate = item.tagName === "BUTTON"
        || item.getAttribute("role") === "button"
        || item.getAttribute("data-focusable") === "true";

      if (isCandidate) {
        candidates.push(item);
      }
    }

    return candidates;
  }

  private parentPath(target: EventTarget | null): EventTarget[] {
    const path: EventTarget[] = [];
    let current = target instanceof HTMLElement ? target : null;

    while (current && path.length < 10) {
      path.push(current);
      current = current.parentElement;
    }

    return path;
  }

  private isExactPlayButton(element: HTMLElement): boolean {
    if (this.hasBlockedContext(element)) {
      return false;
    }

    const labels = this.getLabels(element);
    return labels.some((label) => {
      const normalized = this.normalizeLabel(label);
      return PLAY_LABELS.has(normalized);
    });
  }

  private hasBlockedContext(element: HTMLElement): boolean {
    let current: HTMLElement | null = element;
    let depth = 0;

    while (current && depth < 4) {
      const context = this.normalizeLabel([
        current.getAttribute("aria-label") ?? "",
        current.getAttribute("title") ?? "",
        current.className?.toString?.() ?? "",
        current.id ?? ""
      ].join(" "));

      if (/(trailer|video|media|preview|anteprima|filmato)/i.test(context)) {
        return true;
      }

      current = current.parentElement;
      depth += 1;
    }

    return false;
  }

  private getLabels(element: HTMLElement): string[] {
    return [
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? "",
      element.innerText ?? "",
      element.textContent ?? ""
    ].filter((label) => label.trim().length > 0 && label.trim().length <= 24);
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private findAppIdForEvent(target: EventTarget | null, composedPath: EventTarget[]): number | undefined {
    const sources: string[] = [];
    const path = composedPath.length > 0 ? composedPath : this.parentPath(target);

    for (const item of path.slice(0, 16)) {
      if (!(item instanceof HTMLElement)) {
        continue;
      }

      const reactAppId = this.readReactAppId(item);
      if (reactAppId) {
        return reactAppId;
      }

      sources.push(
        item.getAttribute("href") ?? "",
        item.getAttribute("src") ?? "",
        item.getAttribute("style") ?? "",
        item.getAttribute("data-appid") ?? "",
        item.getAttribute("data-app-id") ?? "",
        item.getAttribute("data-ds-appid") ?? "",
        item.id ?? "",
        `${item.className ?? ""}`,
        getComputedStyle(item).backgroundImage
      );
    }

    for (const source of sources) {
      const appId = this.extractAppIdFromText(source);
      if (appId) {
        return appId;
      }
    }

    return undefined;
  }

  private readReactAppId(element: HTMLElement): number | undefined {
    const reactKeys = Object.getOwnPropertyNames(element).filter((key) => key.startsWith("__react"));
    for (const key of reactKeys) {
      let fiber: unknown = (element as unknown as Record<string, unknown>)[key];
      for (let depth = 0; fiber && depth < 12; depth += 1) {
        const fiberRecord = fiber as {
          memoizedProps?: unknown;
          pendingProps?: unknown;
          return?: unknown;
        };
        const appId = this.extractAppIdFromUnknown(fiberRecord.memoizedProps)
          ?? this.extractAppIdFromUnknown(fiberRecord.pendingProps);
        if (appId) {
          return appId;
        }
        fiber = fiberRecord.return;
      }
    }
    return undefined;
  }

  private extractAppIdFromText(value: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const patterns = [
      /(?:library|games?|app)\/(?:app\/)?(\d{2,20})(?:[/?#]|$)/i,
      /steam:\/\/(?:nav\/games\/details|rungameid|store)\/(\d{2,20})/i,
      /[?&#](?:appid|appId|app_id|gameid|gameId|game_id)=(\d{2,20})(?:[&#]|$)/i,
      /(?:steam\/apps|store_item_assets\/steam\/apps|steamcommunity\/public\/images\/apps|\/assets)\/(\d{2,10})(?:\/|$)/i,
      /(?:config\/grid|config\\grid|\/grid\/|\\grid\\)(\d{2,10})(?:[._a-z-]|$)/i,
      /\/customimages\/(\d{2,10})(?:[a-z_]*)(?:[._/?#-]|$)/i,
      /(?:appid|app_id|app-id|gameid|game_id|game-id)["'=:\s]+(\d{2,20})/i
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match?.[1]) {
        const appId = this.extractAppIdFromUnknown(match[1]);
        if (appId && this.isPlausibleAppId(appId)) {
          return appId;
        }
      }
    }

    return undefined;
  }

  private extractAppIdFromUnknown(value: unknown, depth = 0): number | undefined {
    if (value === null || value === undefined || depth > 5) {
      return undefined;
    }

    if (typeof value === "number") {
      const appId = this.normalizeNumericAppId(value);
      return appId && this.isPlausibleAppId(appId) ? appId : undefined;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^-?\d{2,20}$/.test(trimmed)) {
        if (trimmed.startsWith("-")) {
          const appId = Number.parseInt(trimmed, 10);
          const normalizedAppId = this.normalizeNumericAppId(appId);
          return normalizedAppId && this.isPlausibleAppId(normalizedAppId) ? normalizedAppId : undefined;
        }

        const normalizedAppId = this.normalizeBigIntAppId(BigInt(trimmed));
        return normalizedAppId && this.isPlausibleAppId(normalizedAppId) ? normalizedAppId : undefined;
      }
      return this.extractAppIdFromText(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const appId = this.extractAppIdFromUnknown(item, depth + 1);
        if (appId) {
          return appId;
        }
      }
      return undefined;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of [
        "appid",
        "appId",
        "appID",
        "app_id",
        "unAppID",
        "nAppID",
        "m_unAppID",
        "shortcutid",
        "shortcutId",
        "shortcutID",
        "shortcut_id",
        "unShortcutID",
        "m_unShortcutID",
        "gameid",
        "gameId",
        "gameID",
        "strGameID",
        "strGameId"
      ]) {
        const appId = this.extractAppIdFromUnknown(record[key], depth + 1);
        if (appId) {
          return appId;
        }
      }

      for (const key of ["app", "game", "overview", "details", "props", "data", "shortcut"]) {
        const appId = this.extractAppIdFromUnknown(record[key], depth + 1);
        if (appId) {
          return appId;
        }
      }

      for (const key of Object.keys(record).slice(0, 32)) {
        if (!/(app.?id|appid|game.?id|shortcut.?id|strgameid)/i.test(key)) {
          continue;
        }
        const appId = this.extractAppIdFromUnknown(record[key], depth + 1);
        if (appId) {
          return appId;
        }
      }
    }

    return undefined;
  }

  private isPlausibleAppId(value: number): boolean {
    return Number.isInteger(value) && value > 0 && value < 4294967296;
  }

  private normalizeNumericAppId(value: number): number | undefined {
    if (!Number.isInteger(value)) {
      return undefined;
    }
    if (value > 0xffffffff) {
      const upper = Math.floor(value / 4294967296);
      return upper >= 0x80000000 && this.isPlausibleAppId(upper) ? upper : undefined;
    }
    if (value > 0) {
      return Math.floor(value);
    }
    return value >>> 0;
  }

  private normalizeBigIntAppId(value: bigint): number | undefined {
    if (value <= 0n) {
      return undefined;
    }
    if (value <= 0xffffffffn) {
      return Number(value);
    }

    const upper = Number((value >> 32n) & 0xffffffffn);
    return upper >= 0x80000000 && this.isPlausibleAppId(upper) ? upper : undefined;
  }

  private getElementLogoSource(element: HTMLElement): string {
    return (
      this.extractCssUrl(element.getAttribute("style") ?? "")
      || this.extractCssUrl(getComputedStyle(element).backgroundImage)
      || element.getAttribute("src")
      || ""
    );
  }

  private extractCssUrl(value: string): string {
    const match = value.match(/url\((["']?)(.*?)\1\)/i);
    return match?.[2] ?? "";
  }

  private elementLooksLikeGameLogo(element: HTMLElement, appId: number): boolean {
    const source = this.getElementLogoSource(element).toLowerCase();
    const appIdText = String(appId);
    const metadata = [
      source,
      element.getAttribute("alt") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? "",
      element.getAttribute("style") ?? "",
      getComputedStyle(element).backgroundImage,
      `${element.className ?? ""}`,
      `${element.parentElement?.className ?? ""}`
    ].join(" ").toLowerCase();

    const hasAppReference = (
      metadata.includes(appIdText)
      || source.includes(`/customimages/${appIdText}`)
      || source.includes(`\\grid\\${appIdText}`)
      || source.includes(`/grid/${appIdText}`)
      || source.includes(`/${appIdText}_`)
      || source.includes(`\\${appIdText}_`)
      || source.includes(`/assets/${appIdText}/`)
      || source.includes(`/apps/${appIdText}/`)
      || source.includes(`/steam/apps/${appIdText}/`)
      || source.includes(`/${appIdText}/`)
    );
    const hasLogoHint = (
      metadata.includes("logo")
      || source.includes("_logo")
      || source.includes("steamgriddb")
      || source.includes("sgdb")
      || source.includes("/grid/")
      || source.includes("\\grid\\")
      || source.includes("/logos/")
      || source.includes("/logo/")
    );

    return hasAppReference && hasLogoHint && Boolean(source);
  }

  private logoIsSmallEnough(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const naturalArea = element instanceof HTMLImageElement
      ? (element.naturalWidth || 0) * (element.naturalHeight || 0)
      : 1;

    if (rect.width <= 1 || rect.height <= 1) {
      return naturalArea > 0;
    }

    return rect.width <= 260 || rect.height <= 110 || rect.width * rect.height <= 26000;
  }

  private findGameLogoSource(appId: number): string | undefined {
    const selector = [
      "img",
      "[class*='Logo']",
      "[class*='logo']",
      "[style*='Logo']",
      "[style*='logo']",
      "[style*='/customimages/']",
      "[style*='SteamGridDB']",
      "[style*='steamgriddb']",
      "[style*='sgdb']",
      "[style*='config/grid']",
      "[style*='config\\\\grid']",
      "[style*='steamcommunity/public/images/apps']",
      "[style*='/steam/apps/']"
    ].join(",");

    const seen = new Set<string>();
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((element) => {
        const source = this.getElementLogoSource(element);
        if (!source || seen.has(source)) {
          return undefined;
        }
        seen.add(source);

        if (!this.elementLooksLikeGameLogo(element, appId) || !this.logoIsSmallEnough(element)) {
          return undefined;
        }

        const rect = element.getBoundingClientRect();
        const lower = source.toLowerCase();
        const area = Math.max(1, rect.width * rect.height);
        const sourceBias = lower.includes("_logo") || lower.includes("/logos/") ? 1000 : 0;
        const customBias = lower.includes("/customimages/") || lower.includes("steamgriddb") || lower.includes("sgdb") ? 700 : 0;
        const visibilityBias = rect.width > 1 && rect.height > 1 ? 300 : 0;
        const sizeBias = Math.min(240, area / 100);
        return { source, score: sourceBias + customBias + visibilityBias + sizeBias };
      })
      .filter((candidate): candidate is { source: string; score: number } => Boolean(candidate))
      .sort((left, right) => right.score - left.score);

    return candidates[0]?.source;
  }

  private steamLogoUrl(appId: number): string {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`;
  }

  private async resolveGameLogoSource(appId: number, domSource?: string, isShortcut = false): Promise<string | undefined> {
    let backendSource = "";
    try {
      const result = await resolveGameLogo({ app_id: appId, is_shortcut: isShortcut });
      if (result.ok && result.logo_source) {
        backendSource = result.logo_source;
      }
    } catch (error) {
      console.warn("Launch Curtain backend logo lookup failed", error);
    }

    const sources = [
      backendSource,
      ...(await this.getSteamLogoSources(appId)),
      domSource,
      isShortcut ? undefined : this.steamLogoUrl(appId)
    ];

    const source = sources.find((candidate): candidate is string => Boolean(candidate?.trim()));
    return source ? this.normalizeLogoSource(source) : undefined;
  }

  private async getSteamLogoSources(appId: number): Promise<string[]> {
    const steamWindow = window as unknown as {
      appDetailsStore?: {
        GetAppDetails?: (appId: number) => SteamAppDetailsLike | null;
      };
      appStore?: {
        GetAppOverviewByAppID?: (appId: number) => SteamAppOverviewLike | null;
        GetCustomLogoImageURLs?: (app: SteamAppOverviewLike) => string[];
      };
    };
    const sources: string[] = [];
    const overview = await this.waitForValue(
      () => steamWindow.appStore?.GetAppOverviewByAppID?.(appId) ?? undefined,
      450,
      50
    );

    if (overview) {
      try {
        for (const source of steamWindow.appStore?.GetCustomLogoImageURLs?.(overview) ?? []) {
          this.addLogoSource(sources, source);
        }
      } catch {
        // Steam exposes custom artwork differently across builds.
      }
    }

    try {
      this.addLogoSource(sources, steamWindow.appDetailsStore?.GetAppDetails?.(appId)?.libraryAssets?.strLogoImage);
    } catch {
      // Details may not be hydrated yet.
    }

    return sources;
  }

  private async waitForValue<T>(
    read: () => T | undefined,
    timeoutMs: number,
    intervalMs: number
  ): Promise<T | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const value = read();
      if (value !== undefined) {
        return value;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
    }
    return undefined;
  }

  private addLogoSource(sources: string[], source: string | undefined): void {
    const normalized = source?.trim();
    if (normalized && !sources.includes(normalized)) {
      sources.push(normalized);
    }
  }

  private fallbackLogoUrl(): string {
    return this.toFileUrl(this.logoPath) || this.toFileUrl(this.defaultLogoPath);
  }

  private normalizeLogoSource(source: string): string {
    if (/^https?:\/\//i.test(source) || source.startsWith("file://")) {
      return source;
    }
    return this.toFileUrl(source) || source;
  }

  private trigger(reason: string, appId?: number, logoSource?: string, confirmedLaunch = false, isShortcut = false): void {
    if (!this.enabled) {
      return;
    }

    const now = Date.now();
    if (!confirmedLaunch && !appId) {
      if (now - this.lastTriggerAt >= 900) {
        this.lastTriggerAt = now;
        this.showInstantCurtain(undefined, undefined);
      }
      return;
    }

    const canUpgradeExistingLaunch = Boolean(appId && this.activeInstantAppId !== appId);
    if (!confirmedLaunch && now - this.lastTriggerAt < 900) {
      return;
    }
    if (!confirmedLaunch && now - this.lastTriggerAt < 5000 && !canUpgradeExistingLaunch) {
      return;
    }
    if (confirmedLaunch && now - this.lastTriggerAt < 5000 && !canUpgradeExistingLaunch && this.backendLaunchTimer === undefined) {
      return;
    }

    this.lastTriggerAt = now;
    const effectiveShortcut = isShortcut || Boolean(appId && appId >= 2147483648);
    this.showInstantCurtain(appId, logoSource, effectiveShortcut);
    this.scheduleBackendLaunch(reason, appId, logoSource, 0, effectiveShortcut);
  }

  private scheduleBackendLaunch(reason: string, appId?: number, logoSource?: string, delayMs = 0, isShortcut = false): void {
    this.clearPendingBackendLaunch();
    const token = ++this.backendLaunchToken;

    const run = (resolvedLogoSource?: string): void => {
      if (token !== this.backendLaunchToken) {
        return;
      }
      this.backendLaunchTimer = undefined;
      const request: LaunchRequest = { reason };
      if (appId) {
        request.app_id = appId;
      }
      if (isShortcut) {
        request.is_shortcut = true;
      }
      if (resolvedLogoSource) {
        request.logo_source = resolvedLogoSource;
      }

      void launchRequested(request).catch((error) => {
        console.warn("Launch Curtain play hook failed", error);
      });
    };

    if (appId) {
      const fallbackLogo = logoSource || (isShortcut ? this.fallbackLogoUrl() : this.steamLogoUrl(appId));
      const fallbackDelay = logoSource ? delayMs : Math.max(delayMs, 350);
      this.backendLaunchTimer = window.setTimeout(() => run(fallbackLogo), fallbackDelay);

      void this.resolveGameLogoSource(appId, logoSource, isShortcut).then((resolvedLogoSource) => {
        if (token !== this.backendLaunchToken) {
          return;
        }
        if (resolvedLogoSource) {
          this.updateInstantCurtainLogo(appId, resolvedLogoSource);
        }
        if (this.backendLaunchTimer !== undefined) {
          window.clearTimeout(this.backendLaunchTimer);
          this.backendLaunchTimer = undefined;
        }
        run(resolvedLogoSource || fallbackLogo);
      }).catch((error) => {
        console.warn("Launch Curtain logo lookup failed", error);
      });
      return;
    }

    if (delayMs <= 0) {
      run(logoSource);
      return;
    }

    this.backendLaunchTimer = window.setTimeout(() => run(logoSource), delayMs);
  }

  private clearPendingBackendLaunch(): void {
    if (this.backendLaunchTimer !== undefined) {
      window.clearTimeout(this.backendLaunchTimer);
      this.backendLaunchTimer = undefined;
    }
  }

  private patchSteamClient(): void {
    const apps = window.SteamClient?.Apps;
    if (!apps || apps === this.patchedApps) {
      return;
    }

    this.restoreMethodPatches();
    this.patchedApps = apps;

    [
      "RunGame",
      "RunGameAndWaitForInstaller",
      "RunShortcut"
    ].forEach((methodName) => this.patchSteamMethod(apps, methodName));
  }

  private patchSteamMethod(apps: Record<string, unknown>, methodName: string): void {
    const original = apps[methodName];
    if (typeof original !== "function") {
      return;
    }

    const originalFn = original as (this: unknown, ...args: unknown[]) => unknown;
    const wrapped = function(this: unknown, ...args: unknown[]) {
      const appId = playButtonHook.extractAppIdFromUnknown(args);
      const logoSource = appId ? playButtonHook.findGameLogoSource(appId) : undefined;
      playButtonHook.trigger(`SteamClient.Apps.${methodName}`, appId, logoSource, true, methodName === "RunShortcut");
      return originalFn.apply(this, args);
    };

    try {
      apps[methodName] = wrapped;
      this.methodRestorers.push(() => {
        if (apps[methodName] === wrapped) {
          apps[methodName] = original;
        }
      });
    } catch (error) {
      console.warn(`Launch Curtain could not patch ${methodName}`, error);
    }
  }

  private restoreMethodPatches(): void {
    this.methodRestorers.forEach((restore) => restore());
    this.methodRestorers = [];
  }

  private showInstantCurtain(appId?: number, logoSource?: string, isShortcut = false): void {
    if (this.instantCurtainElement) {
      if (appId && this.activeInstantAppId !== appId) {
        this.updateInstantCurtainLogo(appId, logoSource, isShortcut);
      }
      return;
    }

    const logoUrl = logoSource || (appId && !isShortcut ? this.steamLogoUrl(appId) : this.fallbackLogoUrl());
    const logoMarkup = this.logoMarkup(logoUrl);

    const style = document.createElement("style");
    style.textContent = `
      .launch-curtain-instant {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        color: #fff;
        opacity: 0;
        pointer-events: none;
        transition: opacity 500ms ease;
      }
      .launch-curtain-instant__stack {
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translateY(-1vh);
      }
      .launch-curtain-instant__logo {
        font-family: "Arial Rounded MT Bold", "Segoe UI", Arial, sans-serif;
        font-size: min(9vw, 86px);
        font-weight: 800;
        letter-spacing: 0;
        line-height: 1;
      }
      .launch-curtain-instant__logo-image {
        display: block;
        width: min(42vw, 720px);
        max-height: min(20vh, 180px);
        object-fit: contain;
      }
      .launch-curtain-instant__fallback-logo {
        display: none;
      }
      .launch-curtain-instant__fallback-logo--visible {
        display: block;
      }
      .launch-curtain-instant__fallback-logo-image {
        display: block;
      }
    `;

    const curtain = document.createElement("div");
    curtain.className = "launch-curtain-instant";
    curtain.appendChild(style);
    curtain.innerHTML += `
      <div class="launch-curtain-instant__stack">
        <div class="launch-curtain-instant__logo-slot">
          ${logoMarkup}
        </div>
      </div>
    `;

    document.documentElement.appendChild(curtain);
    this.instantCurtainElement = curtain;
    this.activeInstantAppId = appId;

    this.wireInstantLogoFallback(curtain);

    window.requestAnimationFrame(() => {
      curtain.style.opacity = "1";
    });

    if (this.instantCurtainTimer !== undefined) {
      window.clearTimeout(this.instantCurtainTimer);
    }
    this.instantCurtainExpiresAt = Date.now() + 4200;
    this.instantCurtainTimer = window.setTimeout(() => this.hideInstantCurtain(), 4200);
    this.startGamepadClosePolling();
  }

  private hideExpiredInstantCurtain(): void {
    if (this.instantCurtainExpiresAt > 0 && Date.now() >= this.instantCurtainExpiresAt) {
      this.hideInstantCurtain();
    }
  }

  private hideInstantCurtain(): void {
    if (this.instantCurtainTimer !== undefined) {
      window.clearTimeout(this.instantCurtainTimer);
      this.instantCurtainTimer = undefined;
    }
    this.stopGamepadClosePolling();
    this.instantCurtainExpiresAt = 0;
    this.activeInstantAppId = undefined;

    const curtain = this.instantCurtainElement;
    if (!curtain) {
      return;
    }

    curtain.style.opacity = "0";
    this.instantCurtainElement = undefined;
    window.setTimeout(() => {
      curtain.remove();
    }, 550);
  }

  private updateInstantCurtainLogo(appId: number, logoSource?: string, isShortcut = false): void {
    const curtain = this.instantCurtainElement;
    if (!curtain) {
      return;
    }

    const logoUrl = logoSource || (isShortcut ? this.fallbackLogoUrl() : this.steamLogoUrl(appId));
    const slot = curtain.querySelector<HTMLElement>(".launch-curtain-instant__logo-slot");
    if (!slot || !logoUrl) {
      return;
    }

    slot.innerHTML = this.logoMarkup(logoUrl);
    this.activeInstantAppId = appId;
    this.wireInstantLogoFallback(curtain);
  }

  private logoMarkup(logoUrl: string): string {
    const fallbackLogoUrl = this.fallbackLogoUrl();
    const fallbackMarkup = fallbackLogoUrl
      ? `<img class="launch-curtain-instant__logo-image launch-curtain-instant__fallback-logo-image" src="${this.escapeHtml(fallbackLogoUrl)}" alt="Playhub" />`
      : `<div class="launch-curtain-instant__logo launch-curtain-instant__fallback-logo-text">playhub</div>`;

    return logoUrl
      ? `
        <img class="launch-curtain-instant__logo-image" src="${this.escapeHtml(logoUrl)}" alt="Logo" />
        <div class="launch-curtain-instant__fallback-logo">${fallbackMarkup}</div>
      `
      : `<div class="launch-curtain-instant__fallback-logo launch-curtain-instant__fallback-logo--visible">${fallbackMarkup}</div>`;
  }

  private wireInstantLogoFallback(curtain: HTMLElement): void {
    const logoImage = curtain.querySelector<HTMLImageElement>(".launch-curtain-instant__logo-image");
    const fallbackLogo = curtain.querySelector<HTMLElement>(".launch-curtain-instant__fallback-logo");
    if (logoImage && fallbackLogo) {
      logoImage.addEventListener("error", () => {
        logoImage.remove();
        fallbackLogo.style.display = "block";
      }, { once: true });
    }
  }

  private startGamepadClosePolling(): void {
    this.stopGamepadClosePolling();
    this.gamepadClosePressed = false;

    const poll = (): void => {
      if (!this.instantCurtainElement) {
        this.stopGamepadClosePolling();
        return;
      }

      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const closePressed = pads.some((pad) => {
        if (!pad) {
          return false;
        }
        return Boolean(pad.buttons[1]?.pressed || pad.buttons[0]?.pressed);
      });

      if (closePressed && !this.gamepadClosePressed) {
        this.requestCloseAllCurtains();
        return;
      }

      this.gamepadClosePressed = closePressed;
      this.gamepadCloseFrame = window.requestAnimationFrame(poll);
    };

    this.gamepadCloseFrame = window.requestAnimationFrame(poll);
  }

  private stopGamepadClosePolling(): void {
    if (this.gamepadCloseFrame !== undefined) {
      window.cancelAnimationFrame(this.gamepadCloseFrame);
      this.gamepadCloseFrame = undefined;
    }
    this.gamepadClosePressed = false;
  }

  private requestCloseAllCurtains(): void {
    this.hideInstantCurtain();
    void hideCurtain().catch((error) => {
      console.warn("Launch Curtain gamepad close failed", error);
    });
  }

  private toFileUrl(path: string): string {
    if (!path.trim()) {
      return "";
    }

    const normalized = path.replace(/\\/g, "/");
    const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return `file://${encodeURI(prefixed)}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

const playButtonHook = new PlayButtonLaunchHook();

const rowTextStyle = {
  fontSize: "12px",
  lineHeight: "16px",
  color: "var(--decky-text-color-secondary, #b8c0cc)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const
};

function notify(result: ActionResult, strings: I18n): void {
  toaster.toast({
    title: result.ok ? strings.toastTitle : strings.toastAttention,
    body: result.message
  });
}

function Content() {
  const strings = getStrings();
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const nextStatus = await getStatus();
    setStatus(nextStatus);
  };

  useEffect(() => {
    let mounted = true;

    const load = async (): Promise<void> => {
      const [nextSettings, nextStatus] = await Promise.all([getSettings(), getStatus()]);
      if (mounted) {
        playButtonHook.setLogoPath(nextSettings.custom_logo_path ?? "");
        playButtonHook.setDefaultLogoPath(nextSettings.default_logo_path ?? "");
        setSettings(nextSettings);
        setStatus(nextStatus);
      }
    };

    load();
    const timer = window.setInterval(() => {
      refresh();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const setAutoMode = async (checked: boolean): Promise<void> => {
    if (!settings) {
      return;
    }

    setBusy(true);
    try {
      const result = checked ? await startAutoMode() : await stopAutoMode();
      notify(result, strings);
      const [nextSettings, nextStatus] = await Promise.all([getSettings(), getStatus()]);
      playButtonHook.setEnabled(Boolean(nextSettings.auto_mode));
      playButtonHook.setLogoPath(nextSettings.custom_logo_path ?? "");
      playButtonHook.setDefaultLogoPath(nextSettings.default_logo_path ?? "");
      setSettings(nextSettings);
      setStatus(nextStatus);
    } finally {
      setBusy(false);
    }
  };

  const setTimeoutValue = async (seconds: number): Promise<void> => {
    if (!settings) {
      return;
    }

    const nextSettings = await saveSettings({
      curtain_timeout: seconds,
      launch_curtain_max_seconds: seconds
    });
    playButtonHook.setLogoPath(nextSettings.custom_logo_path ?? "");
    playButtonHook.setDefaultLogoPath(nextSettings.default_logo_path ?? "");
    setSettings(nextSettings);
    await refresh();
  };

  const chooseLogo = async (): Promise<void> => {
    if (!settings) {
      return;
    }

    setBusy(true);
    try {
      const picked = await openFilePicker(
        FILE_SELECTION_FILE,
        settings.custom_logo_path || "C:\\",
        true,
        false,
        undefined,
        ["png", "jpg", "jpeg", "webp", "bmp"],
        false,
        true
      );
      const logoPath = picked.realpath || picked.path;
      const nextSettings = await saveSettings({ custom_logo_path: logoPath });
      playButtonHook.setLogoPath(nextSettings.custom_logo_path ?? "");
      playButtonHook.setDefaultLogoPath(nextSettings.default_logo_path ?? "");
      setSettings(nextSettings);
      await refresh();
    } catch (error) {
      console.warn("Launch Curtain logo picker failed", error);
      toaster.toast({
        title: strings.toastAttention,
        body: strings.logoPickerError
      });
    } finally {
      setBusy(false);
    }
  };

  const useDefaultLogo = async (): Promise<void> => {
    if (!settings) {
      return;
    }

    setBusy(true);
    try {
      const nextSettings = await saveSettings({ custom_logo_path: "" });
      playButtonHook.setLogoPath("");
      playButtonHook.setDefaultLogoPath(nextSettings.default_logo_path ?? "");
      setSettings(nextSettings);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const timeoutOptions = Array.from({ length: 12 }, (_item, index) => (index + 1) * 5).map((seconds) => ({
    data: seconds,
    label: `${seconds} s`
  }));
  const selectedTimeout = timeoutOptions.some((option) => option.data === settings?.curtain_timeout)
    ? settings?.curtain_timeout
    : 15;

  return (
    <>
      <PanelSection title={strings.automation}>
        <PanelSectionRow>
          <ToggleField
            label={strings.autoLaunchCurtain}
            checked={Boolean(settings?.auto_mode)}
            disabled={busy || !status?.is_windows}
            onChange={(checked) => {
              void setAutoMode(checked);
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ ...rowTextStyle, whiteSpace: "normal" }}>
            {strings.timeoutHelp ?? I18N.en.timeoutHelp ?? "How long the launch screen can stay visible while waiting for the game to become fullscreen."}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label={strings.timeout}
            rgOptions={timeoutOptions}
            selectedOption={selectedTimeout}
            disabled={busy || !settings}
            onChange={(option) => {
              if (typeof option.data === "number") {
                void setTimeoutValue(option.data);
              }
            }}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={strings.logo}>
        <PanelSectionRow>
          <div style={rowTextStyle}>
            {settings?.custom_logo_path ? `${strings.customLogo}: ${settings.custom_logo_path}` : strings.defaultLogo}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !settings}
            onClick={() => {
              void chooseLogo();
            }}
          >
            {strings.chooseLogo}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !settings || !settings.custom_logo_path}
            onClick={() => {
              void useDefaultLogo();
            }}
          >
            {strings.useDefaultLogo}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  playButtonHook.setup();
  void getSettings().then((settings) => {
    playButtonHook.setEnabled(Boolean(settings.auto_mode));
    playButtonHook.setLogoPath(settings.custom_logo_path ?? "");
    playButtonHook.setDefaultLogoPath(settings.default_logo_path ?? "");
  }).catch((error) => {
    console.warn("Launch Curtain could not load initial settings", error);
  });

  return {
    name: "Launch Curtain",
    titleView: <div className={staticClasses.Title}>Launch Curtain</div>,
    content: <Content />,
    icon: <FaTheaterMasks />,
    alwaysRender: true,
    onDismount() {
      playButtonHook.cleanup();
      console.log("Launch Curtain unloaded");
    }
  };
});
