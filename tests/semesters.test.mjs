import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore as openConfiguredStore } from '../src/store.mjs';
const openStore = (options = {}) => openConfiguredStore({ demoCoordinator: true, ...options });

const FIRST = '2026-2027-HK1',
  SECOND = '2026-2027-HK2';
const row = (semester = SECOND, sourceId = 'NEW-TERM-SOURCE') => ({
  sourceId,
  studentCode: '523h0080',
  title: 'Hội thảo kiểm thử',
  criterionId: 'academic_seminar',
  quantity: 1,
  date: '2026-11-01',
  semester,
  organizer: 'Khoa CNTT',
});
function fixture(t, options = {}) {
  const store = openStore(options);
  t.after(() => store.close());
  return {
    store,
    lecturer: store.getUser('demo-lecturer'),
    student: store.getUser('demo-student'),
  };
}
const rejected = (fn, status = 400) => assert.throws(fn, (error) => error.status === status);
const close = (store, lecturer, id = SECOND) =>
  store.transitionSemester(lecturer, id, {
    action: 'close',
    reason: 'Xác nhận bản chốt kiểm thử',
    acknowledgeIncomplete: true,
  });

test('catalogue is persistent, shared by settings/import/year/course and protected by stored lecturer role', (t) => {
  const { store, lecturer, student } = fixture(t);
  const input = {
    id: 'YEAR27-TERM1',
    name: 'Học kỳ 1 năm 2027',
    academicYear: '2027-2028',
    term: 1,
  };
  rejected(() => store.createSemester({ ...student, role: 'LECTURER' }, input), 403);
  rejected(() => store.listSemesters(null), 401);
  store.createSemester(lecturer, input);
  store.createSemester(lecturer, { ...input, id: 'YEAR27-TERM2', term: 2 });
  store.copyRoster(lecturer, {
    fromSemester: FIRST,
    toSemester: input.id,
    reason: 'Ghi danh rõ ràng cho kiểm thử kỳ mới',
  });
  store.copyRoster(lecturer, {
    fromSemester: FIRST,
    toSemester: 'YEAR27-TERM2',
    reason: 'Ghi danh rõ ràng cho kiểm thử kỳ mới',
  });
  assert.ok(store.getSettings().semesters.includes(input.id));
  assert.ok(store.listSemesters(student).academicYears.includes('2027-2028'));
  assert.equal(store.previewImport(lecturer, [row(input.id)]).summary.valid, 1);
  store.commitImport(lecturer, { rows: [row(input.id)] });
  assert.equal(store.officialRecords(student, { semester: input.id }).records.length, 1);
  const report = store.reports(lecturer, { semester: input.id, academicYear: '2027-2028' });
  assert.deepEqual(
    report.semesterBreakdown.map((period) => period.semester),
    ['YEAR27-TERM1', 'YEAR27-TERM2'],
  );
  assert.equal(report.students[0].annualTotal, null);
  const course = store.courseSummary(student, student.studentId, {
    cohortYear: 2026,
    standardSemesters: 4,
  });
  assert.equal(course.semesters.find((period) => period.semester === input.id).semesterIndex, 3);
  assert.ok(course.result.expectedSemesters.includes(input.id));
  assert.ok(course.result.missingSemesters.includes(input.id));
  assert.ok(
    store.updateSettings(lecturer, { riskThreshold: 20 }).settings.semesters.includes(input.id),
  );
  store.createSemester(lecturer, { ...input, id: 'YEAR27-SUMMER', term: 3 });
  assert.equal(
    store.getSettings().semesterCatalog.find((period) => period.id === 'YEAR27-SUMMER')
      .courseIncluded,
    false,
  );
  rejected(() => store.updateSemester(lecturer, 'YEAR27-SUMMER', { courseIncluded: true }));
  rejected(() => store.createSemester(lecturer, { ...input, id: 'DUPLICATE-TERM' }));
  rejected(() => store.updateSemester(lecturer, input.id, { term: 2 }));
  rejected(() => store.updateSemester(lecturer, input.id, { state: 'closed' }));
  assert.equal(store.getSettings().locked, true, 'The scoring-rule lock is independent');
});

