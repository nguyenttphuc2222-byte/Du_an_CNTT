/** Pure scoring rules transcribed from the user-provided TDTU regulation PDF.
 * No automatic disciplinary action is performed by this module.
 */
export const RULE_VERSION = 'tdtu-2025-2026';
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const RULE_SOURCE = freeze({
  title: 'Quy chế đánh giá kết quả rèn luyện của sinh viên trình độ đại học hệ chính quy',
  institution: 'Trường Đại học Tôn Đức Thắng',
  effectiveFrom: '2025-2026',
  url: '/docs/quy-che-ren-luyen-tdtu.pdf',
  reference: 'Điều 16',
  pages: 10,
  pdfPages: 11,
  sourceType: 'user-provided-pdf',
  provenance:
    'Bản PDF do người dùng cung cấp có trang bìa bên thứ ba; bản này không kèm số quyết định ban hành.',
  notes: [
    'Quy chế chỉ quy định trần từng mục 20 điểm và tổng 100 điểm; không nêu sàn 0 điểm. Giữ nguyên điểm âm để đối chiếu.',
    'Quy chế không quy định cách làm tròn điểm trung bình. Công thức giữ giá trị tính toán, giao diện chỉ định dạng khi hiển thị.',
    'Kỷ luật từ khiển trách trở lên không ghi nhận mục tinh thần tiên phong, gương mẫu. Giới hạn xếp loại không tự thay đổi điểm số.',
    'Các điều kiện có quyết định, đánh giá hoặc phê duyệt cần hồ sơ của đơn vị có thẩm quyền; hệ thống không tự ban hành quyết định.',
  ],
});
export const CATEGORIES = freeze([
  {
    id: 'academic',
    name: 'Việc tham gia học tập và tham gia các hoạt động chuyên môn học thuật',
    maxPoints: 20,
    reference: 'Điều 4',
  },
  {
    id: 'compliance',
    name: 'Việc chấp hành nội quy, quy chế, quy định trong Trường',
    maxPoints: 20,
    reference: 'Điều 5',
  },
  {
    id: 'movement',
    name: 'Việc tham gia các hoạt động chính trị, xã hội, văn hóa, văn nghệ, thể thao; phòng chống tội phạm và các tệ nạn xã hội; hoạt động phong trào',
    maxPoints: 20,
    reference: 'Điều 6',
  },
  {
    id: 'community',
    name: 'Việc tham gia các hoạt động cộng đồng, công tác xã hội, công tác tình nguyện',
    maxPoints: 20,
    reference: 'Điều 7',
  },
  { id: 'pioneer', name: 'Tinh thần tiên phong, gương mẫu', maxPoints: 20, reference: 'Điều 8' },
  { id: 'bonus', name: 'Điểm thưởng', maxPoints: 20, reference: 'Điều 9' },
]);
export const CLASSIFICATIONS = freeze([
  { label: 'Xuất sắc', min: 90 },
  { label: 'Tốt', min: 80 },
  { label: 'Khá', min: 65 },
  { label: 'Trung bình', min: 50 },
  { label: 'Yếu', min: 35 },
  { label: 'Kém', min: -1e9 },
]);
export const ACADEMIC_BANDS = freeze([
  { min: 0, maxExclusive: 4, points: 0, label: 'Kém' },
  { min: 4, maxExclusive: 5, points: 0, label: 'Yếu' },
  { min: 5, maxExclusive: 6, points: 5, label: 'Trung bình' },
  { min: 6, maxExclusive: 7, points: 6, label: 'Trung bình Khá' },
  { min: 7, maxExclusive: 8, points: 7, label: 'Khá' },
  { min: 8, maxExclusive: 9, points: 8, label: 'Giỏi' },
  { min: 9, maxInclusive: 10, points: 10, label: 'Xuất sắc' },
]);
export const PLACEMENT_BANDS = freeze([
  { min: 0, maxExclusive: 5, points: 0 },
  { min: 5, maxExclusive: 6, points: 40 },
  { min: 6, maxExclusive: 7, points: 50 },
  { min: 7, maxExclusive: 8, points: 60 },
  { min: 8, maxExclusive: 9, points: 70 },
  { min: 9, maxInclusive: 10, points: 80 },
]);
export const OFFLINE_BANDS = freeze([
  { min: 7, maxInclusive: 10, points: 8 },
  { min: 11, maxInclusive: 14, points: 10 },
  { min: 15, maxInclusive: null, points: 12 },
]);

