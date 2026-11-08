import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.mjs';

const FIRST = '2026-2027-HK1',
  SECOND = '2026-2027-HK2';
function fixture(t, options = {}) {
  const store = openStore({ demoCoordinator: true, ...options });
  t.after(() => store.close());
  return {
    store,
    coordinator: store.getUser('demo-lecturer'),
    student: store.getUser('demo-student'),
    other: store.getUser('demo-student-2'),
  };
}
const reject = (action, status) => assert.throws(action, (error) => error.status === status);
const close = (store, coordinator, semester = FIRST) =>
  store.transitionSemester(coordinator, semester, {
    action: 'close',
    reason: 'Chốt kiểm thử',
    acknowledgeIncomplete: true,
  });
const correction = (sourceId, quantity = 2) => ({
  sourceId,
  criterionId: 'community_blood_hair_donation',
  quantity,
  approvalReference: 'QD-PHUC-TRA-2026',
});
const evidenceMeta = (overrides = {}) => ({
  semester: FIRST,
  fileName: 'proof.pdf',
  mimeType: 'application/pdf',
  size: 32,
  sha256: 'a'.repeat(64),
  ...overrides,
});
const uploaded = (overrides = {}) => ({
  id: 'drive_file_123456',
  name: 'proof.pdf',
  url: 'https://drive.google.com/file/d/drive_file_123456/view',
  sharedWith: [],
  sharingComplete: false,
  warning: 'Chưa chia sẻ được',
  ...overrides,
});

test('record appeal appends replacements without double scoring, changing original source or losing matched claim ancestry', (t) => {
  const { store, coordinator, student } = fixture(t);
  store.commitImport(coordinator, { rows: store.getScenarioRows() });
  const original = store
    .officialRecords(coordinator)
    .records.find((row) => row.sourceId === store.getScenarioRows()[0].sourceId);
  assert.equal(store.dashboard(student).student.officialTotal, 50);
  const firstSnapshot = close(store, coordinator).snapshot;
  const before = store.semesterSnapshot(coordinator, FIRST, firstSnapshot.id).snapshot;
  const request = store.createAppeal(student, {
    semester: FIRST,
    targetType: 'record',
    targetId: original.id,
    reason: 'Hai lần hiến máu được xác nhận nhưng nguồn chỉ ghi một lần.',
  }).appeal;
  assert.equal(
    store.dashboard(student).student.officialTotal,
    50,
    'Submitting an appeal never awards points',
  );
  reject(
    () =>
      store.updateAppeal(coordinator, request.id, {
        action: 'approve',
        reason: 'Có căn cứ',
        correction: correction('ADJUST-001'),
      }),
    409,
  );
  reject(
    () =>
      store.createAppeal(student, {
        semester: FIRST,
        targetType: 'record',
        targetId: original.id,
        reason: 'Trùng đang xử lý',
      }),
    409,
  );
  store.transitionSemester(coordinator, FIRST, {
    action: 'reopen',
    reason: 'Mở để điều chỉnh có căn cứ',
  });
  const result = store.updateAppeal(coordinator, request.id, {
    action: 'approve',
    reason: 'Đủ nguồn xác nhận hai lần',
    correction: correction('ADJUST-001'),
  });
  assert.equal(result.appeal.status, 'approved');
  assert.equal(
    store.dashboard(student).student.officialTotal,
    50,
    'The community cap20 remains authoritative',
  );
  assert.equal(
    store.dashboard(student).student.categoryScores.find((row) => row.categoryId === 'community')
      .rawOfficial,
    30,
    'Seed10 + replacement20, without original10 counted again',
  );
  const records = store.officialRecords(student).records;
  const old = records.find((row) => row.id === original.id),
    next = records.find((row) => row.replacesRecordId === original.id);
  assert.equal(old.superseded, true);
  assert.equal(next.points, 20);
  assert.equal(next.matchedClaimId, 'claim-scenario');
  assert.equal(
    store.claims(student).claims.find((row) => row.id === 'claim-scenario').officialRecordId,
    original.id,
  );
  assert.ok(
    !store.reconciliation(coordinator).records.some((row) => [old.id, next.id].includes(row.id)),
  );
  assert.equal(store.commitImport(coordinator, { rows: store.getScenarioRows() }).inserted, 0);
  assert.equal(
    store.dashboard(student).student.categoryScores.find((row) => row.categoryId === 'community')
      .rawOfficial,
    30,
  );
  const secondRequest = store.createAppeal(student, {
    semester: FIRST,
    targetType: 'record',
    targetId: next.id,
    reason: 'Phúc tra kết quả điều chỉnh hiện hành',
  }).appeal;
  store.updateAppeal(coordinator, secondRequest.id, {
    action: 'approve',
    reason: 'Xác minh lại nguồn một lần',
    correction: correction('ADJUST-002', 1),
  });
  assert.equal(store.dashboard(student).student.officialTotal, 50);
  assert.equal(
    store.dashboard(student).student.categoryScores.find((row) => row.categoryId === 'community')
      .rawOfficial,
    20,
  );
  const newest = store
    .officialRecords(student)
    .records.find((row) => row.sourceId === 'ADJUST-002');
  assert.equal(newest.matchedClaimId, 'claim-scenario');
  assert.equal(
    store.officialRecords(student).records.find((row) => row.id === original.id).effectiveRecordId,
    newest.id,
  );
  const snapshot = close(store, coordinator).snapshot;
  const after = store.semesterSnapshot(coordinator, FIRST, snapshot.id).snapshot;
  assert.deepEqual(
    after.raw.records.find((row) => row.id === original.id),
    before.raw.records.find((row) => row.id === original.id),
  );
  assert.deepEqual(store.semesterSnapshot(coordinator, FIRST, firstSnapshot.id).snapshot, before);
  assert.equal(after.raw.recordReplacements.length, 2);
  assert.equal(after.raw.adjustments.length, 2);
});

