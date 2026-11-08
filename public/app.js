'use strict';
const $ = (q, r = document) => r.querySelector(q);
const e = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const paths = {
  check: 'm5 12 4 4L19 6',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  calendar:
    'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  chart: 'M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M3 9l2-4 3 1 2-3h4l2 3 3-1 2 4-2 3 2 3-2 4-3-1-2 3h-4l-2-3-3 1-2-4 2-3z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  logout: 'M9 3H4v18h5 M14 8l5 4-5 4 M8 12h12',
  arrow: 'M5 12h14 m-6-6 6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 3v12 m-5-5 5 5 5-5 M3 16v5h18v-5',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12 M6 18 18 6',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  alert: 'm12 3 10 18H2z M12 9v5 M12 17v.01',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z m-4 10 3 3 5-6',
  book: 'M4 3h6a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4z M20 3h-4a3 3 0 0 0-3 3v15a3 3 0 0 1 3-3h4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  refresh: 'M20 4v6h-6 M4 20v-6h6 M5 8a8 8 0 0 1 13-3l2 5 M4 14l2 5a8 8 0 0 0 13-3',
};
const icon = (n) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.file}"/></svg>`;
const routes = [
  ['dashboard', 'Tổng quan', 'grid'],
  ['students', 'Sinh viên', 'users', true],
  ['roster', 'Danh sách và phân công', 'users', true],
  ['activities', 'Hoạt động', 'calendar'],
  ['claims', 'Tự kê khai', 'file'],
  ['appeals', 'Phúc tra và điều chỉnh', 'link'],
  ['evidence', 'Minh chứng', 'upload'],
  ['notifications', 'Thông báo', 'clock'],
  ['regulations', 'Quy chế Điểm rèn luyện', 'book'],
  ['import', 'Nhập dữ liệu', 'upload', true],
  ['reconciliation', 'Đối soát', 'link', true],
  ['reports', 'Báo cáo', 'chart', true],
  ['semesters', 'Năm học và học kỳ', 'calendar', true, true],
  ['settings', 'Quy tắc điểm', 'settings', true, true],
  ['legacy', 'Dữ liệu cần đối chiếu', 'alert', true],
  ['audit', 'Nhật ký', 'clock', true, true],
];
const state = {
  session: null,
  view: 'dashboard',
  data: null,
  filters: {},
  preview: null,
  importPayload: null,
  google: null,
  semester: null,
  loadId: 0,
  serverTimeOffset: 0,
  rosterPreview: null,
  rosterPayload: null,
  assignmentContext: null,
  enrolledSemester: null,
  notificationData: { notifications: [], unreadCount: 0 },
  appealDetail: null,
};
const lecturer = () => state.session?.user?.role === 'LECTURER';
const coordinator = () => lecturer() && state.session?.access?.isCoordinator === true;
const routeAllowed = (route) =>
  !!route && (!route[3] || lecturer()) && (!route[4] || coordinator());
const initials = (n) =>
  String(n || 'SV')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
const num = (n) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(Number(n) || 0);
const semesterCatalog = () => state.session?.settings?.semesterCatalog || [];
const semesterInfo = (id = state.semester) => semesterCatalog().find((s) => s.id === id);
const semesterLabel = (id) => {
  const row = semesterInfo(id);
  return row ? `${row.name} · ${row.academicYear}` : id || 'Chưa chọn học kỳ';
};
const currentAcademicYear = () => semesterInfo()?.academicYear || '';
const academicYearOptions = (selected) =>
  [...new Set(semesterCatalog().map((row) => row.academicYear))]
    .filter(Boolean)
    .sort()
    .map(
      (year) =>
        `<option value="${e(year)}" ${year === selected ? 'selected' : ''}>Năm học ${e(year)}</option>`,
    )
    .join('');
const semesterStates = {
  open: ['Đang mở', 'green'],
  review: ['Đang tổng hợp', 'amber'],
  closed: ['Đã chốt và khóa', 'blue'],
};
const semesterStateBadge = (s) => badge(...(semesterStates[s] || [s, '']));
const serverNow = () => Date.now() + state.serverTimeOffset;
function semesterWriteMessage(id = state.semester) {
  const row = semesterInfo(id);
  if (!row) return 'Danh mục học kỳ chưa sẵn sàng. Hãy tải lại trang.';
  if (row.state === 'closed')
    return 'Học kỳ đã chốt và khóa. Điều phối viên cần mở lại kỳ trước khi thay đổi dữ liệu.';
  if (lecturer()) {
    if (coordinator()) return '';
    if (
      !state.assignmentContext?.assignments?.some(
        (assignment) => assignment.semester === id && !assignment.revokedAt,
      )
    )
      return 'Bạn chưa được phân công quản lý lớp trong học kỳ này. Liên hệ điều phối viên để đối chiếu phân công.';
    return '';
  }
  if (state.enrolledSemester !== id)
    return 'Bạn chưa có tên trong danh sách học kỳ này. Liên hệ điều phối viên để xác nhận lớp trước khi kê khai.';
  if (row.state !== 'open') return 'Học kỳ đang tổng hợp; sinh viên đã dừng kê khai.';
  if (row.startsAt && serverNow() < Date.parse(row.startsAt))
    return 'Chưa đến thời gian kê khai của học kỳ.';
  if (row.deadline && serverNow() >= Date.parse(row.deadline))
    return 'Đã hết hạn kê khai của học kỳ.';
  return '';
}
const assertSemesterWrite = () => {
  const message = semesterWriteMessage();
  if (message) throw Error(message);
};
const semesterWriteActions = new Set([
  'claim-new',
  'activity-new',
  'assessment-edit',
  'claim-review',
  'claim-reject',
  'legacy-edit',
]);
const semesterWriteForms = new Set([
  'claim-create',
  'activity-create',
  'claim-review',
  'assessment-save',
  'legacy-reclassify',
  'match',
]);
const date = (v) => {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T12:00:00' : v);
  return isNaN(d) ? e(v) : d.toLocaleDateString('vi-VN');
};
const dateTime = (v) => {
  const d = new Date(v);
  return isNaN(d)
    ? e(v)
    : d.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
};
const safeUrl = (v) => {
  try {
    const u = new URL(v);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
};
const badge = (t, c = '') => `<span class="badge ${c}">${e(t)}</span>`;
const statuses = {
  pending: ['Chờ kiểm tra', 'amber'],
  reviewed: ['Đã kiểm tra', 'blue'],
  rejected: ['Từ chối', 'red'],
  matched: ['Đã đối soát', 'green'],
};
const statusBadge = (s) => badge(...(statuses[s] || [s, '']));
const classification = (l, status) =>
  status === 'not_evaluated'
    ? badge('Không đánh giá', 'red')
    : status === 'incomplete' && !l
      ? badge('Chưa hoàn tất', 'amber')
      : l
        ? badge(
            l,
            ['Xuất sắc', 'Tốt'].includes(l)
              ? 'green'
              : l === 'Khá'
                ? 'blue'
                : l === 'Trung bình'
                  ? 'amber'
                  : 'red',
          )
        : '<span class="no-data">Chưa có dữ liệu</span>';
const empty = (t = 'Chưa có dữ liệu', d = 'Dữ liệu sẽ xuất hiện sau khi được ghi nhận.') =>
  `<div class="empty">${icon('file')}<strong>${e(t)}</strong>${e(d)}</div>`;
const btn = (l, a, c = '', attrs = '', i = '') =>
  `<button type="button" class="btn ${c}" data-action="${a}" ${semesterWriteActions.has(a) ? `data-semester-write ${semesterWriteMessage() ? `disabled title="${e(semesterWriteMessage())}"` : ''}` : ''} ${attrs}>${i ? icon(i) : ''}${e(l)}</button>`;
const heading = (t, d, a = '') =>
  `<div class="page-head"><div><div class="eyebrow">Không gian rèn luyện</div><h1>${e(t)}</h1><p>${e(d)}</p></div><div class="page-actions">${a}</div></div>`;
function toast(m, error = false) {
  const x = document.createElement('div');
  x.className = 'toast' + (error ? ' error' : '');
  x.innerHTML = icon(error ? 'alert' : 'check') + `<span>${e(m)}</span>`;
  $('#toast-region').append(x);
  setTimeout(() => x.remove(), 6000);
}
async function api(path, body, method) {
  if (
    body === undefined &&
    state.semester &&
    /^\/api\/(dashboard|students|activities|claims|official-records|reconciliation|reports|legacy|roster(?:\/history)?|assignments|appeals|evidence|assessments\/[^/?]+)(?:\?|$)/.test(
      path,
    )
  ) {
    const u = new URL(path, location.origin);
    if (!u.searchParams.has('semester')) u.searchParams.set('semester', state.semester);
    path = u.pathname + u.search;
  }
  const o = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    o.method = method || 'POST';
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(body);
  }
  const r = await fetch(path, o);
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error('Máy chủ chưa phản hồi hợp lệ. Hãy thử lại.');
  }
  if (!r.ok) {
    if (r.status === 401 && state.session?.user) {
      state.session.user = null;
      renderLogin();
    }
    throw Error(
      typeof d.error === 'string'
        ? d.error
        : d.error?.message || d.message || 'Không thể thực hiện thao tác này.',
    );
  }
  return d;
}
function modal(t, b) {
  const x = $('#modal');
  x.innerHTML = `<div class="modal-head"><h2 id="modal-title">${e(t)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="Đóng">${icon('close')}</button></div><div class="modal-body">${b}</div>`;
  if (!x.open) x.showModal();
  updateSemesterWriteControls();
}
function formError(f, m) {
  let x = $('.form-error', f);
  if (!x) {
    x = document.createElement('div');
    x.className = 'form-error';
    f.append(x);
  }
  x.textContent = m;
  x.style.display = 'block';
}
const formActions = (t = 'Lưu thay đổi') =>
  `<div class="form-error" role="alert"></div><div class="form-actions">${btn('Hủy', 'close-modal')}<button type="submit" class="btn primary">${icon('check')}${e(t)}</button></div>`;

const criteriaCatalog = () => state.session?.settings?.criteria || state.data?.criteria || [];
const categoriesCatalog = () => state.session?.settings?.categories || state.data?.categories || [];
const criterionName = (item) =>
  item.criterionName ||
  criteriaCatalog().find((c) => c.id === item.criterionId)?.name ||
  'Chưa xác định tiêu chí';
const isLegacy = (item) => item.legacy === true;
const legacyTag = (item) =>
  isLegacy(item) ? badge('Cần đối chiếu · chưa tính điểm', 'amber') : '';
const signedNum = (v) => (Number(v) > 0 ? '+' : '') + num(v);
const scoreText = (v) => (v === null || v === undefined ? '—' : num(v));
const officialValue = (s) => (s?.snapshotId ? s.publishedTotal : s?.officialTotal);
const officialLabel = (s) =>
  s?.snapshotId && s.evaluationStatus !== 'evaluated' ? null : s?.officialClassification;
const sourceLink = () =>
  '<a href="/docs/quy-che-ren-luyen-tdtu.pdf" target="_blank" rel="noopener noreferrer">Đọc bản PDF quy chế ↗</a>';
const evaluationLabels = {
  evaluated: 'Đủ dữ liệu đánh giá',
  incomplete: 'Còn thiếu dữ liệu đánh giá',
  no_data: 'Chưa có dữ liệu',
  not_evaluated: 'Không đánh giá học kỳ này',
};
function evaluationNotice(s) {
  const warnings = s.warnings || [];
  return `<div class="evaluation-note">${badge(evaluationLabels[s.evaluationStatus] || 'Theo dõi học kỳ', s.evaluationStatus === 'evaluated' ? 'green' : 'amber')}${warnings.length ? `<ul>${warnings.map((w) => `<li>${e(typeof w === 'string' ? w : w.message || JSON.stringify(w))}</li>`).join('')}</ul>` : ''}${s.legacyCount ? `<p><strong>${num(s.legacyCount)} khoản cũ cần đối chiếu và chưa tính vào tổng.</strong> ${lecturer() ? '<a href="#legacy">Mở dữ liệu cần đối chiếu →</a>' : 'Khoa cần xác nhận tiêu chí tương ứng trước khi ghi điểm.'}</p>` : ''}<p>Kỷ luật có thể giới hạn xếp loại; số điểm tính được vẫn giữ nguyên. Điểm dự kiến chưa thay thế kết quả chính thức.</p></div>`;
}
function permittedCriteria() {
  return criteriaCatalog().filter(
    (c) => !['gpa', 'offline'].includes(c.unit) && (lecturer() || c.studentAllowed),
  );
}

