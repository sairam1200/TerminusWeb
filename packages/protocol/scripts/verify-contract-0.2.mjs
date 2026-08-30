import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const schema = read('../schema/protocol-0.2.schema.json');
const machine = read('../state-machine-0.2.json');
const accepted = read('../fixtures/accepted-0.2.json');
const rejected = read('../fixtures/rejected-0.2.json');
const vectors = read('../../security/auth-vectors-0.2.json');

const TYPES = new Set(schema.$defs.baseFrame.properties.type.enum);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION = /^[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/;
const TIMESTAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const decode = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const canonicalB64 = (value, bytes) => typeof value === 'string' && B64.test(value) && !value.includes('=') && decode(value).length === bytes && decode(value).toString('base64url') === value;
const data = (value) => typeof value === 'string' && B64.test(value) && !value.includes('=') && decode(value).length > 0 && decode(value).toString('base64url') === value;
const exact = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const timestamp = (value) => typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(new Date(value).valueOf()) && new Date(value).toISOString() === value;
const offset = (value) => Number.isSafeInteger(value) && value >= 0;
const dimensions = (value) => exact(value, ['columns', 'rows']) && Number.isInteger(value.columns) && value.columns >= 1 && value.columns <= 1000 && Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 1000;
const fail = (code) => ({ code });

function schemaValid(value, rule, root = schema) {
  if (rule.$ref) return schemaValid(value, rule.$ref.split('/').slice(1).reduce((node, key) => node[key], root), root);
  if (rule.oneOf && rule.oneOf.filter((candidate) => schemaValid(value, candidate, root)).length !== 1) return false;
  if (rule.allOf && !rule.allOf.every((candidate) => schemaValid(value, candidate, root))) return false;
  if (rule.const !== undefined && value !== rule.const) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return false;
  if (rule.type === 'array' && !Array.isArray(value)) return false;
  if (rule.type === 'string' && typeof value !== 'string') return false;
  if (rule.type === 'integer' && !Number.isInteger(value)) return false;
  if (rule.type === 'boolean' && typeof value !== 'boolean') return false;
  if (rule.required && !rule.required.every((key) => Object.hasOwn(value, key))) return false;
  if (rule.additionalProperties === false && rule.properties && Object.keys(value).some((key) => !Object.hasOwn(rule.properties, key))) return false;
  if (rule.properties && !Object.entries(rule.properties).every(([key, child]) => value[key] === undefined || schemaValid(value[key], child, root))) return false;
  if (rule.type === 'array') {
    if (rule.minItems !== undefined && value.length < rule.minItems) return false;
    if (rule.maxItems !== undefined && value.length > rule.maxItems) return false;
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return false;
    if (rule.items && !value.every((item) => schemaValid(item, rule.items, root))) return false;
  }
  if (rule.pattern && (typeof value !== 'string' || !(new RegExp(rule.pattern).test(value)))) return false;
  if (rule.minLength !== undefined && value.length < rule.minLength) return false;
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return false;
  if (rule.minimum !== undefined && value < rule.minimum) return false;
  if (rule.maximum !== undefined && value > rule.maximum) return false;
  return true;
}

function payloadValid(type, payload) {
  const session = (value) => typeof value === 'string' && SESSION.test(value);
  const uuid = (value) => typeof value === 'string' && UUID.test(value);
  switch (type) {
    case 'hello': return exact(payload, ['clientInstanceId', 'supportedVersions'], ['credentialId']) && uuid(payload.clientInstanceId) && (payload.credentialId === undefined || uuid(payload.credentialId)) && Array.isArray(payload.supportedVersions) && payload.supportedVersions.length >= 1 && payload.supportedVersions.length <= 8 && new Set(payload.supportedVersions).size === payload.supportedVersions.length && payload.supportedVersions.every((v) => /^\d+\.\d+$/.test(v));
    case 'hello_ack': return exact(payload, ['selectedVersion', 'agentId']) && payload.selectedVersion === '0.2' && uuid(payload.agentId);
    case 'pairing_request': return exact(payload, ['pairingCode']) && canonicalB64(payload.pairingCode, 16);
    case 'pairing_result': return exact(payload, ['credentialId', 'credentialSecret', 'credentialExpiresAt']) && uuid(payload.credentialId) && canonicalB64(payload.credentialSecret, 32) && timestamp(payload.credentialExpiresAt);
    case 'auth_challenge': return exact(payload, ['challengeId', 'challenge', 'expiresAt']) && uuid(payload.challengeId) && canonicalB64(payload.challenge, 32) && timestamp(payload.expiresAt);
    case 'auth_response': return exact(payload, ['challengeId', 'credentialId', 'proof']) && uuid(payload.challengeId) && uuid(payload.credentialId) && canonicalB64(payload.proof, 32);
    case 'auth_result': return exact(payload, ['authenticated', 'authorizationExpiresAt']) && payload.authenticated === true && timestamp(payload.authorizationExpiresAt);
    case 'open_session': return exact(payload, ['shell', 'dimensions']) && payload.shell === 'powershell' && dimensions(payload.dimensions);
    case 'session_opened': case 'session_reopened': case 'detach': case 'session_detached': return exact(payload, ['sessionId']) && session(payload.sessionId);
    case 'reopen_session': case 'resize': return exact(payload, ['sessionId', 'dimensions']) && session(payload.sessionId) && dimensions(payload.dimensions);
    case 'terminal_input': return exact(payload, ['sessionId', 'data']) && session(payload.sessionId) && data(payload.data);
    case 'terminal_output': case 'history_chunk': return exact(payload, ['sessionId', 'offset', 'data']) && session(payload.sessionId) && offset(payload.offset) && data(payload.data);
    case 'history_begin': return exact(payload, ['sessionId', 'startOffset', 'endOffset', 'truncated']) && session(payload.sessionId) && offset(payload.startOffset) && offset(payload.endOffset) && typeof payload.truncated === 'boolean';
    case 'history_end': return exact(payload, ['sessionId', 'endOffset']) && session(payload.sessionId) && offset(payload.endOffset);
    case 'heartbeat': return exact(payload, ['kind', 'nonce']) && ['ping', 'pong'].includes(payload.kind) && canonicalB64(payload.nonce, 16);
    case 'close_session': return exact(payload, ['sessionId', 'reason']) && session(payload.sessionId) && ['user_request', 'new_session'].includes(payload.reason);
    case 'session_closed': return exact(payload, ['sessionId', 'reason']) && session(payload.sessionId) && ['user_request', 'new_session', 'credential_expired', 'credential_revoked', 'agent_shutdown', 'process_exit', 'protocol_error', 'backpressure_limit'].includes(payload.reason);
    case 'error': return exact(payload, ['code', 'fatal']) && schema.$defs.errorPayload.properties.code.enum.includes(payload.code) && payload.fatal === true;
    default: return false;
  }
}

function validateFrame(frame) {
  if (!exact(frame, ['version', 'type', 'connectionId', 'sequence', 'payload'])) return fail('SCHEMA_INVALID');
  if (frame.version !== '0.2') return fail('UNSUPPORTED_VERSION');
  if (!TYPES.has(frame.type)) return fail('UNKNOWN_TYPE');
  const frameDef = `${frame.type.split('_').map((part, index) => index ? part[0].toUpperCase() + part.slice(1) : part).join('')}Frame`;
  if (!schema.$defs[frameDef] || !schemaValid(frame, schema.$defs[frameDef]) || !UUID.test(frame.connectionId) || !offset(frame.sequence) || !payloadValid(frame.type, frame.payload)) return fail('SCHEMA_INVALID');
  return null;
}

function transition(state, session, direction, type) {
  const connectionCandidates = machine.connectionTransitions.filter((item) => item.from === state && item.message === type);
  const sessionCandidates = machine.sessionTransitions.filter((item) => item.connection === state && item.from === session && item.message === type);
  const candidate = [...connectionCandidates, ...sessionCandidates].find((item) => item.direction === direction);
  if (candidate) return { connection: connectionCandidates.includes(candidate) ? candidate.to : state, session: sessionCandidates.includes(candidate) ? candidate.to : session };
  if ([...connectionCandidates, ...sessionCandidates].length) return fail('DIRECTION_VIOLATION');
  return fail('INVALID_STATE');
}

function generated(spec) {
  const frame = structuredClone(spec.frame);
  if (spec.generate?.field === 'payload.data') frame.payload.data = Buffer.alloc(spec.generate.decodedBytes).toString('base64url');
  return { frame, wire: JSON.stringify(frame) + ' '.repeat(spec.generate?.wireTrailingSpaces ?? 0) };
}

function validateHandshake(item) {
  const valid = item.request.scheme === 'wss' && item.request.subprotocol === 'terminus.v0_2' && typeof item.request.origin === 'string' && item.allowedOrigins.includes(item.request.origin);
  const result = valid ? { code: 'ACCEPT', httpStatus: 101 } : item.request.subprotocol !== 'terminus.v0_2' ? { code: 'UNSUPPORTED_VERSION', httpStatus: 426 } : { code: 'ORIGIN_REJECTED', httpStatus: 403 };
  if (item.expect === 'accept') return result.code === 'ACCEPT' ? null : fail(result.code);
  return result.code === item.expected.code && result.httpStatus === item.expected.httpStatus ? null : fail('HANDSHAKE_EXPECTATION_MISMATCH');
}

function validateTranscript(item) {
  let connection = item.initial.connectionState;
  let session = item.initial.sessionState;
  let nextOutputOffset = item.initial.nextOutputOffset ?? 0;
  let history = item.initial.history ? { ...item.initial.history } : null;
  let sessionId;
  let connectionId;
  const next = { ...item.initial.nextSequence };
  for (let index = 0; index < item.frames.length; index += 1) {
    const spec = item.frames[index];
    if (spec.raw !== undefined) {
      try { JSON.parse(spec.raw); } catch { return { code: 'INVALID_JSON', atFrame: index }; }
      return { code: 'INVALID_JSON', atFrame: index };
    }
    const { frame, wire } = generated(spec);
    if (Buffer.byteLength(wire, 'utf8') > 65536) return { code: 'FRAME_TOO_LARGE', atFrame: index };
    const frameFailure = validateFrame(frame);
    if (frameFailure) return { ...frameFailure, atFrame: index };
    if (connectionId === undefined) connectionId = frame.connectionId;
    if (frame.connectionId !== connectionId) return { code: 'SCHEMA_INVALID', atFrame: index };
    if (frame.type === 'hello' && !frame.payload.supportedVersions.includes('0.2')) return { code: 'UNSUPPORTED_VERSION', atFrame: index };
    if (frame.sequence < next[spec.direction]) return { code: 'SEQUENCE_REPLAY', atFrame: index };
    if (frame.sequence > next[spec.direction]) return { code: 'SEQUENCE_GAP', atFrame: index };
    next[spec.direction] += 1;
    if (frame.payload.sessionId !== undefined) {
      if (sessionId === undefined) sessionId = frame.payload.sessionId;
      if (sessionId !== frame.payload.sessionId) return { code: 'SCHEMA_INVALID', atFrame: index };
    }
    if (frame.type === 'terminal_input' && decode(frame.payload.data).length > 16384) return { code: 'PAYLOAD_TOO_LARGE', atFrame: index };
    if (['terminal_output', 'history_chunk'].includes(frame.type) && decode(frame.payload.data).length > 32768) return { code: 'PAYLOAD_TOO_LARGE', atFrame: index };
    if (frame.type === 'reopen_session' && item.context?.reopenAllowed === false) return { code: 'SESSION_REOPEN_REJECTED', atFrame: index };
    if (frame.type === 'history_begin') {
      if (history || frame.payload.startOffset > frame.payload.endOffset || (!frame.payload.truncated && frame.payload.startOffset !== 0) || frame.payload.endOffset !== nextOutputOffset) return { code: 'OUTPUT_OFFSET_INVALID', atFrame: index };
      history = { begun: true, cursor: frame.payload.startOffset, endOffset: frame.payload.endOffset };
    }
    if (frame.type === 'history_chunk') {
      const length = decode(frame.payload.data).length;
      if (!history?.begun || frame.payload.offset !== history.cursor || history.cursor + length > history.endOffset || history.cursor + length > MAX_SAFE) return { code: 'OUTPUT_OFFSET_INVALID', atFrame: index };
      history.cursor += length;
    }
    if (frame.type === 'history_end') {
      if (!history?.begun || frame.payload.endOffset !== history.endOffset || history.cursor !== history.endOffset) return { code: 'OUTPUT_OFFSET_INVALID', atFrame: index };
      history = null;
    }
    if (frame.type === 'terminal_output') {
      const length = decode(frame.payload.data).length;
      if (frame.payload.offset !== nextOutputOffset || nextOutputOffset + length > MAX_SAFE) return { code: 'OUTPUT_OFFSET_INVALID', atFrame: index };
      nextOutputOffset += length;
    }
    const nextState = transition(connection, session, spec.direction, frame.type);
    if (nextState.code) return { ...nextState, atFrame: index };
    connection = nextState.connection;
    session = nextState.session;
  }
  return { connectionState: connection, sessionState: session, nextOutputOffset };
}

function authenticate(response, vector) {
  if (response.connectionId !== vector.connectionId || response.challengeId !== vector.challengeId || !canonicalB64(response.proof, 32)) return 'AUTHENTICATION_FAILED';
  const expected = crypto.createHmac('sha256', decode(vector.credentialSecret)).update(Buffer.from(vector.messageHex, 'hex')).digest();
  const actual = decode(response.proof);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? 'AUTHENTICATED' : 'AUTHENTICATION_FAILED';
}

if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || [machine, accepted, rejected, vectors].some((artifact) => artifact.contractVersion !== '0.2')) throw new Error('0.2 contract version/schema mismatch');
const ids = new Set();
for (const group of [accepted.handshakes, accepted.transcripts, rejected.handshakes, rejected.transcripts]) for (const item of group) { if (!item.id || ids.has(item.id)) throw new Error(`duplicate fixture id: ${item.id}`); ids.add(item.id); }
for (const item of accepted.handshakes) { const result = validateHandshake(item); if (result) throw new Error(`${item.id}: ${result.code}`); }
for (const item of rejected.handshakes) { const result = validateHandshake(item); if (result) throw new Error(`${item.id}: ${result.code}`); }
for (const item of accepted.transcripts) {
  const result = validateTranscript(item);
  if (result.code || result.connectionState !== item.expected.connectionState || result.sessionState !== item.expected.sessionState || result.nextOutputOffset !== item.expected.nextOutputOffset) throw new Error(`${item.id}: transcript mismatch ${JSON.stringify(result)}`);
}
for (const item of rejected.transcripts) {
  const result = validateTranscript(item);
  if (result.code !== item.expected.code || result.atFrame !== item.expected.atFrame) throw new Error(`${item.id}: expected ${item.expected.code}@${item.expected.atFrame}, got ${JSON.stringify(result)}`);
}
for (const vector of vectors.vectors) {
  const proof = crypto.createHmac('sha256', decode(vector.credentialSecret)).update(Buffer.from(vector.messageHex, 'hex')).digest('base64url');
  if (proof !== vector.proof || authenticate({ connectionId: vector.connectionId, challengeId: vector.challengeId, proof }, vector) !== 'AUTHENTICATED') throw new Error(`auth vector mismatch: ${vector.id}`);
  const message = (connectionId, challengeId, challenge) => Buffer.concat([Buffer.from('Terminus/0.2/auth\0'), Buffer.from(connectionId), Buffer.from('\0'), Buffer.from(challengeId), Buffer.from('\0'), decode(challenge)]);
  for (const mutation of vectors.negativeMutations) {
    const connectionId = mutation.field === 'connectionId' ? mutation.value : vector.connectionId;
    const challengeId = mutation.field === 'challengeId' ? mutation.value : vector.challengeId;
    const challenge = mutation.field === 'challenge' ? mutation.value : vector.challenge;
    const candidate = mutation.field === 'proof' ? mutation.value : crypto.createHmac('sha256', decode(vector.credentialSecret)).update(message(connectionId, challengeId, challenge)).digest('base64url');
    const response = { connectionId, challengeId, proof: candidate };
    if (mutation.field === 'challenge') response.challengeId = vector.challengeId;
    if (candidate === vector.proof || authenticate(response, vector) !== 'AUTHENTICATION_FAILED') throw new Error(`negative mutation accepted: ${mutation.id}`);
  }
}

console.log(`protocol 0.2 verified: schema semantics, ${accepted.transcripts.length + rejected.transcripts.length} transcripts, ${ids.size} fixtures, ${vectors.vectors.length} positive auth vector(s), ${vectors.negativeMutations.length} negative auth mutations`);
