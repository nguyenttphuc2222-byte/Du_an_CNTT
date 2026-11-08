import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.mjs';

const FIRST = '2026-2027-HK1',
  SECOND = '2026-2027-HK2';
const COORDINATOR = 'coordinator@example.test';
const rosterRow = (overrides = {}) => ({
  sourceId: 'ROSTER-001',
  studentCode: '523h0080',
  name: 'Tên từ danh sách nguồn',
  email: '523h0080@student.tdtu.edu.vn',
  classId: 'A',
  className: 'Lớp A',
  faculty: 'CNTT',
  cohortYear: 2023,
  semester: SECOND,
  approvalReference: 'DS-2026-001',
  ...overrides,
});
const scoreRow = (overrides = {}) => ({
  sourceId: 'OFFICIAL-001',
  studentCode: '523h0080',
  semester: SECOND,
  title: 'Seminar có nguồn',
  criterionId: 'academic_seminar',
  quantity: 1,
  date: '2026-11-08',
  ...overrides,
});
const rejects = (fn, status = 403) => assert.throws(fn, (error) => error.status === status);
function fixture(t, options = {}) {
  const store = openStore({ coordinatorEmails: [COORDINATOR], ...options });
  t.after(() => store.close());
  const coordinator = store.ensureGoogleUser({
    sub: 'coordinator-sub',
    email: COORDINATOR,
    name: 'Điều phối viên',
    role: 'LECTURER',
    authAudience: 'external',
  });
  const teacher = store.ensureGoogleUser({
    sub: 'teacher-sub',
    email: 'teacher@example.test',
    name: 'Giảng viên lớp A',
    role: 'LECTURER',
    authAudience: 'external',
  });
  return { store, coordinator, teacher, student: store.getUser('demo-student') };
}
function enroll(store, coordinator, row = rosterRow()) {
  return store.commitRoster(coordinator, { rows: [row], reason: 'Ghi danh có nguồn xác nhận' });
}
function assign(store, coordinator, teacher, semester = SECOND, classId = 'A') {
  return store.assignLecturer(coordinator, {
    semester,
    classId,
    lecturerId: teacher.id,
    reason: 'Phân công giảng viên phụ trách lớp',
  }).assignment;
}
function close(store, coordinator, semester = SECOND) {
  return store.transitionSemester(coordinator, semester, {
    action: 'close',
    reason: 'Chốt kết quả có xác nhận thiếu dữ liệu',
    acknowledgeIncomplete: true,
  }).snapshot;
}

test('coordinator privileges fail closed and never trust caller-provided role, email or capability', (t) => {
  const { store, coordinator, teacher, student } = fixture(t);
  assert.equal(store.access(coordinator).isCoordinator, true);
  assert.equal(store.access(teacher).isCoordinator, false);
  assert.equal(
    store.access({ ...teacher, email: COORDINATOR, isCoordinator: true }).isCoordinator,
    false,
  );
  rejects(() =>
    store.assignLecturer(
      { ...teacher, email: COORDINATOR, role: 'LECTURER' },
      { semester: SECOND, classId: 'cls1', lecturerId: teacher.id, reason: 'Tự cấp quyền' },
    ),
  );
  rejects(() =>
    store.commitRoster(
      { ...student, role: 'LECTURER', email: COORDINATOR },
      { rows: [rosterRow()], reason: 'Giả vai trò' },
    ),
  );
  rejects(() => store.audit(teacher));
  rejects(() => store.semesterSnapshots(teacher, FIRST));
  rejects(() => store.updateSettings(teacher, { riskThreshold: 10 }));
  const downgraded = store.ensureGoogleUser({
    sub: 'coordinator-sub',
    email: COORDINATOR,
    name: 'Điều phối viên',
    role: 'STUDENT',
    authAudience: 'external',
  });
  assert.equal(store.access(downgraded).isCoordinator, false);
  rejects(() => store.createSemester(coordinator, { id: 'FAKE' }));
  const noManagers = openStore();
  t.after(() => noManagers.close());
  assert.equal(noManagers.access(noManagers.getUser('demo-lecturer')).isCoordinator, false);
});