test('student declaration window uses server clock at start and exact deadline; review still allows staff writes', (t) => {
  let time = '2026-11-01T00:00:00.000Z';
  const { store, lecturer, student } = fixture(t, { clock: () => time });
  store.updateSemester(lecturer, SECOND, {
    startsAt: '2026-11-01T00:00:01Z',
    deadline: '2026-11-01T00:00:03Z',
  });
  const claim = (suffix) => ({
    ...row(SECOND, suffix),
    title: suffix,
    evidenceUrl: 'https://example.com/proof.pdf',
  });
  rejected(() => store.createClaim(student, claim('before')), 409);
  time = '2026-11-01T00:00:01.000Z';
  const first = store.createClaim(student, claim('at-start')).claim;
  time = '2026-11-01T00:00:02.999Z';
  store.createClaim(student, claim('before-end'));
  time = '2026-11-01T00:00:03.000Z';
  rejected(() => store.createClaim(student, claim('at-end')), 409);
  assert.equal(
    store.listSemesters(student).semesters.find((period) => period.id === SECOND).canStudentWrite,
    false,
  );
  store.reviewClaim(lecturer, first.id, { status: 'reviewed' });
  store.transitionSemester(lecturer, SECOND, {
    action: 'review',
    reason: 'Đến giai đoạn tổng hợp',
  });
  store.updateSemester(lecturer, SECOND, { deadline: null });
  rejected(() => store.createClaim(student, claim('during-review')), 409);
  store.commitImport(lecturer, { rows: [row(SECOND)] });
  assert.equal(store.officialRecords(student, { semester: SECOND }).records.length, 1);
});

test('close prevents every write route using actual stored semester and keeps mixed-term imports atomic', (t) => {
  const { store, lecturer, student } = fixture(t);
  store.commitImport(lecturer, { rows: [row(SECOND, 'EXISTING')] });
  const claim = store.createClaim(student, {
    ...row(SECOND),
    title: 'Hoạt động khác',
    evidenceUrl: 'https://example.com/proof.pdf',
  }).claim;
  const record = store.officialRecords(lecturer, { semester: SECOND }).records[0];
  close(store, lecturer);
  const actions = [
    () => store.saveAssessment(lecturer, student.studentId, { semester: SECOND, gpa: 8 }),
    () => store.createActivity(lecturer, { ...row(SECOND), organizer: 'Khoa CNTT' }),
    () => store.createClaim(student, { ...row(SECOND), evidenceUrl: 'https://example.com/a.pdf' }),
    () =>
      store.createClaim(lecturer, {
        ...row(SECOND),
        studentId: student.studentId,
        evidenceUrl: 'https://example.com/a.pdf',
      }),
    () => store.reviewClaim(lecturer, claim.id, { status: 'rejected', semester: FIRST }),
    () => store.matchClaim(lecturer, { claimId: claim.id, recordId: record.id, semester: FIRST }),
    () =>
      store.reclassifyLegacy(lecturer, {
        type: 'record',
        id: record.id,
        criterionId: 'academic_seminar',
        semester: FIRST,
      }),
    () => store.updateSemester(lecturer, SECOND, { deadline: null }),
  ];
  for (const action of actions) rejected(action, 409);
  const rows = [row(FIRST, 'OPEN-ROW'), row(SECOND, 'EXISTING')];
  const preview = store.previewImport(lecturer, rows);
  assert.equal(preview.summary.valid, 1);
  assert.equal(
    preview.summary.errors,
    1,
    'Even an exact duplicate in a locked period rejects the batch',
  );
  rejected(() => store.commitImport(lecturer, { rows }));
  assert.ok(
    !store
      .officialRecords(lecturer, { semester: FIRST })
      .records.some((record) => record.sourceId === 'OPEN-ROW'),
  );
  const batchCount = store.officialRecords(lecturer, { semester: FIRST }).batches.length;
  assert.equal(batchCount, 1, 'No partial batch metadata was created');
});

