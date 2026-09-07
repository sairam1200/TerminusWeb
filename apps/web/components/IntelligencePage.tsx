"use client";
import { collectPrivateExport } from "../intelligence/export";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  readPersistedConnectState,
  resolveProfiles,
  selectInitialProfile,
  type ConnectProfile,
} from "../protocol/connectConfig";
import { useIntelligence } from "../intelligence/useIntelligence";
import type { CommandEvent, Privacy, Rpc, Usage } from "../intelligence/types";
import { IntelligenceNav } from "./IntelligenceNav";

type Page = "history" | "usage" | "account" | "privacy" | "billing" | "admin";
const TITLES: Record<Page, string> = {
  history: "Command history",
  usage: "Usage",
  account: "Private account",
  privacy: "Privacy and data",
  billing: "Personal prototype plan",
  admin: "Administration",
};
export function IntelligencePage({
  page,
  profiles,
}: {
  page: Page;
  profiles: ConnectProfile[];
}) {
  const [policy, setPolicy] = useState<ConnectProfile>();
  useEffect(() => {
    const saved = readPersistedConnectState();
    const matching = resolveProfiles(profiles, saved).filter(
      (p) => p.expectedWebOrigin === window.location.origin,
    );
    const timer = setTimeout(
      () =>
        setPolicy(
          selectInitialProfile(matching, saved?.selectedMode, undefined),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, [profiles]);
  const { client, state, session, setSession } = useIntelligence(policy);
  const latestSession = useRef(session);
  const mounted = useRef(true);
  useEffect(() => {
    latestSession.current = session;
  }, [session]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dataSession, setDataSession] = useState<string>();
  const [history, setHistory] = useState<CommandEvent[]>();
  const [usage, setUsage] = useState<Usage>();
  const [billing, setBilling] = useState<Rpc["billing.get"][1]>();
  const [admin, setAdmin] = useState<Rpc["admin.overview"][1]>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (state !== "ready") return;
    let active = true;
    const api = client.current!;
    const load = async () => {
      try {
        if (page === "history") {
          const r = await api.request("history.list", { limit: 100 });
          if (active) {
            setHistory(r.items);
            setDataSession(session?.sessionId);
          }
        }
        if (page === "usage") {
          const r = await api.request("usage.get", {});
          if (active) {
            setUsage(r);
            setDataSession(session?.sessionId);
          }
        }
        if (page === "billing") {
          const r = await api.request("billing.get", {});
          if (active) {
            setBilling(r);
            setDataSession(session?.sessionId);
          }
        }
        if (page === "admin") {
          const r = await api.request("admin.overview", {});
          if (active) {
            setAdmin(r);
            setDataSession(session?.sessionId);
          }
        }
      } catch (error) {
        if (active) setMessage(safeError(error));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [state, page, client, session?.sessionId]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(safeError(error));
    } finally {
      setBusy(false);
    }
  }
  const api = () => {
    if (!client.current) throw new Error("UNAVAILABLE");
    return client.current;
  };
  function account(event: FormEvent) {
    event.preventDefault();
    const transient = password;
    setPassword("");
    void run(async () => {
      const result = register
        ? await api().request("account.register", {
            email,
            password: transient,
            name,
          })
        : await api().request("account.login", { email, password: transient });
      setSession(result);
      setMessage(register ? "Private account created." : "Signed in.");
    });
  }
  function updatePrivacy(privacy: Privacy) {
    void run(async () => {
      setSession(await api().request("privacy.update", privacy));
      setMessage("Privacy preferences saved.");
    });
  }
  function exportData() {
    void run(async () => {
      const exportingApi = api();
      const owner = session?.sessionId;
      if (!owner) throw new Error("UNAUTHORIZED");
      const data = await collectPrivateExport(
        exportingApi,
        owner,
        () =>
          mounted.current &&
          client.current === exportingApi &&
          latestSession.current?.sessionId === owner,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "terminus-private-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Export downloaded to this device.");
    });
  }
  return (
    <main className="intelligencePage">
      <IntelligenceNav />
      <h1>{TITLES[page]}</h1>
      <p>Data travels directly between this browser and your private host.</p>
      {state !== "ready" && (
        <section className="intelligenceCard">
          <p role="status">
            {state === "connecting"
              ? "Connecting to private intelligence…"
              : state === "pairing-required"
                ? "Pair this browser from the Terminal page first."
                : "Private intelligence is unavailable. Check the configured host and Tailscale connection."}
          </p>
          <button type="button" onClick={() => client.current?.connect()}>
            Retry connection
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {state === "ready" && session && (
        <>
          <p>
            {session.identity === "authenticated"
              ? `Signed in as ${session.user?.name || session.user?.email}`
              : "Guest session"}{" "}
            · Retention: up to {session.retentionDays} days
          </p>
          {page === "history" && (
            <section className="intelligenceCard">
              <p>
                Sanitized composer submissions only. Execution status, exit
                codes, and durations are unknown. History collection is{" "}
                {session.privacy.history ? "on" : "off"}.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    setHistory(
                      (
                        await api().request("history.list", {
                          query,
                          category: category || undefined,
                          limit: 100,
                        })
                      ).items,
                    );
                  });
                }}
              >
                <label htmlFor="history-query">Search history</label>
                <input
                  id="history-query"
                  value={query}
                  maxLength={256}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <label htmlFor="history-category">Category</label>
                <input
                  id="history-category"
                  value={category}
                  maxLength={64}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <button disabled={busy}>Filter history</button>
              </form>
              {history === undefined || dataSession !== session.sessionId ? (
                <p>Loading history…</p>
              ) : history.length === 0 ? (
                <p>No recorded commands match this view.</p>
              ) : (
                <ul className="historyList">
                  {history.map((item) => (
                    <li key={item.id}>
                      <code>{item.command}</code>
                      <p>
                        {item.purpose} · {item.category}
                      </p>
                      <small>
                        {item.createdAt} · Submitted · outcome unknown
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api().request("history.delete", {});
                    setHistory([]);
                    setMessage("Command history deleted.");
                  })
                }
              >
                Delete all command history
              </button>
            </section>
          )}
          {page === "usage" && (
            <section className="intelligenceCard">
              <p>
                Counts include only opted-in activity. AI usage and monthly
                allowance belong to this paired device and do not reset on
                sign-out or guest deletion. Terminal time is client-observed
                connection time, not shell execution time. Tokens are actual
                provider usage; catalog retrieval uses no generation tokens.
              </p>
              {usage && dataSession === session.sessionId ? (
                <>
                  <dl className="usageGrid">
                    <Metric label="Sessions" value={usage.sessions} />
                    <Metric label="Recorded commands" value={usage.commands} />
                    <Metric
                      label="Connected minutes"
                      value={Math.round(usage.terminalTimeMs / 60000)}
                    />
                    <Metric
                      label="Recommendation impressions"
                      value={usage.recommendationImpressions}
                    />
                    <Metric
                      label="Recommendation clicks"
                      value={usage.recommendationClicks}
                    />
                    <Metric
                      label="Paired-device AI requests"
                      value={usage.aiRequests}
                    />
                    <Metric label="Input tokens" value={usage.inputTokens} />
                    <Metric label="Output tokens" value={usage.outputTokens} />
                    <Metric label="Total tokens" value={usage.totalTokens} />
                    <Metric
                      label="Remaining tokens"
                      value={usage.remainingTokens}
                    />
                  </dl>
                  <h2>Top sanitized commands</h2>
                  {usage.topCommands.length ? (
                    <ul>
                      {usage.topCommands.map((item) => (
                        <li key={item.command}>
                          <code>{item.command}</code> · {item.count}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No recorded command activity.</p>
                  )}
                </>
              ) : (
                <p>Loading usage…</p>
              )}
            </section>
          )}
          {page === "account" && (
            <section className="intelligenceCard">
              {session.identity === "authenticated" ? (
                <>
                  <p>{session.user?.email}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSession(await api().request("account.logout", {}));
                        setHistory(undefined);
                        setUsage(undefined);
                        setMessage(
                          "Signed out. A fresh guest session is active.",
                        );
                      })
                    }
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <p>
                    This account exists only on your private host. Email is an
                    identifier and is not verified. There is no public
                    registration or email delivery.
                  </p>
                  <form onSubmit={account}>
                    {register && (
                      <>
                        <label htmlFor="account-name">Name</label>
                        <input
                          id="account-name"
                          required
                          maxLength={120}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </>
                    )}
                    <label htmlFor="account-email">Email</label>
                    <input
                      id="account-email"
                      type="email"
                      autoComplete="username"
                      required
                      maxLength={320}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <label htmlFor="account-password">Password</label>
                    <input
                      id="account-password"
                      type="password"
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                      required
                      maxLength={1024}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button disabled={busy}>
                      {register ? "Create private account" : "Sign in"}
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => {
                      setRegister(!register);
                      setPassword("");
                    }}
                  >
                    {register
                      ? "Use existing account"
                      : "Create an account on this host"}
                  </button>
                </>
              )}
            </section>
          )}
          {page === "privacy" && (
            <section className="intelligenceCard">
              <p>
                All optional collection starts off. Disabling collection stops
                new records; delete existing records below. Personalization
                requires history. Commands are reduced to reviewed templates;
                terminal output is never retained by intelligence.
              </p>
              {(["history", "analytics", "personalization"] as const).map(
                (key) => (
                  <label className="privacyChoice" key={key}>
                    <input
                      type="checkbox"
                      checked={session.privacy[key]}
                      disabled={
                        busy ||
                        (key === "personalization" && !session.privacy.history)
                      }
                      onChange={(e) =>
                        updatePrivacy({
                          ...session.privacy,
                          [key]: e.target.checked,
                          ...(key === "history" && !e.target.checked
                            ? { personalization: false }
                            : {}),
                        })
                      }
                    />
                    {key === "history"
                      ? "Save redacted composer history"
                      : key === "analytics"
                        ? "Collect optional usage analytics"
                        : "Personalize recommendations using my redacted history"}
                  </label>
                ),
              )}
              <div className="privacyActions">
                <button disabled={busy} onClick={exportData}>
                  Export my data
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api().request("history.delete", {});
                      setMessage(
                        "History and associated personalization deleted.",
                      );
                    })
                  }
                >
                  Delete command history
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api().request("analytics.delete", {});
                      setMessage("Optional analytics deleted.");
                    })
                  }
                >
                  Delete analytics
                </button>
                {session.identity === "guest" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSession(await api().request("guest.delete", {}));
                        setMessage(
                          "Guest data deleted. A fresh private session is active.",
                        );
                      })
                    }
                  >
                    Delete guest data
                  </button>
                )}
              </div>
            </section>
          )}
          {page === "billing" && (
            <section className="intelligenceCard">
              <p>
                Personal, non-commercial prototype. Paid upgrades, checkout,
                subscriptions, and payment collection are disabled.
              </p>
              {billing && dataSession === session.sessionId ? (
                <p>
                  {billing.plan} · {billing.tokensUsed} actual tokens used of{" "}
                  {billing.tokenLimit} monthly tokens for this paired device
                </p>
              ) : (
                <p>Loading plan allowance…</p>
              )}
              <button disabled>Paid upgrades unavailable</button>
            </section>
          )}
          {page === "admin" && (
            <section className="intelligenceCard">
              <p>
                Server-authorized aggregate metadata only. Other users’ commands
                are never shown.
              </p>
              {admin && dataSession === session.sessionId ? (
                <dl className="usageGrid">
                  {Object.entries(admin).map(([key, value]) => (
                    <Metric key={key} label={key} value={value} />
                  ))}
                </dl>
              ) : (
                <p>
                  {session.admin
                    ? "Loading aggregate metadata…"
                    : "You are not authorized to view administration."}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code === "FORBIDDEN"
    ? "You are not authorized for this action."
    : code === "UNAUTHORIZED"
      ? "Authentication expired or credentials were not accepted."
      : code === "CONFLICT"
        ? "The account or request conflicts with existing data."
        : code === "CONSENT_REQUIRED"
          ? "Enable the required privacy preference first."
          : code === "INVALID_REQUEST"
            ? "Check the submitted fields and try again."
            : code === "RATE_LIMITED"
              ? "Too many requests. Please wait before trying again."
              : code === "QUOTA_EXCEEDED"
                ? "The monthly model token allowance is exhausted."
                : "Private intelligence is unavailable. Try again when the private host is connected.";
}
