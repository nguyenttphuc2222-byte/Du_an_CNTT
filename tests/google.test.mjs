import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleWorkspace } from '../src/google.mjs';

const spreadsheetId = 'abcdefghijklmno123456789';
const user = {
  id: 'g001',
  email: 'student@student.tdtu.edu.vn',
  role: 'LECTURER',
  provider: 'google',
};
const headers = [
  'sourceId',
  'studentCode',
  'activityId',
  'title',
  'criterionId',
  'categoryId',
  'points',
  'date',
  'semester',
];
const grid = [
  headers,
  [
    'google-001',
    '523h0080',
    'a01',
    'Hoạt động mẫu',
    'academic_seminar',
    'academic',
    5,
    '2026-10-22',
    '2026-2027-HK1',
  ],
];
function fixture(handler, currentUser = user) {
  const calls = [];
  const auth = {
    getUser: () => currentUser,
    workspaceStatus: () => ({
      configured: true,
      connected: true,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    }),
    async googleRequest(req, url, options = {}) {
      calls.push({ url, ...options });
      return handler(url, options);
    },
  };
  const report = {
    basis: 'official',
    settings: { versionName: 'Quy chế TDTU — hiệu lực 2025–2026' },
    stats: {
      total: 1,
      hasData: 1,
      noData: 0,
      byClassification: [{ label: 'Tốt', count: 1, percentage: 100 }],
    },
    students: [
      {
        id: 's001',
        code: 'DEMO001',
        name: '=IMPORTXML("bad")',
        className: 'Demo',
        semester: '2026-2027-HK1',
        hasOfficialData: true,
        officialTotal: 80,
        pendingTotal: 5,
        projectedTotal: 85,
        officialClassification: 'Tốt',
        projectedClassification: 'Tốt',
        categoryScores: [],
      },
    ],
  };
  const store = {
    previewImport(actor, rows) {
      assert.equal(actor.id, currentUser.id);
      return {
        rows: rows.map((row, index) => ({ index, row, status: 'valid', errors: [] })),
        summary: { valid: rows.length, duplicate: 0, errors: 0 },
      };
    },
    reports: () => report,
  };
  return {
    google: createGoogleWorkspace({
      auth,
      store,
      config: { lecturerEmails: ['teacher@tdtu.edu.vn'] },
    }),
    calls,
    auth,
  };
}

