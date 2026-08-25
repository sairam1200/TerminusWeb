"use client";

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
}

export function TerminalShell({
  adapterFactory = () => new MockTerminalAdapter(),
}: TerminalShellProps) {
  const [adapter] = useState(adapterFactory);
  const [connectionState, setConnectionState] = useState(adapter.getState());
  const [markers, setMarkers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [viewport, setViewport] = useState<TerminalViewport>({
    columns: MIN_COLUMNS,
    rows: MIN_ROWS,
  });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "landscape",
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
            {connected ? (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => void adapter.disconnect()}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="primaryButton"
                type="button"
                disabled={connectionState === "connecting"}
                onClick={() => void connect()}
              >
                {connectionState === "error"
                  ? "Retry simulation"
                  : "Start simulation"}
              </button>
            )}
          </div>
        </div>

        <div
          ref={terminalRef}
          className="terminalViewport"
          role="log"
          aria-label="Simulated terminal output"
          aria-live="polite"
          data-columns={viewport.columns}
          data-rows={viewport.rows}
          tabIndex={0}
          onClick={() => inputRef.current?.focus()}
        >
          <p className="safetyNotice">
            No agent, shell, protocol, or network destination is connected.
          </p>
          {markers.map((marker, index) => (
            <p className="marker" key={`${marker}-${index}`}>
              {marker}
            </p>
          ))}
          {!connected && (
            <p className="terminalHint">
              Start the local simulation to exercise the interface.
            </p>
          )}
        </div>

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
          <label htmlFor="terminal-input">Simulation input</label>
          <div>
            <textarea
              id="terminal-input"
              ref={inputRef}
              value={input}
              rows={1}
              disabled={!connected}
              placeholder={
                connected
                  ? "Input is acknowledged, never executed"
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
        <p>Terminal traffic is not routed through this web scaffold.</p>
      </footer>
    </main>
  );
}
