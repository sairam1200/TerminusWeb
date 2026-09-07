"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrivateWssPolicy } from "../protocol/endpointPolicy";
import { IntelligenceClient } from "./client";
import type { IntelligenceState, SessionSnapshot } from "./types";

export function useIntelligence(policy?: PrivateWssPolicy) {
  const client = useRef<IntelligenceClient | undefined>(undefined);
  const [view, setView] = useState<{
    key: string;
    state: IntelligenceState;
    session?: SessionSnapshot;
  }>({ key: "", state: "disconnected" });
  const endpoint = policy?.endpoint;
  const origin = policy?.expectedWebOrigin;
  const mode = policy?.mode;
  const policyKey = JSON.stringify([endpoint, origin, mode]);
  const setSession = useCallback(
    (session: SessionSnapshot | undefined) =>
      setView((current) =>
        current.key === policyKey ? { ...current, session } : current,
      ),
    [policyKey],
  );
  useEffect(() => {
    if (!endpoint || !origin) return;
    const api = new IntelligenceClient(
      { endpoint, expectedWebOrigin: origin, mode },
      window.location.origin,
    );
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing || api.getState() !== "ready") return;
      refreshing = true;
      try {
        const snapshot = await api.request("session.current", {});
        if (active) {
          setView({ key: policyKey, session: snapshot, state: "ready" });
        }
      } catch {
        if (active) {
          setView({ key: policyKey, state: "unavailable" });
        }
      } finally {
        refreshing = false;
      }
    };
    client.current = api;
    const unsubscribe = api.subscribe((next) => {
      setView({ key: policyKey, state: next });
      if (next === "ready") void refresh();
    });
    api.connect();
    const timer = window.setInterval(() => void refresh(), 30000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      unsubscribe();
      api.dispose();
      client.current = undefined;
    };
  }, [endpoint, origin, mode, policyKey]);
  return {
    client,
    state:
      view.key === policyKey
        ? view.state
        : ("disconnected" as IntelligenceState),
    session: view.key === policyKey ? view.session : undefined,
    setSession,
  };
}
