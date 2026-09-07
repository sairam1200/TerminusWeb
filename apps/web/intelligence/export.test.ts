import { expect, it, vi } from "vitest";
import { collectPrivateExport } from "./export";
import type { IntelligenceApi } from "./types";
const session = { sessionId: "owner-a" };
const usage = { totalTokens: 1 };
it("combines all export pages preserving first snapshot and opaque cursors", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      session,
      usage,
      history: [{ id: "first" }],
      nextCursor: "22222222-2222-4222-8222-222222222222",
    })
    .mockResolvedValueOnce({
      session,
      usage: { totalTokens: 2 },
      history: [{ id: "second" }],
      nextCursor: null,
    })
    .mockResolvedValueOnce(session);
  const result = await collectPrivateExport(
    { request } as IntelligenceApi,
    "owner-a",
    () => true,
  );
  expect(result.history).toEqual([{ id: "first" }, { id: "second" }]);
  expect(result.usage).toEqual(usage);
  expect(request.mock.calls).toEqual([
    ["data.export", {}],
    ["data.export", { cursor: "22222222-2222-4222-8222-222222222222" }],
    ["session.current", {}],
  ]);
});
it("discards the export when another owner appears on a later page", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      session,
      usage,
      history: [{ id: "first" }],
      nextCursor: "22222222-2222-4222-8222-222222222222",
    })
    .mockResolvedValueOnce({
      session: { sessionId: "owner-b" },
      usage,
      history: [],
      nextCursor: null,
    });
  await expect(
    collectPrivateExport({ request } as IntelligenceApi, "owner-a", () => true),
  ).rejects.toThrow("UNAUTHORIZED");
});
it("cancels a pending export on client identity rotation", async () => {
  let current = true;
  const request = vi.fn().mockImplementation(async () => {
    current = false;
    return { session, usage, history: [], nextCursor: null };
  });
  await expect(
    collectPrivateExport(
      { request } as IntelligenceApi,
      "owner-a",
      () => current,
    ),
  ).rejects.toThrow("UNAUTHORIZED");
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects repeated cursors instead of looping or downloading partial data", async () => {
  const request = vi.fn().mockResolvedValue({
    session,
    usage,
    history: [{ id: "first" }],
    nextCursor: "22222222-2222-4222-8222-222222222222",
  });
  await expect(
    collectPrivateExport({ request } as IntelligenceApi, "owner-a", () => true),
  ).rejects.toThrow("UNAVAILABLE");
  expect(request).toHaveBeenCalledTimes(2);
});
