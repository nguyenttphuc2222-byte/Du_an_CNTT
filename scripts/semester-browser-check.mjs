import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.mjs';

// Isolated demo sessions and in-memory SQLite. This does not verify Google consent.
const app = await createApp({
  port: 0,
  dbPath: ':memory:',
  config: { demoEnabled: true, googleClientId: '', googleClientSecret: '' },
});
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${app.server.address().port}`;
const output = path.resolve('artifacts/semester-lifecycle');
await mkdir(output, { recursive: true });
const errors = [];
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-action="demo-login"][data-id="demo-lecturer"]').click();
  await page.locator('.nav-item[data-view="semesters"]').click();
  await expect(page.locator('#content h1')).toHaveText('Năm học và học kỳ');
  await page.locator('[data-action="semester-new"]').click();
  const form = page.locator('form[data-form="semester-save"]');
  await form.locator('[name="name"]').fill('Học kỳ mới kiểm thử');
  await form.locator('[name="id"]').fill('browser-hoc-ky-moi');
  await form.locator('[name="academicYear"]').fill('2027-2028');
  await form.locator('[name="term"]').fill('1');
  await form.locator('[name="startsAt"]').fill('2026-01-01T08:00');
  await form.locator('[name="deadline"]').fill('2028-01-01T17:30');
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  const enrollment = await context.request.post('/api/roster/copy', {
    data: {
      fromSemester: '2026-2027-HK1',
      toSemester: 'browser-hoc-ky-moi',
      reason: 'Ghi danh rõ ràng cho kiểm thử giao diện học kỳ mới',
    },
  });
  assert.equal(enrollment.status(), 200, await enrollment.text());
  const row = () => page.locator('#content tr').filter({ hasText: 'browser-hoc-ky-moi' });
  await expect(row()).toContainText('17:30');
  await expect(page.locator('#semester-select option[value="browser-hoc-ky-moi"]')).toHaveCount(1);
  await page.locator('#semester-select').selectOption('browser-hoc-ky-moi');
  await expect(row()).toBeVisible();
  await row().locator('[data-action="semester-edit"]').click();
  await expect(form.locator('[name="id"]')).toHaveAttribute('readonly', '');
  await expect(form.locator('[name="deadline"]')).toHaveValue('2028-01-01T17:30');
  await page.locator('#modal [data-action="close-modal"]').first().click();

  async function transition(action, reason, acknowledge = false) {
    await row().locator(`[data-action="semester-transition"][data-transition="${action}"]`).click();
    const transitionForm = page.locator('form[data-form="semester-transition"]');
    await transitionForm.locator('[name="reason"]').fill(reason);
    if (acknowledge) await transitionForm.locator('[name="acknowledgeIncomplete"]').check();
    await transitionForm.locator('[type="submit"]').click();
    return transitionForm;
  }
  await transition('review', 'Bắt đầu tổng hợp trên giao diện');
  await expect(row()).toContainText('Đang tổng hợp');
  const closing = await transition('close', 'Thử chốt khi chưa xác nhận hồ sơ thiếu');
  await expect(closing.locator('.form-error')).toBeVisible();
  await closing.locator('[name="acknowledgeIncomplete"]').check();
  await closing.locator('[type="submit"]').click();
  await expect(closing).toBeHidden();
  await expect(row()).toContainText('Đã chốt và khóa');
  await row().locator('[data-action="semester-history"]').click();
  await expect(page.locator('#modal')).toContainText('Phiên bản 1');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="semester-snapshot"]').click(),
  ]);
  assert.match(download.suggestedFilename(), /-v1\.json$/);
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.locator('.nav-item[data-view="activities"]').click();
  await expect(page.locator('[data-action="activity-new"]')).toBeDisabled();
  await page.locator('.nav-item[data-view="semesters"]').click();
  await transition('reopen', 'Bổ sung căn cứ và mở lại');
  await expect(row()).toContainText('Đang mở');
  await transition('close', 'Chốt lại giữ lịch sử', true);
  await row().locator('[data-action="semester-history"]').click();
  await expect(page.locator('#modal')).toContainText('Phiên bản 1');
  await expect(page.locator('#modal')).toContainText('Phiên bản 2');
  await expect(page.locator('#modal')).toContainText('Bổ sung căn cứ và mở lại');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  await page.screenshot({ path: path.join(output, 'lecturer-semesters.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
  );
  await page.screenshot({ path: path.join(output, 'mobile-semesters.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    false,
  );

  const studentContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const studentPage = await studentContext.newPage();
  studentPage.on('pageerror', (error) => errors.push(error.message));
  await studentPage.goto('/');
  await studentPage.locator('[data-action="demo-login"][data-id="demo-student"]').click();
  await studentPage.locator('#semester-select').selectOption('browser-hoc-ky-moi');
  await expect(studentPage.locator('.semester-notice')).toContainText('Đã chốt và khóa');
  await expect(studentPage.locator('[data-action="claim-new"]').first()).toBeDisabled();
  await expect(studentPage.locator('.category-card').first()).toContainText('Dự kiến: —');
  await expect(studentPage.locator('.nav-item[data-view="semesters"]')).toHaveCount(0);
  await studentPage.screenshot({ path: path.join(output, 'student-closed.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: catalogue create/edit, UTC+7, review/close/reopen, two immutable versions, JSON download, locked controls, student permissions and mobile layout. Google login/consent not exercised.',
  );
} finally {
  await browser?.close();
  await app.close();
}
