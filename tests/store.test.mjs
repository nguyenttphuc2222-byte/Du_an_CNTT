import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore as openConfiguredStore } from '../src/store.mjs';
import { RULE_VERSION, CATEGORIES, CLASSIFICATIONS } from '../src/regulations.mjs';
// These scoring fixtures explicitly enable the published demo coordinator.
const openStore = (options = {}) => openConfiguredStore({ demoCoordinator: true, ...options });
const SEMESTER = '2026-2027-HK1';
const SECOND = '2026-2027-HK2';
function fixture(t) {
  const store = openStore();
  t.after(() => store.close());
  return {
    store,
    lecturer: store.getUser('demo-lecturer'),
    student: store.getUser('demo-student'),
    student2: store.getUser('demo-student-2'),
  };
}
const rejects = (fn, status = 400) => assert.throws(fn, (error) => error.status === status);
const row = (overrides = {}) => ({
  sourceId: 'TEST-001',
  studentCode: '523h0080',
  activityId: '',
  title: 'Hoạt động kiểm thử',
  criterionId: 'academic_seminar',
  quantity: 1,
  date: '2026-10-23',
  semester: SEMESTER,
  ...overrides,
});
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'tdtu-rules-store-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function summary(store, student, semester = SEMESTER) {
  return store.dashboard(student, { semester }).student;
}
function profile(store, lecturer, studentId, payload = {}) {
  return store.saveAssessment(lecturer, studentId, { semester: SEMESTER, ...payload });
}

test('fresh seed implements all six PDF categories and the exact 40 + 10 to 50 scenario without counting twice', (t) => {
  const { store, lecturer, student } = fixture(t);
  const settings = store.getSettings();
  assert.equal(settings.ruleVersion, RULE_VERSION);
  assert.equal(settings.verified, true);
  assert.equal(settings.totalMax, 100);
  assert.equal(settings.categories.length, 6);
  assert.ok(settings.categories.every((cat) => cat.maxPoints === 20));
  assert.ok(settings.criteria.length > 90);
  assert.equal(store.students(lecturer).students.length, 30);
  const before = summary(store, student);
  assert.deepEqual(
    [before.officialTotal, before.pendingTotal, before.projectedTotal],
    [40, 10, 50],
  );
  assert.equal(before.evaluationStatus, 'evaluated');
  const imported = store.commitImport(lecturer, { rows: store.getScenarioRows() });
  assert.equal(imported.inserted, 1);
  assert.equal(imported.matched, 1);
  const after = summary(store, student);
  assert.deepEqual([after.officialTotal, after.pendingTotal, after.projectedTotal], [50, 0, 50]);
  assert.deepEqual(
    store.commitImport(lecturer, {
      rows: store.getScenarioRows().map((r) => ({ ...r, points: '10', quantity: '1' })),
      batchName: 'Khác tên tệp',
    }),
    { inserted: 0, skipped: 1, matched: 0, batchId: null },
  );
  assert.equal(
    store.claims(student).claims.find((claim) => claim.id === 'claim-scenario').status,
    'matched',
  );
});

test('all API methods enforce role and student scope using the stored role, including assessment and course', (t) => {
  const { store, lecturer, student, student2 } = fixture(t);
  const forged = { ...student, role: 'LECTURER', studentId: student2.studentId };
  for (const read of [
    () => store.students(null),
    () => store.activities(null),
    () => store.claims(null),
    () => store.dashboard(null),
    () => store.officialRecords(null),
  ])
    rejects(read, 401);
  for (const action of [
    () => store.reports(forged),
    () => store.audit(forged),
    () => store.reconciliation(forged),
    () => store.previewImport(forged, store.getScenarioRows()),
    () => store.commitImport(forged, { rows: store.getScenarioRows() }),
    () => store.updateSettings(forged, { riskThreshold: 40 }),
    () => store.createActivity(forged, {}),
    () => store.reviewClaim(forged, 'claim-scenario', { status: 'reviewed' }),
    () => store.matchClaim(forged, { claimId: 'claim-scenario', recordId: 'seed-record-1' }),
    () => store.legacyData(forged),
    () => store.reclassifyLegacy(forged, {}),
    () => store.saveAssessment(forged, student.studentId, {}),
  ])
    rejects(action, 403);
  rejects(() => store.getAssessment(student, student2.studentId), 403);
  rejects(
    () =>
      store.courseSummary(student, student2.studentId, { cohortYear: 2026, standardSemesters: 8 }),
    403,
  );
  assert.deepEqual(
    store.students(forged).students.map((s) => s.id),
    [student.studentId],
  );
  assert.ok(store.claims(forged).claims.every((c) => c.studentId === student.studentId));
  assert.ok(store.officialRecords(forged).records.every((r) => r.studentId === student.studentId));
  assert.deepEqual(store.dashboard(forged).recentActivity, []);
  assert.deepEqual(store.officialRecords(forged).batches, []);
  rejects(
    () =>
      store.createClaim(forged, { studentId: student2.studentId, criterionId: 'academic_seminar' }),
    403,
  );
  assert.equal(store.students(lecturer).students.length, 30);
});

test('criterion identity determines category and points; arbitrary points/categories and administrative student claims are rejected', (t) => {
  const { store, lecturer, student } = fixture(t);
  const { activity } = store.createActivity(lecturer, {
    title: 'Chuyên đề mới',
    organizer: 'Khoa CNTT',
    date: '2026-10-23',
    criterionId: 'academic_seminar',
    quantity: 2,
    mode: 'online',
  });
  assert.equal(activity.points, 10);
  assert.equal(activity.categoryId, 'academic');
  assert.equal(activity.ruleVersion, RULE_VERSION);
  const { claim } = store.createClaim(student, {
    activityId: activity.id,
    criterionId: activity.criterionId,
    quantity: 2,
    claimedPoints: 10,
  });
  assert.equal(claim.claimedPoints, 10);
  assert.equal(claim.legacy, false);
  rejects(() =>
    store.createClaim(student, {
      activityId: 'a4',
      criterionId: 'academic_seminar',
      claimedPoints: 5,
    }),
  );
  rejects(
    () =>
      store.createClaim(student, {
        title: 'Tự kê khai GPA',
        organizer: 'SV',
        date: '2026-10-23',
        criterionId: 'academic_gpa',
        quantity: 10,
      }),
    403,
  );
  rejects(
    () =>
      store.createClaim(student, {
        title: 'Tự miễn phạt',
        organizer: 'SV',
        date: '2026-10-23',
        criterionId: 'compliance_clean',
      }),
    403,
  );
  rejects(() =>
    store.createActivity(lecturer, {
      title: 'Sai',
      organizer: 'Khoa',
      date: '2026-10-23',
      criterionId: 'academic_seminar',
      points: 100,
    }),
  );
  assert.equal(store.previewImport(lecturer, [row({ points: 100 })]).summary.errors, 1);
  assert.equal(store.previewImport(lecturer, [row({ categoryId: 'bonus' })]).summary.errors, 1);
  assert.equal(store.previewImport(lecturer, [row({ criterionId: 'unknown' })]).summary.errors, 1);
  assert.equal(
    store.previewImport(lecturer, [row({ points: '', quantity: '', categoryId: '' })]).summary
      .valid,
    1,
  );
  rejects(() =>
    store.createClaim(student, {
      title: 'JS URL',
      organizer: 'Khoa',
      date: '2026-10-23',
      criterionId: 'academic_seminar',
      evidenceUrl: 'javascript:alert(1)',
    }),
  );
});

