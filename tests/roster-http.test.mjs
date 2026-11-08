import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { OAuth2Client } from 'google-auth-library';
import { createApp } from '../src/server.mjs';
import { makeCsv } from '../src/files.mjs';
import { makeRosterWorkbook, ROSTER_COLUMNS } from '../src/roster-files.mjs';

const FIRST = '2026-2027-HK1',
  SECOND = '2026-2027-HK2';
const COORDINATOR = 'coordinator@example.test',
  A = 'teacher.a@example.test',
  B = 'teacher.b@example.test';

async function fixture(t, overrides = {}) {
  let token;
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: { id_token: 'mock-identity-token' },
  }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => token }));
  const app = await createApp({
    port: 0,
    dbPath: ':memory:',
    config: {
      demoEnabled: false,
      googleClientId: 'roster-test-client',
      googleClientSecret: 'roster-test-secret',
      authAudience: 'external',
      coordinatorEmails: [COORDINATOR],
      lecturerEmails: [COORDINATOR, A, B],
      ...overrides,
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    const cookies = new Map();
    return async (path, method = 'GET', payload) => {
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {
          Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
      }
      return response;
    };
  }
  async function login(email) {
    const request = client();
    const start = await request('/auth/google');
    const location = new URL(start.headers.get('location'));
    token = {
      sub: `roster-mock-${email}`,
      email,
      name: `Kiểm thử ${email}`,
      email_verified: true,
      iss: 'https://accounts.google.com',
      aud: 'roster-test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: location.searchParams.get('nonce'),
    };
    const callback = await request(
      '/auth/google/callback?' +
        new URLSearchParams({ code: 'mock-code', state: location.searchParams.get('state') }),
    );
    assert.equal(
      callback.headers.get('location'),
      '/',
      'Mocked Google callback must finish without real network',
    );
    const session = await (await request('/api/session')).json();
    return { request, user: session.user, access: session.access };
  }
  return { app, login, anonymous: client() };
}

const rosterRow = (semester = SECOND, overrides = {}) => ({
  sourceId: 'ROSTER-S001',
  studentCode: '523h0080',
  name: 'Sinh viên được phân công',
  email: '523h0080@student.tdtu.edu.vn',
  classId: 'CLASS-A',
  className: 'Lớp A',
  faculty: 'CNTT',
  cohortYear: 2023,
  semester,
  approvalReference: 'DS-TEST-2026',
  ...overrides,
});
const gradeRow = (overrides = {}) => ({
  sourceId: 'SCOPE-OFFICIAL-1',
  studentCode: '523h0080',
  semester: SECOND,
  title: 'Hội thảo được xác nhận',
  criterionId: 'academic_seminar',
  date: '2026-11-07',
  ...overrides,
});
async function successful(response, expected = 200) {
  assert.equal(response.status, expected, JSON.stringify(await response.clone().json()));
  return response.json();
}

test('coordinator capability requires both configured email and actual lecturer role; none is the default', async (t) => {
  const { login, anonymous } = await fixture(t, { lecturerEmails: [A] });
  assert.equal((await anonymous('/api/access')).status, 401);
  const configuredStudent = await login(COORDINATOR);
  assert.equal(configuredStudent.user.role, 'STUDENT');
  assert.equal(configuredStudent.access.isCoordinator, false);
  assert.equal(
    (
      await configuredStudent.request('/api/roster/commit', 'POST', {
        rows: [rosterRow()],
        reason: 'Test',
      })
    ).status,
    403,
  );
  const lecturer = await login(A);
  assert.equal(lecturer.access.isCoordinator, false);
  for (const endpoint of ['/api/audit', '/api/lecturers', '/api/roster/template.xlsx'])
    assert.equal((await lecturer.request(endpoint)).status, 403);
  assert.equal((await lecturer.request('/api/semesters', 'POST', { id: 'forged' })).status, 403);
});

test('roster CSV/XLSX import preserves identity, term history, provenance and atomic rejection', async (t) => {
  const { login } = await fixture(t);
  const { request: coordinator } = await login(COORDINATOR);
  const initial = await (await coordinator('/api/students?semester=' + FIRST)).json();
  const oldStudent = initial.students.find((student) => student.code === '523h0080');
  const firstImport = await successful(
    await coordinator('/api/roster/commit', 'POST', {
      csv: makeCsv(ROSTER_COLUMNS, [rosterRow()]),
      reason: 'Danh sách học kỳ hai có căn cứ',
    }),
  );
  assert.equal(firstImport.updated + firstImport.inserted, 1);
  const second = await (await coordinator('/api/roster?semester=' + SECOND)).json();
  const moved = second.students.find((student) => student.code === oldStudent.code);
  assert.equal(moved.id, oldStudent.id);
  assert.equal(moved.classId, 'CLASS-A');
  assert.equal(moved.cohortYear, 2023);
  assert.equal(moved.approvalReference, 'DS-TEST-2026');
  const first = await (await coordinator('/api/roster?semester=' + FIRST)).json();
  assert.equal(
    first.students.find((student) => student.id === oldStudent.id).classId,
    oldStudent.classId,
  );
  const history = await (await coordinator('/api/roster/history?semester=' + SECOND)).json();
  assert.ok(history.history.length);
  const badRows = [
    rosterRow(SECOND, { sourceId: 'NEW-SOURCE-2', classId: 'CLASS-B', className: 'Lớp B' }),
    rosterRow(SECOND, {
      studentCode: 'DEMO002',
      email: 'wrong-person@example.test',
      sourceId: 'BAD-IDENTITY',
    }),
  ];
  const xlsx = await makeRosterWorkbook(badRows);
  const rejected = await coordinator('/api/roster/commit', 'POST', {
    fileName: 'danh-sach.xlsx',
    fileBase64: xlsx.toString('base64'),
    reason: 'Đợt có xung đột danh tính',
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await (await coordinator('/api/roster?semester=' + SECOND)).json(), second);
  assert.deepEqual(
    await (await coordinator('/api/roster/history?semester=' + SECOND)).json(),
    history,
  );
  const duplicate = await successful(
    await coordinator('/api/roster/commit', 'POST', {
      rows: [rosterRow()],
      reason: 'Nhập lại cùng nguồn',
    }),
  );
  assert.equal(duplicate.skipped, 1);
  const template = await coordinator('/api/roster/template.xlsx');
  assert.equal(template.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await template.arrayBuffer()));
  assert.equal(book.worksheets[0].getCell('A1').value, 'sourceId');
});

test('lecturer scope applies to reads, writes, batch imports, annual/course and snapshots and is revoked immediately', async (t) => {
  const { login } = await fixture(t);
  const { request: coordinator } = await login(COORDINATOR);
  const { request: teacher, user } = await login(A);
  await login(B);
  await successful(
    await coordinator('/api/roster/commit', 'POST', {
      rows: [rosterRow()],
      reason: 'Phân lớp học kỳ hai',
    }),
  );
  const assignment = await successful(
    await coordinator('/api/assignments', 'POST', {
      semester: SECOND,
      classId: 'CLASS-A',
      lecturerId: user.id,
      reason: 'Phân công có căn cứ',
    }),
    201,
  );
  const visible = await (await teacher('/api/students?semester=' + SECOND)).json();
  assert.deepEqual(
    visible.students.map((student) => student.id),
    ['s001'],
  );
  assert.equal(
    (await (await teacher('/api/students?semester=' + FIRST)).json()).students.length,
    0,
  );
  assert.equal((await teacher('/api/assessments/s002?semester=' + SECOND)).status, 403);
  await successful(
    await teacher('/api/assessments/s001', 'PUT', {
      semester: SECOND,
      gpa: 8.5,
      complianceConfirmed: true,
      offlineActivityCount: 7,
    }),
  );
  const mixed = await teacher('/api/import/commit', 'POST', {
    rows: [gradeRow(), gradeRow({ sourceId: 'FORBIDDEN', studentCode: 'DEMO002' })],
  });
  assert.ok([400, 403].includes(mixed.status));
  assert.equal(
    (await (await teacher('/api/official-records?semester=' + SECOND)).json()).records.length,
    0,
  );
  await successful(await teacher('/api/import/commit', 'POST', { rows: [gradeRow()] }));
  const records = await (await teacher('/api/official-records?semester=' + SECOND)).json();
  assert.ok(records.records.every((record) => record.studentId === 's001'));
  const course = await successful(
    await teacher('/api/course/s001?cohortYear=2026&standardSemesters=2'),
  );
  const inaccessible = course.semesters.find((semester) => semester.semester === FIRST);
  assert.ok(!inaccessible || inaccessible.officialTotal === null);
  const annual = await successful(
    await teacher('/api/reports?semester=' + SECOND + '&academicYear=2026-2027'),
  );
  assert.equal(
    annual.students[0].annualTotal,
    null,
    'Unassigned historical semester cannot supply hidden scores',
  );
  for (const endpoint of ['/api/audit', `/api/semesters/${SECOND}/snapshots`])
    assert.equal((await teacher(endpoint)).status, 403);
  assert.equal((await teacher('/api/settings', 'PUT', { riskThreshold: 10 })).status, 403);
  await successful(
    await coordinator(`/api/assignments/${assignment.assignment.id}/revoke`, 'POST', {
      reason: 'Kết thúc phân công',
    }),
  );
  assert.equal(
    (await (await teacher('/api/students?semester=' + SECOND)).json()).students.length,
    0,
  );
  assert.equal((await teacher('/api/assessments/s001?semester=' + SECOND)).status, 403);
});

test('closed roster and sources stay frozen while audited permission changes do not reopen results', async (t) => {
  const { login } = await fixture(t);
  const { request: coordinator } = await login(COORDINATOR);
  const teacher = await login(A);
  await successful(
    await coordinator('/api/roster/commit', 'POST', {
      rows: [rosterRow()],
      reason: 'Danh sách trước chốt',
    }),
  );
  await successful(
    await coordinator(`/api/semesters/${SECOND}/transition`, 'POST', {
      action: 'close',
      reason: 'Chốt thử',
      acknowledgeIncomplete: true,
    }),
  );
  const before = await (await coordinator('/api/roster?semester=' + SECOND)).json();
  const oldFirst = await (await coordinator('/api/roster?semester=' + FIRST)).json();
  const result = await coordinator('/api/roster/commit', 'POST', {
    rows: [
      rosterRow(FIRST, { sourceId: 'OPEN-ROSTER', classId: 'CLASS-C', className: 'Lớp C' }),
      rosterRow(SECOND, { sourceId: 'CLOSED-ROSTER', classId: 'CLASS-D', className: 'Lớp D' }),
    ],
    reason: 'Tệp nhiều kỳ',
  });
  assert.ok([400, 409].includes(result.status));
  assert.deepEqual(await (await coordinator('/api/roster?semester=' + FIRST)).json(), oldFirst);
  assert.deepEqual(await (await coordinator('/api/roster?semester=' + SECOND)).json(), before);
  const snapshots = await (await coordinator(`/api/semesters/${SECOND}/snapshots`)).json();
  const snapshotPath = `/api/semesters/${SECOND}/snapshots/${snapshots.snapshots[0].id}`;
  const snapshot = await (await coordinator(snapshotPath)).json();
  const assigned = await successful(
    await coordinator('/api/assignments', 'POST', {
      semester: SECOND,
      classId: 'CLASS-A',
      lecturerId: teacher.user.id,
      reason: 'Cấp quyền đọc kết quả đã chốt',
    }),
    201,
  );
  assert.equal(
    (await (await teacher.request('/api/students?semester=' + SECOND)).json()).students.length,
    1,
  );
  await successful(
    await coordinator(`/api/assignments/${assigned.assignment.id}/revoke`, 'POST', {
      reason: 'Thu hồi khi kết thúc phụ trách',
    }),
  );
  assert.equal(
    (await (await teacher.request('/api/students?semester=' + SECOND)).json()).students.length,
    0,
  );
  assert.deepEqual(await (await coordinator(snapshotPath)).json(), snapshot);
  assert.equal(
    (await coordinator('/api/assessments/s001', 'PUT', { semester: SECOND, gpa: 9 })).status,
    409,
  );
});