function criterionOptions(selected = '', list = permittedCriteria()) {
  return (
    '<option value="">Chọn tiêu chí theo quy chế</option>' +
    categoriesCatalog()
      .map((cat) => {
        const rows = list.filter((c) => c.categoryId === cat.id);
        return rows.length
          ? `<optgroup label="${e(cat.name)}">${rows.map((c) => `<option value="${e(c.id)}" ${c.id === selected ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</optgroup>`
          : '';
      })
      .join('') +
    (list.some((c) => c.explicitCategoryRequired)
      ? `<optgroup label="Phê duyệt hoàn cảnh đặc biệt">${list
          .filter((c) => c.explicitCategoryRequired)
          .map(
            (c) =>
              `<option value="${e(c.id)}" ${c.id === selected ? 'selected' : ''}>${e(c.name)}</option>`,
          )
          .join('')}</optgroup>`
      : '')
  );
}
function criterionFields(kind, selected = '') {
  const amount = kind === 'claim' ? 'claimedPoints' : 'points';
  return `<label class="full">Tiêu chí quy chế<select name="criterionId" required data-criterion-select>${criterionOptions(selected)}</select></label><label>Nội dung đánh giá<input name="categoryName" readonly placeholder="Tự xác định từ tiêu chí"><input type="hidden" name="categoryId"></label><label>Định mức / đơn vị<input name="criterionRate" readonly placeholder="Theo quy chế"></label><label class="full" data-explicit-category-field hidden>Nội dung được chỉ định trong văn bản<select name="explicitCategoryId"><option value="">Chọn nội dung theo văn bản phê duyệt</option>${categoriesCatalog()
    .map((c) => `<option value="${e(c.id)}">${e(c.name)}</option>`)
    .join(
      '',
    )}</select></label><label>Số lượng<input type="number" name="quantity" min="1" max="100" step="1" value="1" required><small data-quantity-note>Số lần tham gia thực tế.</small></label><label>Điểm theo tiêu chí<input name="${amount}" type="number" step="any" readonly value="0"><small data-points-note>Máy chủ kiểm tra lại tiêu chí và định mức.</small></label><label class="full" data-approval-field hidden>Tham chiếu văn bản phê duyệt<input name="approvalReference" maxlength="500" placeholder="Số quyết định / văn bản phê duyệt"><small>Bắt buộc với tiêu chí có mức điểm do đơn vị có thẩm quyền phê duyệt.</small></label><div class="full inline-note" data-criterion-reference></div>`;
}
function refreshCriterion(form) {
  if (!form || !form.querySelector('[data-criterion-select]')) return;
  const c = criteriaCatalog().find((c) => c.id === form.elements.criterionId?.value);
  if (!c) return;
  const custom = Boolean(c.explicitCategoryRequired);
  const customSelect = form.elements.explicitCategoryId;
  $('[data-explicit-category-field]', form).hidden = !custom;
  customSelect.required = custom;
  const categoryId = custom ? customSelect.value : c.categoryId;
  const cat = categoriesCatalog().find((x) => x.id === categoryId);
  form.elements.categoryId.value = categoryId || '';
  form.elements.categoryName.value = cat?.name || (custom ? 'Chọn theo văn bản' : '');
  const q = form.elements.quantity;
  const perSemester = c.unit === 'semester';
  const approved = c.unit === 'approved';
  q.readOnly = perSemester || approved;
  q.max = perSemester || approved ? '1' : '100';
  if (perSemester || approved) q.value = '1';
  q.min = '1';
  form.elements.criterionRate.value = approved
    ? 'Theo văn bản được phê duyệt'
    : `${num(c.points)} điểm / ${perSemester ? 'học kỳ' : 'lần'}`;
  const amount = form.elements.claimedPoints || form.elements.points;
  amount.readOnly = !approved;
  amount.required = true;
  if (!approved) {
    amount.removeAttribute('min');
    amount.removeAttribute('max');
    amount.value = String((Number(c.points) || 0) * (Number(q.value) || 1));
  } else {
    amount.min = '0';
    if (c.maxApprovedPoints !== undefined) amount.max = String(c.maxApprovedPoints);
    else amount.removeAttribute('max');
    if (!amount.value || amount.value === '0') amount.value = '1';
  }
  const approval = $('[data-approval-field]', form);
  approval.hidden = !approved;
  form.elements.approvalReference.required = approved;
  $('[data-quantity-note]', form).textContent = perSemester
    ? 'Chỉ ghi nhận một lần trong học kỳ.'
    : approved
      ? 'Một khoản theo quyết định phê duyệt.'
      : 'Số lần tham gia thực tế; giới hạn mỗi nội dung vẫn áp dụng.';
  $('[data-points-note]', form).textContent = approved
    ? 'Nhập đúng số điểm đã được phê duyệt.'
    : 'Tự xác định theo tiêu chí; không nhập điểm tùy ý.';
  $('[data-criterion-reference]', form).textContent = c.reference || '';
}

function evidenceFields(purpose = 'claim', appealId = '') {
  return `<input type="hidden" name="evidenceId"><input type="hidden" name="purpose" value="${e(purpose)}"><input type="hidden" name="appealId" value="${e(appealId)}"><label class="full">Liên kết minh chứng (không bắt buộc)<input name="evidenceUrl" type="url" placeholder="https://drive.google.com/…"><small>Liên kết tự nhập chưa xác nhận quyền chia sẻ. Không tự cấp điểm khi tải hoặc kiểm tra minh chứng.</small></label>${state.session.user.provider === 'google' ? `<div class="full">${state.google?.connected ? `<label>Tải minh chứng lên Google Drive<input type="file" name="evidenceFile" accept="application/pdf,image/png,image/jpeg,image/webp"></label><p class="inline-note">PDF, PNG, JPEG, WEBP · Tối đa 5 MB.</p>${btn('Lưu vào Drive và chia sẻ cho người phụ trách', 'evidence-upload', 'small', purpose === 'claim' ? 'data-semester-write' : '', 'upload')}<p class="inline-note" id="evidence-result" role="status" aria-live="polite"></p>` : `<a href="/auth/google/connect?returnTo=${purpose === 'appeal' ? 'appeals' : 'claims'}" class="btn small">Kết nối Google để tải minh chứng</a><p class="inline-note">Kết nối trước khi điền để tránh mất biểu mẫu chưa gửi.</p>`}</div>` : ''}`;
}

function renderLogin() {
  const s = state.session || { auth: {}, demoUsers: [] };
  const googleName = s.auth?.authAudience === 'external' ? 'Google' : 'Google TDTU';
  $('#app').innerHTML =
    `<main class="login-page"><section class="login-story"><a class="brand" href="/"><span class="brand-mark">${icon('check')}</span><span class="brand-name">conduct<span class="brand-sub">STUDENT DEVELOPMENT</span></span></a><div class="login-copy"><div class="eyebrow">Đồng hành cùng sinh viên TDTU</div><h1>Mỗi nỗ lực.<br>Một dấu ấn<br>được ghi nhận.</h1><p>Không gian kết nối hoạt động, minh chứng và điểm rèn luyện. Theo dõi rõ ràng, đối soát chính xác, chủ động hành trình của bạn.</p><div class="login-benefits"><div>${icon('shield')}Một tài khoản trường, một không gian chung</div><div>${icon('chart')}Điểm chính thức và dự kiến minh bạch</div><div>${icon('link')}Mỗi hoạt động chỉ được tính một lần</div></div></div><footer>Đồ án ứng dụng quản lý điểm rèn luyện · 2026</footer></section><section class="login-form-area"><div class="login-form"><div class="eyebrow">Chào mừng trở lại</div><h2>Bắt đầu cùng Conduct</h2><p>Đăng nhập để xem điểm và quản lý hoạt động của bạn.</p>${s.auth?.googleConfigured ? `<a href="/auth/google" class="google-btn"><span class="google-g">G</span>Tiếp tục với tài khoản ${googleName}</a>` : `<button class="google-btn" data-action="google-help"><span class="google-g">G</span>Đăng nhập ${googleName}</button><p class="google-unavailable">Đăng nhập Google hiện chưa sẵn sàng.</p>`}${s.auth?.demoEnabled ? `<div class="login-divider">HOẶC KHÁM PHÁ BẢN DEMO</div>${(s.demoUsers || []).map((u) => `<button class="demo-account" data-action="demo-login" data-id="${e(u.id)}"><span class="avatar ${u.role === 'LECTURER' ? 'lecturer' : ''}">${icon(u.role === 'LECTURER' ? 'book' : 'users')}</span><span><strong>${u.role === 'LECTURER' ? 'Không gian giảng viên' : 'Không gian sinh viên'}${u.id === 'demo-student-2' ? ' · tài khoản 2' : ''}</strong><small>${e(u.email)}</small></span>${icon('arrow')}</button>`).join('')}` : ''}<div class="login-system"><span class="dot" style="color:#66aa87"></span>Đồng hành cùng hành trình rèn luyện của bạn</div></div></section></main>`;
  const err = new URLSearchParams(location.search).get('authError');
  if (err) {
    toast(err, true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
}
function renderShell() {
  const u = state.session.user;
  $('#app').innerHTML =
    `<div class="shell"><div class="overlay" data-action="toggle-menu"></div><aside class="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark">${icon('check')}</span><span class="brand-name">conduct<span class="brand-sub">STUDENT DEVELOPMENT</span></span></a><div class="nav-caption">KHÔNG GIAN LÀM VIỆC</div><nav class="nav" aria-label="Điều hướng chính">${routes
      .filter(routeAllowed)
      .map(
        (r) =>
          `<button class="nav-item" data-action="navigate" data-view="${r[0]}">${icon(r[2])}<span>${r[1]}</span></button>`,
      )
      .join(
        '',
      )}</nav><div class="sidebar-bottom"><div class="user-area"><span class="avatar">${e(initials(u.name))}</span><div class="user-info"><strong>${e(u.name)}</strong><small>${lecturer() ? 'Giảng viên / Cán bộ khoa' : 'Sinh viên'} · ${u.provider === 'google' ? 'Google' : 'Demo'}</small></div><button class="logout" data-action="logout" aria-label="Đăng xuất">${icon('logout')}</button></div></div></aside><div class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="toggle-menu" aria-label="Mở điều hướng">${icon('menu')}</button><span>Không gian làm việc</span><span>/</span><strong id="current-title">Tổng quan</strong></div><div class="topbar-right"><label class="period">${icon('calendar')}<select id="semester-select" aria-label="Chọn học kỳ">${(state.session.settings?.semesters || [state.semester]).map((s) => `<option value="${e(s)}" ${s === state.semester ? 'selected' : ''}>${e(semesterLabel(s))}</option>`).join('')}</select></label><span class="topbar-divider"></span>${badge(lecturer() ? 'Giảng viên' : 'Sinh viên', 'outline')}<span class="avatar" title="${e(u.email)}">${e(initials(u.name))}</span></div></header><main class="content" id="content"></main></div></div>`;
  if (coordinator()) {
    $('.topbar-right .badge').textContent = 'Điều phối viên';
    $('.user-info small').textContent =
      `Điều phối viên · ${u.provider === 'google' ? 'Google' : 'Demo'}`;
  }
  const notificationsButton = document.createElement('button');
  notificationsButton.type = 'button';
  notificationsButton.className = 'notification-shortcut';
  notificationsButton.dataset.action = 'navigate';
  notificationsButton.dataset.view = 'notifications';
  notificationsButton.setAttribute('aria-label', 'Mở thông báo');
  notificationsButton.innerHTML = `${icon('clock')}<span id="notification-unread" hidden>0</span>`;
  $('.topbar-right').prepend(notificationsButton);
  updateNotificationBadge();
}
function finish(html) {
  $('#content').innerHTML =
    semesterNotice() +
    html +
    `<footer class="footer"><span>Conduct · Ứng dụng quản lý điểm rèn luyện</span><span>${e(semesterLabel(state.semester))} · Bản demo</span></footer>`;
  updateSemesterWriteControls();
}
function semesterNotice() {
  const row = semesterInfo();
  if (!row) return '';
  const message = semesterWriteMessage();
  return `<section class="semester-notice" aria-label="Trạng thái học kỳ"><div>${semesterStateBadge(row.state)} <strong>${e(semesterLabel(row.id))}</strong><p>${row.startsAt ? `Bắt đầu kê khai: ${dateTime(row.startsAt)}. ` : 'Chưa giới hạn thời điểm bắt đầu. '}${row.deadline ? `Hạn kê khai: ${dateTime(row.deadline)} (đúng mốc này dừng nhận).` : 'Chưa đặt hạn kê khai.'} Giờ Việt Nam (UTC+7).</p><p>${e(message || (lecturer() ? 'Bạn có thể cập nhật và đối soát trong phạm vi được phân công đến khi chốt kỳ.' : 'Bạn có thể gửi kê khai trong thời gian mở kỳ.'))}${row.state === 'closed' ? ' Kết quả đang hiển thị theo bản chốt đã lưu.' : ''}</p></div>${coordinator() ? btn('Quản lý học kỳ', 'navigate', 'small', 'data-view="semesters"', 'calendar') : ''}</section>`;
}
function updateSemesterWriteControls() {
  const message = semesterWriteMessage();
  document.querySelectorAll('[data-semester-write]').forEach((node) => {
    node.disabled = Boolean(message);
    node.title = message;
  });
  document.querySelectorAll('form[data-form]').forEach((form) => {
    if (!semesterWriteForms.has(form.dataset.form)) return;
    const submit = $('[type="submit"]', form);
    if (submit) {
      if (!submit.hasAttribute('data-semester-submit')) {
        submit.dataset.semesterSubmit = 'true';
        submit.dataset.originalDisabled = String(submit.disabled);
      }
      submit.disabled = Boolean(message) || submit.dataset.originalDisabled === 'true';
      submit.title = message;
    }
  });
}
async function refreshSemesters() {
  const data = await api('/api/semesters');
  state.session.settings = {
    ...state.session.settings,
    semesters: data.semesters.map((row) => row.id),
    semesterCatalog: data.semesters,
    academicYears: data.academicYears,
  };
  if (data.serverTime) state.serverTimeOffset = Date.parse(data.serverTime) - Date.now();
  if (!data.semesters.some((row) => row.id === state.semester))
    state.semester = data.semesters[0]?.id || null;
  const select = $('#semester-select');
  if (select)
    select.innerHTML = data.semesters
      .map(
        (row) =>
          `<option value="${e(row.id)}" ${row.id === state.semester ? 'selected' : ''}>${e(semesterLabel(row.id))}</option>`,
      )
      .join('');
  return data;
}
async function refreshAccessContext() {
  const response = await api('/api/access');
  state.session.access = response.access || response;
  if (lecturer()) {
    state.assignmentContext = await api('/api/assignments');
    state.enrolledSemester = null;
  } else {
    const roster = await api('/api/roster');
    state.enrolledSemester = roster.students?.some(
      (student) => student.id === state.session.user.studentId,
    )
      ? state.semester
      : null;
    state.assignmentContext = null;
  }
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.hidden = !routeAllowed(routes.find((route) => route[0] === item.dataset.view));
  });
}
function updateNotificationBadge() {
  const count = Number(state.notificationData?.unreadCount) || 0;
  const badgeNode = $('#notification-unread');
  if (badgeNode) {
    badgeNode.textContent = count > 99 ? '99+' : String(count);
    badgeNode.hidden = count === 0;
    badgeNode.parentElement.setAttribute(
      'aria-label',
      count ? `${count} thông báo chưa đọc` : 'Mở thông báo',
    );
  }
}
async function refreshNotifications(render = false) {
  const data = await api('/api/notifications');
  state.notificationData = data;
  updateNotificationBadge();
  if (render && state.view === 'notifications' && !$('#modal')?.open) {
    state.data = data;
    renderNotifications(data);
  }
  return data;
}
function go(v) {
  if (location.hash === '#' + v) navigate(v);
  else location.hash = v;
}
async function navigate(v) {
  if (!state.session?.user) return;
  const r = routes.find((r) => r[0] === v);
  if (!routeAllowed(r)) v = 'dashboard';
  state.view = v;
  const id = ++state.loadId;
  document.querySelectorAll('.nav-item').forEach((x) => {
    x.classList.toggle('active', x.dataset.view === v);
    x.setAttribute('aria-current', x.dataset.view === v ? 'page' : 'false');
  });
  $('.sidebar')?.classList.remove('open');
  $('.overlay')?.classList.remove('visible');
  $('#current-title').textContent = routes.find((r) => r[0] === v)[1];
  $('#content').innerHTML =
    '<div class="view-loading"><div class="spinner" aria-label="Đang tải dữ liệu"></div></div>';
  try {
    const catalogue = await refreshSemesters();
    if (id !== state.loadId) return;
    await refreshAccessContext();
    if (id !== state.loadId) return;
    if (!routeAllowed(routes.find((route) => route[0] === v))) {
      await navigate('dashboard');
      return;
    }
    const qs = new URLSearchParams(state.filters[v] || {});
    if (v === 'reports' && !qs.has('academicYear')) qs.set('academicYear', currentAcademicYear());
    let d =
      v === 'semesters'
        ? catalogue
        : ['import', 'regulations'].includes(v)
          ? {}
          : await api('/api/' + v + (qs.size ? '?' + qs : ''));
    if (v === 'dashboard' && !lecturer()) d.history = await api('/api/official-records');
    if (v === 'roster') d.assignmentsData = state.assignmentContext;
    if (
      ['import', 'claims', 'reports', 'appeals', 'evidence'].includes(v) &&
      state.session.user.provider === 'google'
    ) {
      try {
        state.google = await api('/api/google/status');
      } catch {
        state.google = null;
      }
    }
    if (id !== state.loadId) return;
    state.data = d;
    ({
      dashboard: renderDashboard,
      students: renderStudents,
      roster: renderRoster,
      activities: renderActivities,
      claims: renderClaims,
      appeals: renderAppeals,
      evidence: renderEvidence,
      notifications: renderNotifications,
      import: renderImport,
      reconciliation: renderReconciliation,
      reports: renderReports,
      semesters: renderSemesters,
      settings: renderSettings,
      regulations: renderRegulations,
      legacy: renderLegacy,
      audit: renderAudit,
    })[v](d);
    if (v === 'notifications') {
      state.notificationData = d;
      updateNotificationBadge();
    } else refreshNotifications().catch(() => {});
  } catch (err) {
    if (id === state.loadId)
      finish(
        `<div class="error-panel"><p>${e(err.message)}</p>${btn('Thử lại', 'refresh', '', '', 'refresh')}</div>`,
      );
  }
}
function metric(label, value, sub, glyph, tone = '', suffix = '') {
  return `<div class="metric"><div class="metric-top">${e(label)}<span class="metric-icon ${tone}">${icon(glyph)}</span></div><div class="metric-number">${value === null ? '—' : num(value)}${suffix ? `<small>${e(suffix)}</small>` : ''}</div><p class="metric-sub">${sub}</p></div>`;
}
const colors = ['#268b71', '#71b493', '#b4d4a5', '#e6ca85', '#d49b77', '#bd7f75', '#ccd8d1'];
function distribution(items, total) {
  let sum = 0;
  const slices = items.map((x, i) => {
    const start = sum;
    sum += total ? (x.count / total) * 100 : 0;
    return `${colors[i % colors.length]} ${start}% ${sum}%`;
  });
  if (sum < 99.9) slices.push(`#edf2ee ${sum}% 100%`);
  return `<div class="distribution"><div class="donut" style="background:conic-gradient(${slices.length ? slices.join(',') : '#edf2ee 0% 100%'})"><div class="donut-center"><strong>${num(total)}</strong><small>TỔNG SINH VIÊN</small></div></div><div class="distribution-legend">${items.map((x, i) => `<div class="dist-row"><i style="background:${colors[i % colors.length]}"></i><span>${e(x.label)}</span><strong>${num(x.count)}</strong><span>${num(x.percentage)}%</span></div>`).join('')}${total > items.reduce((n, x) => n + x.count, 0) ? `<div class="dist-row"><i style="background:#d8e2da"></i><span>Chưa có dữ liệu</span><strong>${num(total - items.reduce((n, x) => n + x.count, 0))}</strong><span>${num(((total - items.reduce((n, x) => n + x.count, 0)) / total) * 100)}%</span></div>` : ''}</div></div>`;
}
function claimTable(claims, actions = true) {
  if (!claims?.length)
    return empty(
      'Chưa có kê khai',
      'Thêm hoạt động đã tham gia để theo dõi phần điểm chờ cập nhật.',
    );
  return `<div class="table-wrap"><table><thead><tr>${lecturer() ? '<th>SINH VIÊN</th>' : ''}<th>HOẠT ĐỘNG / KÊ KHAI</th><th>NGÀY</th><th>ĐIỂM KÊ KHAI</th><th>TRẠNG THÁI</th>${actions ? '<th>THAO TÁC</th>' : ''}</tr></thead><tbody>${claims.map((c) => `<tr>${lecturer() ? `<td><span class="name">${e(c.studentName)}</span><span class="sub">${e(c.studentCode)} · ${e(c.className)}</span></td>` : ''}<td><span class="name">${e(c.title)}</span><span class="sub">${e(c.categoryName)} · ${e(criterionName(c))}${c.organizer ? ' · ' + e(c.organizer) : ''}</span></td><td>${date(c.date)}</td><td><span class="points">${signedNum(c.claimedPoints)}</span></td><td>${statusBadge(c.status)} ${legacyTag(c)} ${c.projectionExcluded ? badge('Đã có kết quả · không cộng dự kiến', 'outline') : ''}</td>${actions ? `<td><div class="row-actions">${btn('Xem', 'claim-detail', 'small', `data-id="${e(c.id)}"`)}${lecturer() && c.status === 'pending' && !isLegacy(c) ? btn('Kiểm tra', 'claim-review', 'small', `data-id="${e(c.id)}"`) : ''}${lecturer() && ['pending', 'reviewed'].includes(c.status) ? btn('Từ chối', 'claim-reject', 'small danger', `data-id="${e(c.id)}"`) : ''}</div></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function renderDashboard(d) {
  if (!lecturer()) {
    renderStudentDashboard(d);
    return;
  }
  finish(
    heading(
      'Tổng quan rèn luyện',
      'Theo dõi tiến độ, ghi nhận nỗ lực và hỗ trợ sinh viên đúng lúc.',
      btn('Xem báo cáo', 'navigate', '', 'data-view="reports"', 'download') +
        btn('Nhập dữ liệu', 'navigate', 'primary', 'data-view="import"', 'plus'),
    ) +
      `<section class="metrics">${metric('Tổng sinh viên', d.studentCount, `${num(d.classes?.length)} lớp đang theo dõi`, 'users')}${metric('Điểm chính thức TB', d.officialAverage, `${num(d.hasDataCount)} sinh viên đã có dữ liệu`, 'chart', '', '/ ' + num(d.settings?.totalMax || 100))}${metric('Kê khai đang chờ', d.pendingClaimsCount, 'Đang chờ dữ liệu chính thức', 'clock', 'amber')}${metric('Cần được hỗ trợ', d.atRiskCount, 'Điểm chính thức dưới ' + num(d.settings?.riskThreshold ?? 50), 'shield', 'blue')}</section><div class="grid-2"><section class="card"><div class="card-head"><div><h2>Phân bố kết quả rèn luyện</h2><p>Theo điểm chính thức · Tỷ lệ trên toàn bộ sinh viên</p></div>${badge('Học kỳ hiện tại', 'outline')}</div><div class="card-body">${distribution(d.classificationDistribution || [], d.studentCount)}</div><div class="table-note">${num(d.noDataCount)} sinh viên chưa có dữ liệu chính thức. Chưa có dữ liệu được tách riêng khỏi 0 điểm.</div></section><section class="card"><div class="card-head"><div><h2>Tiến độ theo lớp</h2><p>Số sinh viên cần hỗ trợ trong từng lớp</p></div>${icon('users')}</div><div class="card-body">${(d.classes || []).map((c) => `<div class="bar-group"><span class="bar-label">${e(c.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, c.total ? (c.atRisk / c.total) * 100 : 0)}%"></div></div><span class="bar-count">${num(c.atRisk)}/${num(c.total)}</span></div>`).join('')}<div class="class-summary"><span>${num(d.unmatchedRecordsCount)} khoản chính thức chưa liên kết</span>${btn('Đối soát ngay', 'navigate', 'text', 'data-view="reconciliation"', 'arrow')}</div></div></section></div><section class="card"><div class="card-head"><div><h2>Kê khai gần đây</h2><p>Các hoạt động sinh viên đề nghị ghi nhận</p></div>${btn('Xem tất cả', 'navigate', 'text', 'data-view="claims"', 'arrow')}</div>${claimTable((d.recentClaims || []).slice(0, 5))}</section>${demoGuide()}`,
  );
}
function demoGuide() {
  return `<section class="demo-guide"><div class="demo-guide-icon">${icon('book')}</div><div class="demo-guide-text"><h3>Một quy trình demo, từ kê khai đến đối soát</h3><p>Tạo kê khai theo tiêu chí → nhập dữ liệu chính thức → đối soát cùng sinh viên, tiêu chí và học kỳ → nhập lại không cộng trùng.</p></div>${lecturer() ? btn('Mở kịch bản demo', 'navigate', '', 'data-view="import"', 'arrow') : btn('Tạo kê khai', 'claim-new', '', '', 'plus')}</section>`;
}
function renderStudentDashboard(d) {
  const s = d.student;
  if (!s) {
    finish(
      heading('Tổng quan', 'Không gian sinh viên của bạn.') +
        empty(
          d.snapshotId
            ? 'Chưa có hồ sơ trong bản chốt này'
            : state.session.user.studentId && state.enrolledSemester !== state.semester
              ? 'Chưa có tên trong danh sách học kỳ'
              : 'Tài khoản chưa được liên kết hồ sơ',
          d.snapshotId
            ? 'Hồ sơ của bạn không thuộc danh sách tại thời điểm chốt kỳ. Liên hệ giảng viên để đối chiếu; bản chốt cũ vẫn được giữ nguyên.'
            : state.session.user.studentId && state.enrolledSemester !== state.semester
              ? 'Danh tính của bạn được giữ nguyên. Liên hệ điều phối viên để xác nhận lớp trong kỳ này trước khi kê khai.'
              : 'Liên hệ người quản trị để liên kết mã số sinh viên.',
        ),
    );
    return;
  }
  finish(
    heading(
      'Hành trình rèn luyện của bạn',
      'Chủ động theo dõi và ghi nhận những hoạt động đã tham gia.',
      btn('Theo dõi toàn khóa', 'course-open', '', `data-id="${e(s.id)}"`, 'chart') +
        btn('Thêm kê khai', 'claim-new', 'primary', '', 'plus'),
    ) +
      `<section class="student-hero"><div><div class="eyebrow">${e(semesterLabel(state.semester))}</div><h2>Chào ${e(state.session.user.name || s.name)}!</h2><p>${e(s.code)} · ${e(s.className)}</p><div style="margin-top:14px">${classification(officialLabel(s), s.evaluationStatus)}</div></div><div class="hero-scores"><div><label>Điểm chính thức</label><strong>${s.hasOfficialData ? scoreText(officialValue(s)) : '—'}</strong><small> / ${num(d.settings?.totalMax || 100)}</small></div><div><label>Đang chờ ghi nhận</label><strong>${signedNum(s.pendingTotal)}</strong></div><div><label>Điểm dự kiến</label><strong>${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</strong></div></div></section>${evaluationNotice(s)}<section class="category-cards">${(s.categoryScores || []).map((c) => `<div class="card category-card"><h3>${e(c.name)}</h3><div class="category-score">${scoreText(['no_data', 'not_evaluated'].includes(s.evaluationStatus) ? null : c.official)}<small> / ${num(c.maxPoints)}</small></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, (c.official / c.maxPoints) * 100))}%"></div></div><p>Đang chờ: <strong>${signedNum(c.pending)}</strong> · Dự kiến: <strong>${s.projectedClassification ? num(c.projected) : '—'}</strong></p></div>`).join('')}</section><section class="card"><div class="card-head"><div><h2>Kê khai của bạn</h2><p>Đã kiểm tra minh chứng vẫn đang chờ điểm chính thức</p></div>${btn('Xem tất cả', 'navigate', 'text', 'data-view="claims"', 'arrow')}</div>${claimTable((d.recentClaims || []).slice(0, 5))}</section><section class="card section-gap"><div class="card-head"><div><h2>Lịch sử điểm chính thức</h2><p>Mỗi khoản điểm đều có tham chiếu nguồn dữ liệu</p></div></div>${officialTable(d.history?.records || [])}</section>${demoGuide()}`,
  );
  if (state.enrolledSemester === state.semester)
    $('.page-head .page-actions')?.insertAdjacentHTML(
      'beforeend',
      btn(
        'Phúc tra đánh giá',
        'appeal-new',
        '',
        `data-type="assessment" data-id="${e(s.id)}"`,
        'link',
      ),
    );
}
function officialTable(rs) {
  if (!rs.length)
    return empty('Chưa có điểm chính thức', 'Điểm sẽ xuất hiện sau khi khoa nhập dữ liệu.');
  return `<div class="table-wrap"><table><thead><tr><th>HOẠT ĐỘNG</th><th>NỘI DUNG ĐÁNH GIÁ</th><th>NGÀY</th><th>ĐIỂM</th><th>THAM CHIẾU NGUỒN</th><th>ĐỐI SOÁT / PHÚC TRA</th></tr></thead><tbody>${rs
    .map((r) => {
      const superseded = recordSuperseded(r);
      return `<tr class="${superseded ? 'record-superseded' : ''}"><td class="name">${e(r.title)}${superseded ? '<span class="sub">Đã có khoản thay thế; không cộng vào tổng hiện tại</span>' : r.supersedesRecordId || r.replacesRecordId || r.correctionOfRecordId ? '<span class="sub">Khoản điều chỉnh thay thế</span>' : ''}</td><td>${e(r.categoryName)}<span class="sub">${e(criterionName(r))}</span>${legacyTag(r)}</td><td>${date(r.date)}</td><td><span class="points ${r.points < 0 ? 'negative' : ''}">${r.points > 0 ? '+' : ''}${num(r.points)}</span>${superseded ? badge('Không cộng lại') : ''}</td><td>${e(r.sourceId)}</td><td>${r.matchedClaimInherited ? badge('Liên kết khoản gốc', 'outline') : r.matchedClaimId ? badge('Đã liên kết', 'green') : badge('Chưa liên kết')}${!lecturer() && !superseded && !isLegacy(r) ? btn('Phúc tra khoản này', 'appeal-new', 'small', `data-type="record" data-id="${e(r.id)}"`, 'link') : ''}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}
const recordSuperseded = (row) =>
  row.effective === false ||
  row.isEffective === false ||
  row.superseded === true ||
  Boolean(row.supersededBy || row.supersededByRecordId || row.replacedByRecordId);
function classOptions(cs, s) {
  return (
    '<option value="">Tất cả lớp</option>' +
    cs
      .map(
        (c) => `<option value="${e(c.id)}" ${c.id === s ? 'selected' : ''}>${e(c.name)}</option>`,
      )
      .join('')
  );
}
function studentTable(ss) {
  if (!ss.length)
    return empty('Không tìm thấy sinh viên', 'Thử thay đổi điều kiện lọc hoặc từ khóa.');
  return `<div class="table-wrap"><table><thead><tr><th>SINH VIÊN</th><th>LỚP</th><th>CHÍNH THỨC</th><th>CHỜ GHI NHẬN</th><th>DỰ KIẾN</th><th>XẾP LOẠI CHÍNH THỨC</th><th></th></tr></thead><tbody>${ss.map((s) => `<tr><td><div class="student-cell"><span class="avatar">${e(initials(s.name))}</span><div><span class="name">${e(s.name)}</span><span class="sub">${e(s.code)}</span></div></div></td><td>${e(s.className)}</td><td>${s.hasOfficialData ? `<span class="score">${scoreText(officialValue(s))}</span>` : '<span class="no-data">Chưa có dữ liệu</span>'}</td><td><span class="score light">${signedNum(s.pendingTotal)}</span><span class="sub">${num(s.pendingCount)} kê khai</span></td><td><span class="score teal">${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</span></td><td>${classification(officialLabel(s), s.evaluationStatus)}<span class="sub">${e(evaluationLabels[s.evaluationStatus] || '')}</span>${s.legacyCount ? badge(num(s.legacyCount) + ' khoản cũ', 'amber') : ''}</td><td>${btn('Chi tiết', 'student-detail', 'small', `data-id="${e(s.id)}"`) + (lecturer() ? btn('Đánh giá', 'assessment-edit', 'small', `data-id="${e(s.id)}"`) : '')}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderStudents(d) {
  const f = state.filters.students || {};
  finish(
    heading(
      'Sinh viên',
      'Tra cứu điểm và tình trạng kê khai theo sinh viên, lớp, xếp loại.',
      btn('Xuất báo cáo', 'navigate', '', 'data-view="reports"', 'download'),
    ) +
      `<section class="card"><form class="toolbar" data-form="filters" data-view="students"><div class="filter-group"><div class="search">${icon('search')}<input aria-label="Tìm sinh viên" name="q" value="${e(f.q || '')}" placeholder="Tìm tên, MSSV, email…"></div><select name="classId" aria-label="Lọc theo lớp">${classOptions(d.classes || [], f.classId)}</select><select name="classification" aria-label="Lọc theo xếp loại"><option value="">Tất cả xếp loại</option>${(state.session.settings?.classifications || []).map((c) => `<option ${f.classification === c.label ? 'selected' : ''}>${e(c.label)}</option>`).join('')}<option value="no-data" ${f.classification === 'no-data' ? 'selected' : ''}>Chưa có dữ liệu</option></select><button class="btn" type="submit">Lọc kết quả</button></div></form>${studentTable(d.students || [])}<div class="table-foot"><span>${num(d.students?.length)} sinh viên phù hợp</span><span>Điểm dự kiến đã áp dụng giới hạn từng mục.</span></div></section>`,
  );
}
function renderActivities(d) {
  finish(
    heading(
      'Hoạt động',
      'Khám phá hoạt động và ghi nhận hành trình tham gia.',
      lecturer()
        ? btn('Tạo hoạt động', 'activity-new', 'primary', '', 'plus')
        : btn('Kê khai hoạt động', 'claim-new', 'primary', '', 'plus'),
    ) +
      `<div class="activities-grid">${d.activities?.length ? d.activities.map((a) => `<article class="card activity-card"><div class="activity-top"><span class="activity-symbol">${icon(a.mode === 'online' ? 'link' : 'calendar')}</span>${badge(a.mode === 'online' ? 'Trực tuyến' : 'Trực tiếp', a.mode === 'online' ? 'blue' : 'green')}</div><h3>${e(a.title)}</h3><p>${e(d.categories?.find((c) => c.id === a.categoryId)?.name || a.categoryId)}</p><p class="inline-note">${e(criterionName(a))} ${legacyTag(a)}</p><div class="activity-meta"><span>${icon('calendar')}${date(a.date)}</span><span>${icon('users')}${e(a.organizer || 'Chưa cập nhật đơn vị tổ chức')}</span></div><div class="activity-bottom"><strong>${signedNum(a.points)}<small>điểm đề xuất</small></strong>${!isLegacy(a) ? btn('Kê khai', 'claim-new', 'small', `data-activity="${e(a.id)}"`, 'plus') : badge('Chưa tính điểm', 'amber')}</div></article>`).join('') : empty('Chưa có hoạt động', 'Giảng viên có thể tạo hoạt động mới.')}</div>`,
  );
}
function renderClaims(d) {
  const f = state.filters.claims || {};
  const cs = (d.claims || []).filter(
    (c) =>
      (!f.status || c.status === f.status) &&
      (!f.q ||
        `${c.title} ${c.studentName} ${c.studentCode}`
          .toLocaleLowerCase('vi')
          .includes(f.q.toLocaleLowerCase('vi'))),
  );
  finish(
    heading(
      'Tự kê khai hoạt động',
      'Lưu lại hoạt động chưa lên điểm chính thức cùng minh chứng.',
      btn('Thêm kê khai', 'claim-new', 'primary', '', 'plus'),
    ) +
      `<div class="help-box"><strong>Điểm kê khai được tính vào dự kiến.</strong> “Đã kiểm tra” chỉ xác nhận minh chứng, chưa chuyển thành điểm chính thức. Khi đối soát thành công, khoản kê khai được loại khỏi phần chờ.</div><section class="card"><form class="toolbar" data-form="filters" data-view="claims"><div class="filter-group"><div class="search">${icon('search')}<input name="q" value="${e(f.q || '')}" placeholder="Tìm hoạt động, sinh viên…" aria-label="Tìm kê khai"></div><select name="status" aria-label="Trạng thái kê khai"><option value="">Tất cả trạng thái</option>${Object.entries(
        statuses,
      )
        .map(
          ([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v[0]}</option>`,
        )
        .join(
          '',
        )}</select><button class="btn" type="submit">Lọc kết quả</button></div></form>${claimTable(cs)}<div class="table-foot"><span>${num(cs.length)} kê khai</span><span>Minh chứng cần truy cập được bởi người kiểm tra.</span></div></section>`,
  );
}
function googlePanel(view) {
  if (state.session.user.provider !== 'google') return '';
  return `<div class="help-box"><strong>Google Workspace</strong><p>${state.google?.connected ? 'Đã kết nối Google Drive / Sheets. Chỉ dùng các tệp được cấp quyền.' : 'Kết nối Google để nhập từ Sheets, lưu báo cáo và gửi minh chứng.'}</p>${state.google?.connected ? badge(state.google.email || 'Đã kết nối', 'green') : `<a class="btn small" href="/auth/google/connect?returnTo=${view}">Kết nối Google Workspace</a>`}</div>`;
}
function renderImport() {
  finish(
    heading(
      'Nhập dữ liệu chính thức',
      'Kiểm tra dữ liệu trước khi ghi nhận. Nhập lại cùng một khoản sẽ không cộng lặp.',
      `<a class="btn" href="/api/import/template.xlsx">${icon('download')}Tải mẫu Excel</a><a class="btn" href="/api/demo/scenario.xlsx">${icon('book')}Tệp kịch bản demo</a>`,
    ) +
      `<div class="steps"><div class="step ${!state.preview ? 'active' : ''}"><b>1</b>Chọn nguồn dữ liệu</div><div class="step ${state.preview ? 'active' : ''}"><b>2</b>Xem trước & kiểm tra</div><div class="step"><b>3</b>Ghi nhận & đối soát</div></div>${googlePanel('import')}<section class="card"><div class="card-body" style="padding-top:22px"><form data-form="import-preview"><div class="upload-panel"><div class="upload-icon">${icon('upload')}</div><h3>Nhập tệp điểm chính thức</h3><p>Excel .xlsx hoặc CSV · Các dòng được kiểm tra trước khi lưu</p><input type="file" name="file" id="import-file" accept=".xlsx,.csv" required aria-label="Chọn tệp Excel hoặc CSV"><button type="submit" class="btn primary">${icon('eye')}Kiểm tra dữ liệu</button><div class="form-error" role="alert"></div></div></form>${state.session.user.provider === 'google' ? `<form data-form="sheets-preview" class="section-gap"><label>Hoặc nhập từ Google Sheets<input name="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required></label><div class="form-grid" style="margin-top:12px"><label>Tên trang tính (không bắt buộc)<input name="sheetName" placeholder="Sheet1"></label><div style="align-self:end"><button class="btn" type="submit">${icon('link')}Xem trước Google Sheets</button></div></div><p class="inline-note">Tài khoản Google cần có quyền đọc tệp. Khi Google báo thiếu quyền, hãy kết nối Workspace hoặc tải Excel để nhập.</p><div class="form-error"></div></form>` : ''}<div class="help-box"><strong>Demo nhanh:</strong> tải “Tệp kịch bản demo”, chọn tệp vừa tải và kiểm tra. Sau khi ghi nhận, khoản chính thức được cộng theo tiêu chí và kê khai đã khớp được loại khỏi phần chờ. Nhập lại tệp để kiểm tra chống trùng.<br><strong>Định dạng:</strong> mỗi dòng có <code>sourceId</code> duy nhất, <code>criterionId</code>, <code>quantity</code> và <code>approvalReference</code> nếu tiêu chí cần phê duyệt. Mỗi dòng cần mã học kỳ trong danh mục. Tệp được phép chứa nhiều học kỳ; học kỳ đang chọn không ghi đè kỳ trong dòng. Chỉ một dòng thuộc kỳ khóa cũng làm cả đợt nhập bị từ chối. Tệp chỉ chứa tổng điểm cần được chuyển đổi trước khi nhập.</div></div></section>${state.preview ? previewHtml(state.preview) : ''}`,
  );
}
function previewHtml(p) {
  const s = p.summary || {};
  return `<section class="card section-gap"><div class="card-head"><div><h2>Kết quả kiểm tra dữ liệu</h2><p>${e(p.source?.title || p.source?.name || state.importPayload?.fileName || 'Nguồn dữ liệu đã chọn')}</p></div>${btn('Bỏ kết quả', 'import-clear', 'small')}</div><div class="card-body"><div class="preview-summary"><span>${num(s.valid)} dòng hợp lệ</span><span>${num(s.duplicate)} dòng trùng được bỏ qua</span><span class="${s.errors ? 'error-count' : ''}">${num(s.errors)} dòng lỗi</span></div></div><div class="table-wrap"><table><thead><tr><th>DÒNG</th><th>SINH VIÊN</th><th>HOẠT ĐỘNG / HỌC KỲ</th><th>TIÊU CHÍ / ĐIỂM</th><th>TRẠNG THÁI</th><th>CHI TIẾT</th></tr></thead><tbody>${(p.rows || []).map((r, i) => `<tr><td>${r.index ?? i + 1}</td><td><span class="name">${e(r.studentName || r.row?.studentCode)}</span><span class="sub">${e(r.row?.studentCode)}</span></td><td>${e(r.activityTitle || r.row?.title || r.row?.activityId || '—')}<span class="sub">${e(semesterLabel(r.row?.semester))}</span></td><td>${e(r.row?.criterionId || r.row?.categoryId)} / ${e(r.row?.points)}</td><td>${badge(r.status === 'valid' ? 'Hợp lệ' : r.status === 'duplicate' ? 'Đã tồn tại' : 'Lỗi', r.status === 'valid' ? 'green' : r.status === 'duplicate' ? 'amber' : 'red')}</td><td class="import-errors">${(r.errors || []).map(e).join('<br>')}</td></tr>`).join('')}</tbody></table></div><form class="card-body" data-form="import-commit" style="padding-top:20px"><label>Tên đợt nhập<input name="batchName" value="${e(p.source?.title || p.source?.name || state.importPayload?.fileName || 'Cập nhật điểm chính thức')}" maxlength="180" required></label>${s.errors ? '<p class="inline-note" style="color:var(--red)">Sửa các dòng lỗi trong tệp rồi kiểm tra lại trước khi ghi nhận.</p>' : ''}<div class="form-error"></div><div class="form-actions"><button class="btn primary" type="submit" ${s.errors || (!s.valid && !s.duplicate) ? 'disabled' : ''}>${icon('check')}${s.valid ? 'Ghi nhận ' + num(s.valid) + ' khoản điểm' : 'Xác nhận bỏ qua dữ liệu trùng'}</button></div></form></section>`;
}
function renderReconciliation(d) {
  finish(
    heading(
      'Đối soát dữ liệu',
      'Liên kết kê khai với điểm chính thức để tránh cộng trùng.',
      btn('Nhập dữ liệu', 'navigate', 'primary', 'data-view="import"', 'upload'),
    ) +
      `<section class="metrics">${metric('Kê khai chưa khớp', d.claims?.length, 'Không gồm kê khai đã từ chối', 'file')}${metric('Khoản chưa liên kết', d.records?.length, 'Đã tính vào điểm chính thức', 'link')}${metric('Gợi ý đối chiếu', d.suggestions?.length, 'Cần xác minh trước khi liên kết', 'eye', 'amber')}${metric('Nguyên tắc xử lý', 1, 'Mỗi hoạt động chỉ tính một lần', 'shield', 'blue', 'lần')}</section><div class="help-box">Chỉ liên kết các khoản cùng sinh viên, học kỳ và tiêu chí quy chế. Tên gần giống chỉ là gợi ý. Đối soát loại kê khai khỏi phần chờ và giữ nguyên điểm chính thức.</div>${
        d.claims?.length
          ? d.claims
              .map((c) => {
                const rs = (d.records || []).filter(
                  (r) =>
                    r.studentId === c.studentId &&
                    r.semester === c.semester &&
                    r.criterionId === c.criterionId,
                );
                const ss = (d.suggestions || []).filter((s) => s.claimId === c.id);
                return `<section class="card recon-card"><div class="recon-head"><div><h3>${e(c.title)}</h3><p>${e(c.studentName)} · ${e(c.studentCode)} · ${e(c.categoryName)} · ${date(c.date)}</p></div><div>${badge(signedNum(c.claimedPoints) + ' điểm', 'green')} ${statusBadge(c.status)}</div></div>${ss.map((s) => `<div class="suggestion">Gợi ý: ${e(s.reason)} · ${e(d.records.find((r) => r.id === s.recordId)?.title || s.recordId)}</div>`).join('')}<form class="recon-match" data-form="match"><input type="hidden" name="claimId" value="${e(c.id)}"><select name="recordId" aria-label="Khoản điểm khớp với ${e(c.title)}" required><option value="">${rs.length ? 'Chọn khoản điểm chính thức' : 'Chưa có khoản phù hợp; cần nhập dữ liệu'}</option>${rs.map((r) => `<option value="${e(r.id)}">${e(r.title)} · ${num(r.points)} điểm · ${e(r.sourceId)}</option>`).join('')}</select><button class="btn primary small" type="submit" ${!rs.length ? 'disabled' : ''}>${icon('link')}Xác nhận liên kết</button><div class="form-error"></div></form></section>`;
              })
              .join('')
          : empty(
              'Không còn kê khai cần đối soát',
              'Mọi kê khai đã được liên kết hoặc chưa phát sinh mới.',
            )
      }<section class="card section-gap"><div class="card-head"><div><h2>Khoản chính thức chưa liên kết</h2><p>Các khoản này đã có trong điểm chính thức.</p></div></div>${officialTable(d.records || [])}</section>`,
  );
}
function renderReports(d) {
  const f = state.filters.reports || {};
  const basis = d.basis || f.basis || 'official';
  const query = new URLSearchParams({
    basis,
    classId: f.classId || '',
    semester: state.semester,
    academicYear: d.academicYear || currentAcademicYear(),
  });
  const s = d.stats;
  finish(
    heading(
      'Báo cáo & thống kê',
      'Theo dõi kết quả theo lớp và xuất dữ liệu phục vụ tổng hợp.',
      `<a class="btn" href="/api/export/report.csv?${e(query)}">CSV</a><a class="btn primary" href="/api/export/report.xlsx?${e(query)}">${icon('download')}Xuất Excel</a>`,
    ) +
      googlePanel('reports') +
      `<section class="card"><div class="card-head"><div><h2>Thống kê ${e(semesterLabel(state.semester))}</h2><p>Phần năm học bên dưới dùng điểm chính thức.</p></div></div><form class="toolbar" data-form="filters" data-view="reports"><div class="filter-group"><span class="filters-label">Phạm vi báo cáo</span><select name="classId" aria-label="Lớp báo cáo">${classOptions(d.classes || [], f.classId)}</select><select name="academicYear" aria-label="Năm học báo cáo">${academicYearOptions(d.academicYear || f.academicYear || currentAcademicYear())}</select><select name="basis" aria-label="Cơ sở báo cáo"><option value="official" ${basis === 'official' ? 'selected' : ''}>Điểm chính thức</option><option value="projected" ${basis === 'projected' ? 'selected' : ''}>Điểm dự kiến</option></select><button class="btn" type="submit">Cập nhật báo cáo</button>${state.session.user.provider === 'google' ? btn('Lưu vào Google Sheets', 'google-export', '', '', 'upload') : ''}</div></form><div class="card-body" style="padding-top:20px"><div class="preview-summary"><span>${num(s.total)} sinh viên</span><span>${num(s.hasData)} đã có dữ liệu</span><span>${num(s.noData)} chưa có dữ liệu</span>${badge(basis === 'official' ? 'Theo điểm chính thức' : 'Theo điểm dự kiến', basis === 'official' ? 'green' : 'amber')}</div></div></section><div class="grid-equal section-gap"><section class="card"><div class="card-head"><div><h2>Phân bố xếp loại</h2><p>Tỷ lệ tính trên ${num(s.total)} sinh viên trong phạm vi</p></div></div><div class="card-body">${distribution(s.byClassification || [], s.total)}</div></section><section class="card"><div class="card-head"><div><h2>Tổng hợp theo lớp</h2><p>Chưa có dữ liệu tách riêng khỏi 0 điểm</p></div></div><div class="table-wrap"><table><thead><tr><th>LỚP</th><th>SĨ SỐ</th><th>CHƯA CÓ</th><th>ĐIỂM TB</th><th>CẦN HỖ TRỢ</th></tr></thead><tbody>${(s.byClass || []).map((c) => `<tr><td class="name">${e(c.name)}</td><td>${num(c.total)}</td><td>${num(c.noData)}</td><td class="score teal">${c.average === null ? '—' : num(c.average)}</td><td>${num(c.atRisk)}</td></tr>`).join('')}</tbody></table></div></section></div><section class="card"><div class="card-head"><div><h2>Chi tiết sinh viên</h2><p>${basis === 'projected' ? 'Điểm dự kiến đã áp dụng giới hạn, chưa phải kết quả được trường xác nhận.' : 'Điểm chính thức theo dữ liệu đã nhập.'}</p></div></div>${studentTable(d.students || [])}</section>${yearReportHtml(d)}`,
  );
}

function yearReportHtml(d) {
  if (!d.semesterBreakdown?.length) return '';
  return `<section class="card section-gap"><div class="card-head"><div><h2>Kết quả năm học ${e(d.academicYear)}</h2><p>Trung bình điểm chính thức hai học kỳ theo Điều 12. Học kỳ thiếu hoặc không đánh giá chưa được thay bằng 0.</p></div></div><div class="table-wrap"><table><thead><tr><th>SINH VIÊN</th>${d.semesterBreakdown.map((x) => `<th>${e(semesterLabel(x.semester))}<br>ĐIỂM CHÍNH THỨC</th>`).join('')}<th>ĐIỂM NĂM HỌC</th><th>XẾP LOẠI NĂM</th></tr></thead><tbody>${(
    d.students || []
  )
    .map(
      (s) =>
        `<tr><td><strong>${e(s.name)}</strong><span class="sub">${e(s.code)}</span></td>${d.semesterBreakdown
          .map((x) => {
            const student = x.students.find((v) => v.id === s.id);
            return `<td>${student?.hasOfficialData ? scoreText(officialValue(student)) : '—'}<span class="sub">${e(evaluationLabels[student?.evaluationStatus] || 'Chưa có dữ liệu')}</span></td>`;
          })
          .join(
            '',
          )}<td class="score teal">${s.annualTotal === null || s.annualTotal === undefined ? '<span class="no-data">Chưa đủ dữ liệu</span>' : num(s.annualTotal)}</td><td>${classification(s.annualClassification, s.annualEvaluationStatus)}<span class="sub">${e(evaluationLabels[s.annualEvaluationStatus] || 'Chưa đủ dữ liệu năm học')}</span></td></tr>`,
    )
    .join('')}</tbody></table></div></section>`;
}

function criterionRateDescription(c) {
  if (c.unit === 'gpa') return 'TBHK <5: 0; 5–<6: 5; 6–<7: 6; 7–<8: 7; 8–<9: 8; 9–10: 10 điểm';
  if (c.unit === 'offline') return '7–10 hoạt động: 8; 11–14: 10; từ 15: 12 điểm';
  if (c.unit === 'approved') return 'Theo văn bản phê duyệt';
  return `${c.points > 0 ? '+' : ''}${num(c.points)} điểm / ${c.unit === 'semester' ? 'học kỳ' : 'lần'}`;
}

function renderRegulations() {
  state.regulationZoom = 100;
  finish(
    heading(
      'Quy chế Điểm rèn luyện',
      'Hiệu lực từ năm học 2025–2026. Đọc quy chế đánh giá kết quả rèn luyện ngay tại đây.',
      `<a class="btn" href="/docs/quy-che-ren-luyen-tdtu.pdf" target="_blank" rel="noopener noreferrer">${icon('book')}Mở PDF trong tab mới</a><a class="btn primary" href="/docs/quy-che-ren-luyen-tdtu.pdf" download="Quy-che-Diem-ren-luyen-TDTU.pdf">${icon('download')}Tải PDF</a>`,
    ) +
      `<section class="card regulation-document" aria-label="Tài liệu quy chế điểm rèn luyện"><div class="regulation-toolbar"><span>10 trang nội dung</span><div class="regulation-zoom" aria-label="Phóng to tài liệu"><button class="btn small" type="button" data-action="regulation-zoom" data-zoom="out" aria-label="Thu nhỏ" disabled>−</button><output id="regulation-zoom-level" aria-live="polite">100%</output><button class="btn small" type="button" data-action="regulation-zoom" data-zoom="in" aria-label="Phóng to">+</button><button class="btn small" type="button" data-action="regulation-zoom" data-zoom="reset">Vừa khung</button></div></div><div class="regulation-pages" tabindex="0" aria-label="Nội dung quy chế; cuộn để đọc các trang"><div class="regulation-page-list">${Array.from({ length: 10 }, (_, index) => `<figure class="regulation-page" id="regulation-page-${index + 1}"><img src="/regulations/page-${String(index + 1).padStart(2, '0')}.png" alt="Quy chế Điểm rèn luyện — Trang ${index + 1}" decoding="async"><figcaption>Trang ${index + 1} / 10</figcaption></figure>`).join('')}</div></div><p class="regulation-fallback">Bạn có thể <a href="/docs/quy-che-ren-luyen-tdtu.pdf" target="_blank" rel="noopener noreferrer">mở PDF gốc trong tab mới</a> hoặc <a href="/docs/quy-che-ren-luyen-tdtu.pdf" download="Quy-che-Diem-ren-luyen-TDTU.pdf">tải về để đọc</a>.</p></section>`,
  );
}
function zoomRegulations(direction) {
  const previous = state.regulationZoom || 100;
  const zoom =
    direction === 'reset'
      ? 100
      : Math.max(100, Math.min(200, previous + (direction === 'in' ? 25 : -25)));
  state.regulationZoom = zoom;
  const pages = $('.regulation-page-list');
  if (!pages) return;
  pages.style.width = zoom + '%';
  $('#regulation-zoom-level').textContent = zoom + '%';
  $('[data-action="regulation-zoom"][data-zoom="out"]').disabled = zoom <= 100;
  $('[data-action="regulation-zoom"][data-zoom="in"]').disabled = zoom >= 200;
}

function renderSettings(d) {
  const s = d.settings;
  finish(
    heading(
      'Quy tắc điểm',
      'Quy tắc cố định theo bản PDF được cung cấp; chỉ ngưỡng hỗ trợ có thể thay đổi.',
      `<a class="btn" href="/docs/quy-che-ren-luyen-tdtu.pdf" target="_blank" rel="noopener">${icon('book')}Mở PDF quy chế</a>`,
    ) +
      `<div class="source-panel"><strong>${e(s.source?.title || 'Quy chế đánh giá kết quả rèn luyện của sinh viên trình độ đại học hệ chính quy')}</strong><p>${e(s.source?.institution || 'Trường Đại học Tôn Đức Thắng')} · Hiệu lực từ năm học ${e(s.source?.effectiveFrom || '2025-2026')} · ${e(s.ruleVersion || s.versionName)}</p><p>${e(s.source?.provenance || 'Bản PDF do người dùng cung cấp.')} Dữ liệu sinh viên minh họa được ghi nhãn riêng với nguồn quy tắc.</p></div><section class="category-cards rules-categories">${s.categories.map((c) => `<article class="card category-card"><h3>${e(c.name)}</h3><div class="category-score">${num(c.maxPoints)}<small> điểm tối đa</small></div></article>`).join('')}</section><div class="grid-equal"><section class="card"><div class="card-head"><h2>Giới hạn & nguyên tắc</h2>${badge('Theo PDF', 'green')}</div><div class="card-body rule-notes"><p>Mỗi nội dung tối đa 20 điểm; tổng tối đa 100 điểm.</p><p>Tiêu chí tính theo lần dùng số lần thực tế. Tiêu chí theo học kỳ chỉ ghi nhận một lần mỗi kỳ.</p><p>GPA và số hoạt động trực tiếp do khoa đánh giá. Mức điểm theo phê duyệt cần số văn bản và số điểm đã được phê duyệt.</p><p>Khiển trách giới hạn xếp loại Khá; cảnh cáo giới hạn Trung bình. Đình chỉ hoặc buộc thôi học không đánh giá. Giới hạn xếp loại không sửa số điểm tính được.</p><p>Điểm năm học là trung bình hai học kỳ đủ dữ liệu; học kỳ thiếu chưa được thay bằng 0. Điểm toàn khóa là trung bình các kỳ thuộc khung chương trình.</p><p>Điểm học tập bình thường và thang quy đổi tập sự/học tập nước ngoài được trình bày riêng; không cộng đồng thời.</p></div></section><section class="card"><div class="card-head"><h2>Phân loại rèn luyện</h2></div><div class="table-wrap"><table><thead><tr><th>XẾP LOẠI</th><th>TỪ ĐIỂM</th></tr></thead><tbody>${s.classifications.map((c) => `<tr><td>${classification(c.label)}</td><td>${c.label === 'Kém' ? 'Dưới 35' : num(c.min)}</td></tr>`).join('')}</tbody></table></div><form class="card-body" style="padding-top:18px" data-form="settings"><label>Ngưỡng cảnh báo cần hỗ trợ<input type="number" name="riskThreshold" min="0" max="100" step="1" required value="${e(s.riskThreshold ?? 50)}"><small>Chỉ phục vụ theo dõi, không thay đổi điểm và ngưỡng xếp loại theo quy chế.</small></label><div class="form-error"></div><div class="form-actions"><button class="btn primary" type="submit">Lưu ngưỡng hỗ trợ</button></div></form></section></div><section class="card"><div class="card-head"><div><h2>Danh mục tiêu chí</h2><p>${num((s.criteria || criteriaCatalog()).length)} tiêu chí · Định mức và tham chiếu theo PDF</p></div></div><div class="table-wrap criterion-catalog"><table><thead><tr><th>NỘI DUNG</th><th>TIÊU CHÍ</th><th>ĐỊNH MỨC</th><th>THẨM QUYỀN / NGUỒN</th></tr></thead><tbody>${(s.criteria || criteriaCatalog()).map((c) => `<tr><td>${e(c.explicitCategoryRequired ? 'Theo văn bản phê duyệt' : s.categories.find((cat) => cat.id === c.categoryId)?.name || c.categoryId)}</td><td><strong>${e(c.name)}</strong><span class="sub">${e(c.id)}</span></td><td>${e(criterionRateDescription(c))}</td><td>${c.studentAllowed ? badge('Sinh viên có thể kê khai', 'green') : badge('Cán bộ đánh giá', 'blue')}<span class="sub">${e(c.reference)}</span></td></tr>`).join('')}</tbody></table></div></section>`,
  );
}
function renderLegacy(d) {
  const entries = [
    ...(d.activities || []).map((x) => ({ ...x, type: 'activity' })),
    ...(d.records || []).map((x) => ({ ...x, type: 'record' })),
    ...(d.claims || []).map((x) => ({ ...x, type: 'claim' })),
  ];
  state.legacyEntries = entries;
  const names = { activity: 'Hoạt động', record: 'Điểm chính thức cũ', claim: 'Kê khai cũ' };
  finish(
    heading(
      'Dữ liệu cần đối chiếu',
      'Dữ liệu cũ được giữ nguyên để truy vết; chưa cộng vào điểm theo quy chế mới.',
    ) +
      `<div class="settings-notice"><strong>Không tự ánh xạ các nội dung điểm cũ sang quy chế</strong>Kiểm tra nguồn và minh chứng rồi chọn đúng tiêu chí. Mỗi thay đổi được lưu vào nhật ký. Các khoản được gắn nhãn cũ sẽ không góp vào điểm chính thức hoặc dự kiến cho đến khi được đối chiếu.</div><section class="card"><div class="card-head"><h2>${num(entries.length)} mục cần đối chiếu</h2></div>${entries.length ? `<div class="table-wrap"><table><thead><tr><th>LOẠI</th><th>NỘI DUNG</th><th>SINH VIÊN</th><th>ĐIỂM CŨ</th><th>THAO TÁC</th></tr></thead><tbody>${entries.map((x) => `<tr><td>${e(names[x.type])}</td><td><strong>${e(x.title)}</strong><span class="sub">${e(x.categoryName || x.categoryId)} · ${e(x.semester || state.semester)}</span></td><td>${e(x.studentName || 'Hoạt động dùng chung')}<span class="sub">${e(x.studentCode || '')}</span></td><td>${scoreText(x.points ?? x.claimedPoints)}</td><td>${btn('Đối chiếu tiêu chí', 'legacy-edit', 'small', `data-id="${e(x.id)}" data-type="${x.type}"`)}</td></tr>`).join('')}</tbody></table></div>` : empty('Không còn dữ liệu cũ cần đối chiếu', 'Các khoản hợp lệ đang được tính theo tiêu chí quy chế.')}</section>`,
  );
}
function openLegacy(id, type) {
  const item = state.legacyEntries.find((x) => x.id === id && x.type === type);
  if (!item) throw Error('Không tìm thấy khoản cần đối chiếu.');
  modal(
    'Đối chiếu tiêu chí cho dữ liệu cũ',
    `<form data-form="legacy-reclassify"><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="type" value="${e(type)}"><div class="help-box"><strong>${e(item.title)}</strong><br>Khoản cũ chưa tính điểm. Chọn tiêu chí dựa trên chứng từ; hệ thống kiểm tra lại định mức.</div><div class="form-grid">${criterionFields('legacy')}</div>${formActions('Xác nhận phân loại lại')}</form>`,
  );
}
async function openAssessment(studentId) {
  const data = await api('/api/assessments/' + encodeURIComponent(studentId));
  const p = data.assessment || {};
  const s = data.student || state.data?.students?.find((x) => x.id === studentId) || {};
  const val = (k) => e(p[k] ?? '');
  const checked = (k) => (p[k] ? 'checked' : '');
  const options = (values, current) =>
    values
      .map(
        ([value, label]) =>
          `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`,
      )
      .join('');
  modal(
    'Đánh giá học kỳ',
    `<form data-form="assessment-save"><input type="hidden" name="studentId" value="${e(studentId)}"><div class="help-box"><strong>${e(s.name || 'Sinh viên')} · ${e(s.code || '')}</strong><br>${e(semesterLabel(state.semester))}. Để trống dữ liệu chưa xác nhận; không thay bằng 0.</div><div class="form-grid"><label>Điểm trung bình học kỳ (0–10)<input type="number" name="gpa" min="0" max="10" step="0.01" value="${val('gpa')}" placeholder="Chưa có GPA"><small>0 / 5 / 6 / 7 / 8 / 10 điểm quy đổi theo Điều 4.</small></label><label>Số hoạt động trực tiếp<input type="number" name="offlineActivityCount" min="0" step="1" value="${val('offlineActivityCount')}" placeholder="Chưa xác nhận"><small>7–10: 8; 11–14: 10; từ 15: 12 điểm.</small></label><label class="checkbox-field full"><input type="checkbox" name="complianceConfirmed" ${checked('complianceConfirmed')}>Đã xác nhận dữ liệu chấp hành nội quy trong học kỳ</label><label class="full">Kỷ luật có quyết định<select name="discipline">${options(
      [
        ['none', 'Không có'],
        ['reprimand', 'Khiển trách'],
        ['warning', 'Cảnh cáo'],
        ['warning2', 'Cảnh cáo lần 2'],
        ['suspended', 'Đình chỉ học tập'],
        ['expelled', 'Buộc thôi học'],
      ],
      p.discipline || 'none',
    )}</select><small>Trạng thái kỷ luật giới hạn xếp loại và quyền ghi nhận tiên phong; nhập khoản trừ theo từng quyết định ở dữ liệu chính thức. Trạng thái này không tự tạo khoản trừ. Không chọn kỷ luật thay cho việc nhập dữ liệu quyết định có mã nguồn.</small></label><label class="full">Chế độ học kỳ<select name="mode">${options(
      [
        ['normal', 'Học tập bình thường'],
        ['internship', 'Tập sự nghề nghiệp'],
        ['overseas', 'Học tập tại nước ngoài'],
      ],
      p.mode || 'normal',
    )}</select></label><label>Điểm tập sự / học tập nước ngoài<input type="number" name="placementGrade" min="0" max="10" step="0.01" value="${val('placementGrade')}"><small>Quy đổi 0–80 điểm; không cộng đồng thời GPA thường.</small></label><label>Thời gian học tại nước ngoài (tháng)<input type="number" name="monthsAbroad" min="0" step="0.5" value="${val('monthsAbroad')}"><small>Áp dụng học tập nước ngoài từ 2 tháng và có quyết định.</small></label><label>Khoa<input name="faculty" value="${e(p.faculty || 'CNTT')}" maxlength="100"></label><label>Tham chiếu quyết định chế độ đặc biệt<input name="approvalReference" value="${val('approvalReference')}" maxlength="500"></label><label class="checkbox-field full"><input type="checkbox" name="finalSemester" ${checked('finalSemester')}>Học kỳ cuối của khung đào tạo</label><label class="checkbox-field full"><input type="checkbox" name="specialApproved" ${checked('specialApproved')}>Đã kiểm tra quyết định cho phép áp dụng chế độ đặc biệt</label><div class="full inline-note">Đối với CNTT, Điện–Điện tử, Khoa học ứng dụng và Dược, chế độ tập sự/học tập nước ngoài áp dụng vào học kỳ cuối theo Điều 10. Trường hợp khác cần đúng quyết định và điều kiện áp dụng.</div><div class="full inline-note">Điểm ưu tiên theo Điều 12.11: nhập khoản chính thức bằng tiêu chí <strong>approved_adjustment</strong>, chọn nội dung theo văn bản và tham chiếu phê duyệt; vẫn áp dụng trần từng nội dung.</div></div>${formActions('Lưu đánh giá học kỳ')}</form>`,
  );
}

function openCourse(studentId) {
  modal(
    'Theo dõi toàn khóa',
    `<form data-form="course-summary"><input type="hidden" name="studentId" value="${e(studentId)}"><div class="help-box">Nhập thông tin chương trình thực tế để xác định phạm vi. Các kỳ thuộc phạm vi toàn khóa lấy từ danh mục học kỳ; cần đủ dữ liệu theo khung chương trình. Quy tắc đối chiếu theo bản PDF được cung cấp, không tự kết luận áp dụng hồi tố.</div><div class="form-grid"><label>Năm tuyển sinh<input type="number" name="cohortYear" min="1900" max="2200" step="1" placeholder="Năm tuyển sinh thực tế" required></label><label>Số học kỳ theo chương trình chuẩn<input type="number" name="standardSemesters" min="1" max="40" step="1" placeholder="Theo khung chương trình" required></label><label class="full">Chương trình<select name="program"><option value="standard">Chương trình tiêu chuẩn / CLC / tiên tiến / bằng tiếng Anh</option><option value="international">Liên kết đào tạo quốc tế</option></select></label><label class="full">Số học kỳ tại TDTU (chương trình liên kết)<input type="number" name="tdtuSemesters" min="1" max="40" step="1" placeholder="Nhập khi chọn liên kết quốc tế"></label><label class="checkbox-field full"><input type="checkbox" name="earlyGraduation">Đối chiếu trường hợp tốt nghiệp trước tiến độ</label></div><div class="form-error"></div><div class="form-actions"><button class="btn primary" type="submit">${icon('chart')}Xem kết quả toàn khóa</button></div></form><div id="course-result" aria-live="polite"></div>`,
  );
}
function renderCourseResult(data) {
  const r = data.result;
  return `<section class="section-gap"><h3>${e(data.student.name)} · ${e(data.student.code)}</h3><div class="detail-scores section-gap"><div>Trung bình phần đã đủ dữ liệu<strong>${scoreText(r.observedAverage)}</strong></div><div>Trung bình toàn khóa<strong>${scoreText(r.officialAverage)}</strong></div><div>Số kỳ đủ dữ liệu<strong>${num(r.evaluatedSemesters)} / ${num(r.requiredSemesters)}</strong></div></div>${classification(r.classification, r.evaluationStatus)} ${badge(evaluationLabels[r.evaluationStatus] || 'Chưa đầy đủ', r.complete ? 'green' : 'amber')}<div class="help-box"><strong>Đối chiếu ngưỡng tốt nghiệp: 50 điểm</strong><p>${r.graduationEligible === true ? 'Đạt ngưỡng theo dữ liệu đã đối chiếu.' : r.graduationEligible === false ? 'Chưa đạt ngưỡng theo dữ liệu đã đối chiếu.' : 'Chưa đủ dữ liệu để kết luận điều kiện.'}</p><p>Trung bình dùng xét ngưỡng: ${scoreText(r.graduationAverage)}.</p>${r.additionalActivitiesRequired !== null && r.additionalActivitiesRequired !== undefined ? `<p>Khóa đến 2024: tham gia bổ sung tối thiểu ${num(r.additionalActivitiesRequired)} hoạt động theo quy chế.</p>` : ''}${r.additionalPointsRequired !== null && r.additionalPointsRequired !== undefined ? `<p>Khóa từ 2025: điểm bổ sung cần tích lũy ${num(r.additionalPointsRequired)}, theo (50 − trung bình thực tế) × số học kỳ chương trình chuẩn.</p>` : ''}</div>${r.missingSemesters?.length ? `<div class="settings-notice"><strong>Các học kỳ chưa đủ dữ liệu</strong>${r.missingSemesters.map((x) => e(semesterLabel(x))).join('<br>')}</div>` : ''}<div class="table-wrap"><table><thead><tr><th>HỌC KỲ HIỆN CÓ</th><th>ĐIỂM CHÍNH THỨC</th><th>TRẠNG THÁI</th></tr></thead><tbody>${data.semesters.map((s) => `<tr><td>${e(semesterLabel(s.semester))}</td><td>${s.hasOfficialData ? scoreText(officialValue(s)) : '—'}</td><td>${e(evaluationLabels[s.evaluationStatus] || 'Chưa đầy đủ')}</td></tr>`).join('')}</tbody></table></div><p class="inline-note">${(r.notes || []).map(e).join('<br>')}</p></section>`;
}

function renderRoster(d) {
  const filters = state.filters.roster || {};
  const query = String(filters.q || '')
    .trim()
    .toLocaleLowerCase('vi');
  const rows = (d.students || []).filter(
    (student) =>
      (!query ||
        `${student.code} ${student.name} ${student.email}`
          .toLocaleLowerCase('vi')
          .includes(query)) &&
      (!filters.classId || student.classId === filters.classId) &&
      (!filters.faculty || student.faculty === filters.faculty) &&
      (!filters.cohortYear || String(student.cohortYear || '') === filters.cohortYear),
  );
  const assignments = d.assignmentsData?.assignments || [];
  const active = assignments.filter((assignment) => !assignment.revokedAt);
  const selectedOptions = (items, selected, label) =>
    `<option value="">${e(label)}</option>${items.map((item) => `<option value="${e(item)}" ${String(item) === String(selected) ? 'selected' : ''}>${e(item)}</option>`).join('')}`;
  const actions =
    (coordinator()
      ? btn('Nhập danh sách', 'roster-import', 'primary', '', 'upload') +
        btn('Sao chép danh sách', 'roster-copy', '', '', 'file') +
        btn('Phân công giảng viên', 'assignment-new', '', '', 'plus')
      : '') + btn('Lịch sử danh sách', 'roster-history', '', '', 'clock');
  finish(
    heading(
      'Danh sách và phân công',
      coordinator()
        ? 'Quản lý danh sách lớp theo học kỳ và phạm vi phụ trách của giảng viên.'
        : 'Danh sách sinh viên và lớp được giao trong học kỳ đang chọn.',
      actions,
    ) +
      `<p class="roster-policy">${coordinator() ? 'Bạn đang dùng quyền điều phối viên do máy chủ xác nhận. Nhập hoặc sao chép danh sách là thao tác rõ ràng theo từng kỳ; không tự suy ra khóa tuyển sinh từ MSSV.' : 'Chỉ những lớp được phân công cho bạn trong kỳ này mới xuất hiện. Quyền đọc các kỳ trước cũng được kiểm tra theo phân công từng kỳ.'} Chuyển lớp trong một kỳ không thay lớp ở kỳ khác hoặc sửa bản chốt đã lưu.</p>` +
      `<section class="card"><div class="card-head"><div><h2>Phân công giảng viên</h2><p>${num(active.length)} phân công đang có hiệu lực · ${e(semesterLabel(state.semester))}</p></div>${badge(coordinator() ? 'Điều phối viên' : 'Phạm vi được giao', 'blue')}</div>${assignments.length ? `<div class="table-wrap"><table class="assignment-table"><thead><tr><th>LỚP</th><th>GIẢNG VIÊN</th><th>THỜI ĐIỂM</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${assignments.map((assignment) => `<tr><td><strong>${e(assignment.className || assignment.classId)}</strong><span class="sub">${e(assignment.classId)}</span></td><td>${e(assignment.lecturerName || assignment.lecturerId)}<span class="sub">${e(assignment.lecturerEmail || '')}</span></td><td>${dateTime(assignment.createdAt)}${assignment.revokedAt ? `<span class="sub">Thu hồi: ${dateTime(assignment.revokedAt)}</span>` : ''}</td><td>${assignment.revokedAt ? badge('Đã thu hồi') : badge('Đang phụ trách', 'green')}</td><td>${coordinator() && !assignment.revokedAt ? btn('Thu hồi', 'assignment-revoke', 'small', `data-id="${e(assignment.id)}"`) : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có phân công', coordinator() ? 'Nhập danh sách lớp rồi phân công giảng viên để bắt đầu xử lý.' : 'Liên hệ điều phối viên nếu bạn cần phụ trách một lớp trong kỳ này.')}</section>` +
      `<section class="card section-gap"><div class="card-head"><div><h2>Danh sách theo học kỳ</h2><p>${num(d.students?.length)} hồ sơ trong phạm vi · Khoa và khóa chỉ hiển thị khi có dữ liệu xác nhận</p></div></div><form class="toolbar" data-form="filters" data-view="roster"><div class="filter-group"><div class="search">${icon('search')}<input name="q" value="${e(filters.q || '')}" placeholder="Tìm tên, MSSV, email…" aria-label="Tìm danh sách sinh viên"></div><select name="classId" aria-label="Lọc danh sách theo lớp">${classOptions(d.classes || [], filters.classId)}</select><select name="faculty" aria-label="Lọc theo khoa">${selectedOptions(d.faculties || [], filters.faculty, 'Tất cả khoa')}</select><select name="cohortYear" aria-label="Lọc theo khóa">${selectedOptions(d.cohorts || [], filters.cohortYear, 'Tất cả khóa')}</select><button type="submit" class="btn">Lọc danh sách</button></div></form>${rows.length ? `<div class="table-wrap"><table class="roster-table"><thead><tr><th>SINH VIÊN</th><th>LỚP TRONG KỲ</th><th>KHOA / KHÓA</th><th>CĂN CỨ DANH SÁCH</th><th></th></tr></thead><tbody>${rows.map((student) => `<tr><td><strong>${e(student.name)}</strong><span class="sub">${e(student.code)} · ${e(student.email)}</span></td><td>${e(student.className || student.classId || 'Chưa phân lớp')}<span class="sub">${e(student.classId || '')}</span></td><td>${e(student.faculty || 'Chưa xác định khoa')}<span class="sub">${student.cohortYear ? 'Khóa ' + e(student.cohortYear) : 'Chưa xác định khóa'}</span></td><td>${e(student.sourceId || 'Chưa có mã nguồn')}<span class="sub">${e(student.approvalReference || '')}</span></td><td>${btn('Lịch sử', 'roster-history', 'small', `data-id="${e(student.id)}"`, 'clock')}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có hồ sơ phù hợp', coordinator() ? 'Kỳ mới cần nhập hoặc sao chép danh sách. Dữ liệu thiếu không được tự chuyển thành kết quả 0.' : 'Bạn chưa có sinh viên trong phạm vi này hoặc chưa được phân công lớp.')}<div class="table-foot"><span>${num(rows.length)} hồ sơ phù hợp</span><span>Điểm và định danh được giữ riêng với lịch sử lớp.</span></div></section>`,
  );
}
function requireCoordinator() {
  if (!coordinator()) throw Error('Chức năng này dành cho điều phối viên được khai báo ở máy chủ.');
}
function openRosterImport() {
  requireCoordinator();
  state.rosterPreview = null;
  state.rosterPayload = null;
  modal(
    'Nhập danh sách học kỳ',
    `<form data-form="roster-preview"><p class="inline-note">Mỗi dòng xác định MSSV, email, lớp và học kỳ. Mã nguồn giữ căn cứ nhập; tệp có thể chứa nhiều kỳ. Có lỗi ở một dòng thì không ghi cả đợt. Không tự hợp nhất hồ sơ hoặc suy ra khóa từ MSSV.</p><div class="roster-template-links"><a class="btn small" href="/api/roster/template.xlsx">${icon('download')}Mẫu Excel</a><a class="btn small" href="/api/roster/template.csv">${icon('download')}Mẫu CSV</a></div><label class="section-gap">Chọn tệp Excel hoặc CSV<input type="file" name="file" accept=".xlsx,.csv" aria-label="Chọn tệp danh sách"></label><label class="section-gap">Hoặc dán dữ liệu CSV<textarea name="csv" rows="6" placeholder="sourceId,studentCode,name,email,classId,className,faculty,cohortYear,semester,approvalReference"></textarea></label>${formActions('Kiểm tra danh sách')}</form>`,
  );
}
function rosterPreviewHtml() {
  const data = state.rosterPreview;
  if (!data) return '';
  const summary = data.summary || {};
  return `<div class="detail-scores"><div>Hợp lệ<strong>${num(summary.valid)}</strong></div><div>Trùng nguồn<strong>${num(summary.duplicate)}</strong></div><div>Dòng lỗi<strong>${num(summary.errors)}</strong></div></div><div class="table-wrap roster-preview"><table><thead><tr><th>DÒNG</th><th>SINH VIÊN</th><th>LỚP / HỌC KỲ</th><th>KẾT QUẢ KIỂM TRA</th></tr></thead><tbody>${(data.rows || []).map((item) => `<tr><td>${num(item.index)}</td><td>${e(item.row?.studentCode)}<span class="sub">${e(item.row?.name)} · ${e(item.row?.email)}</span></td><td>${e(item.row?.className || item.row?.classId)}<span class="sub">${e(semesterLabel(item.row?.semester))}</span></td><td>${badge(item.status === 'error' ? 'Có lỗi' : item.status === 'duplicate' ? 'Đã nhập' : 'Hợp lệ', item.status === 'error' ? 'red' : item.status === 'duplicate' ? '' : 'green')}<span class="sub">${(item.errors || []).map(e).join('; ')}</span></td></tr>`).join('')}</tbody></table></div><form data-form="roster-commit" class="section-gap"><label>Tên đợt nhập<input name="batchName" maxlength="200" value="${e(state.rosterPayload?.fileName || 'Danh sách học kỳ')}" required></label><label class="section-gap">Lý do và căn cứ cập nhật<textarea name="reason" rows="3" maxlength="2000" required placeholder="Nêu nguồn danh sách và lý do bổ sung hoặc chuyển lớp"></textarea></label><p class="inline-note">Máy chủ kiểm tra lại quyền, khóa kỳ, danh tính và mã nguồn trong lúc ghi. Chuyển lớp chỉ tác động học kỳ ghi trong từng dòng; không thay ID hoặc các khoản điểm.</p><div class="form-error" role="alert"></div><div class="form-actions">${btn('Chọn lại tệp', 'roster-import')}<button class="btn primary" type="submit" ${summary.errors || !data.rows?.length ? 'disabled' : ''}>${icon('check')}Ghi nhận danh sách</button></div></form>`;
}
function openRosterCopy() {
  requireCoordinator();
  const periods = semesterCatalog();
  const destinations = periods.filter((row) => row.state !== 'closed');
  const options = (rows, selected) =>
    rows
      .map(
        (row) =>
          `<option value="${e(row.id)}" ${row.id === selected ? 'selected' : ''}>${e(semesterLabel(row.id))}</option>`,
      )
      .join('');
  const from = periods.find((row) => row.id !== state.semester)?.id || state.semester;
  modal(
    'Sao chép danh sách sang học kỳ',
    `<form data-form="roster-copy"><p class="inline-note">Sao chép danh sách lớp, khoa và khóa đã ghi nhận vào kỳ đích còn trống; không sao chép điểm, hồ sơ đánh giá hoặc phân công giảng viên. Thao tác có mã nguồn mới và lịch sử riêng.</p><div class="form-grid section-gap"><label>Học kỳ nguồn<select name="fromSemester" required>${options(periods, from)}</select></label><label>Học kỳ nhận danh sách<select name="toSemester" required>${options(destinations, state.semester)}</select></label><label class="full">Lý do sao chép<textarea name="reason" rows="3" maxlength="2000" required></textarea></label></div>${destinations.length ? formActions('Sao chép danh sách') : '<p class="form-error">Chưa có kỳ chưa chốt để nhận danh sách.</p>'}</form>`,
  );
}
async function openAssignment() {
  requireCoordinator();
  const data = state.assignmentContext || (await api('/api/assignments'));
  const classes = (data.classes || []).filter((row) => row.id !== 'unassigned');
  const lecturers = data.lecturers || (await api('/api/lecturers')).lecturers || [];
  modal(
    'Phân công giảng viên',
    `<form data-form="assignment-create"><p class="inline-note">${e(semesterLabel(state.semester))}. Phân công quyết định quyền đọc và xử lý dữ liệu của lớp trong đúng kỳ này, kể cả khi xem lại kỳ đã chốt. Không tự chia sẻ lại các tệp Drive cũ.</p><div class="form-grid section-gap"><label class="full">Lớp<select name="classId" required><option value="">Chọn lớp</option>${classes.map((row) => `<option value="${e(row.id)}">${e(row.name)} · ${e(row.id)}</option>`).join('')}</select></label><label class="full">Giảng viên<select name="lecturerId" required><option value="">Chọn giảng viên đã đăng nhập</option>${lecturers.map((row) => `<option value="${e(row.id)}">${e(row.name)} · ${e(row.email)}</option>`).join('')}</select></label><label class="full">Lý do phân công<textarea name="reason" maxlength="2000" required rows="3"></textarea></label></div>${formActions('Lưu phân công')}</form>`,
  );
}
function openAssignmentRevoke(id) {
  requireCoordinator();
  const row = state.assignmentContext?.assignments?.find((assignment) => assignment.id === id);
  if (!row) throw Error('Không tìm thấy phân công. Hãy tải lại danh sách.');
  modal(
    'Thu hồi phân công',
    `<form data-form="assignment-revoke"><input type="hidden" name="id" value="${e(id)}"><p>${e(row.lecturerName || row.lecturerEmail || row.lecturerId)} · ${e(row.className || row.classId)} · ${e(semesterLabel(row.semester))}</p><p class="inline-note">Thu hồi quyền xử lý trong ứng dụng, giữ nguyên kết quả và lịch sử phân công. Quyền đã chia sẻ trực tiếp trên Drive cần được chủ tệp kiểm tra riêng.</p><label class="section-gap">Lý do thu hồi<textarea name="reason" rows="3" maxlength="2000" required></textarea></label>${formActions('Thu hồi phân công')}</form>`,
  );
}
async function openRosterHistory(studentId) {
  const data = await api(
    '/api/roster/history' + (studentId ? '?studentId=' + encodeURIComponent(studentId) : ''),
  );
  const describe = (value, redacted = false) => {
    if (redacted) return 'Ngoài phạm vi phân công';
    if (!value) return 'Chưa có';
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return value;
      }
    }
    return [
      value.className || value.classId || 'Chưa phân lớp',
      value.faculty || 'Chưa xác định khoa',
      value.cohortYear ? 'Khóa ' + value.cohortYear : 'Chưa xác định khóa',
    ].join(' · ');
  };
  modal(
    'Lịch sử danh sách',
    `<p class="inline-note">${e(semesterLabel(state.semester))}. Lịch sử giữ người thực hiện, thời điểm, lý do và dữ liệu trước/sau.</p>${data.history?.length ? `<div class="roster-history">${data.history.map((entry) => `<article><strong>${e(entry.action || 'Cập nhật danh sách')}</strong><span class="sub">${dateTime(entry.createdAt)} · ${e(entry.actorName || 'Hệ thống')} · ${e(entry.studentCode || entry.studentId || '')}</span><p>${e(entry.reason || entry.approvalReference || '')}</p><p class="inline-note">Trước: ${e(describe(entry.before, entry.beforeRedacted))}<br>Sau: ${e(describe(entry.after))}</p></article>`).join('')}</div>` : empty('Chưa có lịch sử trong phạm vi này', 'Nhập và chuyển lớp được ghi nhận tại đúng học kỳ.')}<div class="form-actions">${btn('Đóng', 'close-modal')}</div>`,
  );
}

function renderSemesters(d) {
  finish(
    heading(
      'Năm học và học kỳ',
      'Cấu hình thời hạn, tổng hợp và lưu các lần chốt điểm.',
      btn('Thêm học kỳ', 'semester-new', 'primary', '', 'plus'),
    ) +
      `<p class="semester-policy">Điều phối viên quản lý danh mục, chốt và mở lại toàn kỳ. Giảng viên xử lý các lớp được phân công trong từng kỳ. Hạn kê khai áp dụng cho sinh viên; giai đoạn tổng hợp vẫn cho giảng viên cập nhật, đối soát trong phạm vi phụ trách. Chốt kỳ khóa mọi thay đổi kết quả.</p><section class="card"><div class="card-head"><div><h2>Danh mục dùng chung</h2><p>Giao diện, nhập CSV/Excel/Sheets và báo cáo cùng sử dụng danh mục này. Thời gian hiển thị UTC+7.</p></div></div><div class="table-wrap"><table><thead><tr><th>NĂM HỌC / HỌC KỲ</th><th>TRẠNG THÁI</th><th>THỜI GIAN KÊ KHAI</th><th>TỔNG HỢP</th><th>THAO TÁC</th></tr></thead><tbody>${(d.semesters || []).map((row) => `<tr><td><strong>${e(row.name)}</strong><span class="sub">${e(row.academicYear)} · Thứ tự ${num(row.term)}</span><span class="sub">${e(row.id)}</span></td><td>${semesterStateBadge(row.state)}</td><td>${row.startsAt ? dateTime(row.startsAt) : 'Không giới hạn bắt đầu'}<span class="sub">${row.deadline ? 'Đến ' + dateTime(row.deadline) : 'Chưa đặt hạn'}</span></td><td>${row.annualIncluded ? badge('Tính năm', 'outline') : ''} ${row.courseIncluded ? badge('Tính toàn khóa', 'outline') : ''}</td><td><div class="semester-actions">${row.state !== 'closed' ? btn('Cấu hình', 'semester-edit', 'small', `data-id="${e(row.id)}"`) : ''}${row.state === 'open' ? btn('Tổng hợp', 'semester-transition', 'small', `data-id="${e(row.id)}" data-transition="review"`) : ''}${row.state !== 'closed' ? btn('Chốt và khóa', 'semester-transition', 'small primary', `data-id="${e(row.id)}" data-transition="close"`) : btn('Mở lại', 'semester-transition', 'small', `data-id="${e(row.id)}" data-transition="reopen"`)}${btn('Lịch sử', 'semester-history', 'small', `data-id="${e(row.id)}"`, 'clock')}</div></td></tr>`).join('')}</tbody></table></div></section>`,
  );
}
const semesterInputTime = (value) =>
  value ? new Date(Date.parse(value) + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
function openSemester(id) {
  const row = id ? semesterInfo(id) : null;
  if (id && !row) throw Error('Không tìm thấy học kỳ.');
  modal(
    row ? 'Cấu hình học kỳ' : 'Thêm học kỳ',
    `<form data-form="semester-save"><input type="hidden" name="editingId" value="${e(id || '')}"><div class="form-grid"><label class="full">Tên học kỳ<input name="name" value="${e(row?.name || '')}" maxlength="160" required placeholder="Ví dụ: Học kỳ 1"></label><label class="full">Mã học kỳ<input name="id" value="${e(row?.id || '')}" maxlength="100" ${row ? 'readonly' : 'required'} placeholder="Ví dụ: 2027-2028-HK1"><small>Mã duy nhất dùng trong tệp nhập và API; giữ nguyên sau khi tạo.</small></label><label>Năm học<input name="academicYear" value="${e(row?.academicYear || '')}" placeholder="2027-2028" pattern="[0-9]{4}-[0-9]{4}" required ${row?.metadataVerified !== false && row ? 'readonly' : ''}></label><label>Thứ tự học kỳ trong năm<input type="number" name="term" value="${e(row?.term || 1)}" min="1" max="20" step="1" required ${row?.metadataVerified !== false && row ? 'readonly' : ''}></label><label>Bắt đầu kê khai (UTC+7)<input type="datetime-local" step="60" name="startsAt" value="${semesterInputTime(row?.startsAt)}"><small>Để trống nếu không giới hạn bắt đầu.</small></label><label>Hạn kê khai (UTC+7)<input type="datetime-local" step="60" name="deadline" value="${semesterInputTime(row?.deadline)}"><small>Đúng thời điểm này, sinh viên dừng gửi kê khai.</small></label><label class="checkbox-field full"><input type="checkbox" name="annualIncluded" ${row ? (row.annualIncluded ? 'checked' : '') : 'checked'}>Thuộc hai học kỳ dùng tính điểm năm học</label><label class="checkbox-field full"><input type="checkbox" name="courseIncluded" ${row ? (row.courseIncluded ? 'checked' : '') : 'checked'}>Đưa vào phạm vi xét kết quả toàn khóa</label><p class="full inline-note">Kỳ bổ sung (thứ tự từ 3) không tính điểm năm hoặc toàn khóa theo cấu hình hiện tại. Mỗi năm cần đúng hai học kỳ hợp lệ để có điểm năm; tạo thiếu kỳ không thay dữ liệu thiếu bằng 0.</p></div>${formActions(row ? 'Lưu cấu hình' : 'Tạo học kỳ')}</form>`,
  );
}
function openSemesterTransition(id, action) {
  const row = semesterInfo(id);
  if (!row) throw Error('Không tìm thấy học kỳ.');
  const labels = {
    review: 'Chuyển sang tổng hợp',
    close: 'Chốt và khóa học kỳ',
    reopen: 'Mở lại học kỳ',
  };
  if (!labels[action]) throw Error('Thao tác học kỳ không hợp lệ.');
  const description =
    action === 'close'
      ? 'Lưu một bản chốt mới gồm kết quả, trạng thái đầy đủ dữ liệu, bộ quy tắc và căn cứ nguồn. Những hồ sơ thiếu dữ liệu vẫn giữ trạng thái thiếu; không được công bố thành kết quả 0. Mọi đường cập nhật kết quả sẽ bị khóa.'
      : action === 'reopen'
        ? 'Bản chốt cũ tiếp tục được giữ trong lịch sử. Lần chốt tiếp theo sẽ tạo phiên bản mới. Thời hạn kê khai hiện tại vẫn được giữ; hãy cấu hình lại hạn nếu cần nhận kê khai từ sinh viên.'
        : 'Sinh viên dừng kê khai. Giảng viên vẫn có thể bổ sung hồ sơ, nhập điểm và đối soát trước khi chốt.';
  modal(
    labels[action],
    `<form data-form="semester-transition"><input type="hidden" name="semesterId" value="${e(id)}"><input type="hidden" name="action" value="${e(action)}"><h3>${e(semesterLabel(id))}</h3><p class="inline-note">${e(description)}</p><label class="section-gap">Lý do<textarea name="reason" maxlength="2000" rows="3" required placeholder="Ghi căn cứ và lý do thực hiện để lưu nhật ký"></textarea></label>${action === 'close' ? '<label class="checkbox-field section-gap"><input type="checkbox" name="acknowledgeIncomplete">Tôi chấp nhận chốt cả các hồ sơ chưa hoàn tất, giữ nguyên trạng thái thiếu dữ liệu và chưa kết luận điểm cuối cùng.</label><p class="inline-note">Nếu còn hồ sơ chưa hoàn tất, cần đánh dấu xác nhận này và ghi lý do để chốt kỳ.</p>' : ''}${formActions(labels[action])}</form>`,
  );
}
function semesterHistoryEvent(item) {
  const label =
    item.fromState === item.toState
      ? 'Cập nhật cấu hình'
      : item.fromState === 'closed'
        ? 'Mở lại học kỳ'
        : item.toState === 'closed'
          ? 'Chốt và khóa'
          : item.toState === 'review'
            ? 'Chuyển sang tổng hợp'
            : 'Tạo học kỳ';
  const before = item.changes?.before;
  const after = item.changes?.after;
  const configuration = (period) =>
    period
      ? `${period.name} · Bắt đầu: ${period.startsAt ? dateTime(period.startsAt) : 'không giới hạn'} · Hạn: ${period.deadline ? dateTime(period.deadline) : 'chưa đặt'} · Tính năm: ${period.annualIncluded ? 'có' : 'không'} · Toàn khóa: ${period.courseIncluded ? 'có' : 'không'}`
      : '';
  return `<article><strong>${e(label)}</strong><span class="sub">${dateTime(item.createdAt)} · ${e(item.actorName)}</span><p>${e(item.reason || '')}</p><p class="inline-note">${item.fromState ? semesterStateBadge(item.fromState) + ' → ' : ''}${semesterStateBadge(item.toState)}</p>${before ? `<p class="inline-note">Trước: ${e(configuration(before))}</p>` : ''}${after ? `<p class="inline-note">Sau: ${e(configuration(after))}</p>` : ''}</article>`;
}
async function openSemesterHistory(id) {
  const data = await api('/api/semesters/' + encodeURIComponent(id) + '/snapshots');
  modal(
    'Lịch sử học kỳ',
    `<h3>${e(semesterLabel(id))}</h3><p class="inline-note">Mỗi bản chốt được giữ riêng. Tệp tải gồm dữ liệu và căn cứ tại thời điểm chốt.</p>${data.snapshots?.length ? `<div class="table-wrap section-gap"><table><thead><tr><th>BẢN CHỐT</th><th>THỜI GIAN / NGƯỜI CHỐT</th><th>LÝ DO</th><th>HỒ SƠ CHƯA HOÀN TẤT</th><th></th></tr></thead><tbody>${data.snapshots.map((snapshot) => `<tr><td>Phiên bản ${num(snapshot.version)}</td><td>${dateTime(snapshot.createdAt)}<span class="sub">${e(snapshot.actorName)}</span></td><td class="semester-reason">${e(snapshot.reason)}</td><td>${num(snapshot.incompleteCount)}</td><td>${btn('Tải bản chốt', 'semester-snapshot', 'small', `data-semester="${e(id)}" data-id="${e(snapshot.id)}"`, 'download')}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có bản chốt', 'Khi chốt kỳ, một bản lưu mới sẽ được tạo.')}<h3 class="section-gap">Thay đổi trạng thái</h3>${data.history?.length ? `<div class="semester-history">${data.history.map(semesterHistoryEvent).join('')}</div>` : '<p class="inline-note">Chưa có thay đổi trạng thái.</p>'}<div class="form-actions">${btn('Đóng', 'close-modal')}</div>`,
  );
}
async function downloadSemesterSnapshot(id, snapshotId) {
  const data = await api(
    '/api/semesters/' + encodeURIComponent(id) + '/snapshots/' + encodeURIComponent(snapshotId),
  );
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data.snapshot, null, 2)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `ban-chot-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-v${data.snapshot.version}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const appealStatuses = {
  pending: ['Đang chờ xử lý', 'amber'],
  needs_info: ['Cần bổ sung', 'blue'],
  approved: ['Đã xử lý chấp thuận', 'green'],
  rejected: ['Không chấp thuận', 'red'],
  withdrawn: ['Đã rút yêu cầu', ''],
};
const appealTargetNames = {
  record: 'Khoản điểm chính thức',
  claim: 'Kê khai',
  assessment: 'Đánh giá học kỳ',
};
const appealBadge = (status) => badge(...(appealStatuses[status] || [status, '']));
const activeAppeal = (appeal) => ['pending', 'needs_info'].includes(appeal.status);
const evidenceStatuses = {
  uploading: ['Đang tải lên', 'amber'],
  uploaded: ['Đã tải, chưa hoàn tất chia sẻ', 'amber'],
  shared: ['Đã chia sẻ', 'green'],
  sharing_failed: ['Chia sẻ chưa hoàn tất', 'red'],
  needs_reshare: ['Cần cập nhật người nhận', 'amber'],
  failed: ['Tải lên không thành công', 'red'],
};
const evidenceBadge = (status) =>
  badge(...(evidenceStatuses[status] || [status || 'Chưa theo dõi', '']));
function renderAppeals(d) {
  const f = state.filters.appeals || {};
  const rows = (d.appeals || []).filter(
    (row) =>
      (!f.status || row.status === f.status) &&
      (!f.q ||
        `${row.targetTitle} ${row.reason} ${row.studentName} ${row.studentCode}`
          .toLocaleLowerCase('vi')
          .includes(f.q.toLocaleLowerCase('vi'))),
  );
  finish(
    heading(
      'Phúc tra và điều chỉnh',
      lecturer()
        ? 'Xử lý yêu cầu trong phạm vi lớp phụ trách, lưu rõ căn cứ và dữ liệu trước sau.'
        : 'Gửi yêu cầu theo từng khoản hoặc đánh giá học kỳ và theo dõi phản hồi.',
      !lecturer() ? btn('Gửi yêu cầu phúc tra', 'appeal-new', 'primary', '', 'plus') : '',
    ) +
      '<p class="workflow-policy">Gửi yêu cầu và bổ sung minh chứng chưa thay đổi điểm. Điều chỉnh chỉ có hiệu lực sau khi cán bộ xử lý có căn cứ; kỳ chốt cần được điều phối viên mở lại trước khi thay đổi kết quả. Khoản gốc được giữ và không cộng cùng khoản thay thế.</p>' +
      `<section class="card"><form class="toolbar" data-form="filters" data-view="appeals"><div class="filter-group"><div class="search">${icon('search')}<input name="q" value="${e(f.q || '')}" placeholder="Tìm yêu cầu, sinh viên…" aria-label="Tìm phúc tra"></div><select name="status" aria-label="Trạng thái phúc tra"><option value="">Tất cả trạng thái</option>${Object.entries(
        appealStatuses,
      )
        .map(
          ([key, value]) =>
            `<option value="${key}" ${f.status === key ? 'selected' : ''}>${e(value[0])}</option>`,
        )
        .join(
          '',
        )}</select><button type="submit" class="btn">Lọc yêu cầu</button></div></form>${rows.length ? `<div class="table-wrap"><table class="appeals-table"><thead><tr><th>YÊU CẦU</th><th>SINH VIÊN</th><th>TRẠNG THÁI</th><th>CẬP NHẬT</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${e(row.targetTitle || appealTargetNames[row.targetType])}</strong><span class="sub">${e(appealTargetNames[row.targetType])}</span><span class="sub workflow-text">${e(row.reason)}</span></td><td>${e(row.studentName || '')}<span class="sub">${e(row.studentCode || '')}</span></td><td>${appealBadge(row.status)}</td><td>${dateTime(row.updatedAt || row.createdAt)}</td><td>${btn('Xem yêu cầu', 'appeal-detail', 'small', `data-id="${e(row.id)}"`, 'eye')}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có yêu cầu phù hợp', lecturer() ? 'Yêu cầu của sinh viên thuộc phạm vi được giao sẽ xuất hiện tại đây.' : 'Bạn có thể gửi yêu cầu cho khoản chính thức, kê khai hoặc đánh giá học kỳ.')}<div class="table-foot">${num(rows.length)} yêu cầu trong phạm vi</div></section>`,
  );
}
async function loadWorkspaceStatus() {
  if (state.session.user.provider !== 'google') return;
  try {
    state.google = await api('/api/google/status');
  } catch {
    state.google = null;
  }
}
async function openAppeal(type = '', targetId = '') {
  if (lecturer()) throw Error('Yêu cầu phúc tra do sinh viên gửi cho hồ sơ của mình.');
  const [official, claims] = await Promise.all([api('/api/official-records'), api('/api/claims')]);
  const targets = [
    ...(official.records || [])
      .filter((row) => !recordSuperseded(row) && !isLegacy(row))
      .map((row) => ({
        ...row,
        type: 'record',
        label: `${row.title} · ${scoreText(row.points)} điểm · ${row.sourceId}`,
      })),
    ...(claims.claims || [])
      .filter((row) => row.status !== 'matched' && !row.officialRecordId)
      .map((row) => ({
        ...row,
        type: 'claim',
        label: `${row.title} · ${statuses[row.status]?.[0] || row.status}`,
      })),
    {
      id: state.session.user.studentId,
      type: 'assessment',
      label: 'Đánh giá học kỳ: GPA, chấp hành, hoạt động trực tiếp và chế độ học kỳ',
    },
  ];
  const selected = type && targetId ? `${type}|${targetId}` : '';
  modal(
    'Gửi yêu cầu phúc tra',
    `<form data-form="appeal-create"><p class="inline-note">Yêu cầu được gửi cho người phụ trách đúng kỳ. Bạn vẫn có thể đề nghị phúc tra khi kỳ đã chốt; điểm giữ nguyên đến khi có xử lý hợp lệ.</p><label class="section-gap">Khoản cần phúc tra<select name="target" required><option value="">Chọn khoản hoặc đánh giá</option>${targets.map((row) => `<option value="${e(row.type + '|' + row.id)}" ${selected === row.type + '|' + row.id ? 'selected' : ''}>${e(appealTargetNames[row.type])} · ${e(row.label)}</option>`).join('')}</select></label><label class="section-gap">Nội dung và lý do<textarea name="reason" rows="5" maxlength="2000" required placeholder="Nêu dữ liệu cần đối chiếu, nội dung chưa đúng và căn cứ bạn có"></textarea></label><label class="section-gap">Liên kết minh chứng nếu có<input name="evidenceUrl" type="url" placeholder="https://drive.google.com/…"><small>Liên kết tự nhập chưa xác nhận quyền chia sẻ. Sau khi tạo yêu cầu, bạn có thể tải tệp vào đúng yêu cầu và bổ sung.</small></label>${formActions('Gửi yêu cầu')}</form>`,
  );
}
function workflowValue(value) {
  if (value === null || value === undefined) return 'Chưa có';
  if (typeof value !== 'object') return String(value);
  const row = value.assessment || value.correction || value;
  const parts = [];
  if (row.status)
    parts.push(appealStatuses[row.status]?.[0] || statuses[row.status]?.[0] || row.status);
  if (row.title) parts.push(row.title);
  if (row.sourceId) parts.push(`Nguồn: ${row.sourceId}`);
  if (row.points !== undefined) parts.push(`${scoreText(row.points)} điểm`);
  if (row.claimedPoints !== undefined) parts.push(`${scoreText(row.claimedPoints)} điểm kê khai`);
  if (row.criterionId) parts.push(criterionName(row));
  if (row.quantity !== undefined) parts.push(`Giá trị tiêu chí: ${row.quantity}`);
  if (row.gpa !== undefined) parts.push(`TBHK: ${row.gpa === null ? 'chưa xác nhận' : row.gpa}`);
  if (row.complianceConfirmed !== undefined)
    parts.push(`Chấp hành: ${row.complianceConfirmed ? 'đã xác nhận' : 'chưa xác nhận'}`);
  if (row.offlineActivityCount !== undefined)
    parts.push(
      `Hoạt động trực tiếp: ${row.offlineActivityCount === null ? 'chưa xác nhận' : row.offlineActivityCount}`,
    );
  if (row.approvalReference) parts.push(`Căn cứ: ${row.approvalReference}`);
  return parts.join(' · ') || 'Đã lưu trong lịch sử xử lý';
}
async function openAppealDetail(id) {
  const data = await api('/api/appeals/' + encodeURIComponent(id));
  await loadWorkspaceStatus();
  state.appealDetail = data;
  const a = data.appeal;
  const own = !lecturer() && a.studentId === state.session.user.studentId;
  const active = activeAppeal(a);
  const target = data.target?.assessment || data.target || {};
  const url = safeUrl(a.evidenceUrl);
  modal(
    'Chi tiết yêu cầu phúc tra',
    `<div class="recon-head"><div><h3>${e(a.targetTitle || appealTargetNames[a.targetType])}</h3><p>${e(a.studentName || '')} · ${e(a.studentCode || '')}</p><span class="sub">${e(semesterLabel(a.semester))}</span></div>${appealBadge(a.status)}</div><p class="workflow-text section-gap">${e(a.reason)}</p><p class="inline-note"><strong>Dữ liệu của khoản:</strong> ${e(workflowValue(target))}</p><p class="inline-note"><strong>Minh chứng:</strong> ${url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">Mở minh chứng ↗</a>` : 'Chưa có liên kết'}. ${a.evidenceId ? btn('Trạng thái tệp', 'evidence-detail', 'small', `data-id="${e(a.evidenceId)}"`) : url ? 'Liên kết tự nhập; quyền chia sẻ chưa được theo dõi.' : ''}</p>${a.targetType === 'claim' ? '<p class="workflow-policy">Chấp thuận phúc tra kê khai chỉ kiểm tra lại kê khai, chưa cấp điểm chính thức. Khoản chính thức vẫn cần nguồn nhập và đối soát.</p>' : ''}${lecturer() && active ? `<div class="workflow-actions">${btn('Yêu cầu bổ sung', 'appeal-resolve', '', `data-id="${e(a.id)}" data-resolution="request_info"`)}${btn('Không chấp thuận', 'appeal-resolve', '', `data-id="${e(a.id)}" data-resolution="reject"`)}${btn(a.targetType === 'claim' ? 'Chấp thuận kiểm tra lại' : 'Điều chỉnh có căn cứ', 'appeal-resolve', 'primary', `data-id="${e(a.id)}" data-resolution="approve" ${semesterInfo(a.semester)?.state === 'closed' ? 'disabled title="Điều phối viên cần mở lại kỳ trước khi áp dụng điều chỉnh"' : ''}`)}</div>${semesterInfo(a.semester)?.state === 'closed' ? '<p class="inline-note">Kỳ đã chốt: có thể yêu cầu bổ sung hoặc ghi nhận từ chối; cần mở lại để điều chỉnh kết quả.</p>' : ''}` : ''}<section class="section-gap"><h3>Lịch sử xử lý</h3>${data.events?.length ? `<div class="workflow-timeline">${data.events.map((event) => `<article><strong>${e({ create: 'Gửi yêu cầu', submit: 'Gửi yêu cầu', supplement: 'Bổ sung', withdraw: 'Rút yêu cầu', request_info: 'Yêu cầu bổ sung', reject: 'Không chấp thuận', approve: 'Xử lý chấp thuận' }[event.action] || event.action)}</strong><span class="sub">${dateTime(event.createdAt)} · ${e(event.actorName || '')}</span><p class="workflow-text">${e(event.reason || '')}</p>${event.before || event.after ? `<p class="inline-note">Trước: ${e(workflowValue(event.before))}<br>Sau: ${e(workflowValue(event.after))}</p>` : ''}</article>`).join('')}</div>` : '<p class="inline-note">Chưa có sự kiện xử lý.</p>'}</section>${own && active ? `<form data-form="appeal-respond" class="section-gap"><input type="hidden" name="id" value="${e(a.id)}"><h3>Bổ sung thông tin</h3><label class="section-gap">Nội dung bổ sung<textarea name="reason" rows="3" maxlength="2000" required></textarea></label><div class="form-grid section-gap">${evidenceFields('appeal', a.id)}</div>${formActions('Gửi bổ sung')}</form><div class="workflow-actions">${btn('Rút yêu cầu', 'appeal-withdraw', '', `data-id="${e(a.id)}"`)}</div>` : ''}<div class="form-actions">${btn('Đóng', 'close-modal')}</div>`,
  );
  if (data.adjustment) {
    const adjustment = data.adjustment;
    const section = `<section class="appeal-adjustment section-gap"><h3>Điều chỉnh đã ghi nhận</h3><div class="workflow-comparison"><div><strong>Trước xử lý</strong><p>${e(workflowValue(adjustment.before))}</p></div><div><strong>Sau xử lý</strong><p>${e(workflowValue(adjustment.after))}</p></div></div><p class="inline-note">${dateTime(adjustment.createdAt)} · ${e(adjustment.actorName || '')}<br>Căn cứ: ${e(adjustment.approvalReference || '')}<br>Lý do: ${e(adjustment.reason || '')}</p></section>`;
    const historySection = $('#modal .workflow-timeline')?.parentElement;
    if (historySection) historySection.insertAdjacentHTML('beforebegin', section);
    else $('#modal .modal-body').insertAdjacentHTML('beforeend', section);
  }
}
function assessmentCorrectionFields(profile = {}) {
  const p = profile.assessment || profile;
  const val = (name) => e(p[name] ?? '');
  const check = (name) => (p[name] ? 'checked' : '');
  const options = (pairs, selected) =>
    pairs
      .map(
        ([value, label]) =>
          `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`,
      )
      .join('');
  return `<label>Điểm trung bình học kỳ<input type="number" name="gpa" min="0" max="10" step="0.01" value="${val('gpa')}" placeholder="Chưa xác nhận"></label><label>Số hoạt động trực tiếp<input type="number" name="offlineActivityCount" min="0" step="1" value="${val('offlineActivityCount')}" placeholder="Chưa xác nhận"></label><label class="checkbox-field full"><input type="checkbox" name="complianceConfirmed" ${check('complianceConfirmed')}>Đã xác nhận chấp hành</label><label class="full">Kỷ luật có quyết định<select name="discipline">${options(
    [
      ['none', 'Không có'],
      ['reprimand', 'Khiển trách'],
      ['warning', 'Cảnh cáo'],
      ['warning2', 'Cảnh cáo lần 2'],
      ['suspended', 'Đình chỉ'],
      ['expelled', 'Buộc thôi học'],
    ],
    p.discipline || 'none',
  )}</select></label><label>Chế độ học kỳ<select name="mode">${options(
    [
      ['normal', 'Thông thường'],
      ['internship', 'Tập sự nghề nghiệp'],
      ['overseas', 'Học nước ngoài'],
    ],
    p.mode || 'normal',
  )}</select></label><label>Khoa<input name="faculty" value="${e(p.faculty || 'CNTT')}" required maxlength="200"></label><label>Điểm tập sự hoặc học nước ngoài<input name="placementGrade" type="number" min="0" max="10" step="0.01" value="${val('placementGrade')}"></label><label>Số tháng học nước ngoài<input name="monthsAbroad" type="number" min="0" step="any" value="${val('monthsAbroad')}"></label><label class="checkbox-field full"><input type="checkbox" name="finalSemester" ${check('finalSemester')}>Học kỳ cuối</label><label class="checkbox-field full"><input type="checkbox" name="specialApproved" ${check('specialApproved')}>Đã xác nhận đủ điều kiện áp dụng chế độ đặc biệt</label>`;
}
function correctionRecordFields(target = {}) {
  return `<label class="full">Mã nguồn khoản thay thế<input name="sourceId" required maxlength="200" placeholder="Mã quyết định hoặc dòng nguồn điều chỉnh mới"><small>Không dùng lại mã của khoản gốc; mã gốc và liên kết được giữ nguyên để đối chiếu.</small></label><label class="full">Tên khoản thay thế<input name="title" value="${e(target.title || '')}" maxlength="300" required></label><label>Ngày ghi nhận<input name="date" type="date" value="${e(target.date || new Date().toISOString().slice(0, 10))}" required></label><label>Tiêu chí<select name="criterionId" data-correction-criterion required>${criterionOptions(target.criterionId || '', criteriaCatalog())}</select></label><label class="full" data-correction-category>Nội dung theo văn bản<select name="categoryId">${categoriesCatalog()
    .map(
      (category) =>
        `<option value="${e(category.id)}" ${category.id === target.categoryId ? 'selected' : ''}>${e(category.name)}</option>`,
    )
    .join(
      '',
    )}</select></label><label>Giá trị hoặc số lượng<input name="quantity" type="number" step="any" min="0" required value="${e(target.quantity ?? 1)}"><small data-correction-rate></small></label><label data-correction-points>Điểm theo văn bản<input name="points" type="number" min="0" step="any" value="${e(target.points ?? '')}"><small>Chỉ nhập điểm ở tiêu chí theo phê duyệt; tiêu chí còn lại do máy chủ tính.</small></label>`;
}
function refreshCorrectionFields(form) {
  const criterion = criteriaCatalog().find((item) => item.id === form.elements.criterionId?.value);
  if (!criterion) return;
  const quantity = form.elements.quantity;
  quantity.readOnly = ['semester', 'approved'].includes(criterion.unit);
  if (quantity.readOnly) quantity.value = '1';
  quantity.min = ['gpa', 'offline'].includes(criterion.unit) ? '0' : '1';
  quantity.step = criterion.unit === 'gpa' ? '0.01' : '1';
  if (criterion.unit === 'gpa') quantity.max = '10';
  else if (criterion.unit === 'occurrence') quantity.max = '100';
  else quantity.removeAttribute('max');
  $('[data-correction-rate]', form).textContent = criterionRateDescription(criterion);
  $('[data-correction-category]', form).hidden = !criterion.explicitCategoryRequired;
  form.elements.categoryId.disabled = !criterion.explicitCategoryRequired;
  $('[data-correction-points]', form).hidden = criterion.unit !== 'approved';
  form.elements.points.required = criterion.unit === 'approved';
  form.elements.points.disabled = criterion.unit !== 'approved';
}
async function openAppealResolution(id, action) {
  if (!lecturer()) throw Error('Chức năng này dành cho giảng viên phụ trách.');
  const data = await api('/api/appeals/' + encodeURIComponent(id));
  state.appealDetail = data;
  const a = data.appeal;
  const labels = {
    request_info: 'Yêu cầu bổ sung',
    reject: 'Không chấp thuận',
    approve: a.targetType === 'claim' ? 'Chấp thuận kiểm tra lại kê khai' : 'Điều chỉnh có căn cứ',
  };
  if (!labels[action]) throw Error('Thao tác phúc tra không hợp lệ.');
  if (action === 'approve' && semesterInfo(a.semester)?.state === 'closed')
    throw Error('Điều phối viên cần mở lại kỳ trước khi điều chỉnh.');
  modal(
    labels[action],
    `<form data-form="appeal-resolve"><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="action" value="${e(action)}"><input type="hidden" name="targetType" value="${e(a.targetType)}"><p><strong>${e(a.targetTitle || appealTargetNames[a.targetType])}</strong></p><p class="inline-note">${e(a.studentName || '')} · ${e(a.studentCode || '')} · ${e(semesterLabel(a.semester))}</p>${action === 'approve' ? `<p class="workflow-policy">${a.targetType === 'record' ? 'Ghi khoản mới thay thế khoản gốc; chỉ khoản có hiệu lực góp vào điểm. Dữ liệu gốc và lịch sử không bị xóa.' : a.targetType === 'assessment' ? 'Dữ liệu đánh giá trước và sau được lưu cùng người xử lý, thời điểm và căn cứ. Để trống phần chưa xác nhận, không thay bằng 0.' : 'Chỉ đánh dấu đã kiểm tra lại kê khai. Điểm chưa trở thành chính thức; cần nguồn chính thức và đối soát riêng.'}</p><div class="form-grid section-gap">${a.targetType === 'record' ? correctionRecordFields(data.target || {}) : a.targetType === 'assessment' ? assessmentCorrectionFields(data.target || {}) : ''}<label class="full">Tham chiếu văn bản hoặc nguồn xác nhận<input name="approvalReference" required maxlength="1000" placeholder="Số quyết định, văn bản hoặc nguồn xác nhận"></label></div>` : ''}<label class="section-gap">Lý do và kết luận xử lý<textarea name="reason" required rows="4" maxlength="2000"></textarea></label>${formActions(labels[action])}</form>`,
  );
  const form = $('[data-form="appeal-resolve"]');
  if (a.targetType === 'record' && action === 'approve') refreshCorrectionFields(form);
}
function renderEvidence(d) {
  const f = state.filters.evidence || {};
  const rows = (d.evidence || []).filter((row) => !f.status || row.status === f.status);
  finish(
    heading(
      'Minh chứng',
      'Theo dõi trạng thái tải tệp, người nhận và lỗi chia sẻ trong phạm vi được phép.',
      btn('Tải lại trạng thái', 'refresh', '', '', 'refresh'),
    ) +
      '<p class="workflow-policy">Tệp đã tải chưa đồng nghĩa đã chia sẻ đủ và không tự tạo điểm. Chủ tệp có thể đồng bộ quyền do ứng dụng quản lý cho người phụ trách hiện tại. Quyền tự chia sẻ ngoài ứng dụng cần kiểm tra trực tiếp trên Drive.</p>' +
      `<section class="card"><form class="toolbar" data-form="filters" data-view="evidence"><div class="filter-group"><select name="status" aria-label="Trạng thái minh chứng"><option value="">Tất cả trạng thái</option>${Object.entries(
        evidenceStatuses,
      )
        .map(
          ([key, value]) =>
            `<option value="${key}" ${f.status === key ? 'selected' : ''}>${e(value[0])}</option>`,
        )
        .join(
          '',
        )}</select><button type="submit" class="btn">Lọc tệp</button></div></form>${rows.length ? `<div class="table-wrap"><table class="evidence-table"><thead><tr><th>TỆP MINH CHỨNG</th><th>SINH VIÊN</th><th>TRẠNG THÁI</th><th>CẬP NHẬT</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${e(row.fileName || row.name || 'Tệp minh chứng')}</strong><span class="sub">${row.size ? `${num(row.size / 1024)} KB` : ''} · ${row.purpose === 'appeal' ? 'Phúc tra' : 'Kê khai'}</span></td><td>${e(row.studentName || '')}<span class="sub">${e(row.studentCode || '')}</span></td><td>${evidenceBadge(row.status)}${row.error ? `<span class="sub workflow-text">${e(row.error)}</span>` : ''}</td><td>${dateTime(row.updatedAt || row.createdAt)}</td><td>${btn('Xem trạng thái', 'evidence-detail', 'small', `data-id="${e(row.id)}"`, 'eye')}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có tệp được theo dõi', 'Tải tệp từ biểu mẫu kê khai hoặc từ yêu cầu phúc tra đang xử lý. Liên kết minh chứng cũ vẫn được giữ ở hồ sơ gốc và chưa được coi là đã xác nhận chia sẻ.')}</section>`,
  );
}
function evidenceInfo(data) {
  return data.evidence || data;
}
async function openEvidenceDetail(id) {
  const data = await api('/api/evidence/' + encodeURIComponent(id));
  const item = evidenceInfo(data);
  const shared = item.sharedWith || [];
  const errors = item.shareErrors || [];
  const cleanup = item.cleanupErrors || [];
  const url = safeUrl(item.url);
  const history = item.history || data.events || [];
  modal(
    'Trạng thái minh chứng',
    `<h3>${e(item.fileName || item.name || 'Tệp minh chứng')}</h3><p class="inline-note">${e(item.studentName || '')} · ${e(item.studentCode || '')} · ${e(semesterLabel(item.semester))}</p><p>${evidenceBadge(item.status)}</p>${item.error || item.warning ? `<p class="workflow-warning" role="status">${e(item.error || item.warning)}</p>` : ''}<p class="inline-note">Tải lên: ${dateTime(item.createdAt)}<br>Cập nhật: ${dateTime(item.updatedAt || item.createdAt)}</p><p>${url ? `<a class="btn small" href="${e(url)}" target="_blank" rel="noopener noreferrer">${icon('eye')}Mở tệp Drive</a>` : 'Chưa có liên kết tệp. Nếu tải thất bại trước khi Google tạo tệp, hãy chọn lại tệp trong biểu mẫu.'}</p><section class="section-gap"><h3>Chia sẻ đã ghi nhận</h3>${shared.length ? `<ul class="workflow-recipient-list">${shared.map((email) => `<li>${e(email)}</li>`).join('')}</ul>` : '<p class="inline-note">Chưa ghi nhận người nhận được chia sẻ.</p>'}${errors.length ? `<p class="workflow-warning">Chưa chia sẻ được: ${errors.map(e).join(', ')}</p>` : ''}${cleanup.length ? `<p class="workflow-warning">Cần chủ tệp kiểm tra thu hồi quyền do ứng dụng quản lý: ${cleanup.map(e).join(', ')}</p>` : ''}<p class="inline-note">Đây là trạng thái lần xử lý đã lưu, không xác nhận người nhận đã đọc tệp hoặc quyền Drive chưa bị thay đổi trực tiếp bên ngoài.</p></section>${history.length ? `<section class="section-gap"><h3>Lịch sử trạng thái</h3><div class="workflow-timeline">${history.map((event) => `<article><strong>${e(evidenceStatuses[event.after?.status || event.status]?.[0] || event.action || 'Cập nhật minh chứng')}</strong><span class="sub">${dateTime(event.createdAt)} · ${e(event.actorName || '')}</span><p>${e(event.reason || event.after?.error || event.error || '')}</p></article>`).join('')}</div></section>` : ''}<div class="workflow-actions">${item.canRetry && state.session.user.provider === 'google' ? btn('Đồng bộ quyền chia sẻ', 'evidence-retry', 'primary', `data-id="${e(item.id)}"`, 'refresh') : ''}${lecturer() && item.ownerUserId !== state.session.user.id ? btn('Nhắc chủ tệp kiểm tra chia sẻ', 'evidence-request-share', '', `data-id="${e(item.id)}"`) : ''}${item.appealId ? btn('Xem yêu cầu phúc tra', 'appeal-detail', '', `data-id="${e(item.appealId)}"`) : ''}${btn('Đóng', 'close-modal')}</div><p class="inline-note">Đồng bộ bằng đúng tài khoản Google đã tải tệp và kết nối Workspace còn hiệu lực. Ứng dụng kiểm tra quyền đang có, cấp cho người phụ trách hiện tại và thu hồi quyền cũ do ứng dụng đã tạo. Quyền chia sẻ thủ công được giữ; chủ tệp kiểm tra riêng trên Drive.</p>`,
  );
}
function renderNotifications(d) {
  const f = state.filters.notifications || {};
  const rows = (d.notifications || []).filter(
    (row) => !f.unreadOnly || row.readAt === null || row.readAt === undefined,
  );
  finish(
    heading(
      'Thông báo',
      'Tiến độ xử lý và nhắc thời hạn được lưu trong ứng dụng; trạng thái đã đọc được giữ khi đăng nhập lại.',
      btn('Đánh dấu tất cả đã đọc', 'notifications-read-all', '', '', 'check') +
        btn('Tải lại', 'refresh', '', '', 'refresh'),
    ) +
      `<section class="card"><div class="card-head"><div><h2>${num(d.unreadCount)} thông báo chưa đọc</h2><p>Chỉ hiển thị nội dung còn thuộc phạm vi của tài khoản hiện tại.</p></div></div>${rows.length ? `<div class="notification-list">${rows.map((row) => `<article class="notification-item ${row.readAt ? '' : 'unread'}"><div><h3>${e(row.title || 'Cập nhật hồ sơ')}</h3><p class="workflow-text">${e(row.message || '')}</p><span class="sub">${dateTime(row.createdAt)}${row.semester ? ' · ' + e(semesterLabel(row.semester)) : ''}${row.readAt ? ' · Đã đọc' : ' · Chưa đọc'}</span></div><div class="workflow-actions">${row.entityType && row.entityId ? btn('Xem nội dung', 'notification-open', 'small', `data-id="${e(row.id)}"`, 'eye') : ''}${!row.readAt ? btn('Đã đọc', 'notification-read', 'small', `data-id="${e(row.id)}"`, 'check') : ''}</div></article>`).join('')}</div>` : empty('Chưa có thông báo', 'Các thay đổi về yêu cầu, kê khai, minh chứng và thời hạn sẽ xuất hiện ở đây khi có liên quan đến bạn.')}</section>`,
  );
}
async function openNotification(id) {
  const note = (state.notificationData?.notifications || state.data?.notifications || []).find(
    (row) => row.id === id,
  );
  if (!note) throw Error('Thông báo chưa sẵn sàng. Hãy tải lại.');
  await api('/api/notifications/' + encodeURIComponent(id) + '/read', {}, 'PATCH');
  if (note.semester && semesterInfo(note.semester)) {
    state.semester = note.semester;
    try {
      localStorage.setItem('conduct.semester', note.semester);
    } catch {}
  }
  if (['appeal', 'appeals'].includes(note.entityType)) {
    await navigate('appeals');
    await openAppealDetail(note.entityId);
  } else if (['evidence', 'file'].includes(note.entityType)) {
    await navigate('evidence');
    await openEvidenceDetail(note.entityId);
  } else if (['claim', 'claims'].includes(note.entityType)) {
    await navigate('claims');
    await claimDetail(note.entityId);
  } else await navigate('dashboard');
  await refreshNotifications();
}

function renderAudit(d) {
  finish(
    heading(
      'Nhật ký hệ thống',
      'Truy vết thao tác nhập điểm, kiểm tra minh chứng, đối soát và thay đổi quy tắc.',
    ) +
      `<section class="card"><div class="card-head"><div><h2>Lịch sử thao tác</h2><p>${num(d.entries?.length)} bản ghi gần nhất</p></div>${badge('Có thể truy vết', 'green')}</div>${d.entries?.length ? `<div class="table-wrap"><table><thead><tr><th>THỜI GIAN</th><th>NGƯỜI THỰC HIỆN</th><th>THAO TÁC</th><th>NỘI DUNG</th></tr></thead><tbody>${d.entries.map((a) => `<tr><td>${dateTime(a.createdAt)}</td><td class="name">${e(a.actorName)}</td><td>${e(a.action)}</td><td style="white-space:normal;min-width:260px">${e(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail)}</td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có thao tác', 'Nhật ký tự động ghi nhận các thay đổi trong ứng dụng.')}</section>`,
  );
}

async function openClaim(activityId = '') {
  const d = await api('/api/claims');
  state.claimContext = d;
  if (state.session.user.provider === 'google' && !state.google) {
    try {
      state.google = await api('/api/google/status');
    } catch {}
  }
  const activities = (d.activities || []).filter(
    (a) => !isLegacy(a) && permittedCriteria().some((c) => c.id === a.criterionId),
  );
  modal(
    'Kê khai hoạt động',
    `<form data-form="claim-create"><div class="help-box">Chọn tiêu chí phù hợp với hoạt động đã tham gia. GPA, chấp hành và số hoạt động trực tiếp được khoa đánh giá theo học kỳ. Các khoản theo phê duyệt chỉ do cán bộ ghi nhận.</div><div class="form-grid">${lecturer() ? `<label class="full">Sinh viên<select name="studentId" required><option value="">Chọn sinh viên</option>${(d.students || []).map((x) => `<option value="${e(x.id)}">${e(x.code)} · ${e(x.name)}</option>`).join('')}</select></label>` : ''}<label class="full">Hoạt động<select name="activityId" id="claim-activity"><option value="">Hoạt động ngoài danh sách</option>${activities.map((a) => `<option value="${e(a.id)}" ${a.id === activityId ? 'selected' : ''}>${e(a.title)}</option>`).join('')}</select></label>${criterionFields('claim')}<label class="full">Tên hoạt động<input name="title" required maxlength="220"></label><label>Đơn vị tổ chức<input name="organizer" maxlength="160" required></label><label>Ngày tham gia<input name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>${evidenceFields()}<label class="full">Ghi chú<textarea name="note" maxlength="2000"></textarea></label></div>${formActions('Gửi kê khai')}</form>`,
  );
  if (activityId) fillActivity(activityId);
}
function fillActivity(id) {
  const a = state.claimContext?.activities?.find((x) => x.id === id);
  if (!a) return;
  const f = $('[data-form="claim-create"]');
  for (const key of ['title', 'organizer', 'date', 'criterionId', 'quantity', 'approvalReference'])
    if (f.elements[key]) f.elements[key].value = a[key] ?? (key === 'quantity' ? 1 : '');
  if (f.elements.explicitCategoryId) f.elements.explicitCategoryId.value = a.categoryId || '';
  if (a.points !== undefined) f.elements.claimedPoints.value = a.points;
  refreshCriterion(f);
}
async function openActivity() {
  await api('/api/activities');
  modal(
    'Tạo hoạt động',
    `<form data-form="activity-create"><div class="form-grid">${criterionFields('activity')}<label class="full">Tên hoạt động<input name="title" required maxlength="220"></label><label class="full">Đơn vị tổ chức<input name="organizer" required maxlength="160"></label><label>Ngày tổ chức<input name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label><label>Hình thức<select name="mode"><option value="offline">Trực tiếp</option><option value="online">Trực tuyến</option></select></label></div><p class="inline-note">Hoạt động mới chưa tự tạo điểm chính thức. Định mức, nội dung và đơn vị tính lấy từ tiêu chí trong PDF.</p>${formActions('Tạo hoạt động')}</form>`,
  );
}

async function getClaim(id) {
  let c = (state.data?.claims || state.data?.recentClaims || []).find((c) => c.id === id);
  if (!c) c = (await api('/api/claims')).claims.find((c) => c.id === id);
  if (!c) throw Error('Không tìm thấy kê khai.');
  return c;
}
async function claimDetail(id) {
  const c = await getClaim(id);
  const url = safeUrl(c.evidenceUrl);
  modal(
    'Chi tiết kê khai',
    `<div class="recon-head"><div><h3>${e(c.title)}</h3><p>${e(c.studentName)} · ${e(c.studentCode)}</p></div>${statusBadge(c.status)}</div><div class="detail-scores"><div>Điểm đề nghị<strong>${signedNum(c.claimedPoints)}</strong></div><div>Ngày tham gia<strong style="font-size:15px">${date(c.date)}</strong></div><div>Học kỳ<strong style="font-size:12px">${e(c.semester)}</strong></div></div><p><strong>Nội dung:</strong> ${e(c.categoryName)}</p><p class="inline-note"><strong>Tiêu chí:</strong> ${e(criterionName(c))} ${legacyTag(c)}</p><p class="inline-note"><strong>Đơn vị:</strong> ${e(c.organizer || '—')}</p><p class="inline-note"><strong>Ghi chú:</strong> ${e(c.note || 'Không có')}</p><p class="inline-note"><strong>Ý kiến kiểm tra:</strong> ${e(c.reviewNote || 'Chưa có')}</p><p class="inline-note"><strong>Minh chứng:</strong> ${url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">Mở liên kết minh chứng ↗</a>` : 'Chưa đính kèm liên kết hợp lệ'}</p>${c.projectionExcluded ? `<div class="help-box">${e(c.projectionExclusionReason)}</div>` : ''}${c.officialRecordId ? `<div class="help-box">Đã liên kết khoản chính thức ${e(c.officialRecordId)}. Khoản kê khai này đã được loại khỏi phần chờ.</div>` : ''}<div class="form-actions">${btn('Đóng', 'close-modal')}</div>`,
  );
  const actions = $('#modal .modal-body > .form-actions');
  if (actions && !lecturer() && c.status !== 'matched' && !c.officialRecordId)
    actions.insertAdjacentHTML(
      'afterbegin',
      btn('Phúc tra kê khai', 'appeal-new', '', `data-type="claim" data-id="${e(c.id)}"`, 'link'),
    );
  if (actions && c.evidenceId)
    actions.insertAdjacentHTML(
      'afterbegin',
      btn('Trạng thái minh chứng', 'evidence-detail', '', `data-id="${e(c.evidenceId)}"`, 'upload'),
    );
  else if (url && actions)
    actions.insertAdjacentHTML(
      'beforebegin',
      '<p class="inline-note">Liên kết minh chứng này chưa có lịch sử tải/chia sẻ được theo dõi; không được coi là đã xác nhận đủ quyền truy cập.</p>',
    );
}
async function reviewClaim(id, rejected) {
  const c = await getClaim(id);
  modal(
    rejected ? 'Từ chối kê khai' : 'Kiểm tra minh chứng',
    `<form data-form="claim-review"><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="status" value="${rejected ? 'rejected' : 'reviewed'}"><div class="help-box"><strong>${e(c.title)}</strong><br>${e(c.studentName)} · ${num(c.claimedPoints)} điểm.${rejected ? ' Kê khai bị từ chối sẽ không còn trong điểm dự kiến.' : ' Xác nhận đã kiểm tra không tự biến điểm kê khai thành điểm chính thức.'}</div>${safeUrl(c.evidenceUrl) ? `<p style="margin-bottom:18px"><a href="${e(safeUrl(c.evidenceUrl))}" target="_blank" rel="noopener noreferrer">Mở minh chứng ↗</a></p>` : ''}<label>${rejected ? 'Lý do từ chối' : 'Ghi chú kiểm tra'}<textarea name="note" maxlength="2000" ${rejected ? 'required' : ''} placeholder="${rejected ? 'Nhập lý do để sinh viên biết cần bổ sung gì…' : 'Nội dung đã xác minh…'}"></textarea></label>${formActions(rejected ? 'Từ chối kê khai' : 'Xác nhận đã kiểm tra')}</form>`,
  );
}
async function studentDetail(id) {
  const s = state.data?.students?.find((x) => x.id === id);
  if (!s) throw Error('Không tìm thấy sinh viên.');
  const [claims, official] = await Promise.all([api('/api/claims'), api('/api/official-records')]);
  modal(
    'Hồ sơ rèn luyện',
    `<div class="student-cell" style="margin-bottom:20px"><span class="avatar" style="width:45px;height:45px">${e(initials(s.name))}</span><div><h3>${e(s.name)}</h3><p class="muted">${e(s.code)} · ${e(s.className)}</p></div></div><div class="detail-scores"><div>Chính thức<strong>${s.hasOfficialData ? scoreText(officialValue(s)) : '—'}</strong></div><div>Chờ ghi nhận<strong>${signedNum(s.pendingTotal)}</strong></div><div>Dự kiến<strong>${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</strong></div></div>${classification(officialLabel(s), s.evaluationStatus)}${evaluationNotice(s)}<div class="section-gap"><h3>Điểm theo mục</h3><div class="field-list" style="margin-top:12px">${s.categoryScores.map((c) => `<div class="class-summary"><span>${e(c.name)}</span><strong>${scoreText(['no_data', 'not_evaluated'].includes(s.evaluationStatus) ? null : c.official)} / ${num(c.maxPoints)} · chờ ${signedNum(c.pending)}</strong></div>`).join('')}</div></div><div class="section-gap"><h3>Điểm chính thức</h3>${officialTable(official.records.filter((r) => r.studentId === id))}</div><div class="section-gap"><h3>Kê khai</h3>${claimTable(
      claims.claims.filter((c) => c.studentId === id),
      false,
    )}</div><div class="form-actions">${btn('Theo dõi toàn khóa', 'course-open', '', `data-id="${e(id)}"`, 'chart')}${btn('Đóng', 'close-modal')}</div>`,
  );
}
const fileBase64 = (f) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(Error('Không đọc được tệp.'));
    r.readAsDataURL(f);
  });
async function evidenceUpload(button) {
  const form = button.closest('form');
  if (!form) throw Error('Không tìm thấy biểu mẫu của minh chứng.');
  const purpose = form.elements.purpose?.value || 'claim';
  if (purpose !== 'appeal') assertSemesterWrite();
  const f = form.elements.evidenceFile?.files?.[0];
  if (!f) throw Error('Hãy chọn tệp minh chứng trước.');
  if (f.size > 5 * 1024 * 1024) throw Error('Minh chứng tối đa 5 MB.');
  button.disabled = true;
  const resultNode = $('#evidence-result', form);
  if (resultNode) resultNode.textContent = 'Đang tải và kiểm tra chia sẻ với người phụ trách…';
  let data;
  try {
    data = await api('/api/google/evidence', {
      semester:
        purpose === 'appeal'
          ? state.appealDetail?.appeal?.semester || state.semester
          : state.semester,
      studentId: form.elements.studentId?.value || state.session.user.studentId,
      purpose,
      ...(purpose === 'appeal' ? { appealId: form.elements.appealId?.value } : {}),
      fileName: f.name,
      fileBase64: await fileBase64(f),
      mimeType: f.type,
    });
  } catch (error) {
    if (resultNode)
      resultNode.textContent = `Chưa hoàn tất tải minh chứng: ${error.message}. Kiểm tra trang Minh chứng trước khi thử lại nếu Google đã tạo tệp.`;
    throw error;
  } finally {
    button.disabled = false;
  }
  form.elements.evidenceUrl.value = data.url;
  if (form.elements.evidenceId)
    form.elements.evidenceId.value = data.evidenceId || data.evidence?.id || '';
  if (resultNode)
    resultNode.innerHTML = `Đã lưu ${e(data.name)}. ${data.warning ? e(data.warning) : 'Đã chia sẻ cho giảng viên.'} ${safeUrl(data.url) ? `<a href="${e(safeUrl(data.url))}" target="_blank" rel="noopener noreferrer">Mở tệp ↗</a>` : ''}`;
  toast(
    data.sharingComplete === true
      ? 'Đã lưu minh chứng và chia sẻ cho người phụ trách.'
      : data.warning ||
          'Đã lưu tệp; chia sẻ minh chứng chưa hoàn tất. Hãy kiểm tra trước khi gửi kê khai.',
    data.sharingComplete !== true,
  );
  button.disabled = false;
}
document.addEventListener('click', async (event) => {
  const b = event.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (a === 'regulation-zoom') {
    zoomRegulations(b.dataset.zoom);
    return;
  }
  try {
    if (a === 'navigate') {
      go(b.dataset.view);
      return;
    }
    if (a === 'toggle-menu') {
      $('.sidebar')?.classList.toggle('open');
      $('.overlay')?.classList.toggle('visible');
      return;
    }
    if (a === 'close-modal') {
      $('#modal').close();
      return;
    }
    if (a === 'boot-retry') {
      await boot();
      return;
    }
    if (a === 'refresh') {
      await navigate(state.view);
      return;
    }
    if (a === 'google-help') {
      modal(
        'Kết nối Google TDTU',
        '<p>Đăng nhập Google hiện chưa sẵn sàng. Vui lòng liên hệ người quản trị để được hỗ trợ.</p><div class="form-actions">' +
          btn('Đã hiểu', 'close-modal') +
          '</div>',
      );
      return;
    }
    if (a === 'appeal-new') {
      await openAppeal(b.dataset.type || '', b.dataset.id || '');
      return;
    }
    if (a === 'appeal-detail') {
      await openAppealDetail(b.dataset.id);
      return;
    }
    if (a === 'appeal-resolve') {
      await openAppealResolution(b.dataset.id, b.dataset.resolution);
      return;
    }
    if (a === 'appeal-withdraw') {
      modal(
        'Rút yêu cầu phúc tra',
        `<form data-form="appeal-withdraw"><input type="hidden" name="id" value="${e(b.dataset.id)}"><label>Lý do rút yêu cầu<textarea name="reason" required maxlength="2000" rows="3"></textarea></label>${formActions('Xác nhận rút yêu cầu')}</form>`,
      );
      return;
    }
    if (a === 'evidence-detail') {
      await openEvidenceDetail(b.dataset.id);
      return;
    }
    if (a === 'evidence-retry') {
      b.disabled = true;
      try {
        const result = await api(
          '/api/evidence/' + encodeURIComponent(b.dataset.id) + '/retry',
          {},
        );
        toast(
          result.warning ||
            (result.sharingComplete
              ? 'Đã đồng bộ quyền chia sẻ cho người phụ trách.'
              : 'Chia sẻ chưa hoàn tất. Hãy xem trạng thái minh chứng.'),
          result.sharingComplete !== true,
        );
        await openEvidenceDetail(b.dataset.id);
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (a === 'evidence-request-share') {
      modal(
        'Nhắc chủ tệp kiểm tra chia sẻ',
        `<form data-form="evidence-request-share"><input type="hidden" name="id" value="${e(b.dataset.id)}"><p class="inline-note">Gửi thông báo trong ứng dụng đến chủ tệp, không gửi email và không tự cấp quyền Drive.</p><label class="section-gap">Nội dung cần kiểm tra<textarea name="reason" required maxlength="2000" rows="3"></textarea></label>${formActions('Gửi nhắc kiểm tra')}</form>`,
      );
      return;
    }
    if (a === 'notification-open') {
      await openNotification(b.dataset.id);
      return;
    }
    if (a === 'notification-read') {
      await api('/api/notifications/' + encodeURIComponent(b.dataset.id) + '/read', {}, 'PATCH');
      await refreshNotifications(state.view === 'notifications');
      return;
    }
    if (a === 'notifications-read-all') {
      await api('/api/notifications/read-all', {});
      await refreshNotifications(state.view === 'notifications');
      return;
    }
    if (semesterWriteActions.has(a)) assertSemesterWrite();
    if (a === 'roster-import') {
      openRosterImport();
      return;
    }
    if (a === 'roster-copy') {
      openRosterCopy();
      return;
    }
    if (a === 'assignment-new') {
      await openAssignment();
      return;
    }
    if (a === 'assignment-revoke') {
      openAssignmentRevoke(b.dataset.id);
      return;
    }
    if (a === 'roster-history') {
      await openRosterHistory(b.dataset.id);
      return;
    }
    if (a === 'semester-new') {
      openSemester();
      return;
    }
    if (a === 'semester-edit') {
      openSemester(b.dataset.id);
      return;
    }
    if (a === 'semester-transition') {
      openSemesterTransition(b.dataset.id, b.dataset.transition);
      return;
    }
    if (a === 'semester-history') {
      await openSemesterHistory(b.dataset.id);
      return;
    }
    if (a === 'semester-snapshot') {
      await downloadSemesterSnapshot(b.dataset.semester, b.dataset.id);
      return;
    }
    b.disabled = true;
    if (a === 'demo-login') {
      await api('/api/auth/demo', { userId: b.dataset.id });
      await boot();
    } else if (a === 'logout') {
      await api('/api/auth/logout', {});
      state.filters = {};
      state.preview = null;
      state.rosterPreview = null;
      state.rosterPayload = null;
      state.assignmentContext = null;
      state.enrolledSemester = null;
      state.google = null;
      await boot();
    } else if (a === 'claim-new') await openClaim(b.dataset.activity || '');
    else if (a === 'activity-new') await openActivity();
    else if (a === 'claim-detail') await claimDetail(b.dataset.id);
    else if (a === 'student-detail') await studentDetail(b.dataset.id);
    else if (a === 'assessment-edit') await openAssessment(b.dataset.id);
    else if (a === 'course-open') openCourse(b.dataset.id);
    else if (a === 'legacy-edit') openLegacy(b.dataset.id, b.dataset.type);
    else if (a === 'claim-review') await reviewClaim(b.dataset.id, false);
    else if (a === 'claim-reject') await reviewClaim(b.dataset.id, true);
    else if (a === 'import-clear') {
      state.preview = null;
      state.importPayload = null;
      renderImport();
    } else if (a === 'evidence-upload') await evidenceUpload(b);
    else if (a === 'google-export') {
      const f = state.filters.reports || {};
      const d = await api('/api/google/reports', {
        basis: f.basis || 'official',
        classId: f.classId || '',
        semester: state.semester,
        academicYear: state.data?.academicYear || currentAcademicYear(),
      });
      modal(
        'Đã tạo báo cáo Google Sheets',
        `<p>${e(d.name)}</p><p class="inline-note">Báo cáo được lưu trong Google Drive của bạn.</p><div class="form-actions">${btn('Đóng', 'close-modal')}${safeUrl(d.url) ? `<a class="btn primary" href="${e(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">Mở Google Sheets ↗</a>` : ''}</div>`,
      );
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    b.disabled = false;
    updateSemesterWriteControls();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'semester-select') {
    state.semester = event.target.value;
    try {
      localStorage.setItem('conduct.semester', state.semester);
    } catch {}
    state.preview = null;
    state.importPayload = null;
    state.rosterPreview = null;
    state.rosterPayload = null;
    state.assignmentContext = null;
    state.enrolledSemester = null;
    navigate(state.view);
    return;
  }
  if (event.target.id === 'claim-activity') fillActivity(event.target.value);
  if (event.target.matches('[data-correction-criterion]'))
    refreshCorrectionFields(event.target.form);
  if (event.target.name === 'term' && event.target.form?.dataset.form === 'semester-save') {
    const extra = Number(event.target.value) > 2;
    for (const name of ['annualIncluded', 'courseIncluded']) {
      const field = event.target.form.elements[name];
      if (extra) field.checked = false;
      field.disabled = extra;
    }
  }
  if (event.target.name === 'program' && event.target.form?.dataset.form === 'course-summary')
    event.target.form.elements.tdtuSemesters.required = event.target.value === 'international';
  if (
    event.target.matches('[data-criterion-select]') ||
    event.target.name === 'quantity' ||
    event.target.name === 'explicitCategoryId'
  )
    refreshCriterion(event.target.form);
  if (event.target.name === 'totalMax') {
    const f = event.target.closest('[data-form="settings"]');
    if (f) f.elements.riskThreshold.max = event.target.value;
  }
});
document.addEventListener('input', (event) => {
  if (event.target.name === 'evidenceUrl' && event.target.form?.elements.evidenceId)
    event.target.form.elements.evidenceId.value = '';
  if (event.target.name === 'quantity' && event.target.form?.elements.criterionId)
    refreshCriterion(event.target.form);
});
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const action = form.dataset.form;
  const values = Object.fromEntries(new FormData(form));
  const submit = $('[type="submit"]', form);
  if (submit) submit.disabled = true;
  $('.form-error', form)?.style.setProperty('display', 'none');
  try {
    if (semesterWriteForms.has(action)) assertSemesterWrite();
    if (action === 'filters') {
      state.filters[form.dataset.view] = values;
      if (form.dataset.view === 'claims') renderClaims(state.data);
      else if (form.dataset.view === 'roster') renderRoster(state.data);
      else if (form.dataset.view === 'appeals') renderAppeals(state.data);
      else if (form.dataset.view === 'evidence') renderEvidence(state.data);
      else await navigate(form.dataset.view);
    } else if (action === 'appeal-create') {
      const [targetType, targetId] = values.target.split('|');
      const result = await api('/api/appeals', {
        semester: state.semester,
        targetType,
        targetId,
        reason: values.reason,
        ...(values.evidenceUrl?.trim() ? { evidenceUrl: values.evidenceUrl.trim() } : {}),
      });
      toast('Đã gửi yêu cầu phúc tra; điểm hiện tại được giữ nguyên.');
      await navigate('appeals');
      await openAppealDetail(result.appeal.id);
    } else if (action === 'appeal-respond' || action === 'appeal-withdraw') {
      await api('/api/appeals/' + encodeURIComponent(values.id) + '/respond', {
        action: action === 'appeal-withdraw' ? 'withdraw' : 'supplement',
        reason: values.reason,
        ...(values.evidenceUrl?.trim() ? { evidenceUrl: values.evidenceUrl.trim() } : {}),
        ...(values.evidenceId ? { evidenceId: values.evidenceId } : {}),
      });
      toast(
        action === 'appeal-withdraw'
          ? 'Đã rút yêu cầu và giữ lịch sử.'
          : 'Đã gửi nội dung bổ sung.',
      );
      await navigate('appeals');
      await openAppealDetail(values.id);
    } else if (action === 'appeal-resolve') {
      if (!lecturer()) throw Error('Chức năng này dành cho người phụ trách.');
      const payload = { action: values.action, reason: values.reason };
      if (values.action === 'approve') {
        if (values.targetType === 'record') {
          const definition = criteriaCatalog().find((item) => item.id === values.criterionId);
          payload.correction = {
            sourceId: values.sourceId,
            criterionId: values.criterionId,
            quantity: Number(values.quantity),
            date: values.date,
            title: values.title,
            approvalReference: values.approvalReference,
          };
          if (definition?.explicitCategoryRequired)
            payload.correction.categoryId = values.categoryId;
          if (definition?.unit === 'approved') payload.correction.points = Number(values.points);
        } else if (values.targetType === 'assessment') {
          const optional = (name) => (values[name] === '' ? null : Number(values[name]));
          payload.correction = {
            gpa: optional('gpa'),
            offlineActivityCount: optional('offlineActivityCount'),
            complianceConfirmed: form.elements.complianceConfirmed.checked,
            discipline: values.discipline,
            mode: values.mode,
            faculty: values.faculty,
            placementGrade: optional('placementGrade'),
            monthsAbroad: optional('monthsAbroad'),
            finalSemester: form.elements.finalSemester.checked,
            specialApproved: form.elements.specialApproved.checked,
            approvalReference: values.approvalReference,
          };
        } else payload.correction = { approvalReference: values.approvalReference };
      }
      await api('/api/appeals/' + encodeURIComponent(values.id) + '/resolve', payload);
      toast(
        values.action === 'approve' && values.targetType === 'claim'
          ? 'Đã kiểm tra lại kê khai; chưa cấp điểm chính thức.'
          : values.action === 'approve'
            ? 'Đã lưu điều chỉnh có căn cứ và lịch sử trước sau.'
            : 'Đã ghi nhận phản hồi yêu cầu.',
      );
      await navigate('appeals');
      await openAppealDetail(values.id);
    } else if (action === 'evidence-request-share') {
      await api('/api/evidence/' + encodeURIComponent(values.id) + '/request-share', {
        reason: values.reason,
      });
      toast('Đã gửi thông báo trong ứng dụng đến chủ tệp.');
      await openEvidenceDetail(values.id);
    } else if (action === 'roster-preview') {
      requireCoordinator();
      const file = form.elements.file.files[0];
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw Error('Tệp danh sách tối đa 8 MB.');
        state.rosterPayload = { fileName: file.name, fileBase64: await fileBase64(file) };
      } else if (values.csv?.trim()) state.rosterPayload = { csv: values.csv };
      else throw Error('Hãy chọn tệp Excel/CSV hoặc dán nội dung CSV.');
      state.rosterPreview = await api('/api/roster/preview', state.rosterPayload);
      modal('Kiểm tra danh sách trước khi ghi', rosterPreviewHtml());
    } else if (action === 'roster-commit') {
      requireCoordinator();
      if (!state.rosterPreview || !state.rosterPayload)
        throw Error('Hãy kiểm tra danh sách trước khi ghi.');
      const result = await api('/api/roster/commit', {
        ...state.rosterPayload,
        batchName: values.batchName,
        reason: values.reason,
      });
      state.rosterPreview = null;
      state.rosterPayload = null;
      $('#modal').close();
      toast(
        `Đã ghi danh sách: ${num(result.inserted)} hồ sơ mới, ${num(result.updated)} cập nhật, ${num(result.skipped)} dòng trùng được bỏ qua.`,
      );
      await navigate('roster');
    } else if (action === 'roster-copy') {
      requireCoordinator();
      if (values.fromSemester === values.toSemester)
        throw Error('Học kỳ nguồn và học kỳ nhận phải khác nhau.');
      const result = await api('/api/roster/copy', values);
      $('#modal').close();
      state.semester = values.toSemester;
      try {
        localStorage.setItem('conduct.semester', state.semester);
      } catch {}
      toast(
        `Đã sao chép danh sách: ${num(result.inserted)} mới, ${num(result.updated)} cập nhật, ${num(result.skipped)} bỏ qua.`,
      );
      await navigate('roster');
    } else if (action === 'assignment-create') {
      requireCoordinator();
      await api('/api/assignments', { ...values, semester: state.semester });
      $('#modal').close();
      toast('Đã lưu phân công giảng viên cho học kỳ.');
      await navigate('roster');
    } else if (action === 'assignment-revoke') {
      requireCoordinator();
      await api('/api/assignments/' + encodeURIComponent(values.id) + '/revoke', {
        reason: values.reason,
      });
      $('#modal').close();
      toast('Đã thu hồi phân công; lịch sử và các bản chốt được giữ nguyên.');
      await navigate('roster');
    } else if (action === 'semester-save') {
      const payload = {
        id: values.id,
        name: values.name,
        academicYear: values.academicYear,
        term: Number(values.term),
        startsAt: values.startsAt ? new Date(values.startsAt + ':00+07:00').toISOString() : null,
        deadline: values.deadline ? new Date(values.deadline + ':00+07:00').toISOString() : null,
        annualIncluded: form.elements.annualIncluded.checked,
        courseIncluded: form.elements.courseIncluded.checked,
      };
      if (payload.startsAt && payload.deadline && payload.startsAt >= payload.deadline)
        throw Error('Hạn kê khai phải sau thời điểm bắt đầu.');
      await api(
        '/api/semesters' + (values.editingId ? '/' + encodeURIComponent(values.editingId) : ''),
        payload,
        values.editingId ? 'PATCH' : 'POST',
      );
      $('#modal').close();
      toast(values.editingId ? 'Đã lưu cấu hình học kỳ.' : 'Đã thêm học kỳ vào danh mục chung.');
      await navigate('semesters');
    } else if (action === 'semester-transition') {
      await api('/api/semesters/' + encodeURIComponent(values.semesterId) + '/transition', {
        action: values.action,
        reason: values.reason,
        acknowledgeIncomplete: Boolean(form.elements.acknowledgeIncomplete?.checked),
      });
      $('#modal').close();
      toast(
        values.action === 'close'
          ? 'Đã tạo bản chốt mới và khóa học kỳ.'
          : values.action === 'reopen'
            ? 'Đã mở lại kỳ; bản chốt cũ được giữ trong lịch sử.'
            : 'Đã chuyển sang giai đoạn tổng hợp.',
      );
      state.preview = null;
      state.importPayload = null;
      await navigate('semesters');
    } else if (action === 'claim-create') {
      const p = {
        semester: state.semester,
        title: values.title,
        organizer: values.organizer,
        date: values.date,
        categoryId: values.categoryId,
        criterionId: values.criterionId,
        quantity: Number(values.quantity),
        approvalReference: values.approvalReference || '',
        points: Number(values.claimedPoints),
        claimedPoints: Number(values.claimedPoints),
        evidenceUrl: values.evidenceUrl,
        ...(values.evidenceId ? { evidenceId: values.evidenceId } : {}),
        note: values.note,
      };
      if (values.activityId) p.activityId = values.activityId;
      if (lecturer()) p.studentId = values.studentId;
      await api('/api/claims', p);
      $('#modal').close();
      toast('Đã gửi kê khai. Điểm đang chờ được cập nhật.');
      await navigate(state.view);
    } else if (action === 'activity-create') {
      await api('/api/activities', {
        ...values,
        semester: state.semester,
        quantity: Number(values.quantity),
        points: Number(values.points),
      });
      $('#modal').close();
      toast('Đã tạo hoạt động mới.');
      await navigate('activities');
    } else if (action === 'claim-review') {
      await api(
        '/api/claims/' + encodeURIComponent(values.id),
        { status: values.status, note: values.note },
        'PATCH',
      );
      $('#modal').close();
      toast(
        values.status === 'rejected'
          ? 'Đã từ chối kê khai.'
          : 'Đã đánh dấu kiểm tra minh chứng. Điểm vẫn chờ chính thức.',
      );
      await navigate(state.view);
    } else if (action === 'import-preview') {
      const f = form.elements.file.files[0];
      if (!f) throw Error('Hãy chọn tệp Excel hoặc CSV.');
      if (f.size > 8 * 1024 * 1024) throw Error('Tệp nhập tối đa 8 MB.');
      state.importPayload = { fileName: f.name, fileBase64: await fileBase64(f) };
      state.importKind = 'file';
      state.preview = await api('/api/import/preview', state.importPayload);
      renderImport();
      toast('Đã kiểm tra tệp. Xem kết quả trước khi ghi nhận.');
    } else if (action === 'sheets-preview') {
      const p = await api('/api/google/sheets/preview', {
        url: values.url,
        sheetName: values.sheetName || undefined,
      });
      state.preview = p;
      state.importPayload = { rows: p.importRows || p.rows.map((r) => r.row) };
      state.importKind = 'sheets';
      renderImport();
      toast('Đã đọc và kiểm tra Google Sheets.');
    } else if (action === 'import-commit') {
      if (!state.preview || !state.importPayload) throw Error('Hãy kiểm tra dữ liệu trước.');
      const d = await api(
        state.importKind === 'sheets' ? '/api/google/sheets/commit' : '/api/import/commit',
        { ...state.importPayload, batchName: values.batchName },
      );
      state.preview = null;
      state.importPayload = null;
      renderImport();
      modal(
        'Đã ghi nhận dữ liệu',
        `<div class="detail-scores"><div>Khoản mới<strong>${num(d.inserted)}</strong></div><div>Bỏ qua trùng<strong>${num(d.skipped)}</strong></div><div>Tự đối soát<strong>${num(d.matched)}</strong></div></div><p class="inline-note">Điểm chính thức và điểm dự kiến đã được tính lại. Những kê khai đã khớp được loại khỏi phần chờ.</p><div class="form-actions">${btn('Đóng', 'close-modal')}${btn('Xem tổng quan', 'after-import', 'primary')}</div>`,
      );
      toast('Nhập dữ liệu thành công, không cộng lặp.');
    } else if (action === 'match') {
      await api('/api/reconciliation', { claimId: values.claimId, recordId: values.recordId });
      toast('Đã liên kết kê khai với khoản chính thức.');
      await navigate('reconciliation');
    } else if (action === 'course-summary') {
      const params = new URLSearchParams({
        cohortYear: values.cohortYear,
        standardSemesters: values.standardSemesters,
        program: values.program,
        earlyGraduation: String(form.elements.earlyGraduation.checked),
      });
      if (values.tdtuSemesters) params.set('tdtuSemesters', values.tdtuSemesters);
      const data = await api('/api/course/' + encodeURIComponent(values.studentId) + '?' + params);
      $('#course-result').innerHTML = renderCourseResult(data);
    } else if (action === 'assessment-save') {
      const optionalNumber = (k) => (values[k] === '' ? null : Number(values[k]));
      const profile = {
        semester: state.semester,
        gpa: optionalNumber('gpa'),
        offlineActivityCount: optionalNumber('offlineActivityCount'),
        complianceConfirmed: form.elements.complianceConfirmed.checked,
        discipline: values.discipline,
        mode: values.mode,
        placementGrade: optionalNumber('placementGrade'),
        approvalReference: values.approvalReference || '',
        monthsAbroad: optionalNumber('monthsAbroad'),
        finalSemester: form.elements.finalSemester.checked,
        faculty: values.faculty || 'CNTT',
        specialApproved: form.elements.specialApproved.checked,
      };
      await api('/api/assessments/' + encodeURIComponent(values.studentId), profile, 'PUT');
      $('#modal').close();
      toast('Đã lưu đánh giá học kỳ theo quy chế.');
      await navigate(state.view);
    } else if (action === 'legacy-reclassify') {
      await api('/api/legacy/reclassify', {
        type: values.type,
        id: values.id,
        criterionId: values.criterionId,
        categoryId: values.categoryId,
        quantity: Number(values.quantity),
        points: Number(values.points),
        approvalReference: values.approvalReference || '',
      });
      $('#modal').close();
      toast('Đã đối chiếu dữ liệu cũ với tiêu chí.');
      await navigate('legacy');
    } else if (action === 'settings') {
      const d = await api('/api/settings', { riskThreshold: Number(values.riskThreshold) }, 'PUT');
      state.session.settings = d.settings;
      toast('Đã lưu ngưỡng hỗ trợ. Quy tắc điểm giữ theo PDF.');
      await navigate('settings');
    }
  } catch (err) {
    formError(form, err.message);
    toast(err.message, true);
  } finally {
    if (submit) submit.disabled = false;
    updateSemesterWriteControls();
  }
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="after-import"]')) {
    $('#modal').close();
    go('dashboard');
  }
});
window.addEventListener('hashchange', () => {
  if (state.session?.user) navigate(location.hash.slice(1) || 'dashboard');
});
setInterval(() => {
  if (!state.session?.user) return;
  const notice = $('.semester-notice');
  if (notice) notice.outerHTML = semesterNotice();
  updateSemesterWriteControls();
}, 10000);
setInterval(() => {
  if (state.session?.user && document.visibilityState !== 'hidden')
    refreshNotifications(true).catch(() => {});
}, 30000);
async function boot() {
  try {
    state.session = await api('/api/session');
    if (!state.session.user) {
      renderLogin();
      return;
    }
    await refreshSemesters();
    const periods = state.session.settings?.semesters || [];
    let saved;
    try {
      saved = localStorage.getItem('conduct.semester');
    } catch {}
    state.semester = periods.includes(saved) ? saved : periods[0];
    renderShell();
    await navigate(location.hash.slice(1) || 'dashboard');
    const p = new URLSearchParams(location.search);
    if (p.has('authError')) {
      toast(p.get('authError'), true);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (p.has('googleConnected')) {
      toast('Đã kết nối Google Workspace.');
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch (err) {
    $('#app').innerHTML =
      `<div class="boot"><div class="error-panel"><p>${e(err.message)}</p><button class="btn" data-action="boot-retry">Tải lại ứng dụng</button></div></div>`;
  }
}
boot();
