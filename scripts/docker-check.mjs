import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const base = process.env.BASE_URL || 'http://localhost:3000';
async function get(path, cookie) {
  return fetch(base + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
}
async function login(userId) {
  const response = await fetch(base + '/api/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  assert.equal(response.status, 200);
  return { data: await response.json(), cookie: response.headers.getSetCookie()[0].split(';')[0] };
}
const health = await get('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).ruleVersion, 'tdtu-2025-2026');
assert.equal((await get('/docs/quy-che-ren-luyen-tdtu.pdf')).status, 200);
assert.equal((await get('/app.js')).status, 200);
const lecturer = await login('demo-lecturer');
assert.equal(lecturer.data.user.email, '523h0025@student.tdtu.edu.vn');
const students = await (await get('/api/students', lecturer.cookie)).json();
assert.equal(students.students.length, 30);
const student = await login('demo-student');
assert.equal(student.data.user.email, '523h0080@student.tdtu.edu.vn');
const dashboard = await (await get('/api/dashboard', student.cookie)).json();
assert.equal(dashboard.student.code, '523h0080');
assert.equal(dashboard.categories.length, 6);
assert.ok(dashboard.categories.every((cat) => cat.maxPoints === 20));
assert.equal((await get('/api/audit', student.cookie)).status, 403);
const records = await (await get('/api/official-records', student.cookie)).json();
assert.ok(records.records.every((record) => record.studentCode === '523h0080'));
const hk2 = await (await get('/api/reports?semester=2026-2027-HK2', lecturer.cookie)).json();
assert.equal(hk2.stats.hasData, 0);
const report = await get('/api/export/report.xlsx', lecturer.cookie);
assert.equal(report.status, 200);
const book = new ExcelJS.Workbook();
await book.xlsx.load(Buffer.from(await report.arrayBuffer()));
assert.equal(book.worksheets[0].rowCount, 31);
const audit = await (await get('/api/audit', lecturer.cookie)).json();
const seed = audit.entries.find((entry) => entry.action === 'Khởi tạo dữ liệu');
assert.ok(seed);
console.log(
  JSON.stringify({
    ok: true,
    students: students.students.length,
    official: dashboard.student.officialTotal,
    pending: dashboard.student.pendingTotal,
    projected: dashboard.student.projectedTotal,
    seedCreatedAt: seed.createdAt,
  }),
);