test('Google Sheets URL parser rejects non-Google links without issuing API calls', async () => {
  const { google, calls } = fixture(() => {
    throw new Error('No calls expected');
  });
  for (const url of [
    'https://docs.google.com.attacker.invalid/spreadsheets/d/abcdefghijk',
    'http://docs.google.com/spreadsheets/d/abcdefghijk',
    'https://user@docs.google.com/spreadsheets/d/abcdefghijk',
    'https://docs.google.com/document/d/abcdefghijk',
    'https://docs.google.com/spreadsheets/d/short',
    '../../secrets',
  ]) {
    await assert.rejects(() => google.previewSheet({}, { url }), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test('Google Sheets preview reads bounded range and normalizes Vietnamese-compatible grid', async () => {
  const { google, calls } = fixture((url) =>
    url.includes('/values/')
      ? { values: grid }
      : {
          properties: { title: 'Điểm khoa' },
          sheets: [{ properties: { title: "Dữ liệu 'A'", index: 0 } }],
        },
  );
  const result = await google.previewSheet(
    {},
    { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0` },
  );
  assert.equal(result.summary.valid, 1);
  assert.equal(result.importRows[0].studentCode, '523h0080');
  assert.equal(result.importRows[0].points, '5');
  assert.equal(result.source.name, 'Điểm khoa');
  assert.match(decodeURIComponent(calls[1].url), /A1:AN5002/);
  assert.match(result.source.range, /^'Dữ liệu ''A'''!/);
});

test('Google Sheets preview enforces 5000-row ceiling and lecturer role', async () => {
  const { google } = fixture((url) =>
    url.includes('/values/')
      ? { values: Array.from({ length: 5002 }, () => ['data']) }
      : { sheets: [{ properties: { title: 'Data' } }] },
  );
  await assert.rejects(() => google.previewSheet({}, { spreadsheetId }), { status: 400 });
  const student = fixture(
    () => {
      throw new Error('No calls expected');
    },
    { ...user, role: 'STUDENT' },
  );
  await assert.rejects(() => student.google.previewSheet({}, { spreadsheetId }), { status: 403 });
  await assert.rejects(() => student.google.exportReport({}, {}), { status: 403 });
  assert.equal(student.calls.length, 0);
});

test('Google report creates private Sheet and writes values with RAW to avoid formula evaluation', async () => {
  const { google, calls } = fixture((url, options) =>
    url.endsWith('/values:batchUpdate') ? { totalUpdatedCells: 30 } : { spreadsheetId },
  );
  const result = await google.exportReport({}, { basis: 'official' });
  assert.equal(result.id, spreadsheetId);
  assert.match(result.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\//);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.sheets.length, 3);
  assert.equal(calls[1].body.valueInputOption, 'RAW');
  assert.equal(calls[1].body.data[0].values[1][1], '=IMPORTXML("bad")');
  assert.equal(
    calls.some((call) => call.url.includes('permissions')),
    false,
  );
});

test('Google file listing stays bounded and requests spreadsheet MIME type', async () => {
  const { google, calls } = fixture(() => ({
    files: [{ id: spreadsheetId, name: 'Bảng mẫu', modifiedTime: '2026-10-23T10:00:00Z' }],
  }));
  const result = await google.listFiles({});
  assert.equal(result.files[0].name, 'Bảng mẫu');
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('pageSize'), '30');
  assert.match(url.searchParams.get('q'), /application\/vnd\.google-apps\.spreadsheet/);
});

test('Drive evidence validates signature, uploads binary multipart and shares only with configured lecturers', async () => {
  const { google, calls } = fixture((url) =>
    url.includes('/permissions')
      ? { id: 'permission-id' }
      : { id: spreadsheetId, name: 'evidence.pdf' },
  );
  await assert.rejects(
    () =>
      google.uploadEvidence(
        {},
        {
          mimeType: 'application/pdf',
          fileBase64: Buffer.from('<html>bad</html>').toString('base64'),
        },
      ),
    { status: 400 },
  );
  await assert.rejects(
    () => google.uploadEvidence({}, { mimeType: 'text/html', fileBase64: 'YXNk' }),
    { status: 400 },
  );
  assert.equal(calls.length, 0);
  const result = await google.uploadEvidence(
    {},
    {
      fileName: '../../evidence.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('%PDF-1.7\nDemo evidence').toString('base64'),
    },
  );
  assert.equal(result.name, 'evidence.pdf');
  assert.deepEqual(result.sharedWith, ['teacher@tdtu.edu.vn']);
  assert.equal(calls.length, 2);
  assert(Buffer.isBuffer(calls[0].body));
  assert.match(calls[0].headers['Content-Type'], /^multipart\/related; boundary=tdtu_/);
  assert.match(calls[1].url, /sendNotificationEmail=false/);
  assert.deepEqual(calls[1].body, {
    type: 'user',
    role: 'reader',
    emailAddress: 'teacher@tdtu.edu.vn',
  });
});

test('Drive evidence keeps uploaded file and returns explicit warning if lecturer sharing fails', async () => {
  const { google } = fixture((url) => {
    if (url.includes('/permissions')) throw new Error('Denied by Workspace policy');
    return { id: spreadsheetId, name: 'evidence.pdf' };
  });
  const result = await google.uploadEvidence(
    {},
    {
      fileName: 'evidence.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('%PDF-1.7\nDemo').toString('base64'),
    },
  );
  assert.deepEqual(result.sharedWith, []);
  assert.deepEqual(result.shareErrors, ['teacher@tdtu.edu.vn']);
  assert.match(result.warning, /chưa chia sẻ/);
});