const criteria = [];
function criterion(id, categoryId, name, points, unit, studentAllowed, reference, extra = {}) {
  criteria.push({
    id,
    categoryId,
    name,
    points,
    unit,
    studentAllowed,
    administrative: !studentAllowed,
    reference,
    ...extra,
  });
}
function occurrence(id, categoryId, name, points, reference, extra = {}) {
  criterion(id, categoryId, name, points, 'occurrence', true, reference, extra);
}
function semester(id, categoryId, name, points, reference, extra = {}) {
  criterion(id, categoryId, name, points, 'semester', false, reference, {
    singleton: true,
    ...extra,
  });
}

occurrence(
  'academic_competition_local',
  'academic',
  'Tham gia thi học thuật, nghiên cứu khoa học, ý tưởng sáng tạo, khởi nghiệp cấp Lớp/Chi Đoàn/Chi Hội/Khoa/Phân hiệu',
  10,
  'Điều 4.1',
);
occurrence(
  'academic_competition_university',
  'academic',
  'Tham gia thi học thuật, nghiên cứu khoa học, ý tưởng sáng tạo, khởi nghiệp cấp Trường',
  15,
  'Điều 4.1',
);
occurrence(
  'academic_competition_city',
  'academic',
  'Tham gia thi học thuật, nghiên cứu khoa học, ý tưởng sáng tạo, khởi nghiệp cấp Thành trở lên',
  20,
  'Điều 4.1',
);
occurrence(
  'academic_publication_wos_scopus',
  'academic',
  'Có bài báo trên tạp chí WoS/Scopus hoặc kỷ yếu hội thảo khoa học quốc tế',
  20,
  'Điều 4.1',
);
occurrence(
  'academic_publication_recognized',
  'academic',
  'Có bài báo trên tạp chí thuộc danh mục Hội đồng Giáo sư Nhà nước công nhận, có điểm tối đa từ 0,5 trở lên',
  20,
  'Điều 4.1',
);
occurrence(
  'academic_international_presentation',
  'academic',
  'Tham gia báo cáo tại hội thảo khoa học quốc tế',
  20,
  'Điều 4.1',
);
occurrence(
  'academic_seminar',
  'academic',
  'Tham gia hội thảo khoa học, sinh hoạt chuyên đề, chia sẻ định hướng nghề nghiệp, tham quan thực tế nghề nghiệp ngoài chương trình học',
  5,
  'Điều 4.2',
);
occurrence(
  'academic_online',
  'academic',
  'Tham gia tìm hiểu học thuật trực tuyến cấp Khoa/Phân hiệu/Lớp/Chi Đoàn/Chi Hội',
  3,
  'Điều 4.3',
);
occurrence(
  'academic_cheering',
  'academic',
  'Tham gia cổ vũ, cổ động cuộc thi học thuật, nghiên cứu khoa học, ý tưởng sáng tạo, khởi nghiệp',
  5,
  'Điều 4.4',
);
occurrence(
  'academic_organizer',
  'academic',
  'Tham gia tổ chức hoạt động học thuật từ cấp Khoa/Phân hiệu trở lên, được đánh giá từ hoàn thành nhiệm vụ',
  10,
  'Điều 4.5',
);
for (const [level, label, points] of [
  ['excellent', 'xuất sắc', 20],
  ['good', 'tốt', 15],
  ['completed', '', 10],
]) {
  semester(
    `academic_club_${level}`,
    'academic',
    `Thành viên câu lạc bộ chuyên môn học thuật do Khoa/Phân hiệu thành lập: hoàn thành ${label ? label + ' ' : ''}nhiệm vụ`,
    points,
    'Điều 4.6',
    { exclusiveGroup: 'academic_club_evaluation' },
  );
}
criterion(
  'academic_extracurricular_approved',
  'academic',
  'Hoàn thành khóa học ngoại khóa, điểm theo văn bản được phê duyệt',
  null,
  'approved',
  false,
  'Điều 4.7',
  { approvalRequired: true },
);
criterion(
  'academic_gpa',
  'academic',
  'Kết quả học tập: quy đổi điểm trung bình học kỳ thang 10',
  null,
  'gpa',
  false,
  'Điều 4.8',
  { singleton: true, component: 'gpa', bands: ACADEMIC_BANDS },
);
semester(
  'compliance_clean',
  'compliance',
  'Sinh viên không vi phạm nội quy, quy định của Trường, pháp luật Nhà nước',
  20,
  'Điều 5.1',
  { component: 'compliance' },
);
for (const [id, name, points, discipline] of [
  ['reminder', 'Nhắc nhở', -5, 'none'],
  ['criticism', 'Phê bình', -7, 'none'],
  ['strict_criticism', 'Nghiêm khắc phê bình', -9, 'none'],
  ['reprimand', 'Khiển trách', -12, 'reprimand'],
  ['warning', 'Cảnh cáo', -16, 'warning'],
  ['warning_second', 'Cảnh cáo lần 2', -20, 'warning'],
])
  criterion(
    `compliance_${id}`,
    'compliance',
    `Xử lý vi phạm: ${name}`,
    points,
    'occurrence',
    false,
    'Điều 5.2',
    { discipline },
  );