test('import is atomic for invalid rows, changed source payloads and duplicate singleton components', (t) => {
  const { store, lecturer, student } = fixture(t);
  const baseline = store.officialRecords(lecturer).records.length,
    batches = store.officialRecords(lecturer).batches.length;
  const rows = [...store.getScenarioRows(), row({ sourceId: 'bad', studentCode: 'UNKNOWN' })];
  rejects(() => store.commitImport(lecturer, { rows }));
  assert.equal(store.officialRecords(lecturer).records.length, baseline);
  assert.equal(store.officialRecords(lecturer).batches.length, batches);
  assert.equal(summary(store, student).pendingTotal, 10);
  const duplicate = row();
  const result = store.commitImport(lecturer, { rows: [duplicate, { ...duplicate }] });
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  rejects(() =>
    store.commitImport(lecturer, { rows: [row({ quantity: 2 }), row({ sourceId: 'another' })] }),
  );
  assert.equal(store.officialRecords(lecturer).records.length, baseline + 1);
  const gpa = row({ studentCode: 'DEMO029', criterionId: 'academic_gpa', quantity: 9 });
  rejects(() => store.commitImport(lecturer, { rows: [gpa, { ...gpa, sourceId: 'SECOND-GPA' }] }));
  assert.equal(
    store.previewImport(lecturer, [row({ criterionId: 'academic_gpa', quantity: 9 })]).summary
      .errors,
    1,
    'Profile GPA must not be imported twice',
  );
  for (const change of [
    { date: '2026-02-30' },
    { semester: '2015-2016-HK1' },
    { quantity: -1 },
    { points: 'NaN' },
  ])
    assert.equal(store.previewImport(lecturer, [row(change)]).summary.errors, 1);
});

test('review never becomes official; rejecting removes pending and matched claims cannot be reviewed again', (t) => {
  const { store, lecturer, student } = fixture(t);
  store.reviewClaim(lecturer, 'claim-scenario', { status: 'reviewed', note: 'Đã xem minh chứng' });
  assert.deepEqual(
    [summary(store, student).officialTotal, summary(store, student).pendingTotal],
    [40, 10],
  );
  store.reviewClaim(lecturer, 'claim-scenario', { status: 'rejected', note: 'Chưa đủ' });
  assert.equal(summary(store, student).pendingTotal, 0);
  const claim = store.createClaim(student, {
    activityId: 'a3',
    criterionId: 'community_blood_hair_donation',
  }).claim;
  store.commitImport(lecturer, { rows: store.getScenarioRows() });
  assert.equal(store.claims(student).claims.find((c) => c.id === claim.id).status, 'matched');
  rejects(() => store.reviewClaim(lecturer, claim.id, { status: 'rejected' }));
});

test('manual reconciliation requires matching criterion, student and semester; fuzzy titles only suggest', (t) => {
  const { store, lecturer, student } = fixture(t);
  store.commitImport(lecturer, {
    rows: [
      row({ title: 'Hiến máu tình nguyện tháng 10', criterionId: 'community_blood_hair_donation' }),
      row({ sourceId: 'wrong-criterion', criterionId: 'community_volunteer' }),
      row({
        sourceId: 'wrong-student',
        studentCode: 'DEMO002',
        criterionId: 'community_blood_hair_donation',
      }),
    ],
  });
  const view = store.reconciliation(lecturer),
    record = view.records.find((r) => r.sourceId === 'TEST-001');
  assert.ok(
    view.suggestions.some((s) => s.claimId === 'claim-scenario' && s.recordId === record.id),
  );
  assert.equal(summary(store, student).pendingTotal, 10);
  rejects(() =>
    store.matchClaim(lecturer, {
      claimId: 'claim-scenario',
      recordId: view.records.find((r) => r.sourceId === 'wrong-criterion').id,
    }),
  );
  rejects(() =>
    store.matchClaim(lecturer, {
      claimId: 'claim-scenario',
      recordId: view.records.find((r) => r.sourceId === 'wrong-student').id,
    }),
  );
  store.matchClaim(lecturer, { claimId: 'claim-scenario', recordId: record.id });
  assert.equal(summary(store, student).pendingTotal, 0);
  rejects(() => store.matchClaim(lecturer, { claimId: 'claim-scenario', recordId: record.id }));
});

test('ambiguous official activity rows do not silently match a claim', (t) => {
  const { store, lecturer, student } = fixture(t);
  const r = store.getScenarioRows()[0];
  const result = store.commitImport(lecturer, { rows: [r, { ...r, sourceId: 'SECOND-DECISION' }] });
  assert.equal(result.matched, 0);
  assert.equal(summary(store, student).pendingTotal, 10);
  assert.equal(
    store
      .reconciliation(lecturer)
      .suggestions.filter((s) => s.claimId === 'claim-scenario' && s.confidence === 'high').length,
    2,
  );
});

test('GPA, compliance and offline profile components are derived once and complete missing-data assessments', (t) => {
  const { store, lecturer } = fixture(t);
  const id = 's029';
  assert.equal(store.getAssessment(lecturer, id).student.evaluationStatus, 'no_data');
  let result = profile(store, lecturer, id, {
    gpa: 7.5,
    complianceConfirmed: true,
    offlineActivityCount: 11,
  }).student;
  assert.equal(result.evaluationStatus, 'evaluated');
  assert.equal(result.officialTotal, 37);
  assert.equal(result.categoryScores.find((c) => c.categoryId === 'academic').official, 7);
  assert.equal(result.categoryScores.find((c) => c.categoryId === 'pioneer').official, 10);
  result = profile(store, lecturer, id, { gpa: null }).student;
  assert.equal(result.evaluationStatus, 'incomplete');
  assert.ok(result.assessment.missing.includes('Điểm trung bình học kỳ'));
  for (const change of [
    { gpa: 11 },
    { offlineActivityCount: 7.5 },
    { offlineActivityCount: -1 },
    { complianceConfirmed: 'true' },
    { discipline: 'invalid' },
    { exceptionalPoints: 5 },
    { exceptionalPoints: 101, exceptionalApprovalReference: 'REF' },
  ])
    rejects(() => profile(store, lecturer, id, change));
});

test('official components and exclusive evaluations cannot be duplicated through imports, profile or claims', (t) => {
  const { store, lecturer } = fixture(t);
  const gpa = row({ studentCode: 'DEMO029', criterionId: 'academic_gpa', quantity: 9 });
  store.commitImport(lecturer, { rows: [gpa] });
  rejects(() => profile(store, lecturer, 's029', { gpa: 9 }));
  rejects(() => store.commitImport(lecturer, { rows: [{ ...gpa, sourceId: 'SECOND-GPA' }] }));
  assert.deepEqual(store.commitImport(lecturer, { rows: [gpa] }), {
    inserted: 0,
    skipped: 1,
    matched: 0,
    batchId: null,
  });
  const club = row({
    sourceId: 'club-excellent',
    studentCode: 'DEMO029',
    criterionId: 'academic_club_excellent',
  });
  store.commitImport(lecturer, { rows: [club] });
  rejects(() =>
    store.commitImport(lecturer, {
      rows: [{ ...club, sourceId: 'club-good', criterionId: 'academic_club_good' }],
    }),
  );
  assert.equal(
    store.previewImport(lecturer, [row({ criterionId: 'compliance_clean' })]).summary.errors,
    1,
  );
});

test('category caps and total cap apply without any zero floor or premature rounding', (t) => {
  const { store, lecturer } = fixture(t);
  const adjustment = (sourceId, categoryId, points, studentCode = 'DEMO029') =>
    row({
      sourceId,
      studentCode,
      criterionId: 'approved_adjustment',
      categoryId,
      points,
      approvalReference: 'BGH-2026/01',
    });
  const caps = CATEGORIES.map((cat, index) => adjustment(`CAP-${index}`, cat.id, 30));
  store.commitImport(lecturer, { rows: caps });
  let s = store.students(lecturer, { q: 'DEMO029' }).students[0];
  assert.equal(s.officialTotal, 100);
  assert.ok(s.categoryScores.every((c) => c.official === 20));
  assert.ok(
    store
      .officialRecords(lecturer)
      .records.filter((r) => r.studentCode === 'DEMO029')
      .every((r) => !r.legacy),
  );
  const fractional = [
    adjustment('FRAC-1', 'academic', 20, 'DEMO030'),
    adjustment('FRAC-2', 'compliance', 20, 'DEMO030'),
    adjustment('FRAC-3', 'movement', 20, 'DEMO030'),
    adjustment('FRAC-4', 'community', 4.999999, 'DEMO030'),
  ];
  store.commitImport(lecturer, { rows: fractional });
  s = store.students(lecturer, { q: 'DEMO030' }).students[0];
  assert.ok(s.officialTotal < 65);
  assert.equal(s.officialClassification, 'Trung bình');
  store.commitImport(lecturer, {
    rows: [
      row({
        sourceId: 'NEG-1',
        studentCode: 'DEMO028',
        criterionId: 'compliance_warning',
        quantity: 3,
      }),
    ],
  });
  s = store.students(lecturer, { q: 'DEMO028' }).students[0];
  assert.equal(s.officialTotal, -48);
  assert.equal(s.officialClassification, 'Kém');
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'compliance').official, -48);
});

