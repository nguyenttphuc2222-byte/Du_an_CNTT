import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createApp } from '../src/server.mjs';

async function setup(t) {
  const app = await createApp({
    port: 0,
    dbPath: ':memory:',
    config: { demoEnabled: true, googleClientId: '', googleClientSecret: '' },
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
});

test('PDF source and semester assessment routes enforce permissions and apply six-category scoring', async (t) => {
  const { client } = await setup(t);
  const lecturer = client(),
    student = client();
  const pdf = await lecturer('/docs/quy-che-ren-luyen-tdtu.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
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
