import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyTwoServers, validateConfig, ProbeFailure } from './verify.mjs';

function config(overrides = {}) {
  return {
    aUrl: 'https://a.example.test',
    bUrl: 'https://b.example.test',
    aUser: '@alice:a.example.test',
    bUser: '@bob:b.example.test',
    outsiderUser: '@outsider:b.example.test',
    roomId: '!private-room:a.example.test',
    eventId: '$encrypted-event',
    aToken: 'disposable-token-a',
    bToken: 'disposable-token-b',
    outsiderToken: 'disposable-token-c',
    ...overrides,
  };
}

const encrypted = {
  event_id: '$encrypted-event',
  room_id: '!private-room:a.example.test',
  sender: '@alice:a.example.test',
  type: 'm.room.encrypted',
  content: {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: 'opaque-ciphertext-without-plaintext',
    session_id: 'opaque-session',
    sender_key: 'opaque-sender-key',
  },
};

function mockMatrix(edit = () => undefined) {
  const calls = [];
  const fakeFetch = async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Accept, 'application/json');
    const token = options.headers.Authorization.replace(/^Bearer /u, '');
    const path = decodeURIComponent(new URL(url).pathname);
    calls.push({ url, path, token });

    let status = 200;
    let payload;
    if (path.endsWith('/account/whoami')) {
      const who = {
        'disposable-token-a': '@alice:a.example.test',
        'disposable-token-b': '@bob:b.example.test',
        'disposable-token-c': '@outsider:b.example.test',
      }[token];
      payload = { user_id: who, device_id: 'disposable-device' };
    } else if (path.endsWith('/joined_members')) {
      payload = { joined: {
        '@alice:a.example.test': {},
        '@bob:b.example.test': {},
      } };
    } else if (path.endsWith('/event/$encrypted-event')) {
      payload = structuredClone(encrypted);
      if (token === 'disposable-token-c') {
        status = 403;
        payload = { errcode: 'M_FORBIDDEN' };
      }
    } else {
      status = 404;
      payload = { errcode: 'M_NOT_FOUND' };
    }
    const replacement = edit({ path, token, url, status, payload });
    if (replacement) {
      status = replacement.status ?? status;
      payload = replacement.payload ?? payload;
    }
    return new Response(JSON.stringify(payload), { status });
  };
  return { fakeFetch, calls };
}

async function fails(configValue, fakeFetch, code) {
  await assert.rejects(
    verifyTwoServers(configValue, fakeFetch),
    error => error instanceof ProbeFailure && error.code === code
  );
}

test('valid separate servers and three distinct authenticated accounts', () => {
  const c = validateConfig(config());
  assert.equal(c.aUrl, 'https://a.example.test');
  assert.equal(c.outsiderUrl, c.bUrl);
});

test('reject the same homeserver origin', () => {
  assert.throws(() => validateConfig(config({ bUrl: 'https://a.example.test' })),
    { code: 'SAME_HOMESERVER_ORIGIN' });
});

test('reject a second origin masquerading as the same Matrix server name', () => {
  assert.throws(() => validateConfig(config({ bUser: '@bob:a.example.test' })),
    { code: 'SAME_MATRIX_SERVER_NAME' });
});

test('reject plain HTTP off loopback, but permit disposable localhost testing', () => {
  assert.throws(() => validateConfig(config({ aUrl: 'http://public.example.test' })),
    { code: 'UNSAFE_HOMESERVER_URL' });
  assert.equal(validateConfig(config({ aUrl: 'http://127.0.0.1:8008' })).aUrl, 'http://127.0.0.1:8008');
});

test('reject userinfo, query, path and unsafe federation URL forms', () => {
  for (const aUrl of [
    'https://secret@a.example.test',
    'https://a.example.test/something',
    'https://a.example.test/?token=sensitive',
    'https://a.example.test/#fragment',
  ]) {
    assert.throws(() => validateConfig(config({ aUrl })),
      { code: 'UNSAFE_HOMESERVER_URL' });
  }
});

test('reject outsider hosted on a third untrusted origin', () => {
  assert.throws(() => validateConfig(config({ outsiderUrl: 'https://c.example.test' })),
    { code: 'OUTSIDER_NOT_ON_TEST_SERVERS' });
});

test('reject duplicate accounts and shared access tokens', () => {
  assert.throws(() => validateConfig(config({ outsiderUser: '@bob:b.example.test' })),
    { code: 'DUPLICATE_ACCOUNT' });
  assert.throws(() => validateConfig(config({ bToken: 'disposable-token-a' })),
    { code: 'SHARED_ACCESS_TOKEN' });
});

test('reject missing credentials and malformed Matrix identifiers', () => {
  assert.throws(() => validateConfig(config({ aToken: undefined })),
    { code: 'MISSING_CREDENTIAL' });
  assert.throws(() => validateConfig(config({ roomId: 'not-a-room' })),
    { code: 'INVALID_MATRIX_IDENTIFIER' });
  assert.throws(() => validateConfig(config({ eventId: '$wrong/event' })),
    { code: 'INVALID_MATRIX_IDENTIFIER' });
});

