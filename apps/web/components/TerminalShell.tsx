"use client";

import { Terminal } from "@xterm/xterm";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TerminalAdapter, TerminalViewport } from "../terminal/adapter";
import { MockTerminalAdapter } from "../terminal/mockTerminalAdapter";
import {
  ProtocolTerminalAdapter,
  type ProtocolTerminalAdapterConfig,
} from "../terminal/protocolTerminalAdapter";

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

  useEffect(() => {
    if (!protocolClient || terminalRef.current === null) return;

    const terminal = new Terminal({
      cols: MIN_COLUMNS,
      rows: MIN_ROWS,
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: {
        background: "#07100d",
        cursor: "#67f7bd",
        foreground: "#eef8f3",
        selectionBackground: "#315f4c",
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
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
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
    if (event.key === "Enter" && !event.shiftKey) {
      submit(event);
    }
  };

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

  return (
    <main className="workspace">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Private path terminal</p>
          <h1>Terminus</h1>
        </div>
        <span className="prototypeBadge">Personal prototype</span>
      </header>

      <section className="terminalCard" aria-labelledby="terminal-heading">
        <div className="terminalToolbar">
          <div>
            <h2 id="terminal-heading">Terminal workspace</h2>
            <p className="adapterLabel">{adapter.label}</p>
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
            {errorCode !== undefined && (
              <p className="errorCode">{errorCode}</p>
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
                disabled={busy}
                onClick={() => void connect()}
              >
                {connectionState === "detached"
                  ? "Reconnect"
                  : connectionState === "error"
                    ? protocolClient
                      ? "Retry private connection"
                      : "Retry simulation"
                    : protocolClient
                      ? "Connect privately"
                      : "Start simulation"}
              </button>
            )}
          </div>
        </div>

        {connectionState === "error" && errorCode === "SESSION_OPEN_FAILED" && (
          <p className="sessionOpenGuidance" role="alert">
            A new PowerShell session could not open. If eight sessions are
            already active, close an earlier Terminus tab or disconnect one
            session, then retry.
          </p>
        )}

        <div
          ref={terminalRef}
          className="terminalViewport"
          role="log"
          aria-label={
            protocolClient
              ? "Private terminal output"
              : "Simulated terminal output"
          }
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
            <p className="safetyNotice">
              No agent, shell, protocol, or network destination is connected.
            </p>
          )}
          {!protocolClient &&
            markers.map((marker, index) => (
              <p className="marker" key={`${marker}-${index}`}>
                {marker}
              </p>
            ))}
          {!connected && !protocolClient && (
            <p className="terminalHint">
              Start the local simulation to exercise the interface.
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
                    ? "Send input directly to the private agent"
                    : "Input is acknowledged, never executed"
                  : protocolClient
                    ? "Private terminal is disconnected"
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
            ? "Terminal traffic connects directly to the configured private agent."
            : "Terminal traffic is not routed through this web scaffold."}
        </p>
      </footer>
    </main>
  );
}
