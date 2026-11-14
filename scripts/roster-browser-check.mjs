import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.mjs';
import { makeCsv } from '../src/files.mjs';
import { ROSTER_COLUMNS } from '../src/roster-files.mjs';

// Google identity, Workspace consent and Sheets responses are mocked.
const COORDINATORS = ['nguyenttphuc2005@gmail.com', 'son417502@gmail.com'];
const TEACHER = 'nguyenttphuc2222@gmail.com';
const FIRST = '2026-2027-HK1',
  NEW = 'roster-browser-term';
const output = path.resolve('artifacts/roadmap-roster');
await mkdir(output, { recursive: true });
const originalGetToken = OAuth2Client.prototype.getToken;
const originalVerify = OAuth2Client.prototype.verifyIdToken;
const originalRequest = OAuth2Client.prototype.request;
const sheetId = 'roster_browser_sheet_12345';
const tab = {
  sheetId: 10,
  title: 'Danh sách minh họa',
  index: 0,
  sheetType: 'GRID',
  gridProperties: { rowCount: 1000, columnCount: 26 },
};
const sheetRow = {
  sourceId: 'SHEETS-BROWSER-01',
  studentCode: '0001234',
  name: 'Sinh viên minh họa',
  email: '0001234@student.tdtu.edu.vn',
  classId: 'SHEETS-DEMO',
  className: 'Lớp minh họa Sheets',
  faculty: 'CNTT',
  cohortYear: 2026,
  semester: NEW,
  approvalReference: 'DS-MINH-HOA',
};
let token,
  workspace = false,
  invalidSheet = true,
  browser,
  app;
