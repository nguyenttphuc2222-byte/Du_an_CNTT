import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.mjs';
await mkdir('artifacts', { recursive: true });
const dbPath = path.resolve('artifacts/browser-migration.sqlite');
await copyFile('artifacts/backups/before-pdf-rules-20261024.sqlite', dbPath);
const app = await createApp({
  port: 0,
  dbPath,
  config: { demoEnabled: true, googleClientId: '', googleClientSecret: '' },
});
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${app.server.address().port}`,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-action="demo-login"][data-id="demo-lecturer"]').click();
  await page.locator('.nav-item[data-view="legacy"]').click();
  await expect(page.locator('#content h1')).toHaveText('Dữ liệu cần đối chiếu');
  const before = await (await context.request.get('/api/legacy')).json();
  const record = before.records.find((r) => !r.matchedClaimId);
  assert.ok(record);
  await page
    .locator(`[data-action="legacy-edit"][data-type="record"][data-id="${record.id}"]`)
    .click();
  const form = page.locator('form[data-form="legacy-reclassify"]');
  await form.locator('[name="criterionId"]').selectOption('academic_seminar');
  await expect(form.locator('[name="points"]')).toHaveValue('5');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const after = await (await context.request.get('/api/legacy')).json();
  assert.equal(after.records.length, before.records.length - 1);
  const updated = (await (await context.request.get('/api/official-records')).json()).records.find(
    (r) => r.id === record.id,
  );
  assert.equal(updated.sourceId, record.sourceId);
  assert.equal(updated.criterionId, 'academic_seminar');
  assert.equal(updated.legacy, false);
  assert.equal(updated.points, 5);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/06-legacy-review.png', fullPage: true });
  console.log(
    'PASS: existing-data migration UI preserves source identity and requires explicit criterion confirmation',
  );
} finally {
  if (browser) await browser.close();
  await app.close();
}
