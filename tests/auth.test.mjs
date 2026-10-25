import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createAuth } from '../src/auth.mjs';

function fixture(overrides = {}) {
  const users = new Map([
    [
      'demo-lecturer',
      {
        id: 'demo-lecturer',
        name: 'Giảng viên mẫu',
        email: 'demo@example.invalid',
        role: 'LECTURER',
        provider: 'demo',
      },
    ],
    [
      'demo-student',
      {
        id: 'demo-student',
        name: 'Sinh viên mẫu',
        email: 'demo2@example.invalid',
        role: 'STUDENT',
        provider: 'demo',
      },
    ],
    [
      'private-user',
      { id: 'private-user', name: 'Không công khai', role: 'LECTURER', provider: 'google' },
    ],
  ]);
  const store = {
    getSettings: () => ({ verified: false }),
    getUser: (id) => users.get(id) ?? null,
    getDemoUsers: () => [users.get('demo-lecturer'), users.get('demo-student')],
    ensureGoogleUser(user) {
      const result = { ...user, id: `google-${user.sub}`, provider: 'google', studentId: null };
      users.set(result.id, result);
      return result;
    },
  };
  const config = {
    baseUrl: 'http://localhost:3000',
    demoEnabled: true,
    lecturerEmails: [],
    ...overrides,
  };
  return { auth: createAuth({ store, config }), users, store, config };
}

function response() {
  const headers = new Map();
  return {
    headers,
    status: null,
    ended: false,
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(status, values) {
      this.status = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
    },
    end() {
      this.ended = true;
    },
  };
}

function request(cookie = '') {
  return { headers: { cookie } };
}
function cookieFrom(res, name) {
  return res
    .getHeader('Set-Cookie')
    .find((cookie) => cookie.startsWith(`${name}=`))
    .split(';')[0];
}
function googleFlow(auth) {
  const res = response();
  auth.startGoogle(request(), res);
  const location = new URL(res.getHeader('Location'));
  const cookie = cookieFrom(res, 'tdtu_conduct_oauth');
  const callback = new URL('http://localhost:3000/auth/google/callback');
  callback.searchParams.set('state', location.searchParams.get('state'));
  callback.searchParams.set('code', 'code-from-google');
  return { location, cookie, callback };
}

function mockGoogle(t, flow, updates = {}, onExchange = () => {}) {
  t.mock.method(OAuth2Client.prototype, 'getToken', async (options) => {
    onExchange(options);
    return { tokens: { id_token: 'signed-token' } };
  });
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async (options) => {
    assert.equal(options.idToken, 'signed-token');
    assert.equal(options.audience, 'test-client-id');
    return {
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: 'test-client-id',
        sub: '12345',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'teacher-demo@student.tdtu.edu.vn',
        email_verified: true,
        hd: 'tdtu.edu.vn',
        name: 'Sinh viên demo',
        nonce: flow.location.searchParams.get('nonce'),
        ...updates,
      }),
    };
  });
}

const googleConfig = { googleClientId: 'test-client-id', googleClientSecret: 'test-client-secret' };

test('demo accepts only published demo IDs and session uses current role', () => {
  const { auth, users } = fixture();
  assert.equal(auth.getUser(request()), null);
  assert.throws(() => auth.demoLogin(request(), response(), { userId: 'private-user' }), {
    status: 403,
  });
  const res = response();
  const result = auth.demoLogin(request(), res, { userId: 'demo-lecturer' });
  assert.equal(result.user.role, 'LECTURER');
  const cookie = cookieFrom(res, 'tdtu_conduct_session');
  assert.match(res.getHeader('Set-Cookie')[0], /HttpOnly; SameSite=Lax; Max-Age=28800/);
  assert.equal(auth.getUser(request(cookie)).id, 'demo-lecturer');
  users.get('demo-lecturer').role = 'STUDENT';
  assert.equal(auth.getUser(request(cookie)).role, 'STUDENT');
  assert.equal(auth.getUser(request(`${cookie}; ${cookie}`)), null);
  const logout = response();
  assert.deepEqual(auth.logout(request(cookie), logout), { ok: true });
  assert.equal(auth.getUser(request(cookie)), null);
  auth.close();
});

test('disabled demo exposes no demo accounts and Google must be configured', () => {
  const { auth } = fixture({ demoEnabled: false });
  assert.deepEqual(auth.sessionData(request()).demoUsers, []);
  assert.throws(() => auth.demoLogin(request(), response(), { userId: 'demo-lecturer' }), {
    status: 403,
  });
  assert.throws(() => auth.startGoogle(request(), response()), { status: 400 });
  auth.close();
});

