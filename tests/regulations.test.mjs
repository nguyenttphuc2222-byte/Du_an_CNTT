import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_VERSION,
  RULE_SOURCE,
  CATEGORIES,
  CLASSIFICATIONS,
  CRITERIA,
  ACADEMIC_BANDS,
  PLACEMENT_BANDS,
  OFFLINE_BANDS,
  academicPoints,
  placementPoints,
  offlinePoints,
  normalizeEntry,
  classifyScore,
  disciplineForEntries,
  annualResult,
  courseResult,
} from '../src/regulations.mjs';

const criterion = (id) => {
  const item = CRITERIA.find((entry) => entry.id === id);
  assert(item, `Missing regulation criterion: ${id}`);
  return item;
};
function invalid(action) {
  assert.throws(action, (error) => error.status === 400 && Boolean(error.message));
}
function semester(index, points, extras = {}, cohortYear = 2025) {
  const year = cohortYear + Math.floor((index - 1) / 2);
  return {
    semester: `${year}-${year + 1}-HK${index % 2 ? 1 : 2}`,
    semesterIndex: index,
    hasOfficialData: true,
    officialTotal: points,
    evaluationStatus: 'evaluated',
    atTdtu: true,
    ...extras,
  };
}

test('source version, six category caps and classifications follow Articles 3, 11 and 16', () => {
  assert.equal(RULE_VERSION, 'tdtu-2025-2026');
  assert.equal(RULE_SOURCE.effectiveFrom, '2025-2026');
  assert.equal(RULE_SOURCE.reference, 'Điều 16');
  assert.equal(RULE_SOURCE.url, '/docs/quy-che-ren-luyen-tdtu.pdf');
  assert.equal(RULE_SOURCE.sourceType, 'user-provided-pdf');
  assert.deepEqual(
    CATEGORIES.map((item) => item.id),
    ['academic', 'compliance', 'movement', 'community', 'pioneer', 'bonus'],
  );
  assert(CATEGORIES.every((item) => item.maxPoints === 20 && item.name.length > 8));
  assert.deepEqual(
    CLASSIFICATIONS.map((item) => [item.label, item.min]),
    [
      ['Xuất sắc', 90],
      ['Tốt', 80],
      ['Khá', 65],
      ['Trung bình', 50],
      ['Yếu', 35],
      ['Kém', -1e9],
    ],
  );
  assert.match(RULE_SOURCE.notes.join(' '), /không nêu sàn 0/);
  assert.match(RULE_SOURCE.notes.join(' '), /không quy định cách làm tròn/);
  assert.doesNotThrow(() => JSON.stringify({ CATEGORIES, CLASSIFICATIONS, CRITERIA }));
  assert(
    Object.isFrozen(CATEGORIES) && Object.isFrozen(CATEGORIES[0]) && Object.isFrozen(CRITERIA),
  );
});

test('catalog covers every table reference, all 40 award cells and seven GPA bands', () => {
  assert.equal(CRITERIA.length, 97);
  assert.equal(new Set(CRITERIA.map((item) => item.id)).size, CRITERIA.length);
  assert.deepEqual(
    Object.fromEntries(
      CATEGORIES.map((category) => [
        category.id,
        CRITERIA.filter((item) => item.categoryId === category.id).length,
      ]),
    ),
    { academic: 15, compliance: 8, movement: 12, community: 10, pioneer: 11, bonus: 40 },
  );
  for (const [article, rows] of [
    [4, 8],
    [5, 3],
    [6, 8],
    [7, 7],
    [8, 5],
    [9, 10],
  ]) {
    for (let row = 1; row <= rows; row++)
      assert(
        CRITERIA.some((item) => item.reference === `Điều ${article}.${row}`),
        `Missing Article ${article}, row ${row}`,
      );
  }
  assert.equal(ACADEMIC_BANDS.length, 7);
  assert.equal(PLACEMENT_BANDS.length, 6);
  assert.equal(OFFLINE_BANDS.length, 3);
  const allowedUnits = new Set(['occurrence', 'semester', 'gpa', 'offline', 'approved']);
  for (const item of CRITERIA) {
    assert(allowedUnits.has(item.unit));
    assert.equal(typeof item.studentAllowed, 'boolean');
    assert.equal(item.administrative, !item.studentAllowed);
    assert.equal(typeof item.reference, 'string');
    assert(item.name && (item.points === null || Number.isFinite(item.points)));
    assert(Object.isFrozen(item));
  }
  assert.equal(criterion('approved_adjustment').categoryId, null);
  assert.equal(criterion('approved_adjustment').reference, 'Điều 12.11');
});

