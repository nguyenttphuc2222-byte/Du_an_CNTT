import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { installWorkflowSchema, createWorkflows } from './workflows.mjs';
import {
  RULE_VERSION,
  RULE_SOURCE,
  CATEGORIES,
  CLASSIFICATIONS,
  CRITERIA,
  normalizeEntry,
  academicPoints,
  placementPoints,
  offlinePoints,
  classifyScore,
  disciplineForEntries,
  annualResult,
  courseResult,
} from './regulations.mjs';
const SEMESTER = '2026-2027-HK1';
const SEMESTERS = [SEMESTER, '2026-2027-HK2'];
const ACTIVE = new Set(['pending', 'reviewed']);
const DEFAULT_SETTINGS = {
  semester: SEMESTER,
  semesters: SEMESTERS,
  versionName: RULE_VERSION,
  ruleVersion: RULE_VERSION,
  verified: true,
  source: RULE_SOURCE,
  totalMax: 100,
  riskThreshold: 50,
  categories: CATEGORIES,
  classifications: CLASSIFICATIONS,
  criteria: CRITERIA,
  locked: true,
};
const DISCIPLINES = ['none', 'reprimand', 'warning', 'warning2', 'suspended', 'expelled'];
const COMPONENTS = new Set(['academic_gpa', 'compliance_clean', 'pioneer_offline_participation']);
const DEFAULT_ASSESSMENT = {
  gpa: null,
  complianceConfirmed: false,
  discipline: 'none',
  offlineActivityCount: null,
  mode: 'normal',
  placementGrade: null,
  approvalReference: '',
  monthsAbroad: null,
  finalSemester: false,
  faculty: 'CNTT',
  specialApproved: false,
  exceptionalPoints: 0,
  exceptionalApprovalReference: '',
};

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function str(value, max = 1000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
function required(value, label, max = 1000) {
  const result = str(value, max);
  if (!result) fail(`Thiếu ${label}.`);
  return result;
}
function numeric(value, label) {
  if (
    !['number', 'string'].includes(typeof value) ||
    String(value).trim() === '' ||
    !Number.isFinite(Number(value))
  )
    fail(`${label} phải là số hữu hạn.`);
  return Number(value);
}
function validDate(value) {
  const date = required(value, 'ngày', 20);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    fail('Ngày phải hợp lệ theo dạng YYYY-MM-DD.');
  return date;
}
function round(value) {
  return value; // Keep calculation precision; formatting belongs to the UI.
}
function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}
export function openStore({
  dbPath = ':memory:',
  clock = () => new Date(),
  coordinatorEmails = [],
  demoCoordinator = false,
} = {}) {
  const configuredCoordinators = new Set(
    coordinatorEmails.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
  );
  const now = () => new Date(clock()).toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  let transactionDepth = 0;
  let workflows;
  const transaction = (fn) => {
    const depth = transactionDepth;
    const savepoint = `nested_${depth}`;
    db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    transactionDepth++;
    try {
      const result = fn();
      db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK');
      if (depth) db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    } finally {
      transactionDepth--;
    }
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,classId TEXT REFERENCES classes(id));
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('STUDENT','LECTURER')),studentId TEXT REFERENCES students(id),provider TEXT NOT NULL,googleSub TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY,title TEXT NOT NULL,organizer TEXT NOT NULL,date TEXT NOT NULL,categoryId TEXT NOT NULL,points REAL NOT NULL,mode TEXT NOT NULL,semester TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL,rowCount INTEGER NOT NULL,actorName TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,sourceId TEXT NOT NULL,studentId TEXT NOT NULL REFERENCES students(id),activityId TEXT REFERENCES activities(id),title TEXT NOT NULL,categoryId TEXT NOT NULL,points REAL NOT NULL,date TEXT NOT NULL,semester TEXT NOT NULL,batchId TEXT NOT NULL REFERENCES batches(id),canonical TEXT NOT NULL,UNIQUE(semester,sourceId));
    CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY,studentId TEXT NOT NULL REFERENCES students(id),activityId TEXT REFERENCES activities(id),title TEXT NOT NULL,organizer TEXT NOT NULL,date TEXT NOT NULL,categoryId TEXT NOT NULL,claimedPoints REAL NOT NULL,evidenceUrl TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('pending','reviewed','rejected','matched')),reviewNote TEXT NOT NULL DEFAULT '',officialRecordId TEXT UNIQUE REFERENCES records(id),createdAt TEXT NOT NULL,semester TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,actorName TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_student ON records(studentId,semester);
    CREATE INDEX IF NOT EXISTS claims_student ON claims(studentId,semester,status);
    CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS semester_snapshots (
      id TEXT PRIMARY KEY,semesterId TEXT NOT NULL REFERENCES semesters(id),version INTEGER NOT NULL,
      payload TEXT NOT NULL,UNIQUE(semesterId,version)
    );
    CREATE TABLE IF NOT EXISTS semester_history (
      id TEXT PRIMARY KEY,semesterId TEXT NOT NULL REFERENCES semesters(id),payload TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS semester_snapshots_no_update BEFORE UPDATE ON semester_snapshots
      BEGIN SELECT RAISE(ABORT,'Semester snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS semester_snapshots_no_delete BEFORE DELETE ON semester_snapshots
      BEGIN SELECT RAISE(ABORT,'Semester snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS semester_history_no_update BEFORE UPDATE ON semester_history
      BEGIN SELECT RAISE(ABORT,'Semester history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS semester_history_no_delete BEFORE DELETE ON semester_history
      BEGIN SELECT RAISE(ABORT,'Semester history is immutable'); END;
    CREATE TABLE IF NOT EXISTS roster_migrations (id TEXT PRIMARY KEY,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollments (
      studentId TEXT NOT NULL REFERENCES students(id),semester TEXT NOT NULL REFERENCES semesters(id),
      classId TEXT REFERENCES classes(id),className TEXT NOT NULL DEFAULT '',faculty TEXT NOT NULL DEFAULT '',
      cohortYear INTEGER,sourceId TEXT NOT NULL,approvalReference TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL,PRIMARY KEY(studentId,semester)
    );
    CREATE TABLE IF NOT EXISTS roster_batches (
      id TEXT PRIMARY KEY,name TEXT NOT NULL,actorId TEXT NOT NULL,actorName TEXT NOT NULL,
      reason TEXT NOT NULL,createdAt TEXT NOT NULL,rowCount INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roster_sources (
      id TEXT PRIMARY KEY,semester TEXT NOT NULL REFERENCES semesters(id),sourceId TEXT NOT NULL,
      studentId TEXT NOT NULL REFERENCES students(id),canonical TEXT NOT NULL,batchId TEXT REFERENCES roster_batches(id),
      createdAt TEXT NOT NULL,UNIQUE(semester,sourceId)
    );
    CREATE TABLE IF NOT EXISTS enrollment_history (
      id TEXT PRIMARY KEY,studentId TEXT NOT NULL REFERENCES students(id),semester TEXT NOT NULL REFERENCES semesters(id),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lecturer_assignments (
      id TEXT PRIMARY KEY,lecturerId TEXT NOT NULL REFERENCES users(id),classId TEXT NOT NULL REFERENCES classes(id),
      semester TEXT NOT NULL REFERENCES semesters(id),createdAt TEXT NOT NULL,actorId TEXT NOT NULL,
      actorName TEXT NOT NULL,reason TEXT NOT NULL,revokedAt TEXT,revokedBy TEXT,revokeReason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lecturer_assignment_active ON lecturer_assignments(lecturerId,classId,semester) WHERE revokedAt IS NULL;
    CREATE TRIGGER IF NOT EXISTS enrollment_history_no_update BEFORE UPDATE ON enrollment_history
      BEGIN SELECT RAISE(ABORT,'Enrollment history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS enrollment_history_no_delete BEFORE DELETE ON enrollment_history
      BEGIN SELECT RAISE(ABORT,'Enrollment history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS roster_sources_no_update BEFORE UPDATE ON roster_sources
      BEGIN SELECT RAISE(ABORT,'Roster source history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS roster_sources_no_delete BEFORE DELETE ON roster_sources
      BEGIN SELECT RAISE(ABORT,'Roster source history is immutable'); END;
  `);
  installWorkflowSchema(db);
  // Old rows retain their original category and points until a lecturer reclassifies them.
  transaction(() => {
    for (const table of ['activities', 'claims', 'records']) {
      const columns = new Set(all(`PRAGMA table_info(${table})`).map((row) => row.name));
      for (const [name, definition] of [
        ['criterionId', 'TEXT'],
        ['quantity', 'REAL NOT NULL DEFAULT 1'],
        ['approvalReference', "TEXT NOT NULL DEFAULT ''"],
        ['ruleVersion', "TEXT NOT NULL DEFAULT 'legacy-unverified'"],
      ])
        if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS assessments (
      studentId TEXT NOT NULL REFERENCES students(id),semester TEXT NOT NULL,payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL,actorName TEXT NOT NULL,PRIMARY KEY(studentId,semester)
    )`);
  });
  const criterionById = (id) => CRITERIA.find((item) => item.id === id);
  const isCurrent = (row) => {
    const criterion = criterionById(row?.criterionId);
    return (
      !!row &&
      row.ruleVersion === RULE_VERSION &&
      !!criterion &&
      (criterion.categoryId === row.categoryId ||
        (!criterion.categoryId && CATEGORIES.some((cat) => cat.id === row.categoryId)))
    );
  };
  const isEffectiveRecord = (row) =>
    !!row && !one('SELECT originalId FROM record_replacements WHERE originalId=?', row.id);
  const recordClaimId = (recordId) => {
    const visited = new Set();
    let currentId = recordId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const claim = one('SELECT id FROM claims WHERE officialRecordId=?', currentId);
      if (claim) return claim.id;
      currentId = one(
        'SELECT originalId FROM record_replacements WHERE replacementId=?',
        currentId,
      )?.originalId;
    }
    return null;
  };
  const replacementMetadata = (recordId) => {
    const successor = one(
      'SELECT replacementId,appealId FROM record_replacements WHERE originalId=?',
      recordId,
    );
    const predecessor = one(
      'SELECT originalId,appealId FROM record_replacements WHERE replacementId=?',
      recordId,
    );
    let effectiveRecordId = recordId;
    const seen = new Set();
    while (!seen.has(effectiveRecordId)) {
      seen.add(effectiveRecordId);
      const next = one(
        'SELECT replacementId FROM record_replacements WHERE originalId=?',
        effectiveRecordId,
      );
      if (!next) break;
      effectiveRecordId = next.replacementId;
    }
    return {
      effective: !successor,
      superseded: !!successor,
      replacementId: successor?.replacementId || null,
      replacesRecordId: predecessor?.originalId || null,
      effectiveRecordId,
      adjustmentAppealId: successor?.appealId || predecessor?.appealId || null,
    };
  };
  const checkedEntry = (payload, options = {}) => {
    if (
      options.student &&
      criterionById(payload?.criterionId) &&
      !criterionById(payload.criterionId).studentAllowed
    )
      fail('Tiêu chí này phải do cán bộ xác nhận, sinh viên không được tự kê khai.', 403);
    try {
      return normalizeEntry(payload, options);
    } catch (error) {
      if (!error.status) error.status = 400;
      throw error;
    }
  };
  const settings = () => {
    const value = JSON.parse(one('SELECT value FROM settings WHERE id=1').value);
    const threshold = Number(value.riskThreshold ?? 50);
    return {
      ...DEFAULT_SETTINGS,
      semester: catalogue().some((item) => item.id === value.semester)
        ? value.semester
        : catalogue()[0]?.id || SEMESTER,
      semesters: catalogue().map((item) => item.id),
      semesterCatalog: catalogue(),
      academicYears: [...new Set(catalogue().map((item) => item.academicYear))],
      riskThreshold: Number.isFinite(threshold) ? Math.min(100, Math.max(0, threshold)) : 50,
    };
  };
  const addAudit = (actor, action, detail) =>
    run(
      'INSERT INTO audit(id,actorName,action,detail,createdAt) VALUES(?,?,?,?,?)',
      makeId('audit'),
      actor.name,
      action,
      detail,
      now(),
    );
  const publicUser = (row) =>
    row
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          studentId: row.studentId,
          provider: row.provider,
        }
      : null;
  const authorize = (user, lecturer = false) => {
    if (!user?.id) fail('Vui lòng đăng nhập.', 401);
    const actual = publicUser(one('SELECT * FROM users WHERE id=?', user.id));
    if (!actual) fail('Phiên đăng nhập không còn hợp lệ.', 401);
    if (lecturer && actual.role !== 'LECTURER') fail('Chức năng này dành cho giảng viên.', 403);
    if (actual.role === 'STUDENT' && !actual.studentId)
      fail('Tài khoản chưa liên kết hồ sơ sinh viên.', 403);
    return actual;
  };
  const isCoordinator = (actor) =>
    actor?.role === 'LECTURER' &&
    (configuredCoordinators.has(actor.email.toLowerCase()) ||
      (demoCoordinator === true && actor.id === 'demo-lecturer' && actor.provider === 'demo'));
  const coordinator = (user) => {
    const actor = authorize(user, true);
    if (!isCoordinator(actor))
      fail('Chức năng này dành cho điều phối viên được cấu hình ở máy chủ.', 403);
    return actor;
  };
  const accessFor = (actor) => ({
    isCoordinator: isCoordinator(actor),
    canManageRoster: isCoordinator(actor),
    canManageSemesters: isCoordinator(actor),
    scope: actor.role === 'STUDENT' ? 'self' : isCoordinator(actor) ? 'all' : 'assigned',
  });
  const enrollmentFor = (studentId, semester) =>
    one('SELECT * FROM enrollments WHERE studentId=? AND semester=?', studentId, semester);
  const scopeEnrollmentFor = (studentId, semester) => {
    const snapshot = frozen(semester);
    if (!snapshot) return enrollmentFor(studentId, semester);
    const student = snapshot.students.find((row) => row.id === studentId);
    if (!student) return null;
    return {
      ...(snapshot.raw.enrollments?.find((row) => row.studentId === studentId) || {}),
      studentId,
      semester,
      classId: student.classId && student.classId !== 'unassigned' ? student.classId : null,
      className: student.className || '',
      faculty: student.faculty || '',
      cohortYear: student.cohortYear ?? null,
    };
  };
  const assignedClass = (actor, classId, semester) =>
    isCoordinator(actor) ||
    !!one(
      'SELECT id FROM lecturer_assignments WHERE lecturerId=? AND classId=? AND semester=? AND revokedAt IS NULL',
      actor.id,
      classId || '',
      semester,
    );
  const canReadStudent = (actor, studentId, semester) =>
    actor.role === 'STUDENT'
      ? actor.studentId === studentId
      : isCoordinator(actor) ||
        assignedClass(actor, scopeEnrollmentFor(studentId, semester)?.classId, semester);
  const assertStudentScope = (actor, studentId, semester, write = false) => {
    if (!canReadStudent(actor, studentId, semester))
      fail('Sinh viên không thuộc phạm vi lớp được phân công trong học kỳ này.', 403);
    if (write && !enrollmentFor(studentId, semester))
      fail(
        'Sinh viên chưa có trong danh sách của học kỳ. Điều phối viên cần nhập danh sách trước.',
        409,
      );
  };
  const visibleRows = (actor, rows, semester) =>
    rows.filter((row) => canReadStudent(actor, row.studentId, semester));
  const visibleClasses = (actor, semester) =>
    classList(semester).filter((row) =>
      actor.role === 'STUDENT'
        ? row.id === (scopeEnrollmentFor(actor.studentId, semester)?.classId || 'unassigned')
        : assignedClass(actor, row.id, semester),
    );
  const semesterStudent = (student, semester) => {
    const enrollment = enrollmentFor(student.id, semester);
    return {
      ...student,
      classId: enrollment?.classId || null,
      className: enrollment?.className || 'Chưa phân lớp',
      faculty: enrollment?.faculty || '',
      cohortYear: enrollment?.cohortYear ?? null,
      enrolled: !!enrollment,
    };
  };
  const readSemester = (filters = {}) => {
    const semester = str(filters?.semester) || settings().semester;
    if (!semesterRow(semester)) fail('Học kỳ không nằm trong danh mục được cấu hình.');
    return semester;
  };
  const semesterRow = (id) => {
    const row = one('SELECT payload FROM semesters WHERE id=?', id);
    return row ? JSON.parse(row.payload) : null;
  };
  const catalogue = () =>
    all('SELECT payload FROM semesters')
      .map((row) => JSON.parse(row.payload))
      .sort(
        (a, b) =>
          a.academicYear.localeCompare(b.academicYear) ||
          a.term - b.term ||
          a.id.localeCompare(b.id),
      );
  const assertWritable = (id, actor = null) => {
    const period = semesterRow(id);
    if (!period) fail('Học kỳ không nằm trong danh mục được cấu hình.');
    if (period.state === 'closed')
      fail(`Học kỳ ${id} đã chốt và khóa. Cần mở lại trước khi thay đổi.`, 409);
    if (actor?.role === 'STUDENT') {
      const instant = Date.parse(now());
      if (period.state !== 'open') fail('Học kỳ đang tổng hợp, không nhận kê khai sinh viên.', 409);
      if (period.startsAt && instant < Date.parse(period.startsAt))
        fail('Chưa đến thời gian kê khai.', 409);
      if (period.deadline && instant >= Date.parse(period.deadline))
        fail('Đã hết thời hạn kê khai.', 409);
    }
    return period;
  };
  const frozen = (id) => {
    if (semesterRow(id)?.state !== 'closed') return null;
    const row = one(
      'SELECT payload FROM semester_snapshots WHERE semesterId=? ORDER BY version DESC LIMIT 1',
      id,
    );
    if (!row) fail('Học kỳ khóa chưa có bản chốt; cần kiểm tra dữ liệu.', 409);
    return JSON.parse(row.payload);
  };
  const categories = () => settings().categories;
  const category = (id) => {
    const found = categories().find((item) => item.id === id);
    if (!found) fail('Mục điểm không tồn tại.');
    return found;
  };
  const classList = (semester = null) => {
    const snapshot = semester ? frozen(semester) : null;
    if (snapshot) return snapshot.classes;
    const rows = semester
      ? all(
          "SELECT classId id,className name,CASE WHEN MIN(faculty)=MAX(faculty) THEN MAX(faculty) ELSE '' END faculty,CASE WHEN MIN(cohortYear)=MAX(cohortYear) THEN MAX(cohortYear) ELSE NULL END cohortYear FROM enrollments WHERE semester=? AND classId IS NOT NULL GROUP BY classId,className ORDER BY className",
          semester,
        )
      : all('SELECT id,name FROM classes ORDER BY name');
    if (
      semester
        ? one(
            'SELECT studentId FROM enrollments WHERE semester=? AND classId IS NULL LIMIT 1',
            semester,
          )
        : one('SELECT id FROM students WHERE classId IS NULL LIMIT 1')
    )
      rows.push({ id: 'unassigned', name: 'Chưa phân lớp' });
    return rows;
  };
  const studentRow = (id) =>
    one(
      'SELECT s.*,c.name className FROM students s LEFT JOIN classes c ON c.id=s.classId WHERE s.id=?',
      id,
    );
  const syncStudentName = (studentId, name) => {
    const displayName = str(name);
    if (studentId && displayName)
      run('UPDATE students SET name=? WHERE id=? AND name<>?', displayName, studentId, displayName);
  };
  const entryMetadata = (row) => ({
    ...row,
    legacy: !isCurrent(row),
    criterionName:
      criterionById(row.criterionId)?.name ||
      criterionById(row.criterionId)?.label ||
      'Chưa đối chiếu tiêu chí',
    categoryName:
      CATEGORIES.find((cat) => cat.id === row.categoryId)?.name || `Dữ liệu cũ (${row.categoryId})`,
  });
  const activityList = (semester = SEMESTER) =>
    frozen(semester)?.views.activities ||
    all('SELECT * FROM activities WHERE semester=? ORDER BY date DESC,title', semester).map(
      entryMetadata,
    );
  const decorateClaim = (row) =>
    row
      ? {
          ...entryMetadata(row),
          projectionExcluded: Boolean(projectionExclusionReason(row)),
          projectionExclusionReason: projectionExclusionReason(row),
          studentCode: studentRow(row.studentId)?.code,
          studentName: studentRow(row.studentId)?.name,
          className: enrollmentFor(row.studentId, row.semester)?.className || 'Chưa phân lớp',
          evidenceId: row.evidenceId || null,
          evidenceStatus: row.evidenceId
            ? JSON.parse(
                one('SELECT payload FROM evidence WHERE id=?', row.evidenceId)?.payload || '{}',
              ).status || 'untracked'
            : row.evidenceUrl
              ? 'untracked'
              : 'none',
          evidenceSharingComplete: row.evidenceId
            ? JSON.parse(
                one('SELECT payload FROM evidence WHERE id=?', row.evidenceId)?.payload || '{}',
              ).sharingComplete === true
            : false,
        }
      : null;
  const claimsFor = (studentId = null, semester = SEMESTER) => {
    const snapshot = frozen(semester);
    if (snapshot)
      return snapshot.views.claims.filter((row) => !studentId || row.studentId === studentId);
    return all(
      `SELECT * FROM claims WHERE semester=? ${studentId ? 'AND studentId=?' : ''} ORDER BY createdAt DESC,id`,
      semester,
      ...(studentId ? [studentId] : []),
    ).map(decorateClaim);
  };
  const decorateRecord = (row) =>
    row
      ? {
          ...entryMetadata(row),
          ...replacementMetadata(row.id),
          canonical: undefined,
          studentCode: studentRow(row.studentId)?.code,
          studentName: studentRow(row.studentId)?.name,
          matchedClaimId: recordClaimId(row.id),
          matchedClaimInherited:
            !!recordClaimId(row.id) &&
            !one('SELECT id FROM claims WHERE officialRecordId=?', row.id),
        }
      : null;
  const recordsFor = (studentId = null, semester = SEMESTER) => {
    const snapshot = frozen(semester);
    if (snapshot)
      return snapshot.views.records.filter((row) => !studentId || row.studentId === studentId);
    return all(
      `SELECT * FROM records WHERE semester=? ${studentId ? 'AND studentId=?' : ''} ORDER BY date DESC,id`,
      semester,
      ...(studentId ? [studentId] : []),
    ).map(decorateRecord);
  };
  const assessmentFor = (studentId, semester = SEMESTER) => {
    const snapshot = frozen(semester);
    if (snapshot)
      return (
        snapshot.views.assessments.find((row) => row.studentId === studentId)?.assessment || {
          ...DEFAULT_ASSESSMENT,
          semester,
          updatedAt: null,
        }
      );
    const row = one(
      'SELECT * FROM assessments WHERE studentId=? AND semester=?',
      studentId,
      semester,
    );
    return {
      ...DEFAULT_ASSESSMENT,
      ...(row ? JSON.parse(row.payload) : {}),
      semester,
      updatedAt: row?.updatedAt || null,
    };
  };
  const evaluationKey = (row) => {
    const meta = criterionById(row.criterionId);
    return meta?.exclusiveGroup || (meta?.singleton || COMPONENTS.has(meta?.id) ? meta.id : null);
  };
  const projectionExclusionReason = (row, official = null, assessment = null) => {
    if (!isCurrent(row) || !ACTIVE.has(row.status) || row.officialRecordId) return null;
    const key = evaluationKey(row);
    if (!key) return null;
    const confirmed =
      official ||
      all(
        'SELECT * FROM records WHERE studentId=? AND semester=?',
        row.studentId,
        row.semester,
      ).filter((record) => isCurrent(record) && isEffectiveRecord(record));
    if (confirmed.some((record) => evaluationKey(record) === key))
      return 'Thành phần đánh giá đã có kết quả chính thức; kê khai được giữ để đối soát và không cộng thêm vào điểm dự kiến.';
    const profile = assessment || assessmentFor(row.studentId, row.semester);
    if (
      (row.criterionId === 'compliance_clean' && profile.complianceConfirmed) ||
      (profile.mode === 'normal' &&
        ((row.criterionId === 'academic_gpa' && profile.gpa !== null) ||
          (row.criterionId === 'pioneer_offline_participation' &&
            profile.offlineActivityCount !== null)))
    )
      return 'Thành phần đánh giá đã được xác nhận trong hồ sơ học kỳ; kê khai được giữ để đối soát và không cộng thêm vào điểm dự kiến.';
    return null;
  };
  const canonicalFor = (row) =>
    JSON.stringify({
      sourceId: row.sourceId,
      studentCode: row.studentCode || studentRow(row.studentId)?.code,
      activityId: row.activityId || null,
      title: row.title,
      categoryId: row.categoryId,
      points: row.points,
      date: row.date,
      semester: row.semester,
      criterionId: row.criterionId,
      quantity: row.quantity,
      approvalReference: row.approvalReference || '',
      ruleVersion: row.ruleVersion || RULE_VERSION,
    });
  const putAssessment = (studentId, profile, actorName) =>
    run(
      'INSERT INTO assessments(studentId,semester,payload,updatedAt,actorName) VALUES(?,?,?,?,?) ON CONFLICT(studentId,semester) DO UPDATE SET payload=excluded.payload,updatedAt=excluded.updatedAt,actorName=excluded.actorName',
      studentId,
      profile.semester,
      JSON.stringify(profile),
      now(),
      actorName,
    );
  const validateAssessment = (payload, previous) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      fail('Hồ sơ đánh giá không hợp lệ.');
    const input = { ...previous, ...payload },
      semester = readSemester(input);
    const optionalNumber = (value, label, max) => {
      if (value === null || value === undefined || value === '') return null;
      const n = numeric(value, label);
      if (n < 0 || n > max) fail(`${label} ngoài giới hạn cho phép.`);
      return n;
    };
    const boolean = (value, label) => {
      if (typeof value !== 'boolean') fail(`${label} phải là giá trị đúng/sai.`);
      return value;
    };
    const profile = {
      semester,
      gpa: optionalNumber(input.gpa, 'Điểm trung bình học kỳ', 10),
      complianceConfirmed: boolean(input.complianceConfirmed, 'Xác nhận chấp hành'),
      discipline: str(input.discipline),
      offlineActivityCount: optionalNumber(
        input.offlineActivityCount,
        'Số hoạt động trực tiếp',
        100000,
      ),
      mode: str(input.mode),
      placementGrade: optionalNumber(input.placementGrade, 'Điểm tập sự/học tập nước ngoài', 10),
      approvalReference: str(input.approvalReference, 1500),
      monthsAbroad: optionalNumber(input.monthsAbroad, 'Số tháng học nước ngoài', 120),
      finalSemester: boolean(input.finalSemester, 'Học kỳ cuối'),
      faculty: required(input.faculty, 'khoa', 200),
      specialApproved: boolean(input.specialApproved, 'Phê duyệt trường hợp đặc biệt'),
      exceptionalPoints: numeric(input.exceptionalPoints, 'Điểm ưu tiên được duyệt'),
      exceptionalApprovalReference: str(input.exceptionalApprovalReference, 1500),
    };
    if (!DISCIPLINES.includes(profile.discipline)) fail('Mức kỷ luật không hợp lệ.');
    if (!['normal', 'internship', 'overseas'].includes(profile.mode))
      fail('Chế độ đánh giá không hợp lệ.');
    if (profile.offlineActivityCount !== null && !Number.isInteger(profile.offlineActivityCount))
      fail('Số hoạt động trực tiếp phải là số nguyên.');
    if (profile.exceptionalPoints !== 0)
      fail(
        'Điểm ưu tiên phải được ghi nhận bằng khoản chính thức với tiêu chí approved_adjustment, mục điểm cụ thể và văn bản phê duyệt; không cộng điểm riêng ngoài sáu mục.',
      );
    if (profile.mode !== 'normal') {
      if (!profile.specialApproved || !profile.approvalReference)
        fail('Chế độ tập sự/học nước ngoài cần xác nhận và quyết định/phê duyệt.');
      const faculty = profile.faculty
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd');
      const finalOnly = [
        'cntt',
        'cong nghe thong tin',
        'dien',
        'dien tu',
        'khoa hoc ung dung',
        'duoc',
      ].some((key) => faculty.includes(key));
      if (finalOnly && !profile.finalSemester)
        fail('Khoa này chỉ áp dụng chế độ đặc biệt ở học kỳ cuối theo Điều 10.');
      if (
        profile.mode === 'overseas' &&
        (profile.monthsAbroad === null || profile.monthsAbroad < 2)
      )
        fail('Học tập nước ngoài phải từ hai tháng trở lên và có quyết định của Trường.');
    }
    return profile;
  };
  const summarize = (student, semester = SEMESTER) => {
    const snapshot = frozen(semester);
    if (snapshot)
      return (
        snapshot.students.find((row) => row.id === student.id) || {
          id: student.id,
          code: student.code,
          name: student.name,
          email: student.email,
          classId: 'unassigned',
          className: 'Chưa có trong danh sách chốt',
          semester,
          hasOfficialData: false,
          officialTotal: null,
          publishedTotal: null,
          pendingTotal: 0,
          projectedTotal: null,
          officialClassification: null,
          projectedClassification: null,
          categoryScores: [],
          pendingCount: 0,
          excludedPendingCount: 0,
          legacyCount: 0,
          evaluationStatus: 'no_data',
          warnings: ['Hồ sơ chưa tồn tại tại thời điểm chốt.'],
          assessment: {
            ...DEFAULT_ASSESSMENT,
            semester,
            complete: false,
            missing: ['Chưa có trong bản chốt'],
          },
          discipline: 'none',
          ruleVersion: snapshot.rules.ruleVersion,
          snapshotId: snapshot.id,
        }
      );
    student = semesterStudent(student, semester);
    const assessment = assessmentFor(student.id, semester);
    const allOfficial = all(
      'SELECT * FROM records WHERE studentId=? AND semester=?',
      student.id,
      semester,
    ).filter(isEffectiveRecord);
    const allClaims = all(
      'SELECT * FROM claims WHERE studentId=? AND semester=?',
      student.id,
      semester,
    );
    const official = allOfficial.filter(isCurrent);
    const activeClaims = allClaims.filter(
      (row) => isCurrent(row) && ACTIVE.has(row.status) && !row.officialRecordId,
    );
    const pending = activeClaims.filter(
      (claim) => !projectionExclusionReason(claim, official, assessment),
    );
    const excludedPendingCount = activeClaims.length - pending.length;
    const legacyCount =
      allOfficial.filter((row) => !isCurrent(row)).length +
      allClaims.filter((row) => !isCurrent(row)).length;
    const warnings = [];
    if (excludedPendingCount)
      warnings.push(
        `${excludedPendingCount} kê khai chờ đã có thành phần được xác nhận trong hồ sơ hoặc khoản chính thức; giữ để đối soát và không cộng thêm điểm dự kiến.`,
      );
    if (legacyCount)
      warnings.push(
        `${legacyCount} khoản dữ liệu cũ chưa đối chiếu tiêu chí, được giữ nguyên và không cộng vào điểm theo quy chế hiện tại.`,
      );
    const discipline =
      DISCIPLINES[
        Math.max(
          DISCIPLINES.indexOf(assessment.discipline),
          DISCIPLINES.indexOf(disciplineForEntries(official)),
        )
      ];
    const excludedPioneer = DISCIPLINES.indexOf(discipline) >= DISCIPLINES.indexOf('reprimand');
    const component = (id) => official.filter((row) => row.criterionId === id);
    const derived = { academic: 0, compliance: 0, movement: 0, community: 0, pioneer: 0, bonus: 0 };
    const missing = [];
    if (assessment.mode === 'normal') {
      if (!component('academic_gpa').length) {
        if (assessment.gpa === null) missing.push('Điểm trung bình học kỳ');
        else derived.academic += academicPoints(assessment.gpa);
      }
      if (!excludedPioneer && !component('pioneer_offline_participation').length) {
        if (assessment.offlineActivityCount === null) missing.push('Số hoạt động trực tiếp');
        else derived.pioneer += offlinePoints(assessment.offlineActivityCount);
      }
    } else if (assessment.placementGrade === null) missing.push('Điểm tập sự/học tập nước ngoài');
    else derived.academic = placementPoints(assessment.placementGrade);
    if (!component('compliance_clean').length) {
      if (!assessment.complianceConfirmed) missing.push('Xác nhận chấp hành');
      else derived.compliance += 20;
    }
    if (component('academic_gpa').length && assessment.gpa !== null)
      warnings.push('Kết quả học tập đã có khoản chính thức; không cộng thêm điểm GPA từ hồ sơ.');
    if (component('compliance_clean').length && assessment.complianceConfirmed)
      warnings.push('Điểm chấp hành đã có khoản chính thức; không cộng lặp từ hồ sơ.');
    if (
      component('pioneer_offline_participation').length &&
      assessment.offlineActivityCount !== null
    )
      warnings.push('Điểm tham gia trực tiếp đã có khoản chính thức; không cộng lặp từ hồ sơ.');
    if (Number(assessment.exceptionalPoints) > 0)
      warnings.push(
        'Điểm ưu tiên trong hồ sơ cũ chưa được gắn với mục điểm nên không được cộng; cần đối chiếu văn bản và ghi nhận khoản approved_adjustment vào đúng mục.',
      );
    if (excludedPioneer)
      warnings.push('Không ghi nhận mục tiên phong, gương mẫu do kỷ luật từ khiển trách trở lên.');
    const special = assessment.mode !== 'normal';
    if (special)
      warnings.push(
        'Chế độ Điều 10: chỉ tính điểm chấp hành, kết quả quy đổi tối đa 80 và điểm thưởng; các hoạt động khác vẫn được lưu.',
      );
    const categoryScores = CATEGORIES.map((cat) => {
      const rows = official.filter((row) => row.categoryId === cat.id);
      const rawOfficial = derived[cat.id] + rows.reduce((sum, row) => sum + row.points, 0);
      const rawPending = pending
        .filter((row) => row.categoryId === cat.id)
        .reduce((sum, row) => sum + row.claimedPoints, 0);
      const excluded =
        (cat.id === 'pioneer' && excludedPioneer) ||
        (special && !['academic', 'compliance', 'bonus'].includes(cat.id));
      const maxPoints = special && cat.id === 'academic' ? 80 : cat.maxPoints;
      // Placement grades replace the academic activity category in special semesters.
      const base = special && cat.id === 'academic' ? derived.academic : rawOfficial;
      return {
        categoryId: cat.id,
        name: special && cat.id === 'academic' ? 'Kết quả tập sự/học tập nước ngoài' : cat.name,
        maxPoints,
        official: excluded ? 0 : round(Math.min(maxPoints, base)),
        pending: round(rawPending),
        projected: excluded
          ? 0
          : round(Math.min(maxPoints, base + (special && cat.id === 'academic' ? 0 : rawPending))),
        rawOfficial: round(rawOfficial),
        excluded,
      };
    });
    const profileData = assessment.updatedAt !== null;
    const hasOfficialData = official.length > 0 || profileData;
    const blocked = ['suspended', 'expelled'].includes(discipline);
    const evaluationStatus = blocked
      ? 'not_evaluated'
      : !hasOfficialData
        ? 'no_data'
        : missing.length
          ? 'incomplete'
          : 'evaluated';
    if (missing.length && hasOfficialData) warnings.push(`Chưa hoàn tất: ${missing.join(', ')}.`);
    const officialTotal = blocked
      ? null
      : round(
          Math.min(
            100,
            categoryScores.reduce((sum, cat) => sum + cat.official, 0),
          ),
        );
    const projectedTotal = blocked
      ? null
      : round(
          Math.min(
            100,
            categoryScores.reduce((sum, cat) => sum + cat.projected, 0),
          ),
        );
    return {
      id: student.id,
      code: student.code,
      name: student.name,
      email: student.email,
      classId: student.classId || 'unassigned',
      className: student.className || 'Chưa phân lớp',
      faculty: student.faculty || '',
      cohortYear: student.cohortYear ?? null,
      enrolled: student.enrolled,
      semester,
      hasOfficialData,
      officialTotal,
      pendingTotal: round(pending.reduce((sum, row) => sum + row.claimedPoints, 0)),
      projectedTotal,
      officialClassification: blocked
        ? 'Không đánh giá'
        : hasOfficialData
          ? classifyScore(officialTotal, discipline === 'warning2' ? 'warning' : discipline)
          : null,
      projectedClassification: blocked
        ? 'Không đánh giá'
        : hasOfficialData || pending.length
          ? classifyScore(projectedTotal, discipline === 'warning2' ? 'warning' : discipline)
          : null,
      categoryScores,
      pendingCount: activeClaims.length,
      excludedPendingCount,
      ruleVersion: RULE_VERSION,
      evaluationStatus,
      legacyCount,
      warnings,
      assessment: {
        ...assessment,
        discipline,
        complete: evaluationStatus === 'evaluated',
        missing,
      },
      discipline,
    };
  };
  const summaries = (user, filters = {}) => {
    const semester = readSemester(filters);
    const snapshot = frozen(semester);
    let result = snapshot
      ? snapshot.students
      : all(
          'SELECT s.* FROM students s JOIN enrollments e ON e.studentId=s.id AND e.semester=? ORDER BY s.code',
          semester,
        ).map((student) => semesterStudent(student, semester));
    if (user.role === 'STUDENT') result = result.filter((student) => student.id === user.studentId);
    else result = result.filter((student) => canReadStudent(user, student.id, semester));
    if (user.role === 'STUDENT' && result.length === 0) {
      const own = studentRow(user.studentId);
      if (own) result.push(snapshot ? summarize(own, semester) : semesterStudent(own, semester));
    }
    if (filters.classId)
      result = result.filter((student) => (student.classId || 'unassigned') === filters.classId);
    if (filters.faculty) result = result.filter((student) => student.faculty === filters.faculty);
    if (filters.cohortYear)
      result = result.filter(
        (student) => Number(student.cohortYear) === Number(filters.cohortYear),
      );
    const query = str(filters.q).toLocaleLowerCase('vi');
    if (query)
      result = result.filter((student) =>
        `${student.name} ${student.code} ${student.email}`.toLocaleLowerCase('vi').includes(query),
      );
    let output = snapshot ? result : result.map((student) => summarize(student, semester));
    if (filters.classification)
      output = output.filter(
        (student) =>
          student.officialClassification === filters.classification ||
          (!student.hasOfficialData && filters.classification === 'no-data'),
      );
    return output;
  };
  if (Number(one('PRAGMA user_version').user_version) === 0)
    transaction(() => {
      run('INSERT INTO settings(id,value) VALUES(1,?)', JSON.stringify(DEFAULT_SETTINGS));
      for (let i = 1; i <= 3; i++)
        run(
          'INSERT INTO classes(id,name) VALUES(?,?)',
          `cls${i}`,
          `CNTT 24${String.fromCharCode(64 + i)}`,
        );
      const names = [
        'Nguyễn Minh An',
        'Trần Bảo Bình',
        'Lê Hoàng Châu',
        'Phạm Gia Duy',
        'Võ Khánh Hà',
        'Đặng Thanh Hân',
        'Bùi Quốc Huy',
        'Đỗ Ngọc Khánh',
        'Hồ Mai Lan',
        'Phan Anh Minh',
        'Vũ Hải Nam',
        'Dương Thảo Nguyên',
        'Ngô Minh Phúc',
        'Lý Nhật Quang',
        'Mai Phương Thảo',
        'Đinh Minh Thiện',
        'Tô Bảo Trân',
        'Cao Anh Tú',
        'Lâm Quốc Việt',
        'Trịnh Hải Yến',
        'Nguyễn Đức Anh',
        'Trần Mỹ Duyên',
        'Lê Quốc Đạt',
        'Phạm Minh Hiếu',
        'Võ Ngọc Linh',
        'Đặng Hữu Long',
        'Bùi Thu Phương',
        'Đỗ Minh Tâm',
        'Hồ Thanh Trúc',
        'Phan Bảo Vy',
      ];
      for (let i = 1; i <= 30; i++) {
        const suffix = String(i).padStart(3, '0');
        const email =
          i === 1
            ? '523h0080@student.tdtu.edu.vn'
            : i === 2
              ? 'demo.student2@student.tdtu.edu.vn'
              : `demo${suffix}@student.tdtu.edu.vn`;
        run(
          'INSERT INTO students(id,code,name,email,classId) VALUES(?,?,?,?,?)',
          `s${suffix}`,
          i === 1 ? '523h0080' : `DEMO${suffix}`,
          names[i - 1],
          email,
          `cls${Math.ceil(i / 10)}`,
        );
      }
      run(
        'INSERT INTO users(id,name,email,role,studentId,provider) VALUES(?,?,?,?,?,?)',
        'demo-lecturer',
        'Giảng viên minh họa',
        '523h0025@student.tdtu.edu.vn',
        'LECTURER',
        null,
        'demo',
      );
      for (const [id, studentId] of [
        ['demo-student', 's001'],
        ['demo-student-2', 's002'],
      ]) {
        const student = studentRow(studentId);
        run(
          'INSERT INTO users(id,name,email,role,studentId,provider) VALUES(?,?,?,?,?,?)',
          id,
          student.name,
          student.email,
          'STUDENT',
          student.id,
          'demo',
        );
      }
      const seedActivities = [
        [
          'a1',
          'Hội thảo nghề nghiệp công nghệ',
          'Khoa Công nghệ thông tin',
          '2026-09-05',
          'academic_seminar',
          'offline',
        ],
        [
          'a2',
          'Hiến máu tình nguyện tháng 9',
          'Đoàn trường',
          '2026-09-14',
          'community_blood_hair_donation',
          'offline',
        ],
        [
          'a3',
          'Hiến máu tình nguyện tháng 10',
          'Đoàn trường',
          '2026-10-10',
          'community_blood_hair_donation',
          'offline',
        ],
        [
          'a4',
          'Cuộc thi học thuật cấp khoa',
          'Khoa Công nghệ thông tin',
          '2026-10-15',
          'academic_competition_local',
          'online',
        ],
        [
          'a5',
          'Giao lưu văn hóa quốc tế',
          'Khoa Công nghệ thông tin',
          '2026-10-19',
          'movement_cultural_exchange',
          'offline',
        ],
        [
          'a6',
          'Hội thao sinh viên khoa CNTT',
          'Khoa Công nghệ thông tin',
          '2026-10-20',
          'movement_competition_local',
          'offline',
        ],
        [
          'a7',
          'Ngày thứ bảy tình nguyện',
          'Đoàn trường',
          '2026-10-21',
          'community_volunteer',
          'offline',
        ],
        [
          'a8',
          'Hội thảo định hướng học tập',
          'Khoa Công nghệ thông tin',
          '2026-10-22',
          'academic_seminar',
          'online',
        ],
      ];
      for (const [id, title, organizer, date, criterionId, mode] of seedActivities) {
        const entry = checkedEntry({ criterionId, quantity: 1 });
        run(
          'INSERT INTO activities(id,title,organizer,date,categoryId,points,mode,semester,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          title,
          organizer,
          date,
          entry.categoryId,
          entry.points,
          mode,
          SEMESTER,
          criterionId,
          entry.quantity,
          entry.approvalReference,
          RULE_VERSION,
        );
      }
      run(
        'INSERT INTO batches(id,name,createdAt,rowCount,actorName) VALUES(?,?,?,?,?)',
        'seed-batch',
        'Dữ liệu minh họa theo quy chế được cung cấp',
        now(),
        0,
        'Hệ thống demo',
      );
      let count = 0;
      const seedRecord = (studentId, activityId) => {
        const activity = one('SELECT * FROM activities WHERE id=?', activityId);
        const id = `seed-record-${++count}`,
          sourceId = `SEED-${studentId}-${activityId}`;
        const row = { ...activity, id, sourceId, studentId, batchId: 'seed-batch' };
        run(
          'INSERT INTO records(id,sourceId,studentId,activityId,title,categoryId,points,date,semester,batchId,canonical,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          sourceId,
          studentId,
          activityId,
          activity.title,
          activity.categoryId,
          activity.points,
          activity.date,
          SEMESTER,
          'seed-batch',
          canonicalFor({ ...row, activityId }),
          activity.criterionId,
          activity.quantity,
          activity.approvalReference,
          RULE_VERSION,
        );
      };
      for (let i = 1; i <= 27; i++) {
        const id = `s${String(i).padStart(3, '0')}`;
        putAssessment(
          id,
          {
            ...DEFAULT_ASSESSMENT,
            semester: SEMESTER,
            gpa: i === 1 ? 9 : 4 + (i % 7),
            complianceConfirmed: true,
            offlineActivityCount: i === 1 ? 0 : (i * 3) % 19,
          },
          'Hệ thống demo',
        );
        if (i === 1) seedRecord(id, 'a2');
        else {
          seedRecord(id, i % 2 ? 'a1' : 'a6');
          if (i % 3 === 0) seedRecord(id, 'a7');
        }
      }
      run('UPDATE batches SET rowCount=? WHERE id=?', count, 'seed-batch');
      const seedClaim = (id, studentId, activityId, status = 'pending') => {
        const activity = one('SELECT * FROM activities WHERE id=?', activityId);
        run(
          'INSERT INTO claims(id,studentId,activityId,title,organizer,date,categoryId,claimedPoints,evidenceUrl,note,status,reviewNote,createdAt,semester,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          studentId,
          activityId,
          activity.title,
          activity.organizer,
          activity.date,
          activity.categoryId,
          activity.points,
          '',
          'Dữ liệu minh họa: chờ ghi nhận chính thức.',
          status,
          status === 'rejected' ? 'Minh chứng chưa đủ.' : '',
          now(),
          SEMESTER,
          activity.criterionId,
          activity.quantity,
          activity.approvalReference,
          RULE_VERSION,
        );
      };
      seedClaim('claim-scenario', 's001', 'a3');
      seedClaim('claim-seed-2', 's002', 'a5', 'reviewed');
      seedClaim('claim-seed-3', 's004', 'a7');
      seedClaim('claim-seed-4', 's011', 'a3');
      seedClaim('claim-seed-5', 's023', 'a8', 'rejected');
      seedClaim('claim-seed-6', 's028', 'a4');
      addAudit(
        { name: 'Hệ thống demo' },
        'Khởi tạo dữ liệu',
        `30 sinh viên, 3 lớp; dữ liệu minh họa dùng tiêu chí ${RULE_VERSION}.`,
      );
      db.exec('PRAGMA user_version = 2');
    });
  if (Number(one('PRAGMA user_version').user_version) < 2)
    transaction(() => {
      addAudit(
        { name: 'Hệ thống' },
        'Nâng cấp quy chế',
        `Áp dụng ${RULE_VERSION}; giữ nguyên dữ liệu cũ và đánh dấu chưa đối chiếu, không tự ánh xạ tiêu chí.`,
      );
      db.exec('PRAGMA user_version = 2');
    });
  // Catalogue migration only registers existing IDs; it never rewrites source data or links.
  transaction(() => {
    const saved = JSON.parse(one('SELECT value FROM settings WHERE id=1').value);
    const ids = new Set(
      [saved.semester, ...(Array.isArray(saved.semesters) ? saved.semesters : [])].filter(Boolean),
    );
    for (const table of ['activities', 'records', 'claims', 'assessments'])
      for (const row of all(`SELECT DISTINCT semester FROM ${table}`))
        if (row.semester) ids.add(row.semester);
    for (const id of ids) {
      if (semesterRow(id)) continue;
      const parsed = /^(\d{4})-(\d{4})-HK([1-9]\d*)$/.exec(id);
      const validMetadata =
        !!parsed &&
        Number(parsed[1]) >= 1900 &&
        Number(parsed[2]) <= 2201 &&
        Number(parsed[2]) === Number(parsed[1]) + 1 &&
        Number(parsed[3]) >= 1 &&
        Number(parsed[3]) <= 20;
      const term = validMetadata ? Number(parsed[3]) : 0;
      const period = {
        id,
        name: id,
        academicYear: validMetadata ? `${parsed[1]}-${parsed[2]}` : 'Chưa xác định',
        term,
        state: 'open',
        startsAt: null,
        deadline: null,
        annualIncluded: validMetadata && [1, 2].includes(term),
        courseIncluded: validMetadata && [1, 2].includes(term),
        metadataVerified: validMetadata,
        createdAt: now(),
        updatedAt: now(),
      };
      run('INSERT INTO semesters(id,payload) VALUES(?,?)', id, JSON.stringify(period));
    }
  });
  // Preserve the roster known at upgrade time once. A future semester must be populated explicitly.
  transaction(() => {
    if (one("SELECT id FROM roster_migrations WHERE id='semester-roster-v1'")) return;
    for (const period of catalogue()) {
      const snapshot = frozen(period.id);
      const roster = snapshot
        ? snapshot.students
        : all(
            'SELECT s.*,c.name className FROM students s LEFT JOIN classes c ON c.id=s.classId ORDER BY s.code',
          );
      for (const student of roster) {
        const classId =
          student.classId && student.classId !== 'unassigned' ? student.classId : null;
        const payload = {
          studentId: student.id,
          semester: period.id,
          classId,
          className: classId ? student.className || '' : '',
          faculty: student.faculty || '',
          cohortYear: student.cohortYear ?? null,
          sourceId: `migration:${period.id}:${student.id}`,
          approvalReference:
            'Danh sách hiện có khi nâng cấp; khoa/khóa chưa xác định không được suy đoán',
          updatedAt: now(),
        };
        run(
          'INSERT OR IGNORE INTO enrollments(studentId,semester,classId,className,faculty,cohortYear,sourceId,approvalReference,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)',
          ...Object.values(payload),
        );
        const event = {
          id: makeId('enrollment-history'),
          studentId: student.id,
          semester: period.id,
          actorId: 'system',
          actorName: 'Hệ thống chuyển đổi',
          reason: payload.approvalReference,
          action: 'migration',
          createdAt: now(),
          before: null,
          after: payload,
        };
        run(
          'INSERT INTO enrollment_history(id,studentId,semester,payload) VALUES(?,?,?,?)',
          event.id,
          student.id,
          period.id,
          JSON.stringify(event),
        );
      }
    }
    run('INSERT INTO roster_migrations(id,createdAt) VALUES(?,?)', 'semester-roster-v1', now());
  });
  // Repair databases created before Google names were copied to linked student profiles.
  // This only updates display names; identity, roles and conduct data remain intact.
  transaction(() => {
    for (const user of all(
      "SELECT studentId,name FROM users WHERE provider='google' AND googleSub IS NOT NULL AND studentId IS NOT NULL AND trim(name)<>'' ORDER BY id",
    ))
      syncStudentName(user.studentId, user.name);
  });
  const validateUniqueEntry = (
    studentId,
    semester,
    entry,
    { excludeRecordId = null, profile = true, seen = new Set() } = {},
  ) => {
    const meta = criterionById(entry.criterionId);
    const current = all(
      'SELECT * FROM records WHERE studentId=? AND semester=?',
      studentId,
      semester,
    ).filter((row) => isCurrent(row) && isEffectiveRecord(row) && row.id !== excludeRecordId);
    const key = meta.exclusiveGroup || (meta.singleton || COMPONENTS.has(meta.id) ? meta.id : null);
    if (key) {
      const same = current.some(
        (row) =>
          row.criterionId === meta.id ||
          (meta.exclusiveGroup &&
            criterionById(row.criterionId)?.exclusiveGroup === meta.exclusiveGroup),
      );
      const batchKey = `${studentId}|${semester}|${key}`;
      if (same || seen.has(batchKey))
        fail(
          'Tiêu chí đánh giá theo học kỳ hoặc nhóm đánh giá đã có khoản chính thức; không được cộng lặp.',
        );
      seen.add(batchKey);
    }
    const assessment = assessmentFor(studentId, semester);
    if (
      profile &&
      ((meta.component === 'gpa' && assessment.gpa !== null) ||
        (meta.component === 'compliance' && assessment.complianceConfirmed) ||
        (meta.component === 'offline' && assessment.offlineActivityCount !== null))
    )
      fail('Thành phần này đã được xác nhận trong hồ sơ học kỳ; không nhập thêm khoản trùng.');
  };
  const validateClaimEntry = (
    studentId,
    semester,
    entry,
    { activityId = null, excludeClaimId = null } = {},
  ) => {
    validateUniqueEntry(studentId, semester, entry);
    const claims = all(
      "SELECT * FROM claims WHERE studentId=? AND semester=? AND status IN ('pending','reviewed','matched')",
      studentId,
      semester,
    ).filter((claim) => isCurrent(claim) && claim.id !== excludeClaimId);
    if (
      activityId &&
      claims.some(
        (claim) => claim.activityId === activityId && claim.criterionId === entry.criterionId,
      )
    )
      fail('Hoạt động đã được kê khai; vui lòng kiểm tra lịch sử.');
    if (
      activityId &&
      all(
        'SELECT * FROM records WHERE studentId=? AND semester=? AND activityId=? AND criterionId=?',
        studentId,
        semester,
        activityId,
        entry.criterionId,
      ).some((row) => isCurrent(row) && isEffectiveRecord(row))
    )
      fail('Hoạt động đã có điểm chính thức, không cần kê khai lại.');
    const meta = criterionById(entry.criterionId);
    if (
      (meta.singleton || meta.exclusiveGroup || COMPONENTS.has(meta.id)) &&
      claims.some(
        (claim) =>
          ACTIVE.has(claim.status) &&
          !claim.officialRecordId &&
          (claim.criterionId === meta.id ||
            (meta.exclusiveGroup &&
              criterionById(claim.criterionId)?.exclusiveGroup === meta.exclusiveGroup)),
      )
    )
      fail('Đã có kê khai cho thành phần đánh giá này trong học kỳ.');
  };
  const normalizeRow = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail('Dòng dữ liệu phải là đối tượng.');
    const sourceId = required(input.sourceId, 'sourceId', 200),
      studentCode = required(input.studentCode, 'studentCode', 100);
    const student = one('SELECT * FROM students WHERE code=?', studentCode);
    if (!student) fail(`Không tìm thấy sinh viên ${studentCode}.`);
    const semester = required(input.semester, 'semester', 100);
    readSemester({ semester });
    const date = validDate(input.date),
      activityId = str(input.activityId, 100) || null;
    const activity = activityId ? one('SELECT * FROM activities WHERE id=?', activityId) : null;
    if (activityId && !activity) fail('Hoạt động không tồn tại.');
    if (activity && !isCurrent(activity)) {
      const linked = one(
        'SELECT * FROM records WHERE sourceId=? AND semester=?',
        sourceId,
        semester,
      );
      if (!isCurrent(linked) || linked.studentId !== student.id || linked.activityId !== activityId)
        fail('Hoạt động cũ cần được đối chiếu tiêu chí trước khi sử dụng.');
    }
    if (activity && activity.semester !== semester) fail('Học kỳ không khớp hoạt động.');
    const entry = checkedEntry({
      ...input,
      criterionId: str(input.criterionId) || activity?.criterionId,
      quantity: input.quantity ?? activity?.quantity,
    });
    if (
      activity &&
      isCurrent(activity) &&
      entry.categoryId !== 'bonus' &&
      (activity.criterionId !== entry.criterionId || activity.categoryId !== entry.categoryId)
    )
      fail('Tiêu chí hoặc mục điểm không khớp hoạt động.');
    const title = str(input.title) || activity?.title;
    if (!title) fail('Cần activityId hợp lệ hoặc tên hoạt động.');
    const row = {
      sourceId,
      studentCode,
      activityId,
      title,
      categoryId: entry.categoryId,
      points: entry.points,
      date,
      semester,
      criterionId: entry.criterionId,
      quantity: entry.quantity,
      approvalReference: entry.approvalReference,
      ruleVersion: RULE_VERSION,
    };
    return { row, canonical: canonicalFor(row), student, activity };
  };
  const inspectImport = (rows, actor) => {
    if (!Array.isArray(rows) || rows.length === 0) fail('Tệp phải có ít nhất một dòng dữ liệu.');
    if (rows.length > 5000) fail('Mỗi lần nhập tối đa 5.000 dòng.');
    const seen = new Map(),
      seenCriteria = new Set();
    const entries = rows.map((input, index) => {
      try {
        const normalized = normalizeRow(input);
        assertWritable(normalized.row.semester);
        assertStudentScope(actor, normalized.student.id, normalized.row.semester, true);
        const key = `${normalized.row.semester}|${normalized.row.sourceId}`;
        const stored = one(
          'SELECT canonical FROM records WHERE semester=? AND sourceId=?',
          normalized.row.semester,
          normalized.row.sourceId,
        );
        const existing = stored?.canonical ?? seen.get(key);
        let status = 'valid';
        if (existing) {
          if (existing !== normalized.canonical)
            fail(
              `sourceId ${normalized.row.sourceId} đã tồn tại với nội dung khác; không thể ghi đè điểm.`,
            );
          status = 'duplicate';
        }
        if (status === 'valid')
          validateUniqueEntry(normalized.student.id, normalized.row.semester, normalized.row, {
            seen: seenCriteria,
          });
        seen.set(key, normalized.canonical);
        return {
          index: index + 1,
          row: normalized.row,
          status,
          errors: [],
          studentName: normalized.student.name,
          activityTitle: normalized.activity?.title || normalized.row.title,
          normalized,
        };
      } catch (error) {
        return { index: index + 1, row: input, status: 'error', errors: [error.message] };
      }
    });
    return {
      entries,
      summary: {
        valid: entries.filter((row) => row.status === 'valid').length,
        duplicate: entries.filter((row) => row.status === 'duplicate').length,
        errors: entries.filter((row) => row.status === 'error').length,
      },
    };
  };
  const performMatch = (claim, record, actor) => {
    if (!claim || !record) fail('Không tìm thấy kê khai hoặc khoản điểm.', 404);
    if (!isEffectiveRecord(record))
      fail('Khoản điểm đã được thay thế, không đối soát lại nguồn cũ.', 409);
    assertWritable(claim.semester);
    assertWritable(record.semester);
    assertStudentScope(actor, claim.studentId, claim.semester, true);
    assertStudentScope(actor, record.studentId, record.semester, true);
    if (!isCurrent(claim) || !isCurrent(record))
      fail('Chỉ đối soát dữ liệu đã được xác định tiêu chí theo quy chế hiện tại.');
    if (claim.criterionId !== record.criterionId) fail('Kê khai và khoản điểm phải cùng tiêu chí.');
    if (!ACTIVE.has(claim.status) || claim.officialRecordId)
      fail('Kê khai đã đối soát hoặc bị từ chối.');
    if (recordClaimId(record.id)) fail('Khoản điểm chính thức đã được đối soát.');
    if (
      claim.studentId !== record.studentId ||
      claim.semester !== record.semester ||
      claim.categoryId !== record.categoryId
    )
      fail('Chỉ đối soát cùng sinh viên, học kỳ và mục điểm.');
    run("UPDATE claims SET status='matched',officialRecordId=? WHERE id=?", record.id, claim.id);
    workflows?.hooks.notifyStudent(
      claim.studentId,
      claim.semester,
      'claim_matched',
      'Kê khai đã được đối soát',
      claim.title,
      `match:${claim.id}:${record.id}`,
      'claim',
      claim.id,
    );
  };
  const catalogueView = () =>
    catalogue().map((period) => {
      const instant = Date.parse(now());
      return {
        ...period,
        canStaffWrite: period.state !== 'closed',
        canStudentWrite:
          period.state === 'open' &&
          (!period.startsAt || instant >= Date.parse(period.startsAt)) &&
          (!period.deadline || instant < Date.parse(period.deadline)),
      };
    });
  const historyFor = (id) =>
    all('SELECT payload FROM semester_history WHERE semesterId=? ORDER BY rowid', id).map((row) =>
      JSON.parse(row.payload),
    );
  const validatePeriod = (payload, previous = null) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      fail('Thông tin học kỳ không hợp lệ.');
    if (payload.state !== undefined && payload.state !== previous?.state)
      fail('Dùng thao tác chuyển trạng thái để tổng hợp, chốt hoặc mở lại.');
    const id = previous?.id || required(payload.id, 'mã học kỳ', 100);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(id) && !previous)
      fail('Mã học kỳ chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch nối.');
    if (previous && payload.id !== undefined && payload.id !== id)
      fail('Không được đổi mã học kỳ.');
    const academicYear = str(payload.academicYear ?? previous?.academicYear);
    const parsed = /^(\d{4})-(\d{4})$/.exec(academicYear);
    if (
      !parsed ||
      Number(parsed[1]) < 1900 ||
      Number(parsed[2]) > 2201 ||
      Number(parsed[2]) !== Number(parsed[1]) + 1
    )
      fail('Năm học phải gồm hai năm liên tiếp dạng YYYY-YYYY.');
    const term = numeric(payload.term ?? previous?.term, 'Thứ tự học kỳ');
    if (!Number.isInteger(term) || term < 1 || term > 20)
      fail('Thứ tự học kỳ phải là số nguyên từ 1 đến 20.');
    if (
      previous?.metadataVerified !== false &&
      previous &&
      (academicYear !== previous.academicYear || term !== previous.term)
    )
      fail('Không được đổi năm học hoặc thứ tự học kỳ đã xác định.');
    const timestamp = (value, label) => {
      if (value === null || value === undefined || value === '') return null;
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      )
        fail(`${label} phải là thời điểm ISO có múi giờ.`);
      validDate(value.slice(0, 10));
      const instant = new Date(value);
      if (!Number.isFinite(instant.getTime())) fail(`${label} không hợp lệ.`);
      return instant.toISOString();
    };
    const startsAt = timestamp(
      payload.startsAt === undefined ? previous?.startsAt : payload.startsAt,
      'Thời điểm mở kê khai',
    );
    const deadline = timestamp(
      payload.deadline === undefined ? previous?.deadline : payload.deadline,
      'Hạn kê khai',
    );
    if (startsAt && deadline && startsAt >= deadline)
      fail('Hạn kê khai phải sau thời điểm mở kê khai.');
    const flag = (key, fallback) => {
      const value = payload[key] ?? previous?.[key] ?? fallback;
      if (typeof value !== 'boolean') fail(`${key} phải là giá trị đúng/sai.`);
      return value;
    };
    const annualIncluded = flag('annualIncluded', [1, 2].includes(term));
    const courseIncluded = flag('courseIncluded', [1, 2].includes(term));
    if (term > 2 && (annualIncluded || courseIncluded))
      fail('Học kỳ bổ sung không tự trở thành một trong hai học kỳ chính để tính năm/toàn khóa.');
    const peers = catalogue().filter((row) => row.id !== id && row.academicYear === academicYear);
    if (peers.some((row) => row.term === term)) fail('Năm học đã có học kỳ với thứ tự này.');
    if (annualIncluded && peers.filter((row) => row.annualIncluded).length >= 2)
      fail('Một năm học chỉ có hai học kỳ dùng tính điểm năm.');
    if (courseIncluded && peers.filter((row) => row.courseIncluded).length >= 2)
      fail('Một năm học chỉ có hai học kỳ chính thuộc khung toàn khóa.');
    return {
      id,
      name: required(payload.name ?? previous?.name ?? id, 'tên học kỳ', 200),
      academicYear,
      term,
      startsAt,
      deadline,
      annualIncluded,
      courseIncluded,
      state: previous?.state || 'open',
      metadataVerified: true,
      createdAt: previous?.createdAt || now(),
      updatedAt: now(),
    };
  };
  const savePeriod = (period) =>
    run(
      'INSERT INTO semesters(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      period.id,
      JSON.stringify(period),
    );
  const historyEvent = (
    actor,
    id,
    fromState,
    toState,
    reason,
    snapshotId = null,
    changes = null,
  ) => {
    const event = {
      id: makeId('period-event'),
      semesterId: id,
      actorId: actor.id,
      actorName: actor.name,
      fromState,
      toState,
      reason,
      createdAt: now(),
      snapshotId,
      changes,
    };
    run(
      'INSERT INTO semester_history(id,semesterId,payload) VALUES(?,?,?)',
      event.id,
      id,
      JSON.stringify(event),
    );
    addAudit(actor, 'Quản lý học kỳ', JSON.stringify(event));
    return event;
  };
  const snapshotMeta = (snapshot) => {
    const {
      id,
      version,
      semesterId,
      createdAt,
      actorId,
      actorName,
      reason,
      incompleteCount,
      completeness,
      checksum,
    } = snapshot;
    return {
      id,
      version,
      semesterId,
      createdAt,
      actorId,
      actorName,
      reason,
      incompleteCount,
      completeness,
      checksum,
    };
  };
  const rosterRows = (semester) => {
    const snapshot = frozen(semester);
    if (snapshot)
      return snapshot.students.map((student) => {
        const saved = snapshot.raw.enrollments?.find((row) => row.studentId === student.id);
        const legacy = enrollmentFor(student.id, semester);
        return {
          ...saved,
          id: student.id,
          studentId: student.id,
          code: student.code,
          name: student.name,
          email: student.email,
          semester,
          classId: student.classId && student.classId !== 'unassigned' ? student.classId : null,
          className: student.className || '',
          faculty: student.faculty || '',
          cohortYear: student.cohortYear ?? null,
          sourceId: saved?.sourceId || legacy?.sourceId || `snapshot:${snapshot.id}:${student.id}`,
          approvalReference:
            saved?.approvalReference || legacy?.approvalReference || 'Danh sách từ bản chốt học kỳ',
          updatedAt: saved?.updatedAt || snapshot.createdAt,
        };
      });
    return all(
      'SELECT s.id,s.code,s.name,s.email,e.* FROM enrollments e JOIN students s ON s.id=e.studentId WHERE e.semester=? ORDER BY s.code',
      semester,
    );
  };
  const decorateAssignment = (row) =>
    row
      ? {
          ...row,
          className: one('SELECT name FROM classes WHERE id=?', row.classId)?.name || row.classId,
          lecturerName: one('SELECT name FROM users WHERE id=?', row.lecturerId)?.name || '',
          lecturerEmail: one('SELECT email FROM users WHERE id=?', row.lecturerId)?.email || '',
        }
      : null;
  const inspectRoster = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000)
      fail('Danh sách cần từ 1 đến 5.000 dòng.');
    const seenSources = new Map(),
      seenStudents = new Map(),
      seenEmails = new Map(),
      seenClasses = new Map(),
      seenMemberships = new Set();
    const entries = rows.map((input, index) => {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          fail('Dòng danh sách không hợp lệ.');
        const row = {
          sourceId: required(input.sourceId, 'mã nguồn danh sách', 200),
          studentCode: required(input.studentCode, 'MSSV', 100),
          name: required(input.name, 'họ tên', 200),
          email: required(input.email, 'email', 300).toLowerCase(),
          classId: required(input.classId, 'mã lớp', 100),
          className: required(input.className, 'tên lớp', 200),
          faculty: str(input.faculty, 200),
          cohortYear:
            input.cohortYear === null || input.cohortYear === undefined || input.cohortYear === ''
              ? null
              : numeric(input.cohortYear, 'Năm tuyển sinh'),
          semester: required(input.semester, 'học kỳ', 100),
          approvalReference: str(input.approvalReference, 1000),
        };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) fail('Email sinh viên không hợp lệ.');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(row.classId))
          fail('Mã lớp chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch nối.');
        if (
          row.cohortYear !== null &&
          (!Number.isInteger(row.cohortYear) || row.cohortYear < 1900 || row.cohortYear > 2200)
        )
          fail(
            'Năm tuyển sinh phải là số nguyên từ 1900 đến 2200 hoặc để trống nếu chưa xác định.',
          );
        readSemester(row);
        assertWritable(row.semester);
        const byCode = one('SELECT * FROM students WHERE code=?', row.studentCode);
        const byEmail = one('SELECT * FROM students WHERE lower(email)=?', row.email);
        if (byCode && byCode.email.toLowerCase() !== row.email)
          fail('MSSV đã gắn email khác. Không tự đổi hoặc hợp nhất danh tính.');
        if (byEmail && byEmail.code !== row.studentCode)
          fail('Email đã gắn MSSV khác. Cần đối chiếu danh tính, không tự liên kết.');
        if (
          !byCode &&
          one('SELECT id FROM users WHERE lower(email)=? AND studentId IS NULL', row.email)
        )
          fail(
            'Email đã có tài khoản nhưng chưa liên kết hồ sơ; cần đối chiếu danh tính trước khi nhập.',
          );
        const prior = seenStudents.get(row.studentCode),
          priorEmail = seenEmails.get(row.email);
        if ((prior && prior.email !== row.email) || (priorEmail && priorEmail !== row.studentCode))
          fail('Danh sách chứa MSSV/email xung đột.');
        const existingClass = one('SELECT name FROM classes WHERE id=?', row.classId)?.name;
        if (
          (existingClass && existingClass !== row.className) ||
          (seenClasses.has(row.classId) && seenClasses.get(row.classId) !== row.className)
        )
          fail('Mã lớp đã có tên khác. Không tự đổi tên lớp trong lịch sử.');
        const canonical = JSON.stringify(row),
          sourceKey = `${row.semester}|${row.sourceId}`;
        const stored =
          one(
            'SELECT canonical FROM roster_sources WHERE semester=? AND sourceId=?',
            row.semester,
            row.sourceId,
          )?.canonical ?? seenSources.get(sourceKey);
        if (stored && stored !== canonical)
          fail(
            'Mã nguồn danh sách đã tồn tại với nội dung khác. Dùng nguồn điều chỉnh mới và lý do, không ghi đè nguồn cũ.',
          );
        const status = stored ? 'duplicate' : 'valid';
        const membershipKey = `${row.semester}|${row.studentCode}`;
        if (status === 'valid' && seenMemberships.has(membershipKey))
          fail('Một đợt nhập không được chứa nhiều thay đổi cho cùng sinh viên và học kỳ.');
        if (status === 'valid') seenMemberships.add(membershipKey);
        seenSources.set(sourceKey, canonical);
        seenStudents.set(row.studentCode, row);
        seenEmails.set(row.email, row.studentCode);
        seenClasses.set(row.classId, row.className);
        return {
          index: index + 1,
          row,
          status,
          errors: [],
          normalized: { row, canonical, studentId: byCode?.id || null },
        };
      } catch (error) {
        return { index: index + 1, row: input, status: 'error', errors: [error.message] };
      }
    });
    return {
      entries,
      summary: {
        valid: entries.filter((row) => row.status === 'valid').length,
        duplicate: entries.filter((row) => row.status === 'duplicate').length,
        errors: entries.filter((row) => row.status === 'error').length,
      },
    };
  };
  const writeRoster = (actor, { rows, batchName, reason }) => {
    const justification = required(reason, 'lý do nhập hoặc điều chỉnh danh sách', 2000);
    const { entries, summary } = inspectRoster(rows);
    if (summary.errors)
      fail(
        `Không nhập danh sách: ${summary.errors} dòng lỗi. ${entries.find((row) => row.status === 'error').errors[0]}`,
      );
    if (!summary.valid)
      return { inserted: 0, updated: 0, skipped: summary.duplicate, batchId: null };
    const batchId = makeId('roster-batch');
    run(
      'INSERT INTO roster_batches(id,name,actorId,actorName,reason,createdAt,rowCount) VALUES(?,?,?,?,?,?,?)',
      batchId,
      str(batchName, 300) || 'Nhập danh sách học kỳ',
      actor.id,
      actor.name,
      justification,
      now(),
      summary.valid,
    );
    let inserted = 0,
      updated = 0;
    for (const entry of entries.filter((row) => row.status === 'valid')) {
      const { row, canonical } = entry.normalized;
      let studentId =
        entry.normalized.studentId ||
        one('SELECT id FROM students WHERE code=?', row.studentCode)?.id;
      if (!studentId) {
        studentId = makeId('student');
        run(
          'INSERT INTO students(id,code,name,email,classId) VALUES(?,?,?,?,NULL)',
          studentId,
          row.studentCode,
          row.name,
          row.email,
        );
      }
      run('INSERT OR IGNORE INTO classes(id,name) VALUES(?,?)', row.classId, row.className);
      const before = enrollmentFor(studentId, row.semester) || null;
      const after = {
        studentId,
        semester: row.semester,
        classId: row.classId,
        className: row.className,
        faculty: row.faculty,
        cohortYear: row.cohortYear,
        sourceId: row.sourceId,
        approvalReference: row.approvalReference,
        updatedAt: now(),
      };
      run(
        'INSERT INTO enrollments(studentId,semester,classId,className,faculty,cohortYear,sourceId,approvalReference,updatedAt) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(studentId,semester) DO UPDATE SET classId=excluded.classId,className=excluded.className,faculty=excluded.faculty,cohortYear=excluded.cohortYear,sourceId=excluded.sourceId,approvalReference=excluded.approvalReference,updatedAt=excluded.updatedAt',
        ...Object.values(after),
      );
      const event = {
        id: makeId('enrollment-history'),
        action: before ? 'update' : 'enroll',
        studentId,
        semester: row.semester,
        actorId: actor.id,
        actorName: actor.name,
        createdAt: now(),
        reason: justification,
        batchId,
        before,
        after,
      };
      run(
        'INSERT INTO enrollment_history(id,studentId,semester,payload) VALUES(?,?,?,?)',
        event.id,
        studentId,
        row.semester,
        JSON.stringify(event),
      );
      if (before && before.classId !== after.classId)
        workflows?.hooks.markEvidenceChanged(
          studentId,
          row.semester,
          'Lớp của sinh viên đã thay đổi; cần kiểm tra lại người nhận minh chứng.',
        );
      run(
        'INSERT INTO roster_sources(id,semester,sourceId,studentId,canonical,batchId,createdAt) VALUES(?,?,?,?,?,?,?)',
        makeId('roster-source'),
        row.semester,
        row.sourceId,
        studentId,
        canonical,
        batchId,
        now(),
      );
      if (before) updated++;
      else inserted++;
    }
    addAudit(
      actor,
      'Nhập danh sách học kỳ',
      JSON.stringify({
        batchId,
        reason: justification,
        inserted,
        updated,
        skipped: summary.duplicate,
      }),
    );
    return { inserted, updated, skipped: summary.duplicate, batchId };
  };
  const store = {
    access(user) {
      return accessFor(authorize(user));
    },
    roster(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      let students = rosterRows(semester).filter((row) =>
        canReadStudent(actor, row.studentId, semester),
      );
      if (filters.classId) students = students.filter((row) => row.classId === filters.classId);
      if (filters.faculty) students = students.filter((row) => row.faculty === filters.faculty);
      if (filters.cohortYear)
        students = students.filter((row) => Number(row.cohortYear) === Number(filters.cohortYear));
      const query = str(filters.q).toLocaleLowerCase('vi');
      if (query)
        students = students.filter((row) =>
          `${row.code} ${row.name} ${row.email}`.toLocaleLowerCase('vi').includes(query),
        );
      const knownIds = new Set(rosterRows(semester).map((row) => row.studentId));
      return {
        students,
        classes: visibleClasses(actor, semester),
        faculties: [...new Set(students.map((row) => row.faculty).filter(Boolean))],
        cohorts: [
          ...new Set(students.map((row) => row.cohortYear).filter((year) => year !== null)),
        ].sort(),
        ...(isCoordinator(actor) && !frozen(semester)
          ? {
              unenrolledStudents: all(
                'SELECT id,code,name,email FROM students ORDER BY code',
              ).filter((row) => !knownIds.has(row.id)),
            }
          : {}),
        semester,
        access: accessFor(actor),
      };
    },
    lecturers(user) {
      coordinator(user);
      return {
        lecturers: all("SELECT * FROM users WHERE role='LECTURER' ORDER BY name,email").map(
          publicUser,
        ),
      };
    },
    assignments(user, filters = {}) {
      const actor = authorize(user, true),
        semester = readSemester(filters);
      const assignments = all(
        `SELECT * FROM lecturer_assignments WHERE semester=? ${isCoordinator(actor) ? '' : 'AND lecturerId=?'} ORDER BY createdAt,id`,
        semester,
        ...(isCoordinator(actor) ? [] : [actor.id]),
      ).map(decorateAssignment);
      return {
        assignments,
        classes: visibleClasses(actor, semester),
        ...(isCoordinator(actor) ? { lecturers: store.lecturers(actor).lecturers } : {}),
        semester,
        access: accessFor(actor),
      };
    },
    assignLecturer(user, payload = {}) {
      const actor = coordinator(user),
        semester = readSemester(payload),
        reason = required(payload.reason, 'lý do phân công', 2000);
      return transaction(() => {
        const lecturerId = required(payload.lecturerId, 'giảng viên'),
          classId = required(payload.classId, 'lớp');
        const lecturer = one("SELECT * FROM users WHERE id=? AND role='LECTURER'", lecturerId);
        if (!lecturer)
          fail('Tài khoản giảng viên không tồn tại hoặc không còn vai trò giảng viên.');
        if (
          !one(
            'SELECT studentId FROM enrollments WHERE semester=? AND classId=? LIMIT 1',
            semester,
            classId,
          )
        )
          fail('Lớp chưa có trong danh sách của học kỳ này.');
        if (
          one(
            'SELECT id FROM lecturer_assignments WHERE lecturerId=? AND classId=? AND semester=? AND revokedAt IS NULL',
            lecturerId,
            classId,
            semester,
          )
        )
          fail('Phân công này đang có hiệu lực.', 409);
        const id = makeId('assignment');
        run(
          'INSERT INTO lecturer_assignments(id,lecturerId,classId,semester,createdAt,actorId,actorName,reason) VALUES(?,?,?,?,?,?,?,?)',
          id,
          lecturerId,
          classId,
          semester,
          now(),
          actor.id,
          actor.name,
          reason,
        );
        const assignment = decorateAssignment(
          one('SELECT * FROM lecturer_assignments WHERE id=?', id),
        );
        addAudit(actor, 'Phân công giảng viên', JSON.stringify(assignment));
        for (const row of all(
          'SELECT studentId FROM enrollments WHERE semester=? AND classId=?',
          semester,
          classId,
        ))
          workflows?.hooks.markEvidenceChanged(
            row.studentId,
            semester,
            'Phân công giảng viên của lớp đã thay đổi; chủ tệp cần kiểm tra chia sẻ minh chứng.',
          );
        return { assignment };
      });
    },
    revokeAssignment(user, id, payload = {}) {
      const actor = coordinator(user),
        reason = required(payload.reason, 'lý do thu hồi phân công', 2000);
      return transaction(() => {
        const before = one(
          'SELECT * FROM lecturer_assignments WHERE id=?',
          required(id, 'mã phân công'),
        );
        if (!before) fail('Phân công không tồn tại.', 404);
        if (before.revokedAt) fail('Phân công đã được thu hồi.', 409);
        run(
          'UPDATE lecturer_assignments SET revokedAt=?,revokedBy=?,revokeReason=? WHERE id=?',
          now(),
          actor.id,
          reason,
          before.id,
        );
        const assignment = decorateAssignment(
          one('SELECT * FROM lecturer_assignments WHERE id=?', before.id),
        );
        addAudit(actor, 'Thu hồi phân công', JSON.stringify({ before, after: assignment }));
        for (const row of all(
          'SELECT studentId FROM enrollments WHERE semester=? AND classId=?',
          before.semester,
          before.classId,
        ))
          workflows?.hooks.markEvidenceChanged(
            row.studentId,
            before.semester,
            'Phân công giảng viên đã được thu hồi; chủ tệp cần kiểm tra quyền Drive đã cấp.',
          );
        return { assignment };
      });
    },
    previewRoster(user, rows) {
      coordinator(user);
      const { entries, summary } = inspectRoster(rows);
      return { rows: entries.map(({ normalized, ...entry }) => entry), summary };
    },
    commitRoster(user, payload = {}) {
      const actor = coordinator(user);
      return transaction(() => writeRoster(actor, payload));
    },
    copyRoster(user, payload = {}) {
      const actor = coordinator(user),
        fromSemester = readSemester({ semester: payload.fromSemester }),
        toSemester = readSemester({ semester: payload.toSemester });
      if (fromSemester === toSemester) fail('Kỳ nguồn và kỳ đích không được trùng nhau.');
      const reason = required(payload.reason, 'lý do sao chép danh sách', 2000);
      return transaction(() => {
        assertWritable(toSemester);
        if (one('SELECT studentId FROM enrollments WHERE semester=? LIMIT 1', toSemester))
          fail(
            'Kỳ đích đã có danh sách. Chỉ sao chép vào kỳ trống; hãy nhập từng thay đổi có nguồn và lý do để điều chỉnh danh sách hiện có.',
            409,
          );
        const sourceRows = rosterRows(fromSemester);
        if (!sourceRows.length) fail('Kỳ nguồn chưa có danh sách.');
        const rows = sourceRows
          .filter((row) => row.classId)
          .map((row) => ({
            sourceId: `copy:${fromSemester}:${row.studentId}:${randomUUID()}`,
            studentCode: row.code,
            name: row.name,
            email: row.email,
            classId: row.classId,
            className: row.className,
            faculty: row.faculty,
            cohortYear: row.cohortYear,
            semester: toSemester,
            approvalReference: `Sao chép từ ${fromSemester}; nguồn ${row.sourceId}`,
          }));
        if (rows.length !== sourceRows.length)
          fail(
            'Kỳ nguồn còn sinh viên chưa phân lớp; cần nhập danh sách rõ lớp thay vì tự suy đoán.',
          );
        return writeRoster(actor, {
          rows,
          reason,
          batchName: `Sao chép danh sách ${fromSemester} → ${toSemester}`,
        });
      });
    },
    rosterHistory(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      const snapshot = frozen(semester);
      const history = (
        snapshot?.raw.enrollmentHistory ||
        all(
          'SELECT studentId,payload FROM enrollment_history WHERE semester=? ORDER BY rowid',
          semester,
        )
      )
        .filter(
          (row) =>
            (!filters.studentId || row.studentId === filters.studentId) &&
            canReadStudent(actor, row.studentId, semester),
        )
        .map((row) => JSON.parse(row.payload))
        .filter(
          (event) =>
            actor.role === 'STUDENT' ||
            isCoordinator(actor) ||
            assignedClass(actor, event.after?.classId, semester),
        )
        .map((event) =>
          actor.role === 'LECTURER' &&
          !isCoordinator(actor) &&
          event.before &&
          !assignedClass(actor, event.before.classId, semester)
            ? { ...event, before: null, beforeRedacted: true }
            : event,
        );
      return { history, semester };
    },
    evidenceRecipients(user, payload = {}) {
      const actor = authorize(user);
      const context = payload.evidenceId
        ? workflows.hooks.repairEvidenceContext(actor, payload)
        : workflows.hooks.evidenceScope(actor, payload);
      const { semester, studentId } = context;
      const enrollment = enrollmentFor(studentId, semester);
      const assigned = all(
        "SELECT u.email FROM lecturer_assignments a JOIN users u ON u.id=a.lecturerId WHERE a.semester=? AND a.classId=? AND a.revokedAt IS NULL AND u.role='LECTURER'",
        semester,
        enrollment.classId,
      );
      const managers = all("SELECT * FROM users WHERE role='LECTURER'")
        .filter((row) => isCoordinator(publicUser(row)))
        .map((row) => ({ email: row.email }));
      return {
        emails: [...new Set([...assigned, ...managers].map((row) => row.email.toLowerCase()))],
        ...context,
      };
    },
    listSemesters(user) {
      const actor = authorize(user);
      return {
        semesters: catalogueView().map((period) => ({
          ...period,
          canStaffWrite:
            actor.role === 'LECTURER' &&
            period.canStaffWrite &&
            (isCoordinator(actor) ||
              !!one(
                'SELECT id FROM lecturer_assignments WHERE lecturerId=? AND semester=? AND revokedAt IS NULL LIMIT 1',
                actor.id,
                period.id,
              )),
          canStudentWrite:
            period.canStudentWrite &&
            (actor.role !== 'STUDENT' || !!enrollmentFor(actor.studentId, period.id)),
        })),
        academicYears: settings().academicYears,
        serverTime: now(),
      };
    },
    createSemester(user, payload = {}) {
      const actor = coordinator(user);
      return transaction(() => {
        const period = validatePeriod(payload);
        if (semesterRow(period.id)) fail('Mã học kỳ đã tồn tại.', 409);
        savePeriod(period);
        historyEvent(actor, period.id, null, 'open', 'Tạo học kỳ', null, { after: period });
        return { semester: catalogueView().find((row) => row.id === period.id) };
      });
    },
    updateSemester(user, id, payload = {}) {
      const actor = coordinator(user);
      return transaction(() => {
        const before = semesterRow(required(id, 'mã học kỳ'));
        if (!before) fail('Học kỳ không tồn tại.', 404);
        assertWritable(id);
        const period = validatePeriod(payload, before);
        savePeriod(period);
        historyEvent(
          actor,
          id,
          before.state,
          period.state,
          str(payload.reason, 2000) || 'Cập nhật cấu hình học kỳ',
          null,
          { before, after: period },
        );
        return { semester: catalogueView().find((row) => row.id === id) };
      });
    },
    transitionSemester(user, id, payload = {}) {
      const actor = coordinator(user);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        fail('Thao tác học kỳ không hợp lệ.');
      return transaction(() => {
        const period = semesterRow(required(id, 'mã học kỳ'));
        if (!period) fail('Học kỳ không tồn tại.', 404);
        const action = payload.action;
        const transitions = { review: 'review', close: 'closed', reopen: 'open' };
        if (typeof action !== 'string' || !Object.hasOwn(transitions, action))
          fail('Thao tác học kỳ không hợp lệ.', 409);
        const target = transitions[action];
        if (
          !target ||
          (action === 'review' && period.state !== 'open') ||
          (action === 'close' && period.state === 'closed') ||
          (action === 'reopen' && period.state !== 'closed')
        )
          fail('Chuyển trạng thái học kỳ không hợp lệ.', 409);
        const reason = required(payload.reason, 'lý do thao tác học kỳ', 2000);
        const beforeState = period.state;
        let snapshot = null;
        if (action === 'close') {
          const students = summaries(actor, { semester: id });
          const completeness = {
            noData: students.filter((row) => row.evaluationStatus === 'no_data').length,
            incomplete: students.filter((row) => row.evaluationStatus === 'incomplete').length,
            notEvaluated: students.filter((row) => row.evaluationStatus === 'not_evaluated').length,
            unresolvedClaims: students.reduce((sum, row) => sum + row.pendingCount, 0),
            legacyRows: students.reduce((sum, row) => sum + row.legacyCount, 0),
            unresolvedAppeals: Number(
              one(
                "SELECT COUNT(*) count FROM appeals WHERE semester=? AND status IN ('pending','needs_info')",
                id,
              ).count,
            ),
            evidenceSharingIncomplete: all(
              'SELECT payload FROM evidence WHERE semester=?',
              id,
            ).filter((row) => JSON.parse(row.payload).sharingComplete !== true).length,
          };
          const pendingWorkflowStudents = new Set([
            ...all(
              "SELECT studentId FROM appeals WHERE semester=? AND status IN ('pending','needs_info')",
              id,
            ).map((row) => row.studentId),
            ...all('SELECT studentId,payload FROM evidence WHERE semester=?', id)
              .filter((row) => JSON.parse(row.payload).sharingComplete !== true)
              .map((row) => row.studentId),
          ]);
          const incompleteCount = students.filter(
            (row) =>
              ['no_data', 'incomplete'].includes(row.evaluationStatus) ||
              row.pendingCount ||
              row.legacyCount ||
              pendingWorkflowStudents.has(row.id),
          ).length;
          if (
            (incompleteCount ||
              completeness.unresolvedAppeals ||
              completeness.evidenceSharingIncomplete) &&
            payload.acknowledgeIncomplete !== true
          )
            fail(
              `Còn ${incompleteCount} hồ sơ cần kiểm tra, ${completeness.unresolvedAppeals} phúc tra và ${completeness.evidenceSharingIncomplete} minh chứng chưa hoàn tất. Phải xác nhận rõ khi chốt.`,
              409,
            );
          const snapshotId = makeId('semester-snapshot');
          const version =
            Number(
              one('SELECT MAX(version) version FROM semester_snapshots WHERE semesterId=?', id)
                .version || 0,
            ) + 1;
          const digest = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');
          snapshot = {
            id: snapshotId,
            semesterId: id,
            version,
            createdAt: now(),
            actorId: actor.id,
            actorName: actor.name,
            reason,
            incompleteCount,
            completeness,
            semester: { ...period, state: 'closed' },
            rules: {
              ...settings(),
              implementationSha256: digest(new URL('./regulations.mjs', import.meta.url)),
              storeImplementationSha256: digest(new URL('./store.mjs', import.meta.url)),
              workflowImplementationSha256: digest(new URL('./workflows.mjs', import.meta.url)),
              sourcePdfSha256: digest(
                new URL('../docs/quy-che-ren-luyen-tdtu.pdf', import.meta.url),
              ),
            },
            students: students.map((row) => ({
              ...row,
              publishedTotal: row.evaluationStatus === 'evaluated' ? row.officialTotal : null,
              snapshotId,
              snapshotVersion: version,
              closedAt: now(),
            })),
            classes: classList(id),
            raw: {
              students: all('SELECT * FROM students ORDER BY code'),
              classes: all('SELECT * FROM classes ORDER BY id'),
              activities: all('SELECT * FROM activities WHERE semester=? ORDER BY id', id),
              records: all('SELECT * FROM records WHERE semester=? ORDER BY id', id),
              recordReplacements: all(
                'SELECT p.* FROM record_replacements p JOIN records r ON r.id=p.originalId WHERE r.semester=? ORDER BY p.originalId',
                id,
              ),
              appeals: all('SELECT * FROM appeals WHERE semester=? ORDER BY id', id),
              appealEvents: all(
                'SELECT e.* FROM appeal_events e JOIN appeals a ON a.id=e.appealId WHERE a.semester=? ORDER BY e.rowid',
                id,
              ),
              adjustments: all('SELECT * FROM adjustments WHERE semester=? ORDER BY id', id),
              evidence: all('SELECT * FROM evidence WHERE semester=? ORDER BY id', id),
              evidenceEvents: all(
                'SELECT e.* FROM evidence_events e JOIN evidence f ON f.id=e.evidenceId WHERE f.semester=? ORDER BY e.rowid',
                id,
              ),
              claims: all('SELECT * FROM claims WHERE semester=? ORDER BY id', id),
              assessments: all('SELECT * FROM assessments WHERE semester=? ORDER BY studentId', id),
              batches: all(
                'SELECT * FROM batches WHERE id IN (SELECT batchId FROM records WHERE semester=?) ORDER BY id',
                id,
              ),
              enrollments: all('SELECT * FROM enrollments WHERE semester=? ORDER BY studentId', id),
              assignments: all(
                'SELECT * FROM lecturer_assignments WHERE semester=? ORDER BY createdAt,id',
                id,
              ),
              rosterSources: all('SELECT * FROM roster_sources WHERE semester=? ORDER BY id', id),
              enrollmentHistory: all(
                'SELECT * FROM enrollment_history WHERE semester=? ORDER BY rowid',
                id,
              ),
            },
            views: {
              activities: activityList(id),
              records: recordsFor(null, id),
              claims: claimsFor(null, id),
              assessments: students.map((row) => ({
                studentId: row.id,
                assessment: assessmentFor(row.id, id),
              })),
            },
          };
          historyEvent(actor, id, beforeState, target, reason, snapshotId);
          snapshot.history = historyFor(id);
          snapshot.checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          run(
            'INSERT INTO semester_snapshots(id,semesterId,version,payload) VALUES(?,?,?,?)',
            snapshotId,
            id,
            version,
            JSON.stringify(snapshot),
          );
        } else historyEvent(actor, id, beforeState, target, reason);
        savePeriod({ ...period, state: target, updatedAt: now() });
        for (const row of all('SELECT studentId FROM enrollments WHERE semester=?', id))
          workflows?.hooks.notifyStudent(
            row.studentId,
            id,
            'semester_status',
            target === 'closed'
              ? 'Học kỳ đã chốt kết quả'
              : target === 'open'
                ? 'Học kỳ đã mở lại'
                : 'Học kỳ chuyển sang tổng hợp',
            reason,
            `semester:${id}:${target}:${now()}:${reason}`,
            'semester',
            id,
          );
        return {
          semester: catalogueView().find((row) => row.id === id),
          ...(snapshot ? { snapshot: snapshotMeta(snapshot) } : {}),
        };
      });
    },
    semesterSnapshots(user, id) {
      coordinator(user);
      if (!semesterRow(required(id, 'mã học kỳ'))) fail('Học kỳ không tồn tại.', 404);
      return {
        snapshots: all(
          'SELECT payload FROM semester_snapshots WHERE semesterId=? ORDER BY version DESC',
          id,
        ).map((row) => snapshotMeta(JSON.parse(row.payload))),
        history: historyFor(id),
      };
    },
    semesterSnapshot(user, id, snapshotId) {
      coordinator(user);
      const row = one(
        'SELECT payload FROM semester_snapshots WHERE semesterId=? AND id=?',
        str(id),
        str(snapshotId),
      );
      if (!row) fail('Bản chốt không tồn tại.', 404);
      return { snapshot: JSON.parse(row.payload) };
    },
    getSettings() {
      return settings();
    },
    getUser(id) {
      return publicUser(one('SELECT * FROM users WHERE id=?', str(id, 200)));
    },
    getDemoUsers() {
      return ['demo-lecturer', 'demo-student', 'demo-student-2'].map((id) =>
        publicUser(one('SELECT * FROM users WHERE id=?', id)),
      );
    },
    ensureGoogleUser({ sub, email, name, role = 'STUDENT', authAudience = 'internal' }) {
      const subject = required(sub, 'Google sub', 200);
      const address = required(email, 'email', 300).toLowerCase();
      const audience = String(authAudience).trim().toLowerCase();
      if (!['internal', 'external'].includes(audience)) fail('Chế độ đăng nhập không hợp lệ.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) fail('Email Google không hợp lệ.');
      if (
        audience === 'internal' &&
        !/^[^@\s]+@(student\.tdtu\.edu\.vn|tdtu\.edu\.vn)$/.test(address)
      )
        fail('Chỉ chấp nhận tài khoản Google của TDTU.', 403);
      if (!['STUDENT', 'LECTURER'].includes(role)) fail('Vai trò không hợp lệ.');
      return transaction(() => {
        const bySub = one('SELECT * FROM users WHERE googleSub=?', subject);
        const byEmail = one('SELECT * FROM users WHERE email=?', address);
        if (bySub && bySub.email !== address)
          fail('Định danh Google đã liên kết tài khoản khác.', 403);
        if (byEmail?.googleSub && byEmail.googleSub !== subject)
          fail('Email đã liên kết một định danh Google khác.', 403);
        const existing = bySub || byEmail;
        // Keep the same score profile across role changes; a former lecturer may not have one yet.
        let student = existing?.studentId
          ? studentRow(existing.studentId)
          : one('SELECT * FROM students WHERE email=?', address);
        if (!student && role === 'STUDENT') {
          const id = makeId('student');
          let code = address.split('@')[0].toUpperCase().slice(0, 60);
          if (one('SELECT id FROM students WHERE code=?', code))
            code = `NEW-${randomUUID().slice(0, 8).toUpperCase()}`;
          run(
            'INSERT INTO students(id,code,name,email,classId) VALUES(?,?,?,?,NULL)',
            id,
            code,
            str(name) || code,
            address,
          );
          student = studentRow(id);
        }
        if (existing) {
          const displayName = str(name) || existing.name;
          run(
            'UPDATE users SET name=?,role=?,studentId=?,googleSub=?,provider=? WHERE id=?',
            displayName,
            role,
            existing.studentId || student?.id || null,
            subject,
            'google',
            existing.id,
          );
          syncStudentName(existing.studentId || student?.id, displayName);
          return publicUser(one('SELECT * FROM users WHERE id=?', existing.id));
        }
        const id = makeId('user');
        const displayName = str(name) || student?.name || address.split('@')[0];
        syncStudentName(student?.id, displayName);
        run(
          'INSERT INTO users(id,name,email,role,studentId,provider,googleSub) VALUES(?,?,?,?,?,?,?)',
          id,
          displayName,
          address,
          role,
          student?.id || null,
          'google',
          subject,
        );
        return publicUser(one('SELECT * FROM users WHERE id=?', id));
      });
    },
    getAssessment(user, studentId, filters = {}) {
      const actor = authorize(user),
        id = required(studentId, 'sinh viên'),
        semester = readSemester(filters);
      if (actor.role === 'STUDENT' && id !== actor.studentId)
        fail('Sinh viên chỉ được xem hồ sơ của chính mình.', 403);
      const student = studentRow(id);
      if (!student) fail('Sinh viên không tồn tại.', 404);
      assertStudentScope(actor, id, semester);
      return {
        studentId: id,
        assessment: assessmentFor(id, semester),
        student: summarize(student, semester),
      };
    },
    saveAssessment(user, studentId, payload = {}) {
      const actor = authorize(user, true),
        id = required(studentId, 'sinh viên');
      if (!studentRow(id)) fail('Sinh viên không tồn tại.', 404);
      const semester = readSemester(payload),
        previous = assessmentFor(id, semester);
      assertStudentScope(actor, id, semester, true);
      const profile = validateAssessment(payload, previous);
      return transaction(() => {
        assertWritable(semester, actor);
        assertStudentScope(actor, id, semester, true);
        const entries = all(
          'SELECT * FROM records WHERE studentId=? AND semester=?',
          id,
          semester,
        ).filter((row) => isCurrent(row) && isEffectiveRecord(row));
        for (const [criterionId, active, value] of [
          [
            'academic_gpa',
            profile.gpa !== null,
            profile.gpa === null ? null : academicPoints(profile.gpa),
          ],
          ['compliance_clean', profile.complianceConfirmed, 20],
          [
            'pioneer_offline_participation',
            profile.offlineActivityCount !== null,
            profile.offlineActivityCount === null
              ? null
              : offlinePoints(profile.offlineActivityCount),
          ],
        ]) {
          const existing = entries.filter((row) => row.criterionId === criterionId);
          if (active && existing.length)
            fail(
              'Thành phần này đã có khoản chính thức; không xác nhận thêm nguồn trùng trong hồ sơ học kỳ.',
            );
        }
        putAssessment(id, profile, actor.name);
        if (
          Object.keys(profile).some(
            (key) => JSON.stringify(previous[key]) !== JSON.stringify(profile[key]),
          )
        )
          workflows?.hooks.notifyStudent(
            id,
            semester,
            'assessment_updated',
            'Hồ sơ đánh giá đã cập nhật',
            'Giảng viên đã cập nhật dữ liệu đánh giá của học kỳ.',
            `assessment:${id}:${semester}:${createHash('sha256').update(JSON.stringify(profile)).digest('hex')}`,
            'assessment',
            id,
          );
        addAudit(
          actor,
          'Cập nhật hồ sơ đánh giá',
          `${studentRow(id).code} ${semester}: ${JSON.stringify(profile)}`,
        );
        return {
          studentId: id,
          assessment: assessmentFor(id, semester),
          student: summarize(studentRow(id), semester),
        };
      });
    },
    legacyData(user, filters = {}) {
      const actor = authorize(user, true);
      const semester = readSemester(filters);
      return {
        semester,
        ruleVersion: RULE_VERSION,
        activities: isCoordinator(actor) ? activityList(semester).filter((row) => row.legacy) : [],
        records: visibleRows(actor, recordsFor(null, semester), semester).filter(
          (row) => row.legacy,
        ),
        claims: visibleRows(actor, claimsFor(null, semester), semester).filter((row) => row.legacy),
      };
    },
    reclassifyLegacy(user, payload = {}) {
      const actor = authorize(user, true);
      const types = { activity: 'activities', record: 'records', claim: 'claims' },
        table = Object.hasOwn(types, payload.type) ? types[payload.type] : null;
      if (!table) fail('Loại dữ liệu phải là activity, record hoặc claim.');
      const id = required(payload.id, 'mã dữ liệu');
      return transaction(() => {
        const original = one(`SELECT * FROM ${table} WHERE id=?`, id);
        if (!original) fail('Dữ liệu không tồn tại.', 404);
        if (table === 'records' && !isEffectiveRecord(original))
          fail('Khoản đã được thay thế; không sửa lại nguồn lịch sử.', 409);
        assertWritable(original.semester, actor);
        if (table === 'activities') coordinator(actor);
        else assertStudentScope(actor, original.studentId, original.semester, true);
        if (table === 'records') {
          const linked = one('SELECT studentId,semester FROM claims WHERE officialRecordId=?', id);
          if (linked) {
            assertWritable(linked.semester, actor);
            assertStudentScope(actor, linked.studentId, linked.semester, true);
          }
        }
        if (table === 'claims' && original.officialRecordId) {
          const linked = one(
            'SELECT studentId,semester FROM records WHERE id=?',
            original.officialRecordId,
          );
          if (linked) {
            assertWritable(linked.semester, actor);
            assertStudentScope(actor, linked.studentId, linked.semester, true);
          }
        }
        if (isCurrent(original)) fail('Dữ liệu đã được đối chiếu theo quy chế hiện tại.');
        const entry = checkedEntry({ ...payload, quantity: payload.quantity ?? original.quantity });
        if (table === 'records')
          validateUniqueEntry(original.studentId, original.semester, entry, {
            excludeRecordId: id,
          });
        if (table === 'claims' && ACTIVE.has(original.status) && !original.officialRecordId)
          validateClaimEntry(original.studentId, original.semester, entry, {
            activityId: original.activityId,
            excludeClaimId: id,
          });
        if (table === 'records') {
          const linked = one('SELECT * FROM claims WHERE officialRecordId=?', id);
          if (
            isCurrent(linked) &&
            (linked.criterionId !== entry.criterionId || linked.categoryId !== entry.categoryId)
          )
            fail('Tiêu chí mới không khớp kê khai đã đối soát.');
        }
        if (table === 'claims' && original.officialRecordId) {
          const linked = one('SELECT * FROM records WHERE id=?', original.officialRecordId);
          if (
            isCurrent(linked) &&
            (linked.criterionId !== entry.criterionId || linked.categoryId !== entry.categoryId)
          )
            fail('Tiêu chí mới không khớp khoản chính thức đã đối soát.');
        }
        const pointsField = table === 'claims' ? 'claimedPoints' : 'points';
        run(
          `UPDATE ${table} SET criterionId=?,categoryId=?,${pointsField}=?,quantity=?,approvalReference=?,ruleVersion=? WHERE id=?`,
          entry.criterionId,
          entry.categoryId,
          entry.points,
          entry.quantity,
          entry.approvalReference,
          RULE_VERSION,
          id,
        );
        const updated = one(`SELECT * FROM ${table} WHERE id=?`, id);
        if (table === 'records')
          run('UPDATE records SET canonical=? WHERE id=?', canonicalFor(updated), id);
        addAudit(
          actor,
          'Đối chiếu dữ liệu cũ',
          `${payload.type} ${id}; trước=${JSON.stringify(original)}; sau=${JSON.stringify(updated)}`,
        );
        return {
          ok: true,
          type: payload.type,
          id,
          row:
            table === 'records'
              ? decorateRecord(updated)
              : table === 'claims'
                ? decorateClaim(updated)
                : entryMetadata(updated),
        };
      });
    },
    courseSummary(user, studentId, options = {}) {
      const actor = authorize(user),
        id = required(studentId, 'sinh viên');
      if (actor.role === 'STUDENT' && id !== actor.studentId)
        fail('Sinh viên chỉ được xem kết quả của chính mình.', 403);
      const student = studentRow(id);
      if (!student) fail('Sinh viên không tồn tại.', 404);
      if (
        actor.role === 'LECTURER' &&
        !isCoordinator(actor) &&
        !catalogue().some((period) => canReadStudent(actor, id, period.id))
      )
        fail('Sinh viên không thuộc phạm vi được phân công.', 403);
      const semesters = catalogue()
        .filter((period) => period.courseIncluded)
        .map((period) => ({
          ...(canReadStudent(actor, id, period.id)
            ? summarize(student, period.id)
            : {
                semester: period.id,
                hasOfficialData: false,
                officialTotal: null,
                officialClassification: null,
                projectedTotal: null,
                projectedClassification: null,
                evaluationStatus: 'incomplete',
                redacted: true,
                warnings: [
                  'Kết quả học kỳ ngoài phạm vi phân công, không sử dụng để kết luận toàn khóa.',
                ],
              }),
          academicYear: period.academicYear,
          term: period.term,
          semesterIndex:
            (Number(period.academicYear.slice(0, 4)) - Number(options.cohortYear)) * 2 +
            period.term,
        }))
        .filter((period) => period.semesterIndex >= 1);
      const boolean = (value) => value === true || value === 'true';
      const settings = {
        ...options,
        cohortYear: numeric(options.cohortYear, 'Năm tuyển sinh'),
        standardSemesters: numeric(options.standardSemesters, 'Số học kỳ chuẩn'),
        earlyGraduation: boolean(options.earlyGraduation),
      };
      if (options.tdtuSemesters !== undefined && options.tdtuSemesters !== '')
        settings.tdtuSemesters = numeric(options.tdtuSemesters, 'Số học kỳ tại TDTU');
      else delete settings.tdtuSemesters;
      const result = courseResult(semesters, settings);
      const configuredName = (generated) => {
        const parsed = /^(\d{4}-\d{4})-HK([12])$/.exec(generated);
        return parsed
          ? catalogue().find(
              (period) =>
                period.courseIncluded &&
                period.academicYear === parsed[1] &&
                period.term === Number(parsed[2]),
            )?.id || generated
          : generated;
      };
      result.expectedSemesters = result.expectedSemesters.map(configuredName);
      result.missingSemesters = result.missingSemesters.map(configuredName);
      result.sources = semesters.map(
        ({ semester, ruleVersion, snapshotId, snapshotVersion, closedAt }) => ({
          semester,
          ruleVersion,
          snapshotId: snapshotId || null,
          snapshotVersion: snapshotVersion || null,
          closedAt: closedAt || null,
        }),
      );
      return {
        studentId: id,
        student: { id: student.id, code: student.code, name: student.name },
        semesters,
        result,
        ruleVersion: RULE_VERSION,
      };
    },
    students(user, filters = {}) {
      const actor = authorize(user);
      const semester = readSemester(filters);
      return {
        students: summaries(actor, filters),
        classes: visibleClasses(actor, semester),
        categories: categories(),
      };
    },
    activities(user, filters = {}) {
      authorize(user);
      const semester = readSemester(filters);
      return { activities: activityList(semester), categories: categories(), semester };
    },
    createActivity(user, payload = {}) {
      const actor = authorize(user, true),
        semester = readSemester(payload);
      const entry = checkedEntry(payload),
        mode = str(payload.mode) || 'offline';
      if (!['online', 'offline'].includes(mode)) fail('Hình thức phải là online hoặc offline.');
      const activity = {
        id: makeId('activity'),
        title: required(payload.title, 'tên hoạt động', 300),
        organizer: required(payload.organizer, 'đơn vị tổ chức', 300),
        date: validDate(payload.date),
        categoryId: entry.categoryId,
        points: entry.points,
        mode,
        semester,
        criterionId: entry.criterionId,
        quantity: entry.quantity,
        approvalReference: entry.approvalReference,
        ruleVersion: RULE_VERSION,
      };
      return transaction(() => {
        assertWritable(semester, actor);
        if (
          !isCoordinator(actor) &&
          !one(
            'SELECT id FROM lecturer_assignments WHERE lecturerId=? AND semester=? AND revokedAt IS NULL LIMIT 1',
            actor.id,
            semester,
          )
        )
          fail('Bạn chưa được phân công lớp trong học kỳ này.', 403);
        run(
          'INSERT INTO activities(id,title,organizer,date,categoryId,points,mode,semester,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(activity),
        );
        addAudit(
          actor,
          'Tạo hoạt động',
          `${activity.title}; ${activity.criterionId}, ${activity.points} điểm.`,
        );
        return { activity: entryMetadata(activity) };
      });
    },
    claims(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      return {
        claims: visibleRows(
          actor,
          claimsFor(actor.role === 'STUDENT' ? actor.studentId : null, semester),
          semester,
        ),
        categories: categories(),
        activities: activityList(semester),
        students: summaries(actor, filters).map(({ id, name, code }) => ({ id, name, code })),
        semester,
      };
    },
    createClaim(user, payload = {}) {
      const actor = authorize(user),
        semester = readSemester(payload);
      if (actor.role === 'STUDENT' && payload.studentId && payload.studentId !== actor.studentId)
        fail('Sinh viên chỉ được kê khai cho chính mình.', 403);
      const studentId =
        actor.role === 'STUDENT' ? actor.studentId : required(payload.studentId, 'sinh viên');
      if (!studentRow(studentId)) fail('Sinh viên không tồn tại.', 404);
      const activityId = str(payload.activityId) || null,
        activity = activityId ? one('SELECT * FROM activities WHERE id=?', activityId) : null;
      if (activityId && !activity) fail('Hoạt động không tồn tại.');
      if (activity && !isCurrent(activity)) fail('Hoạt động cũ chưa được đối chiếu tiêu chí.');
      if (activity && activity.semester !== semester)
        fail('Hoạt động không thuộc học kỳ đang kê khai.');
      const entry = checkedEntry(
        {
          ...payload,
          criterionId: str(payload.criterionId) || activity?.criterionId,
          points: payload.claimedPoints ?? payload.points,
          quantity:
            payload.quantity === undefined || payload.quantity === ''
              ? activity?.quantity
              : payload.quantity,
          approvalReference: payload.approvalReference ?? activity?.approvalReference,
        },
        { student: actor.role === 'STUDENT' },
      );
      if (
        activity &&
        entry.categoryId !== 'bonus' &&
        (activity.criterionId !== entry.criterionId || activity.categoryId !== entry.categoryId)
      )
        fail('Tiêu chí hoặc mục điểm không khớp hoạt động.');
      const evidenceUrl = str(payload.evidenceUrl, 1500);
      if (evidenceUrl) {
        let parsed;
        try {
          parsed = new URL(evidenceUrl);
        } catch {
          fail('Đường dẫn minh chứng không hợp lệ.');
        }
        if (!['http:', 'https:'].includes(parsed.protocol))
          fail('Minh chứng phải dùng http hoặc https.');
      }
      const claim = {
        id: makeId('claim'),
        studentId,
        activityId,
        title: activity?.title || required(payload.title, 'tên hoạt động', 300),
        organizer: activity?.organizer || required(payload.organizer, 'đơn vị tổ chức', 300),
        date: activity?.date || validDate(payload.date),
        categoryId: entry.categoryId,
        claimedPoints: entry.points,
        evidenceUrl,
        note: str(payload.note, 2000),
        status: 'pending',
        reviewNote: '',
        officialRecordId: null,
        createdAt: now(),
        semester,
        criterionId: entry.criterionId,
        quantity: entry.quantity,
        approvalReference: entry.approvalReference,
        ruleVersion: RULE_VERSION,
      };
      return transaction(() => {
        assertWritable(semester, actor);
        assertStudentScope(actor, studentId, semester, true);
        if (payload.evidenceId) {
          const evidence = workflows.hooks.assertEvidenceAttachment(
            actor,
            payload.evidenceId,
            studentId,
            semester,
          );
          claim.evidenceUrl = evidence.url;
        }
        validateClaimEntry(studentId, semester, entry, { activityId });
        run(
          'INSERT INTO claims(id,studentId,activityId,title,organizer,date,categoryId,claimedPoints,evidenceUrl,note,status,reviewNote,officialRecordId,createdAt,semester,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(claim),
        );
        if (payload.evidenceId)
          run('UPDATE claims SET evidenceId=? WHERE id=?', payload.evidenceId, claim.id);
        workflows?.hooks.notifyStaff(
          studentId,
          semester,
          'claim_created',
          'Có kê khai chờ kiểm tra',
          claim.title,
          `claim:${claim.id}:created`,
          'claim',
          claim.id,
        );
        addAudit(
          actor,
          'Tạo kê khai',
          `${studentRow(studentId).code}: ${claim.title}; ${entry.criterionId}, ${entry.points} điểm.`,
        );
        return { claim: decorateClaim(one('SELECT * FROM claims WHERE id=?', claim.id)) };
      });
    },
    reviewClaim(user, id, payload = {}) {
      const actor = authorize(user, true);
      if (!['reviewed', 'rejected'].includes(payload.status))
        fail('Trạng thái duyệt không hợp lệ.');
      return transaction(() => {
        const claim = one('SELECT * FROM claims WHERE id=?', str(id));
        if (!claim) fail('Kê khai không tồn tại.', 404);
        assertWritable(claim.semester, actor);
        assertStudentScope(actor, claim.studentId, claim.semester, true);
        if (claim.status === 'matched') fail('Kê khai đã có điểm chính thức, không thể duyệt lại.');
        if (payload.status === 'reviewed' && !ACTIVE.has(claim.status) && isCurrent(claim))
          validateClaimEntry(claim.studentId, claim.semester, claim, {
            activityId: claim.activityId,
            excludeClaimId: claim.id,
          });
        run(
          'UPDATE claims SET status=?,reviewNote=? WHERE id=?',
          payload.status,
          str(payload.note, 2000),
          claim.id,
        );
        if (claim.status !== payload.status || claim.reviewNote !== str(payload.note, 2000))
          workflows?.hooks.notifyStudent(
            claim.studentId,
            claim.semester,
            'claim_reviewed',
            'Kê khai đã được kiểm tra',
            `${claim.title}: ${payload.status === 'reviewed' ? 'Đã kiểm tra, chưa tự cấp điểm chính thức' : 'Chưa được chấp nhận'}. ${str(payload.note, 2000)}`,
            `claim:${claim.id}:${payload.status}:${createHash('sha256').update(str(payload.note, 2000)).digest('hex')}`,
            'claim',
            claim.id,
          );
        addAudit(
          actor,
          payload.status === 'reviewed' ? 'Kiểm tra kê khai' : 'Từ chối kê khai',
          `${studentRow(claim.studentId).code}: ${claim.title}. ${str(payload.note, 2000)}`,
        );
        return { claim: decorateClaim(one('SELECT * FROM claims WHERE id=?', claim.id)) };
      });
    },
    officialRecords(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      return {
        records: visibleRows(
          actor,
          recordsFor(actor.role === 'STUDENT' ? actor.studentId : null, semester),
          semester,
        ),
        batches: isCoordinator(actor)
          ? frozen(semester)?.raw.batches ||
            all(
              'SELECT b.* FROM batches b WHERE EXISTS (SELECT 1 FROM records r WHERE r.batchId=b.id AND r.semester=?) ORDER BY b.createdAt DESC',
              semester,
            )
          : [],
        semester,
      };
    },
    previewImport(user, rows) {
      const actor = authorize(user, true);
      const { entries, summary } = inspectImport(rows, actor);
      return { rows: entries.map(({ normalized, ...row }) => row), summary };
    },
    commitImport(user, { rows, batchName } = {}) {
      const actor = authorize(user, true);
      return transaction(() => {
        const { entries, summary } = inspectImport(rows, actor);
        if (summary.errors)
          fail(
            `Không nhập dữ liệu: ${summary.errors} dòng lỗi. ${entries.find((row) => row.status === 'error').errors[0]}`,
          );
        if (!summary.valid)
          return { inserted: 0, skipped: summary.duplicate, matched: 0, batchId: null };
        const batchId = makeId('batch');
        run(
          'INSERT INTO batches(id,name,createdAt,rowCount,actorName) VALUES(?,?,?,?,?)',
          batchId,
          str(batchName, 300) || 'Nhập dữ liệu chính thức',
          now(),
          summary.valid,
          actor.name,
        );
        const insertedIds = [];
        for (const entry of entries.filter((row) => row.status === 'valid')) {
          const { row, student, canonical } = entry.normalized;
          const id = makeId('record');
          run(
            'INSERT INTO records(id,sourceId,studentId,activityId,title,categoryId,points,date,semester,batchId,canonical,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            id,
            row.sourceId,
            student.id,
            row.activityId,
            row.title,
            row.categoryId,
            row.points,
            row.date,
            row.semester,
            batchId,
            canonical,
            row.criterionId,
            row.quantity,
            row.approvalReference,
            RULE_VERSION,
          );
          insertedIds.push(id);
        }
        let matched = 0;
        for (const id of insertedIds) {
          const record = one('SELECT * FROM records WHERE id=?', id);
          if (!record.activityId || !isCurrent(record)) continue;
          const candidates = all(
            "SELECT * FROM claims WHERE studentId=? AND semester=? AND activityId=? AND categoryId=? AND status IN ('pending','reviewed') AND officialRecordId IS NULL AND criterionId=? AND ruleVersion=?",
            record.studentId,
            record.semester,
            record.activityId,
            record.categoryId,
            record.criterionId,
            RULE_VERSION,
          );
          const recordCandidates = all(
            'SELECT r.* FROM records r LEFT JOIN claims c ON c.officialRecordId=r.id WHERE r.studentId=? AND r.semester=? AND r.activityId=? AND r.categoryId=? AND c.id IS NULL AND r.criterionId=? AND r.ruleVersion=?',
            record.studentId,
            record.semester,
            record.activityId,
            record.categoryId,
            record.criterionId,
            RULE_VERSION,
          ).filter((candidate) => isEffectiveRecord(candidate) && !recordClaimId(candidate.id));
          if (
            candidates.length === 1 &&
            recordCandidates.length === 1 &&
            candidates[0].claimedPoints === record.points
          ) {
            performMatch(candidates[0], record, actor);
            matched++;
          }
        }
        addAudit(
          actor,
          'Nhập điểm chính thức',
          `${str(batchName) || 'Tệp dữ liệu'}: ${summary.valid} dòng mới, ${summary.duplicate} dòng trùng, tự đối soát ${matched} kê khai.`,
        );
        for (const studentId of new Set(
          entries
            .filter((entry) => entry.status === 'valid')
            .map((entry) => entry.normalized.student.id),
        )) {
          for (const semester of new Set(
            entries
              .filter(
                (entry) => entry.status === 'valid' && entry.normalized.student.id === studentId,
              )
              .map((entry) => entry.row.semester),
          ))
            workflows?.hooks.notifyStudent(
              studentId,
              semester,
              'official_imported',
              'Điểm chính thức đã được ghi nhận',
              'Có khoản điểm chính thức mới trong học kỳ.',
              `import:${batchId}:${studentId}:${semester}`,
              'batch',
              batchId,
            );
        }
        return { inserted: summary.valid, skipped: summary.duplicate, matched, batchId };
      });
    },
    reconciliation(user, filters = {}) {
      const actor = authorize(user, true);
      const semester = readSemester(filters);
      const claims = visibleRows(actor, claimsFor(null, semester), semester).filter(
        (claim) => isCurrent(claim) && ACTIVE.has(claim.status) && !claim.officialRecordId,
      );
      const records = visibleRows(actor, recordsFor(null, semester), semester).filter(
        (record) => isCurrent(record) && record.effective !== false && !record.matchedClaimId,
      );
      const normalizeTitle = (value) =>
        value
          .toLocaleLowerCase('vi')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      const suggestions = [];
      for (const claim of claims)
        for (const record of records) {
          if (
            claim.studentId !== record.studentId ||
            claim.semester !== record.semester ||
            claim.categoryId !== record.categoryId ||
            claim.criterionId !== record.criterionId
          )
            continue;
          const a = normalizeTitle(claim.title),
            b = normalizeTitle(record.title);
          const common = a
            .split(' ')
            .filter((word) => word.length > 2 && b.split(' ').includes(word)).length;
          if (claim.activityId && claim.activityId === record.activityId)
            suggestions.push({
              claimId: claim.id,
              recordId: record.id,
              reason: 'Cùng mã hoạt động; điểm khác hoặc có nhiều khoản liên quan, cần xác nhận.',
              confidence: 'high',
            });
          else if (
            a === b ||
            (Math.min(a.length, b.length) > 8 && (a.includes(b) || b.includes(a))) ||
            common >= 3
          )
            suggestions.push({
              claimId: claim.id,
              recordId: record.id,
              reason: 'Tên hoạt động tương tự; cần đối chiếu minh chứng.',
              confidence: 'medium',
            });
        }
      return { claims, records, suggestions, semester };
    },
    matchClaim(user, { claimId, recordId } = {}) {
      const actor = authorize(user, true);
      return transaction(() => {
        const claim = one('SELECT * FROM claims WHERE id=?', required(claimId, 'kê khai'));
        const record = one('SELECT * FROM records WHERE id=?', required(recordId, 'khoản điểm'));
        performMatch(claim, record, actor);
        addAudit(
          actor,
          'Đối soát thủ công',
          `${studentRow(claim.studentId).code}: ${claim.title} ↔ ${record.sourceId}.`,
        );
        return { ok: true };
      });
    },
    reports(user, filters = {}) {
      const actor = authorize(user, true),
        basis = filters.basis || 'official',
        semester = readSemester(filters);
      const academicYear = str(filters.academicYear);
      const yearPeriods = catalogue().filter(
        (period) => period.academicYear === academicYear && period.annualIncluded,
      );
      if (academicYear && !catalogue().some((period) => period.academicYear === academicYear))
        fail('Năm học không nằm trong danh sách được hỗ trợ.');
      if (!['official', 'projected'].includes(basis)) fail('Cơ sở thống kê không hợp lệ.');
      const students = summaries(actor, filters);
      const snapshot = frozen(semester);
      const reportSettings = snapshot?.rules || settings();
      const hasData = (student) =>
        student.evaluationStatus !== 'not_evaluated' &&
        (!student.snapshotId || basis !== 'official' || student.publishedTotal !== null) &&
        Number.isFinite(basis === 'official' ? student.officialTotal : student.projectedTotal) &&
        (basis === 'official' ? student.hasOfficialData : student.projectedClassification !== null);
      const classificationField =
        basis === 'official' ? 'officialClassification' : 'projectedClassification';
      const scoreField = basis === 'official' ? 'officialTotal' : 'projectedTotal';
      const hasDataCount = students.filter(hasData).length;
      const byClassification = reportSettings.classifications.map(({ label }) => {
        const count = students.filter(
          (student) => hasData(student) && student[classificationField] === label,
        ).length;
        return {
          label,
          count,
          percentage: students.length ? round((count / students.length) * 100) : 0,
        };
      });
      const byClass = visibleClasses(actor, semester)
        .filter((item) => !filters.classId || filters.classId === item.id)
        .map((item) => {
          const rows = students.filter((student) => student.classId === item.id),
            data = rows.filter(hasData);
          return {
            ...item,
            total: rows.length,
            hasData: data.length,
            noData: rows.length - data.length,
            average: data.length
              ? round(data.reduce((sum, student) => sum + student[scoreField], 0) / data.length)
              : null,
            atRisk: data.filter((student) => student[scoreField] < reportSettings.riskThreshold)
              .length,
            pending: rows.reduce((sum, student) => sum + student.pendingCount, 0),
          };
        });
      const semesterBreakdown = academicYear
        ? yearPeriods.map((period) => {
            const report = store.reports(actor, {
              ...filters,
              academicYear: undefined,
              semester: period.id,
            });
            return {
              semester: period.id,
              academicYear: period.academicYear,
              term: period.term,
              students: report.students,
              stats: report.stats,
              basis,
            };
          })
        : [];
      const outputStudents = academicYear
        ? students.map((student) => {
            const profile = studentRow(student.id) || student;
            const periods = yearPeriods.map((period) => ({
              ...(canReadStudent(actor, student.id, period.id)
                ? summarize(profile, period.id)
                : {
                    semester: period.id,
                    hasOfficialData: false,
                    officialTotal: null,
                    evaluationStatus: 'incomplete',
                    redacted: true,
                  }),
              academicYear: period.academicYear,
              term: period.term,
            }));
            const annual = annualResult(periods);
            annual.sources = periods.map(
              ({ semester, ruleVersion, snapshotId, snapshotVersion, closedAt }) => ({
                semester,
                ruleVersion,
                snapshotId: snapshotId || null,
                snapshotVersion: snapshotVersion || null,
                closedAt: closedAt || null,
              }),
            );
            return {
              ...student,
              annualTotal: annual.officialAverage,
              annualClassification: annual.classification,
              annualEvaluationStatus: annual.evaluationStatus,
              annualResult: annual,
            };
          })
        : students;
      return {
        students: outputStudents,
        classes: visibleClasses(actor, semester),
        stats: {
          total: students.length,
          hasData: hasDataCount,
          noData: students.length - hasDataCount,
          notEvaluated: students.filter((student) => student.evaluationStatus === 'not_evaluated')
            .length,
          byClassification,
          byClass,
        },
        basis,
        semester,
        academicYear: academicYear || null,
        semesterBreakdown,
        settings: reportSettings,
        snapshotId: snapshot?.id || null,
        snapshotVersion: snapshot?.version || null,
        closedAt: snapshot?.createdAt || null,
      };
    },
    dashboard(user, filters = {}) {
      const actor = authorize(user),
        students = summaries(actor, filters),
        semester = readSemester(filters);
      const snapshot = frozen(semester);
      const dashboardSettings = snapshot?.rules || settings();
      const currentEntry = (entry) => (snapshot ? !entry.legacy : isCurrent(entry));
      const data = students.filter(
          (student) =>
            student.hasOfficialData &&
            (!student.snapshotId || student.publishedTotal !== null) &&
            student.evaluationStatus !== 'not_evaluated' &&
            Number.isFinite(student.officialTotal),
        ),
        projectedData = students.filter(
          (student) =>
            student.projectedClassification !== null &&
            student.evaluationStatus !== 'not_evaluated' &&
            Number.isFinite(student.projectedTotal),
        );
      const allowedIds = new Set(students.map((student) => student.id));
      const claims = claimsFor(actor.role === 'STUDENT' ? actor.studentId : null, semester).filter(
        (claim) => allowedIds.has(claim.studentId),
      );
      const records = recordsFor(
        actor.role === 'STUDENT' ? actor.studentId : null,
        semester,
      ).filter((record) => allowedIds.has(record.studentId));
      return {
        semester,
        studentCount: students.length,
        hasDataCount: data.length,
        noDataCount: students.length - data.length,
        atRiskCount: data.filter(
          (student) => student.officialTotal < dashboardSettings.riskThreshold,
        ).length,
        pendingClaimsCount: claims.filter(
          (claim) => currentEntry(claim) && ACTIVE.has(claim.status),
        ).length,
        unmatchedRecordsCount: records.filter(
          (record) => currentEntry(record) && record.effective !== false && !record.matchedClaimId,
        ).length,
        officialAverage: data.length
          ? round(data.reduce((sum, student) => sum + student.officialTotal, 0) / data.length)
          : null,
        projectedAverage: projectedData.length
          ? round(
              projectedData.reduce((sum, student) => sum + student.projectedTotal, 0) /
                projectedData.length,
            )
          : null,
        classificationDistribution: dashboardSettings.classifications.map(({ label }) => {
          const count = data.filter((student) => student.officialClassification === label).length;
          return {
            label,
            count,
            percentage: students.length ? round((count / students.length) * 100) : 0,
          };
        }),
        classes: visibleClasses(actor, semester).map((item) => {
          const rows = students.filter((student) => student.classId === item.id);
          return {
            ...item,
            total: rows.length,
            atRisk: rows.filter(
              (student) =>
                student.hasOfficialData &&
                (!student.snapshotId || student.publishedTotal !== null) &&
                student.evaluationStatus !== 'not_evaluated' &&
                Number.isFinite(student.officialTotal) &&
                student.officialTotal < dashboardSettings.riskThreshold,
            ).length,
            pending: rows.reduce((sum, student) => sum + student.pendingCount, 0),
          };
        }),
        recentClaims: claims.slice(0, 6),
        recentActivity: isCoordinator(actor)
          ? all('SELECT * FROM audit ORDER BY createdAt DESC,rowid DESC LIMIT 8')
          : [],
        student: actor.role === 'STUDENT' ? students[0] || null : null,
        enrollment:
          actor.role === 'STUDENT' ? enrollmentFor(actor.studentId, semester) || null : null,
        access: accessFor(actor),
        settings: dashboardSettings,
        categories: dashboardSettings.categories,
        snapshotId: snapshot?.id || null,
        snapshotVersion: snapshot?.version || null,
        closedAt: snapshot?.createdAt || null,
      };
    },
    audit(user) {
      coordinator(user);
      return { entries: all('SELECT * FROM audit ORDER BY createdAt DESC,rowid DESC LIMIT 500') };
    },
    updateSettings(user, payload = {}) {
      const actor = coordinator(user);
      if (payload.totalMax !== undefined && Number(payload.totalMax) !== 100)
        fail('Tổng điểm tối đa 100 được cố định theo quy chế.');
      if (
        payload.categories !== undefined &&
        (!Array.isArray(payload.categories) ||
          payload.categories.length !== CATEGORIES.length ||
          payload.categories.some(
            (cat, index) =>
              cat.id !== CATEGORIES[index].id ||
              cat.name !== CATEGORIES[index].name ||
              Number(cat.maxPoints) !== 20,
          ))
      )
        fail('Sáu mục và trần 20 điểm được cố định theo quy chế.');
      if (
        payload.classifications !== undefined &&
        (!Array.isArray(payload.classifications) ||
          payload.classifications.length !== CLASSIFICATIONS.length ||
          payload.classifications.some(
            (item, index) =>
              item.label !== CLASSIFICATIONS[index].label ||
              Number(item.min) !== CLASSIFICATIONS[index].min,
          ))
      )
        fail('Ngưỡng xếp loại được cố định theo quy chế.');
      if (payload.versionName !== undefined && payload.versionName !== RULE_VERSION)
        fail('Không thể thay đổi phiên bản quy chế trong màn hình cấu hình.');
      const riskThreshold =
        payload.riskThreshold === undefined
          ? settings().riskThreshold
          : numeric(payload.riskThreshold, 'Ngưỡng cần hỗ trợ');
      if (riskThreshold < 0 || riskThreshold > 100)
        fail('Ngưỡng cần hỗ trợ phải nằm trong khoảng 0 đến 100.');
      return transaction(() => {
        const updated = {
          ...JSON.parse(one('SELECT value FROM settings WHERE id=1').value),
          riskThreshold,
        };
        run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(updated));
        addAudit(
          actor,
          'Cập nhật ngưỡng cần hỗ trợ',
          `${riskThreshold} điểm; giữ nguyên quy chế ${RULE_VERSION}.`,
        );
        return { settings: settings() };
      });
    },
    getScenarioRows() {
      return [
        {
          sourceId: 'DEMO-SCENARIO-2026-HK1-001',
          studentCode: '523h0080',
          activityId: 'a3',
          title: 'Hiến máu tình nguyện tháng 10',
          categoryId: 'community',
          points: 10,
          date: '2026-10-10',
          semester: SEMESTER,
          criterionId: 'community_blood_hair_donation',
          quantity: 1,
          approvalReference: '',
        },
      ];
    },
    close() {
      db.close();
    },
  };
  workflows = createWorkflows({
    one,
    all,
    run,
    transaction,
    authorize,
    isCoordinator,
    canReadStudent,
    assertStudentScope,
    readSemester,
    assertWritable,
    enrollmentFor,
    studentRow,
    checkedEntry,
    validateUniqueEntry,
    canonicalFor,
    now,
    getStore: () => store,
    RULE_VERSION,
    addAudit,
    validDate,
  });
  Object.assign(store, workflows.api);
  return store;
}