const errors = [];
OAuth2Client.prototype.getToken = async () => ({
  tokens: {
    id_token: 'mock-browser-identity',
    ...(workspace
      ? {
          access_token: 'mock-browser-workspace',
          expiry_date: Date.now() + 3600000,
          scope:
            'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly',
        }
      : {}),
  },
});
OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => token });
OAuth2Client.prototype.request = async ({ url }) => {
  const request = new URL(url);
  assert.equal(request.origin, 'https://sheets.googleapis.com');
  assert.equal(request.pathname, '/v4/spreadsheets/' + sheetId);
  const data = {
    properties: { title: 'Danh sách sinh viên minh họa' },
    sheets: [{ properties: tab }],
  };
  if (request.searchParams.has('ranges')) {
    const row = { ...sheetRow, ...(invalidSheet ? { email: 'email-sai' } : {}) };
    data.sheets[0].data = [
      {
        rowData: [ROSTER_COLUMNS, [], ROSTER_COLUMNS.map((key) => row[key])].map((values) => ({
          values: values.map((value) => ({
            formattedValue: String(value),
            userEnteredValue: { stringValue: String(value) },
          })),
        })),
      },
    ];
  }
  return { data };
};
try {
  app = await createApp({
    port: 0,
    dbPath: ':memory:',
    config: {
      demoEnabled: false,
      googleClientId: 'browser-mock-client',
      googleClientSecret: 'browser-mock-secret',
      authAudience: 'external',
      lecturerEmails: [...COORDINATORS, TEACHER],
      coordinatorEmails: COORDINATORS,
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  async function authenticate(context, email, connect = false) {
    workspace = connect;
    const response = await context.request.get(connect ? '/auth/google/connect' : '/auth/google', {
      maxRedirects: 0,
    });
    const consent = new URL(response.headers().location);
    token = {
      sub: `browser-mock-${email}`,
      email,
      name: email === TEACHER ? 'Giảng viên được phân công' : 'Điều phối viên kiểm thử',
      iss: 'https://accounts.google.com',
      aud: 'browser-mock-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email_verified: true,
      nonce: consent.searchParams.get('nonce'),
    };
    const callback = await context.request.get(
      '/auth/google/callback?' +
        new URLSearchParams({ code: 'mock-code', state: consent.searchParams.get('state') }),
      { maxRedirects: 0 },
    );
    assert.equal(callback.headers().location, connect ? '/?googleConnected=1' : '/');
  }
  async function login(email) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    await authenticate(context, email);
    const session = await (await context.request.get('/api/session')).json();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#content h1')).toBeVisible();
    return { context, page, session };
  }
  const manager = await login(COORDINATORS[0]);
  const secondManager = await login(COORDINATORS[1]);
  const teacher = await login(TEACHER);
  assert.equal(manager.session.access.isCoordinator, true);
  assert.equal(secondManager.session.access.isCoordinator, true);
  assert.equal(teacher.session.access.isCoordinator, false);
  const page = manager.page;
  await page.locator('.nav-item[data-view="semesters"]').click();
  await page.locator('[data-action="semester-new"]').click();
  const period = page.locator('form[data-form="semester-save"]');
  await period.locator('[name="name"]').fill('Học kỳ danh sách kiểm thử');
  await period.locator('[name="id"]').fill(NEW);
  await period.locator('[name="academicYear"]').fill('2027-2028');
  await period.locator('[name="term"]').fill('1');
  await period.locator('[type="submit"]').click();
  await expect(period).toBeHidden();
  await page.locator('#semester-select').selectOption(NEW);
  await page.locator('.nav-item[data-view="roster"]').click();
  await expect(page.locator('#content')).toContainText('Chưa có hồ sơ phù hợp');
  await page.locator('[data-action="roster-copy"]').click();
  const copying = page.locator('form[data-form="roster-copy"]');
  await copying.locator('[name="fromSemester"]').selectOption(FIRST);
  await copying.locator('[name="toSemester"]').selectOption(NEW);
  await copying.locator('[name="reason"]').fill('Sao chép danh sách kỳ mới theo căn cứ kiểm thử');
  await copying.locator('[type="submit"]').click();
  await expect(copying).toBeHidden();
  await expect(page.locator('.roster-table tbody tr')).toHaveCount(30);

  const transfer = {
    sourceId: 'BROWSER-TRANSFER',
    studentCode: '523h0080',
    name: 'Nguyễn Minh An',
    email: '523h0080@student.tdtu.edu.vn',
    classId: 'BROWSER-CLASS',
    className: 'Lớp kiểm thử phân công',
    faculty: 'CNTT',
    cohortYear: 2023,
    semester: NEW,
    approvalReference: 'DS-BROWSER-2026',
  };
  await page.locator('[data-action="roster-import"]').click();
  const preview = page.locator('form[data-form="roster-preview"]');
  await preview.locator('[name="csv"]').fill(makeCsv(ROSTER_COLUMNS, [transfer]));
  await preview.locator('[type="submit"]').click();
  const committing = page.locator('form[data-form="roster-commit"]');
  await expect(committing).toBeVisible();
  await committing.locator('[name="reason"]').fill('Chuyển lớp có căn cứ trong đúng kỳ');
  await committing.locator('[type="submit"]').click();
  await expect(committing).toBeHidden();
  await expect(page.locator('.roster-table tr').filter({ hasText: '523h0080' })).toContainText(
    'Lớp kiểm thử phân công',
  );
  await page.locator('[data-action="assignment-new"]').click();
  const assigning = page.locator('form[data-form="assignment-create"]');
  await assigning.locator('[name="classId"]').selectOption('BROWSER-CLASS');
  await assigning.locator('[name="lecturerId"]').selectOption(teacher.session.user.id);
  await assigning.locator('[name="reason"]').fill('Phân công phụ trách lớp kiểm thử');
  await assigning.locator('[type="submit"]').click();
  await expect(assigning).toBeHidden();
  await expect(page.locator('.assignment-table tbody tr')).toHaveCount(1);

  await teacher.page.reload();
  await teacher.page.locator('#semester-select').selectOption(NEW);
  await teacher.page.locator('.nav-item[data-view="roster"]').click();
  await expect(teacher.page.locator('.roster-table tbody tr')).toHaveCount(1);
  await expect(teacher.page.locator('.roster-table')).toContainText('523h0080');
  await expect(teacher.page.locator('[data-action="roster-import"]')).toHaveCount(0);
  await expect(teacher.page.locator('[data-action="roster-sheets-import"]')).toHaveCount(0);
  await expect(teacher.page.locator('.nav-item[data-view="semesters"]')).toHaveCount(0);
  assert.equal(
    (await teacher.context.request.get(`/api/assessments/s002?semester=${NEW}`)).status(),
    403,
  );
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  await page.screenshot({ path: path.join(output, 'coordinator-roster.png'), fullPage: true });
  await teacher.page.screenshot({
    path: path.join(output, 'lecturer-scoped-roster.png'),
    fullPage: true,
  });
  await page
    .locator('.roster-table tr')
    .filter({ hasText: '523h0080' })
    .locator('[data-action="roster-history"]')
    .click();
  await expect(page.locator('#modal')).toContainText('Lớp kiểm thử phân công');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.locator('#semester-select').selectOption(FIRST);
  await expect(page.locator('.roster-table tr').filter({ hasText: '523h0080' })).toContainText(
    'CNTT 24A',
  );
  await page.locator('#semester-select').selectOption(NEW);
  await authenticate(manager.context, COORDINATORS[0], true);
  await page.reload();
  const openSheet = page.locator('#content [data-action="roster-sheets-import"]');
  await expect(openSheet).toBeVisible();
  async function previewSheet(trigger) {
    await trigger.click();
    const form = page.locator('form[data-form="roster-sheets-preview"]');
    await form.locator('[name="semester"]').selectOption(NEW);
    await form
      .locator('[name="url"]')
      .fill(`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=10`);
    await form.locator('[name="sheetName"]').fill(tab.title);
    await form.locator('[type="submit"]').click();
    await expect(page.locator('.roster-preview tbody tr')).toBeVisible();
  }
  await previewSheet(openSheet);
  await expect(page.locator('.roster-preview tbody tr td').first()).toHaveText('3');
  await expect(page.locator('.roster-preview tbody tr')).toContainText(
    'Email sinh viên không hợp lệ',
  );
  await expect(committing.locator('[type="submit"]')).toBeDisabled();
  invalidSheet = false;
  await previewSheet(page.locator('#modal [data-recheck]'));
  await expect(page.locator('.roster-sheet-source')).toContainText(tab.title);
  await expect(page.locator('.roster-preview tbody tr')).toContainText('0001234');
  await expect(page.locator('.roster-table tbody')).not.toContainText('0001234');
  await page.locator('#modal').screenshot({ path: path.join(output, 'sheets-roster-preview.png') });
  await committing.locator('[name="reason"]').fill('Nhập danh sách minh họa từ Google Sheets');
  await committing.locator('[type="submit"]').click();
  await expect(committing).toBeHidden();
  const added = page.locator('.roster-table tbody tr').filter({ hasText: '0001234' });
  await expect(added).toContainText(sheetRow.className);
  await added.locator('[data-action="roster-history"]').click();
  await expect(page.locator('#modal')).toContainText(tab.title);
  await page.locator('#modal').screenshot({ path: path.join(output, 'sheets-roster-history.png') });
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.locator('.nav-item[data-view="semesters"]').click();
  const semesterRow = page.locator('#content tr').filter({ hasText: NEW });
  await semesterRow.locator('[data-action="semester-transition"][data-transition="close"]').click();
  const closing = page.locator('form[data-form="semester-transition"]');
  await closing.locator('[name="reason"]').fill('Chốt danh sách và kết quả kiểm thử');
  await closing.locator('[name="acknowledgeIncomplete"]').check();
  await closing.locator('[type="submit"]').click();
  await expect(closing).toBeHidden();
  await page.locator('.nav-item[data-view="roster"]').click();
  await page.locator('[data-action="assignment-revoke"]').click();
  const revoking = page.locator('form[data-form="assignment-revoke"]');
  await revoking.locator('[name="reason"]').fill('Thu hồi quyền sau khi kết thúc phụ trách');
  await revoking.locator('[type="submit"]').click();
  await expect(revoking).toBeHidden();
  await expect(page.locator('.assignment-table')).toContainText('Đã thu hồi');
  await teacher.page.reload();
  await expect(teacher.page.locator('.roster-table')).toHaveCount(0);
  assert.equal(
    (await teacher.context.request.get(`/api/assessments/s001?semester=${NEW}`)).status(),
    403,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
  );
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    false,
  );
  await page.screenshot({ path: path.join(output, 'mobile-roster.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: roster copy, CSV transfer, Sheets preview with physical line errors, atomic confirmation and provenance, assignment scope, closed-term revocation and mobile layout. Google responses MOCKED.',
  );
} finally {
  await browser?.close();
  await app?.close();
  OAuth2Client.prototype.getToken = originalGetToken;
  OAuth2Client.prototype.verifyIdToken = originalVerify;
  OAuth2Client.prototype.request = originalRequest;
}