test('Article 4 academic activities, publications and club assessment rates are exact', () => {
  const rates = {
    academic_competition_local: 10,
    academic_competition_university: 15,
    academic_competition_city: 20,
    academic_publication_wos_scopus: 20,
    academic_publication_recognized: 20,
    academic_international_presentation: 20,
    academic_seminar: 5,
    academic_online: 3,
    academic_cheering: 5,
    academic_organizer: 10,
    academic_club_excellent: 20,
    academic_club_good: 15,
    academic_club_completed: 10,
  };
  for (const [id, points] of Object.entries(rates)) assert.equal(criterion(id).points, points, id);
  assert.equal(criterion('academic_extracurricular_approved').points, null);
  assert.equal(criterion('academic_gpa').points, null);
  assert.equal(criterion('academic_gpa').component, 'gpa');
  assert.equal(criterion('academic_gpa').studentAllowed, false);
  assert.equal(criterion('academic_club_excellent').exclusiveGroup, 'academic_club_evaluation');
});

test('Article 5 keeps every signed penalty and derives disciplinary classification limits', () => {
  assert.equal(criterion('compliance_clean').points, 20);
  const penalties = {
    reminder: -5,
    criticism: -7,
    strict_criticism: -9,
    reprimand: -12,
    warning: -16,
    warning_second: -20,
    unexcused_absence: -5,
  };
  for (const [id, points] of Object.entries(penalties)) {
    const item = normalizeEntry({ criterionId: `compliance_${id}`, quantity: 2 });
    assert.equal(item.points, points * 2);
    assert.equal(item.categoryId, 'compliance');
    assert.equal(criterion(item.criterionId).studentAllowed, false);
  }
  assert.equal(criterion('compliance_reprimand').discipline, 'reprimand');
  assert.equal(criterion('compliance_warning_second').discipline, 'warning');
});

test('Articles 6–8 distinguish ordinary participation, community activities and administrative evaluations', () => {
  const rates = {
    movement_competition_local: 10,
    movement_competition_university: 15,
    movement_competition_city: 20,
    movement_cultural_exchange: 5,
    movement_heritage_education: 5,
    movement_online: 3,
    movement_cheering: 5,
    movement_political_social: 5,
    movement_organizer: 10,
    movement_club_excellent: 20,
    movement_club_good: 15,
    movement_club_completed: 10,
    community_campaign_excellent: 20,
    community_campaign_good: 15,
    community_campaign_completed: 10,
    community_organizer: 10,
    community_public_communication: 5,
    community_blood_hair_donation: 10,
    community_volunteer: 7,
    community_external_volunteer: 7,
    community_support: 3,
    community_education_outreach: 7,
    pioneer_leader_excellent: 20,
    pioneer_leader_good: 15,
    pioneer_leader_completed: 12,
    pioneer_group_leader_excellent: 15,
    pioneer_group_leader_good: 12,
    pioneer_group_leader_completed: 10,
    pioneer_club_board_excellent: 20,
    pioneer_club_board_good: 15,
    pioneer_club_board_completed: 10,
  };
  for (const [id, points] of Object.entries(rates)) assert.equal(criterion(id).points, points, id);
  for (const id of [
    'academic_club_good',
    'movement_club_good',
    'pioneer_leader_good',
    'pioneer_group_leader_good',
    'pioneer_club_board_good',
  ]) {
    assert.equal(criterion(id).unit, 'semester');
    assert.equal(criterion(id).studentAllowed, false);
    assert.equal(criterion(id).singleton, true);
  }
  for (const id of [
    'academic_seminar',
    'movement_online',
    'community_support',
    'community_campaign_excellent',
  ])
    assert.equal(criterion(id).studentAllowed, true);
  assert.equal(criterion('pioneer_contribution_approved').maxApprovedPoints, 20);
});

