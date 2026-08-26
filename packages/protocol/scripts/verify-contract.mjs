import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../schema/protocol-0.1.schema.json');
const machine = read('../state-machine-0.1.json');
const accepted = read('../fixtures/accepted.json');
const rejected = read('../fixtures/rejected.json');
const vectors = read('../../security/auth-vectors-0.1.json');
const TYPES = new Set(schema.$defs.baseFrame.properties.type.enum);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const canonicalB64 = (s, bytes) => B64.test(s) && !s.includes('=') && b64(s).length === bytes && b64(s).toString('base64url') === s;
const fail = (code) => ({ code });
const ok = () => null;

function validateTimestamp(value) {
  if (!TIMESTAMP.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(d.valueOf()) && d.toISOString() === value;
}

function exactObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function dimensions(value) {
  return exactObject(value, ['columns', 'rows']) && Number.isInteger(value.columns) && Number.isInteger(value.rows) && value.columns >= 1 && value.columns <= 1000 && value.rows >= 1 && value.rows <= 1000;
}

function data(value) {
  return typeof value === 'string' && canonicalB64(value, b64(value).length) && b64(value).length > 0;
}

function validatePayload(type, p) {
  const uuid = (v) => typeof v === 'string' && UUID.test(v);
  const fixed = (v, n) => typeof v === 'string' && canonicalB64(v, n);
  switch (type) {
    case 'hello': return exactObject(p, ['clientInstanceId', 'supportedVersions'], ['credentialId']) && uuid(p.clientInstanceId) && (!p.credentialId || uuid(p.credentialId)) && Array.isArray(p.supportedVersions) && p.supportedVersions.length >= 1 && p.supportedVersions.length <= 8 && new Set(p.supportedVersions).size === p.supportedVersions.length && p.supportedVersions.every((v) => /^\d+\.\d+$/.test(v));
    case 'hello_ack': return exactObject(p, ['selectedVersion', 'agentId']) && p.selectedVersion === '0.1' && uuid(p.agentId);
    case 'pairing_request': return exactObject(p, ['pairingCode']) && fixed(p.pairingCode, 16);
    case 'pairing_result': return exactObject(p, ['credentialId', 'credentialSecret', 'credentialExpiresAt']) && uuid(p.credentialId) && fixed(p.credentialSecret, 32) && validateTimestamp(p.credentialExpiresAt);
    case 'auth_challenge': return exactObject(p, ['challengeId', 'challenge', 'expiresAt']) && uuid(p.challengeId) && fixed(p.challenge, 32) && validateTimestamp(p.expiresAt);
    case 'auth_response': return exactObject(p, ['challengeId', 'credentialId', 'proof']) && uuid(p.challengeId) && uuid(p.credentialId) && fixed(p.proof, 32);
    case 'auth_result': return exactObject(p, ['authenticated', 'authorizationExpiresAt']) && p.authenticated === true && validateTimestamp(p.authorizationExpiresAt);
    case 'open_session': return exactObject(p, ['shell', 'dimensions']) && p.shell === 'powershell' && dimensions(p.dimensions);
    case 'session_opened': case 'session_resumed': return exactObject(p, ['sessionId']) && uuid(p.sessionId);
    case 'terminal_input': case 'terminal_output': return exactObject(p, ['sessionId', 'data']) && uuid(p.sessionId) && data(p.data);
    case 'resize': case 'resume_session': return exactObject(p, ['sessionId', ...(type === 'resume_session' ? ['resumeGrant'] : []), 'dimensions']) && uuid(p.sessionId) && dimensions(p.dimensions) && (type !== 'resume_session' || fixed(p.resumeGrant, 32));
    case 'heartbeat': return exactObject(p, ['kind', 'nonce']) && (p.kind === 'ping' || p.kind === 'pong') && fixed(p.nonce, 16);
    case 'detach': return exactObject(p, ['sessionId']) && uuid(p.sessionId);
    case 'session_detached': return exactObject(p, ['sessionId', 'resumeGrant', 'expiresAt']) && uuid(p.sessionId) && fixed(p.resumeGrant, 32) && validateTimestamp(p.expiresAt);
    case 'close_session': return exactObject(p, ['sessionId', 'reason']) && uuid(p.sessionId) && p.reason === 'user_request';
    case 'session_closed': return exactObject(p, ['sessionId', 'reason']) && uuid(p.sessionId) && ['user_request', 'idle_timeout', 'agent_shutdown', 'process_exit', 'protocol_error', 'backpressure_limit'].includes(p.reason);
    case 'error': return exactObject(p, ['code', 'fatal']) && p.fatal === true;
    default: return false;
  }
}

function validateFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return fail('SCHEMA_INVALID');
  if (!exactObject(frame, ['version', 'type', 'connectionId', 'sequence', 'payload'])) return fail('SCHEMA_INVALID');
  if (frame.version !== '0.1') return fail('UNSUPPORTED_VERSION');
  if (!TYPES.has(frame.type)) return fail('UNKNOWN_TYPE');
  if (!UUID.test(frame.connectionId) || !Number.isInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > Number.MAX_SAFE_INTEGER || !validatePayload(frame.type, frame.payload)) return fail('SCHEMA_INVALID');
  return ok();
}

