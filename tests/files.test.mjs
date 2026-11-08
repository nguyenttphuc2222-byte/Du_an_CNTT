import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  parseUpload,
  parseCsv,
  makeCsv,
  makeImportWorkbook,
  IMPORT_COLUMNS,
} from '../src/files.mjs';
const sample = {
  sourceId: 'TEST-001',
  studentCode: '523h0080',
  activityId: 'a3',
  title: 'Ngày hội, tình nguyện',
  criterionId: 'community_donation',
  categoryId: 'community',
  points: 10,
  quantity: 1,
  date: '2026-10-10',
  semester: '2026-2027-HK1',
  approvalReference: '',
};
test('CSV and XLSX preserve identifiers, Vietnamese names and quoted delimiters', async () => {
  const csv = makeCsv(IMPORT_COLUMNS, [sample]);
  assert.equal(parseCsv(csv)[0].title, sample.title);
  assert.equal(parseCsv(csv)[0].studentCode, sample.studentCode);
  const xlsx = await makeImportWorkbook([sample]);
  const rows = await parseUpload({ fileName: 'sample.xlsx', fileBase64: xlsx.toString('base64') });
  assert.deepEqual(rows, [sample]);
});
test('CSV accepts friendly Vietnamese headers and semicolon delimiter', () => {
  const csv =
    'Mã nguồn;MSSV;Mã hoạt động;Tên hoạt động;Mã tiêu chí;Mục điểm;Điểm;Số lần;Ngày;Học kỳ;Văn bản phê duyệt\r\nA;523h0080;a3;Tình nguyện;community_donation;community;10;1;2026-10-10;2026-2027-HK1;';
  assert.equal(parseCsv(csv)[0].categoryId, 'community');
  assert.equal(parseCsv(csv)[0].criterionId, 'community_donation');
  assert.equal(parseCsv(csv)[0].quantity, '1');
  assert.equal(parseCsv(csv)[0].points, '10');
});
test('malformed, missing-column and unsupported uploads fail with user-facing errors', async () => {
  assert.throws(
    () => parseCsv('a,b\n1,2'),
    (e) => e.status === 400,
  );
  assert.throws(
    () => parseCsv('sourceId,studentCode,criterionId,points,date,semester\n"unfinished'),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => parseUpload({ fileName: 'old.xls', fileBase64: 'YWJj' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => parseUpload({ fileName: 'invalid.xlsx', fileBase64: 'YWJj' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => parseUpload({ rows: [] }),
    (e) => e.status === 400,
  );
});
test('formula cells are rejected when importing official data', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Data');
  sheet.addRow(IMPORT_COLUMNS);
  sheet.addRow(IMPORT_COLUMNS.map((column) => sample[column]));
  sheet.getCell('G2').value = { formula: '5+5', result: 10 };
  const buffer = await book.xlsx.writeBuffer();
  await assert.rejects(
    () =>
      parseUpload({ fileName: 'formula.xlsx', fileBase64: Buffer.from(buffer).toString('base64') }),
    (e) => e.status === 400 && e.message.includes('công thức'),
  );
});
test('CSV export neutralizes formula injection while retaining numeric values', () => {
  const csv = makeCsv(
    ['text', 'number'],
    [
      { text: '=HYPERLINK("bad")', number: -2 },
      { text: ' @SUM(A1)', number: 3 },
    ],
  );
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("' @SUM"));
  assert.ok(csv.includes(',-2'));
});

test('XLSX preflight rejects excessive decompressed size before parsing worksheets', async () => {
  const buffer = await makeImportWorkbook([sample]);
  const end = buffer.length - 22;
  const directory = buffer.readUInt32LE(end + 16);
  buffer.writeUInt32LE(32 * 1024 * 1024, directory + 24);
  await assert.rejects(
    () => parseUpload({ fileName: 'oversized.xlsx', fileBase64: buffer.toString('base64') }),
    (error) => error.status === 400 && error.message.includes('giải nén'),
  );
});

test('obsolete three-category import must supply an explicit new criterion', () => {
  assert.throws(
    () =>
      parseCsv(
        'sourceId,studentCode,categoryId,points,date,semester\nA,523h0080,c2,10,2026-10-10,2026-2027-HK1',
      ),
    (error) => error.status === 400 && error.message.includes('criterionId'),
  );
});

test('report export retains annual average, missing status and six category labels', async () => {
  const { reportRows, makeReportWorkbook } = await import('../src/files.mjs');
  const student = {
    code: '523h0080',
    name: 'Tên Google',
    className: 'CNTT',
    semester: '2026-2027',
    hasOfficialData: false,
    officialTotal: null,
    pendingTotal: 0,
    projectedTotal: null,
    officialClassification: null,
    projectedClassification: null,
    annualTotal: null,
    annualClassification: null,
    evaluationStatus: 'incomplete',
    legacyCount: 2,
    warnings: ['Thiếu học kỳ 2'],
    semesterBreakdown: [
      {
        semester: '2026-2027-HK1',
        hasOfficialData: true,
        officialTotal: 70,
        officialClassification: 'Khá',
      },
      { semester: '2026-2027-HK2', hasOfficialData: false, officialTotal: null },
    ],
    categoryScores: [{ name: 'Điểm thưởng', official: 7, projected: 7 }],
  };
  const report = {
    students: [student],
    basis: 'official',
    settings: { versionName: 'tdtu-2025-2026' },
    stats: { total: 1, hasData: 0, noData: 1, byClassification: [] },
  };
  const rows = reportRows(report);
  assert.equal(rows[0]['Điểm trung bình năm'], null);
  assert.equal(rows[0]['Xếp loại năm'], 'Chưa đủ hai học kỳ');
  assert.equal(rows[0]['2026-2027-HK1 - điểm chính thức'], 70);
  assert.equal(rows[0]['2026-2027-HK2 - điểm chính thức'], null);
  assert.equal(rows[0]['Số khoản cũ cần đối chiếu'], 2);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await makeReportWorkbook(report));
  assert.equal(book.worksheets.length, 3);
  assert.ok(book.getWorksheet('Thong tin').getColumn(2).values.join(' ').includes('2025–2026'));
});

test('closed report export preserves version and time without publishing a missing or partial result as zero', async () => {
  const { reportRows, makeReportWorkbook } = await import('../src/files.mjs');
  const base = {
    code: 'DEMO',
    name: 'Hồ sơ kiểm thử',
    className: 'Lớp mẫu',
    semester: 'configured-term',
    snapshotId: 'snapshot-1',
    snapshotVersion: 1,
    closedAt: '2026-11-06T00:00:00.000Z',
    pendingTotal: 0,
    projectedTotal: null,
    projectedClassification: null,
    categoryScores: [{ name: 'Học tập', official: 0, projected: 0 }],
  };
  const report = {
    students: [
      {
        ...base,
        evaluationStatus: 'no_data',
        hasOfficialData: false,
        officialTotal: 0,
        publishedTotal: null,
      },
      {
        ...base,
        evaluationStatus: 'incomplete',
        hasOfficialData: true,
        officialTotal: 8,
        publishedTotal: null,
        officialClassification: 'Kém',
      },
      {
        ...base,
        evaluationStatus: 'evaluated',
        hasOfficialData: true,
        officialTotal: 0,
        publishedTotal: 0,
        officialClassification: 'Kém',
      },
    ],
    basis: 'official',
    settings: { versionName: 'snapshot-rules' },
    stats: { total: 3, hasData: 1, noData: 2, byClassification: [] },
  };
  const rows = reportRows(report);
  assert.deepEqual(
    rows.map((row) => row['Điểm chính thức']),
    [null, null, 0],
  );
  assert.deepEqual(
    rows.map((row) => row['Học tập - chính thức']),
    [null, null, 0],
  );
  assert.equal(rows[1]['Xếp loại chính thức'], 'Chưa đủ dữ liệu đánh giá');
  assert.equal(rows[2]['Xếp loại chính thức'], 'Kém');
  assert.equal(rows[0]['Bản chốt'], 1);
  assert.equal(rows[0]['Thời điểm chốt'], base.closedAt);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await makeReportWorkbook(report));
  const headers = workbook.worksheets[0].getRow(1).values;
  const column = headers.indexOf('Điểm chính thức');
  assert.equal(workbook.worksheets[0].getRow(2).getCell(column).value, null);
  assert.equal(workbook.worksheets[0].getRow(4).getCell(column).value, 0);
});