test('Article 9 includes every award rank and all contribution award levels with exact rates', () => {
  const matrix = [
    ['academic', 'faculty', [7, 6, 5, 4]],
    ['academic', 'university', [10, 9, 8, 7]],
    ['academic', 'city', [15, 14, 13, 12]],
    ['academic', 'ministry', [20, 19, 18, 17]],
    ['cultural', 'faculty', [7, 6, 5, 4]],
    ['cultural', 'university', [10, 9, 8, 7]],
    ['cultural', 'city', [15, 14, 13, 12]],
    ['cultural', 'national', [18, 17, 16, 15]],
    ['cultural', 'international', [20, 19, 18, 17]],
  ];
  for (const [kind, level, rates] of matrix) {
    for (const [index, rank] of ['first', 'second', 'third', 'consolation'].entries()) {
      const item = criterion(`bonus_${kind}_${level}_${rank}`);
      assert.equal(item.points, rates[index]);
      assert.equal(item.categoryId, 'bonus');
      assert.equal(item.studentAllowed, true);
    }
  }
  for (const [level, points] of [
    ['university', 10],
    ['provincial_city_sector', 15],
    ['ministry', 18],
    ['government', 20],
  ])
    assert.equal(criterion(`bonus_contribution_${level}`).points, points);
});

test('GPA conversion respects all lower bounds and adjacent values without rounding', () => {
  for (const [grade, expected] of [
    [0, 0],
    [3.999999, 0],
    [4, 0],
    [4.999999, 0],
    [5, 5],
    [5.999999, 5],
    [6, 6],
    [6.999999, 6],
    [7, 7],
    [7.999999, 7],
    [8, 8],
    [8.999999, 8],
    [9, 10],
    [10, 10],
    ['9.0', 10],
  ])
    assert.equal(academicPoints(grade), expected, String(grade));
});

test('placement conversion respects every Article 10 grade band', () => {
  for (const [grade, expected] of [
    [0, 0],
    [4.999999, 0],
    [5, 40],
    [5.999999, 40],
    [6, 50],
    [6.999999, 50],
    [7, 60],
    [7.999999, 60],
    [8, 70],
    [8.999999, 70],
    [9, 80],
    [10, 80],
  ])
    assert.equal(placementPoints(grade), expected, String(grade));
});

test('offline counts award nothing below seven and use the 7/11/15 boundaries', () => {
  for (const [count, expected] of [
    [0, 0],
    [6, 0],
    [7, 8],
    [10, 8],
    [11, 10],
    [14, 10],
    [15, 12],
    [10000, 12],
  ])
    assert.equal(offlinePoints(count), expected, String(count));
  for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', true, null])
    invalid(() => offlinePoints(count));
});

test('grade helpers reject out-of-range, blank, non-numeric and non-finite values', () => {
  for (const value of [
    -0.01,
    10.001,
    NaN,
    Infinity,
    '',
    ' ',
    'bad',
    undefined,
    null,
    true,
    {},
    [],
  ]) {
    invalid(() => academicPoints(value));
    invalid(() => placementPoints(value));
  }
});

test('normalization calculates actual occurrence totals and preserves negative raw entries', () => {
  const input = { criterionId: ' academic_seminar ', quantity: '3', title: 'Buổi chuyên đề' };
  const normalized = normalizeEntry(input, { student: true });
  assert.equal(normalized.points, 15);
  assert.equal(normalized.quantity, 3);
  assert.equal(normalized.categoryId, 'academic');
  assert.equal(normalized.title, input.title);
  assert.equal(input.criterionId, ' academic_seminar ');
  assert.equal(normalizeEntry({ criterionId: 'academic_seminar', quantity: 100 }).points, 500);
  assert.equal(
    normalizeEntry({ criterionId: 'compliance_warning_second', quantity: 100 }).points,
    -2000,
  );
  assert.equal(normalizeEntry({ criterionId: 'academic_gpa', quantity: 9 }).points, 10);
  assert.equal(
    normalizeEntry({ criterionId: 'pioneer_offline_participation', quantity: 11 }).points,
    10,
  );
});