test('session rotates and HTTPS cookies are Secure', () => {
  const { auth } = fixture({ baseUrl: 'https://demo.example.invalid' });
  const first = response();
  auth.demoLogin(request(), first, { userId: 'demo-student' });
  const oldCookie = cookieFrom(first, 'tdtu_conduct_session');
  const next = response();
  auth.demoLogin(request(oldCookie), next, { userId: 'demo-lecturer' });
  assert.equal(auth.getUser(request(oldCookie)), null);
  assert.match(next.getHeader('Set-Cookie')[0], /; Secure$/);
  auth.close();
});

test('Google authorization binds browser, PKCE, nonce and server-side lecturer whitelist', async (t) => {
  const { auth } = fixture({
    ...googleConfig,
    lecturerEmails: ['Teacher-Demo@Student.TDTU.edu.vn'],
  });
  const flow = googleFlow(auth);
  assert.equal(flow.location.origin, 'https://accounts.google.com');
  assert.equal(flow.location.searchParams.get('scope'), 'openid email profile');
  assert.equal(flow.location.searchParams.get('code_challenge_method'), 'S256');
  mockGoogle(t, flow, {}, (options) => {
    assert.equal(options.code, 'code-from-google');
    const challenge = createHash('sha256').update(options.codeVerifier).digest('base64url');
    assert.equal(challenge, flow.location.searchParams.get('code_challenge'));
  });
  const res = response();
  await auth.finishGoogle(request(flow.cookie), res, flow.callback);
  assert.equal(res.status, 303);
  assert.equal(res.getHeader('Location'), '/');
  assert.equal(auth.getUser(request(cookieFrom(res, 'tdtu_conduct_session'))).role, 'LECTURER');
  await assert.rejects(() => auth.finishGoogle(request(flow.cookie), response(), flow.callback), {
    status: 400,
  });
  auth.close();
});

test('Google callback rejects another browser before any token exchange', async (t) => {
  const { auth } = fixture(googleConfig);
  const flow = googleFlow(auth);
  const exchange = t.mock.method(OAuth2Client.prototype, 'getToken', async () => {
    throw new Error('should not exchange');
  });
  await assert.rejects(() => auth.finishGoogle(request(), response(), flow.callback), {
    status: 400,
  });
  assert.equal(exchange.mock.callCount(), 0);
  auth.close();
});

for (const [name, payload, status] of [
  ['email domain suffix attack', { email: 'person@student.tdtu.edu.vn.attacker.invalid' }, 403],
  ['unapproved Workspace domain', { hd: 'attacker.invalid' }, 403],
  ['missing Workspace claim', { hd: undefined }, 403],
  ['unverified email', { email_verified: false }, 400],
  ['nonce mismatch', { nonce: 'different-nonce' }, 400],
  ['expired token', { exp: 1 }, 400],
  ['wrong audience', { aud: 'some-other-client' }, 400],
]) {
  test(`Google rejects ${name}`, async (t) => {
    const { auth } = fixture(googleConfig);
    const flow = googleFlow(auth);
    mockGoogle(t, flow, payload);
    await assert.rejects(() => auth.finishGoogle(request(flow.cookie), response(), flow.callback), {
      status,
    });
    auth.close();
  });
}

test('allowed Google student is a student unless explicitly granted lecturer', async (t) => {
  const { auth } = fixture(googleConfig);
  const flow = googleFlow(auth);
  mockGoogle(t, flow);
  const res = response();
  await auth.finishGoogle(request(flow.cookie), res, flow.callback);
  assert.equal(auth.getUser(request(cookieFrom(res, 'tdtu_conduct_session'))).role, 'STUDENT');
  auth.close();
});

function workspaceFlow(auth, req) {
  const res = response();
  auth.startWorkspace(req, res);
  const location = new URL(res.getHeader('Location'));
  const cookie = cookieFrom(res, 'tdtu_conduct_oauth');
  const callback = new URL('http://localhost:3000/auth/google/callback');
  callback.searchParams.set('state', location.searchParams.get('state'));
  callback.searchParams.set('code', 'workspace-code');
  return { location, cookie, callback };
}

const workspaceScopes =
  'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly';

