import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IndexedDbCredentialStore } from "./credentialStore";

const cryptoProvider = webcrypto as unknown as Crypto;

describe("IndexedDbCredentialStore", () => {
  it("persists only a non-extractable HMAC key and non-secret metadata", async () => {
    const store = new IndexedDbCredentialStore(
      new IDBFactory(),
      cryptoProvider,
      () => Date.parse("2026-08-26T12:00:00.000Z"),
    );

    await store.saveCredential(
      "30000000-0000-4000-8000-000000000001",
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      "2026-09-25T12:00:00.000Z",
    );
    const credential = await store.loadCredential();

    expect(credential?.credentialId).toBe(
      "30000000-0000-4000-8000-000000000001",
    );
    expect(credential?.key.extractable).toBe(false);
    expect(credential?.key.usages).toEqual(["sign"]);
    await expect(
      cryptoProvider.subtle.exportKey("raw", credential?.key as CryptoKey),
    ).rejects.toThrow();
  });

  it("deletes an expired credential and retains only a non-secret client UUID", async () => {
    const now = { value: Date.parse("2026-08-26T12:00:00.000Z") };
    const store = new IndexedDbCredentialStore(
      new IDBFactory(),
      cryptoProvider,
      () => now.value,
    );
    const clientInstanceId = await store.getClientInstanceId();
    await store.saveCredential(
      "30000000-0000-4000-8000-000000000001",
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      "2026-08-26T12:00:01.000Z",
    );

    now.value = Date.parse("2026-08-26T12:00:01.000Z");
    expect(await store.loadCredential()).toBeUndefined();
    expect(await store.getClientInstanceId()).toBe(clientInstanceId);
  });
});