test('CSV-shaped blank optional columns derive category and default only occurrence/semester quantities', () => {
  const row = {
    criterionId: 'community_blood_hair_donation',
    categoryId: '',
    quantity: '',
    points: '',
    approvalReference: '',
  };
  assert.deepEqual(normalizeEntry(row), {
    ...row,
    categoryId: 'community',
    quantity: 1,
    points: 10,
    discipline: 'none',
  });
  assert.equal(
    normalizeEntry({
      criterionId: 'compliance_clean',
      categoryId: '  ',
      quantity: null,
      points: null,
    }).points,
    20,
  );
  invalid(() => normalizeEntry({ criterionId: 'academic_gpa', quantity: '' }));
  invalid(() => normalizeEntry({ criterionId: 'pioneer_offline_participation', quantity: null }));
});

test('normalization rejects invented rates, inconsistent categories and invalid quantities', () => {
  for (const input of [
    null,
    [],
    {},
    { criterionId: 'not-in-regulation' },
    { criterionId: 'academic_seminar', categoryId: 'bonus' },
    { criterionId: 'academic_seminar', points: 6 },
    { criterionId: 'academic_seminar', quantity: 0 },
    { criterionId: 'academic_seminar', quantity: 101 },
    { criterionId: 'academic_seminar', quantity: 1.5 },
    { criterionId: 'academic_seminar', quantity: 'bad' },
    { criterionId: 'compliance_clean', quantity: 2 },
    { criterionId: 'academic_gpa', quantity: 11 },
    { criterionId: 'pioneer_offline_participation', quantity: -1 },
  ])
    invalid(() => normalizeEntry(input));
});

test('approved entries require explicit document and points; exceptional category is never invented', () => {
  const approved = normalizeEntry({
    criterionId: 'academic_extracurricular_approved',
    points: 6.5,
    approvalReference: ' VB-01/2026 ',
  });
  assert.equal(approved.categoryId, 'academic');
  assert.equal(approved.quantity, 1);
  assert.equal(approved.approvalReference, 'VB-01/2026');
  assert.equal(approved.points, 6.5);
  assert.equal(
    normalizeEntry({
      criterionId: 'approved_adjustment',
      categoryId: 'community',
      points: 4,
      approvalReference: 'Quyết định BGH 01',
    }).categoryId,
    'community',
  );
  assert.equal(
    normalizeEntry({
      criterionId: 'pioneer_contribution_approved',
      points: 20,
      approvalReference: 'Đánh giá đơn vị',
    }).points,
    20,
  );
  for (const input of [
    { criterionId: 'academic_extracurricular_approved', points: 5 },
    { criterionId: 'academic_extracurricular_approved', approvalReference: 'VB01', points: '' },
    { criterionId: 'academic_extracurricular_approved', approvalReference: 'VB01', points: -1 },
    {
      criterionId: 'academic_extracurricular_approved',
      approvalReference: 'VB01',
      points: 5,
      quantity: 2,
    },
    { criterionId: 'approved_adjustment', points: 5, approvalReference: 'VB01' },
    { criterionId: 'approved_adjustment', categoryId: '', points: 5, approvalReference: 'VB01' },
    { criterionId: 'pioneer_contribution_approved', points: 20.01, approvalReference: 'VB01' },
  ])
    invalid(() => normalizeEntry(input));
});

