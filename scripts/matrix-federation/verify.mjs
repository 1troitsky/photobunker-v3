// P4 #238: read-only two-homeserver Matrix metadata probe.
// Deliberately NOT an E2EE decrypt, a federation protocol certificate, or a release gate.
import { pathToFileURL } from 'node:url';

export class ProbeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProbeFailure';
    this.code = code;
  }
}

function fail(code) { throw new ProbeFailure(code); }

function bounded(value, code, min = 1, max = 4096) {
  if (typeof value !== 'string' || value.length < min || value.length > max ||
      /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function origin(raw) {
  const value = bounded(raw, 'INVALID_HOMESERVER_URL', 8, 2048);
  let url;
  try { url = new URL(value); } catch { fail('INVALID_HOMESERVER_URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== '/') fail('UNSAFE_HOMESERVER_URL');
  return url.origin;
}

function mxid(raw) {
  const value = bounded(raw, 'INVALID_MXID', 4, 512);
  if (!/^@[^\s:]+:[^\s/]+$/u.test(value)) fail('INVALID_MXID');
  return value;
}

function serverName(mxidValue) {
  return mxidValue.slice(mxidValue.indexOf(':') + 1).toLowerCase();
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') fail('MISSING_CONFIG');
  const aUrl = origin(raw.aUrl);
  const bUrl = origin(raw.bUrl);
  const outsiderUrl = origin(raw.outsiderUrl ?? raw.bUrl);
  if (aUrl === bUrl) fail('SAME_HOMESERVER_ORIGIN');
  if (outsiderUrl !== aUrl && outsiderUrl !== bUrl) fail('OUTSIDER_NOT_ON_TEST_SERVERS');

  const aUser = mxid(raw.aUser), bUser = mxid(raw.bUser);
  const outsiderUser = mxid(raw.outsiderUser);
  if (new Set([aUser, bUser, outsiderUser]).size !== 3) fail('DUPLICATE_ACCOUNT');
  if (serverName(aUser) === serverName(bUser)) fail('SAME_MATRIX_SERVER_NAME');

  const roomId = bounded(raw.roomId, 'INVALID_ROOM_ID', 3, 512);
  const eventId = bounded(raw.eventId, 'INVALID_EVENT_ID', 2, 512);
  if (!roomId.startsWith('!') || !roomId.includes(':') ||
      /[\s/?#]/u.test(roomId) || !eventId.startsWith('$') ||
      /[\s/?#]/u.test(eventId)) fail('INVALID_MATRIX_IDENTIFIER');

  const aToken = bounded(raw.aToken, 'MISSING_CREDENTIAL', 8, 8192);
  const bToken = bounded(raw.bToken, 'MISSING_CREDENTIAL', 8, 8192);
  const outsiderToken = bounded(raw.outsiderToken, 'MISSING_CREDENTIAL', 8, 8192);
  if (new Set([aToken, bToken, outsiderToken]).size !== 3) fail('SHARED_ACCESS_TOKEN');

  return { aUrl, bUrl, outsiderUrl, aUser, bUser, outsiderUser,
    roomId, eventId, aToken, bToken, outsiderToken };
}

function clientPath(...segments) {
  return '/_matrix/client/v3/' + segments.map(s => encodeURIComponent(s)).join('/');
}

async function fetchJson(fetchImpl, base, token, path, allowDenied = false) {
  let response;
  try {
    response = await fetchImpl(base + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch { fail('MATRIX_TRANSPORT_FAILED'); }
  if (allowDenied && [403, 404].includes(response.status)) return { denied: true };
  if (response.status !== 200) fail('MATRIX_HTTP_STATUS_REJECTED');
  let body;
  try {
    const rawBody = await response.text();
    if (rawBody.length > 262_144) fail('MATRIX_RESPONSE_TOO_LARGE');
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail('MATRIX_INVALID_RESPONSE');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('MATRIX_INVALID_RESPONSE');
  return body;
}

function identity(body, expected) {
  if (body.user_id !== expected ||
      typeof body.device_id !== 'string' || body.device_id.length < 1 ||
      body.device_id.length > 256) fail('MATRIX_WHOAMI_MISMATCH');
}

function joined(body, aUser, bUser, outsiderUser) {
  const members = body.joined;
  if (!members || typeof members !== 'object' || Array.isArray(members) ||
      !Object.prototype.hasOwnProperty.call(members, aUser) ||
      !Object.prototype.hasOwnProperty.call(members, bUser) ||
      Object.prototype.hasOwnProperty.call(members, outsiderUser)) {
    fail('MATRIX_MEMBERSHIP_MISMATCH');
  }
}

function encryptedEvidence(body, config) {
  if (body.event_id !== config.eventId || body.room_id !== config.roomId ||
      body.type !== 'm.room.encrypted' ||
      ![config.aUser, config.bUser].includes(body.sender)) fail('MATRIX_ENCRYPTED_EVENT_MISMATCH');
  const c = body.content;
  if (!c || c.algorithm !== 'm.megolm.v1.aes-sha2' ||
      typeof c.ciphertext !== 'string' || c.ciphertext.length < 8 ||
      typeof c.session_id !== 'string' || !c.session_id ||
      typeof c.sender_key !== 'string' || !c.sender_key) fail('MATRIX_ENCRYPTED_EVENT_INVALID');
  // Never return, print or persist message ciphertext, metadata or access tokens.
  return [body.event_id, body.room_id, body.sender, c.algorithm,
    c.ciphertext, c.session_id, c.sender_key];
}

export async function verifyTwoServers(rawConfig, fetchImpl = fetch) {
  const c = validateConfig(rawConfig);
  const whoami = clientPath('account', 'whoami');
  // Sequential requests make failures deterministic and avoid extra token traffic after a denial.
  identity(await fetchJson(fetchImpl, c.aUrl, c.aToken, whoami), c.aUser);
  identity(await fetchJson(fetchImpl, c.bUrl, c.bToken, whoami), c.bUser);
  identity(await fetchJson(fetchImpl, c.outsiderUrl, c.outsiderToken, whoami), c.outsiderUser);

  const members = clientPath('rooms', c.roomId, 'joined_members');
  joined(await fetchJson(fetchImpl, c.aUrl, c.aToken, members), c.aUser, c.bUser, c.outsiderUser);
  joined(await fetchJson(fetchImpl, c.bUrl, c.bToken, members), c.aUser, c.bUser, c.outsiderUser);

  const eventPath = clientPath('rooms', c.roomId, 'event', c.eventId);
  const left = encryptedEvidence(
    await fetchJson(fetchImpl, c.aUrl, c.aToken, eventPath), c);
  const right = encryptedEvidence(
    await fetchJson(fetchImpl, c.bUrl, c.bToken, eventPath), c);
  if (JSON.stringify(left) !== JSON.stringify(right)) fail('MATRIX_EVENT_DIVERGENCE');

  const outside = await fetchJson(
    fetchImpl, c.outsiderUrl, c.outsiderToken, eventPath, true);
  if (!outside.denied) fail('MATRIX_OUTSIDER_CAN_READ_EVENT');

  return Object.freeze({
    status: 'PASS',
    scope: 'read-only-cross-server-metadata-only',
    independentOrigins: true,
    independentMatrixServerNames: true,
    sameEncryptedEventVisible: true,
    outsiderReadDenied: true,
    decryptedE2EE: 'NOT_TESTED',
    keyRecovery: 'NOT_TESTED',
    voiceAndMedia: 'NOT_TESTED',
    matrixOutageIsolation: 'NOT_TESTED',
    physicalDevices: 'NOT_TESTED',
  });
}

function fromEnvironment(env) {
  return {
    aUrl: env.MATRIX_FED_A_URL, bUrl: env.MATRIX_FED_B_URL,
    outsiderUrl: env.MATRIX_FED_OUTSIDER_URL,
    aUser: env.MATRIX_FED_A_USER, bUser: env.MATRIX_FED_B_USER,
    outsiderUser: env.MATRIX_FED_OUTSIDER_USER,
    roomId: env.MATRIX_FED_ROOM_ID, eventId: env.MATRIX_FED_EVENT_ID,
    aToken: env.MATRIX_FED_A_TOKEN, bToken: env.MATRIX_FED_B_TOKEN,
    outsiderToken: env.MATRIX_FED_OUTSIDER_TOKEN,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--live') {
    console.error('NOT TESTED: no live network requests. Supply --live with 3 separately authenticated disposable Matrix test users.');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyTwoServers(fromEnvironment(process.env));
      console.log(JSON.stringify(result)); // Explicitly bounded, contains no secrets.
    } catch (error) {
      console.error('FAIL: ' + (error instanceof ProbeFailure ? error.code : 'UNEXPECTED_PROBE_ERROR'));
      process.exitCode = 1;
    }
  }
}