test('PASS verifies two room membership views, one encrypted event and outsider denial', async () => {
  const { fakeFetch, calls } = mockMatrix();
  const result = await verifyTwoServers(config(), fakeFetch);
  assert.equal(result.status, 'PASS');
  assert.equal(result.sameEncryptedEventVisible, true);
  assert.equal(result.outsiderReadDenied, true);
  assert.equal(result.decryptedE2EE, 'NOT_TESTED');
  assert.equal(result.physicalDevices, 'NOT_TESTED');
  assert.equal(calls.length, 8);
  assert.deepEqual(new Set(calls.map(x => new URL(x.url).origin)),
    new Set(['https://a.example.test', 'https://b.example.test']));
  assert.ok(!JSON.stringify(result).includes('opaque-ciphertext'));
  assert.ok(!JSON.stringify(result).includes('disposable-token'));
});

test('wrong whoami device identity fails before querying private room', async () => {
  const { fakeFetch, calls } = mockMatrix(({ path, token }) =>
    path.endsWith('/whoami') && token === 'disposable-token-b'
      ? { payload: { user_id: '@wrong:b.example.test', device_id: 'd' } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_WHOAMI_MISMATCH');
  assert.equal(calls.filter(x => x.path.includes('/rooms/')).length, 0);
});

test('missing joined user on one server fails closed', async () => {
  const { fakeFetch } = mockMatrix(({ path, token }) =>
    path.endsWith('/joined_members') && token === 'disposable-token-b'
      ? { payload: { joined: { '@bob:b.example.test': {} } } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_MEMBERSHIP_MISMATCH');
});

test('outsider inside joined members fails closed even if event ACL says denied', async () => {
  const { fakeFetch } = mockMatrix(({ path }) =>
    path.endsWith('/joined_members') ? { payload: { joined: {
      '@alice:a.example.test': {}, '@bob:b.example.test': {},
      '@outsider:b.example.test': {},
    } } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_MEMBERSHIP_MISMATCH');
});

test('plaintext event cannot claim encrypted federation smoke', async () => {
  const { fakeFetch } = mockMatrix(({ path }) =>
    path.includes('/event/') ? { payload: { ...encrypted, type: 'm.room.message' } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_ENCRYPTED_EVENT_MISMATCH');
});

test('invalid Megolm envelope rejects metadata-only PASS', async () => {
  const { fakeFetch } = mockMatrix(({ path }) =>
    path.includes('/event/') ? { payload: {
      ...encrypted, content: { ...encrypted.content, ciphertext: '' },
    } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_ENCRYPTED_EVENT_INVALID');
});

test('two servers disagree on encrypted event bytes', async () => {
  const { fakeFetch } = mockMatrix(({ path, token }) =>
    path.includes('/event/') && token === 'disposable-token-b'
      ? { payload: { ...encrypted, content: {
        ...encrypted.content, ciphertext: 'different-ciphertext',
      } } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_EVENT_DIVERGENCE');
});

test('outsider 200 means ACL failure even with valid prior whoami', async () => {
  const { fakeFetch } = mockMatrix(({ path, token }) =>
    path.includes('/event/') && token === 'disposable-token-c'
      ? { status: 200, payload: encrypted } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_OUTSIDER_CAN_READ_EVENT');
});

test('outsider 401 is not an ACL proof: token must be valid', async () => {
  const { fakeFetch } = mockMatrix(({ path, token }) =>
    path.includes('/event/') && token === 'disposable-token-c'
      ? { status: 401, payload: { errcode: 'M_UNKNOWN_TOKEN' } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_HTTP_STATUS_REJECTED');
});

test('HTTP redirect is never followed with bearer credentials', async () => {
  const { fakeFetch } = mockMatrix(({ path }) =>
    path.endsWith('/joined_members')
      ? { status: 302, payload: { location: 'https://unsafe.example.test' } } : undefined);
  await fails(config(), fakeFetch, 'MATRIX_HTTP_STATUS_REJECTED');
});

test('network exception cannot expose transport error or credentials', async () => {
  await fails(config(), async () => {
    throw new Error('sensitive disposable-token-a');
  }, 'MATRIX_TRANSPORT_FAILED');
});

test('overlarge JSON response fails closed before parsing private event', async () => {
  const { fakeFetch } = mockMatrix();
  let invoked = false;
  const hugeFetch = async (url, options) => {
    if (!invoked) {
      invoked = true;
      return new Response(JSON.stringify({ tooLarge: 'x'.repeat(262_145) }), { status: 200 });
    }
    return fakeFetch(url, options);
  };
  await fails(config(), hugeFetch, 'MATRIX_RESPONSE_TOO_LARGE');
});

test('CLI defaults to NOT TESTED; never probes the network implicitly', () => {
  const p = spawnSync(process.execPath, [new URL('./verify.mjs', import.meta.url).pathname],
    { encoding: 'utf8', env: {} });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /NOT TESTED/u);
  assert.equal(p.stdout, '');
});


test('streaming byte cap rejects deceptively small declared Content-Length', async () => {
  let calls = 0;
  const bigStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(160_000));
      controller.enqueue(new Uint8Array(160_000));
      controller.close();
    },
  });
  const fakeFetch = async () => {
    calls++;
    return new Response(bigStream, {
      status: 200,
      headers: { 'content-length': '1' },
    });
  };
  await fails(config(), fakeFetch, 'MATRIX_RESPONSE_TOO_LARGE');
  assert.equal(calls, 1);
});

test('declared oversize response fails closed without reading its content', async () => {
  const fakeFetch = async () => new Response('{}', {
    status: 200,
    headers: { 'content-length': '500000' },
  });
  await fails(config(), fakeFetch, 'MATRIX_RESPONSE_TOO_LARGE');
});
