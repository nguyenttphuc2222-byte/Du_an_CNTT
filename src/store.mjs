import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
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
function now() {
  return new Date().toISOString();
}
export function openStore({ dbPath = ':memory:' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
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
  `);
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
  const readSemester = (filters = {}) => {
    const semester = str(filters?.semester) || SEMESTER;
    if (!SEMESTERS.includes(semester)) fail('Học kỳ không nằm trong danh sách được hỗ trợ.');
    return semester;
  };
  const categories = () => settings().categories;
  const category = (id) => {
    const found = categories().find((item) => item.id === id);
    if (!found) fail('Mục điểm không tồn tại.');
    return found;
  };
  const classList = () => {
    const rows = all('SELECT id,name FROM classes ORDER BY name');
    if (one('SELECT id FROM students WHERE classId IS NULL LIMIT 1'))
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
          className: studentRow(row.studentId)?.className || 'Chưa phân lớp',
        }
      : null;
  const claimsFor = (studentId = null, semester = SEMESTER) =>
    all(
      `SELECT * FROM claims WHERE semester=? ${studentId ? 'AND studentId=?' : ''} ORDER BY createdAt DESC,id`,
      semester,
      ...(studentId ? [studentId] : []),
    ).map(decorateClaim);
  const decorateRecord = (row) =>
    row
      ? {
          ...entryMetadata(row),
          canonical: undefined,
          studentCode: studentRow(row.studentId)?.code,
          studentName: studentRow(row.studentId)?.name,
          matchedClaimId: one('SELECT id FROM claims WHERE officialRecordId=?', row.id)?.id || null,
        }
      : null;
  const recordsFor = (studentId = null, semester = SEMESTER) =>
    all(
      `SELECT * FROM records WHERE semester=? ${studentId ? 'AND studentId=?' : ''} ORDER BY date DESC,id`,
      semester,
      ...(studentId ? [studentId] : []),
    ).map(decorateRecord);
  const assessmentFor = (studentId, semester = SEMESTER) => {
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
      ).filter(isCurrent);
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
    const assessment = assessmentFor(student.id, semester);
    const allOfficial = all(
      'SELECT * FROM records WHERE studentId=? AND semester=?',
      student.id,
      semester,
    );
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
    let result = all(
      'SELECT s.*,c.name className FROM students s LEFT JOIN classes c ON c.id=s.classId ORDER BY s.code',
    );
    if (user.role === 'STUDENT') result = result.filter((student) => student.id === user.studentId);
    if (filters.classId)
      result = result.filter((student) => (student.classId || 'unassigned') === filters.classId);
    const query = str(filters.q).toLocaleLowerCase('vi');
    if (query)
      result = result.filter((student) =>
        `${student.name} ${student.code} ${student.email}`.toLocaleLowerCase('vi').includes(query),
      );
    const semester = readSemester(filters);
    let output = result.map((student) => summarize(student, semester));
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
    ).filter((row) => isCurrent(row) && row.id !== excludeRecordId);
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
      ).some(isCurrent)
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
  const inspectImport = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) fail('Tệp phải có ít nhất một dòng dữ liệu.');
    if (rows.length > 5000) fail('Mỗi lần nhập tối đa 5.000 dòng.');
    const seen = new Map(),
      seenCriteria = new Set();
    const entries = rows.map((input, index) => {
      try {
        const normalized = normalizeRow(input);
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
  const performMatch = (claim, record) => {
    if (!claim || !record) fail('Không tìm thấy kê khai hoặc khoản điểm.', 404);
    if (!isCurrent(claim) || !isCurrent(record))
      fail('Chỉ đối soát dữ liệu đã được xác định tiêu chí theo quy chế hiện tại.');
    if (claim.criterionId !== record.criterionId) fail('Kê khai và khoản điểm phải cùng tiêu chí.');
    if (!ACTIVE.has(claim.status) || claim.officialRecordId)
      fail('Kê khai đã đối soát hoặc bị từ chối.');
    if (one('SELECT id FROM claims WHERE officialRecordId=?', record.id))
      fail('Khoản điểm chính thức đã được đối soát.');
    if (
      claim.studentId !== record.studentId ||
      claim.semester !== record.semester ||
      claim.categoryId !== record.categoryId
    )
      fail('Chỉ đối soát cùng sinh viên, học kỳ và mục điểm.');
    run("UPDATE claims SET status='matched',officialRecordId=? WHERE id=?", record.id, claim.id);
  };
  const store = {
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
    ensureGoogleUser({ sub, email, name, role = 'STUDENT' }) {
      const subject = required(sub, 'Google sub', 200);
      const address = required(email, 'email', 300).toLowerCase();
      if (!/^[^@\s]+@(student\.tdtu\.edu\.vn|tdtu\.edu\.vn)$/.test(address))
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
        if (existing) {
          const displayName = str(name) || existing.name;
          run(
            'UPDATE users SET name=?,role=?,googleSub=?,provider=? WHERE id=?',
            displayName,
            role,
            subject,
            'google',
            existing.id,
          );
          syncStudentName(existing.studentId, displayName);
          return publicUser(one('SELECT * FROM users WHERE id=?', existing.id));
        }
        let student = one('SELECT * FROM students WHERE email=?', address);
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
      const profile = validateAssessment(payload, previous);
      return transaction(() => {
        const entries = all(
          'SELECT * FROM records WHERE studentId=? AND semester=?',
          id,
          semester,
        ).filter(isCurrent);
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
      authorize(user, true);
      const semester = readSemester(filters);
      return {
        semester,
        ruleVersion: RULE_VERSION,
        activities: activityList(semester).filter((row) => row.legacy),
        records: recordsFor(null, semester).filter((row) => row.legacy),
        claims: claimsFor(null, semester).filter((row) => row.legacy),
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
      const semesters = SEMESTERS.map((period) => summarize(student, period));
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
      return {
        studentId: id,
        student: { id: student.id, code: student.code, name: student.name },
        semesters,
        result: courseResult(semesters, settings),
        ruleVersion: RULE_VERSION,
      };
    },
    students(user, filters = {}) {
      const actor = authorize(user);
      return {
        students: summaries(actor, filters),
        classes:
          actor.role === 'LECTURER'
            ? classList()
            : classList().filter(
                (item) => item.id === (studentRow(actor.studentId)?.classId || 'unassigned'),
              ),
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
        claims: claimsFor(actor.role === 'STUDENT' ? actor.studentId : null, semester),
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
        validateClaimEntry(studentId, semester, entry, { activityId });
        run(
          'INSERT INTO claims(id,studentId,activityId,title,organizer,date,categoryId,claimedPoints,evidenceUrl,note,status,reviewNote,officialRecordId,createdAt,semester,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(claim),
        );
        addAudit(
          actor,
          'Tạo kê khai',
          `${studentRow(studentId).code}: ${claim.title}; ${entry.criterionId}, ${entry.points} điểm.`,
        );
        return { claim: decorateClaim(claim) };
      });
    },
    reviewClaim(user, id, payload = {}) {
      const actor = authorize(user, true);
      if (!['reviewed', 'rejected'].includes(payload.status))
        fail('Trạng thái duyệt không hợp lệ.');
      return transaction(() => {
        const claim = one('SELECT * FROM claims WHERE id=?', str(id));
        if (!claim) fail('Kê khai không tồn tại.', 404);
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
        records: recordsFor(actor.role === 'STUDENT' ? actor.studentId : null, semester),
        batches:
          actor.role === 'LECTURER'
            ? all(
                'SELECT b.* FROM batches b WHERE EXISTS (SELECT 1 FROM records r WHERE r.batchId=b.id AND r.semester=?) ORDER BY b.createdAt DESC',
                semester,
              )
            : [],
        semester,
      };
    },
    previewImport(user, rows) {
      authorize(user, true);
      const { entries, summary } = inspectImport(rows);
      return { rows: entries.map(({ normalized, ...row }) => row), summary };
    },
    commitImport(user, { rows, batchName } = {}) {
      const actor = authorize(user, true);
      return transaction(() => {
        const { entries, summary } = inspectImport(rows);
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
            'SELECT r.id FROM records r LEFT JOIN claims c ON c.officialRecordId=r.id WHERE r.studentId=? AND r.semester=? AND r.activityId=? AND r.categoryId=? AND c.id IS NULL AND r.criterionId=? AND r.ruleVersion=?',
            record.studentId,
            record.semester,
            record.activityId,
            record.categoryId,
            record.criterionId,
            RULE_VERSION,
          );
          if (
            candidates.length === 1 &&
            recordCandidates.length === 1 &&
            candidates[0].claimedPoints === record.points
          ) {
            performMatch(candidates[0], record);
            matched++;
          }
        }
        addAudit(
          actor,
          'Nhập điểm chính thức',
          `${str(batchName) || 'Tệp dữ liệu'}: ${summary.valid} dòng mới, ${summary.duplicate} dòng trùng, tự đối soát ${matched} kê khai.`,
        );
        return { inserted: summary.valid, skipped: summary.duplicate, matched, batchId };
      });
    },
    reconciliation(user, filters = {}) {
      authorize(user, true);
      const semester = readSemester(filters);
      const claims = claimsFor(null, semester).filter(
        (claim) => isCurrent(claim) && ACTIVE.has(claim.status) && !claim.officialRecordId,
      );
      const records = recordsFor(null, semester).filter(
        (record) => isCurrent(record) && !record.matchedClaimId,
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
        performMatch(claim, record);
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
      if (academicYear && !SEMESTERS.some((period) => period.startsWith(academicYear + '-')))
        fail('Năm học không nằm trong danh sách được hỗ trợ.');
      if (!['official', 'projected'].includes(basis)) fail('Cơ sở thống kê không hợp lệ.');
      const students = summaries(actor, filters);
      const hasData = (student) =>
        student.evaluationStatus !== 'not_evaluated' &&
        Number.isFinite(basis === 'official' ? student.officialTotal : student.projectedTotal) &&
        (basis === 'official' ? student.hasOfficialData : student.projectedClassification !== null);
      const classificationField =
        basis === 'official' ? 'officialClassification' : 'projectedClassification';
      const scoreField = basis === 'official' ? 'officialTotal' : 'projectedTotal';
      const hasDataCount = students.filter(hasData).length;
      const byClassification = settings().classifications.map(({ label }) => {
        const count = students.filter((student) => student[classificationField] === label).length;
        return {
          label,
          count,
          percentage: students.length ? round((count / students.length) * 100) : 0,
        };
      });
      const byClass = classList()
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
            atRisk: data.filter((student) => student[scoreField] < settings().riskThreshold).length,
            pending: rows.reduce((sum, student) => sum + student.pendingCount, 0),
          };
        });
      const semesterBreakdown = academicYear
        ? SEMESTERS.filter((period) => period.startsWith(academicYear + '-')).map((period) => {
            const report = store.reports(actor, {
              ...filters,
              academicYear: undefined,
              semester: period,
            });
            return { semester: period, students: report.students, stats: report.stats, basis };
          })
        : [];
      const outputStudents = academicYear
        ? students.map((student) => {
            const profile = studentRow(student.id);
            const periods = SEMESTERS.filter((period) => period.startsWith(academicYear + '-')).map(
              (period) => summarize(profile, period),
            );
            const annual = annualResult(periods);
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
        classes: classList(),
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
        settings: settings(),
      };
    },
    dashboard(user, filters = {}) {
      const actor = authorize(user),
        students = summaries(actor, filters),
        semester = readSemester(filters);
      const data = students.filter(
          (student) =>
            student.hasOfficialData &&
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
        atRiskCount: data.filter((student) => student.officialTotal < settings().riskThreshold)
          .length,
        pendingClaimsCount: claims.filter((claim) => isCurrent(claim) && ACTIVE.has(claim.status))
          .length,
        unmatchedRecordsCount: records.filter(
          (record) => isCurrent(record) && !record.matchedClaimId,
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
        classificationDistribution: settings().classifications.map(({ label }) => {
          const count = data.filter((student) => student.officialClassification === label).length;
          return {
            label,
            count,
            percentage: students.length ? round((count / students.length) * 100) : 0,
          };
        }),
        classes: (actor.role === 'LECTURER'
          ? classList()
          : classList().filter(
              (item) => item.id === (studentRow(actor.studentId)?.classId || 'unassigned'),
            )
        ).map((item) => {
          const rows = students.filter((student) => student.classId === item.id);
          return {
            ...item,
            total: rows.length,
            atRisk: rows.filter(
              (student) =>
                student.hasOfficialData &&
                student.evaluationStatus !== 'not_evaluated' &&
                Number.isFinite(student.officialTotal) &&
                student.officialTotal < settings().riskThreshold,
            ).length,
            pending: rows.reduce((sum, student) => sum + student.pendingCount, 0),
          };
        }),
        recentClaims: claims.slice(0, 6),
        recentActivity:
          actor.role === 'LECTURER'
            ? all('SELECT * FROM audit ORDER BY createdAt DESC,rowid DESC LIMIT 8')
            : [],
        student: actor.role === 'STUDENT' ? students[0] || null : null,
        settings: settings(),
        categories: categories(),
      };
    },
    audit(user) {
      authorize(user, true);
      return { entries: all('SELECT * FROM audit ORDER BY createdAt DESC,rowid DESC LIMIT 500') };
    },
    updateSettings(user, payload = {}) {
      const actor = authorize(user, true);
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
        const updated = { ...DEFAULT_SETTINGS, riskThreshold };
        run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(updated));
        addAudit(
          actor,
          'Cập nhật ngưỡng cần hỗ trợ',
          `${riskThreshold} điểm; giữ nguyên quy chế ${RULE_VERSION}.`,
        );
        return { settings: updated };
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
  return store;
}