test('commit rechecks a mixed import after preview and a second connection closes one of its semesters', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tdtu-term-race-'));
  const dbPath = join(dir, 'fixture.sqlite');
  const store = openStore({ dbPath });
  const lecturer = store.getUser('demo-lecturer');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const rows = [row(FIRST, 'RACE-A'), row(SECOND, 'RACE-B')];
  assert.equal(store.previewImport(lecturer, rows).summary.valid, 2);
  const another = openStore({ dbPath });
  close(another, another.getUser(lecturer.id));
  another.close();
  rejected(() => store.commitImport(lecturer, { rows }));
  assert.ok(
    !store
      .officialRecords(lecturer, { semester: FIRST })
      .records.some((record) => record.sourceId === 'RACE-A'),
  );
});

test('incomplete close requires explicit acknowledgement and snapshots preserve null publication, rules and source evidence', (t) => {
  const { store, lecturer, student } = fixture(t);
  rejected(
    () => store.transitionSemester(student, SECOND, { action: 'close', reason: 'Không đủ quyền' }),
    403,
  );
  rejected(
    () =>
      store.transitionSemester(lecturer, SECOND, {
        action: 'close',
        reason: 'Chưa xác nhận thiếu dữ liệu',
      }),
    409,
  );
  assert.equal(store.semesterSnapshots(lecturer, SECOND).snapshots.length, 0);
  const result = close(store, lecturer);
  const beforeInvalid = store.semesterSnapshots(lecturer, SECOND);
  for (const action of ['toString', 'constructor', '__proto__'])
    rejected(
      () =>
        store.transitionSemester(lecturer, SECOND, {
          action,
          reason: 'Không phải thao tác hợp lệ',
        }),
      409,
    );
  assert.deepEqual(store.semesterSnapshots(lecturer, SECOND), beforeInvalid);
  assert.equal(
    store.listSemesters(lecturer).semesters.find((period) => period.id === SECOND).canStaffWrite,
    false,
  );
  const snapshot = store.semesterSnapshot(lecturer, SECOND, result.snapshot.id).snapshot;
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.students.length, 30);
  const saved = snapshot.students.find((profile) => profile.id === student.studentId);
  assert.equal(saved.evaluationStatus, 'no_data');
  assert.equal(saved.publishedTotal, null);
  assert.equal(snapshot.rules.criteria.length, 97);
  assert.match(snapshot.rules.sourcePdfSha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.rules.implementationSha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.rules.storeImplementationSha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.raw.students.length, 30);
  assert.equal(store.dashboard(student, { semester: SECOND }).student.publishedTotal, null);
  rejected(() => store.semesterSnapshot(student, SECOND, snapshot.id), 403);
  rejected(() => store.transitionSemester(lecturer, SECOND, { action: 'reopen', reason: '  ' }));
  store.transitionSemester(lecturer, SECOND, {
    action: 'reopen',
    reason: 'Bổ sung nguồn có căn cứ',
  });
  store.saveAssessment(lecturer, student.studentId, {
    semester: SECOND,
    gpa: 8,
    complianceConfirmed: true,
    offlineActivityCount: 7,
  });
  const next = close(store, lecturer).snapshot;
  assert.equal(next.version, 2);
  assert.notEqual(next.id, snapshot.id);
  assert.deepEqual(store.semesterSnapshot(lecturer, SECOND, snapshot.id).snapshot, snapshot);
  assert.equal(
    store
      .semesterSnapshot(lecturer, SECOND, next.id)
      .snapshot.students.find((profile) => profile.id === student.studentId).publishedTotal,
    36,
  );
  assert.deepEqual(
    store.semesterSnapshots(lecturer, SECOND).history.map((event) => event.toState),
    ['closed', 'open', 'closed'],
  );
});