test('students may claim earned activities/awards but cannot assign grades, discipline, roles or approved rates', () => {
  for (const id of [
    'academic_seminar',
    'community_blood_hair_donation',
    'bonus_academic_ministry_first',
  ])
    assert.doesNotThrow(() => normalizeEntry({ criterionId: id }, { student: true }));
  for (const id of [
    'academic_gpa',
    'compliance_clean',
    'compliance_warning',
    'academic_club_excellent',
    'movement_club_good',
    'pioneer_leader_good',
    'pioneer_offline_participation',
    'approved_adjustment',
  ])
    invalid(() =>
      normalizeEntry(
        { criterionId: id, quantity: 1, points: 1, categoryId: 'bonus', approvalReference: 'VB01' },
        { student: true },
      ),
    );
});

test('classification uses exact boundaries and keeps scores below zero valid', () => {
  for (const [score, label] of [
    [100, 'Xuất sắc'],
    [90, 'Xuất sắc'],
    [89.99999, 'Tốt'],
    [80, 'Tốt'],
    [79.99999, 'Khá'],
    [65, 'Khá'],
    [64.99999, 'Trung bình'],
    [50, 'Trung bình'],
    [49.99999, 'Yếu'],
    [35, 'Yếu'],
    [34.99999, 'Kém'],
    [0, 'Kém'],
    [-25, 'Kém'],
    [-1e10, 'Kém'],
  ])
    assert.equal(classifyScore(score), label);
  for (const score of [null, undefined, '', NaN, Infinity]) invalid(() => classifyScore(score));
});

test('discipline caps classification, never the original numeric score, and supports no-assessment states', () => {
  const score = 98;
  assert.equal(classifyScore(score, 'reprimand'), 'Khá');
  assert.equal(classifyScore(score, 'warning'), 'Trung bình');
  assert.equal(score, 98);
  assert.equal(classifyScore(34, 'warning'), 'Kém');
  assert.equal(classifyScore(49, 'reprimand'), 'Yếu');
  assert.equal(classifyScore(null, 'suspended'), 'Không đánh giá');
  assert.equal(classifyScore(null, 'expelled'), 'Không đánh giá');
  for (const discipline of ['unknown', '__proto__', 'constructor'])
    invalid(() => classifyScore(90, discipline));
});

test('discipline is derived from criterion and forged ordinary-entry status is discarded', () => {
  assert.equal(disciplineForEntries([{ criterionId: 'compliance_reminder' }]), 'none');
  assert.equal(
    disciplineForEntries([
      { criterionId: 'compliance_reprimand' },
      { criterionId: 'compliance_warning_second' },
    ]),
    'warning',
  );
  assert.equal(
    disciplineForEntries([{ criterionId: 'academic_seminar', discipline: 'expelled' }]),
    'none',
  );
  assert.equal(
    normalizeEntry({ criterionId: 'academic_seminar', discipline: 'expelled' }).discipline,
    'none',
  );
  assert.equal(disciplineForEntries([{ discipline: 'suspended' }]), 'suspended');
  invalid(() => disciplineForEntries({}));
  invalid(() => disciplineForEntries([{ discipline: '__proto__' }]));
});

test('annual result requires both official semesters and distinguishes actual zero from missing data', () => {
  const first = semester(1, 0),
    second = semester(2, 100);
  assert.equal(annualResult([first, second]).officialAverage, 50);
  assert.equal(annualResult([first, second]).classification, 'Trung bình');
  const incomplete = annualResult([first, { ...second, hasOfficialData: false, officialTotal: 0 }]);
  assert.equal(incomplete.evaluationStatus, 'incomplete');
  assert.equal(incomplete.officialAverage, null);
  assert.equal(incomplete.observedAverage, 0);
  assert.equal(incomplete.missingCount, 1);
  assert.equal(annualResult([]).evaluationStatus, 'no_data');
  assert.equal(annualResult([first]).officialAverage, null);
  assert.equal(
    annualResult([first, { ...second, discipline: 'suspended' }]).evaluationStatus,
    'not_evaluated',
  );
});

