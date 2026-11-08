import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.mjs';
const directory = path.resolve('artifacts');
await mkdir(directory, { recursive: true });
const app = await createApp({
  port: 0,
  dbPath: ':memory:',
  config: { demoEnabled: true, googleClientId: '', googleClientSecret: '' },
});
app.store.ensureGoogleUser({
  sub: 'browser-test-student',
  email: '523h0080@student.tdtu.edu.vn',
  name: 'Nguyễn Trần Trọng Phúc',
  role: 'STUDENT',
});
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${app.server.address().port}`;
let browser;
const errors = [];
const sharedViews = ['dashboard', 'activities', 'claims', 'regulations'];
const lecturerViews = [
  'students',
  'import',
  'reconciliation',
  'reports',
  'settings',
  'legacy',
  'audit',
];

async function assertRegulationReader(page, context) {
  await page.locator('.nav-item[data-view="regulations"]').click();
  await expect(page.locator('#content h1')).toHaveText('Quy chế Điểm rèn luyện');
  const images = page.locator('.regulation-page img');
  await expect(images).toHaveCount(10);
  await expect(page.locator('iframe.regulation-reader')).toHaveCount(0);
  const sources = Array.from(
    { length: 10 },
    (_, i) => `/regulations/page-${String(i + 1).padStart(2, '0')}.png`,
  );
  assert.deepEqual(
    await images.evaluateAll((items) => items.map((img) => img.getAttribute('src'))),
    sources,
  );
  const decoded = await images.evaluateAll((items) =>
    Promise.all(
      items.map(async (img) => {
        await img.decode();
        return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight };
      }),
    ),
  );
  assert.ok(
    decoded.every((img) => img.complete && img.width > 0 && img.height > 0),
    'All regulation pages must decode into visible image content',
  );
  await expect(images.first()).toBeInViewport();
  await expect(page.locator('.regulation-page figcaption')).toHaveText(
    Array.from({ length: 10 }, (_, i) => `Trang ${i + 1} / 10`),
  );
  const responses = await Promise.all(sources.map((source) => context.request.get(source)));
  for (const response of responses) {
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'], /image\/png/);
  }
  const pdf = await context.request.get('/docs/quy-che-ren-luyen-tdtu.pdf');
  assert.equal(pdf.status(), 200);
  assert.match(pdf.headers()['content-type'], /application\/pdf/);
  await expect(page.locator('.context-banner, .sidebar-note, .login-disclaimer')).toHaveCount(0);
}
async function assertRegulationZoom(page) {
  for (let step = 0; step < 4; step++)
    await page.getByRole('button', { name: 'Phóng to', exact: true }).click();
  await expect(page.locator('#regulation-zoom-level')).toHaveText('200%');
  await expect(page.getByRole('button', { name: 'Phóng to', exact: true })).toBeDisabled();
  assert.equal(
    await page.locator('.regulation-pages').evaluate((el) => el.scrollWidth > el.clientWidth),
    true,
    'Zoomed pages must scroll inside the reader',
  );
  await assertNoMobileOverflow(page);
  await page.screenshot({
    path: path.join(directory, '04-mobile-regulations-zoom.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Vừa khung', exact: true }).click();
  await expect(page.locator('#regulation-zoom-level')).toHaveText('100%');
  await expect(page.getByRole('button', { name: 'Thu nhỏ', exact: true })).toBeDisabled();
}

async function assertNoMobileOverflow(page) {
  await page.waitForFunction(
    () => innerWidth > 760 || document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
  );
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    false,
    'Mobile must not overflow horizontally',
  );
}
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /refused to (?:frame|display)|violates.*frame|frame-ancestors/i.test(message.text())
    )
      errors.push(message.text());
  });
  for (const audience of ['internal', 'external']) {
    await page.route('**/api/session', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.auth = { ...data.auth, googleConfigured: true, authAudience: audience };
      await route.fulfill({ response, json: data });
    });
    await page.goto('/');
    await expect(page.locator('a.google-btn')).toHaveText(
      audience === 'external'
        ? 'GTiếp tục với tài khoản Google'
        : 'GTiếp tục với tài khoản Google TDTU',
    );
    await expect(page.locator('.login-disclaimer')).toHaveCount(0);
    await page.unroute('**/api/session');
  }
  console.log('PASS: Google login labels follow Internal / External audience');
  await page.goto('/');
  await expect(page.locator('.demo-account')).toHaveCount(3);
  await page.screenshot({ path: path.join(directory, '01-login.png'), fullPage: true });
  await page.locator('[data-action="demo-login"][data-id="demo-lecturer"]').click();
  await expect(page.locator('#content h1')).toHaveText('Tổng quan rèn luyện');
  await page.screenshot({ path: path.join(directory, '02-dashboard.png'), fullPage: true });
  for (const view of [...sharedViews, ...lecturerViews]) {
    await page.locator(`.nav-item[data-view="${view}"]`).click();
    await expect(page.locator('#content h1')).toBeVisible();
    await expect(page.locator('#content .error-panel')).toHaveCount(0);
    await expect(page.locator('.context-banner, .sidebar-note, .login-disclaimer')).toHaveCount(0);
  }
  await assertRegulationReader(page, context);
  await page.screenshot({
    path: path.join(directory, '02-lecturer-regulations.png'),
    fullPage: true,
  });
  console.log('PASS: lecturer permitted views, all regulation pages decoded and removed banners');
  await page.locator('.nav-item[data-view="settings"]').click();
  await expect(page.locator('a[href="/docs/quy-che-ren-luyen-tdtu.pdf"]').first()).toBeVisible();
  assert.equal((await context.request.get('/docs/quy-che-ren-luyen-tdtu.pdf')).status(), 200);
  await page.locator('.nav-item[data-view="students"]').click();
  await page.locator('[data-action="assessment-edit"][data-id="s001"]').click();
  const assessment = page.locator('form[data-form="assessment-save"]');
  await expect(assessment.locator('[name="gpa"]')).toHaveValue('9');
  await expect(assessment.locator('[name="complianceConfirmed"]')).toBeChecked();
  await assessment.locator('button[type="submit"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  console.log('PASS: immutable PDF rule catalog and semester assessment form');
  await page.locator('.nav-item[data-view="activities"]').click();
  await page.locator('[data-action="activity-new"]').click();
  const form = page.locator('form[data-form="activity-create"]');
  await form.locator('[name="title"]').fill('Hoạt động kiểm thử giao diện');
  await form.locator('[name="organizer"]').fill('Khoa CNTT - Demo');
  await form.locator('[name="date"]').fill('2026-10-23');
  await form.locator('[name="criterionId"]').selectOption('academic_seminar');
  await expect(form.locator('[name="points"]')).toHaveValue('5');
  await expect(form.locator('[name="categoryId"]')).toHaveValue('academic');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hoạt động kiểm thử giao diện' })).toBeVisible();
  console.log('PASS: create activity through UI');
  await page.locator('.nav-item[data-view="import"]').click();
  const sample = await context.request.get('/api/demo/scenario.xlsx');
  assert.equal(sample.status(), 200);
  const payload = {
    name: 'du-lieu-demo.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await sample.body(),
  };
  await page.locator('#import-file').setInputFiles(payload);
  await page.locator('form[data-form="import-preview"] button[type="submit"]').click();
  await expect(page.locator('form[data-form="import-commit"]')).toBeVisible();
  await page.locator('form[data-form="import-commit"] button[type="submit"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Đã ghi nhận dữ liệu');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  const allStudents = await (await context.request.get('/api/students')).json();
  const main = allStudents.students.find((s) => s.code === '523h0080');
  assert.deepEqual([main.officialTotal, main.pendingTotal, main.projectedTotal], [50, 0, 50]);
  await page.locator('#import-file').setInputFiles(payload);
  await page.locator('form[data-form="import-preview"] button[type="submit"]').click();
  await expect(page.locator('form[data-form="import-commit"] button[type="submit"]')).toContainText(
    'bỏ qua',
  );
  await page.locator('form[data-form="import-commit"] button[type="submit"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Đã ghi nhận dữ liệu');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  const duplicateStudents = await (await context.request.get('/api/students')).json();
  assert.equal(duplicateStudents.students.find((s) => s.code === '523h0080').officialTotal, 50);
  console.log('PASS: XLSX preview, commit, reconcile 40+10→50 and duplicate prevention');
  await page.locator('.nav-item[data-view="reports"]').click();
  await expect(page.locator('#content h1')).toHaveText('Báo cáo & thống kê');
  await page.screenshot({ path: path.join(directory, '03-reports.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('a[href^="/api/export/report.xlsx"]').click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.xlsx'));
  await page.locator('#semester-select').selectOption('2026-2027-HK2');
  await expect(page.locator('#content h1')).toBeVisible();
  const hk2 = await (await context.request.get('/api/reports?semester=2026-2027-HK2')).json();
  assert.equal(hk2.stats.hasData, 0);
  await page.locator('#semester-select').selectOption('2026-2027-HK1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-menu').click();
  await expect(page.locator('.sidebar.open')).toBeVisible();
  await assertRegulationReader(page, context);
  await assertNoMobileOverflow(page);
  await assertRegulationZoom(page);
  await page.screenshot({
    path: path.join(directory, '04-mobile-regulations.png'),
    fullPage: true,
  });
  await page.locator('.mobile-menu').click();
  await page.locator('.nav-item[data-view="dashboard"]').click();
  await expect(page.locator('#content h1')).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
  );
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  await page.screenshot({ path: path.join(directory, '04-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflow, false, 'Mobile must not overflow horizontally');
  console.log('PASS: report download, semester isolation and mobile layout');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="logout"]').click();
  await expect(page.locator('.demo-account')).toHaveCount(3);
  await page.locator('[data-action="demo-login"][data-id="demo-student"]').click();
  await expect(page.locator('#content h1')).toBeVisible();
  for (const view of sharedViews)
    await expect(page.locator(`.nav-item[data-view="${view}"]`)).toBeVisible();
  for (const view of lecturerViews)
    await expect(page.locator(`.nav-item[data-view="${view}"]`)).toHaveCount(0);
  await expect(page.locator('.context-banner, .sidebar-note, .login-disclaimer')).toHaveCount(0);
  await assertRegulationReader(page, context);
  await page.screenshot({
    path: path.join(directory, '06-student-regulations-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoMobileOverflow(page);
  await page.screenshot({
    path: path.join(directory, '05-student-regulations-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#settings');
  await expect(page.locator('#content h1')).toHaveText('Hành trình rèn luyện của bạn');
  await expect(page.locator('form[data-form="settings"]')).toHaveCount(0);
  assert.equal((await context.request.get('/api/reports')).status(), 403);
  console.log('PASS: student inline regulations, mobile layout and admin view protection');
  const studentDashboard = await (await context.request.get('/api/dashboard')).json();
  assert.equal(studentDashboard.student.officialTotal, 50);
  await expect(page.locator('.student-hero h2')).toHaveText('Chào Nguyễn Trần Trọng Phúc!');
  await expect(page.locator('.category-card')).toHaveCount(6);
  await expect(page.locator('.category-card .category-score small')).toHaveText(
    Array(6).fill(' / 20'),
  );
  assert.equal(studentDashboard.student.name, 'Nguyễn Trần Trọng Phúc');
  await page.screenshot({ path: path.join(directory, '05-student.png'), fullPage: true });
  await page.locator('[data-action="course-open"]').click();
  const course = page.locator('form[data-form="course-summary"]');
  await course.locator('[name="cohortYear"]').fill('2025');
  await course.locator('[name="standardSemesters"]').fill('8');
  await course.locator('[name="earlyGraduation"]').check();
  await course.locator('button[type="submit"]').click();
  const courseResponse = await context.request.get(
    '/api/course/s001?cohortYear=2025&standardSemesters=8&earlyGraduation=true',
  );
  const courseData = await courseResponse.json();
  await expect(page.locator('#course-result')).toContainText(courseData.result.missingSemesters[0]);
  assert.equal(courseData.result.complete, false);
  assert.equal(courseData.result.graduationEligible, null);
  await page.locator('#modal [data-action="close-modal"]').first().click();
  console.log('PASS: whole-course UI does not treat missing historical semesters as completed');
  await page.locator('.nav-item[data-view="claims"]').click();
  await page.locator('[data-action="claim-new"]').click();
  const claim = page.locator('form[data-form="claim-create"]');
  const activities = await (await context.request.get('/api/activities')).json();
  const added = activities.activities.find((a) => a.title === 'Hoạt động kiểm thử giao diện');
  await claim.locator('[name="activityId"]').selectOption(added.id);
  await expect(claim.locator('[name="claimedPoints"]')).toHaveValue('5');
  await claim.locator('button[type="submit"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(
    page.locator('#content').getByText('Hoạt động kiểm thử giao diện', { exact: true }),
  ).toBeVisible();
  console.log('PASS: student privacy and claim submission');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Browser checks passed. Screenshots: artifacts/');
} finally {
  if (browser) await browser.close();
  await app.close();
}