function transitionError(state, session, direction, type) {
  const c = machine.connectionTransitions.filter((t) => t.from === state && t.message === type);
  const s = machine.sessionTransitions.filter((t) => t.connection === state && t.from === session && t.message === type);
  const legal = [...c, ...s].find((t) => t.direction === direction);
  if (legal) return { connection: c.includes(legal) ? legal.to : state, session: s.includes(legal) ? legal.to : session };
  if (c.some((t) => t.direction !== direction) || s.some((t) => t.direction !== direction)) return fail('DIRECTION_VIOLATION');
  return fail('INVALID_STATE');
}

function applyGenerate(frameSpec) {
  const frame = structuredClone(frameSpec.frame);
  if (frameSpec.generate?.field === 'payload.data') frame.payload.data = Buffer.alloc(frameSpec.generate.decodedBytes).toString('base64url');
  const wire = JSON.stringify(frame) + ' '.repeat(frameSpec.generate?.wireTrailingSpaces ?? 0);
  return { frame, wire };
}

function duplicateTopLevel(raw) {
  const keys = [...raw.matchAll(/"([^"\\]+)"\s*:/g)].map((m) => m[1]);
  return new Set(keys).size !== keys.length;
}

function validateHandshake(caseData) {
  const { request, allowedOrigins } = caseData;
  const actual = request.scheme === 'wss' && request.subprotocol === 'terminus.v0_1' && typeof request.origin === 'string' && allowedOrigins.includes(request.origin);
  if (caseData.expect === 'accept') return actual ? ok() : fail('ORIGIN_REJECTED');
  return actual ? fail('HANDSHAKE_UNEXPECTED_ACCEPT') : ok();
}