test('appeal permissions, rejection, information requests and stale fingerprints protect newer assessments and claims', (t) => {
  const { store, coordinator, student, other } = fixture(t);
  const teacher = store.ensureGoogleUser({
    sub: 'no-scope',
    email: 'teacher@example.test',
    name: 'Giảng viên chưa phân công',
    role: 'LECTURER',
    authAudience: 'external',
  });
  reject(
    () =>
      store.createAppeal(other, {
        semester: FIRST,
        targetType: 'claim',
        targetId: 'claim-scenario',
        reason: 'Khác sinh viên',
      }),
    403,
  );
  const appeal = store.createAppeal(student, {
    semester: FIRST,
    targetType: 'claim',
    targetId: 'claim-scenario',
    reason: 'Đề nghị xem lại minh chứng',
  }).appeal;
  reject(() => store.appeal(teacher, appeal.id), 403);
  reject(
    () => store.updateAppeal(student, appeal.id, { action: 'approve', reason: 'Tự duyệt' }),
    403,
  );
  store.updateAppeal(coordinator, appeal.id, {
    action: 'request_info',
    reason: 'Cần bổ sung giấy xác nhận',
  });
  assert.equal(store.appeal(student, appeal.id).appeal.status, 'needs_info');
  store.updateAppeal(student, appeal.id, {
    action: 'supplement',
    reason: 'Đã bổ sung nguồn',
    evidenceUrl: 'https://example.test/proof',
  });
  const officialBefore = store.dashboard(student).student.officialTotal;
  store.updateAppeal(coordinator, appeal.id, {
    action: 'approve',
    reason: 'Đã kiểm tra lại minh chứng',
    correction: { approvalReference: 'XAC-NHAN-001' },
  });
  assert.equal(
    store.claims(student).claims.find((row) => row.id === 'claim-scenario').status,
    'reviewed',
  );
  assert.equal(
    store.dashboard(student).student.officialTotal,
    officialBefore,
    'Claim approval is review only',
  );
  const assessmentAppeal = store.createAppeal(student, {
    semester: SECOND,
    targetType: 'assessment',
    targetId: student.studentId,
    reason: 'Đề nghị cập nhật dữ liệu hồ sơ',
  }).appeal;
  store.saveAssessment(coordinator, student.studentId, { semester: SECOND, gpa: 8 });
  reject(
    () =>
      store.updateAppeal(coordinator, assessmentAppeal.id, {
        action: 'approve',
        reason: 'Không được ghi đè mới',
        correction: { gpa: 9, approvalReference: 'SOURCE-NEW' },
      }),
    409,
  );
  assert.equal(
    store.getAssessment(student, student.studentId, { semester: SECOND }).assessment.gpa,
    8,
  );
  store.updateAppeal(coordinator, assessmentAppeal.id, {
    action: 'reject',
    reason: 'Nguồn mới đã được cập nhật riêng, cần đối chiếu lại',
  });
  const newAppeal = store.createAppeal(student, {
    semester: SECOND,
    targetType: 'assessment',
    reason: 'Phúc tra hồ sơ hiện hành',
  }).appeal;
  store.updateAppeal(coordinator, newAppeal.id, {
    action: 'approve',
    reason: 'Đủ căn cứ điều chỉnh',
    correction: {
      gpa: 9,
      complianceConfirmed: true,
      offlineActivityCount: 7,
      approvalReference: 'SOURCE-FINAL',
    },
  });
  assert.equal(store.dashboard(student, { semester: SECOND }).student.officialTotal, 38);
  assert.equal(store.appeal(student, newAppeal.id).events.length, 2);
});

