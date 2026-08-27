"use client";

import { Terminal } from "@xterm/xterm";
import {
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  TerminalAdapter,
  TerminalConnectionState,
  TerminalViewport,
} from "../terminal/adapter";
import { MockTerminalAdapter } from "../terminal/mockTerminalAdapter";
import {
  ProtocolTerminalAdapter,
  type ProtocolTerminalAdapterConfig,
} from "../terminal/protocolTerminalAdapter";

type Language = "en" | "sv";
type AccentKey = "violet" | "cyan" | "rose" | "emerald";
type GlowKey = "low" | "medium" | "high";
type FontSizeKey = "small" | "medium" | "large";

const ACCENTS: Record<
  AccentKey,
  { primary: string; secondary: string; label: Record<Language, string> }
> = {
  violet: {
    primary: "#a855f7",
    secondary: "#7c3aed",
    label: { en: "Violet", sv: "Violett" },
  },
  cyan: {
    primary: "#22d3ee",
    secondary: "#0891b2",
    label: { en: "Cyan", sv: "Cyan" },
  },
  rose: {
    primary: "#f43f5e",
    secondary: "#be123c",
    label: { en: "Rose", sv: "Rosa" },
  },
  emerald: {
    primary: "#10b981",
    secondary: "#065f46",
    label: { en: "Emerald", sv: "Smaragd" },
  },
};

const FONT_SIZES: Record<FontSizeKey, number> = {
  small: 12,
  medium: 14,
  large: 16,
};

const GLOW_ALPHA: Record<GlowKey, number> = {
  low: 0.1,
  medium: 0.22,
  high: 0.42,
};

