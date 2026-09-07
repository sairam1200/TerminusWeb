"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { PrivateWssPolicy } from "../protocol/endpointPolicy";
import type { TerminalConnectionState } from "../terminal/adapter";
import { validCommand } from "../intelligence/client";
import { useIntelligence } from "../intelligence/useIntelligence";
import type {
  IntelligenceApi,
  IntelligenceState,
  SessionSnapshot,
  Recommendation,
} from "../intelligence/types";
import { IntelligenceNav } from "./IntelligenceNav";

export function IntelligencePanel({
  policy,
  connectionState,
  onSubmit,
}: {
  policy: PrivateWssPolicy;
  connectionState: TerminalConnectionState;
  onSubmit: (command: string) => void;
}) {
  const { client, state, session } = useIntelligence(policy);
  useEffect(() => {
    if (connectionState === "connected" && state === "pairing-required")
      client.current?.connect();
    if (state !== "ready" || !session?.privacy.analytics) return;
    const observed =
      connectionState === "connected"
        ? "connected"
        : connectionState === "reconnecting"
          ? "reconnecting"
          : "disconnected";
    void client.current
      ?.request("terminal.record", {
        eventId: crypto.randomUUID(),
        state: observed,
      })
      .catch(() => {});
  }, [client, state, connectionState, session?.privacy.analytics]);
  return (
    <PanelContent
      key={`${JSON.stringify(policy)}:${session?.sessionId ?? "unavailable"}`}
      api={client.current}
      state={state}
      session={session}
      connectionState={connectionState}
      onSubmit={onSubmit}
      onRetry={() => client.current?.connect()}
    />
  );
}

function PanelContent({
  api,
  state,
  session,
  connectionState,
  onSubmit,
  onRetry,
}: {
  api?: IntelligenceApi;
  state: IntelligenceState;
  session?: SessionSnapshot;
  connectionState: TerminalConnectionState;
  onSubmit: (command: string) => void;
  onRetry: () => void;
}) {
  const [command, setCommand] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Recommendation[]>([]);
  const [mode, setMode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const disposed = useRef(false);
  const sequence = useRef(0);
  const unresolved = /<[^<>]+>/.test(command);
  useEffect(() => {
    disposed.current = false;
    const fence = sequence;
    return () => {
      disposed.current = true;
      ++fence.current;
    };
  }, []);
  const retrieve = useCallback(
    async (search?: string) => {
      if (!api) return;
      const requestSequence = ++sequence.current;
      setBusy(true);
      setMessage("");
      setItems([]);
      setMode(undefined);
      try {
        const result = await api.request(
          "recommendations.get",
          search === undefined ? {} : { query: search },
        );
        if (disposed.current || requestSequence !== sequence.current) return;
        setItems(result.items);
        setMode(result.mode);
        if (!result.items.length) setMessage("No matching recommendations.");
      } catch {
        if (!disposed.current && requestSequence === sequence.current)
          setMessage(
            "Recommendations are unavailable. Your terminal remains usable.",
          );
      } finally {
        if (!disposed.current && requestSequence === sequence.current)
          setBusy(false);
      }
    },
    [api],
  );
  const sessionId = session?.sessionId;
  useEffect(() => {
    if (state !== "ready" || !sessionId) return;
    const fence = sequence;
    const timer = setTimeout(() => void retrieve(), 0);
    return () => {
      clearTimeout(timer);
      ++fence.current;
    };
  }, [state, sessionId, retrieve]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (connectionState !== "connected" || !validCommand(command) || unresolved)
      return;
    try {
      onSubmit(command + "\r");
    } catch {
      setMessage("Command could not be submitted.");
      return;
    }
    const submitted = command;
    setCommand("");
    setMessage("Submitted to the terminal. Execution outcome is unknown.");
    if (state === "ready" && session?.privacy.history)
      void api
        ?.request("command.record", {
          eventId: crypto.randomUUID(),
          command: submitted,
        })
        .then((result) => {
          if (disposed.current) return;
          if (result.recorded) {
            setQuery("");
            void retrieve();
          } else
            setMessage("Submitted to the terminal; history was not recorded.");
        })
        .catch(() => {
          if (!disposed.current)
            setMessage(
              "Submitted to the terminal; history could not be recorded.",
            );
        });
  }
  return (
    <section className="intelligencePanel" aria-label="Session intelligence">
      <IntelligenceNav />
      <details>
        <summary>Command recommendations and composer</summary>
        <p>
          Only commands submitted with this composer are eligible for redacted
          history. Terminal output and keyboard input are never collected.
        </p>
        <p>
          History: {session?.privacy.history ? "on" : "off"}.{" "}
          <a href="/account/privacy">Manage privacy</a>
        </p>
        {state !== "ready" && (
          <p role="status">
            {state === "pairing-required"
              ? "Pair this browser with the terminal first."
              : state === "connecting"
                ? "Connecting to private intelligence…"
                : "Private intelligence unavailable."}{" "}
            <button type="button" onClick={onRetry}>
              Retry intelligence
            </button>
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void retrieve(query);
          }}
        >
          <label htmlFor="recommendation-query">Find a command</label>
          <div className="intelligenceRow">
            <input
              id="recommendation-query"
              value={query}
              maxLength={256}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe what you want to do"
            />
            <button disabled={state !== "ready" || busy}>
              {busy ? "Searching…" : "Search"}
            </button>
          </div>
        </form>
        {mode && (
          <p>
            {mode === "local-model"
              ? "Retrieved catalog · local model explanations"
              : "Retrieved catalog · no model generation"}
          </p>
        )}
        <div className="recommendationGrid">
          {items.map((item) => (
            <article key={item.id}>
              <strong>{item.purpose}</strong>
              <code>{item.command}</code>
              <p>{item.reason}</p>
              <p>
                {item.category} ·{" "}
                {item.risk === "write"
                  ? "Changes files or state"
                  : "Read operation"}
              </p>
              <a
                href={safeSource(item.sourceUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Documentation source
              </a>
              <button
                type="button"
                onClick={() => {
                  setCommand(item.command);
                  if (session?.privacy.analytics)
                    void api
                      ?.request("recommendation.click", { id: item.id })
                      .catch(() => {});
                }}
              >
                Use in composer
              </button>
            </article>
          ))}
        </div>
        <form onSubmit={submit}>
          <label htmlFor="command-composer">Command composer</label>
          <p>
            Review the command and replace any placeholders. Submit sends Enter.
            Check your shell prompt before submitting.
          </p>
          <div className="intelligenceRow">
            <input
              id="command-composer"
              autoComplete="off"
              spellCheck={false}
              value={command}
              maxLength={4096}
              onChange={(e) => setCommand(e.target.value)}
            />
            <button
              disabled={
                connectionState !== "connected" ||
                !validCommand(command) ||
                unresolved
              }
            >
              Submit command
            </button>
          </div>
        </form>
        {unresolved && (
          <p role="status">
            Replace all &lt;placeholders&gt; before submitting.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </details>
    </section>
  );
}
function safeSource(source: string) {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