test('invalid correction rolls back source batch, replacement, appeal decision and notifications atomically', (t) => {
  const { store, coordinator, student } = fixture(t);
  store.commitImport(coordinator, { rows: store.getScenarioRows() });
  const original = store
    .officialRecords(student)
    .records.find((row) => row.sourceId === store.getScenarioRows()[0].sourceId);
  const appeal = store.createAppeal(student, {
    semester: FIRST,
    targetType: 'record',
    targetId: original.id,
    reason: 'Kiểm thử từ chối mức điểm tự nhập',
  }).appeal;
  const beforeRecords = store.officialRecords(student),
    beforeEvents = store.appeal(student, appeal.id).events,
    beforeNotifications = store.notifications(student);
  reject(
    () =>
      store.updateAppeal(coordinator, appeal.id, {
        action: 'approve',
        reason: 'Sai định mức',
        correction: { ...correction('BAD-POINTS'), points: 999 },
      }),
    400,
  );
  assert.deepEqual(store.officialRecords(student), beforeRecords);
  assert.deepEqual(store.appeal(student, appeal.id).events, beforeEvents);
  assert.deepEqual(store.notifications(student), beforeNotifications);
  assert.equal(store.appeal(student, appeal.id).appeal.status, 'pending');
});

test('durable evidence keeps sharing failure distinct, binds owner/student/term and supports closed appeal uploads and permission repair', (t) => {
  const { store, coordinator, student, other } = fixture(t);
  const created = store.beginEvidence(student, evidenceMeta()).evidence;
  assert.equal(created.status, 'uploading');
  const finished = store.finishEvidence(student, created.id, uploaded()).evidence;
  assert.equal(finished.status, 'sharing_failed');
  assert.equal(finished.sharingComplete, false);
  reject(() => store.prepareEvidenceRetry(other, created.id), 403);
  reject(
    () =>
      store.createClaim(other, {
        semester: FIRST,
        title: 'Sai chủ tệp',
        organizer: 'Khoa',
        date: '2026-11-08',
        criterionId: 'academic_seminar',
        evidenceId: created.id,
      }),
    403,
  );
  const claim = store.createClaim(student, {
    semester: FIRST,
    title: 'Kê khai có minh chứng theo dõi',
    organizer: 'Khoa',
    date: '2026-11-08',
    criterionId: 'academic_seminar',
    evidenceId: created.id,
  }).claim;
  assert.equal(
    store.claims(student).claims.find((row) => row.id === claim.id).evidenceId,
    created.id,
  );
  close(store, coordinator);
  assert.equal(store.prepareEvidenceRetry(student, created.id).recipients.evidenceId, created.id);
  reject(() => store.beginEvidence(student, evidenceMeta()), 409);
  const appeal = store.createAppeal(student, {
    semester: FIRST,
    targetType: 'claim',
    targetId: claim.id,
    reason: 'Bổ sung minh chứng sau khi kê khai đã đóng',
  }).appeal;
  const appealEvidence = store.beginEvidence(
    student,
    evidenceMeta({ purpose: 'appeal', appealId: appeal.id }),
  ).evidence;
  store.finishEvidence(
    student,
    appealEvidence.id,
    uploaded({
      id: 'appeal_drive_file_1234',
      sharedWith: [coordinator.email],
      sharingComplete: true,
      warning: '',
    }),
  );
  store.updateAppeal(student, appeal.id, {
    action: 'supplement',
    reason: 'Đã bổ sung',
    evidenceId: appealEvidence.id,
  });
  assert.equal(store.appeal(student, appeal.id).appeal.evidenceId, appealEvidence.id);
  assert.equal(store.dashboard(student).student.officialTotal, 40);
});

