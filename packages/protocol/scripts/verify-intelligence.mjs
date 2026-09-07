import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const vectors = JSON.parse(readFileSync(new URL("../intelligence-auth-vectors-1.0.json", import.meta.url), "utf8"));
const value = vectors.positive;
const key = Buffer.from(value.credentialSecret, "base64url");
const nonce = Buffer.from(value.challenge, "base64url");
function proof(domain, connectionId, challengeId, challenge, secret = key) {
  const message = Buffer.concat([Buffer.from(`${domain}\0${connectionId}\0${challengeId}\0`), challenge]);
  return createHmac("sha256", secret).update(message).digest("base64url");
}
const domain = "Terminus/intelligence/1/auth";
assert.equal(proof(domain, value.connectionId, value.challengeId, nonce), value.proof);
for (const candidate of [
  proof("Terminus/0.2/auth", value.connectionId, value.challengeId, nonce),
  proof(domain, "33333333-3333-4333-8333-333333333333", value.challengeId, nonce),
  proof(domain, value.connectionId, "33333333-3333-4333-8333-333333333333", nonce),
  proof(domain, value.connectionId, value.challengeId, Buffer.alloc(32)),
  proof(domain, value.connectionId, value.challengeId, nonce, Buffer.alloc(32)),
]) assert.notEqual(candidate, value.proof);
assert.equal(key.length, 32);
assert.equal(nonce.length, 32);
console.log("PASS: intelligence 1.0 HMAC vector and 5 negative domain/binding mutations");