test('new periods need explicit roster; imports preserve IDs, sources, identity and semester-specific class history', (t) => {
  const { store, coordinator, student } = fixture(t);
  const first = store
    .roster(coordinator, { semester: FIRST })
    .students.find((row) => row.id === student.studentId);
  const result = enroll(store, coordinator);
  assert.equal(result.updated, 1);
  const second = store
    .roster(coordinator, { semester: SECOND })
    .students.find((row) => row.id === student.studentId);
  assert.equal(second.id, student.studentId);
  assert.equal(second.classId, 'A');
  assert.equal(second.cohortYear, 2023);
  assert.equal(second.sourceId, 'ROSTER-001');
  assert.equal(
    store
      .roster(coordinator, { semester: FIRST })
      .students.find((row) => row.id === student.studentId).classId,
    first.classId,
  );
  assert.equal(enroll(store, coordinator).skipped, 1);
  const before = store.roster(coordinator, { semester: SECOND });
  const history = store.rosterHistory(coordinator, { semester: SECOND });
  rejects(
    () =>
      enroll(store, coordinator, rosterRow({ email: 'other@example.test', sourceId: 'CONFLICT' })),
    400,
  );
  rejects(
    () =>
      store.commitRoster(coordinator, {
        rows: [
          rosterRow({ sourceId: 'VALID-NEW', classId: 'B', className: 'Lớp B' }),
          rosterRow({ sourceId: 'BAD', studentCode: 'DEMO002', email: 'other@example.test' }),
        ],
        reason: 'Tệp có một dòng sai',
      }),
    400,
  );
  assert.deepEqual(store.roster(coordinator, { semester: SECOND }), before);
  assert.deepEqual(store.rosterHistory(coordinator, { semester: SECOND }), history);
  store.createSemester(coordinator, {
    id: 'new-term',
    name: 'Kỳ mới',
    academicYear: '2027-2028',
    term: 1,
  });
  assert.equal(store.roster(coordinator, { semester: 'new-term' }).students.length, 0);
  rejects(
    () => store.saveAssessment(coordinator, student.studentId, { semester: 'new-term', gpa: 8 }),
    409,
  );
  store.copyRoster(coordinator, {
    fromSemester: SECOND,
    toSemester: 'new-term',
    reason: 'Duyệt sao chép danh sách có căn cứ',
  });
  const copied = store
    .roster(coordinator, { semester: 'new-term' })
    .students.find((row) => row.id === student.studentId);
  assert.equal(copied.classId, 'A');
  assert.equal(copied.cohortYear, 2023);
  assert.notEqual(copied.sourceId, second.sourceId);
  assert.equal(store.dashboard(student, { semester: 'new-term' }).student.hasOfficialData, false);
  const copiedRoster = store.roster(coordinator, { semester: 'new-term' });
  const copiedHistory = store.rosterHistory(coordinator, { semester: 'new-term' });
  rejects(
    () =>
      store.copyRoster(coordinator, {
        fromSemester: FIRST,
        toSemester: 'new-term',
        reason: 'Không tự ghi đè danh sách hiện có',
      }),
    409,
  );
  assert.deepEqual(store.roster(coordinator, { semester: 'new-term' }), copiedRoster);
  assert.deepEqual(store.rosterHistory(coordinator, { semester: 'new-term' }), copiedHistory);
});

