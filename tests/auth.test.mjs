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
    authAudience: 'internal',
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

for (const scenario of [
  {
    name: 'Internal student',
    mode: 'internal',
    email: 'person@student.tdtu.edu.vn',
    role: 'STUDENT',
  },
  {
    name: 'Internal faculty',
    mode: 'internal',
    email: 'person@tdtu.edu.vn',
    role: 'LECTURER',
  },
  {
    name: 'Internal student lecturer override normalizes email and whitespace',
    mode: ' INTERNAL ',
    email: '  523H0025@STUDENT.TDTU.EDU.VN  ',
    hd: ' TDTU.EDU.VN ',
    whitelist: [' \t523h0025@Student.TDTU.edu.vn \n'],
    role: 'LECTURER',
  },
  {
    name: 'Internal rejects whitelisted personal Gmail',
    mode: 'internal',
    email: 'teacher@gmail.com',
    whitelist: ['teacher@gmail.com'],
    status: 403,
  },
  {
    name: 'Internal rejects whitelisted domain suffix spoof',
    mode: 'internal',
    email: 'teacher@tdtu.edu.vn.attacker.invalid',
    whitelist: ['teacher@tdtu.edu.vn.attacker.invalid'],
    status: 403,
  },
  {
    name: 'Internal rejects whitelisted account without Workspace claim',
    mode: 'internal',
    email: 'teacher@student.tdtu.edu.vn',
    hd: undefined,
    whitelist: ['teacher@student.tdtu.edu.vn'],
    status: 403,
  },
  {
    name: 'Internal configured domains cannot expand beyond TDTU',
    mode: 'internal',
    email: 'teacher@other.edu.vn',
    hd: 'other.edu.vn',
    config: { allowedDomains: ['other.edu.vn'], allowedHostedDomains: ['other.edu.vn'] },
    status: 403,
  },
  {
    name: 'External personal Gmail without Workspace claim',
    mode: 'external',
    email: 'person@gmail.com',
    hd: undefined,
    role: 'STUDENT',
  },
  {
    name: 'External account from another Workspace',
    mode: 'external',
    email: 'person@other.edu.vn',
    hd: 'other.edu.vn',
    role: 'STUDENT',
  },
  {
    name: 'External faculty defaults to student',
    mode: 'external',
    email: 'person@tdtu.edu.vn',
    role: 'STUDENT',
  },
  {
    name: 'External TDTU student',
    mode: 'external',
    email: 'person@student.tdtu.edu.vn',
    role: 'STUDENT',
  },
  {
    name: 'External whitelisted Gmail normalizes email and whitespace',
    mode: ' EXTERNAL ',
    email: '  Teacher@GMAIL.COM  ',
    hd: undefined,
    whitelist: [' teacher@gmail.com '],
    role: 'LECTURER',
  },
  {
    name: 'External whitelisted TDTU student',
    mode: 'external',
    email: '523h0025@student.tdtu.edu.vn',
    whitelist: ['523h0025@student.tdtu.edu.vn'],
    role: 'LECTURER',
  },
  {
    name: 'External whitelisted faculty',
    mode: 'external',
    email: 'teacher@tdtu.edu.vn',
    whitelist: ['teacher@tdtu.edu.vn'],
    role: 'LECTURER',
  },
  {
    name: 'External suffix spoof gets no lecturer privileges',
    mode: 'external',
    email: 'teacher@tdtu.edu.vn.attacker.invalid',
    whitelist: ['teacher@tdtu.edu.vn'],
    role: 'STUDENT',
  },
]) {
  test(`Google role policy: ${scenario.name}`, async (t) => {
    const { auth } = fixture({
      ...googleConfig,
      authAudience: scenario.mode,
      lecturerEmails: scenario.whitelist || [],
      ...scenario.config,
    });
    t.after(() => auth.close());
    const flow = googleFlow(auth);
    assert.equal(auth.sessionData(request()).auth.authAudience, scenario.mode.trim().toLowerCase());
    assert.equal(
      flow.location.searchParams.get('hd'),
      scenario.mode.trim().toLowerCase() === 'internal' ? '*' : null,
    );
    mockGoogle(t, flow, {
      email: scenario.email,
      hd: Object.hasOwn(scenario, 'hd') ? scenario.hd : 'tdtu.edu.vn',
    });
    const res = response();
    if (scenario.status) {
      await assert.rejects(() => auth.finishGoogle(request(flow.cookie), res, flow.callback), {
        status: scenario.status,
      });
      assert.equal(auth.getUser(request()), null);
    } else {
      await auth.finishGoogle(request(flow.cookie), res, flow.callback);
      const user = auth.getUser(request(cookieFrom(res, 'tdtu_conduct_session')));
      assert.equal(user.role, scenario.role);
      assert.equal(user.email, scenario.email.trim().toLowerCase());
    }
  });
}

