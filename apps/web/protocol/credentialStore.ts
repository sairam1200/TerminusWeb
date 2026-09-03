import { importCredentialKey } from "./auth";
import { isUuidV4 } from "./codec";
import { MAX_CREDENTIAL_LIFETIME_MS } from "./constants";

const DATABASE_NAME = "terminus-private-credentials-v0_1";
const DATABASE_VERSION = 1;
const CREDENTIAL_STORE = "credentials";
const META_STORE = "metadata";
const ACTIVE_CREDENTIAL_KEY = "active";
const CLIENT_INSTANCE_KEY = "client-instance-id";

export interface StoredCredential {
  credentialId: string;
  key: CryptoKey;
  expiresAt: string;
}

export interface CredentialStore {
  clearCredential(): Promise<void>;
  getClientInstanceId(): Promise<string>;
  loadCredential(): Promise<StoredCredential | undefined>;
  saveCredential(
    credentialId: string,
    credentialSecret: string,
    expiresAt: string,
  ): Promise<StoredCredential>;
}

interface StoredCredentialRecord extends StoredCredential {
  id: typeof ACTIVE_CREDENTIAL_KEY;
}

interface StoredMetadataRecord {
  id: typeof CLIENT_INSTANCE_KEY;
  value: string;
}

export class IndexedDbCredentialStore implements CredentialStore {
  constructor(
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
    private readonly cryptoProvider: Crypto = globalThis.crypto,
    private readonly now: () => number = Date.now,
  ) {}

  async clearCredential(): Promise<void> {
    const database = await this.open();
    await requestResult(
      database
        .transaction(CREDENTIAL_STORE, "readwrite")
        .objectStore(CREDENTIAL_STORE)
        .delete(ACTIVE_CREDENTIAL_KEY),
    );
    database.close();
  }

  async getClientInstanceId(): Promise<string> {
    const database = await this.open();
    const store = database
      .transaction(META_STORE, "readwrite")
      .objectStore(META_STORE);
    const existing = (await requestResult(store.get(CLIENT_INSTANCE_KEY))) as
      StoredMetadataRecord | undefined;
    if (existing !== undefined && isUuidV4(existing.value)) {
      database.close();
      return existing.value;
    }
    const value = this.cryptoProvider.randomUUID().toLowerCase();
    await requestResult(
      store.put({
        id: CLIENT_INSTANCE_KEY,
        value,
      } satisfies StoredMetadataRecord),
    );
    database.close();
    return value;
  }

  async loadCredential(): Promise<StoredCredential | undefined> {
    const database = await this.open();
    const store = database
      .transaction(CREDENTIAL_STORE, "readwrite")
      .objectStore(CREDENTIAL_STORE);
    const record = (await requestResult(store.get(ACTIVE_CREDENTIAL_KEY))) as
      StoredCredentialRecord | undefined;
    if (
      record === undefined ||
      !isUuidV4(record.credentialId) ||
      !isNonExtractableSigningKey(record.key) ||
      record.key.extractable ||
      !record.key.usages.includes("sign") ||
      !Number.isFinite(new Date(record.expiresAt).valueOf()) ||
      new Date(record.expiresAt).valueOf() <= this.now()
    ) {
      if (record !== undefined)
        await requestResult(store.delete(ACTIVE_CREDENTIAL_KEY));
      database.close();
      return undefined;
    }
    database.close();
    return {
      credentialId: record.credentialId,
      key: record.key,
      expiresAt: record.expiresAt,
    };
  }

  async saveCredential(
    credentialId: string,
    credentialSecret: string,
    expiresAt: string,
  ): Promise<StoredCredential> {
    const expiry = new Date(expiresAt).valueOf();
    const issuedAt = this.now();
    if (
      !isUuidV4(credentialId) ||
      !Number.isFinite(expiry) ||
      expiry <= issuedAt ||
      expiry - issuedAt > MAX_CREDENTIAL_LIFETIME_MS
    ) {
      throw new Error("Credential metadata is invalid or expired.");
    }
    const key = await importCredentialKey(
      credentialSecret,
      this.cryptoProvider,
    );
    const credential = { credentialId, key, expiresAt };
    const database = await this.open();
    await requestResult(
      database
        .transaction(CREDENTIAL_STORE, "readwrite")
        .objectStore(CREDENTIAL_STORE)
        .put({
          id: ACTIVE_CREDENTIAL_KEY,
          ...credential,
        } satisfies StoredCredentialRecord),
    );
    database.close();
    return credential;
  }

  private async open(): Promise<IDBDatabase> {
    if (this.indexedDb === undefined) {
      throw new Error("Protected browser credential storage is unavailable.");
    }
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CREDENTIAL_STORE)) {
          database.createObjectStore(CREDENTIAL_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "id" });
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB open failed."));
      request.onsuccess = () => resolve(request.result);
    });
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private credential?: StoredCredential;
  private clientInstanceId?: string;

  constructor(
    private readonly cryptoProvider: Crypto = globalThis.crypto,
    private readonly now: () => number = Date.now,
  ) {}

  async clearCredential(): Promise<void> {
    this.credential = undefined;
  }

  async getClientInstanceId(): Promise<string> {
    this.clientInstanceId ??= this.cryptoProvider.randomUUID().toLowerCase();
    return this.clientInstanceId;
  }

  async loadCredential(): Promise<StoredCredential | undefined> {
    if (
      this.credential !== undefined &&
      new Date(this.credential.expiresAt).valueOf() <= this.now()
    ) {
      this.credential = undefined;
    }
    return this.credential;
  }

  async saveCredential(
    credentialId: string,
    credentialSecret: string,
    expiresAt: string,
  ): Promise<StoredCredential> {
    const expiry = new Date(expiresAt).valueOf();
    const issuedAt = this.now();
    if (
      !isUuidV4(credentialId) ||
      !Number.isFinite(expiry) ||
      expiry <= issuedAt ||
      expiry - issuedAt > MAX_CREDENTIAL_LIFETIME_MS
    ) {
      throw new Error("Credential metadata is invalid or expired.");
    }
    const key = await importCredentialKey(
      credentialSecret,
      this.cryptoProvider,
    );
    this.credential = { credentialId, key, expiresAt };
    return this.credential;
  }
}

function isNonExtractableSigningKey(value: unknown): value is CryptoKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "extractable" in value &&
    value.extractable === false &&
    "usages" in value &&
    Array.isArray(value.usages) &&
    value.usages.includes("sign")
  );
}

function requestResult<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
