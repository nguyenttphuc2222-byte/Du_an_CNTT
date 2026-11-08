import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeCsv } from '../src/files.mjs';
import { ROSTER_COLUMNS, parseRosterUpload, makeRosterWorkbook } from '../src/roster-files.mjs';

const sample = {
  sourceId: 'DS-0001',
  studentCode: '0012345',
  name: 'Nguyễn Thị Ánh, Minh',
  email: 'test-student@example.test',
  classId: 'CNTT-2027-A',
  className: 'Công nghệ thông tin A',
  faculty: 'Công nghệ thông tin',
  cohortYear: 2027,
  semester: 'ky-duoc-cau-hinh',
  approvalReference: 'Danh sách 42/QĐ',
};

test('roster CSV and XLSX preserve leading zeros, names, provenance and per-row custom semesters', async () => {
  const second = { ...sample, sourceId: 'DS-0002', semester: 'ky-khac', classId: 'CNTT-2027-B' };
  const csv = makeCsv(ROSTER_COLUMNS, [sample, second]);
  const csvRows = await parseRosterUpload({ csv });
  assert.equal(csvRows[0].studentCode, '0012345');
  assert.equal(csvRows[0].name, sample.name);
  assert.equal(csvRows[0].approvalReference, sample.approvalReference);
  assert.deepEqual(
    csvRows.map((row) => row.semester),
    [sample.semester, second.semester],
  );
  const xlsx = await makeRosterWorkbook([sample, second]);
  assert.deepEqual(
    await parseRosterUpload({ fileName: 'danh-sach.xlsx', fileBase64: xlsx.toString('base64') }),
    [sample, second],
  );
  assert.deepEqual(
    await parseRosterUpload({
      fileName: 'danh-sach.csv',
      fileBase64: Buffer.from(csv).toString('base64'),
    }),
    csvRows,
  );
});

test('roster accepts Vietnamese headers without interpreting score-import columns', async () => {
  const csv =
    'Mã nguồn;MSSV;Họ tên;Email;Mã lớp;Tên lớp;Khoa;Năm tuyển sinh;Học kỳ;Căn cứ\nD1;00123;Trần Minh;minh@example.test;LOP-A;Lớp A;CNTT;2027;custom-term;DS-42';
  assert.deepEqual(await parseRosterUpload({ csv }), [
    {
      sourceId: 'D1',
      studentCode: '00123',
      name: 'Trần Minh',
      email: 'minh@example.test',
      classId: 'LOP-A',
      className: 'Lớp A',
      faculty: 'CNTT',
      cohortYear: '2027',
      semester: 'custom-term',
      approvalReference: 'DS-42',
    },
  ]);
});

test('roster template exposes the current catalogue without inserting sample students', async () => {
  const periods = [
    { id: 'term-extra', name: 'Học kỳ riêng', academicYear: '2028-2029', term: 3, state: 'closed' },
  ];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await makeRosterWorkbook([], periods));
  assert.deepEqual(
    book.worksheets.map((sheet) => sheet.name),
    ['Danh sach sinh vien', 'Huong dan', 'Hoc ky'],
  );
  assert.equal(book.worksheets[0].rowCount, 1);
  assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1), ROSTER_COLUMNS);
  assert.equal(book.getWorksheet('Hoc ky').getCell('A2').value, 'term-extra');
  assert.equal(book.getWorksheet('Hoc ky').getCell('E2').value, 'Đã chốt');
  assert.equal(book.worksheets[0].getColumn(2).numFmt, '@');
});

test('roster malformed uploads and missing or duplicated identity headers fail before store writes', async () => {
  for (const payload of [
    { rows: [] },
    { rows: [null] },
    { csv: 'sourceId,studentCode,name,email,classId\nA,1,T,t@example.test,C' },
    { csv: 'sourceId,studentCode,MSSV,name,email,classId,semester\nA,1,1,T,t@example.test,C,S' },
    { csv: 'sourceId,studentCode,name,email,classId,semester\n"unfinished' },
    { fileName: 'old.xls', fileBase64: 'YWJj' },
    { fileName: 'broken.xlsx', fileBase64: 'YWJj' },
  ])
    await assert.rejects(
      () => parseRosterUpload(payload),
      (error) => error.status === 400,
    );
  await assert.rejects(
    () => parseRosterUpload({ rows: Array.from({ length: 5001 }, () => sample) }),
    (error) => error.status === 400,
  );
});

test('roster formula and archive preflight use the same protections as score imports', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Roster');
  sheet.addRow(ROSTER_COLUMNS);
  sheet.addRow(ROSTER_COLUMNS.map((column) => sample[column]));
  sheet.getCell('B2').value = { formula: '12345', result: 12345 };
  const formula = Buffer.from(await book.xlsx.writeBuffer());
  await assert.rejects(
    () => parseRosterUpload({ fileName: 'formula.xlsx', fileBase64: formula.toString('base64') }),
    (error) => error.status === 400 && error.message.includes('công thức'),
  );
  await assert.rejects(
    () => parseRosterUpload({ rows: [{ ...sample, name: { formula: '"fake"', result: 'fake' } }] }),
    (error) => error.status === 400 && error.message.includes('công thức'),
  );
  const archive = await makeRosterWorkbook([sample]);
  const directory = archive.readUInt32LE(archive.length - 22 + 16);
  archive.writeUInt32LE(32 * 1024 * 1024, directory + 24);
  await assert.rejects(
    () => parseRosterUpload({ fileName: 'too-large.xlsx', fileBase64: archive.toString('base64') }),
    (error) => error.status === 400 && error.message.includes('giải nén'),
  );
});
