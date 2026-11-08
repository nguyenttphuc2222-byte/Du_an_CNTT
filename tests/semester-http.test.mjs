import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createApp } from '../src/server.mjs';
import { makeCsv, makeImportWorkbook, IMPORT_COLUMNS } from '../src/files.mjs';

async function fixture(t) {
  let currentTime = new Date('2027-01-01T00:00:00Z');
  const app = await createApp({
    port: 0,
    dbPath: ':memory:',
    clock: () => currentTime,
    config: { demoEnabled: true, googleClientId: '', googleClientSecret: '' },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  function client() {
    let cookies = '';
    return async (path, method = 'GET', payload) => {
      const response = await fetch(base + path, {
        method,
        headers: { Cookie: cookies, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (response.headers.getSetCookie().length)
        cookies = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      return response;
    };
  }
  const lecturer = client(),
    student = client();
  await lecturer('/api/auth/demo', 'POST', { userId: 'demo-lecturer' });
  await student('/api/auth/demo', 'POST', { userId: 'demo-student' });
  return {
    app,
    lecturer,
    student,
    anonymous: client(),
    setTime: (value) => {
      currentTime = new Date(value);
    },
  };
}
const period = {
  id: 'nam-moi-dot-a',
  name: 'Học kỳ 1 năm 2027–2028',
  academicYear: '2027-2028',
  term: 1,
  annualIncluded: true,
  courseIncluded: true,
};
const claim = (semester) => ({
  semester,
  title: 'Seminar kiểm thử học kỳ',
  organizer: 'Khoa CNTT',
  date: '2027-01-01',
  criterionId: 'academic_seminar',
  quantity: 1,
});
const official = (semester, suffix = semester) => ({
  semester,
  sourceId: `CATALOGUE-${suffix}`,
  studentCode: '523h0080',
  title: `Khoản nguồn ${suffix}`,
  criterionId: 'academic_seminar',
  quantity: 1,
  date: '2027-01-01',
});
async function enrollPeriod(lecturer, semester) {
  const result = await lecturer('/api/roster/copy', 'POST', {
    fromSemester: '2026-2027-HK1',
    toSemester: semester,
    reason: 'Ghi danh rõ ràng cho bộ kiểm thử học kỳ',
  });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
}

test('HTTP catalogue permissions, deadline boundaries, close/reopen and immutable history', async (t) => {
  const { lecturer, student, anonymous, setTime } = await fixture(t);
  assert.equal((await anonymous('/api/semesters')).status, 401);
  assert.equal((await student('/api/semesters', 'POST', period)).status, 403);
  assert.equal(
    (
      await lecturer('/api/semesters', 'POST', {
        ...period,
        startsAt: '2027-01-01T00:00:01Z',
        deadline: '2027-01-01T00:00:02Z',
      })
    ).status,
    201,
  );
  await enrollPeriod(lecturer, period.id);
  assert.equal((await student('/api/claims', 'POST', claim(period.id))).status, 409);
  setTime('2027-01-01T00:00:01Z');
  assert.equal((await student('/api/claims', 'POST', claim(period.id))).status, 201);
  setTime('2027-01-01T00:00:02Z');
  assert.equal(
    (await student('/api/claims', 'POST', { ...claim(period.id), title: 'Sau hạn' })).status,
    409,
  );
  assert.equal(
    (
      await lecturer('/api/assessments/s001', 'PUT', {
        semester: period.id,
        gpa: 8.5,
        complianceConfirmed: true,
        offlineActivityCount: 7,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await student(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'close',
        reason: 'Thử giả quyền',
        acknowledgeIncomplete: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'review',
        reason: 'Bắt đầu tổng hợp',
      })
    ).status,
    200,
  );
  assert.equal(
    (await lecturer('/api/import/commit', 'POST', { rows: [official(period.id)] })).status,
    200,
  );
  assert.equal(
    (
      await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'close',
        reason: 'Lần đầu còn hồ sơ thiếu',
      })
    ).status,
    409,
  );
  const close = await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
    action: 'close',
    reason: 'Chốt với xác nhận hồ sơ thiếu',
    acknowledgeIncomplete: true,
  });
  assert.equal(close.status, 200, JSON.stringify(await close.clone().json()));
  const history = await (await lecturer(`/api/semesters/${period.id}/snapshots`)).json();
  assert.equal(history.snapshots.length, 1);
  const snapshotId = history.snapshots[0].id;
  const original = await (
    await lecturer(`/api/semesters/${period.id}/snapshots/${snapshotId}`)
  ).json();
  assert.equal(original.snapshot.version, 1);
  assert.ok(original.snapshot.rules);
  assert.equal(original.snapshot.raw.records[0].sourceId, `CATALOGUE-${period.id}`);
  assert.ok(original.snapshot.raw.claims.length);
  assert.ok(original.snapshot.students.some((item) => item.evaluationStatus === 'no_data'));
  assert.equal((await student(`/api/semesters/${period.id}/snapshots`)).status, 403);
  assert.equal(
    (await lecturer('/api/assessments/s001', 'PUT', { semester: period.id, gpa: 9 })).status,
    409,
  );
  assert.equal(
    (await lecturer('/api/activities', 'POST', { ...claim(period.id), mode: 'offline' })).status,
    409,
  );
  assert.equal(
    (
      await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'reopen',
        reason: '',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'reopen',
        reason: 'Bổ sung chứng từ',
      })
    ).status,
    200,
  );
  assert.equal(
    (await lecturer('/api/import/commit', 'POST', { rows: [official(period.id, 'lan-2')] })).status,
    200,
  );
  assert.equal(
    (
      await lecturer(`/api/semesters/${period.id}/transition`, 'POST', {
        action: 'close',
        reason: 'Chốt lần hai',
        acknowledgeIncomplete: true,
      })
    ).status,
    200,
  );
  const second = await (await lecturer(`/api/semesters/${period.id}/snapshots`)).json();
  assert.deepEqual(second.snapshots.map((item) => item.version).sort(), [1, 2]);
  assert.deepEqual(
    await (await lecturer(`/api/semesters/${period.id}/snapshots/${snapshotId}`)).json(),
    original,
  );
});