test('annual result does not round before classification or reuse a semester/cross years', () => {
  const result = annualResult([semester(1, 89.9998), semester(2, 90)]);
  assert.equal(result.officialAverage, 89.9999);
  assert.equal(result.classification, 'Tốt');
  invalid(() => annualResult([semester(1, 50), semester(1, 60)]));
  invalid(() => annualResult([semester(1, 50), semester(3, 60)]));
  invalid(() => annualResult([null]));
  invalid(() => annualResult([semester(1, 1), semester(2, 2), semester(3, 3)]));
});

test('ordinary course averages standard semesters and excludes late activity while preserving its record', () => {
  const results = [
    semester(1, 40, {}, 2024),
    semester(2, 50, {}, 2024),
    semester(3, 40, {}, 2024),
    semester(4, 50, {}, 2024),
    semester(5, 100, {}, 2024),
  ];
  const result = courseResult(results, { cohortYear: 2024, standardSemesters: 4 });
  assert.equal(result.officialAverage, 45);
  assert.equal(result.graduationEligible, false);
  assert.equal(result.additionalActivitiesRequired, 3);
  assert.equal(result.additionalPointsRequired, null);
  assert.deepEqual(result.excludedSemesters, [results[4].semester]);
  assert.equal(results[4].officialTotal, 100);
});

test('cohorts from 2025 require exact missing points times program semester count', () => {
  const results = Array.from({ length: 8 }, (_, i) => semester(i + 1, 49.75));
  const result = courseResult(results, { cohortYear: 2025, standardSemesters: 8 });
  assert.equal(result.officialAverage, 49.75);
  assert.equal(result.additionalPointsRequired, 2);
  assert.equal(result.additionalActivitiesRequired, null);
  assert.equal(result.graduationEligible, false);
  assert.equal(
    courseResult(
      results.map((item) => ({ ...item, officialTotal: 50 })),
      { cohortYear: 2025, standardSemesters: 8 },
    ).graduationEligible,
    true,
  );
});

test('missing course semesters do not become zero or produce a graduation decision', () => {
  const result = courseResult([semester(1, 90), semester(2, 90)], {
    cohortYear: 2025,
    standardSemesters: 8,
  });
  assert.equal(result.evaluationStatus, 'incomplete');
  assert.equal(result.officialAverage, null);
  assert.equal(result.observedAverage, 90);
  assert.equal(result.missingCount, 6);
  assert.equal(result.graduationEligible, null);
  assert.equal(result.additionalPointsRequired, null);
  assert.equal(
    courseResult([], { cohortYear: 2025, standardSemesters: 8 }).evaluationStatus,
    'no_data',
  );
});

test('early graduation uses studied semesters and ignores future unstudied placeholders', () => {
  const result = courseResult(
    [
      semester(1, 40),
      semester(2, 50),
      semester(3, 60),
      semester(4, 0, { studied: false, hasOfficialData: false }),
    ],
    { cohortYear: 2025, standardSemesters: 8, earlyGraduation: true },
  );
  assert.equal(result.complete, true);
  assert.equal(result.requiredSemesters, 3);
  assert.equal(result.officialAverage, 50);
  assert.equal(result.graduationEligible, true);
  assert.equal(
    courseResult([], { cohortYear: 2025, standardSemesters: 8, earlyGraduation: true })
      .evaluationStatus,
    'no_data',
  );
});

test('international linkage includes only TDTU semesters, including explicit stage length', () => {
  const results = [
    semester(1, 40, {}, 2020),
    semester(2, 60, {}, 2020),
    semester(3, 100, { atTdtu: false }, 2020),
    semester(4, 0, { atTdtu: false, hasOfficialData: false }, 2020),
  ];
  const result = courseResult(results, {
    cohortYear: 2020,
    standardSemesters: 4,
    program: 'international',
  });
  assert.equal(result.officialAverage, 50);
  assert.equal(result.graduationEligible, true);
  assert.equal(result.includedSemesters.length, 2);
  assert.equal(result.excludedSemesters.length, 2);
  const explicit = courseResult(results.slice(0, 2), {
    cohortYear: 2020,
    standardSemesters: 4,
    tdtuSemesters: 2,
    program: 'international',
  });
  assert.equal(explicit.officialAverage, null);
  assert.equal(explicit.complete, false);
  assert.equal(explicit.missingCount, 2);
  const unknown = courseResult(results.slice(0, 2), {
    cohortYear: 2020,
    standardSemesters: 4,
    program: 'international',
  });
  assert.equal(unknown.evaluationStatus, 'incomplete');
});

