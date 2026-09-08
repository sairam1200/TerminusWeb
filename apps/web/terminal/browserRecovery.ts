import type { TerminalAdapter } from "./adapter";

const DELAYS = [500, 1000, 2000, 4000, 8000, 16000, 16000, 16000];

/** One bounded episode. Repeated lifecycle events never replenish attempts. */
export function browserRecovery(adapter: TerminalAdapter) {
  let attempts = 0;
  let stopped = false;
  let disposed = false;
  let pageHidden = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const visible = () =>
    !pageHidden && document.visibilityState === "visible" && navigator.onLine;
  const eligible = () => {
    const state = adapter.getState();
    return (
      state === "detached" ||
      (state === "error" &&
        (adapter.getFailureCause?.() === "transport" ||
          adapter.getErrorCode?.() === "SESSION_REOPEN_REJECTED"))
    );
  };
  const schedule = () => {
    if (
      disposed ||
      stopped ||
      timer !== undefined ||
      !visible() ||
      !eligible() ||
      attempts >= DELAYS.length
    )
      return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed || stopped || !visible() || !eligible()) return;
      attempts++;
      void adapter
        .connect({
          ...(adapter.getSessionId?.()
            ? { sessionId: adapter.getSessionId!() }
            : {}),
        })
        .catch(() => undefined)
        .finally(schedule);
    }, DELAYS[attempts]);
  };
  const release = () => {
    cancel();
    if (adapter.release) adapter.release();
    else if (adapter.getState() === "connected")
      void adapter.detach?.().catch(() => undefined);
  };
  const visibility = () => {
    if (!visible()) {
      if (
        [
          "connected",
          "connecting",
          "reconnecting",
          "authenticating",
          "opening",
          "replaying",
          "detaching",
        ].includes(adapter.getState())
      )
        release();
      else cancel();
    } else schedule();
  };
  const pagehide = () => {
    pageHidden = true;
    cancel();
    if (
      !["disconnected", "detached", "error", "closing"].includes(
        adapter.getState(),
      )
    )
      release();
  };
  const pageshow = () => {
    pageHidden = false;
    visibility();
  };
  const unsubscribe = adapter.subscribe((state) => {
    if (state === "connected") {
      if (stopped || !visible()) {
        release();
        return;
      }
      attempts = 0;
      stopped = false;
      cancel();
    } else schedule();
  });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  window.addEventListener("online", visibility);
  window.addEventListener("offline", visibility);
  return {
    stop() {
      stopped = true;
      cancel();
    },
    manual() {
      stopped = false;
      attempts = 1;
      cancel();
    },
    dispose() {
      disposed = true;
      cancel();
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      if (adapter.release) adapter.release();
    },
  };
}