test('assignment changes invalidate evidence sharing state and revoke teacher visibility of evidence and notifications', (t) => {
  const { store, coordinator, student } = fixture(t);
  const teacher = store.ensureGoogleUser({
    sub: 'assigned',
    email: 'assigned@example.test',
    name: 'Giảng viên được giao',
    role: 'LECTURER',
    authAudience: 'external',
  });
  const assignment = store.assignLecturer(coordinator, {
    semester: FIRST,
    classId: 'cls1',
    lecturerId: teacher.id,
    reason: 'Phân công',
  }).assignment;
  const staffEvidence = store.beginEvidence(
    teacher,
    evidenceMeta({ studentId: student.studentId }),
  ).evidence;
  store.finishEvidence(
    teacher,
    staffEvidence.id,
    uploaded({ sharedWith: [teacher.email], sharingComplete: true, warning: '' }),
  );
  store.createAppeal(student, {
    semester: FIRST,
    targetType: 'claim',
    targetId: 'claim-scenario',
    reason: 'Cần kiểm tra',
  });
  assert.equal(
    store.notifications(teacher).notifications.filter((row) => row.type === 'appeal_submitted')
      .length,
    1,
  );
  store.revokeAssignment(coordinator, assignment.id, { reason: 'Hết phụ trách' });
  assert.equal(store.evidence(student, staffEvidence.id).evidence.status, 'needs_reshare');
  assert.equal(store.evidenceList(teacher, { semester: FIRST }).evidence.length, 0);
  reject(() => store.evidence(teacher, staffEvidence.id), 404);
  assert.equal(store.notifications(teacher).unreadCount, 0);
  reject(() => store.prepareEvidenceRetry(teacher, staffEvidence.id), 403);
});

test('deadline notifications and read states are idempotent and persist across restart without changing score data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tdtu-workflows-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'fixture.sqlite');
  let time = '2026-11-08T00:00:00.000Z';
  let store = openStore({ dbPath, demoCoordinator: true, clock: () => time });
  const coordinator = store.getUser('demo-lecturer'),
    student = store.getUser('demo-student');
  store.updateSemester(coordinator, FIRST, { deadline: '2026-11-09T00:00:00Z' });
  assert.equal(
    store.refreshNotifications().created,
    2,
    'Only linked student accounts get own reminders',
  );
  assert.equal(store.refreshNotifications().created, 0);
  const first = store
    .notifications(student)
    .notifications.find((row) => row.type === 'deadline_soon');
  store.readNotification(student, first.id);
  store.close();
  store = openStore({ dbPath, demoCoordinator: true, clock: () => time });
  assert.ok(store.notifications(student).notifications.find((row) => row.id === first.id).readAt);
  time = '2026-11-09T00:00:00.000Z';
  store.refreshNotifications();
  assert.equal(
    store.notifications(student).notifications.filter((row) => row.type === 'deadline_passed')
      .length,
    1,
  );
  store.readAllNotifications(student);
  assert.equal(store.notifications(student).unreadCount, 0);
  const score = store.dashboard(student).student.officialTotal;
  assert.equal(score, 40);
  store.close();
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n > 0, true);
  db.close();
});