criterion(
  'compliance_unexcused_absence',
  'compliance',
  'Không chấp hành điều động, phân công, thông báo của Trường/Khoa/Phân hiệu hoặc không tham gia hoạt động đã đăng ký',
  -5,
  'occurrence',
  false,
  'Điều 5.3',
);

for (const [level, label, points] of [
  ['local', 'Lớp/Chi Đoàn/Chi Hội/Khoa/Phân hiệu', 10],
  ['university', 'Trường', 15],
  ['city', 'Thành trở lên', 20],
]) {
  occurrence(
    `movement_competition_${level}`,
    'movement',
    `Tham gia thi văn hóa, văn nghệ, thể thao, phong trào cấp ${label}`,
    points,
    'Điều 6.1',
  );
}
occurrence(
  'movement_cultural_exchange',
  'movement',
  'Tham gia giao lưu văn hóa quốc tế, lễ hội, tuần lễ, tìm hiểu văn hóa do Trường/Khoa/Phân hiệu/Lớp phát động hoặc tổ chức',
  5,
  'Điều 6.2',
);
occurrence(
  'movement_heritage_education',
  'movement',
  'Tham gia giáo dục truyền thống: địa chỉ đỏ, bảo tàng, nhà tưởng niệm, di tích lịch sử do Trường/Khoa/Phân hiệu/Lớp phát động hoặc tổ chức',
  5,
  'Điều 6.3',
);
occurrence(
  'movement_online',
  'movement',
  'Tham gia tìm hiểu văn hóa, văn nghệ, thể thao, phong trào trực tuyến do Trường/Khoa/Phân hiệu/Lớp phát động hoặc tổ chức',
  3,
  'Điều 6.4',
);
occurrence(
  'movement_cheering',
  'movement',
  'Tham gia cổ vũ, cổ động hoạt động văn nghệ, thể dục thể thao',
  5,
  'Điều 6.5',
);
occurrence(
  'movement_political_social',
  'movement',
  'Tham gia sinh hoạt chính trị, xã hội, phòng chống tệ nạn xã hội',
  5,
  'Điều 6.6',
);
occurrence(
  'movement_organizer',
  'movement',
  'Tham gia tổ chức văn nghệ, thể dục thể thao, phong trào từ cấp Khoa/Phân hiệu trở lên, được đánh giá từ hoàn thành nhiệm vụ',
  10,
  'Điều 6.7',
);
for (const [level, label, points] of [
  ['excellent', 'xuất sắc', 20],
  ['good', 'tốt', 15],
  ['completed', '', 10],
]) {
  semester(
    `movement_club_${level}`,
    'movement',
    `Thành viên CLB/Đội/Nhóm văn hóa, văn nghệ, thể thao; đội tự quản, cờ đỏ, cộng tác viên: hoàn thành ${label ? label + ' ' : ''}nhiệm vụ`,
    points,
    'Điều 6.8',
    { exclusiveGroup: 'movement_club_evaluation' },
  );
}
for (const [level, label, points] of [
  ['excellent', 'xuất sắc', 20],
  ['good', 'tốt', 15],
  ['completed', '', 10],
]) {
  occurrence(
    `community_campaign_${level}`,
    'community',
    `Tham gia Tiếp sức mùa thi, Xuân tình nguyện, Mùa hè xanh hoặc chiến dịch do Trường/Khoa/Phân hiệu tổ chức: hoàn thành ${label ? label + ' ' : ''}nhiệm vụ`,
    points,
    'Điều 7.1',
    { requiresEvaluation: true },
  );
}
occurrence(
  'community_organizer',
  'community',
  'Tham gia tổ chức tình nguyện, hoạt động vì cộng đồng từ cấp Khoa/Phân hiệu trở lên, được đánh giá từ hoàn thành nhiệm vụ',
  10,
  'Điều 7.2',
);
occurrence(
  'community_public_communication',
  'community',
  'Tuyên truyền chủ trương của Đảng, chính sách pháp luật của Nhà nước đến cộng đồng, xã hội',
  5,
  'Điều 7.3',
);
occurrence(
  'community_blood_hair_donation',
  'community',
  'Hiến máu tình nguyện hoặc hiến tặng tóc cho bệnh nhân ung thư',
  10,
  'Điều 7.4',
);
occurrence(
  'community_volunteer',
  'community',
  'Tham gia Chủ nhật xanh, Thứ 7 tình nguyện hoặc hoạt động cộng đồng, công tác xã hội, tình nguyện',
  7,
  'Điều 7.5',
);
occurrence(
  'community_external_volunteer',
  'community',
  'Tham gia tình nguyện ngoài trường có minh chứng tham gia',
  7,
  'Điều 7.5',
);
occurrence(
  'community_support',
  'community',
  'Tiếp sức đến trường, vì đàn em thân yêu, vì biên giới biển đảo; chia sẻ, giúp đỡ người khó khăn, cộng đồng; hưởng ứng vận động, ủng hộ người nghèo, đồng bào thiên tai, lũ lụt',
  3,
  'Điều 7.6',
);
occurrence(
  'community_education_outreach',
  'community',
  'Kết nối, chia sẻ cơ hội học tập giúp học sinh, lưu học sinh tiếp cận thông tin chính xác, đầy đủ về ngành học, chương trình và môi trường học tập',
  7,
  'Điều 7.7',
);