const TRANSLATIONS = {
  en: {
    brand: "Terminus",
    brandSub: "PRIVATE TERMINAL",
    workspace: "Terminal workspace",
    protocol: "PRIVATE WSS · PROTOCOL 0.1",
    secure: "mTLS · PRIVATE",
    personalPrototype: "Personal prototype",
    status: {
      disconnected: "Disconnected",
      connecting: "Connecting…",
      pairing: "Pairing",
      authenticating: "Authenticating…",
      opening: "Opening session…",
      connected: "Connected",
      detaching: "Detaching…",
      detached: "Detached",
      reconnecting: "Reconnecting…",
      closing: "Closing…",
      error: "Error",
    } satisfies Record<TerminalConnectionState, string>,
    connectPrivate: "Connect privately",
    startSimulation: "Start simulation",
    reconnect: "Reconnect",
    retryPrivate: "Retry private connection",
    retrySimulation: "Retry simulation",
    disconnect: "Disconnect",
    detach: "Detach",
    cancel: "Cancel",
    notConnected: "NOT CONNECTED",
    notConnectedSub: "Connect to start a private PowerShell session",
    settings: "Configuration",
    accent: "Accent",
    fontSize: "Font size",
    glow: "Glow",
    low: "Low",
    medium: "Medium",
    high: "High",
    small: "Small",
    large: "Large",
    activeSession: "ACTIVE SESSION",
    controls: "Terminal controls",
    switchLanguage: "Switch to Swedish",
    pairingCode: "One-time pairing code",
    pairingHelp:
      "Confirm this browser locally on the Windows agent. The code is never stored.",
    pairLocally: "Pair locally",
    pairingPlaceholder: "Enter the 22-character code",
    terminalInput: "Terminal input",
    simulationInput: "Simulation input",
    send: "Send",
    sendPrivatePlaceholder: "Send input directly to the private agent",
    sendSimulationPlaceholder: "Input is acknowledged, never executed",
    disconnectedPrivatePlaceholder: "Private terminal is disconnected",
    disconnectedSimulationPlaceholder: "Simulation is disconnected",
    noConnection:
      "No agent, shell, protocol, or network destination is connected.",
    simulationHint: "Start the local simulation to exercise the interface.",
    viewport: "Terminal viewport information",
    portrait: "portrait",
    landscape: "landscape",
    sendKey: (key: string) => `Send ${key}`,
    sessionLimit:
      "A new PowerShell session could not open. If eight sessions are already active, close an earlier Terminus tab or disconnect one session, then retry.",
    terminalOutput: "Private terminal output",
    simulatedOutput: "Simulated terminal output",
    privateTraffic:
      "Terminal traffic connects directly to the configured private agent.",
    simulatedTraffic:
      "Terminal traffic is not routed through this web scaffold.",
    keyNames: {
      escape: "Escape",
      tab: "Tab",
      controlC: "Control C",
      home: "Home",
      end: "End",
      up: "Arrow up",
      down: "Arrow down",
      left: "Arrow left",
      right: "Arrow right",
      enter: "Enter",
      delete: "Delete",
      clear: "Clear screen",
    },
  },
  sv: {
    brand: "Terminus",
    brandSub: "PRIVAT TERMINAL",
    workspace: "Terminalarbetsyta",
    protocol: "PRIVAT WSS · PROTOKOLL 0.1",
    secure: "mTLS · PRIVAT",
    personalPrototype: "Personlig prototyp",
    status: {
      disconnected: "Frånkopplad",
      connecting: "Ansluter…",
      pairing: "Parkopplar",
      authenticating: "Autentiserar…",
      opening: "Öppnar session…",
      connected: "Ansluten",
      detaching: "Kopplar från…",
      detached: "Frånkopplad",
      reconnecting: "Återansluter…",
      closing: "Stänger…",
      error: "Fel",
    } satisfies Record<TerminalConnectionState, string>,
    connectPrivate: "Anslut privat",
    startSimulation: "Starta simulering",
    reconnect: "Återanslut",
    retryPrivate: "Försök ansluta privat igen",
    retrySimulation: "Försök simuleringen igen",
    disconnect: "Koppla från",
    detach: "Lämna sessionen",
    cancel: "Avbryt",
    notConnected: "EJ ANSLUTEN",
    notConnectedSub: "Anslut för att starta en privat PowerShell-session",
    settings: "Konfiguration",
    accent: "Accent",
    fontSize: "Textstorlek",
    glow: "Glöd",
    low: "Låg",
    medium: "Mellan",
    high: "Hög",
    small: "Liten",
    large: "Stor",
    activeSession: "AKTIV SESSION",
    controls: "Terminalkontroller",
    switchLanguage: "Byt till engelska",
    pairingCode: "Engångskod för parkoppling",
    pairingHelp:
      "Bekräfta webbläsaren lokalt i Windows-agenten. Koden sparas aldrig.",
    pairLocally: "Parkoppla lokalt",
    pairingPlaceholder: "Ange koden med 22 tecken",
    terminalInput: "Terminalinmatning",
    simulationInput: "Simulerad inmatning",
    send: "Skicka",
    sendPrivatePlaceholder: "Skicka inmatning direkt till den privata agenten",
    sendSimulationPlaceholder: "Inmatningen bekräftas men körs aldrig",
    disconnectedPrivatePlaceholder: "Den privata terminalen är frånkopplad",
    disconnectedSimulationPlaceholder: "Simuleringen är frånkopplad",
    noConnection:
      "Ingen agent, terminal, protokoll- eller nätverksdestination är ansluten.",
    simulationHint:
      "Starta den lokala simuleringen för att prova gränssnittet.",
    viewport: "Information om terminalens visningsyta",
    portrait: "stående",
    landscape: "liggande",
    sendKey: (key: string) => `Skicka ${key}`,
    sessionLimit:
      "En ny PowerShell-session kunde inte öppnas. Om åtta sessioner redan är aktiva, stäng en tidigare Terminus-flik eller koppla från en session och försök igen.",
    terminalOutput: "Privat terminalutdata",
    simulatedOutput: "Simulerad terminalutdata",
    privateTraffic:
      "Terminaltrafiken ansluter direkt till den konfigurerade privata agenten.",
    simulatedTraffic: "Terminaltrafiken dirigeras inte genom denna webbklient.",
    keyNames: {
      escape: "Escape",
      tab: "Tabb",
      controlC: "Control C",
      home: "Hem",
      end: "Slut",
      up: "Pil upp",
      down: "Pil ned",
      left: "Pil vänster",
      right: "Pil höger",
      enter: "Enter",
      delete: "Radera",
      clear: "Rensa skärmen",
    },
  },
} as const;