test('evidence retries serialize, retain only validated managed permission IDs and recover a stale retry without changing results', (t) => {
  let instant = '2026-11-08T00:00:00.000Z';
  const { store, student, coordinator } = fixture(t, { clock: () => instant });
  const evidence = store.beginEvidence(student, evidenceMeta()).evidence;
  store.finishEvidence(
    student,
    evidence.id,
    uploaded({
      sharingComplete: true,
      warning: '',
      managedPermissions: [{ id: 'permission_123', email: 'teacher@example.test' }],
    }),
  );
  const beforeScore = store.dashboard(student).student.officialTotal;
  const preparing = store.prepareEvidenceRetry(student, evidence.id);
  assert.equal(preparing.evidence.status, 'uploading');
  assert.deepEqual(preparing.evidence.managedPermissions, [
    { id: 'permission_123', email: 'teacher@example.test' },
  ]);
  reject(() => store.prepareEvidenceRetry(student, evidence.id), 409);
  store.requestEvidenceShare(student, evidence.id, {
    reason: 'Yêu cầu chia sẻ khi một lượt đang chạy',
  });
  assert.equal(store.evidence(student, evidence.id).evidence.status, 'needs_reshare');
  reject(() => store.prepareEvidenceRetry(student, evidence.id), 409);
  assert.equal(store.evidence(student, evidence.id).evidence.canRetry, false);
  store.finishEvidence(
    student,
    evidence.id,
    uploaded({ retryToken: preparing.retryToken, sharingComplete: true, warning: '' }),
  );
  const second = store.prepareEvidenceRetry(student, evidence.id);
  const teacher = store.ensureGoogleUser({
    sub: 'retry-teacher',
    email: 'retry-teacher@example.test',
    name: 'Giảng viên thay đổi trong lúc chia sẻ',
    role: 'LECTURER',
    authAudience: 'external',
  });
  store.assignLecturer(coordinator, {
    semester: FIRST,
    classId: 'cls1',
    lecturerId: teacher.id,
    reason: 'Thay đổi phân công trong lượt đang chạy',
  });
  assert.equal(store.evidence(student, evidence.id).evidence.status, 'needs_reshare');
  reject(() => store.prepareEvidenceRetry(student, evidence.id), 409);
  store.failEvidence(student, evidence.id, {
    retryToken: second.retryToken,
    message: 'Thử lại sau khi cập nhật phân công',
  });
  const stale = store.prepareEvidenceRetry(student, evidence.id);
  instant = '2026-11-08T00:05:00.000Z';
  const recovered = store.prepareEvidenceRetry(student, evidence.id);
  assert.equal(recovered.evidence.id, evidence.id);
  assert.notEqual(recovered.retryToken, stale.retryToken);
  reject(
    () => store.finishEvidence(student, evidence.id, uploaded({ retryToken: stale.retryToken })),
    409,
  );
  reject(
    () =>
      store.failEvidence(student, evidence.id, {
        retryToken: stale.retryToken,
        message: 'Kết quả lỗi của lượt cũ',
      }),
    409,
  );
  reject(
    () =>
      store.evidenceRecipients(student, { evidenceId: evidence.id, retryToken: stale.retryToken }),
    409,
  );
  reject(() => store.prepareEvidenceRetry(student, evidence.id), 409);
  store.finishEvidence(
    student,
    evidence.id,
    uploaded({
      retryToken: recovered.retryToken,
      managedPermissions: [],
      sharingComplete: true,
      warning: '',
    }),
  );
  assert.deepEqual(store.evidence(student, evidence.id).evidence.managedPermissions, []);
  const afterCompletion = store.prepareEvidenceRetry(student, evidence.id);
  store.failEvidence(student, evidence.id, {
    retryToken: afterCompletion.retryToken,
    message: 'Kết thúc lượt kiểm thử',
  });
  const before = store.evidence(student, evidence.id);
  reject(
    () =>
      store.finishEvidence(
        student,
        evidence.id,
        uploaded({
          managedPermissions: [{ id: '../../not-a-permission', email: 'teacher@example.test' }],
        }),
      ),
    400,
  );
  assert.deepEqual(store.evidence(student, evidence.id), before);
  assert.equal(store.dashboard(student).student.officialTotal, beforeScore);
});
