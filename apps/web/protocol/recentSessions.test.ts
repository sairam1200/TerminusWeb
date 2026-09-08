import { beforeEach, expect, it } from "vitest";
import { RecentSessions } from "./recentSessions";
const a = "30000000-0000-4000-8000-000000000001";
const b = "30000000-0000-4000-8000-000000000002";
const id = "k7m4-p2q9-wxyz";
beforeEach(() => localStorage.clear());
it("scopes canonical locators to exact profile and credential without storing content", () => {
  const store = new RecentSessions();
  store.update("host-profile-a", a, id, 1);
  expect(store.list("host-profile-a", a)).toEqual([
    { sessionId: id, lastUsedAt: 1 },
  ]);
  expect(store.list("host-profile-b", a)).toEqual([]);
  expect(store.list("host-profile-a", b)).toEqual([]);
  store.update("host-profile-a", a, id);
  expect(store.list("host-profile-a", a)).toEqual([]);
});
it("bounds all metadata to twenty records and discards invalid or overlong persisted data", () => {
  const store = new RecentSessions();
  for (let index = 0; index < 25; index++)
    store.update(`profile-${index}`, a, id, index);
  const key = localStorage.key(0)!;
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(20);
  localStorage.setItem(
    key,
    JSON.stringify([
      {
        scope: "a",
        credentialId: a,
        sessionId: id,
        lastUsedAt: 1,
        title: "forbidden extra field",
      },
    ]),
  );
  expect(store.list("a", a)).toEqual([]);
  localStorage.setItem(key, "not json");
  expect(store.list("a", a)).toEqual([]);
  store.update("a", a, "invalid", 1);
  expect(store.list("a", a)).toEqual([]);
});
it("treats denied browser storage as an unavailable optional feature", () => {
  const store = new RecentSessions(() => {
    throw new Error("denied");
  });
  expect(() => store.update("a", a, id, 1)).not.toThrow();
  expect(store.list("a", a)).toEqual([]);
});