for (const [group, roleName, values, reference] of [
  [
    'leader',
    'Lớp trưởng; Bí thư/Phó bí thư Chi đoàn; Chi hội trưởng/Chi hội phó; BCH Đoàn/Hội Trường hoặc Khoa/Phân hiệu',
    [20, 15, 12],
    'Điều 8.1',
  ],
  ['group_leader', 'Tổ trưởng, Ủy viên BCH Chi Đoàn/Hội', [15, 12, 10], 'Điều 8.2'],
  [
    'club_board',
    'Ban điều hành/Ban chủ nhiệm CLB/Đội/Nhóm; Ban liên lạc Lưu học sinh do đơn vị trong Trường thành lập',
    [20, 15, 10],
    'Điều 8.3',
  ],
]) {
  for (const [index, [level, label]] of [
    ['excellent', 'xuất sắc'],
    ['good', 'tốt'],
    ['completed', ''],
  ].entries()) {
    semester(
      `pioneer_${group}_${level}`,
      'pioneer',
      `${roleName}: hoàn thành ${label ? label + ' ' : ''}nhiệm vụ`,
      values[index],
      reference,
      { exclusiveGroup: `pioneer_${group}_evaluation` },
    );
  }
}
criterion(
  'pioneer_offline_participation',
  'pioneer',
  'Chủ động, tích cực tham gia hoạt động trực tiếp chung của Lớp/Khoa/Phân hiệu/Trường: 7–10 lần được 8 điểm; 11–14 lần được 10 điểm; từ 15 lần được 12 điểm',
  null,
  'offline',
  false,
  'Điều 8.4',
  { singleton: true, component: 'offline', bands: OFFLINE_BANDS },
);
criterion(
  'pioneer_contribution_approved',
  'pioneer',
  'Đóng góp tích cực cho sự phát triển của Khoa/Phân hiệu/Phòng/Ban/Trung tâm/Viện, do đơn vị đánh giá từng học kỳ',
  null,
  'approved',
  false,
  'Điều 8.5',
  { singleton: true, maxApprovedPoints: 20, approvalRequired: true },
);

const ranks = [
  ['first', 'Giải nhất'],
  ['second', 'Giải nhì'],
  ['third', 'Giải ba'],
  ['consolation', 'Giải khuyến khích'],
];
for (const [level, label, values, row] of [
  ['faculty', 'Khoa/Phân hiệu', [7, 6, 5, 4], 1],
  ['university', 'Trường', [10, 9, 8, 7], 2],
  ['city', 'Thành', [15, 14, 13, 12], 3],
  ['ministry', 'Bộ', [20, 19, 18, 17], 4],
])
  for (const [index, [rank, rankLabel]] of ranks.entries())
    occurrence(
      `bonus_academic_${level}_${rank}`,
      'bonus',
      `Giấy khen NCKH/cuộc thi chuyên môn cấp ${label}: ${rankLabel}`,
      values[index],
      `Điều 9.${row}`,
      { awardLevel: level, awardRank: rank },
    );
