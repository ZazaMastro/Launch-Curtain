import {
  ButtonItem,
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

const getSettings = callable<[], Settings>("get_settings");
const saveSettings = callable<[settings: Partial<Settings>], Settings>("save_settings");
const getStatus = callable<[], Status>("get_status");
const showCurtain = callable<[], ActionResult>("show_curtain");
const hideCurtain = callable<[], ActionResult>("hide_curtain");
const focusSteam = callable<[], ActionResult>("focus_steam");
const launchRequested = callable<[reason?: string], ActionResult>("launch_requested");
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
  seconds25: string;
  seconds45: string;
  seconds75: string;
  toastTitle: string;
  toastAttention: string;
};

const I18N: Record<string, I18n> = {
  en: {
    curtain: "Curtain",
    automation: "Automation",
    timeout: "Timeout",
    foreground: "Foreground",
    showCurtain: "Show curtain",
    hideCurtain: "Hide curtain",
    focusSteam: "Focus Steam",
    autoLaunchCurtain: "Auto launch curtain",
    windowsOnly: "Windows-only backend. This system is not Windows.",
    noForeground: "No foreground window detected",
    logo: "Logo",
    chooseLogo: "Choose custom logo",
    useDefaultLogo: "Use default logo",
    defaultLogo: "Default Playhub logo",
    customLogo: "Custom logo",
    logoPickerError: "Could not choose a logo.",
    seconds25: "25 seconds",
    seconds45: "45 seconds",
    seconds75: "75 seconds",
    toastTitle: "Launch Curtain",
    toastAttention: "Launch Curtain needs attention"
  },
  it: {
    curtain: "Schermata",
    automation: "Automazione",
    timeout: "Timeout",
    foreground: "Finestra attiva",
    showCurtain: "Mostra schermata",
    hideCurtain: "Nascondi schermata",
    focusSteam: "Riporta Steam davanti",
    autoLaunchCurtain: "Schermata automatica all'avvio",
    windowsOnly: "Backend solo per Windows. Questo sistema non e Windows.",
    noForeground: "Nessuna finestra attiva rilevata",
    logo: "Logo",
    chooseLogo: "Scegli logo custom",
    useDefaultLogo: "Usa logo predefinito",
    defaultLogo: "Logo Playhub predefinito",
    customLogo: "Logo custom",
    logoPickerError: "Non sono riuscito a scegliere un logo.",
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
  private logoPath = "";

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
    this.patchedApps = undefined;
    this.setupDone = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setLogoPath(path: string): void {
    this.logoPath = path;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.isPlayButtonEvent(event.target, event.composedPath())) {
      this.trigger("play button pointerdown");
    }
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.isPlayButtonEvent(event.target, event.composedPath())) {
      this.trigger("play button click");
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!["Enter", " "].includes(event.key)) {
      return;
    }

    if (this.isPlayButtonEvent(document.activeElement, [])) {
      this.trigger("play button keydown");
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

  private trigger(reason: string): void {
    if (!this.enabled) {
      return;
    }

    const now = Date.now();
    if (now - this.lastTriggerAt < 5000) {
      return;
    }

    this.lastTriggerAt = now;
    this.showInstantCurtain();
    window.setTimeout(() => {
      void launchRequested(reason).catch((error) => {
        console.warn("Launch Curtain play hook failed", error);
      });
    }, 120);
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
      playButtonHook.trigger(`SteamClient.Apps.${methodName}`);
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

  private showInstantCurtain(): void {
    if (this.instantCurtainElement) {
      return;
    }

    const logoUrl = this.toFileUrl(this.logoPath);
    const logoMarkup = logoUrl
      ? `<img class="launch-curtain-instant__logo-image" src="${this.escapeHtml(logoUrl)}" alt="Logo" />`
      : `<div class="launch-curtain-instant__logo">playhub</div>`;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes launch-curtain-dot {
        0%, 60%, 100% { opacity: 0.36; filter: none; transform: scale(1); }
        18% { opacity: 1; filter: drop-shadow(0 0 18px rgba(252, 204, 1, 0.72)); transform: scale(1.08); }
      }
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
      .launch-curtain-instant__dots {
        display: flex;
        gap: 22px;
        margin-top: 78px;
      }
      .launch-curtain-instant__dot {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: #fccc01;
        opacity: 0.36;
        animation: launch-curtain-dot 1.15s ease-in-out infinite;
      }
      .launch-curtain-instant__dot:nth-child(2) { animation-delay: 140ms; }
      .launch-curtain-instant__dot:nth-child(3) { animation-delay: 280ms; }
    `;

    const curtain = document.createElement("div");
    curtain.className = "launch-curtain-instant";
    curtain.appendChild(style);
    curtain.innerHTML += `
      <div class="launch-curtain-instant__stack">
        ${logoMarkup}
        <div class="launch-curtain-instant__dots">
          <div class="launch-curtain-instant__dot"></div>
          <div class="launch-curtain-instant__dot"></div>
          <div class="launch-curtain-instant__dot"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(curtain);
    this.instantCurtainElement = curtain;
    window.requestAnimationFrame(() => {
      curtain.style.opacity = "1";
    });

    if (this.instantCurtainTimer !== undefined) {
      window.clearTimeout(this.instantCurtainTimer);
    }
    this.instantCurtainExpiresAt = Date.now() + 4200;
    this.instantCurtainTimer = window.setTimeout(() => this.hideInstantCurtain(), 4200);
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
    this.instantCurtainExpiresAt = 0;

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

  const runAction = async (action: () => Promise<ActionResult>): Promise<void> => {
    setBusy(true);
    try {
      const result = await action();
      notify(result, strings);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

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

    const nextSettings = await saveSettings({ curtain_timeout: seconds });
    playButtonHook.setLogoPath(nextSettings.custom_logo_path ?? "");
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
      setSettings(nextSettings);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const foreground = status?.foreground;
  const foregroundLabel = foreground?.process
    ? `${foreground.process}${foreground.title ? ` - ${foreground.title}` : ""}`
    : strings.noForeground;

  return (
    <>
      <PanelSection title={strings.curtain}>
        <PanelSectionRow>
          <div style={rowTextStyle}>
            {status?.is_windows ? foregroundLabel : strings.windowsOnly}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !status?.is_windows}
            onClick={() => runAction(status?.curtain_running ? hideCurtain : showCurtain)}
          >
            {status?.curtain_running ? strings.hideCurtain : strings.showCurtain}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !status?.is_windows}
            onClick={() => runAction(focusSteam)}
          >
            {strings.focusSteam}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

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

      <PanelSection title={strings.timeout}>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !settings}
            onClick={() => setTimeoutValue(25)}
          >
            {strings.seconds25}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !settings}
            onClick={() => setTimeoutValue(45)}
          >
            {strings.seconds45}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !settings}
            onClick={() => setTimeoutValue(75)}
          >
            {strings.seconds75}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={strings.foreground}>
        {(status?.visible_windows ?? []).slice(0, 5).map((windowInfo) => (
          <PanelSectionRow key={`${windowInfo.hwnd}-${windowInfo.pid}`}>
            <div style={rowTextStyle}>
              {windowInfo.process || "unknown"} - {windowInfo.title}
            </div>
          </PanelSectionRow>
        ))}
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  playButtonHook.setup();
  void getSettings().then((settings) => {
    playButtonHook.setEnabled(Boolean(settings.auto_mode));
    playButtonHook.setLogoPath(settings.custom_logo_path ?? "");
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