const QUICK_KEYS = [
  { id: "escape", label: "ESC", value: "\u001b" },
  { id: "tab", label: "TAB", value: "\t" },
  { id: "controlC", label: "CTRL+C", value: "\u0003" },
  { id: "home", label: "HOME", value: "\u001b[H" },
  { id: "end", label: "END", value: "\u001b[F" },
] as const;

const MIN_COLUMNS = 20;
const MIN_ROWS = 8;
const BACKGROUND_DETACH_DELAY_MS = 0;
const FOREGROUND_RECONNECT_DELAY_MS = 500;

function measureViewport(element: HTMLElement): TerminalViewport {
  const rect = element.getBoundingClientRect();
  return {
    columns: Math.max(MIN_COLUMNS, Math.floor(rect.width / 9)),
    rows: Math.max(MIN_ROWS, Math.floor(rect.height / 20)),
  };
}

function EnglishFlag() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 60 40">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" strokeWidth="5" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="12" />
      <path d="M30,0 V40 M0,20 H60" stroke="#c8102e" strokeWidth="7" />
    </svg>
  );
}

function SwedishFlag() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 60 40">
      <rect width="60" height="40" fill="#006aa7" />
      <rect x="15" width="9" height="40" fill="#fecc02" />
      <rect y="15.5" width="60" height="9" fill="#fecc02" />
    </svg>
  );
}

function LayerIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export interface TerminalShellProps {
  adapterFactory?: () => TerminalAdapter;
  protocolConfig?: Pick<
    ProtocolTerminalAdapterConfig,
    "endpoint" | "expectedWebOrigin"
  >;
}

