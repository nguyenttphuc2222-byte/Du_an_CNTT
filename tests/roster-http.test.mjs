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
  let token, workspace;
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: {
      id_token: 'mock-identity-token',
      ...(workspace
        ? {
            access_token: 'mock-workspace-token',
            expiry_date: Date.now() + 3600000,
            scope:
              'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly',
          }
        : {}),
    },
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
    async function signIn(connect = false) {
      workspace = connect;
      const start = await request(
        connect ? '/auth/google/connect?returnTo=roster' : '/auth/google',
      );
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
      assert.equal(callback.headers.get('location'), connect ? '/?googleConnected=1' : '/');
    }
    await signIn();
    const session = await (await request('/api/session')).json();
    return { request, connect: () => signIn(true), user: session.user, access: session.access };
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

function mockRosterSheet(t) {
  const id = 'roster_sheet_test_12345';
  const tab = {
    sheetId: 23,
    title: "Danh sách lớp 'A'",
    index: 1,
    sheetType: 'GRID',
    gridProperties: { rowCount: 1000, columnCount: 26 },
  };
  let rows = [ROSTER_COLUMNS, ROSTER_COLUMNS.map((field) => rosterRow()[field])];
  const calls = [];
  t.mock.method(OAuth2Client.prototype, 'request', async (options) => {
    const url = new URL(options.url);
    calls.push(url);
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(url.pathname, '/v4/spreadsheets/' + id);
    assert.equal(options.method, 'GET');
    const properties = { title: 'Danh sách thử nghiệm' };
    if (!url.searchParams.has('ranges'))
      return {
        data: {
          properties,
          sheets: [
            { properties: { ...tab, sheetId: 0, title: 'Hướng dẫn', index: 0 } },
            { properties: tab },
          ],
        },
      };
    assert.equal(url.searchParams.get('ranges'), "'Danh sách lớp ''A'''");
    return {
      data: {
        sheets: [
          {
            properties: tab,
            data: [
              {
                rowData: rows.map((row) => ({
                  values: row.map((value) =>
                    typeof value === 'object'
                      ? value
                      : {
                          formattedValue: String(value),
                          userEnteredValue: { stringValue: String(value) },
                        },
                  ),
                })),
              },
            ],
          },
        ],
      },
    };
  });
  return {
    input: {
      url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tab.sheetId}`,
      semester: SECOND,
    },
    tab,
    calls,
    setRows: (...data) =>
      (rows = [
        ROSTER_COLUMNS,
        ...data.map((row) => (row ? ROSTER_COLUMNS.map((key) => row[key] ?? '') : [])),
      ]),
  };
}

test('roster Google Sheets uses the selected tab, previews without writing and records provenance on confirmation', async (t) => {
  const sheet = mockRosterSheet(t);
  const { login, app } = await fixture(t);
  const coordinator = await login(COORDINATOR);
  const before = app.store.roster(coordinator.user, { semester: SECOND });
  assert.equal(
    (await coordinator.request('/api/roster/sheets/preview', 'POST', sheet.input)).status,
    403,
  );
  assert.equal(sheet.calls.length, 0);
  await coordinator.connect();
  const preview = await successful(
    await coordinator.request('/api/roster/sheets/preview', 'POST', sheet.input),
  );
  assert.equal(preview.summary.valid, 1);
  assert.equal(preview.rows[0].index, 2);
  assert.equal(
    preview.rows[0].change.before.classId,
    before.students.find((s) => s.id === 's001').classId,
  );
  assert.equal(preview.source.sheetName, sheet.tab.title);
  assert.equal(preview.source.url, sheet.input.url);
  assert.ok(preview.previewToken);
  assert.deepEqual(app.store.roster(coordinator.user, { semester: SECOND }), before);
  const commit = {
    ...sheet.input,
    previewToken: preview.previewToken,
    reason: 'Danh sách lớp đã đối chiếu',
  };
  const result = await successful(
    await coordinator.request('/api/roster/sheets/commit', 'POST', commit),
  );
  assert.equal(result.updated, 1);
  const roster = app.store.roster(coordinator.user, { semester: SECOND });
  assert.equal(roster.students.find((s) => s.id === 's001').classId, 'CLASS-A');
  const history = app.store
    .rosterHistory(coordinator.user, { semester: SECOND, studentId: 's001' })
    .history.at(-1);
  assert.equal(history.source.url, preview.source.url);
  assert.equal(history.source.rowNumber, 2);
  assert.equal(history.after.sourceId, 'ROSTER-S001');
  const student = await login('523h0080@student.tdtu.edu.vn');
  const studentHistory = app.store
    .rosterHistory(student.user, { semester: SECOND, studentId: 's001' })
    .history.at(-1);
  assert.equal(studentHistory.source, undefined);
  const again = await successful(
    await coordinator.request('/api/roster/sheets/preview', 'POST', sheet.input),
  );
  assert.equal(again.summary.duplicate, 1);
  assert.equal(
    app.store
      .rosterHistory(coordinator.user, { semester: SECOND, studentId: 's001' })
      .history.at(-1).batchId,
    result.batchId,
  );
});

test('roster Google Sheets reports physical rows for identity conflicts and mismatched terms, blocking the whole batch', async (t) => {
  const sheet = mockRosterSheet(t);
  sheet.setRows(
    rosterRow(),
    null,
    rosterRow(SECOND, { sourceId: 'BAD-ID', email: 'different@student.tdtu.edu.vn' }),
    rosterRow(FIRST, { sourceId: 'BAD-TERM' }),
  );
  const { login, app } = await fixture(t);
  const coordinator = await login(COORDINATOR);
  await coordinator.connect();
  const before = app.store.roster(coordinator.user, { semester: SECOND });
  const preview = await successful(
    await coordinator.request('/api/roster/sheets/preview', 'POST', sheet.input),
  );
  assert.deepEqual(
    preview.rows.map((row) => [row.index, row.status]),
    [
      [2, 'valid'],
      [4, 'error'],
      [5, 'error'],
    ],
  );
  assert.match(preview.rows[1].errors[0], /MSSV đã gắn email khác/);
  assert.match(preview.rows[2].errors[0], /không khớp kỳ đã chọn/);
  assert.ok(!preview.previewToken);
  const commit = await coordinator.request('/api/roster/sheets/commit', 'POST', {
    ...sheet.input,
    reason: 'Không được ghi',
  });
  assert.ok([400, 409].includes(commit.status));
  assert.deepEqual(app.store.roster(coordinator.user, { semester: SECOND }), before);
  sheet.setRows(
    rosterRow(SECOND, {
      name: { formattedValue: 'Công thức', userEnteredValue: { formulaValue: '="Công thức"' } },
    }),
  );
  const formula = await coordinator.request('/api/roster/sheets/preview', 'POST', sheet.input);
  assert.equal(formula.status, 400);
  assert.match(JSON.stringify(await formula.json()), /công thức/i);
});

test('roster Google Sheets refuses unauthorized reads, forged previews, changed sources, changed roster and locked terms', async (t) => {
  const sheet = mockRosterSheet(t);
  const { login, app } = await fixture(t);
  const teacher = await login(A);
  await teacher.connect();
  for (const action of ['preview', 'commit'])
    assert.equal(
      (await teacher.request('/api/roster/sheets/' + action, 'POST', sheet.input)).status,
      403,
    );
  assert.equal(sheet.calls.length, 0);
  const coordinator = await login(COORDINATOR);
  await coordinator.connect();
  const request = (action, fields = {}) =>
    coordinator.request('/api/roster/sheets/' + action, 'POST', { ...sheet.input, ...fields });
  const before = app.store.roster(coordinator.user, { semester: SECOND });
  const preview = await successful(await request('preview'));
  const { previewToken } = preview;
  const reason = 'Đợt nhập thử';
  const forged = await request('commit', { previewToken: 'forged', reason });
  assert.ok([400, 409].includes(forged.status));
  sheet.setRows(rosterRow(SECOND, { faculty: 'Khoa khác' }));
  assert.equal((await request('commit', { previewToken, reason })).status, 409);
  assert.deepEqual(app.store.roster(coordinator.user, { semester: SECOND }), before);
  sheet.setRows(rosterRow());
  app.store.commitRoster(coordinator.user, {
    rows: [
      rosterRow(SECOND, {
        sourceId: 'ROSTER-OTHER',
        classId: 'CLASS-OTHER',
        className: 'Lớp khác',
      }),
    ],
    reason: 'Danh sách khác được ghi sau xem trước',
  });
  assert.equal((await request('commit', { previewToken, reason })).status, 409);
  const refreshed = await successful(await request('preview'));
  app.store.transitionSemester(coordinator.user, SECOND, {
    action: 'close',
    reason: 'Chốt sau xem trước',
    acknowledgeIncomplete: true,
  });
  assert.equal(
    (await request('commit', { previewToken: refreshed.previewToken, reason })).status,
    409,
  );
});

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