test('2017 graduation threshold starts from year two without silently inventing first-year scores', () => {
  const all = [
    semester(1, 0, {}, 2017),
    semester(2, 0, {}, 2017),
    semester(3, 60, {}, 2017),
    semester(4, 60, {}, 2017),
  ];
  const result = courseResult(all, { cohortYear: 2017, standardSemesters: 4 });
  assert.equal(result.officialAverage, 30);
  assert.equal(result.graduationAverage, 60);
  assert.equal(result.graduationEligible, true);
  const missingFirstYear = courseResult(all.slice(2), { cohortYear: 2017, standardSemesters: 4 });
  assert.equal(missingFirstYear.officialAverage, null);
  assert.equal(missingFirstYear.graduationComplete, true);
  assert.equal(missingFirstYear.graduationAverage, 60);
});

test('graduation applicability follows 2017 general and 2020 international cohort boundaries', () => {
  const old = courseResult([semester(1, 40, {}, 2016), semester(2, 40, {}, 2016)], {
    cohortYear: 2016,
    standardSemesters: 2,
  });
  assert.equal(old.graduationApplicable, false);
  assert.equal(old.graduationEligible, null);
  assert.equal(old.additionalActivitiesRequired, null);
  const internationalOld = courseResult([semester(1, 40, {}, 2019)], {
    cohortYear: 2019,
    standardSemesters: 1,
    program: 'international',
  });
  assert.equal(internationalOld.graduationApplicable, false);
  const internationalNew = courseResult([semester(1, 40, {}, 2020)], {
    cohortYear: 2020,
    standardSemesters: 1,
    program: 'international',
  });
  assert.equal(internationalNew.graduationApplicable, true);
  assert.equal(internationalNew.additionalActivitiesRequired, 3);
});

test('course validation rejects duplicate semester slots and invalid program metadata', () => {
  invalid(() =>
    courseResult([semester(1, 50), semester(1, 60)], { cohortYear: 2025, standardSemesters: 2 }),
  );
  invalid(() =>
    courseResult([semester(1, 50), { ...semester(2, 60), semesterIndex: 1 }], {
      cohortYear: 2025,
      standardSemesters: 2,
    }),
  );
  invalid(() => courseResult([null], { cohortYear: 2025, standardSemesters: 2 }));
  for (const options of [
    {},
    { cohortYear: 2025, standardSemesters: 0 },
    { cohortYear: 2025, standardSemesters: 2.5 },
    { cohortYear: 2025, standardSemesters: 2, tdtuSemesters: 3 },
  ])
    invalid(() => courseResult([], options));
});

test('early graduation cannot silently omit earlier missing semesters', () => {
  const result = courseResult([semester(3, 80), semester(4, 90)], {
    cohortYear: 2025,
    standardSemesters: 8,
    earlyGraduation: true,
  });
  assert.equal(result.complete, false);
  assert.equal(result.requiredSemesters, 4);
  assert.equal(result.officialAverage, null);
  assert.equal(result.graduationEligible, null);
  assert.deepEqual(result.missingSemesters, ['2025-2026-HK1', '2025-2026-HK2']);
  const confirmedLeave = courseResult([semester(1, 0, { studied: false }), semester(2, 50)], {
    cohortYear: 2025,
    standardSemesters: 8,
    earlyGraduation: true,
  });
  assert.equal(confirmedLeave.complete, true);
  assert.equal(confirmedLeave.officialAverage, 50);
  invalid(() =>
    courseResult([semester(9, 90)], {
      cohortYear: 2025,
      standardSemesters: 8,
      earlyGraduation: true,
    }),
  );
});