test('closed roster, identity, claims, annual and course scores stay frozen across Google name/role changes and new enrollment', (t) => {
  const { store, lecturer, student } = fixture(t);
  store.saveAssessment(lecturer, student.studentId, {
    semester: SECOND,
    gpa: 8,
    complianceConfirmed: true,
    offlineActivityCount: 7,
  });
  close(store, lecturer, FIRST);
  close(store, lecturer, SECOND);
  const before = store.reports(lecturer, { semester: FIRST, academicYear: '2026-2027' });
  store.updateSettings(lecturer, { riskThreshold: 80 });
  const user = store.ensureGoogleUser({
    sub: 'snapshot-sub',
    email: student.email,
    name: 'Tên Google mới',
    role: 'LECTURER',
    authAudience: 'external',
  });
  assert.equal(user.studentId, student.studentId);
  store.ensureGoogleUser({
    sub: 'snapshot-new-sub',
    email: 'new-person@gmail.com',
    name: 'Sinh viên mới',
    role: 'STUDENT',
    authAudience: 'external',
  });
  const after = store.reports(lecturer, { semester: FIRST, academicYear: '2026-2027' });
  assert.deepEqual(after.students, before.students);
  assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.stats, before.stats);
  assert.equal(after.stats.total, 30);
  assert.equal(
    store
      .claims(lecturer, { semester: FIRST })
      .claims.find((claim) => claim.studentId === student.studentId).studentName,
    before.students.find((profile) => profile.id === student.studentId).name,
  );
  const course = store.courseSummary(lecturer, student.studentId, {
    cohortYear: 2026,
    standardSemesters: 2,
  });
  assert.deepEqual(
    course.semesters.map((profile) => profile.officialTotal),
    [40, 36],
  );
  assert.equal(course.result.officialAverage, 38);
});

test('closed incomplete results are excluded consistently from overall and per-class published risk counts', (t) => {
  const { store, lecturer, student } = fixture(t);
  store.saveAssessment(lecturer, student.studentId, { semester: SECOND, gpa: 8 });
  close(store, lecturer);
  const dashboard = store.dashboard(lecturer, { semester: SECOND });
  assert.equal(dashboard.atRiskCount, 0);
  assert.equal(
    dashboard.classes.reduce((sum, item) => sum + item.atRisk, 0),
    0,
  );
  assert.equal(store.reports(lecturer, { semester: SECOND }).stats.hasData, 0);
});

test('legacy classification cannot change a matched counterpart while that counterpart semester is locked', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tdtu-term-linked-legacy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'fixture.sqlite');
  let store = openStore({ dbPath });
  let lecturer = store.getUser('demo-lecturer');
  store.commitImport(lecturer, { rows: store.getScenarioRows() });
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "UPDATE claims SET semester=?,criterionId=NULL,ruleVersion='legacy-unverified' WHERE id='claim-scenario'",
  ).run(SECOND);
  db.close();
  store = openStore({ dbPath });
  lecturer = store.getUser('demo-lecturer');
  close(store, lecturer, FIRST);
  rejected(
    () =>
      store.reclassifyLegacy(lecturer, {
        type: 'claim',
        id: 'claim-scenario',
        criterionId: 'community_blood_hair_donation',
      }),
    409,
  );
  assert.equal(
    store
      .claims(lecturer, { semester: SECOND })
      .claims.find((claim) => claim.id === 'claim-scenario').legacy,
    true,
  );
  store.close();
});

