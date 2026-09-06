import { decodeBase64Url, encodeBase64Url } from "./codec";

const AUTH_DOMAIN = new TextEncoder().encode("Terminus/0.2/auth\0");
const NULL_BYTE = new Uint8Array([0]);

export async function importCredentialKey(
  credentialSecret: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  const secret = decodeBase64Url(credentialSecret, 32);
  try {
    return await cryptoProvider.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } finally {
    secret.fill(0);
  }
}

export async function computeAuthenticationProof(
  key: CryptoKey,
  connectionId: string,
  challengeId: string,
  challenge: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<string> {
  const encoder = new TextEncoder();
  const message = concatenate(
    AUTH_DOMAIN,
    encoder.encode(connectionId),
    NULL_BYTE,
    encoder.encode(challengeId),
    NULL_BYTE,
    decodeBase64Url(challenge, 32),
  );
  const proof = await cryptoProvider.subtle.sign("HMAC", key, message);
  return encodeBase64Url(new Uint8Array(proof));
}

function concatenate(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(
    parts.reduce((total, part) => total + part.length, 0),
  );
  const output = new Uint8Array(buffer);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