for (const authAudience of ['internal', 'external']) {
  for (const [name, payload] of [
    ['unverified email', { email_verified: false }],
    ['non-boolean verification', { email_verified: 'true' }],
    ['wrong issuer', { iss: 'https://attacker.invalid' }],
    ['wrong audience', { aud: 'other-client' }],
    ['missing Google sub', { sub: undefined }],
    ['empty Google sub', { sub: '' }],
    ['wrong nonce', { nonce: 'wrong-nonce' }],
    ['expired token', { exp: 1 }],
    ['malformed email', { email: 'invalid@@gmail.com' }],
    ['email with embedded whitespace', { email: 'invalid name@gmail.com' }],
  ]) {
    test(`${authAudience} rejects ${name}`, async (t) => {
      const { auth } = fixture({ ...googleConfig, authAudience });
      t.after(() => auth.close());
      const flow = googleFlow(auth);
      mockGoogle(t, flow, payload);
      await assert.rejects(
        () => auth.finishGoogle(request(flow.cookie), response(), flow.callback),
        {
          status: 400,
        },
      );
    });
  }
}

test('invalid auth audience fails closed', () => {
  assert.throws(
    () => fixture({ ...googleConfig, authAudience: 'everyone' }),
    /GOOGLE_AUTH_AUDIENCE/,
  );
});

test('each Google login reconciles the stored role when mode or whitelist changes', async (t) => {
  const base = fixture(googleConfig);
  base.auth.close();
  const active = {};
  mockGoogle(t, active, { email: 'person@tdtu.edu.vn' });
  let previousAuth, previousCookie;
  for (const [authAudience, lecturerEmails, role] of [
    ['internal', [], 'LECTURER'],
    ['external', [], 'STUDENT'],
    ['external', [' PERSON@TDTU.EDU.VN '], 'LECTURER'],
    ['external', [], 'STUDENT'],
    ['internal', [], 'LECTURER'],
  ]) {
    previousAuth?.close();
    const auth = createAuth({
      store: base.store,
      config: { ...base.config, authAudience, lecturerEmails },
    });
    t.after(() => auth.close());
    if (previousCookie) assert.equal(auth.getUser(request(previousCookie)), null);
    Object.assign(active, googleFlow(auth));
    const res = response();
    await auth.finishGoogle(request(active.cookie), res, active.callback);
    previousCookie = cookieFrom(res, 'tdtu_conduct_session');
    const user = auth.getUser(request(previousCookie));
    assert.equal(user.id, 'google-12345');
    assert.equal(user.role, role);
    assert.equal(base.store.getUser(user.id).role, role);
    previousAuth = auth;
  }
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

for (const authAudience of ['internal', 'external']) {
  test(`${authAudience}: real Google grant stays unavailable to demo sessions sharing the same database profile`, async (t) => {
    const { auth, store, users } = fixture({ ...googleConfig, authAudience });
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
        email:
          authAudience === 'external' ? 'person@gmail.com' : 'teacher-demo@student.tdtu.edu.vn',
        hd: authAudience === 'external' ? undefined : 'tdtu.edu.vn',
        nonce: active.location.searchParams.get('nonce'),
      }),
    }));
    const loginRes = response();
    await auth.finishGoogle(request(active.cookie), loginRes, active.callback);
    const googleCookie = cookieFrom(loginRes, 'tdtu_conduct_session');
    assert.equal(auth.getUser(request(googleCookie)).provider, 'google');
    assert.equal(auth.workspaceStatus(request(googleCookie)).connected, false);
    active = workspaceFlow(auth, request(googleCookie));
    assert.equal(active.location.searchParams.get('hd'), authAudience === 'internal' ? '*' : null);
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
    assert.deepEqual(requestOptions.headers, {
      'Content-Type': 'multipart/related; boundary=test',
    });
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

  test(`${authAudience}: Workspace consent rejects a different Google account and never stores its grant`, async (t) => {
    const { auth } = fixture({ ...googleConfig, authAudience });
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
        email:
          authAudience === 'external' ? 'person@gmail.com' : 'teacher-demo@student.tdtu.edu.vn',
        hd: authAudience === 'external' ? undefined : 'tdtu.edu.vn',
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
}