test('catalogue migration discovers all original IDs without rewriting rows or links and snapshots survive restart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tdtu-term-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'fixture.sqlite');
  let store = openStore({ dbPath });
  const lecturer = store.getUser('demo-lecturer');
  store.commitImport(lecturer, { rows: store.getScenarioRows() });
  store.close();
  const db = new DatabaseSync(dbPath);
  const before = db.prepare('SELECT * FROM records ORDER BY id').all();
  const claim = db.prepare("SELECT * FROM claims WHERE id='claim-scenario'").get();
  db.prepare("UPDATE activities SET semester='ARCHIVED-EVENTS' WHERE id='a1'").run();
  db.prepare("UPDATE assessments SET semester='ARCHIVED-ASSESSMENT' WHERE studentId='s002'").run();
  const saved = JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
  saved.semesters.push('ARCHIVED-SETTINGS');
  db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(saved));
  db.close();
  store = openStore({ dbPath });
  assert.ok(store.getSettings().semesters.includes('ARCHIVED-EVENTS'));
  assert.ok(store.getSettings().semesters.includes('ARCHIVED-ASSESSMENT'));
  assert.ok(store.getSettings().semesters.includes('ARCHIVED-SETTINGS'));
  const legacy = store
    .getSettings()
    .semesterCatalog.find((period) => period.id === 'ARCHIVED-EVENTS');
  assert.equal(legacy.metadataVerified, false);
  assert.equal(legacy.annualIncluded, false);
  store.updateSemester(lecturer, legacy.id, { academicYear: '2025-2026', term: 1 });
  assert.equal(store.getSettings().semesters.filter((id) => id === legacy.id).length, 1);
  const closed = close(store, lecturer).snapshot;
  store.close();
  store = openStore({ dbPath });
  assert.equal(store.semesterSnapshots(lecturer, SECOND).snapshots[0].id, closed.id);
  assert.equal(
    store.listSemesters(lecturer).semesters.find((period) => period.id === SECOND).state,
    'closed',
  );
  rejected(() => store.commitImport(lecturer, { rows: [row(SECOND)] }));
  store.close();
  const verify = new DatabaseSync(dbPath);
  assert.deepEqual(verify.prepare('SELECT * FROM records ORDER BY id').all(), before);
  assert.deepEqual(verify.prepare("SELECT * FROM claims WHERE id='claim-scenario'").get(), claim);
  assert.throws(
    () => verify.prepare('UPDATE semester_snapshots SET payload=? WHERE id=?').run('{}', closed.id),
    /immutable/,
  );
  assert.throws(
    () => verify.prepare('DELETE FROM semester_snapshots WHERE id=?').run(closed.id),
    /immutable/,
  );
  verify.close();
});

test('zero-padded legacy term IDs stay distinct and unverified until explicitly classified', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tdtu-term-padding-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'fixture.sqlite');
  let store = openStore({ dbPath });
  store.close();
  const original = new DatabaseSync(dbPath);
  original.prepare("UPDATE activities SET semester='2026-2027-HK01' WHERE id='a1'").run();
  const before = original.prepare("SELECT * FROM activities WHERE id='a1'").get();
  original.close();
  store = openStore({ dbPath });
  const lecturer = store.getUser('demo-lecturer');
  const legacy = store
    .getSettings()
    .semesterCatalog.find((period) => period.id === before.semester);
  assert.equal(legacy.metadataVerified, false);
  assert.equal(legacy.annualIncluded, false);
  assert.equal(legacy.courseIncluded, false);
  assert.doesNotThrow(() => store.reports(lecturer, { academicYear: '2026-2027' }));
  store.updateSemester(lecturer, legacy.id, { academicYear: '2026-2027', term: 3 });
  assert.equal(store.activities(lecturer, { semester: legacy.id }).activities[0].id, before.id);
  store.close();
  store = openStore({ dbPath });
  assert.equal(
    store.getSettings().semesterCatalog.filter((period) => period.id === legacy.id).length,
    1,
  );
  store.close();
  const verify = new DatabaseSync(dbPath);
  assert.deepEqual(verify.prepare("SELECT * FROM activities WHERE id='a1'").get(), before);
  verify.close();
});