test('assigned scope protects reads, every result write, mixed imports and historical aggregate periods', (t) => {
  const { store, coordinator, teacher, student } = fixture(t);
  enroll(store, coordinator);
  const assignment = assign(store, coordinator, teacher);
  assert.deepEqual(
    store.students(teacher, { semester: SECOND }).students.map((row) => row.id),
    ['s001'],
  );
  assert.equal(store.students(teacher, { semester: FIRST }).students.length, 0);
  assert.deepEqual(
    store.roster(teacher, { semester: SECOND }).classes.map((row) => row.id),
    ['A'],
  );
  rejects(() => store.getAssessment(teacher, 's002', { semester: SECOND }));
  rejects(() => store.saveAssessment(teacher, 's002', { semester: SECOND, gpa: 8 }));
  rejects(() =>
    store.createClaim(teacher, {
      semester: SECOND,
      studentId: 's002',
      title: 'Ngoài lớp',
      organizer: 'Khoa',
      date: '2026-11-08',
      criterionId: 'academic_seminar',
    }),
  );
  const foreignClaim = store.claims(coordinator, { semester: FIRST }).claims[0];
  rejects(() =>
    store.reviewClaim(teacher, foreignClaim.id, { status: 'reviewed', semester: SECOND }),
  );
  const preview = store.previewImport(teacher, [
    scoreRow(),
    scoreRow({ sourceId: 'OUTSIDE', studentCode: 'DEMO002' }),
  ]);
  assert.equal(preview.summary.valid, 1);
  assert.equal(preview.summary.errors, 1);
  assert.equal(preview.rows[1].studentName, undefined);
  rejects(
    () =>
      store.commitImport(teacher, {
        rows: [scoreRow(), scoreRow({ sourceId: 'OUTSIDE', studentCode: 'DEMO002' })],
      }),
    400,
  );
  assert.equal(store.officialRecords(teacher, { semester: SECOND }).records.length, 0);
  store.saveAssessment(teacher, student.studentId, {
    semester: SECOND,
    gpa: 8,
    complianceConfirmed: true,
    offlineActivityCount: 7,
  });
  store.commitImport(teacher, { rows: [scoreRow()] });
  assert.deepEqual(store.officialRecords(teacher, { semester: SECOND }).batches, []);
  assert.equal(store.dashboard(teacher, { semester: SECOND }).recentActivity.length, 0);
  assert.equal(
    store.reports(teacher, { semester: SECOND, academicYear: '2026-2027' }).students[0].annualTotal,
    null,
  );
  const course = store.courseSummary(teacher, student.studentId, {
    cohortYear: 2026,
    standardSemesters: 2,
  });
  assert.equal(course.semesters.find((row) => row.semester === FIRST).officialTotal, null);
  store.revokeAssignment(coordinator, assignment.id, { reason: 'Thu hồi quyền phụ trách' });
  assert.equal(store.students(teacher, { semester: SECOND }).students.length, 0);
  rejects(() => store.getAssessment(teacher, student.studentId, { semester: SECOND }));
  rejects(() =>
    store.courseSummary(teacher, student.studentId, { cohortYear: 2026, standardSemesters: 2 }),
  );
});

test('transfers expose only the new assignee history scope while student and coordinator retain complete history', (t) => {
  const { store, coordinator, teacher, student } = fixture(t);
  enroll(store, coordinator);
  assign(store, coordinator, teacher);
  const events = store.rosterHistory(teacher, {
    semester: SECOND,
    studentId: student.studentId,
  }).history;
  assert.equal(events.length, 1);
  assert.equal(events[0].before, null);
  assert.equal(events[0].beforeRedacted, true);
  assert.equal(events[0].after.classId, 'A');
  assert.ok(store.rosterHistory(student, { semester: SECOND }).history.length > events.length);
  assert.ok(
    store.rosterHistory(coordinator, { semester: SECOND, studentId: student.studentId }).history[0]
      .after.classId === 'cls1',
  );
});

test('closed rosters freeze names and classes; current assignments may change without changing published snapshot', (t) => {
  const { store, coordinator, teacher, student } = fixture(t);
  enroll(store, coordinator);
  const snapshot = close(store, coordinator);
  const before = store.roster(coordinator, { semester: SECOND });
  const original = store.semesterSnapshot(coordinator, SECOND, snapshot.id).snapshot;
  const assignment = assign(store, coordinator, teacher);
  assert.equal(store.roster(teacher, { semester: SECOND }).students.length, 1);
  store.ensureGoogleUser({
    sub: 'student-current-name',
    email: student.email,
    name: 'Tên Google sau khi chốt',
    role: 'STUDENT',
    authAudience: 'external',
  });
  assert.deepEqual(store.roster(coordinator, { semester: SECOND }), before);
  rejects(
    () =>
      enroll(
        store,
        coordinator,
        rosterRow({ sourceId: 'AFTER-CLOSE', classId: 'B', className: 'Lớp B' }),
      ),
    400,
  );
  store.revokeAssignment(coordinator, assignment.id, {
    reason: 'Ngừng phụ trách kỳ cũ mà không mở kết quả',
  });
  assert.equal(store.roster(teacher, { semester: SECOND }).students.length, 0);
  assert.deepEqual(store.semesterSnapshot(coordinator, SECOND, snapshot.id).snapshot, original);
  assert.equal(original.raw.enrollments.length, 30);
  assert.equal(original.raw.enrollmentHistory.length > 0, true);
});

