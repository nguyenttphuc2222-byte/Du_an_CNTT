import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { OAuth2Client } from 'google-auth-library';
import { createApp } from '../src/server.mjs';

async function setup(t, config = {}) {
  const app = await createApp({
    port: 0,
    dbPath: ':memory:',
    config: { demoEnabled: true, googleClientId: '', googleClientSecret: '', ...config },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
  });
  function client() {
    const cookies = new Map();
    return async (path, { method = 'GET', body, headers = {} } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const i = pair.indexOf('=');
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return response;
    };
  }
  return { app, base, client };
}
test('HTTP scenario, exports and logout complete with server-enforced student privacy', async (t) => {
  const { client } = await setup(t);
  const lecturer = client(),
    student = client();
  assert.equal((await lecturer('/api/dashboard')).status, 401);
  const login = await lecturer('/api/auth/demo', {
    method: 'POST',
    body: { userId: 'demo-lecturer' },
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.email, '523h0025@student.tdtu.edu.vn');
  await student('/api/auth/demo', { method: 'POST', body: { userId: 'demo-student' } });
  assert.equal((await student('/api/reports')).status, 403);
  assert.equal(
    (await student('/api/import/commit', { method: 'POST', body: { rows: [] } })).status,
    403,
  );
  const initial = (await (await student('/api/dashboard')).json()).student;
  assert.deepEqual(
    [initial.officialTotal, initial.pendingTotal, initial.projectedTotal],
    [40, 10, 50],
  );
  const rows = await (await lecturer('/api/demo/scenario.csv')).text();
  const upload = { fileName: 'demo.csv', fileBase64: Buffer.from(rows).toString('base64') };
  assert.equal(
    (await (await lecturer('/api/import/preview', { method: 'POST', body: upload })).json()).summary
      .valid,
    1,
  );
  const committed = await (
    await lecturer('/api/import/commit', { method: 'POST', body: upload })
  ).json();
  assert.equal(committed.matched, 1);
  const after = (await (await student('/api/dashboard')).json()).student;
  assert.deepEqual([after.officialTotal, after.pendingTotal, after.projectedTotal], [50, 0, 50]);
  assert.equal(
    (await (await lecturer('/api/import/commit', { method: 'POST', body: upload })).json())
      .inserted,
    0,
  );
  const records = await (await student('/api/official-records')).json();
  assert.ok(records.records.every((r) => r.studentCode === '523h0080'));
  assert.deepEqual(records.batches, []);
  const response = await lecturer('/api/export/report.xlsx?classId=cls1&basis=official');
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount, 11);
  await lecturer('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await lecturer('/api/audit')).status, 401);
});
test('HTTP rejects cross-origin mutations, malformed JSON and unconfigured Google', async (t) => {
  const { client, base } = await setup(t);
  const lecturer = client();
  await lecturer('/api/auth/demo', { method: 'POST', body: { userId: 'demo-lecturer' } });
  assert.equal(
    (
      await lecturer('/api/activities', {
        method: 'POST',
        body: {},
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status,
    403,
  );
  const malformed = await fetch(base + '/api/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await lecturer('/auth/google')).status, 400);
  assert.equal(
    (
      await lecturer('/api/google/sheets/preview', {
        method: 'POST',
        body: { url: 'http://localhost/private' },
      })
    ).status,
    400,
  );
  assert.equal((await lecturer('/api/google/status')).status, 200);
  assert.equal((await (await lecturer('/api/google/status')).json()).connected, false);
  assert.equal((await fetch(base + '/src/store.mjs')).status, 404);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.ok(html.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.ok(html.headers.get('content-security-policy').includes("frame-src 'self'"));
  assert.ok(html.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
});

test('PDF source and semester assessment routes enforce permissions and apply six-category scoring', async (t) => {
  const { client } = await setup(t);
  const lecturer = client(),
    student = client();
  const pdf = await lecturer('/docs/quy-che-ren-luyen-tdtu.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(pdf.headers.get('content-security-policy').includes("frame-ancestors 'self'"));
  assert.ok(pdf.headers.get('content-disposition').startsWith('inline;'));
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  assert.equal((await lecturer('/api/legacy')).status, 401);
  await lecturer('/api/auth/demo', { method: 'POST', body: { userId: 'demo-lecturer' } });
  await student('/api/auth/demo', { method: 'POST', body: { userId: 'demo-student' } });
  assert.equal((await student('/api/legacy')).status, 403);
  assert.equal((await student('/api/assessments/s002')).status, 403);
  const profile = {
    semester: '2026-2027-HK2',
    gpa: 9,
    complianceConfirmed: true,
    offlineActivityCount: 15,
    discipline: 'none',
    mode: 'normal',
  };
  assert.equal(
    (await student('/api/assessments/s001', { method: 'PUT', body: profile })).status,
    403,
  );
  const saved = await lecturer('/api/assessments/s001', { method: 'PUT', body: profile });
  assert.equal(saved.status, 200, JSON.stringify(await saved.json()));
  const criteria = [
    'academic_seminar',
    'movement_competition_city',
    'community_blood_hair_donation',
    'bonus_contribution_government',
  ];
  const rows = criteria.map((criterionId, index) => ({
    sourceId: `HTTP-RULE-${index}`,
    studentCode: '523h0080',
    title: `Quy chế ${index}`,
    criterionId,
    quantity: index === 0 ? 4 : index === 2 ? 2 : 1,
    date: '2027-02-01',
    semester: profile.semester,
  }));
  const imported = await lecturer('/api/import/commit', {
    method: 'POST',
    body: { rows, batchName: 'HTTP criteria test' },
  });
  assert.equal(imported.status, 200, JSON.stringify(await imported.json()));
  let summary = (await (await student('/api/dashboard?semester=' + profile.semester)).json())
    .student;
  assert.equal(summary.categoryScores.length, 6);
  assert.equal(summary.officialTotal, 100);
  assert.equal(summary.officialClassification, 'Xuất sắc');
  assert.ok(summary.categoryScores.every((c) => c.official <= 20));
  const restricted = await lecturer('/api/assessments/s001', {
    method: 'PUT',
    body: { ...profile, discipline: 'reprimand' },
  });
  assert.equal(restricted.status, 200, JSON.stringify(await restricted.json()));
  summary = (await (await student('/api/dashboard?semester=' + profile.semester)).json()).student;
  assert.equal(summary.officialTotal, 100);
  assert.equal(summary.officialClassification, 'Khá');
  assert.equal(summary.categoryScores.find((c) => c.categoryId === 'pioneer').official, 0);
  await lecturer('/api/assessments/s001', {
    method: 'PUT',
    body: { ...profile, discipline: 'warning' },
  });
  summary = (await (await student('/api/dashboard?semester=' + profile.semester)).json()).student;
  assert.equal(summary.officialTotal, 100);
  assert.equal(summary.officialClassification, 'Trung bình');
  await lecturer('/api/assessments/s001', {
    method: 'PUT',
    body: { ...profile, discipline: 'suspended' },
  });
  summary = (await (await student('/api/dashboard?semester=' + profile.semester)).json()).student;
  assert.equal(summary.officialTotal, null);
  assert.equal(summary.evaluationStatus, 'not_evaluated');
});

test('HTTP exposes only the normalized authentication audience and rejects unknown startup modes', async (t) => {
  for (const audience of ['internal', 'external']) {
    const { client } = await setup(t, { authAudience: ` ${audience.toUpperCase()} ` });
    const response = await client()('/api/session');
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.equal(session.auth.authAudience, audience);
    assert.equal('lecturerEmails' in session.auth, false);
    assert.equal('googleClientSecret' in session.auth, false);
  }
  await assert.rejects(
    createApp({ port: 0, dbPath: ':memory:', config: { authAudience: 'auto' } }),
    /GOOGLE_AUTH_AUDIENCE/,
  );
});

test('HTTP Google callbacks apply each audience policy to actual stored users and protected routes', async (t) => {
  let payload;
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: { id_token: 'test-id-token' },
  }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async ({ audience }) => {
    assert.equal(audience, 'http-test-client');
    return { getPayload: () => payload };
  });
  for (const authAudience of ['internal', 'external']) {
    const { client } = await setup(t, {
      authAudience,
      googleClientId: 'http-test-client',
      googleClientSecret: 'http-test-secret',
      lecturerEmails: ['523h0025@student.tdtu.edu.vn', 'teacher@gmail.com'],
    });
    const cases =
      authAudience === 'internal'
        ? [
            ['new@student.tdtu.edu.vn', 'STUDENT'],
            ['staff@tdtu.edu.vn', 'LECTURER'],
            ['523h0025@student.tdtu.edu.vn', 'LECTURER'],
            ['teacher@gmail.com', null],
          ]
        : [
            ['new@gmail.com', 'STUDENT'],
            ['staff@tdtu.edu.vn', 'STUDENT'],
            ['teacher@gmail.com', 'LECTURER'],
          ];
    for (const [email, role] of cases) {
      const request = client();
      const started = await request('/auth/google');
      assert.equal(started.status, 303);
      const consent = new URL(started.headers.get('location'));
      assert.equal(consent.searchParams.get('hd'), authAudience === 'internal' ? '*' : null);
      payload = {
        iss: 'https://accounts.google.com',
        aud: 'http-test-client',
        sub: `${authAudience}-${email}`,
        email,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        name: 'Tài khoản kiểm thử',
        nonce: consent.searchParams.get('nonce'),
        ...(email.endsWith('tdtu.edu.vn') ? { hd: 'tdtu.edu.vn' } : {}),
      };
      const callback = await request(
        '/auth/google/callback?' +
          new URLSearchParams({
            code: 'test-code',
            state: consent.searchParams.get('state'),
          }),
      );
      assert.equal(callback.status, 303);
      if (!role) {
        assert.match(callback.headers.get('location'), /authError=/);
        assert.equal((await (await request('/api/session')).json()).user, null);
        assert.equal((await request('/api/dashboard')).status, 401);
        continue;
      }
      assert.equal(callback.headers.get('location'), '/');
      const session = await (await request('/api/session')).json();
      assert.equal(session.auth.authAudience, authAudience);
      assert.equal(session.user.role, role);
      assert.equal(session.user.email, email);
      assert.equal(session.user.provider, 'google');
      assert.equal((await request('/api/dashboard')).status, 200);
      assert.equal((await request('/api/audit')).status, role === 'LECTURER' ? 200 : 403);
      if (role === 'STUDENT') {
        assert.ok(session.user.studentId);
        const dashboard = await (await request('/api/dashboard')).json();
        assert.equal(dashboard.student.hasOfficialData, false);
        assert.equal(dashboard.student.pendingCount, 0);
        assert.equal(dashboard.student.id, session.user.studentId);
        assert.equal((await request('/api/students')).status, 403);
        const official = await (await request('/api/official-records')).json();
        assert.deepEqual(official.records, []);
      }
    }
  }
});

test('regulation reader serves exactly the ten document page images without exposing project files', async (t) => {
  const { client } = await setup(t);
  const request = client();
  for (let page = 1; page <= 10; page++) {
    const response = await request(`/regulations/page-${String(page).padStart(2, '0')}.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 8)
        .toString('hex'),
      '89504e470d0a1a0a',
    );
  }
  for (const path of [
    '/regulations/page-00.png',
    '/regulations/page-11.png',
    '/regulations/README.md',
    '/regulations/%2e%2e/.env',
  ]) {
    assert.equal((await request(path)).status, 404);
  }
});

test('Google-only mode removes every published demo shortcut and blocks all three demo identities', async (t) => {
  const { client } = await setup(t, {
    demoEnabled: false,
    googleClientId: 'google-only-client',
    googleClientSecret: 'google-only-secret',
  });
  const request = client();
  const session = await (await request('/api/session')).json();
  assert.equal(session.auth.demoEnabled, false);
  assert.equal(session.auth.googleConfigured, true);
  assert.deepEqual(session.demoUsers, []);
  for (const userId of ['demo-lecturer', 'demo-student', 'demo-student-2']) {
    assert.equal(
      (await request('/api/auth/demo', { method: 'POST', body: { userId } })).status,
      403,
    );
  }
  assert.equal((await (await request('/api/session')).json()).user, null);
  const google = await request('/auth/google');
  assert.equal(google.status, 303);
  assert.equal(new URL(google.headers.get('location')).origin, 'https://accounts.google.com');
});
