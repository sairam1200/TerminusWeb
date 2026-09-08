"use client";

import { IntelligencePanel } from "./IntelligencePanel";
import { browserRecovery } from "../terminal/browserRecovery";
import type { RecentSession } from "../protocol/recentSessions";
import { Terminal } from "@xterm/xterm";
import {
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import {
  parseSessionFragment,
  sessionFragment,
} from "../protocol/sessionFragment";

import {
  type ConnectProfile,
  type ConnectionMode,
  persistConnectState,
  readPersistedConnectState,
  resolveProfiles,
  selectInitialProfile,
} from "../protocol/connectConfig";

const NO_PROFILES: ConnectProfile[] = [];
const subscribeToClient = () => () => undefined;

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
    protocol: "PRIVATE WSS · PROTOCOL 0.2",
    secure: "mTLS · PRIVATE",
    personalPrototype: "Personal prototype",
    status: {
      disconnected: "Disconnected",
      connecting: "Connecting…",
      pairing: "Pairing",
      authenticating: "Authenticating…",
      opening: "Opening session…",
      replaying: "Restoring history…",
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
      "Use a fresh one-time code for each browser and approve it on the host. This browser remembers access until its credential expires or is revoked. Each device opens its own terminal sessions. The code is never stored.",
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
    sessionOpenFailure:
      "PowerShell could not open. Check the Windows agent and available system resources, then retry.",
    transportFailure:
      "The secure terminal connection failed or closed unexpectedly. Check that the configured agent is running and reachable, and that this browser trusts its certificates. Then retry.",
    sessionId: "Session",
    newSession: "New Session",
    historyTruncated: "Earlier output is not available.",
    invalidSession: "This session link is invalid or unavailable.",
    reopenFailure:
      "This session could not be reopened. It may have expired or no longer be available to this browser. Retry the same session, or choose New Session to open a separate shell. The link changes only after the new session opens.",
    newSessionFailure:
      "New Session could not complete. The session link was not changed. Retry from this page.",
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
    protocol: "PRIVAT WSS · PROTOKOLL 0.2",
    secure: "mTLS · PRIVAT",
    personalPrototype: "Personlig prototyp",
    status: {
      disconnected: "Frånkopplad",
      connecting: "Ansluter…",
      pairing: "Parkopplar",
      authenticating: "Autentiserar…",
      opening: "Öppnar session…",
      replaying: "Återställer historik…",
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
      "Använd en ny engångskod för varje webbläsare och godkänn den på värddatorn. Webbläsaren minns åtkomsten tills behörigheten löper ut eller återkallas. Varje enhet öppnar egna terminalsessioner. Koden sparas aldrig.",
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
    sessionOpenFailure:
      "PowerShell kunde inte öppnas. Kontrollera Windows-agenten och tillgängliga systemresurser och försök sedan igen.",
    transportFailure:
      "Den säkra terminalanslutningen misslyckades eller stängdes oväntat. Kontrollera att agenten körs och kan nås och att webbläsaren litar på dess certifikat. Försök sedan igen.",
    sessionId: "Session",
    newSession: "Ny session",
    historyTruncated: "Tidigare utdata är inte tillgängliga.",
    invalidSession: "Sessionslänken är ogiltig eller otillgänglig.",
    reopenFailure:
      "Sessionen kunde inte öppnas igen. Den kan ha löpt ut eller vara otillgänglig för denna webbläsare. Försök igen eller välj Ny session för en separat terminal. Länken ändras först när den nya sessionen öppnas.",
    newSessionFailure:
      "Ny session kunde inte slutföras. Sessionslänken ändrades inte. Försök igen från den här sidan.",
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
  adapterFactory?: (profile?: ConnectProfile) => TerminalAdapter;
  protocolProfiles?: ConnectProfile[];
  defaultMode?: ConnectionMode;
  protocolConfig?: Pick<
    ProtocolTerminalAdapterConfig,
    "endpoint" | "expectedWebOrigin" | "mode"
  >;
}

export function TerminalShell({
  adapterFactory,
  protocolConfig,
  protocolProfiles = NO_PROFILES,
  defaultMode,
}: TerminalShellProps) {
  const clientReady = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const [saved, setSaved] =
    useState<ReturnType<typeof readPersistedConnectState>>();
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>();
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSaved(readPersistedConnectState()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  const profiles = useMemo(
    () => resolveProfiles(protocolProfiles, saved),
    [protocolProfiles, saved],
  );
  const availableProfiles =
    clientReady && adapterFactory === undefined
      ? profiles.filter(
          (candidate) => candidate.expectedWebOrigin === window.location.origin,
        )
      : profiles;
  const profile =
    protocolConfig !== undefined
      ? {
          ...protocolConfig,
          mode:
            protocolConfig.mode ?? defaultMode ?? ("private" as ConnectionMode),
        }
      : selectInitialProfile(
          availableProfiles,
          selectedMode ?? saved?.selectedMode,
          defaultMode,
        );
  const selectProfile = (mode: ConnectionMode) => {
    if (mode === profile?.mode) return;
    // A fragment belongs to the previous endpoint. Never submit it to another host.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    setSelectedMode(mode);
    persistConnectState({ selectedMode: mode, profiles });
  };
  if (!clientReady && (protocolConfig !== undefined || profiles.length > 0)) {
    return (
      <main className="terminusApp">
        <p role="status">Preparing terminal connection...</p>
      </main>
    );
  }
  if (
    adapterFactory === undefined &&
    clientReady &&
    ((protocolConfig !== undefined &&
      protocolConfig.expectedWebOrigin !== window.location.origin) ||
      (protocolConfig === undefined &&
        profiles.length > 0 &&
        availableProfiles.length === 0))
  ) {
    return (
      <main className="terminusApp">
        <p role="alert">
          No connection profile matches the current page origin. Open Terminus
          at the configured web address for local or private access.
        </p>
        <nav aria-label="Configured terminal pages">
          {resolveProfiles(
            protocolConfig
              ? [{ ...protocolConfig, mode: protocolConfig.mode ?? "private" }]
              : profiles,
            undefined,
          ).map((target) => (
            <p key={target.mode}>
              <a href={target.expectedWebOrigin}>
                Open {target.mode === "private" ? "private" : "local"} Terminus
              </a>
            </p>
          ))}
        </nav>
      </main>
    );
  }
  return (
    <TerminalWorkspace
      key={profile === undefined ? "simulation" : JSON.stringify(profile)}
      adapterFactory={
        adapterFactory === undefined ? undefined : () => adapterFactory(profile)
      }
      protocolConfig={profile}
      profiles={
        protocolConfig === undefined
          ? profiles
          : profile
            ? [profile]
            : NO_PROFILES
      }
      language={language}
      onSetLanguage={setLanguage}
      selectedMode={profile?.mode}
      availableModes={
        protocolConfig !== undefined && profile
          ? [profile.mode]
          : availableProfiles.map((candidate) => candidate.mode)
      }
      onSelectProfile={selectProfile}
    />
  );
}

function TerminalWorkspace({
  adapterFactory,
  protocolConfig,
  profiles,
  selectedMode,
  onSelectProfile,
  availableModes,
  language,
  onSetLanguage,
}: TerminalShellProps & {
  profiles: ConnectProfile[];
  language: Language;
  onSetLanguage: (language: Language) => void;
  availableModes: ConnectionMode[];
  selectedMode?: ConnectionMode;
  onSelectProfile: (mode: ConnectionMode) => void;
}) {
  const [adapter] = useState<TerminalAdapter>(() =>
    adapterFactory !== undefined
      ? adapterFactory()
      : protocolConfig !== undefined
        ? new ProtocolTerminalAdapter(protocolConfig)
        : new MockTerminalAdapter(),
  );
  const protocolClient = adapter.kind === "protocol-client";
  const [connectionState, setConnectionState] = useState(adapter.getState());
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [endFailed, setEndFailed] = useState(false);
  const [fragmentInvalid, setFragmentInvalid] = useState(false);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [newSessionFailed, setNewSessionFailed] = useState(false);
  const [newSessionNeedsFreshRetry, setNewSessionNeedsFreshRetry] =
    useState(false);
  const [markers, setMarkers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pairingCode, setPairingCode] = useState("");
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
  const t = {
    ...TRANSLATIONS[language],
    ...(selectedMode === "local"
      ? {
          connectPrivate:
            language === "en" ? "Connect locally" : "Anslut lokalt",
          retryPrivate:
            language === "en"
              ? "Retry local connection"
              : "Försök ansluta lokalt igen",
          privateTraffic:
            language === "en"
              ? "Terminal traffic connects directly to this machine's loopback endpoint."
              : "Terminaltrafiken ansluter direkt till datorns lokala ändpunkt.",
        }
      : {}),
  };
  const scheme = ACCENTS[accent];
  const connected = connectionState === "connected";
  const busy = [
    "connecting",
    "authenticating",
    "opening",
    "replaying",
    "reconnecting",
    "detaching",
    "closing",
  ].includes(connectionState);
  const errorCode = adapter.getErrorCode?.();
  const transportFailed = adapter.getFailureCause?.() === "transport";
  const themeStyle = {
    "--accent": scheme.primary,
    "--accent-secondary": scheme.secondary,
    "--accent-glow": `color-mix(in srgb, ${scheme.primary} ${Math.round(GLOW_ALPHA[glow] * 100)}%, transparent)`,
  } as CSSProperties;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!protocolClient) return;
    const syncFragment = () => {
      const fragment = parseSessionFragment(window.location.hash);
      setFragmentInvalid(fragment.kind === "invalid");
      setCurrentSessionId(
        fragment.kind === "session" ? fragment.sessionId : undefined,
      );
    };
    const timer = window.setTimeout(syncFragment, 0);
    return () => window.clearTimeout(timer);
  }, [protocolClient]);

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
    const sideEffectGuards = [8, 9, 52, 777].map((identifier) =>
      terminal.parser.registerOscHandler(identifier, () => true),
    );
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
      sideEffectGuards.forEach((guard) => guard.dispose());
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
    const unsubscribeSession =
      adapter.subscribeSession?.((event) => {
        if (event.type === "session-ended") {
          setCurrentSessionId(undefined);
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
          return;
        }
        if (event.type === "history-begin") {
          pendingOutputRef.current = [];
          xtermRef.current?.reset();
          setHistoryTruncated(event.truncated);
          return;
        }
        setCurrentSessionId(event.sessionId);
        setFragmentInvalid(false);
        setHistoryTruncated(false);
        if (event.type === "session-opened") {
          window.history.replaceState(
            null,
            "",
            sessionFragment(event.sessionId),
          );
        }
        setNewSessionFailed(false);
        setNewSessionNeedsFreshRetry(false);
      }) ?? (() => undefined);
    return () => {
      unsubscribeState();
      unsubscribeOutput();
      unsubscribeSession();
      if (!protocolClient) void adapter.disconnect();
    };
  }, [adapter, protocolClient]);

  const recovery = useRef<ReturnType<typeof browserRecovery> | null>(null);
  useEffect(() => {
    if (!protocolClient) return;
    const controller = browserRecovery(adapter);
    recovery.current = controller;
    return () => {
      controller.dispose();
      recovery.current = null;
    };
  }, [adapter, protocolClient]);

  useEffect(() => {
    let cancelled = false;
    void adapter.getRecentSessions?.().then((entries) => {
      if (!cancelled) setRecentSessions(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, connectionState, currentSessionId]);

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

  const sendShortcut = (value: string) => {
    if (connectionState !== "connected") return;
    send(value);
    if (protocolClient) xtermRef.current?.focus();
    else inputRef.current?.focus();
  };

  const connect = async (selectedSessionId?: string) => {
    setEndFailed(false);
    recovery.current?.manual();
    setNewSessionFailed(false);
    const fragment = selectedSessionId
      ? { kind: "session" as const, sessionId: selectedSessionId }
      : protocolClient && !newSessionNeedsFreshRetry
        ? parseSessionFragment(window.location.hash)
        : { kind: "root" as const };
    if (fragment.kind === "invalid") {
      setFragmentInvalid(true);
      setConnectionState("error");
      return;
    }
    try {
      await adapter.connect({
        ...(fragment.kind === "session"
          ? { sessionId: fragment.sessionId }
          : {}),
      });
    } catch {
      setConnectionState("error");
    }
  };

  const newSession = async () => {
    recovery.current?.manual();
    if (adapter.newSession === undefined) return;
    setNewSessionFailed(false);
    setNewSessionNeedsFreshRetry(false);
    try {
      await adapter.newSession();
    } catch {
      setNewSessionFailed(true);
      setNewSessionNeedsFreshRetry(adapter.getSessionId?.() === undefined);
      setConnectionState(adapter.getState());
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
          <div className="connectionPreferences">
            <div
              className="connectionMode"
              role="group"
              aria-label={
                language === "en" ? "Connection mode" : "Anslutningsläge"
              }
            >
              {(["local", "private"] as const).map((mode) => {
                const target = profiles.find(
                  (candidate) => candidate.mode === mode,
                );
                const label =
                  mode === "local"
                    ? language === "en"
                      ? "Local"
                      : "Lokalt"
                    : language === "en"
                      ? "Private"
                      : "Privat";
                const description =
                  mode === "local"
                    ? language === "en"
                      ? "Local terminal on this computer"
                      : "Lokal terminal på denna dator"
                    : language === "en"
                      ? "Private terminal over Tailscale"
                      : "Privat terminal via Tailscale";
                const locked =
                  busy || connected || connectionState === "pairing";
                const hint = locked
                  ? language === "en"
                    ? "Detach or cancel the connection before switching."
                    : "Lämna eller avbryt anslutningen innan du byter."
                  : !target
                    ? language === "en"
                      ? `${description}: not configured.`
                      : `${description}: inte konfigurerad.`
                    : description;
                if (target && !availableModes.includes(mode) && !locked) {
                  // Each agent permits its configured page origin. Navigate without
                  // carrying session fragments or credentials to the other profile.
                  return (
                    <a
                      key={mode}
                      href={target.expectedWebOrigin}
                      title={hint}
                      aria-label={description}
                    >
                      {label}
                    </a>
                  );
                }
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-label={description}
                    aria-pressed={selectedMode === mode}
                    title={hint}
                    disabled={locked || !target}
                    onClick={() => onSelectProfile(mode)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              className="languageSwitch"
              type="button"
              aria-label={t.switchLanguage}
              title={t.switchLanguage}
              onClick={() => onSetLanguage(language === "en" ? "sv" : "en")}
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
          </div>

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
              onClick={() => {
                recovery.current?.stop();
                if (adapter.release) adapter.release();
                else if (adapter.detach) void adapter.detach();
                else void adapter.disconnect();
              }}
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
          {protocolClient && currentSessionId !== undefined && (
            <span className="sessionIdentity">
              {t.sessionId} <code>{currentSessionId}</code>
            </span>
          )}
          {connected &&
            protocolClient &&
            currentSessionId !== undefined &&
            adapter.newSession !== undefined && (
              <button
                className="secondaryButton compactButton"
                type="button"
                onClick={() => void newSession()}
              >
                {t.newSession}
              </button>
            )}
          <span>{t.personalPrototype}</span>
        </div>
      </section>

      {fragmentInvalid && (
        <p className="sessionOpenGuidance" role="alert">
          {t.invalidSession}
        </p>
      )}

      {newSessionFailed && (
        <p className="sessionOpenGuidance" role="alert">
          {t.newSessionFailure}
        </p>
      )}

      {connectionState === "error" &&
        errorCode === "SESSION_REOPEN_REJECTED" && (
          <section className="sessionOpenGuidance" aria-label={t.newSession}>
            <p role="alert">{t.reopenFailure}</p>
            {adapter.newSession && (
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => void newSession()}
              >
                {t.newSession}
              </button>
            )}
          </section>
        )}

      {historyTruncated && (
        <p className="historyNotice" role="status">
          {t.historyTruncated}
        </p>
      )}

      {connected && protocolClient && (
        <section className="sessionOpenGuidance">
          <p>
            {language === "en"
              ? "Disconnect keeps this terminal running. New Session ends this terminal and opens another."
              : "Koppla från låter terminalen fortsätta köras. Ny session avslutar terminalen och öppnar en annan."}
          </p>
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={() => {
              recovery.current?.stop();
              void adapter.disconnect().catch(() => setEndFailed(true));
            }}
          >
            {language === "en" ? "End Terminal" : "Avsluta terminal"}
          </button>
        </section>
      )}

      {endFailed && (
        <p className="sessionOpenGuidance" role="alert">
          {language === "en"
            ? "The terminal could not be ended. Reconnect to check its state and try again."
            : "Terminalen kunde inte avslutas. Återanslut för att kontrollera dess tillstånd och försök igen."}
        </p>
      )}

      {!connected && !busy && recentSessions.length > 0 && (
        <section
          className="sessionOpenGuidance"
          aria-label={
            language === "en" ? "Recent terminals" : "Senaste terminaler"
          }
        >
          <p>
            {language === "en"
              ? "Choose a recent terminal to try reopening it. It may have ended on the host."
              : "Välj en tidigare terminal för att försöka öppna den igen. Den kan ha avslutats på värddatorn."}
          </p>
          {recentSessions.map((entry) => (
            <button
              key={entry.sessionId}
              type="button"
              className="secondaryButton compactButton"
              onClick={() => {
                window.history.replaceState(
                  null,
                  "",
                  sessionFragment(entry.sessionId),
                );
                void connect(entry.sessionId);
              }}
            >
              {entry.sessionId}
            </button>
          ))}
        </section>
      )}

      {connectionState === "error" && transportFailed && (
        <p className="sessionOpenGuidance" role="alert">
          {t.transportFailure}
        </p>
      )}

      {connectionState === "error" &&
        !transportFailed &&
        errorCode === "SESSION_OPEN_FAILED" && (
          <p className="sessionOpenGuidance" role="alert">
            {t.sessionOpenFailure}
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
                onClick={() => sendShortcut(key.value)}
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
                onPress={() => sendShortcut("\u001b[A")}
              />
              <span />
              <ControlKey
                label="←"
                name={t.keyNames.left}
                disabled={!connected}
                onPress={() => sendShortcut("\u001b[D")}
              />
              <span className="directionCenter" aria-hidden="true">
                <span />
              </span>
              <ControlKey
                label="→"
                name={t.keyNames.right}
                disabled={!connected}
                onPress={() => sendShortcut("\u001b[C")}
              />
              <span />
              <ControlKey
                label="↓"
                name={t.keyNames.down}
                disabled={!connected}
                onPress={() => sendShortcut("\u001b[B")}
              />
              <span />
            </div>

            <div className="actionKeys">
              <button
                className="enterKey"
                type="button"
                aria-label={t.sendKey(t.keyNames.enter)}
                disabled={!connected}
                onClick={() => sendShortcut("\r")}
              >
                ENTER <span aria-hidden="true">↵</span>
              </button>
              <div>
                <button
                  type="button"
                  aria-label={t.sendKey(t.keyNames.delete)}
                  disabled={!connected}
                  onClick={() => sendShortcut("\u007f")}
                >
                  ⌫ {language === "en" ? "DEL" : "RADERA"}
                </button>
                <button
                  type="button"
                  aria-label={t.sendKey(t.keyNames.clear)}
                  disabled={!connected}
                  onClick={() => sendShortcut("\u000c")}
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
                <button
                  type="button"
                  onClick={() => {
                    recovery.current?.stop();
                    if (adapter.release) adapter.release();
                    else void adapter.detach?.().catch(() => undefined);
                  }}
                >
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

      {protocolClient && protocolConfig && (
        <IntelligencePanel
          policy={protocolConfig}
          connectionState={connectionState}
          onSubmit={(command) => adapter.sendInput(command)}
        />
      )}

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