for (const [level, label, values, row] of [
  ['faculty', 'Khoa/Phân hiệu', [7, 6, 5, 4], 5],
  ['university', 'Trường', [10, 9, 8, 7], 6],
  ['city', 'Thành', [15, 14, 13, 12], 7],
  ['national', 'Toàn quốc', [18, 17, 16, 15], 8],
  ['international', 'Quốc tế', [20, 19, 18, 17], 9],
])
  for (const [index, [rank, rankLabel]] of ranks.entries())
    occurrence(
      `bonus_cultural_${level}_${rank}`,
      'bonus',
      `Thành tích văn hóa, văn nghệ, thể dục thể thao cấp ${label}: ${rankLabel}`,
      values[index],
      `Điều 9.${row}`,
      { awardLevel: level, awardRank: rank },
    );
for (const [level, label, points] of [
  ['university', 'Giấy khen cấp Trường', 10],
  ['provincial_city_sector', 'Giấy khen cấp Tỉnh, Thành, Ngành', 15],
  ['ministry', 'Giấy khen cấp Bộ; Trung ương Đoàn, Hội hoặc tương đương', 18],
  ['government', 'Bằng khen Chính phủ', 20],
])
  occurrence(
    `bonus_contribution_${level}`,
    'bonus',
    `${label} về đóng góp tích cực cho sự phát triển của Trường, công tác xã hội, cộng đồng, tình nguyện`,
    points,
    'Điều 9.10',
  );