test('CSV, XLSX and Sheets commit reject mixed closed/open terms atomically and recheck after preview', async (t) => {
  const { lecturer } = await fixture(t);
  await lecturer('/api/semesters', 'POST', period);
  const secondPeriod = { ...period, id: 'nam-moi-dot-b', name: 'Học kỳ 2 năm 2027–2028', term: 2 };
  assert.equal((await lecturer('/api/semesters', 'POST', secondPeriod)).status, 201);
  await enrollPeriod(lecturer, period.id);
  await enrollPeriod(lecturer, secondPeriod.id);
  const rows = [official(period.id), official(secondPeriod.id)];
  assert.equal((await lecturer('/api/import/preview', 'POST', { rows })).status, 200);
  await lecturer(`/api/semesters/${secondPeriod.id}/transition`, 'POST', {
    action: 'close',
    reason: 'Khóa sau khi xem trước',
    acknowledgeIncomplete: true,
  });
  const csv = makeCsv(IMPORT_COLUMNS, rows);
  const xlsx = await makeImportWorkbook(rows);
  const attempts = [
    ['/api/import/commit', { csv }],
    ['/api/import/commit', { fileName: 'nhieu-ky.xlsx', fileBase64: xlsx.toString('base64') }],
    ['/api/google/sheets/commit', { rows }],
  ];
  const beforeAudit = await (await lecturer('/api/audit')).json();
  for (const [path, payload] of attempts) {
    const response = await lecturer(path, 'POST', { ...payload, semester: period.id });
    assert.ok([400, 403].includes(response.status), JSON.stringify(await response.clone().json()));
    const data = await (await lecturer(`/api/official-records?semester=${period.id}`)).json();
    assert.equal(data.records.length, 0);
  }
  assert.deepEqual(await (await lecturer('/api/audit')).json(), beforeAudit);
  const response = await lecturer('/api/import/template.xlsx');
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.ok(workbook.getWorksheet('Hoc ky'));
  const catalogue = workbook.getWorksheet('Hoc ky');
  assert.ok(catalogue.getColumn(1).values.includes(period.id));
  assert.ok(catalogue.getColumn(1).values.includes(secondPeriod.id));
});

test('Custom catalogue IDs flow into reports and cannot be changed through scoring settings', async (t) => {
  const { lecturer, student } = await fixture(t);
  await lecturer('/api/semesters', 'POST', period);
  await lecturer('/api/semesters', 'POST', { ...period, id: 'nam-moi-dot-b', term: 2 });
  await enrollPeriod(lecturer, period.id);
  await enrollPeriod(lecturer, 'nam-moi-dot-b');
  for (const semester of [period.id, 'nam-moi-dot-b']) {
    assert.equal(
      (
        await lecturer('/api/assessments/s001', 'PUT', {
          semester,
          gpa: 8.5,
          complianceConfirmed: true,
          offlineActivityCount: 7,
        })
      ).status,
      200,
    );
  }
  const report = await lecturer(`/api/reports?semester=${period.id}&academicYear=2027-2028`);
  assert.equal(report.status, 200, JSON.stringify(await report.clone().json()));
  const data = await report.json();
  assert.equal(data.students.find((item) => item.id === 's001').annualTotal, 36);
  const course = await student('/api/course/s001?cohortYear=2027&standardSemesters=2');
  assert.equal(course.status, 200, JSON.stringify(await course.clone().json()));
  assert.equal((await course.json()).result.officialAverage, 36);
  await lecturer('/api/settings', 'PUT', {
    semesters: ['fake'],
    semesterCatalog: [],
    locked: false,
    riskThreshold: 49,
  });
  const catalogue = await (await student('/api/semesters')).json();
  assert.ok(catalogue.semesters.some((item) => item.id === period.id));
  assert.equal((await (await student('/api/settings')).json()).settings.locked, true);
});
