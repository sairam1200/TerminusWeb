import type {
  IntelligenceApi,
  CommandEvent,
  SessionSnapshot,
  Usage,
} from "./types";
export async function collectPrivateExport(
  api: IntelligenceApi,
  sessionId: string,
  isCurrent: () => boolean,
): Promise<{
  session: SessionSnapshot;
  history: CommandEvent[];
  usage: Usage;
}> {
  let first: { session: SessionSnapshot; usage: Usage } | undefined;
  const history: CommandEvent[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (!isCurrent()) throw new Error("UNAUTHORIZED");
    const page = await api.request("data.export", cursor ? { cursor } : {});
    if (!isCurrent() || page.session.sessionId !== sessionId)
      throw new Error("UNAUTHORIZED");
    first ??= { session: page.session, usage: page.usage };
    history.push(...page.history);
    if (page.nextCursor === null) break;
    if (cursors.has(page.nextCursor) || page.history.length === 0)
      throw new Error("UNAVAILABLE");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
  const current = await api.request("session.current", {});
  if (!isCurrent() || current.sessionId !== sessionId)
    throw new Error("UNAUTHORIZED");
  return { ...first!, history };
}