criterion(
  'approved_adjustment',
  null,
  'Ưu tiên, động viên, cộng điểm cho hoàn cảnh đặc biệt theo đề xuất của Khoa/Phân hiệu được Ban Giám hiệu phê duyệt; chọn mục điểm theo văn bản',
  null,
  'approved',
  false,
  'Điều 12.11',
  { approvalRequired: true, explicitCategoryRequired: true },
);
export const CRITERIA = freeze(criteria);
const criteriaById = new Map(CRITERIA.map((item) => [item.id, item]));
const categoryIds = new Set(CATEGORIES.map((item) => item.id));
function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function omitted(value) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}
function numeric(value, label) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === '' ||
    !Number.isFinite(Number(value))
  )
    invalid(`${label} phải là số hữu hạn.`);
  return Number(value);
}
function gradeValue(value) {
  const grade = numeric(value, 'Điểm học tập');
  if (grade < 0 || grade > 10) invalid('Điểm học tập phải từ 0 đến 10.');
  return grade;
}
export function academicPoints(grade) {
  grade = gradeValue(grade);
  return grade >= 9 ? 10 : grade >= 8 ? 8 : grade >= 7 ? 7 : grade >= 6 ? 6 : grade >= 5 ? 5 : 0;
}
export function placementPoints(grade) {
  grade = gradeValue(grade);
  return grade >= 9
    ? 80
    : grade >= 8
      ? 70
      : grade >= 7
        ? 60
        : grade >= 6
          ? 50
          : grade >= 5
            ? 40
            : 0;
}
export function offlinePoints(count) {
  count = numeric(count, 'Số hoạt động trực tiếp');
  if (!Number.isSafeInteger(count) || count < 0)
    invalid('Số hoạt động trực tiếp phải là số nguyên không âm.');
  return count >= 15 ? 12 : count >= 11 ? 10 : count >= 7 ? 8 : 0;
}
export function normalizeEntry(input, { student = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('Khoản điểm phải là một đối tượng dữ liệu.');
  const criterionId = typeof input.criterionId === 'string' ? input.criterionId.trim() : '';
  const definition = criteriaById.get(criterionId);
  if (!definition) invalid('Tiêu chí điểm không tồn tại trong quy chế.');
  if (student && !definition.studentAllowed)
    invalid('Tiêu chí này phải do cán bộ xác nhận, sinh viên không được tự kê khai.');
  const categoryId = definition.explicitCategoryRequired
    ? String(input.categoryId || '').trim()
    : definition.categoryId;
  if (!categoryIds.has(categoryId)) invalid('Phải chỉ rõ mục điểm hợp lệ trong văn bản phê duyệt.');
  if (!omitted(input.categoryId) && String(input.categoryId).trim() !== categoryId)
    invalid('Mục điểm không khớp với tiêu chí đã chọn.');
  const suppliedQuantity = omitted(input.quantity)
    ? definition.unit === 'occurrence' ||
      definition.unit === 'semester' ||
      definition.unit === 'approved'
      ? 1
      : undefined
    : input.quantity;
  const quantity = numeric(suppliedQuantity, 'Số lượng/giá trị tiêu chí');
  let points;
  let approvalReference =
    typeof input.approvalReference === 'string' ? input.approvalReference.trim() : '';
  if (definition.unit === 'occurrence') {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      invalid('Số lần phải là số nguyên từ 1 đến 100.');
    points = definition.points * quantity;
  } else if (definition.unit === 'semester') {
    if (quantity !== 1) invalid('Tiêu chí theo học kỳ chỉ được ghi nhận một lần trong học kỳ.');
    points = definition.points;
  } else if (definition.unit === 'gpa') points = academicPoints(quantity);
  else if (definition.unit === 'offline') points = offlinePoints(quantity);
  else {
    if (quantity !== 1)
      invalid('Khoản được phê duyệt phải ghi nhận riêng theo văn bản, số lượng bằng 1.');
    if (!approvalReference) invalid('Cần số hiệu hoặc tham chiếu văn bản phê duyệt điểm.');
    points = numeric(input.points, 'Điểm theo văn bản phê duyệt');
    if (
      points < 0 ||
      (definition.maxApprovedPoints !== undefined && points > definition.maxApprovedPoints)
    )
      invalid(
        `Điểm phê duyệt phải không âm${definition.maxApprovedPoints !== undefined ? ` và không vượt ${definition.maxApprovedPoints}` : ''}.`,
      );
  }
  if (
    definition.unit !== 'approved' &&
    !omitted(input.points) &&
    numeric(input.points, 'Điểm') !== points
  )
    invalid('Điểm không khớp thang điểm và số lượng của tiêu chí trong quy chế.');
  return {
    ...input,
    criterionId,
    categoryId,
    quantity,
    points,
    approvalReference,
    discipline: definition.discipline || 'none',
  };
}
const DISCIPLINE_RANK = freeze({ none: 0, reprimand: 1, warning: 2, suspended: 3, expelled: 4 });
export function disciplineForEntries(entries = []) {
  if (!Array.isArray(entries)) invalid('Danh sách khoản điểm không hợp lệ.');
  let result = 'none';
  for (const entry of entries) {
    const definition = criteriaById.get(entry?.criterionId);
    const discipline =
      definition?.discipline || (definition ? 'none' : entry?.discipline) || 'none';
    if (!Object.hasOwn(DISCIPLINE_RANK, discipline)) invalid('Mức kỷ luật không hợp lệ.');
    if (DISCIPLINE_RANK[discipline] > DISCIPLINE_RANK[result]) result = discipline;
  }
  return result;
}
export function classifyScore(score, discipline = 'none') {
  if (!Object.hasOwn(DISCIPLINE_RANK, discipline)) invalid('Mức kỷ luật không hợp lệ.');
  if (discipline === 'suspended' || discipline === 'expelled') return 'Không đánh giá';
  score = numeric(score, 'Điểm rèn luyện');
  const label = CLASSIFICATIONS.find((item) => score >= item.min)?.label || 'Kém';
  const index = CLASSIFICATIONS.findIndex((item) => item.label === label);
  if (discipline === 'warning' && index < 3) return 'Trung bình';
  if (discipline === 'reprimand' && index < 2) return 'Khá';
  return label;
}

function summaryState(item) {
  const status = item?.evaluationStatus;
  const excluded =
    status === 'not_evaluated' ||
    item?.officialClassification === 'Không đánh giá' ||
    ['suspended', 'expelled'].includes(item?.discipline);
  if (excluded) return 'not_evaluated';
  if (!item?.hasOfficialData) return 'no_data';
  if (status && status !== 'evaluated') return 'incomplete';
  return Number.isFinite(item.officialTotal) ? 'evaluated' : 'incomplete';
}
function aggregate(items, completeExpected, missingSemesters = []) {
  const evaluated = items.filter((item) => summaryState(item) === 'evaluated');
  const complete =
    items.length === completeExpected &&
    evaluated.length === completeExpected &&
    completeExpected > 0;
  const observedAverage = evaluated.length
    ? evaluated.reduce((sum, item) => sum + item.officialTotal, 0) / evaluated.length
    : null;
  const officialAverage = complete ? observedAverage : null;
  const evaluationStatus = complete
    ? 'evaluated'
    : items.some((item) => summaryState(item) === 'not_evaluated')
      ? 'not_evaluated'
      : evaluated.length
        ? 'incomplete'
        : items.some((item) => item?.hasOfficialData)
          ? 'incomplete'
          : 'no_data';
  const classification = officialAverage === null ? null : classifyScore(officialAverage);
  return {
    evaluationStatus,
    complete,
    officialAverage,
    officialTotal: officialAverage,
    observedAverage,
    classification,
    officialClassification: classification,
    requiredSemesters: completeExpected,
    evaluatedSemesters: evaluated.length,
    missingSemesters,
    missingCount: Math.max(0, completeExpected - evaluated.length),
  };
}
export function annualResult(semesterSummaries) {
  if (!Array.isArray(semesterSummaries) || semesterSummaries.length > 2)
    invalid('Kết quả năm học cần tối đa hai học kỳ chính thức cùng năm.');
  if (semesterSummaries.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    invalid('Dữ liệu học kỳ phải là đối tượng kết quả.');
  const semesterIds = semesterSummaries.map((item) => item?.semester).filter(Boolean);
  if (new Set(semesterIds).size !== semesterIds.length)
    invalid('Hai học kỳ năm học không được trùng nhau.');
  const parsed = semesterIds.map((value) => /^(\d{4})-(\d{4})-HK([12])$/.exec(value));
  if (parsed.length === 2 && parsed.every(Boolean) && parsed[0][1] !== parsed[1][1])
    invalid('Hai học kỳ phải thuộc cùng một năm học.');
  const missing = semesterSummaries
    .filter((item) => summaryState(item) !== 'evaluated')
    .map((item) => item.semester || 'Học kỳ chưa có dữ liệu');
  while (
    missing.length <
    2 - semesterSummaries.filter((item) => summaryState(item) === 'evaluated').length
  )
    missing.push('Học kỳ chưa có dữ liệu');
  return {
    ...aggregate(semesterSummaries, 2, missing),
    notes: [
      'Điều 12.2: trung bình chung hai học kỳ của năm học; thiếu dữ liệu không thay bằng 0.',
      'Không làm tròn trước khi phân loại.',
    ],
  };
}
function internationalProgram(program) {
  return [
    'international',
    'international_link',
    'international_linkage',
    'linked_international',
    'liên kết quốc tế',
  ].includes(program);
}
function semesterIndex(item, cohortYear, fallback) {
  if (Number.isInteger(item?.semesterIndex)) return item.semesterIndex;
  const parsed = /^(\d{4})-\d{4}-HK([12])$/.exec(item?.semester || '');
  return parsed && cohortYear ? (Number(parsed[1]) - cohortYear) * 2 + Number(parsed[2]) : fallback;
}
function semesterName(index, cohortYear) {
  if (!cohortYear) return `Học kỳ chuẩn số ${index}`;
  const year = cohortYear + Math.floor((index - 1) / 2);
  return `${year}-${year + 1}-HK${index % 2 ? 1 : 2}`;
}
export function courseResult(
  semesters,
  {
    cohortYear,
    standardSemesters,
    program = 'standard',
    earlyGraduation = false,
    tdtuSemesters,
  } = {},
) {
  if (
    !Array.isArray(semesters) ||
    semesters.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  )
    invalid('Danh sách kết quả học kỳ không hợp lệ.');
  if (!Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200)
    invalid('Cần năm tuyển sinh hợp lệ để xác định điều kiện toàn khóa.');
  if (!Number.isInteger(standardSemesters) || standardSemesters < 1 || standardSemesters > 40)
    invalid('Số học kỳ chương trình chuẩn phải là số nguyên từ 1 đến 40.');
  if (
    tdtuSemesters !== undefined &&
    (!Number.isInteger(tdtuSemesters) || tdtuSemesters < 1 || tdtuSemesters > standardSemesters)
  )
    invalid('Số học kỳ tại TDTU phải từ 1 đến số học kỳ chương trình chuẩn.');
  const international = internationalProgram(program);
  const ordered = semesters.map((item, position) => ({
    ...item,
    _index: semesterIndex(item, cohortYear, position + 1),
  }));
  const seen = new Set(),
    seenIndexes = new Set();
  for (const item of ordered) {
    const key = item.semester || `index-${item._index}`;
    if (seen.has(key) || seenIndexes.has(item._index))
      invalid('Học kỳ trong kết quả toàn khóa bị trùng.');
    if (!Number.isInteger(item._index) || item._index < 1)
      invalid('Thứ tự học kỳ phải là số nguyên dương.');
    seen.add(key);
    seenIndexes.add(item._index);
  }
  const ordinary = ordered.filter(
    (item) =>
      item.isStandard !== false &&
      item.withinStandard !== false &&
      item.isLate !== true &&
      item._index >= 1 &&
      item._index <= standardSemesters,
  );
  const scope = earlyGraduation ? ordered.filter((item) => item.studied !== false) : ordinary;
  if (earlyGraduation && scope.some((item) => item._index > standardSemesters))
    invalid('Kỳ đã học vượt khung chuẩn không thuộc trường hợp tốt nghiệp trước tiến độ.');
  const finalIndex = earlyGraduation
    ? Math.max(0, ...scope.map((item) => item._index))
    : standardSemesters;
  // Missing rows are unknown semesters, not evidence of an approved leave or foreign stage.
  const expectedIndexes = Array.from({ length: finalIndex }, (_, i) => i + 1).filter((index) => {
    const item = ordered.find((row) => row._index === index);
    if (earlyGraduation && item?.studied === false) return false;
    return !international || item?.atTdtu !== false;
  });
  const expectedSet = new Set(expectedIndexes);
  const included = scope.filter((item) => expectedSet.has(item._index));
  const excluded = ordered.filter((item) => !included.includes(item));
  const required = Math.max(
    expectedIndexes.length,
    international && !earlyGraduation ? (tdtuSemesters ?? 0) : 0,
  );
  const expected = expectedIndexes.map((index) => semesterName(index, cohortYear));
  const missing = expectedIndexes
    .filter(
      (index) =>
        !included.some((item) => item._index === index && summaryState(item) === 'evaluated'),
    )
    .map((index) => semesterName(index, cohortYear));
  while (
    missing.length <
    required - included.filter((item) => summaryState(item) === 'evaluated').length
  )
    missing.push('Học kỳ tại TDTU chưa xác định đầy đủ');
  const result = aggregate(included, required, missing);
  const applicable = cohortYear >= (international ? 2020 : 2017);
  const graduationScope =
    cohortYear === 2017 && !international ? included.filter((item) => item._index > 2) : included;
  const graduationRequired =
    cohortYear === 2017 && !international
      ? expectedIndexes.filter((index) => index > 2).length
      : required;
  const graduationComplete =
    graduationRequired > 0 &&
    graduationScope.length === graduationRequired &&
    graduationScope.every((item) => summaryState(item) === 'evaluated');
  const graduationAverage = graduationComplete
    ? graduationScope.reduce((sum, item) => sum + item.officialTotal, 0) / graduationScope.length
    : null;
  const graduationEligible =
    applicable && graduationAverage !== null ? graduationAverage >= 50 : null;
  const shortfall = graduationEligible === false ? 50 - graduationAverage : null;
  return {
    ...result,
    program,
    includedSemesters: included.map((item) => item.semester || `Học kỳ ${item._index}`),
    excludedSemesters: excluded.map((item) => item.semester || `Học kỳ ${item._index}`),
    expectedSemesters: expected,
    graduationApplicable: applicable,
    graduationComplete,
    graduationAverage,
    graduationEligible,
    additionalActivitiesRequired: shortfall !== null && cohortYear <= 2024 ? 3 : null,
    additionalPointsRequired:
      shortfall !== null && cohortYear >= 2025 ? shortfall * standardSemesters : null,
    notes: [
      'Điều 12: tính trung bình các học kỳ theo chương trình chuẩn; hoạt động ở học kỳ trễ tiến độ vẫn được ghi nhận nhưng không cộng vào trung bình toàn khóa.',
      ...(earlyGraduation ? ['Tốt nghiệp trước tiến độ: tính các học kỳ đã học tại Trường.'] : []),
      ...(international
        ? [
            'Chương trình liên kết quốc tế: chỉ tính các học kỳ tại TDTU. Số kỳ tại TDTU riêng lẻ không xác định được các kỳ nước ngoài; cần hồ sơ từng kỳ để loại đúng phạm vi.',
          ]
        : []),
      ...(cohortYear === 2017 && !international
        ? [
            'Khóa 2017: điều kiện điểm rèn luyện xét tốt nghiệp áp dụng từ năm học thứ hai; graduationAverage tách khỏi trung bình toàn khóa.',
          ]
        : []),
      'Điều 15.4–5: ngưỡng xét tốt nghiệp 50 điểm; khóa từ 2025 dùng (50 − trung bình thực tế) × số học kỳ chương trình chuẩn khi thiếu điểm.',
      'Kết quả điều kiện là thông tin hỗ trợ đối chiếu; không tự động ra quyết định tốt nghiệp, tạm ngừng học hoặc buộc thôi học.',
      'Giữ điểm âm, không tự làm tròn và không thay học kỳ thiếu dữ liệu bằng 0.',
    ],
  };
}