export function TerminalShell({
  adapterFactory,
  protocolConfig,
}: TerminalShellProps) {
  const [adapter] = useState<TerminalAdapter>(() =>
    adapterFactory !== undefined
      ? adapterFactory()
      : protocolConfig !== undefined
        ? new ProtocolTerminalAdapter(protocolConfig)
        : new MockTerminalAdapter(),
  );
  const protocolClient = adapter.kind === "protocol-client";
  const [connectionState, setConnectionState] = useState(adapter.getState());
  const [markers, setMarkers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accent, setAccent] = useState<AccentKey>("violet");
  const [glow, setGlow] = useState<GlowKey>("medium");
  const [fontSize, setFontSize] = useState<FontSizeKey>("medium");
  const [viewport, setViewport] = useState<TerminalViewport>({
    columns: MIN_COLUMNS,
    rows: MIN_ROWS,
  });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "landscape",
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const connectedRef = useRef(connectionState === "connected");
  const t = TRANSLATIONS[language];
  const scheme = ACCENTS[accent];
  const connected = connectionState === "connected";
  const busy = [
    "connecting",
    "authenticating",
    "opening",
    "reconnecting",
    "detaching",
    "closing",
  ].includes(connectionState);
  const errorCode = adapter.getErrorCode?.();
  const themeStyle = {
    "--accent": scheme.primary,
    "--accent-secondary": scheme.secondary,
    "--accent-glow": `color-mix(in srgb, ${scheme.primary} ${Math.round(GLOW_ALPHA[glow] * 100)}%, transparent)`,
  } as CSSProperties;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!protocolClient || terminalRef.current === null) return;
    const terminal = new Terminal({
      cols: MIN_COLUMNS,
      rows: MIN_ROWS,
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
      fontSize: FONT_SIZES.medium,
      scrollback: 5000,
      theme: {
        background: "#06060a",
        cursor: ACCENTS.violet.primary,
        foreground: "#cbd5e1",
        selectionBackground: "#4c1d6f",
      },
    });
    terminal.open(terminalRef.current);
    const inputSubscription = terminal.onData((data) => {
      if (connectedRef.current) adapter.sendInput(data);
    });
    xtermRef.current = terminal;
    for (const output of pendingOutputRef.current) terminal.write(output);
    pendingOutputRef.current = [];
    return () => {
      xtermRef.current = null;
      pendingOutputRef.current = [];
      inputSubscription.dispose();
      terminal.dispose();
    };
  }, [adapter, protocolClient]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (terminal === null) return;
    terminal.options.fontSize = FONT_SIZES[fontSize];
    terminal.options.theme = {
      background: "#06060a",
      cursor: scheme.primary,
      foreground: "#cbd5e1",
      selectionBackground: `${scheme.secondary}88`,
    };
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [fontSize, scheme.primary, scheme.secondary]);

  useEffect(() => {
    const unsubscribeState = adapter.subscribe(setConnectionState);
    const unsubscribeOutput = adapter.subscribeOutput((output) => {
      if (protocolClient) {
        const terminal = xtermRef.current;
        if (terminal === null) pendingOutputRef.current.push(output);
        else terminal.write(output);
        return;
      }
      setMarkers((current) => [...current.slice(-4), output]);
    });
    return () => {
      unsubscribeState();
      unsubscribeOutput();
      void adapter.disconnect();
    };
  }, [adapter, protocolClient]);

  useEffect(() => {
    if (adapter.kind !== "protocol-client" || adapter.detach === undefined)
      return;
    const detach = adapter.detach.bind(adapter);
    let detachTimer: ReturnType<typeof setTimeout> | undefined;
    let foregroundReconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let foregroundReconnectPending = false;
    let pageIsHiding = false;
    const cancelPendingDetach = () => {
      if (detachTimer !== undefined) clearTimeout(detachTimer);
      detachTimer = undefined;
    };
    const cancelPendingReconnect = () => {
      if (foregroundReconnectTimer !== undefined)
        clearTimeout(foregroundReconnectTimer);
      foregroundReconnectTimer = undefined;
    };
    const scheduleForegroundReconnect = () => {
      if (
        !foregroundReconnectPending ||
        document.visibilityState !== "visible" ||
        foregroundReconnectTimer !== undefined
      )
        return;
      const state = adapter.getState();
      if (state === "connected") {
        foregroundReconnectPending = false;
        return;
      }
      if (state !== "detached" && state !== "error") return;
      foregroundReconnectTimer = setTimeout(() => {
        foregroundReconnectTimer = undefined;
        if (
          foregroundReconnectPending &&
          document.visibilityState === "visible" &&
          ["detached", "error"].includes(adapter.getState())
        ) {
          foregroundReconnectPending = false;
          void adapter.connect();
        }
      }, FOREGROUND_RECONNECT_DELAY_MS);
    };
    const pageHiding = (event: PageTransitionEvent) => {
      pageIsHiding = true;
      foregroundReconnectPending = false;
      cancelPendingDetach();
      cancelPendingReconnect();
      // Safari may freeze a background page before even a short timer runs.
      // A persisted pagehide keeps this document alive, so detach now and
      // retain the memory-only resume grant for pageshow. A real reload/close
      // remains undetached so transport teardown releases server capacity.
      if (event.persisted && adapter.getState() === "connected") void detach();
    };
    const pageShowing = (event: PageTransitionEvent) => {
      pageIsHiding = false;
      if (event.persisted) {
        foregroundReconnectPending = true;
        scheduleForegroundReconnect();
      }
    };
    const visibilityChanged = () => {
      if (
        document.visibilityState === "hidden" &&
        adapter.getState() === "connected"
      ) {
        foregroundReconnectPending = false;
        cancelPendingReconnect();
        cancelPendingDetach();
        detachTimer = setTimeout(() => {
          detachTimer = undefined;
          if (
            !pageIsHiding &&
            document.visibilityState === "hidden" &&
            adapter.getState() === "connected"
          )
            void detach();
        }, BACKGROUND_DETACH_DELAY_MS);
      } else if (document.visibilityState === "visible") {
        pageIsHiding = false;
        cancelPendingDetach();
        foregroundReconnectPending = true;
        scheduleForegroundReconnect();
      }
    };
    const unsubscribeReconnectState = adapter.subscribe((state) => {
      if (state === "connected") {
        foregroundReconnectPending = false;
        cancelPendingReconnect();
        return;
      }
      scheduleForegroundReconnect();
    });
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHiding);
    window.addEventListener("pageshow", pageShowing);
    return () => {
      cancelPendingDetach();
      cancelPendingReconnect();
      unsubscribeReconnectState();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHiding);
      window.removeEventListener("pageshow", pageShowing);
    };
  }, [adapter]);

  useEffect(() => {
    connectedRef.current = connectionState === "connected";
    if (connectionState === "connected") {
      if (protocolClient) xtermRef.current?.focus();
      else inputRef.current?.focus();
    }
  }, [connectionState, protocolClient]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextViewport = measureViewport(terminal);
        setViewport(nextViewport);
        setOrientation(
          window.innerWidth <= window.innerHeight ? "portrait" : "landscape",
        );
        xtermRef.current?.resize(nextViewport.columns, nextViewport.rows);
        adapter.resize(nextViewport);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(terminal);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [adapter]);

  const send = useCallback(
    (value: string) => {
      if (connectionState !== "connected" || value.length === 0) return;
      adapter.sendInput(value);
    },
    [adapter, connectionState],
  );

  const connect = async () => {
    try {
      await adapter.connect();
    } catch {
      setConnectionState("error");
    }
  };

  const pair = async (event: FormEvent) => {
    event.preventDefault();
    if (adapter.pair === undefined || pairingCode.length === 0) return;
    const transientCode = pairingCode;
    setPairingCode("");
    try {
      await adapter.pair(transientCode);
    } catch {
      setConnectionState("error");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
    setInput("");
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    send(event.clipboardData.getData("text"));
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  };

  const connectLabel =
    connectionState === "detached"
      ? t.reconnect
      : connectionState === "error"
        ? protocolClient
          ? t.retryPrivate
          : t.retrySimulation
        : protocolClient
          ? t.connectPrivate
          : t.startSimulation;

  return (
    <main className="terminusApp" style={themeStyle}>
      <div className="ambientGlow" aria-hidden="true" />
      <div className="ambientGrid" aria-hidden="true" />

      <header className="neuralHeader">
        <div className="brandLockup">
          <span className="brandIcon">
            <LayerIcon />
          </span>
          <span>
            <span className="brandKicker">{t.brandSub}</span>
            <span className="brandName">{t.brand}</span>
          </span>
        </div>

        <div className="headerActions">
          <button
            className="languageSwitch"
            type="button"
            aria-label={t.switchLanguage}
            title={t.switchLanguage}
            onClick={() =>
              setLanguage((current) => (current === "en" ? "sv" : "en"))
            }
          >
            {language === "en" ? <EnglishFlag /> : <SwedishFlag />}
            <span>{language.toUpperCase()}</span>
            <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10">
              <path
                d="M2 4 5 1l3 3M2 6l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </button>

          <p
            className={`statusPill status-${connectionState}`}
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true" />
            {t.status[connectionState]}
          </p>

          {connected ? (
            <button
              className="disconnectButton"
              type="button"
              onClick={() => void adapter.disconnect()}
            >
              {t.disconnect}
            </button>
          ) : connectionState === "pairing" ? (
            <button
              className="secondaryButton compactButton"
              type="button"
              onClick={() => void adapter.disconnect()}
            >
              {t.cancel}
            </button>
          ) : (
            <button
              className="primaryButton compactButton"
              type="button"
              disabled={busy}
              onClick={() => void connect()}
            >
              {connectLabel}
            </button>
          )}

          <button
            className={`settingsButton${settingsOpen ? " isActive" : ""}`}
            type="button"
            aria-label={t.settings}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <section className="settingsPanel" aria-label={t.settings}>
          <p className="settingsTitle">◈ {t.settings}</p>
          <div className="settingsGroups">
            <SettingsGroup label={t.accent}>
              {(Object.keys(ACCENTS) as AccentKey[]).map((key) => (
                <button
                  key={key}
                  className={`settingsChip${accent === key ? " isActive" : ""}`}
                  style={
                    { "--chip-color": ACCENTS[key].primary } as CSSProperties
                  }
                  type="button"
                  aria-pressed={accent === key}
                  onClick={() => setAccent(key)}
                >
                  {ACCENTS[key].label[language]}
                </button>
              ))}
            </SettingsGroup>
            <SettingsGroup label={t.fontSize}>
              {(Object.keys(FONT_SIZES) as FontSizeKey[]).map((key) => (
                <button
                  key={key}
                  className={`settingsChip${fontSize === key ? " isActive" : ""}`}
                  type="button"
                  aria-pressed={fontSize === key}
                  onClick={() => setFontSize(key)}
                >
                  {key === "small"
                    ? t.small
                    : key === "large"
                      ? t.large
                      : t.medium}
                </button>
              ))}
            </SettingsGroup>
            <SettingsGroup label={t.glow}>
              {(Object.keys(GLOW_ALPHA) as GlowKey[]).map((key) => (
                <button
                  key={key}
                  className={`settingsChip${glow === key ? " isActive" : ""}`}
                  type="button"
                  aria-pressed={glow === key}
                  onClick={() => setGlow(key)}
                >
                  {key === "low" ? t.low : key === "high" ? t.high : t.medium}
                </button>
              ))}
            </SettingsGroup>
          </div>
        </section>
      )}

      <section className="workspaceBar" aria-labelledby="terminal-heading">
        <div>
          <h1 id="terminal-heading">{t.workspace}</h1>
          <p className="workspaceConnectionLine">
            <span>{t.protocol}</span>
            <span aria-hidden="true">·</span>
            <span>{adapter.label}</span>
          </p>
        </div>
        <div className="workspaceMeta">
          {connected && protocolClient && (
            <span className="secureLabel">{t.secure}</span>
          )}
          <span>{t.personalPrototype}</span>
        </div>
      </section>

      {connectionState === "error" && errorCode === "SESSION_OPEN_FAILED" && (
        <p className="sessionOpenGuidance" role="alert">
          {t.sessionLimit}
        </p>
      )}

      <section className="terminalLayout">
        <div className="terminalRegion">
          <div
            ref={terminalRef}
            className="terminalViewport"
            role="log"
            aria-label={protocolClient ? t.terminalOutput : t.simulatedOutput}
            aria-live="polite"
            data-columns={viewport.columns}
            data-rows={viewport.rows}
            tabIndex={0}
            onClick={() => {
              if (protocolClient) xtermRef.current?.focus();
              else inputRef.current?.focus();
            }}
          >
            {!protocolClient && (
              <p className="safetyNotice">{t.noConnection}</p>
            )}
            {!protocolClient &&
              markers.map((marker, index) => (
                <p className="marker" key={`${marker}-${index}`}>
                  {marker}
                </p>
              ))}
            {!connected && !protocolClient && (
              <p className="terminalHint">{t.simulationHint}</p>
            )}
          </div>

          {!connected && markers.length === 0 && (
            <div className="terminalEmptyState" aria-hidden="true">
              <MonitorIcon />
              <strong>{t.notConnected}</strong>
              <span>{t.notConnectedSub}</span>
            </div>
          )}

          {connectionState === "pairing" && adapter.pair !== undefined && (
            <form className="pairingForm" onSubmit={pair}>
              <div className="pairingHeading">
                <span className="pairingSymbol">◈</span>
                <div>
                  <label htmlFor="pairing-code">{t.pairingCode}</label>
                  <p>{t.pairingHelp}</p>
                </div>
              </div>
              <div className="pairingActions">
                <input
                  id="pairing-code"
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  minLength={22}
                  maxLength={22}
                  required
                  placeholder={t.pairingPlaceholder}
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                />
                <button
                  className="primaryButton"
                  type="submit"
                  disabled={pairingCode.length !== 22}
                >
                  {t.pairLocally}
                </button>
              </div>
            </form>
          )}

          <div className="viewportMeta" aria-label={t.viewport}>
            <span>{orientation === "portrait" ? t.portrait : t.landscape}</span>
            <span>
              {viewport.columns} × {viewport.rows}
            </span>
          </div>
        </div>

        <aside className="controlPanel" aria-label={t.controls}>
          <div className="quickKeys">
            {QUICK_KEYS.map((key) => (
              <button
                key={key.id}
                type="button"
                aria-label={t.sendKey(t.keyNames[key.id])}
                disabled={!connected}
                onClick={() => send(key.value)}
              >
                {key.label}
              </button>
            ))}
          </div>

          <div className="controlDivider" />

          <div className="controlsRow">
            <div className="directionPad">
              <span />
              <ControlKey
                label="↑"
                name={t.keyNames.up}
                disabled={!connected}
                onPress={() => send("\u001b[A")}
              />
              <span />
              <ControlKey
                label="←"
                name={t.keyNames.left}
                disabled={!connected}
                onPress={() => send("\u001b[D")}
              />
              <span className="directionCenter" aria-hidden="true">
                <span />
              </span>
              <ControlKey
                label="→"
                name={t.keyNames.right}
                disabled={!connected}
                onPress={() => send("\u001b[C")}
              />
              <span />
              <ControlKey
                label="↓"
                name={t.keyNames.down}
                disabled={!connected}
                onPress={() => send("\u001b[B")}
              />
              <span />
            </div>

            <div className="actionKeys">
              <button
                className="enterKey"
                type="button"
                aria-label={t.sendKey(t.keyNames.enter)}
                disabled={!connected}
                onClick={() => send("\r")}
              >
                ENTER <span aria-hidden="true">↵</span>
              </button>
              <div>
                <button
                  type="button"
                  aria-label={t.sendKey(t.keyNames.delete)}
                  disabled={!connected}
                  onClick={() => send("\u007f")}
                >
                  ⌫ {language === "en" ? "DEL" : "RADERA"}
                </button>
                <button
                  type="button"
                  aria-label={t.sendKey(t.keyNames.clear)}
                  disabled={!connected}
                  onClick={() => send("\u000c")}
                >
                  ⌧ {language === "en" ? "CLR" : "RENSA"}
                </button>
              </div>
            </div>
          </div>

          {connected && (
            <div className="activeSessionCard">
              <span>{t.activeSession}</span>
              <strong>{adapter.label}</strong>
              {adapter.detach !== undefined && (
                <button type="button" onClick={() => void adapter.detach?.()}>
                  {t.detach}
                </button>
              )}
            </div>
          )}

          <form className="inputComposer" onSubmit={submit}>
            <label htmlFor="terminal-input">
              {protocolClient ? t.terminalInput : t.simulationInput}
            </label>
            <div>
              <textarea
                id="terminal-input"
                ref={inputRef}
                value={input}
                rows={1}
                disabled={!connected}
                placeholder={
                  connected
                    ? protocolClient
                      ? t.sendPrivatePlaceholder
                      : t.sendSimulationPlaceholder
                    : protocolClient
                      ? t.disconnectedPrivatePlaceholder
                      : t.disconnectedSimulationPlaceholder
                }
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={keyDown}
                onPaste={paste}
              />
              <button
                className="primaryButton"
                type="submit"
                disabled={!connected || input.length === 0}
              >
                {t.send}
              </button>
            </div>
          </form>
        </aside>
      </section>

      <footer className="privacyFooter">
        {protocolClient ? t.privateTraffic : t.simulatedTraffic}
      </footer>
    </main>
  );
}

function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="settingsGroup">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function ControlKey({
  label,
  name,
  disabled,
  onPress,
}: {
  label: string;
  name: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      disabled={disabled}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