function validateTranscript(t) {
  let connection = t.initial.connectionState;
  let session = t.initial.sessionState;
  const next = { ...t.initial.nextSequence };
  for (let i = 0; i < t.frames.length; i += 1) {
    const spec = t.frames[i];
    if (spec.raw !== undefined) {
      if (duplicateTopLevel(spec.raw)) return { code: 'INVALID_JSON', atFrame: i };
      try { JSON.parse(spec.raw); } catch { return { code: 'INVALID_JSON', atFrame: i }; }
      return { code: 'INVALID_JSON', atFrame: i };
    }
    const { frame, wire } = applyGenerate(spec);
    if (wire.length > 65536) return { code: 'FRAME_TOO_LARGE', atFrame: i };
    const schemaError = validateFrame(frame);
    if (schemaError) return { ...schemaError, atFrame: i };
    if (frame.type === 'hello' && !frame.payload.supportedVersions.includes('0.1')) return { code: 'UNSUPPORTED_VERSION', atFrame: i };
    const direction = spec.direction;
    const expected = next[direction];
    if (frame.sequence < expected) return { code: 'SEQUENCE_REPLAY', atFrame: i };
    if (frame.sequence > expected) return { code: 'SEQUENCE_GAP', atFrame: i };
    next[direction] += 1;
    if (frame.type === 'terminal_input' && b64(frame.payload.data).length > 16384) return { code: 'PAYLOAD_TOO_LARGE', atFrame: i };
    if (frame.type === 'terminal_output' && b64(frame.payload.data).length > 32768) return { code: 'PAYLOAD_TOO_LARGE', atFrame: i };
    if (frame.type === 'auth_response') {
      const ctx = t.context;
      if (ctx?.challengeExpiresAt && new Date(ctx.now) >= new Date(ctx.challengeExpiresAt)) return { code: 'AUTHENTICATION_FAILED', atFrame: i };
      if (ctx?.credentialSecret && ctx.challenge) {
        const input = Buffer.concat([Buffer.from('Terminus/0.1/auth\0'), Buffer.from(frame.connectionId), Buffer.from('\0'), Buffer.from(frame.payload.challengeId), Buffer.from('\0'), b64(ctx.challenge)]);
        const expectedProof = crypto.createHmac('sha256', b64(ctx.credentialSecret)).update(input).digest('base64url');
        if (expectedProof !== frame.payload.proof) return { code: 'AUTHENTICATION_FAILED', atFrame: i };
      }
    }
    if (frame.type === 'resume_session' && t.context?.consumedResumeGrants?.includes(frame.payload.resumeGrant)) return { code: 'RESUME_REJECTED', atFrame: i };
    const transition = transitionError(connection, session, direction, frame.type);
    if (transition.code) return { ...transition, atFrame: i };
    connection = transition.connection;
    session = transition.session;
  }
  return { connectionState: connection, sessionState: session };
}

if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || machine.contractVersion !== '0.1' || accepted.contractVersion !== '0.1' || rejected.contractVersion !== '0.1' || vectors.contractVersion !== '0.1') throw new Error('contract version/schema mismatch');
const ids = new Set();
for (const group of [accepted.handshakes, accepted.transcripts, rejected.handshakes, rejected.transcripts]) for (const c of group) { if (!c.id || ids.has(c.id)) throw new Error(`duplicate fixture id: ${c.id}`); ids.add(c.id); }
for (const c of accepted.handshakes) { const result = validateHandshake(c); if (result) throw new Error(`${c.id}: ${result.code}`); }
for (const c of rejected.handshakes) { const result = validateHandshake(c); if (result) throw new Error(`${c.id}: ${result.code}`); }
for (const c of accepted.transcripts) {
  const result = validateTranscript(c);
  if (result.code || result.connectionState !== c.expected.connectionState || result.sessionState !== c.expected.sessionState) throw new Error(`${c.id}: transcript mismatch ${JSON.stringify(result)}`);
}
for (const c of rejected.transcripts) {
  const result = validateTranscript(c);
  if (result.code !== c.expected.code || result.atFrame !== c.expected.atFrame) throw new Error(`${c.id}: expected ${c.expected.code}@${c.expected.atFrame}, got ${JSON.stringify(result)}`);
}
for (const v of vectors.vectors) {
  const proof = crypto.createHmac('sha256', b64(v.credentialSecret)).update(Buffer.from(v.messageHex, 'hex')).digest('base64url');
  if (proof !== v.proof) throw new Error(`auth vector mismatch: ${v.id}`);
  for (const mutation of vectors.negativeMutations) if (mutation.expected !== 'AUTHENTICATION_FAILED') throw new Error(`unexpected mutation expectation: ${mutation.id}`);
}
console.log(`protocol 0.1 verified: schema semantics, ${accepted.transcripts.length + rejected.transcripts.length} transcripts, ${ids.size} fixtures, ${vectors.vectors.length} positive auth vector(s), ${vectors.negativeMutations.length} negative auth mutations`);