test('real Google grant stays unavailable to demo sessions sharing the same database profile', async (t) => {
  const { auth, store, users } = fixture(googleConfig);
  store.ensureGoogleUser = (user) => {
    const result = { ...user, id: 'demo-student', provider: 'google', studentId: 's001' };
    users.set(result.id, result);
    return result;
  };
  let active = googleFlow(auth);
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: {
      id_token: 'signed-token',
      access_token: 'server-only-access',
      refresh_token: 'server-only-refresh',
      expiry_date: Date.now() + 3600000,
      scope: workspaceScopes,
    },
  }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
    getPayload: () => ({
      iss: 'https://accounts.google.com',
      aud: 'test-client-id',
      sub: 'same-real-account',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email_verified: true,
      email: 'teacher-demo@student.tdtu.edu.vn',
      hd: 'tdtu.edu.vn',
      nonce: active.location.searchParams.get('nonce'),
    }),
  }));
  const loginRes = response();
  await auth.finishGoogle(request(active.cookie), loginRes, active.callback);
  const googleCookie = cookieFrom(loginRes, 'tdtu_conduct_session');
  assert.equal(auth.getUser(request(googleCookie)).provider, 'google');
  assert.equal(auth.workspaceStatus(request(googleCookie)).connected, false);
  active = workspaceFlow(auth, request(googleCookie));
  assert.equal(active.location.searchParams.get('access_type'), 'offline');
  assert.equal(active.location.searchParams.get('include_granted_scopes'), 'true');
  assert.match(active.location.searchParams.get('scope'), /spreadsheets\.readonly/);
  const connectRes = response();
  await auth.finishGoogle(
    request(`${googleCookie}; ${active.cookie}`),
    connectRes,
    active.callback,
  );
  assert.equal(connectRes.getHeader('Location'), '/?googleConnected=1');
  assert.equal(auth.workspaceStatus(request(googleCookie)).connected, true);
  assert.doesNotMatch(JSON.stringify(auth.workspaceStatus(request(googleCookie))), /server-only/);
  const api = t.mock.method(OAuth2Client.prototype, 'request', async (options) => ({
    data: { received: options.url },
  }));
  const validUrl = 'https://sheets.googleapis.com/v4/spreadsheets/abcdefghijk';
  assert.equal((await auth.googleRequest(request(googleCookie), validUrl)).received, validUrl);
  for (const url of [
    'https://attacker.invalid/v4/spreadsheets/abcdefghijk',
    'https://sheets.googleapis.com.attacker.invalid/v4/spreadsheets',
    'http://sheets.googleapis.com/v4/spreadsheets',
    'https://www.googleapis.com/drive/v3/about',
    'https://sheets.googleapis.com/v4/spreadsheets/../other',
  ]) {
    await assert.rejects(() => auth.googleRequest(request(googleCookie), url), { status: 400 });
  }
  assert.equal(api.mock.callCount(), 1);
  const uploadBody = Buffer.from('multipart evidence');
  await auth.googleRequest(
    request(googleCookie),
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      body: uploadBody,
      headers: {
        'Content-Type': 'multipart/related; boundary=test',
        Authorization: 'must-not-forward',
      },
    },
  );
  const requestOptions = api.mock.calls[1].arguments[0];
  assert.equal(requestOptions.data, uploadBody);
  assert.deepEqual(requestOptions.headers, { 'Content-Type': 'multipart/related; boundary=test' });
  assert.equal(requestOptions.maxRedirects, 0);
  const demoRes = response();
  const snapshot = auth.demoLogin(request(), demoRes, { userId: 'demo-student' });
  const demoCookie = cookieFrom(demoRes, 'tdtu_conduct_session');
  assert.equal(snapshot.user.provider, 'demo');
  assert.equal(auth.getUser(request(demoCookie)).provider, 'demo');
  assert.equal(auth.workspaceStatus(request(demoCookie)).connected, false);
  assert.throws(() => auth.startWorkspace(request(demoCookie), response()), { status: 403 });
  await assert.rejects(() => auth.googleRequest(request(demoCookie), validUrl), { status: 403 });
  assert.equal(auth.workspaceStatus(request(googleCookie)).connected, true);
  auth.close();
});

test('Workspace consent rejects a different Google account and never stores its grant', async (t) => {
  const { auth } = fixture(googleConfig);
  let active = googleFlow(auth),
    sub = 'original-account';
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: {
      id_token: 'signed-token',
      access_token: 'access',
      scope: workspaceScopes,
      expiry_date: Date.now() + 3600000,
    },
  }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
    getPayload: () => ({
      iss: 'https://accounts.google.com',
      aud: 'test-client-id',
      sub,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email_verified: true,
      email: 'teacher-demo@student.tdtu.edu.vn',
      hd: 'tdtu.edu.vn',
      nonce: active.location.searchParams.get('nonce'),
    }),
  }));
  const res = response();
  await auth.finishGoogle(request(active.cookie), res, active.callback);
  const cookie = cookieFrom(res, 'tdtu_conduct_session');
  active = workspaceFlow(auth, request(cookie));
  sub = 'different-google-account';
  await assert.rejects(
    () => auth.finishGoogle(request(`${cookie}; ${active.cookie}`), response(), active.callback),
    { status: 403 },
  );
  assert.equal(auth.workspaceStatus(request(cookie)).connected, false);
  auth.close();
});