test('evidence recipients use current term assignees and coordinators, never all lecturers, and reject unassigned writes', (t) => {
  const { store, coordinator, teacher, student } = fixture(t);
  const other = store.ensureGoogleUser({
    sub: 'other-teacher-sub',
    email: 'other@example.test',
    name: 'Giảng viên khác',
    role: 'LECTURER',
    authAudience: 'external',
  });
  enroll(store, coordinator);
  const assignment = assign(store, coordinator, teacher);
  assign(store, coordinator, other, FIRST, 'cls1');
  assert.deepEqual(
    store.evidenceRecipients(student, { semester: SECOND }).emails.sort(),
    [COORDINATOR, teacher.email].sort(),
  );
  rejects(() =>
    store.evidenceRecipients(other, { semester: SECOND, studentId: student.studentId }),
  );
  store.revokeAssignment(coordinator, assignment.id, { reason: 'Đổi người phụ trách' });
  assert.deepEqual(store.evidenceRecipients(student, { semester: SECOND }).emails, [COORDINATOR]);
  const newStudent = store.ensureGoogleUser({
    sub: 'unenrolled-student',
    email: 'new-student@example.test',
    name: 'Hồ sơ mới chưa ghi danh',
    role: 'STUDENT',
    authAudience: 'external',
  });
  assert.equal(store.dashboard(newStudent, { semester: SECOND }).enrollment, null);
  assert.equal(store.dashboard(newStudent, { semester: SECOND }).student.id, newStudent.studentId);
  assert.equal(
    store
      .roster(coordinator, { semester: SECOND })
      .unenrolledStudents.some((row) => row.id === newStudent.studentId),
    true,
  );
  rejects(() => store.evidenceRecipients(newStudent, { semester: SECOND }), 409);
  assert.equal('unenrolledStudents' in store.roster(student, { semester: SECOND }), false);
});

test('migration and restart preserve original score IDs, canonical source payloads and matched links without enrolling future terms', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tdtu-roster-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'fixture.sqlite');
  let store = openStore({ dbPath, demoCoordinator: true });
  let lecturer = store.getUser('demo-lecturer');
  store.commitImport(lecturer, { rows: store.getScenarioRows() });
  store.close();
  const db = new DatabaseSync(dbPath);
  const records = db.prepare('SELECT * FROM records ORDER BY id').all();
  const claims = db.prepare('SELECT * FROM claims ORDER BY id').all();
  db.exec(
    'DROP TABLE lecturer_assignments; DROP TABLE enrollment_history; DROP TABLE roster_sources; DROP TABLE roster_batches; DROP TABLE enrollments; DROP TABLE roster_migrations;',
  );
  db.close();
  store = openStore({ dbPath, demoCoordinator: true });
  lecturer = store.getUser('demo-lecturer');
  assert.equal(store.roster(lecturer, { semester: FIRST }).students.length, 30);
  assert.equal(store.roster(lecturer, { semester: FIRST }).students[0].cohortYear, null);
  store.createSemester(lecturer, {
    id: 'future',
    name: 'Kỳ tương lai',
    academicYear: '2027-2028',
    term: 1,
  });
  const count = store.rosterHistory(lecturer, { semester: FIRST }).history.length;
  store.close();
  store = openStore({ dbPath, demoCoordinator: true });
  assert.equal(store.roster(lecturer, { semester: 'future' }).students.length, 0);
  assert.equal(store.rosterHistory(lecturer, { semester: FIRST }).history.length, count);
  enroll(store, lecturer);
  store.close();
  const verify = new DatabaseSync(dbPath);
  assert.deepEqual(verify.prepare('SELECT * FROM records ORDER BY id').all(), records);
  assert.deepEqual(verify.prepare('SELECT * FROM claims ORDER BY id').all(), claims);
  assert.throws(
    () => verify.prepare('UPDATE enrollment_history SET payload=?').run('{}'),
    /immutable/,
  );
  assert.throws(
    () => verify.prepare('UPDATE roster_sources SET canonical=?').run('{}'),
    /immutable/,
  );
  verify.close();
});
