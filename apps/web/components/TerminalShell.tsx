"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
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
import {
  type ConnectionMode,
  type ConnectProfile,
  persistConnectState,
  profileLabel,
  readPersistedConnectState,
  resolveProfiles,
  selectInitialProfile,
} from "../protocol/connectConfig";

const MOBILE_KEYS = [
  { label: "Escape", value: "\u001b" },
  { label: "Tab", value: "\t" },
  { label: "Control", value: "\u0011" },
  { label: "Arrow up", value: "\u001b[A" },
  { label: "Arrow down", value: "\u001b[B" },
  { label: "Arrow left", value: "\u001b[D" },
  { label: "Arrow right", value: "\u001b[C" },
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

function sameProfile(a?: ConnectProfile, b?: ConnectProfile): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.mode === b.mode &&
    a.endpoint === b.endpoint &&
    a.expectedWebOrigin === b.expectedWebOrigin
  );
}

function toPersistedState(
  profiles: ConnectProfile[],
  selectedMode: ConnectionMode,
) {
  return { selectedMode, profiles };
}

function normalizeProtocolConfig(
  protocolConfig: Pick<
    ProtocolTerminalAdapterConfig,
    "endpoint" | "expectedWebOrigin" | "mode"
  >,
  fallbackMode: ConnectionMode | undefined,
): ConnectProfile {
  return {
    endpoint: protocolConfig.endpoint,
    expectedWebOrigin: protocolConfig.expectedWebOrigin,
    mode: protocolConfig.mode ?? fallbackMode ?? "private",
  };
}

export interface TerminalShellProps {
  adapterFactory?: (profile?: ConnectProfile) => TerminalAdapter;
  protocolProfiles?: ConnectProfile[];
  protocolConfig?: Pick<
    ProtocolTerminalAdapterConfig,
    "endpoint" | "expectedWebOrigin" | "mode"
  >;
  defaultMode?: ConnectionMode;
}

function initialProfileFromConfig(
  protocolConfig: TerminalShellProps["protocolConfig"],
  resolvedProfiles: ConnectProfile[],
  defaultMode: ConnectionMode | undefined,
) {
  if (protocolConfig !== undefined) {
    return normalizeProtocolConfig(
      protocolConfig,
      resolvedProfiles[0]?.mode ?? defaultMode,
    );
  }
  const saved = readPersistedConnectState();
  return selectInitialProfile(resolvedProfiles, saved?.selectedMode, defaultMode);
}

