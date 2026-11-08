import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.mjs';

const SEMESTER = '2026-2027-HK2';
const directory = path.resolve('artifacts/workflows');
await mkdir(directory, { recursive: true });
let token,
  workspace = false,
  denySharing = true,
  permissionIndex = 0;
const originals = Object.fromEntries(
  ['getToken', 'verifyIdToken', 'request'].map((key) => [key, OAuth2Client.prototype[key]]),
);
// This entire Google identity/Drive flow is MOCKED. No real Google sign-in or consent occurs.
OAuth2Client.prototype.getToken = async () => ({
  tokens: {
    id_token: 'workflow-mock-identity',
    ...(workspace
      ? {
          access_token: 'workflow-mock-access',
          expiry_date: Date.now() + 3600000,
          scope:
            'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly',
        }
      : {}),
  },
});
OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => token });
OAuth2Client.prototype.request = async (options) => {
  if (options.url.includes('/upload/'))
    return { data: { id: 'workflow_evidence_file_12345', name: 'minh-chung.pdf' } };
  if (options.url.includes('/permissions')) {
    if (!options.method || options.method === 'GET') return { data: { permissions: [] } };
    if (options.method === 'DELETE') return { data: undefined };
    if (denySharing)
      throw {
        response: { status: 403, data: { error: { message: 'Mock policy denies sharing' } } },
      };
    return { data: { id: `workflow_permission_${++permissionIndex}` } };
  }
  throw new Error('Unexpected mocked Google URL');
};
let app, browser;
const errors = [];
try {
  app = await createApp({
    port: 0,
    dbPath: ':memory:',
    config: {
      demoEnabled: true,
      googleClientId: 'workflow-browser-client',
      googleClientSecret: 'workflow-browser-secret',
      authAudience: 'external',
      lecturerEmails: [],
      coordinatorEmails: [],
    },
  });
  const manager = app.store.getUser('demo-lecturer');
  app.store.saveAssessment(manager, 's001', {
    semester: SEMESTER,
    gpa: 8.5,
    complianceConfirmed: true,
    offlineActivityCount: 7,
  });
  app.store.commitImport(manager, {
    rows: [
      {
        sourceId: 'WORKFLOW-ORIGINAL',
        studentCode: '523h0080',
        semester: SEMESTER,
        title: 'Seminar cần phúc tra',
        criterionId: 'academic_seminar',
        quantity: 1,
        date: '2026-11-08',
      },
    ],
  });
  const original = app.store.officialRecords(manager, { semester: SEMESTER }).records[0];
  app.store.transitionSemester(manager, SEMESTER, {
    action: 'close',
    reason: 'Bản chốt trước phúc tra',
    acknowledgeIncomplete: true,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const staff = await staffContext.newPage();
  staff.on('pageerror', (error) => errors.push(error.message));
  await staff.goto('/');
  await staff.locator('[data-action="demo-login"][data-id="demo-lecturer"]').click();
  await staff.locator('#semester-select').selectOption(SEMESTER);

  const studentContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  async function googleFlow(connect = false) {
    workspace = connect;
    const response = await studentContext.request.get(
      connect ? '/auth/google/connect?returnTo=appeals' : '/auth/google',
      { maxRedirects: 0 },
    );
    const location = new URL(response.headers().location);
    token = {
      sub: 'workflow-browser-student',
      email: '523h0080@student.tdtu.edu.vn',
      name: 'Sinh viên kiểm thử phúc tra',
      email_verified: true,
      iss: 'https://accounts.google.com',
      aud: 'workflow-browser-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: location.searchParams.get('nonce'),
    };
    const callback = await studentContext.request.get(
      '/auth/google/callback?' +
        new URLSearchParams({ code: 'mock-code', state: location.searchParams.get('state') }),
      { maxRedirects: 0 },
    );
    assert.ok(
      callback.headers().location === '/' ||
        callback.headers().location.includes('googleConnected=1'),
    );
  }
  await googleFlow();
  await googleFlow(true);
  const student = await studentContext.newPage();
  student.on('pageerror', (error) => errors.push(error.message));
  await student.goto('/');
  await student.locator('#semester-select').selectOption(SEMESTER);
  await student.locator('.nav-item[data-view="appeals"]').click();
  await student.locator('[data-action="appeal-new"]').first().click();
  const creating = student.locator('form[data-form="appeal-create"]');
  await creating.locator('[name="target"]').selectOption(`record|${original.id}`);
  await creating.locator('[name="reason"]').fill('Điểm nguồn ghi thiếu một lần tham gia seminar');
  await creating.locator('[type="submit"]').click();
  await expect(creating).toBeHidden();
  const appeal = app.store.appeals(app.store.getUser('demo-student'), { semester: SEMESTER })
    .appeals[0];
  await student.locator('#modal [data-action="close-modal"]').first().click();

  await staff.locator('.nav-item[data-view="appeals"]').click();
  await staff.locator(`[data-action="appeal-detail"][data-id="${appeal.id}"]`).click();
  await expect(
    staff.locator('[data-action="appeal-resolve"][data-resolution="approve"]'),
  ).toBeDisabled();
  await staff.locator('[data-action="appeal-resolve"][data-resolution="request_info"]').click();
  let resolving = staff.locator('form[data-form="appeal-resolve"]');
  await resolving
    .locator('[name="reason"]')
    .fill('Đề nghị bổ sung tệp xác nhận đủ hai lần tham gia');
  await resolving.locator('[type="submit"]').click();
  await expect(resolving).toBeHidden();
  if (await staff.locator('#modal').isVisible())
    await staff.locator('#modal [data-action="close-modal"]').first().click();
  await student.reload();
  await student.locator(`[data-action="appeal-detail"][data-id="${appeal.id}"]`).click();
  const responding = student.locator('form[data-form="appeal-respond"]');
  await responding
    .locator('[name="evidenceFile"]')
    .setInputFiles({
      name: 'minh-chung.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nMock workflow evidence'),
    });
  await responding.locator('[data-action="evidence-upload"]').click();
  await expect(responding.locator('[name="evidenceId"]')).not.toHaveValue('');
  await expect(student.locator('#evidence-result')).toContainText('chưa chia sẻ');
  await responding
    .locator('[name="reason"]')
    .fill('Đã bổ sung tệp xác nhận; chia sẻ chưa hoàn tất và đang xử lý');
  const supplementResponse = student.waitForResponse(
    (response) =>
      response.url().includes(`/api/appeals/${appeal.id}/respond`) &&
      response.request().method() === 'POST',
  );
  await responding.locator('[type="submit"]').click();
  assert.equal((await supplementResponse).status(), 200);
  await expect(student.locator('#modal')).toContainText('Đã bổ sung tệp xác nhận');
  if (await student.locator('#modal').isVisible())
    await student.locator('#modal [data-action="close-modal"]').first().click();
  await student.locator('.nav-item[data-view="evidence"]').click();
  await student.locator('#content [data-action="evidence-detail"]').first().click();
  denySharing = false;
  await student.locator('[data-action="evidence-retry"]').click();
  await expect(student.locator('#modal')).toContainText('Đã chia sẻ');
  await student.locator('#modal [data-action="close-modal"]').first().click();

  await staff.locator('.nav-item[data-view="semesters"]').click();
  await staff
    .locator('#content tr')
    .filter({ hasText: SEMESTER })
    .locator('[data-action="semester-transition"][data-transition="reopen"]')
    .click();
  const reopen = staff.locator('form[data-form="semester-transition"]');
  await reopen.locator('[name="reason"]').fill('Mở lại để xử lý phúc tra có căn cứ');
  await reopen.locator('[type="submit"]').click();
  await expect(reopen).toBeHidden();
  await staff.locator('.nav-item[data-view="appeals"]').click();
  await staff.locator(`[data-action="appeal-detail"][data-id="${appeal.id}"]`).click();
  await staff.locator('[data-action="appeal-resolve"][data-resolution="approve"]').click();
  resolving = staff.locator('form[data-form="appeal-resolve"]');
  await resolving.locator('[name="reason"]').fill('Xác nhận hai lần tham gia từ văn bản nguồn');
  await resolving.locator('[name="sourceId"]').fill('WORKFLOW-REPLACEMENT');
  await resolving.locator('[name="criterionId"]').selectOption('academic_seminar');
  await resolving.locator('[name="quantity"]').fill('2');
  await resolving.locator('[name="approvalReference"]').fill('PT-WORKFLOW-01');
  await resolving.locator('[type="submit"]').click();
  await expect(resolving).toBeHidden();
  if (!(await staff.locator('#modal').isVisible()))
    await staff.locator(`[data-action="appeal-detail"][data-id="${appeal.id}"]`).click();
  await expect(staff.locator('#modal')).toContainText('PT-WORKFLOW-01');
  await staff.screenshot({ path: path.join(directory, 'appeal-history.png'), fullPage: true });
  await student.locator('.nav-item[data-view="dashboard"]').click();
  await expect(student.locator('.student-hero')).toContainText('46');
  const summary = await (
    await studentContext.request.get('/api/dashboard?semester=' + SEMESTER)
  ).json();
  assert.equal(summary.student.officialTotal, 46);
  const records = await (
    await studentContext.request.get('/api/official-records?semester=' + SEMESTER)
  ).json();
  assert.equal(records.records.filter((row) => row.effective).length, 1);
  await student.locator('.nav-item[data-view="notifications"]').click();
  await expect(student.locator('#content')).toContainText('phúc tra');
  await student.locator('[data-action="notifications-read-all"]').click();
  assert.equal(
    (await (await studentContext.request.get('/api/notifications')).json()).unreadCount,
    0,
  );
  await student.setViewportSize({ width: 390, height: 844 });
  await student.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
  );
  await expect(student.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  assert.equal(
    await student.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    false,
  );
  await student.screenshot({
    path: path.join(directory, 'mobile-notifications.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: closed-term appeal, request/supplement, persisted failed sharing and owner retry, explicit reopen and effective replacement46not51, audit history, read notifications and mobile layout. All Google identity/Drive responses MOCKED.',
  );
} finally {
  await browser?.close();
  await app?.close();
  Object.assign(OAuth2Client.prototype, originals);
}