test('disciplinary profile only controls status, ceiling and pioneer exclusion; deductions require official decisions', (t) => {
  const { store, lecturer, student } = fixture(t);
  let s = profile(store, lecturer, student.studentId, { offlineActivityCount: 15 }).student;
  assert.equal(s.officialTotal, 52);
  s = profile(store, lecturer, student.studentId, { discipline: 'reprimand' }).student;
  assert.equal(s.officialTotal, 40, 'No inferred -12 deduction');
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'pioneer').official, 0);
  store.commitImport(lecturer, {
    rows: [row({ sourceId: 'DISCIPLINE-DECISION-001', criterionId: 'compliance_reprimand' })],
  });
  s = summary(store, student);
  assert.equal(s.officialTotal, 28, 'The actual decision contributes -12 exactly once');
  assert.equal(
    store.commitImport(lecturer, {
      rows: [row({ sourceId: 'DISCIPLINE-DECISION-001', criterionId: 'compliance_reprimand' })],
    }).skipped,
    1,
  );
  const rows = CATEGORIES.map((cat, index) =>
    row({
      sourceId: `DISC-CAP-${index}`,
      studentCode: 'DEMO029',
      criterionId: 'approved_adjustment',
      categoryId: cat.id,
      points: 20,
      approvalReference: 'APPROVED',
    }),
  );
  store.commitImport(lecturer, { rows });
  let capped = profile(store, lecturer, 's029', { discipline: 'reprimand' }).student;
  assert.equal(capped.officialTotal, 100);
  assert.equal(capped.officialClassification, 'Khá');
  capped = profile(store, lecturer, 's029', { discipline: 'warning2' }).student;
  assert.equal(capped.officialClassification, 'Trung bình');
});

test('suspension and expulsion produce null totals and are excluded from averages and risk calculations', (t) => {
  const { store, lecturer, student } = fixture(t);
  profile(store, lecturer, student.studentId, { discipline: 'suspended' });
  const blocked = summary(store, student);
  assert.equal(blocked.officialTotal, null);
  assert.equal(blocked.projectedTotal, null);
  assert.equal(blocked.evaluationStatus, 'not_evaluated');
  assert.equal(blocked.officialClassification, 'Không đánh giá');
  assert.equal(store.dashboard(student).atRiskCount, 0);
  assert.equal(store.dashboard(student).officialAverage, null);
  const report = store.reports(lecturer);
  const eligible = report.students.filter(
    (s) =>
      s.hasOfficialData &&
      s.evaluationStatus !== 'not_evaluated' &&
      Number.isFinite(s.officialTotal),
  );
  assert.equal(report.stats.hasData, eligible.length);
  assert.equal(report.stats.notEvaluated, 1);
  assert.equal(
    report.stats.byClassification.reduce((sum, c) => sum + c.count, 0),
    eligible.length,
  );
  profile(store, lecturer, 's029', { discipline: 'expelled' });
  assert.equal(
    store.students(lecturer, { q: 'DEMO029' }).students[0].evaluationStatus,
    'not_evaluated',
  );
});

test('special semester modes enforce approval, final-semester and overseas duration conditions and use the 80-point scale', (t) => {
  const { store, lecturer, student } = fixture(t);
  const special = {
    mode: 'internship',
    placementGrade: 9,
    specialApproved: true,
    approvalReference: 'QD-123',
    finalSemester: true,
  };
  rejects(() =>
    profile(store, lecturer, student.studentId, { ...special, specialApproved: false }),
  );
  rejects(() => profile(store, lecturer, student.studentId, { ...special, approvalReference: '' }));
  rejects(() => profile(store, lecturer, student.studentId, { ...special, finalSemester: false }));
  rejects(() =>
    profile(store, lecturer, student.studentId, { ...special, mode: 'overseas', monthsAbroad: 1 }),
  );
  let s = profile(store, lecturer, student.studentId, special).student;
  assert.equal(s.officialTotal, 100);
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'academic').official, 80);
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'community').official, 0);
  assert.equal(s.evaluationStatus, 'evaluated');
  s = profile(store, lecturer, student.studentId, {
    ...special,
    placementGrade: 7.5,
    mode: 'overseas',
    monthsAbroad: 2,
  }).student;
  assert.equal(s.officialTotal, 80);
  assert.equal(
    store.officialRecords(student).records.length,
    1,
    'Participation stays in history although excluded by special mode',
  );
  rejects(() =>
    profile(store, lecturer, student.studentId, {
      exceptionalPoints: 5,
      exceptionalApprovalReference: 'BGH-APPROVAL-5',
    }),
  );
  store.commitImport(lecturer, {
    rows: [
      row({
        sourceId: 'SPECIAL-APPROVAL',
        criterionId: 'approved_adjustment',
        categoryId: 'bonus',
        points: 5,
        approvalReference: 'BGH-APPROVAL-5',
      }),
    ],
  });
  assert.equal(summary(store, student).officialTotal, 85);
});

test('semester isolation, annual arithmetic mean and whole-course missing-data rules remain authoritative', (t) => {
  const { store, lecturer, student } = fixture(t);
  const before = summary(store, student);
  assert.equal(summary(store, student, SECOND).evaluationStatus, 'no_data');
  const activity = store.createActivity(lecturer, {
    title: 'Hoạt động HK2',
    organizer: 'Khoa CNTT',
    date: '2027-03-01',
    criterionId: 'community_blood_hair_donation',
    mode: 'offline',
    semester: SECOND,
  }).activity;
  const claim = store.createClaim(student, {
    activityId: activity.id,
    criterionId: activity.criterionId,
    semester: SECOND,
  }).claim;
  assert.equal(store.claims(student, { semester: SECOND }).claims[0].id, claim.id);
  assert.equal(store.claims(student).claims.length, 1);
  store.saveAssessment(lecturer, student.studentId, {
    semester: SECOND,
    gpa: 9,
    complianceConfirmed: true,
    offlineActivityCount: 0,
  });
  const r = row({
    sourceId: 'HK2-OFFICIAL',
    activityId: activity.id,
    title: activity.title,
    criterionId: activity.criterionId,
    date: activity.date,
    semester: SECOND,
  });
  store.commitImport(lecturer, { rows: [r] });
  assert.equal(summary(store, student).officialTotal, before.officialTotal);
  assert.equal(summary(store, student, SECOND).officialTotal, 40);
  assert.equal(store.officialRecords(student, { semester: SECOND }).records.length, 1);
  const annual = store
    .reports(lecturer, { academicYear: '2026-2027' })
    .students.find((s) => s.id === student.studentId);
  assert.equal(annual.annualEvaluationStatus, 'evaluated');
  assert.equal(annual.annualTotal, 40);
  assert.equal(annual.annualClassification, 'Yếu');
  assert.equal(annual.annualResult.requiredSemesters, 2);
  const course = store.courseSummary(student, student.studentId, {
    cohortYear: '2026',
    standardSemesters: '8',
  }).result;
  assert.equal(course.evaluationStatus, 'incomplete');
  assert.equal(course.officialAverage, null);
  assert.equal(course.observedAverage, 40);
  assert.ok(course.missingSemesters.includes('2027-2028-HK1'));
  const two = store.courseSummary(student, student.studentId, {
    cohortYear: 2026,
    standardSemesters: 2,
  }).result;
  assert.equal(two.officialAverage, 40);
  assert.equal(two.additionalPointsRequired, 20);
  assert.equal(two.graduationEligible, false);
  rejects(() => store.courseSummary(student, student.studentId, {}));
  rejects(() => store.activities(student, { semester: '2015-2016-HK1' }));
});