export function TerminalShell({
  adapterFactory,
  protocolProfiles = [],
  protocolConfig,
  defaultMode,
}: TerminalShellProps) {
  const selectId = useId();
  const [markers, setMarkers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [viewport, setViewport] = useState<TerminalViewport>({
    columns: MIN_COLUMNS,
    rows: MIN_ROWS,
  });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "landscape",
  );

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeProfileRef = useRef<ConnectProfile | undefined>(undefined);

  const resolvedProfiles = useMemo(() => {
    const saved = readPersistedConnectState();
    return resolveProfiles(protocolProfiles, saved);
  }, [protocolProfiles]);

  const controlledProfile = useMemo(() => {
    if (protocolConfig === undefined) return undefined;
    return normalizeProtocolConfig(protocolConfig, defaultMode);
  }, [protocolConfig, defaultMode]);

  const initialProfile = useMemo(
    () => initialProfileFromConfig(protocolConfig, resolvedProfiles, defaultMode),
    [protocolConfig, resolvedProfiles, defaultMode],
  );

  const [selectedProfile, setSelectedProfile] =
    useState<ConnectProfile | undefined>(initialProfile);

  const profileForClient = controlledProfile ?? selectedProfile;

  const createAdapter = useCallback(
    (profile?: ConnectProfile): TerminalAdapter => {
      if (adapterFactory !== undefined) {
        return adapterFactory(profile);
      }
      if (profile === undefined) {
        return new MockTerminalAdapter();
      }
      return new ProtocolTerminalAdapter({
        endpoint: profile.endpoint,
        expectedWebOrigin: profile.expectedWebOrigin,
        mode: profile.mode,
      });
    },
    [adapterFactory],
  );

  const [adapter, setAdapter] = useState<TerminalAdapter>(() =>
    createAdapter(profileForClient),
  );
  const [connectionState, setConnectionState] =
    useState<TerminalConnectionState>(adapter.getState());

  useEffect(() => {
    activeProfileRef.current = profileForClient;
  }, [profileForClient]);

  useEffect(() => {
    if (sameProfile(activeProfileRef.current, profileForClient)) return;

    const previous = adapter;
    const next = createAdapter(profileForClient);
    activeProfileRef.current = profileForClient;
    if (controlledProfile === undefined && profileForClient !== undefined) {
      persistConnectState(
        toPersistedState(resolvedProfiles, profileForClient.mode),
      );
    }

    setMarkers([]);
    setPairingCode("");
    setInput("");
    setConnectionState(next.getState());
    setAdapter(next);
    void previous.disconnect();
  }, [
    adapter,
    controlledProfile,
    createAdapter,
    profileForClient,
    resolvedProfiles,
  ]);

  useEffect(() => {
    const unsubscribeState = adapter.subscribe(setConnectionState);
    const unsubscribeOutput = adapter.subscribeOutput((marker) => {
      setMarkers((current) => [...current.slice(-4), marker]);
    });

    return () => {
      unsubscribeState();
      unsubscribeOutput();
      void adapter.disconnect();
    };
  }, [adapter]);

  useEffect(() => {
    if (adapter.kind !== "protocol-client" || adapter.detach === undefined) {
      return;
    }

    const detach = adapter.detach.bind(adapter);
    const visibilityChanged = () => {
      if (
        document.visibilityState === "hidden" &&
        adapter.getState() === "connected"
      ) {
        void detach();
      } else if (
        document.visibilityState === "visible" &&
        adapter.getState() === "detached"
      ) {
        void adapter.connect();
      }
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [adapter]);

  useEffect(() => {
    if (connectionState === "connected") {
      inputRef.current?.focus();
    }
  }, [connectionState]);

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
      if (connectionState !== "connected" || value.length === 0) {
        return;
      }
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
    if (event.key === "Enter" && !event.shiftKey) {
      submit(event);
    }
  };

  const setMode = (mode: ConnectionMode) => {
    if (controlledProfile !== undefined) return;
    const next = resolvedProfiles.find((profile) => profile.mode === mode);
    if (next === undefined || sameProfile(next, selectedProfile)) return;
    setSelectedProfile(next);
  };

  const selectedMode = profileForClient?.mode;
  const connected = connectionState === "connected";
  const protocolClient = adapter.kind === "protocol-client";
  const busy = [
    "connecting",
    "authenticating",
    "opening",
    "reconnecting",
    "detaching",
    "closing",
  ].includes(connectionState);

  const connectButtonLabel = protocolClient
    ? selectedMode === "local"
      ? "Connect locally"
      : "Connect privately"
    : "Start simulation";
  const retryButtonLabel = protocolClient
    ? selectedMode === "local"
      ? "Retry local connection"
      : "Retry private connection"
    : "Retry simulation";
  const headerModeLabel = protocolClient
    ? selectedMode === "local"
      ? "Local terminal"
      : "Private path terminal"
    : "Terminal simulation";

  return (
    <main className="workspace">
      <header className="appHeader">
        <div>
          <p className="eyebrow">{headerModeLabel}</p>
          <h1>Terminus</h1>
        </div>
        <span className="prototypeBadge">Personal prototype</span>
      </header>

      <section className="terminalCard" aria-labelledby="terminal-heading">
        <div className="terminalToolbar">
          <div>
            <h2 id="terminal-heading">Terminal workspace</h2>
            <p className="adapterLabel">{adapter.label}</p>
            {resolvedProfiles.length > 1 && selectedMode !== undefined && (
              <label>
                Connection mode
                <select
                  id={selectId}
                  value={selectedMode}
                  onChange={(event) =>
                    setMode(event.currentTarget.value as ConnectionMode)
                  }
                  disabled={protocolConfig !== undefined}
                >
                  {resolvedProfiles.map((profile) => (
                    <option key={profile.mode} value={profile.mode}>
                      {profileLabel(profile)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="connectionActions">
            <p
              className={`status status-${connectionState}`}
              role="status"
              aria-live="polite"
            >
              <span aria-hidden="true" />
              {connectionState}
            </p>
            {adapter.getErrorCode?.() !== undefined && (
              <p className="errorCode">{adapter.getErrorCode()}</p>
            )}
            {connected ? (
              <>
                {adapter.detach !== undefined && (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void adapter.detach?.()}
                  >
                    Detach
                  </button>
                )}
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() => void adapter.disconnect()}
                >
                  Disconnect
                </button>
              </>
            ) : connectionState === "pairing" ? (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => void adapter.disconnect()}
              >
                Cancel
              </button>
            ) : (
              <button
                className="primaryButton"
                type="button"
                disabled={
                  busy ||
                  (protocolClient &&
                    adapterFactory === undefined &&
                    profileForClient === undefined) ||
                  (protocolClient &&
                    adapterFactory === undefined &&
                    resolvedProfiles.length === 0)
                }
                onClick={() => void connect()}
              >
                {connectionState === "error"
                  ? retryButtonLabel
                  : connectButtonLabel}
              </button>
            )}
          </div>
        </div>

        <div
          ref={terminalRef}
          className="terminalViewport"
          role="log"
          aria-label={
            protocolClient
              ? "Protocol terminal output"
              : "Simulated terminal output"
          }
          aria-live="polite"
          data-columns={viewport.columns}
          data-rows={viewport.rows}
          tabIndex={0}
          onClick={() => inputRef.current?.focus()}
        >
          {!protocolClient && (
            <p className="safetyNotice">
              No agent, shell, protocol, or network destination is connected.
            </p>
          )}
          {markers.map((marker, index) => (
            <p className="marker" key={`${marker}-${index}`}>
              {marker}
            </p>
          ))}
          {!connected && !protocolClient && (
            <p className="terminalHint">
              Start the local simulation to exercise the interface.
            </p>
          )}
          {protocolClient && connectionState === "disconnected" && (
            <p className="terminalHint">
              Select a mode and open the connection to continue.
            </p>
          )}
        </div>

        {connectionState === "pairing" && adapter.pair !== undefined && (
          <form className="pairingForm" onSubmit={pair}>
            <label htmlFor="pairing-code">One-time pairing code</label>
            <p>
              Confirm this browser locally on the Windows agent. The code is
              never stored.
            </p>
            <div>
              <input
                id="pairing-code"
                type="password"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                minLength={22}
                maxLength={22}
                required
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
              />
              <button
                className="primaryButton"
                type="submit"
                disabled={pairingCode.length !== 22}
              >
                Pair locally
              </button>
            </div>
          </form>
        )}

        <div
          className="viewportMeta"
          aria-label="Terminal viewport information"
        >
          <span>{orientation}</span>
          <span>
            {viewport.columns} × {viewport.rows}
          </span>
        </div>

        <div
          className="mobileKeyBar"
          role="toolbar"
          aria-label="Mobile terminal keys"
        >
          {MOBILE_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              aria-label={`Send ${key.label}`}
              disabled={!connected}
              onClick={() => send(key.value)}
            >
              {key.label.replace("Arrow ", "")}
            </button>
          ))}
        </div>

        <form className="inputComposer" onSubmit={submit}>
          <label htmlFor="terminal-input">
            {protocolClient ? "Terminal input" : "Simulation input"}
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
                    ? selectedMode === "local"
                      ? "Send input to the local terminal"
                      : "Send input directly to the private agent"
                    : "Input is acknowledged, never executed"
                  : protocolClient
                    ? "Terminal is disconnected"
                    : "Simulation is disconnected"
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
              Send
            </button>
          </div>
        </form>
      </section>

      <footer>
        <p>
          {protocolClient
            ? selectedMode === "local"
              ? "Terminal traffic connects directly to the configured local endpoint on this machine."
              : "Terminal traffic connects directly to the configured private endpoint."
            : "Terminal traffic is not routed through this web scaffold."}
        </p>
      </footer>
    </main>
  );
}
