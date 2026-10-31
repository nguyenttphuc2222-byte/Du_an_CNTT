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
  ['activities', 'Hoạt động', 'calendar'],
  ['claims', 'Tự kê khai', 'file'],
  ['regulations', 'Quy chế Điểm rèn luyện', 'book'],
  ['import', 'Nhập dữ liệu', 'upload', true],
  ['reconciliation', 'Đối soát', 'link', true],
  ['reports', 'Báo cáo', 'chart', true],
  ['settings', 'Quy tắc điểm', 'settings', true],
  ['legacy', 'Dữ liệu cần đối chiếu', 'alert', true],
  ['audit', 'Nhật ký', 'clock', true],
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
};
const lecturer = () => state.session?.user?.role === 'LECTURER';
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
const semesterLabel = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{4})-HK(\d)$/);
  return m ? 'Học kỳ ' + m[3] + ' · ' + m[1] + ' — ' + m[2] : v;
};
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
  `<button type="button" class="btn ${c}" data-action="${a}" ${attrs}>${i ? icon(i) : ''}${e(l)}</button>`;
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
    /^\/api\/(dashboard|students|activities|claims|official-records|reconciliation|reports|legacy|assessments\/[^/?]+)(?:\?|$)/.test(
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
  if (!form) return;
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

function evidenceFields() {
  return `<label class="full">Liên kết minh chứng (không bắt buộc)<input name="evidenceUrl" type="url" placeholder="https://drive.google.com/…"><small>Minh chứng cần được chia sẻ cho giảng viên.</small></label>${state.session.user.provider === 'google' ? `<div class="full">${state.google?.connected ? `<label>Tải minh chứng lên Google Drive<input type="file" name="evidenceFile" accept="application/pdf,image/png,image/jpeg,image/webp"></label><p class="inline-note">PDF, PNG, JPEG, WEBP · Tối đa 5 MB.</p>${btn('Lưu vào Drive và chia sẻ cho giảng viên', 'evidence-upload', 'small', '', 'upload')}<p class="inline-note" id="evidence-result"></p>` : `<a href="/auth/google/connect?returnTo=claims" class="btn small">Kết nối Google để tải minh chứng</a><p class="inline-note">Kết nối trước khi điền để tránh mất biểu mẫu chưa gửi.</p>`}</div>` : ''}`;
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
      .filter((r) => !r[3] || lecturer())
      .map(
        (r) =>
          `<button class="nav-item" data-action="navigate" data-view="${r[0]}">${icon(r[2])}<span>${r[1]}</span></button>`,
      )
      .join(
        '',
      )}</nav><div class="sidebar-bottom"><div class="user-area"><span class="avatar">${e(initials(u.name))}</span><div class="user-info"><strong>${e(u.name)}</strong><small>${lecturer() ? 'Giảng viên / Cán bộ khoa' : 'Sinh viên'} · ${u.provider === 'google' ? 'Google' : 'Demo'}</small></div><button class="logout" data-action="logout" aria-label="Đăng xuất">${icon('logout')}</button></div></div></aside><div class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="toggle-menu" aria-label="Mở điều hướng">${icon('menu')}</button><span>Không gian làm việc</span><span>/</span><strong id="current-title">Tổng quan</strong></div><div class="topbar-right"><label class="period">${icon('calendar')}<select id="semester-select" aria-label="Chọn học kỳ">${(state.session.settings?.semesters || [state.semester]).map((s) => `<option value="${e(s)}" ${s === state.semester ? 'selected' : ''}>${e(semesterLabel(s))}</option>`).join('')}</select></label><span class="topbar-divider"></span>${badge(lecturer() ? 'Giảng viên' : 'Sinh viên', 'outline')}<span class="avatar" title="${e(u.email)}">${e(initials(u.name))}</span></div></header><main class="content" id="content"></main></div></div>`;
}
function finish(html) {
  $('#content').innerHTML =
    html +
    `<footer class="footer"><span>Conduct · Ứng dụng quản lý điểm rèn luyện</span><span>${e(semesterLabel(state.semester))} · Bản demo</span></footer>`;
}
function go(v) {
  if (location.hash === '#' + v) navigate(v);
  else location.hash = v;
}
async function navigate(v) {
  if (!state.session?.user) return;
  const r = routes.find((r) => r[0] === v);
  if (!r || (r[3] && !lecturer())) v = 'dashboard';
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
    const qs = new URLSearchParams(state.filters[v] || {});
    if (v === 'reports' && !qs.has('academicYear'))
      qs.set('academicYear', state.semester?.slice(0, 9) || '2026-2027');
    let d = ['import', 'regulations'].includes(v)
      ? {}
      : await api('/api/' + v + (qs.size ? '?' + qs : ''));
    if (v === 'dashboard' && !lecturer()) d.history = await api('/api/official-records');
    if (['import', 'claims', 'reports'].includes(v) && state.session.user.provider === 'google') {
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
      activities: renderActivities,
      claims: renderClaims,
      import: renderImport,
      reconciliation: renderReconciliation,
      reports: renderReports,
      settings: renderSettings,
      regulations: renderRegulations,
      legacy: renderLegacy,
      audit: renderAudit,
    })[v](d);
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
          'Tài khoản chưa được liên kết hồ sơ',
          'Liên hệ người quản trị để liên kết mã số sinh viên.',
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
      `<section class="student-hero"><div><div class="eyebrow">${e(semesterLabel(state.semester))}</div><h2>Chào ${e(state.session.user.name || s.name)}!</h2><p>${e(s.code)} · ${e(s.className)}</p><div style="margin-top:14px">${classification(s.officialClassification, s.evaluationStatus)}</div></div><div class="hero-scores"><div><label>Điểm chính thức</label><strong>${s.hasOfficialData ? scoreText(s.officialTotal) : '—'}</strong><small> / ${num(d.settings?.totalMax || 100)}</small></div><div><label>Đang chờ ghi nhận</label><strong>${signedNum(s.pendingTotal)}</strong></div><div><label>Điểm dự kiến</label><strong>${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</strong></div></div></section>${evaluationNotice(s)}<section class="category-cards">${(s.categoryScores || []).map((c) => `<div class="card category-card"><h3>${e(c.name)}</h3><div class="category-score">${num(c.official)}<small> / ${num(c.maxPoints)}</small></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, (c.official / c.maxPoints) * 100))}%"></div></div><p>Đang chờ: <strong>${signedNum(c.pending)}</strong> · Dự kiến: <strong>${num(c.projected)}</strong></p></div>`).join('')}</section><section class="card"><div class="card-head"><div><h2>Kê khai của bạn</h2><p>Đã kiểm tra minh chứng vẫn đang chờ điểm chính thức</p></div>${btn('Xem tất cả', 'navigate', 'text', 'data-view="claims"', 'arrow')}</div>${claimTable((d.recentClaims || []).slice(0, 5))}</section><section class="card section-gap"><div class="card-head"><div><h2>Lịch sử điểm chính thức</h2><p>Mỗi khoản điểm đều có tham chiếu nguồn dữ liệu</p></div></div>${officialTable(d.history?.records || [])}</section>${demoGuide()}`,
  );
}
function officialTable(rs) {
  if (!rs.length)
    return empty('Chưa có điểm chính thức', 'Điểm sẽ xuất hiện sau khi khoa nhập dữ liệu.');
  return `<div class="table-wrap"><table><thead><tr><th>HOẠT ĐỘNG</th><th>NỘI DUNG ĐÁNH GIÁ</th><th>NGÀY</th><th>ĐIỂM</th><th>THAM CHIẾU NGUỒN</th><th>ĐỐI SOÁT</th></tr></thead><tbody>${rs.map((r) => `<tr><td class="name">${e(r.title)}</td><td>${e(r.categoryName)}<span class="sub">${e(criterionName(r))}</span>${legacyTag(r)}</td><td>${date(r.date)}</td><td><span class="points ${r.points < 0 ? 'negative' : ''}">${r.points > 0 ? '+' : ''}${num(r.points)}</span></td><td>${e(r.sourceId)}</td><td>${r.matchedClaimId ? badge('Đã liên kết', 'green') : badge('Chưa liên kết')}</td></tr>`).join('')}</tbody></table></div>`;
}
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
  return `<div class="table-wrap"><table><thead><tr><th>SINH VIÊN</th><th>LỚP</th><th>CHÍNH THỨC</th><th>CHỜ GHI NHẬN</th><th>DỰ KIẾN</th><th>XẾP LOẠI CHÍNH THỨC</th><th></th></tr></thead><tbody>${ss.map((s) => `<tr><td><div class="student-cell"><span class="avatar">${e(initials(s.name))}</span><div><span class="name">${e(s.name)}</span><span class="sub">${e(s.code)}</span></div></div></td><td>${e(s.className)}</td><td>${s.hasOfficialData ? `<span class="score">${scoreText(s.officialTotal)}</span>` : '<span class="no-data">Chưa có dữ liệu</span>'}</td><td><span class="score light">${signedNum(s.pendingTotal)}</span><span class="sub">${num(s.pendingCount)} kê khai</span></td><td><span class="score teal">${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</span></td><td>${classification(s.officialClassification, s.evaluationStatus)}<span class="sub">${e(evaluationLabels[s.evaluationStatus] || '')}</span>${s.legacyCount ? badge(num(s.legacyCount) + ' khoản cũ', 'amber') : ''}</td><td>${btn('Chi tiết', 'student-detail', 'small', `data-id="${e(s.id)}"`) + (lecturer() ? btn('Đánh giá', 'assessment-edit', 'small', `data-id="${e(s.id)}"`) : '')}</td></tr>`).join('')}</tbody></table></div>`;
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
      `<div class="steps"><div class="step ${!state.preview ? 'active' : ''}"><b>1</b>Chọn nguồn dữ liệu</div><div class="step ${state.preview ? 'active' : ''}"><b>2</b>Xem trước & kiểm tra</div><div class="step"><b>3</b>Ghi nhận & đối soát</div></div>${googlePanel('import')}<section class="card"><div class="card-body" style="padding-top:22px"><form data-form="import-preview"><div class="upload-panel"><div class="upload-icon">${icon('upload')}</div><h3>Nhập tệp điểm chính thức</h3><p>Excel .xlsx hoặc CSV · Các dòng được kiểm tra trước khi lưu</p><input type="file" name="file" id="import-file" accept=".xlsx,.csv" required aria-label="Chọn tệp Excel hoặc CSV"><button type="submit" class="btn primary">${icon('eye')}Kiểm tra dữ liệu</button><div class="form-error" role="alert"></div></div></form>${state.session.user.provider === 'google' ? `<form data-form="sheets-preview" class="section-gap"><label>Hoặc nhập từ Google Sheets<input name="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required></label><div class="form-grid" style="margin-top:12px"><label>Tên trang tính (không bắt buộc)<input name="sheetName" placeholder="Sheet1"></label><div style="align-self:end"><button class="btn" type="submit">${icon('link')}Xem trước Google Sheets</button></div></div><p class="inline-note">Tài khoản Google cần có quyền đọc tệp. Khi Google báo thiếu quyền, hãy kết nối Workspace hoặc tải Excel để nhập.</p><div class="form-error"></div></form>` : ''}<div class="help-box"><strong>Demo nhanh:</strong> tải “Tệp kịch bản demo”, chọn tệp vừa tải và kiểm tra. Sau khi ghi nhận, khoản chính thức được cộng theo tiêu chí và kê khai đã khớp được loại khỏi phần chờ. Nhập lại tệp để kiểm tra chống trùng.<br><strong>Định dạng:</strong> mỗi dòng có <code>sourceId</code> duy nhất, <code>criterionId</code>, <code>quantity</code> và <code>approvalReference</code> nếu tiêu chí cần phê duyệt. Tệp chỉ chứa tổng điểm cần được chuyển đổi trước khi nhập.</div></div></section>${state.preview ? previewHtml(state.preview) : ''}`,
  );
}
function previewHtml(p) {
  const s = p.summary || {};
  return `<section class="card section-gap"><div class="card-head"><div><h2>Kết quả kiểm tra dữ liệu</h2><p>${e(p.source?.title || p.source?.name || state.importPayload?.fileName || 'Nguồn dữ liệu đã chọn')}</p></div>${btn('Bỏ kết quả', 'import-clear', 'small')}</div><div class="card-body"><div class="preview-summary"><span>${num(s.valid)} dòng hợp lệ</span><span>${num(s.duplicate)} dòng trùng được bỏ qua</span><span class="${s.errors ? 'error-count' : ''}">${num(s.errors)} dòng lỗi</span></div></div><div class="table-wrap"><table><thead><tr><th>DÒNG</th><th>SINH VIÊN</th><th>HOẠT ĐỘNG</th><th>TIÊU CHÍ / ĐIỂM</th><th>TRẠNG THÁI</th><th>CHI TIẾT</th></tr></thead><tbody>${(p.rows || []).map((r, i) => `<tr><td>${r.index ?? i + 1}</td><td><span class="name">${e(r.studentName || r.row?.studentCode)}</span><span class="sub">${e(r.row?.studentCode)}</span></td><td>${e(r.activityTitle || r.row?.title || r.row?.activityId || '—')}</td><td>${e(r.row?.criterionId || r.row?.categoryId)} / ${e(r.row?.points)}</td><td>${badge(r.status === 'valid' ? 'Hợp lệ' : r.status === 'duplicate' ? 'Đã tồn tại' : 'Lỗi', r.status === 'valid' ? 'green' : r.status === 'duplicate' ? 'amber' : 'red')}</td><td class="import-errors">${(r.errors || []).map(e).join('<br>')}</td></tr>`).join('')}</tbody></table></div><form class="card-body" data-form="import-commit" style="padding-top:20px"><label>Tên đợt nhập<input name="batchName" value="${e(p.source?.title || p.source?.name || state.importPayload?.fileName || 'Cập nhật điểm chính thức')}" maxlength="180" required></label>${s.errors ? '<p class="inline-note" style="color:var(--red)">Sửa các dòng lỗi trong tệp rồi kiểm tra lại trước khi ghi nhận.</p>' : ''}<div class="form-error"></div><div class="form-actions"><button class="btn primary" type="submit" ${s.errors || (!s.valid && !s.duplicate) ? 'disabled' : ''}>${icon('check')}${s.valid ? 'Ghi nhận ' + num(s.valid) + ' khoản điểm' : 'Xác nhận bỏ qua dữ liệu trùng'}</button></div></form></section>`;
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
    academicYear: d.academicYear || state.semester.slice(0, 9),
  });
  const s = d.stats;
  finish(
    heading(
      'Báo cáo & thống kê',
      'Theo dõi kết quả theo lớp và xuất dữ liệu phục vụ tổng hợp.',
      `<a class="btn" href="/api/export/report.csv?${e(query)}">CSV</a><a class="btn primary" href="/api/export/report.xlsx?${e(query)}">${icon('download')}Xuất Excel</a>`,
    ) +
      googlePanel('reports') +
      `<section class="card"><div class="card-head"><div><h2>Thống kê ${e(semesterLabel(state.semester))}</h2><p>Phần năm học bên dưới dùng điểm chính thức.</p></div></div><form class="toolbar" data-form="filters" data-view="reports"><div class="filter-group"><span class="filters-label">Phạm vi báo cáo</span><select name="classId" aria-label="Lớp báo cáo">${classOptions(d.classes || [], f.classId)}</select><select name="basis" aria-label="Cơ sở báo cáo"><option value="official" ${basis === 'official' ? 'selected' : ''}>Điểm chính thức</option><option value="projected" ${basis === 'projected' ? 'selected' : ''}>Điểm dự kiến</option></select><button class="btn" type="submit">Cập nhật báo cáo</button>${state.session.user.provider === 'google' ? btn('Lưu vào Google Sheets', 'google-export', '', '', 'upload') : ''}</div></form><div class="card-body" style="padding-top:20px"><div class="preview-summary"><span>${num(s.total)} sinh viên</span><span>${num(s.hasData)} đã có dữ liệu</span><span>${num(s.noData)} chưa có dữ liệu</span>${badge(basis === 'official' ? 'Theo điểm chính thức' : 'Theo điểm dự kiến', basis === 'official' ? 'green' : 'amber')}</div></div></section><div class="grid-equal section-gap"><section class="card"><div class="card-head"><div><h2>Phân bố xếp loại</h2><p>Tỷ lệ tính trên ${num(s.total)} sinh viên trong phạm vi</p></div></div><div class="card-body">${distribution(s.byClassification || [], s.total)}</div></section><section class="card"><div class="card-head"><div><h2>Tổng hợp theo lớp</h2><p>Chưa có dữ liệu tách riêng khỏi 0 điểm</p></div></div><div class="table-wrap"><table><thead><tr><th>LỚP</th><th>SĨ SỐ</th><th>CHƯA CÓ</th><th>ĐIỂM TB</th><th>CẦN HỖ TRỢ</th></tr></thead><tbody>${(s.byClass || []).map((c) => `<tr><td class="name">${e(c.name)}</td><td>${num(c.total)}</td><td>${num(c.noData)}</td><td class="score teal">${c.average === null ? '—' : num(c.average)}</td><td>${num(c.atRisk)}</td></tr>`).join('')}</tbody></table></div></section></div><section class="card"><div class="card-head"><div><h2>Chi tiết sinh viên</h2><p>${basis === 'projected' ? 'Điểm dự kiến đã áp dụng giới hạn, chưa phải kết quả được trường xác nhận.' : 'Điểm chính thức theo dữ liệu đã nhập.'}</p></div></div>${studentTable(d.students || [])}</section>${yearReportHtml(d)}`,
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
            return `<td>${student?.hasOfficialData ? scoreText(student.officialTotal) : '—'}<span class="sub">${e(evaluationLabels[student?.evaluationStatus] || 'Chưa có dữ liệu')}</span></td>`;
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
    `<form data-form="course-summary"><input type="hidden" name="studentId" value="${e(studentId)}"><div class="help-box">Nhập thông tin chương trình thực tế để xác định phạm vi. Dữ liệu demo hiện có hai học kỳ; không được xem là đã đủ toàn khóa. Quy tắc đối chiếu theo bản PDF được cung cấp, không tự kết luận áp dụng hồi tố.</div><div class="form-grid"><label>Năm tuyển sinh<input type="number" name="cohortYear" min="1900" max="2200" step="1" placeholder="Năm tuyển sinh thực tế" required></label><label>Số học kỳ theo chương trình chuẩn<input type="number" name="standardSemesters" min="1" max="40" step="1" placeholder="Theo khung chương trình" required></label><label class="full">Chương trình<select name="program"><option value="standard">Chương trình tiêu chuẩn / CLC / tiên tiến / bằng tiếng Anh</option><option value="international">Liên kết đào tạo quốc tế</option></select></label><label class="full">Số học kỳ tại TDTU (chương trình liên kết)<input type="number" name="tdtuSemesters" min="1" max="40" step="1" placeholder="Nhập khi chọn liên kết quốc tế"></label><label class="checkbox-field full"><input type="checkbox" name="earlyGraduation">Đối chiếu trường hợp tốt nghiệp trước tiến độ</label></div><div class="form-error"></div><div class="form-actions"><button class="btn primary" type="submit">${icon('chart')}Xem kết quả toàn khóa</button></div></form><div id="course-result" aria-live="polite"></div>`,
  );
}
function renderCourseResult(data) {
  const r = data.result;
  return `<section class="section-gap"><h3>${e(data.student.name)} · ${e(data.student.code)}</h3><div class="detail-scores section-gap"><div>Trung bình phần đã đủ dữ liệu<strong>${scoreText(r.observedAverage)}</strong></div><div>Trung bình toàn khóa<strong>${scoreText(r.officialAverage)}</strong></div><div>Số kỳ đủ dữ liệu<strong>${num(r.evaluatedSemesters)} / ${num(r.requiredSemesters)}</strong></div></div>${classification(r.classification, r.evaluationStatus)} ${badge(evaluationLabels[r.evaluationStatus] || 'Chưa đầy đủ', r.complete ? 'green' : 'amber')}<div class="help-box"><strong>Đối chiếu ngưỡng tốt nghiệp: 50 điểm</strong><p>${r.graduationEligible === true ? 'Đạt ngưỡng theo dữ liệu đã đối chiếu.' : r.graduationEligible === false ? 'Chưa đạt ngưỡng theo dữ liệu đã đối chiếu.' : 'Chưa đủ dữ liệu để kết luận điều kiện.'}</p><p>Trung bình dùng xét ngưỡng: ${scoreText(r.graduationAverage)}.</p>${r.additionalActivitiesRequired !== null && r.additionalActivitiesRequired !== undefined ? `<p>Khóa đến 2024: tham gia bổ sung tối thiểu ${num(r.additionalActivitiesRequired)} hoạt động theo quy chế.</p>` : ''}${r.additionalPointsRequired !== null && r.additionalPointsRequired !== undefined ? `<p>Khóa từ 2025: điểm bổ sung cần tích lũy ${num(r.additionalPointsRequired)}, theo (50 − trung bình thực tế) × số học kỳ chương trình chuẩn.</p>` : ''}</div>${r.missingSemesters?.length ? `<div class="settings-notice"><strong>Các học kỳ chưa đủ dữ liệu</strong>${r.missingSemesters.map((x) => e(semesterLabel(x))).join('<br>')}</div>` : ''}<div class="table-wrap"><table><thead><tr><th>HỌC KỲ HIỆN CÓ</th><th>ĐIỂM CHÍNH THỨC</th><th>TRẠNG THÁI</th></tr></thead><tbody>${data.semesters.map((s) => `<tr><td>${e(semesterLabel(s.semester))}</td><td>${s.hasOfficialData ? scoreText(s.officialTotal) : '—'}</td><td>${e(evaluationLabels[s.evaluationStatus] || 'Chưa đầy đủ')}</td></tr>`).join('')}</tbody></table></div><p class="inline-note">${(r.notes || []).map(e).join('<br>')}</p></section>`;
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
    `<div class="student-cell" style="margin-bottom:20px"><span class="avatar" style="width:45px;height:45px">${e(initials(s.name))}</span><div><h3>${e(s.name)}</h3><p class="muted">${e(s.code)} · ${e(s.className)}</p></div></div><div class="detail-scores"><div>Chính thức<strong>${s.hasOfficialData ? scoreText(s.officialTotal) : '—'}</strong></div><div>Chờ ghi nhận<strong>${signedNum(s.pendingTotal)}</strong></div><div>Dự kiến<strong>${s.projectedClassification ? scoreText(s.projectedTotal) : '—'}</strong></div></div>${classification(s.officialClassification, s.evaluationStatus)}${evaluationNotice(s)}<div class="section-gap"><h3>Điểm theo mục</h3><div class="field-list" style="margin-top:12px">${s.categoryScores.map((c) => `<div class="class-summary"><span>${e(c.name)}</span><strong>${num(c.official)} / ${num(c.maxPoints)} · chờ ${signedNum(c.pending)}</strong></div>`).join('')}</div></div><div class="section-gap"><h3>Điểm chính thức</h3>${officialTable(official.records.filter((r) => r.studentId === id))}</div><div class="section-gap"><h3>Kê khai</h3>${claimTable(
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
  const form = $('[data-form="claim-create"]');
  const f = form.elements.evidenceFile?.files?.[0];
  if (!f) throw Error('Hãy chọn tệp minh chứng trước.');
  if (f.size > 5 * 1024 * 1024) throw Error('Minh chứng tối đa 5 MB.');
  const data = await api('/api/google/evidence', {
    fileName: f.name,
    fileBase64: await fileBase64(f),
    mimeType: f.type,
  });
  form.elements.evidenceUrl.value = data.url;
  $('#evidence-result').innerHTML =
    `Đã lưu ${e(data.name)}. ${data.warning ? e(data.warning) : 'Đã chia sẻ cho giảng viên.'} ${safeUrl(data.url) ? `<a href="${e(safeUrl(data.url))}" target="_blank" rel="noopener noreferrer">Mở tệp ↗</a>` : ''}`;
  toast('Đã lưu minh chứng lên Drive. Bạn có thể gửi kê khai.');
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
    b.disabled = true;
    if (a === 'demo-login') {
      await api('/api/auth/demo', { userId: b.dataset.id });
      await boot();
    } else if (a === 'logout') {
      await api('/api/auth/logout', {});
      state.filters = {};
      state.preview = null;
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
        academicYear: state.data?.academicYear || state.semester.slice(0, 9),
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
    navigate(state.view);
    return;
  }
  if (event.target.id === 'claim-activity') fillActivity(event.target.value);
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
    if (action === 'filters') {
      state.filters[form.dataset.view] = values;
      if (form.dataset.view === 'claims') renderClaims(state.data);
      else await navigate(form.dataset.view);
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
async function boot() {
  try {
    state.session = await api('/api/session');
    if (!state.session.user) {
      renderLogin();
      return;
    }
    const periods = state.session.settings?.semesters || [
      state.session.settings?.semester || '2026-2027-HK1',
    ];
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
