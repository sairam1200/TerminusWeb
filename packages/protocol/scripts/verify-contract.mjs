import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../schema/protocol-0.1.schema.json');
const machine = read('../state-machine-0.1.json');
const accepted = read('../fixtures/accepted.json');
const rejected = read('../fixtures/rejected.json');
const vectors = read('../../security/auth-vectors-0.1.json');
if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('wrong schema draft');
if (machine.contractVersion !== '0.1' || accepted.contractVersion !== '0.1' || rejected.contractVersion !== '0.1' || vectors.contractVersion !== '0.1') throw new Error('contract version mismatch');
if (!accepted.handshakes?.length || !accepted.transcripts?.length || !rejected.handshakes?.length || !rejected.transcripts?.length) throw new Error('fixtures incomplete');
const ids = new Set();
for (const group of [accepted.handshakes, accepted.transcripts, rejected.handshakes, rejected.transcripts]) for (const c of group) { if (!c.id || ids.has(c.id)) throw new Error(`duplicate fixture id: ${c.id}`); ids.add(c.id); if (!c.expected && !c.expectedDecision && !c.expect) throw new Error(`missing expected: ${c.id}`); }
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
for (const v of vectors.vectors) {
  const msg = Buffer.from(v.messageHex, 'hex');
  const proof = crypto.createHmac('sha256', b64(v.credentialSecret)).update(msg).digest('base64url');
  if (proof !== v.proof) throw new Error(`auth vector mismatch: ${v.id}`);
}
console.log(`protocol 0.1 verified: schema, state machine, ${ids.size} fixtures, ${vectors.vectors.length} auth vector(s)`);