test('settings lock PDF criteria and thresholds while risk threshold is configurable across reports and dashboard', (t) => {
  const { store, lecturer, student } = fixture(t);
  const current = store.getSettings();
  for (const change of [
    { totalMax: 120 },
    { categories: current.categories.slice(0, 3) },
    { categories: current.categories.map((c, i) => (i === 0 ? { ...c, maxPoints: 40 } : c)) },
    {
      classifications: [
        { label: 'Đạt', min: 50 },
        { label: 'Không đạt', min: 0 },
      ],
    },
    { versionName: '2015' },
    { riskThreshold: -1 },
    { riskThreshold: 101 },
  ])
    rejects(() => store.updateSettings(lecturer, change));
  const updated = store.updateSettings(lecturer, { riskThreshold: 40 }).settings;
  assert.equal(updated.ruleVersion, RULE_VERSION);
  assert.deepEqual(updated.categories, CATEGORIES);
  assert.deepEqual(updated.classifications, CLASSIFICATIONS);
  assert.equal(store.dashboard(student).atRiskCount, 0);
  const report = store.reports(lecturer, { classId: 'cls1' });
  assert.equal(
    report.stats.byClass[0].atRisk,
    report.students.filter(
      (s) => s.hasOfficialData && Number.isFinite(s.officialTotal) && s.officialTotal < 40,
    ).length,
  );
});

function makeLegacyDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
 CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE students(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,classId TEXT);
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL,studentId TEXT,provider TEXT NOT NULL,googleSub TEXT UNIQUE);
 CREATE TABLE activities(id TEXT PRIMARY KEY,title TEXT NOT NULL,organizer TEXT NOT NULL,date TEXT NOT NULL,categoryId TEXT NOT NULL,points REAL NOT NULL,mode TEXT NOT NULL,semester TEXT NOT NULL);
 CREATE TABLE batches(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL,rowCount INTEGER NOT NULL,actorName TEXT NOT NULL);
 CREATE TABLE records(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL,studentId TEXT NOT NULL,activityId TEXT,title TEXT NOT NULL,categoryId TEXT NOT NULL,points REAL NOT NULL,date TEXT NOT NULL,semester TEXT NOT NULL,batchId TEXT NOT NULL,canonical TEXT NOT NULL,UNIQUE(semester,sourceId));
 CREATE TABLE claims(id TEXT PRIMARY KEY,studentId TEXT NOT NULL,activityId TEXT,title TEXT NOT NULL,organizer TEXT NOT NULL,date TEXT NOT NULL,categoryId TEXT NOT NULL,claimedPoints REAL NOT NULL,evidenceUrl TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,reviewNote TEXT NOT NULL DEFAULT '',officialRecordId TEXT UNIQUE,createdAt TEXT NOT NULL,semester TEXT NOT NULL);
 PRAGMA user_version=1;
 `);
  db.prepare('INSERT INTO settings(id,value) VALUES(1,?)').run(
    JSON.stringify({
      versionName: 'Minh họa 2015',
      verified: false,
      totalMax: 100,
      riskThreshold: 45,
      categories: [
        { id: 'c1', name: 'Mục 1', maxPoints: 40 },
        { id: 'c2', name: 'Mục 2', maxPoints: 30 },
        { id: 'c3', name: 'Mục 3', maxPoints: 30 },
      ],
      classifications: [],
    }),
  );
  db.prepare('INSERT INTO classes(id,name) VALUES(?,?)').run('cls1', 'CNTT cũ');
  db.prepare('INSERT INTO students(id,code,name,email,classId) VALUES(?,?,?,?,?)').run(
    's001',
    '523h0080',
    'Nguyễn Minh An',
    '523h0080@student.tdtu.edu.vn',
    'cls1',
  );
  db.prepare(
    'INSERT INTO users(id,name,email,role,studentId,provider,googleSub) VALUES(?,?,?,?,?,?,?)',
  ).run(
    'demo-student',
    'Nguyễn Tên Google Thực Tế',
    '523h0080@student.tdtu.edu.vn',
    'STUDENT',
    's001',
    'google',
    'legacy-google-sub',
  );
  db.prepare(
    'INSERT INTO users(id,name,email,role,studentId,provider,googleSub) VALUES(?,?,?,?,?,?,?)',
  ).run(
    'demo-lecturer',
    'Cán bộ cũ',
    '523h0025@student.tdtu.edu.vn',
    'LECTURER',
    null,
    'demo',
    null,
  );
  db.prepare(
    'INSERT INTO activities(id,title,organizer,date,categoryId,points,mode,semester) VALUES(?,?,?,?,?,?,?,?)',
  ).run(
    'legacy-act',
    'Hội thảo thực tế đã nhập',
    'Khoa CNTT',
    '2026-10-01',
    'c1',
    7,
    'offline',
    SEMESTER,
  );
  db.prepare('INSERT INTO batches(id,name,createdAt,rowCount,actorName) VALUES(?,?,?,?,?)').run(
    'real-batch',
    'Tệp Excel người dùng đã nhập',
    '2026-10-01T00:00:00Z',
    1,
    'Cán bộ cũ',
  );
  const canonical = JSON.stringify({
    sourceId: 'REAL-EXCEL-ROW-991',
    studentCode: '523h0080',
    activityId: 'legacy-act',
    title: 'Hội thảo thực tế đã nhập',
    categoryId: 'c1',
    points: 7,
    date: '2026-10-01',
    semester: SEMESTER,
  });
  db.prepare(
    'INSERT INTO records(id,sourceId,studentId,activityId,title,categoryId,points,date,semester,batchId,canonical) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    'real-import-id',
    'REAL-EXCEL-ROW-991',
    's001',
    'legacy-act',
    'Hội thảo thực tế đã nhập',
    'c1',
    7,
    '2026-10-01',
    SEMESTER,
    'real-batch',
    canonical,
  );
  for (const [id, status, officialRecordId] of [
    ['legacy-matched', 'matched', 'real-import-id'],
    ['legacy-pending', 'pending', null],
  ])
    db.prepare(
      'INSERT INTO claims(id,studentId,activityId,title,organizer,date,categoryId,claimedPoints,evidenceUrl,note,status,reviewNote,officialRecordId,createdAt,semester) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      's001',
      'legacy-act',
      'Hội thảo thực tế đã nhập',
      'Khoa CNTT',
      '2026-10-01',
      'c1',
      7,
      '',
      'Dữ liệu đã có',
      status,
      '',
      officialRecordId,
      '2026-10-01T00:00:00Z',
      SEMESTER,
    );
  db.close();
  return canonical;
}

test('migration preserves real imported rows, source ids, links and Google names without inventing a category mapping', (t) => {
  const dbPath = join(directory(t), 'legacy.sqlite'),
    canonical = makeLegacyDatabase(dbPath);
  let store = openStore({ dbPath });
  try {
    const lecturer = store.getUser('demo-lecturer'),
      student = store.getUser('demo-student');
    const data = store.legacyData(lecturer);
    assert.equal(data.records.length, 1);
    assert.equal(data.activities.length, 1);
    assert.equal(data.claims.length, 2);
    const record = data.records[0];
    assert.equal(record.id, 'real-import-id');
    assert.equal(record.sourceId, 'REAL-EXCEL-ROW-991');
    assert.equal(record.points, 7);
    assert.equal(record.categoryId, 'c1');
    assert.equal(record.matchedClaimId, 'legacy-matched');
    assert.equal(record.studentName, student.name);
    assert.equal(record.legacy, true);
    const s = summary(store, student);
    assert.equal(s.name, 'Nguyễn Tên Google Thực Tế');
    assert.equal(s.code, '523h0080');
    assert.equal(s.legacyCount, 3);
    assert.equal(s.officialTotal, 0);
    assert.equal(s.hasOfficialData, false);
    assert.equal(s.pendingTotal, 0);
    assert.equal(s.pendingCount, 0);
    assert.ok(s.warnings.some((w) => w.includes('không cộng')));
    assert.equal(store.students(lecturer).students.length, 1);
    assert.equal(store.getSettings().riskThreshold, 45);
    assert.equal(store.reconciliation(lecturer).claims.length, 0);
    assert.equal(store.reconciliation(lecturer).records.length, 0);
    rejects(() =>
      store.matchClaim(lecturer, { claimId: 'legacy-pending', recordId: 'real-import-id' }),
    );
    store.close();
    const raw = new DatabaseSync(dbPath);
    assert.equal(
      raw.prepare('SELECT canonical FROM records WHERE id=?').get('real-import-id').canonical,
      canonical,
    );
    assert.ok(
      raw
        .prepare('PRAGMA table_info(records)')
        .all()
        .some((c) => c.name === 'criterionId'),
    );
    raw.close();
    store = openStore({ dbPath });
    assert.equal(store.legacyData(lecturer).records[0].points, 7);
    assert.equal(summary(store, student).name, student.name);
    assert.equal(
      store.audit(lecturer).entries.filter((a) => a.action === 'Nâng cấp quy chế').length,
      1,
      'Migration is idempotent',
    );
  } finally {
    store.close();
  }
});

test('explicit legacy reclassification validates points, preserves identity and matched links, and recanonicalizes for idempotent imports', (t) => {
  const dbPath = join(directory(t), 'reclassify.sqlite');
  makeLegacyDatabase(dbPath);
  const store = openStore({ dbPath });
  try {
    const lecturer = store.getUser('demo-lecturer'),
      student = store.getUser('demo-student');
    rejects(() =>
      store.reclassifyLegacy(lecturer, {
        type: 'record',
        id: 'real-import-id',
        criterionId: 'academic_seminar',
        quantity: 1,
        points: 7,
      }),
    );
    assert.equal(store.legacyData(lecturer).records[0].points, 7);
    const classified = store.reclassifyLegacy(lecturer, {
      type: 'record',
      id: 'real-import-id',
      criterionId: 'academic_seminar',
      quantity: 1,
      points: 5,
    });
    assert.equal(classified.row.id, 'real-import-id');
    assert.equal(classified.row.sourceId, 'REAL-EXCEL-ROW-991');
    assert.equal(classified.row.matchedClaimId, 'legacy-matched');
    assert.equal(classified.row.legacy, false);
    assert.equal(classified.row.points, 5);
    const r = row({
      sourceId: 'REAL-EXCEL-ROW-991',
      activityId: 'legacy-act',
      title: 'Hội thảo thực tế đã nhập',
      categoryId: 'academic',
      points: 5,
      date: '2026-10-01',
    });
    assert.deepEqual(store.commitImport(lecturer, { rows: [r] }), {
      inserted: 0,
      skipped: 1,
      matched: 0,
      batchId: null,
    });
    store.reclassifyLegacy(lecturer, {
      type: 'claim',
      id: 'legacy-matched',
      criterionId: 'academic_seminar',
      quantity: 1,
    });
    assert.equal(
      store.claims(student).claims.find((c) => c.id === 'legacy-matched').officialRecordId,
      'real-import-id',
    );
    assert.equal(summary(store, student).pendingTotal, 0);
    rejects(() =>
      store.reclassifyLegacy(lecturer, {
        type: 'record',
        id: 'real-import-id',
        criterionId: 'academic_seminar',
      }),
    );
    store.reclassifyLegacy(lecturer, {
      type: 'activity',
      id: 'legacy-act',
      criterionId: 'academic_seminar',
      quantity: 1,
    });
    assert.equal(store.activities(student).activities[0].legacy, false);
    assert.equal(store.legacyData(lecturer).claims.length, 1);
    assert.equal(store.legacyData(lecturer).records.length, 0);
    assert.equal(summary(store, student).officialTotal, 5);
    assert.equal(
      store.audit(lecturer).entries.filter((a) => a.action === 'Đối chiếu dữ liệu cũ').length,
      3,
    );
  } finally {
    store.close();
  }
});

test('Google names synchronize across login, dashboard, roster, claims, records and reopen while preserving score identity', (t) => {
  const dbPath = join(directory(t), 'names.sqlite');
  let store = openStore({ dbPath });
  try {
    const student = store.getUser('demo-student'),
      lecturer = store.getUser('demo-lecturer'),
      before = summary(store, student),
      claims = store.claims(student).claims.map((c) => c.id),
      records = store.officialRecords(student).records.map((r) => r.id);
    let linked = store.ensureGoogleUser({
      sub: 'actual-sub',
      email: student.email,
      name: 'Tên Google Đúng',
      role: 'STUDENT',
    });
    assert.equal(linked.studentId, before.id);
    for (const name of ['Tên Google Đúng', 'Tên Google Mới']) {
      linked = store.ensureGoogleUser({
        sub: 'actual-sub',
        email: student.email,
        name,
        role: 'STUDENT',
      });
      assert.equal(summary(store, linked).name, name);
      assert.equal(
        store.students(lecturer).students.find((s) => s.id === linked.studentId).name,
        name,
      );
      assert.ok(store.claims(linked).claims.every((c) => c.studentName === name));
      assert.ok(store.officialRecords(linked).records.every((r) => r.studentName === name));
      assert.equal(
        store.reports(lecturer).students.find((s) => s.id === linked.studentId).name,
        name,
      );
      assert.equal(summary(store, linked).code, before.code);
      assert.deepEqual(
        [summary(store, linked).officialTotal, summary(store, linked).pendingTotal],
        [40, 10],
      );
    }
    assert.deepEqual(
      store.claims(linked).claims.map((c) => c.id),
      claims,
    );
    assert.deepEqual(
      store.officialRecords(linked).records.map((r) => r.id),
      records,
    );
    rejects(
      () =>
        store.ensureGoogleUser({
          sub: 'forged-sub',
          email: student.email,
          name: 'Tên không được phép',
          role: 'STUDENT',
        }),
      403,
    );
    rejects(
      () =>
        store.ensureGoogleUser({
          sub: 'external',
          email: 'someone@gmail.com',
          name: 'External',
          role: 'STUDENT',
        }),
      403,
    );
    rejects(() => store.reports(linked), 403);
    const faculty = store.ensureGoogleUser({
      sub: 'faculty-sub',
      email: '523h0025@student.tdtu.edu.vn',
      name: 'Giảng viên Google',
      role: 'LECTURER',
    });
    assert.equal(faculty.id, 'demo-lecturer');
    assert.equal(
      store.students(faculty).students.length,
      0,
      'Google-linked lecturer has no class assignment by default',
    );
    store.close();
    const raw = new DatabaseSync(dbPath);
    raw.prepare('UPDATE students SET name=? WHERE id=?').run('Tên cũ cần sửa', linked.studentId);
    raw.close();
    store = openStore({ dbPath });
    assert.equal(summary(store, linked).name, 'Tên Google Mới');
    assert.equal(summary(store, linked).officialTotal, 40);
  } finally {
    store.close();
  }
});

test('new Google students keep an empty identity and enter the semester roster only through explicit enrollment', (t) => {
  const { store, lecturer } = fixture(t);
  const student = store.ensureGoogleUser({
    sub: 'new-sub',
    email: 'new.student@student.tdtu.edu.vn',
    name: 'Sinh viên mới',
    role: 'STUDENT',
  });
  const s = summary(store, student);
  assert.equal(s.evaluationStatus, 'no_data');
  assert.equal(s.hasOfficialData, false);
  assert.equal(s.officialClassification, null);
  assert.equal(s.classId, 'unassigned');
  assert.equal(store.students(student).students.length, 1);
  const report = store.reports(lecturer);
  assert.equal(
    report.stats.byClass.reduce((sum, c) => sum + c.total, 0),
    30,
  );
  assert.equal(store.reports(lecturer, { classId: 'unassigned' }).stats.total, 0);
  assert.deepEqual(store.dashboard(student).classes, []);
  store.commitRoster(lecturer, {
    rows: [
      {
        sourceId: 'NEW-GOOGLE-ENROLLMENT',
        studentCode: s.code,
        name: s.name,
        email: student.email,
        classId: 'cls1',
        className: store
          .roster(lecturer, { semester: SEMESTER })
          .classes.find((item) => item.id === 'cls1').name,
        semester: SEMESTER,
      },
    ],
    reason: 'Ghi danh sinh viên theo danh sách đã đối chiếu',
  });
  assert.equal(store.students(lecturer).students.length, 31);
  assert.equal(summary(store, student).hasOfficialData, false);
  assert.equal(summary(store, student).officialClassification, null);
});

test('Google role changes preserve the existing student identity, scores and claims in both directions', (t) => {
  const { store, student, lecturer } = fixture(t);
  const before = summary(store, student);
  const claims = store.claims(student).claims.map((claim) => claim.id);
  const records = store.officialRecords(student).records.map((record) => record.id);
  for (const role of ['STUDENT', 'LECTURER', 'STUDENT', 'LECTURER', 'STUDENT']) {
    const user = store.ensureGoogleUser({
      sub: 'role-changing-student',
      email: student.email,
      name: 'Sinh viên đổi vai trò',
      role,
      authAudience: 'external',
    });
    assert.equal(user.id, student.id);
    assert.equal(user.studentId, student.studentId);
    assert.equal(user.role, role);
    const ownProfile = store.students(lecturer).students.find((item) => item.id === user.studentId);
    assert.equal(ownProfile.code, before.code);
    assert.deepEqual(
      [ownProfile.officialTotal, ownProfile.pendingTotal, ownProfile.projectedTotal],
      [before.officialTotal, before.pendingTotal, before.projectedTotal],
    );
    if (role === 'STUDENT') {
      rejects(() => store.reports(user), 403);
      assert.deepEqual(
        store.claims(user).claims.map((claim) => claim.id),
        claims,
      );
      assert.deepEqual(
        store.officialRecords(user).records.map((record) => record.id),
        records,
      );
    } else {
      assert.equal(
        store.reports(user).stats.total,
        0,
        'Promotion preserves identity without inventing class assignments',
      );
    }
  }
});

test('external lecturer downgraded to student gets one empty profile and keeps it through later role changes', (t) => {
  const { store, lecturer } = fixture(t);
  const identity = {
    sub: 'external-role-changing-sub',
    email: '  Personal.Teacher@GMAIL.COM  ',
    name: 'Tài khoản cá nhân',
    authAudience: ' EXTERNAL ',
  };
  const first = store.ensureGoogleUser({ ...identity, role: 'LECTURER' });
  assert.equal(first.email, 'personal.teacher@gmail.com');
  assert.equal(first.studentId, null);
  let studentId;
  for (const role of ['STUDENT', 'LECTURER', 'STUDENT']) {
    const user = store.ensureGoogleUser({ ...identity, role });
    assert.equal(user.id, first.id);
    assert.equal(user.role, role);
    studentId ??= user.studentId;
    assert.ok(studentId);
    assert.equal(user.studentId, studentId);
    if (
      role === 'STUDENT' &&
      !store.students(lecturer).students.some((item) => item.id === studentId)
    ) {
      const emptyProfile = summary(store, user);
      store.commitRoster(lecturer, {
        rows: [
          {
            sourceId: 'ROLE-CHANGE-ENROLLMENT',
            studentCode: emptyProfile.code,
            name: user.name,
            email: user.email,
            classId: 'cls1',
            className: store
              .roster(lecturer, { semester: SEMESTER })
              .classes.find((item) => item.id === 'cls1').name,
            semester: SEMESTER,
          },
        ],
        reason: 'Ghi danh hồ sơ riêng mà không đổi định danh khi đổi vai trò',
      });
    }
    const profile = store.students(lecturer).students.find((item) => item.id === studentId);
    assert.equal(profile.evaluationStatus, 'no_data');
    assert.equal(profile.hasOfficialData, false);
    assert.equal(profile.officialClassification, null);
    assert.equal(profile.pendingTotal, 0);
    if (role === 'STUDENT') {
      assert.deepEqual(store.claims(user).claims, []);
      assert.deepEqual(store.officialRecords(user).records, []);
      rejects(() => store.reports(user), 403);
    }
  }
  assert.equal(store.students(lecturer).students.length, 31);
});

test('external Google students use distinct empty profiles and retain identity collision protections', (t) => {
  const { store, lecturer } = fixture(t);
  const first = store.ensureGoogleUser({
    sub: 'external-student-one',
    email: 'new.person@gmail.com',
    name: 'Sinh viên ngoài miền trường',
    authAudience: 'external',
  });
  const second = store.ensureGoogleUser({
    sub: 'external-student-two',
    email: 'new.person@another.edu.vn',
    name: 'Sinh viên cùng phần tên email',
    authAudience: 'external',
  });
  assert.notEqual(first.studentId, second.studentId);
  assert.notEqual(summary(store, first).code, summary(store, second).code);
  for (const user of [first, second]) {
    assert.equal(user.role, 'STUDENT');
    assert.equal(summary(store, user).evaluationStatus, 'no_data');
    assert.equal(summary(store, user).hasOfficialData, false);
    assert.deepEqual(store.claims(user).claims, []);
    assert.deepEqual(store.officialRecords(user).records, []);
    assert.deepEqual(
      store.students(user).students.map((item) => item.id),
      [user.studentId],
    );
    rejects(() => store.reports(user), 403);
  }
  for (const identity of [
    { sub: 'external-student-one', email: second.email },
    { sub: 'new-attacker-sub', email: first.email },
  ]) {
    rejects(() => store.ensureGoogleUser({ ...identity, authAudience: 'external' }), 403);
  }
  rejects(() => store.ensureGoogleUser({ sub: 'outside', email: first.email }), 403);
  rejects(() =>
    store.ensureGoogleUser({ sub: 'bad-email', email: 'bad@@gmail.com', authAudience: 'external' }),
  );
  rejects(() =>
    store.ensureGoogleUser({ sub: 'bad-mode', email: first.email, authAudience: 'invalid' }),
  );
  assert.equal(
    store.students(lecturer).students.length,
    30,
    'Unenrolled Google profiles do not silently enter the term roster',
  );
});

test('one event may have separate participation and award criteria, with independent idempotency and exact matching', (t) => {
  const { store, lecturer, student } = fixture(t);
  const activity = store.createActivity(lecturer, {
    title: 'Cuộc thi học thuật có giải',
    organizer: 'Khoa CNTT',
    date: '2026-10-23',
    criterionId: 'academic_competition_local',
    mode: 'offline',
  }).activity;
  store.createClaim(student, {
    activityId: activity.id,
    criterionId: 'academic_competition_local',
  });
  store.createClaim(student, {
    activityId: activity.id,
    criterionId: 'bonus_academic_faculty_first',
  });
  const participation = row({
      sourceId: 'EVENT-PARTICIPATION',
      activityId: activity.id,
      criterionId: 'academic_competition_local',
    }),
    award = row({
      sourceId: 'EVENT-AWARD',
      activityId: activity.id,
      criterionId: 'bonus_academic_faculty_first',
    });
  const imported = store.commitImport(lecturer, { rows: [participation, award] });
  assert.equal(imported.inserted, 2);
  assert.equal(imported.matched, 2);
  const s = summary(store, student);
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'academic').official, 20);
  assert.equal(s.categoryScores.find((c) => c.categoryId === 'bonus').official, 7);
  assert.equal(s.pendingTotal, 10, 'The original unrelated blood-donation claim remains pending');
  assert.deepEqual(store.commitImport(lecturer, { rows: [award, participation] }), {
    inserted: 0,
    skipped: 2,
    matched: 0,
    batchId: null,
  });
  rejects(() =>
    store.commitImport(lecturer, {
      rows: [{ ...participation, criterionId: 'bonus_academic_faculty_first' }],
    }),
  );
  rejects(() =>
    store.createClaim(student, { activityId: activity.id, criterionId: 'community_volunteer' }),
  );
});

test('excluded pioneer does not require an offline count or falsely block annual and whole-course completion', (t) => {
  const { store, lecturer } = fixture(t);
  const studentId = 's029';
  let s = profile(store, lecturer, studentId, {
    gpa: 9,
    complianceConfirmed: true,
    offlineActivityCount: null,
    discipline: 'reprimand',
  }).student;
  assert.equal(s.evaluationStatus, 'evaluated');
  assert.equal(s.assessment.complete, true);
  assert.ok(!s.assessment.missing.includes('Số hoạt động trực tiếp'));
  assert.equal(s.officialTotal, 30);
  store.saveAssessment(lecturer, studentId, {
    semester: SECOND,
    gpa: 9,
    complianceConfirmed: true,
    offlineActivityCount: null,
    discipline: 'warning',
  });
  const annual = store
    .reports(lecturer, { academicYear: '2026-2027' })
    .students.find((s) => s.id === studentId);
  assert.equal(annual.annualEvaluationStatus, 'evaluated');
  assert.equal(annual.annualTotal, 30);
  const course = store.courseSummary(lecturer, studentId, {
    cohortYear: 2026,
    standardSemesters: 2,
  }).result;
  assert.equal(course.evaluationStatus, 'evaluated');
  assert.equal(course.officialAverage, 30);
  s = profile(store, lecturer, studentId, { discipline: 'none' }).student;
  assert.equal(s.evaluationStatus, 'incomplete');
  assert.ok(s.assessment.missing.includes('Số hoạt động trực tiếp'));
});

test('all four restricted faculties enforce final-semester conditions with accented and unaccented Vietnamese names', (t) => {
  const { store, lecturer } = fixture(t);
  const special = {
    mode: 'internship',
    specialApproved: true,
    approvalReference: 'QD-FINAL',
    placementGrade: 9,
    finalSemester: false,
  };
  for (const faculty of [
    'Điện - Điện tử',
    'Dien - Dien tu',
    'ĐIỆN - ĐIỆN TỬ',
    'Công nghệ thông tin',
    'Cong nghe thong tin',
    'CNTT',
    'Khoa học ứng dụng',
    'Khoa hoc ung dung',
    'Dược',
    'Duoc',
  ]) {
    rejects(() => profile(store, lecturer, 's029', { ...special, faculty }));
    const accepted = profile(store, lecturer, 's029', {
      ...special,
      faculty,
      finalSemester: true,
    }).student;
    assert.equal(accepted.assessment.finalSemester, true);
  }
});

test('priority points must use an approved explicit category and legacy profile adjustments never become a seventh bucket', (t) => {
  const dbPath = join(directory(t), 'legacy-priority.sqlite');
  let store = openStore({ dbPath });
  try {
    let lecturer = store.getUser('demo-lecturer');
    profile(store, lecturer, 's029', {
      gpa: 0,
      complianceConfirmed: true,
      offlineActivityCount: 0,
    });
    rejects(() =>
      profile(store, lecturer, 's029', {
        exceptionalPoints: 80,
        exceptionalApprovalReference: 'BGH-80',
      }),
    );
    store.close();
    const db = new DatabaseSync(dbPath);
    const old = JSON.parse(
      db
        .prepare('SELECT payload FROM assessments WHERE studentId=? AND semester=?')
        .get('s029', SEMESTER).payload,
    );
    db.prepare('UPDATE assessments SET payload=? WHERE studentId=? AND semester=?').run(
      JSON.stringify({
        ...old,
        exceptionalPoints: 80,
        exceptionalApprovalReference: 'BGH-LEGACY-80',
      }),
      's029',
      SEMESTER,
    );
    db.close();
    store = openStore({ dbPath });
    lecturer = store.getUser('demo-lecturer');
    let s = store.students(lecturer, { q: 'DEMO029' }).students[0];
    assert.equal(s.officialTotal, 20);
    assert.equal(s.projectedTotal, 20);
    assert.ok(
      s.warnings.some((w) => w.includes('không được cộng') && w.includes('approved_adjustment')),
    );
    store.commitImport(lecturer, {
      rows: [
        row({
          sourceId: 'PRIORITY-COMPLIANCE',
          studentCode: 'DEMO029',
          criterionId: 'approved_adjustment',
          categoryId: 'compliance',
          points: 80,
          approvalReference: 'BGH-80',
        }),
      ],
    });
    s = store.students(lecturer, { q: 'DEMO029' }).students[0];
    assert.equal(s.categoryScores.find((c) => c.categoryId === 'compliance').official, 20);
    assert.equal(s.officialTotal, 20, 'The approved ledger entry stays inside its category cap');
    store.commitImport(lecturer, {
      rows: [
        row({
          sourceId: 'PRIORITY-ACADEMIC',
          studentCode: 'DEMO029',
          criterionId: 'approved_adjustment',
          categoryId: 'academic',
          points: 80,
          approvalReference: 'BGH-80-ACADEMIC',
        }),
      ],
    });
    assert.equal(store.students(lecturer, { q: 'DEMO029' }).students[0].officialTotal, 40);
  } finally {
    store.close();
  }
});

test('legacy reclassification rejects inherited object keys as ordinary validation errors', (t) => {
  const { store, lecturer } = fixture(t);
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    rejects(() =>
      store.reclassifyLegacy(lecturer, { type, id: 'any', criterionId: 'academic_seminar' }),
    );
});

test('active legacy claims cannot duplicate confirmed profile components or semester evaluations', (t) => {
  for (const entry of [
    { criterionId: 'academic_gpa', quantity: 9, points: 10 },
    { criterionId: 'compliance_clean', quantity: 1, points: 20 },
    { criterionId: 'pioneer_offline_participation', quantity: 15, points: 12 },
  ]) {
    const dbPath = join(directory(t), `${entry.criterionId}.sqlite`);
    makeLegacyDatabase(dbPath);
    const store = openStore({ dbPath });
    try {
      const lecturer = store.getUser('demo-lecturer'),
        student = store.getUser('demo-student');
      profile(store, lecturer, student.studentId, {
        gpa: 9,
        complianceConfirmed: true,
        offlineActivityCount: 15,
      });
      const before = summary(store, student),
        auditCount = store.audit(lecturer).entries.length;
      rejects(() =>
        store.reclassifyLegacy(lecturer, { type: 'claim', id: 'legacy-pending', ...entry }),
      );
      assert.equal(summary(store, student).projectedTotal, before.projectedTotal);
      assert.equal(
        store.legacyData(lecturer).claims.find((c) => c.id === 'legacy-pending').claimedPoints,
        7,
      );
      assert.equal(store.audit(lecturer).entries.length, auditCount);
    } finally {
      store.close();
    }
  }
  for (const existing of ['official', 'pending']) {
    const dbPath = join(directory(t), `${existing}-evaluation.sqlite`);
    makeLegacyDatabase(dbPath);
    const store = openStore({ dbPath });
    try {
      const lecturer = store.getUser('demo-lecturer');
      if (existing === 'official')
        store.commitImport(lecturer, { rows: [row({ criterionId: 'academic_club_good' })] });
      else
        store.createClaim(lecturer, {
          studentId: 's001',
          title: 'Đánh giá CLB',
          organizer: 'Khoa',
          date: '2026-10-23',
          criterionId: 'academic_club_good',
        });
      rejects(() =>
        store.reclassifyLegacy(lecturer, {
          type: 'claim',
          id: 'legacy-pending',
          criterionId: 'academic_club_excellent',
          quantity: 1,
          points: 20,
        }),
      );
      assert.ok(store.legacyData(lecturer).claims.some((c) => c.id === 'legacy-pending'));
    } finally {
      store.close();
    }
  }
});

test('active legacy claims use the same activity duplicate checks as newly created claims', (t) => {
  const dbPath = join(directory(t), 'legacy-activity-duplicate.sqlite');
  makeLegacyDatabase(dbPath);
  const store = openStore({ dbPath });
  try {
    const lecturer = store.getUser('demo-lecturer');
    store.reclassifyLegacy(lecturer, {
      type: 'activity',
      id: 'legacy-act',
      criterionId: 'academic_seminar',
      quantity: 1,
      points: 5,
    });
    store.createClaim(lecturer, {
      studentId: 's001',
      activityId: 'legacy-act',
      criterionId: 'academic_seminar',
    });
    rejects(() =>
      store.reclassifyLegacy(lecturer, {
        type: 'claim',
        id: 'legacy-pending',
        criterionId: 'academic_seminar',
        quantity: 1,
        points: 5,
      }),
    );
    assert.ok(store.legacyData(lecturer).claims.some((c) => c.id === 'legacy-pending'));
  } finally {
    store.close();
  }
});

test('reclassifying either side of a matched legacy pair preserves category and criterion while permitting confirmed point differences', (t) => {
  for (const first of ['record', 'claim']) {
    const dbPath = join(directory(t), `${first}-matched-category.sqlite`);
    makeLegacyDatabase(dbPath);
    const store = openStore({ dbPath });
    try {
      const lecturer = store.getUser('demo-lecturer');
      const second = first === 'record' ? 'claim' : 'record';
      const ids = { record: 'real-import-id', claim: 'legacy-matched' };
      const approved = {
        criterionId: 'approved_adjustment',
        categoryId: 'academic',
        quantity: 1,
        points: 5,
        approvalReference: 'BGH-QD-001',
      };
      store.reclassifyLegacy(lecturer, { type: first, id: ids[first], ...approved });
      rejects(() =>
        store.reclassifyLegacy(lecturer, {
          type: second,
          id: ids[second],
          ...approved,
          categoryId: 'community',
        }),
      );
      assert.equal(
        store.claims(lecturer).claims.find((c) => c.id === ids.claim).officialRecordId,
        ids.record,
      );
      store.reclassifyLegacy(lecturer, { type: second, id: ids[second], ...approved, points: 7 });
      const claim = store.claims(lecturer).claims.find((c) => c.id === ids.claim);
      const record = store.officialRecords(lecturer).records.find((r) => r.id === ids.record);
      assert.equal(claim.status, 'matched');
      assert.equal(claim.categoryId, record.categoryId);
      assert.equal(claim.criterionId, record.criterionId);
      assert.notEqual(claim.claimedPoints, record.points);
    } finally {
      store.close();
    }
  }
});

test('reviewing a previously rejected current claim revalidates duplicates before reactivating projected points', (t) => {
  const dbPath = join(directory(t), 'reactivate-rejected.sqlite');
  makeLegacyDatabase(dbPath);
  const store = openStore({ dbPath });
  try {
    const lecturer = store.getUser('demo-lecturer'),
      student = store.getUser('demo-student');
    store.reviewClaim(lecturer, 'legacy-pending', {
      status: 'rejected',
      note: 'Chưa đủ minh chứng',
    });
    profile(store, lecturer, student.studentId, {
      gpa: 9,
      complianceConfirmed: true,
      offlineActivityCount: 0,
    });
    store.reclassifyLegacy(lecturer, {
      type: 'claim',
      id: 'legacy-pending',
      criterionId: 'academic_gpa',
      quantity: 9,
      points: 10,
    });
    const before = summary(store, student),
      auditCount = store.audit(lecturer).entries.length;
    rejects(() =>
      store.reviewClaim(lecturer, 'legacy-pending', {
        status: 'reviewed',
        note: 'Bổ sung minh chứng',
      }),
    );
    assert.equal(
      store.claims(lecturer).claims.find((c) => c.id === 'legacy-pending').status,
      'rejected',
    );
    assert.equal(summary(store, student).projectedTotal, before.projectedTotal);
    assert.equal(store.audit(lecturer).entries.length, auditCount);
    profile(store, lecturer, student.studentId, { gpa: null });
    store.reviewClaim(lecturer, 'legacy-pending', {
      status: 'reviewed',
      note: 'Đã xử lý nguồn trùng',
    });
    assert.equal(
      store.claims(lecturer).claims.find((c) => c.id === 'legacy-pending').status,
      'reviewed',
    );
    assert.equal(summary(store, student).pendingTotal, 10);
  } finally {
    store.close();
  }
});

test('profile confirmation after pending component claims excludes duplicate projections without changing claims or evidence', (t) => {
  const { store, lecturer } = fixture(t);
  const studentId = 's029';
  profile(store, lecturer, studentId, {
    gpa: null,
    complianceConfirmed: false,
    offlineActivityCount: null,
  });
  const claims = [
    { criterionId: 'academic_gpa', quantity: 9 },
    { criterionId: 'compliance_clean', quantity: 1 },
    { criterionId: 'pioneer_offline_participation', quantity: 15 },
  ].map(
    (entry) =>
      store.createClaim(lecturer, {
        studentId,
        title: entry.criterionId,
        organizer: 'Khoa',
        date: '2026-10-23',
        evidenceUrl: 'https://example.com/evidence',
        ...entry,
      }).claim,
  );
  const current = () => store.students(lecturer, { q: 'DEMO029' }).students[0];
  assert.equal(current().pendingTotal, 42);
  profile(store, lecturer, studentId, {
    gpa: 9,
    complianceConfirmed: true,
    offlineActivityCount: 15,
  });
  const confirmed = current();
  assert.deepEqual(
    [confirmed.officialTotal, confirmed.pendingTotal, confirmed.projectedTotal],
    [42, 0, 42],
  );
  assert.equal(confirmed.pendingCount, 3);
  assert.equal(confirmed.excludedPendingCount, 3);
  assert.ok(confirmed.warnings.some((warning) => warning.includes('3 kê khai chờ')));
  for (const original of claims) {
    const saved = store.claims(lecturer).claims.find((claim) => claim.id === original.id);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.officialRecordId, null);
    assert.equal(saved.evidenceUrl, original.evidenceUrl);
    assert.equal(saved.projectionExcluded, true);
    assert.match(saved.projectionExclusionReason, /hồ sơ học kỳ/);
  }
  profile(store, lecturer, studentId, {
    gpa: null,
    complianceConfirmed: false,
    offlineActivityCount: null,
  });
  assert.equal(current().pendingTotal, 42);
  assert.equal(current().excludedPendingCount, 0);
  assert.ok(
    store
      .claims(lecturer)
      .claims.filter((claim) => claim.studentId === studentId)
      .every((claim) => !claim.projectionExcluded),
  );
});

test('official semester evaluation arriving after an unlinked claim shadows the same or another level in its exclusive group', (t) => {
  for (const criterionId of ['academic_club_good', 'academic_club_excellent']) {
    const { store, lecturer } = fixture(t);
    profile(store, lecturer, 's029', {
      gpa: 0,
      complianceConfirmed: true,
      offlineActivityCount: 0,
    });
    const { claim } = store.createClaim(lecturer, {
      studentId: 's029',
      title: 'Đánh giá CLB đang chờ',
      organizer: 'CLB',
      date: '2026-10-23',
      criterionId,
    });
    store.reviewClaim(lecturer, claim.id, { status: 'reviewed', note: 'Đã xem minh chứng' });
    const imported = store.commitImport(lecturer, {
      rows: [
        row({
          sourceId: 'OFFICIAL-CLUB-RESULT',
          studentCode: 'DEMO029',
          criterionId: 'academic_club_good',
        }),
      ],
    });
    assert.deepEqual([imported.inserted, imported.matched], [1, 0]);
    const s = store.students(lecturer, { q: 'DEMO029' }).students[0];
    assert.deepEqual([s.officialTotal, s.pendingTotal, s.projectedTotal], [35, 0, 35]);
    assert.equal(s.pendingCount, 1);
    assert.equal(s.excludedPendingCount, 1);
    const saved = store.claims(lecturer).claims.find((c) => c.id === claim.id);
    assert.equal(saved.status, 'reviewed');
    assert.equal(saved.officialRecordId, null);
    assert.equal(saved.projectionExcluded, true);
    assert.match(saved.projectionExclusionReason, /kết quả chính thức/);
  }
});
