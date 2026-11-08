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
    beginEvidence: (actor, payload) => ({
      evidence: { ...payload, id: 'evidence-test', ownerUserId: actor.id, state: 'uploading' },
    }),
    finishEvidence: (actor, id, result) => ({
      evidence: {
        ...result,
        fileId: result.id,
        id,
        state: result.sharingComplete ? 'shared' : 'sharing_failed',
      },
    }),
    failEvidence: (actor, id, result) => ({
      evidence: { id, state: 'failed', error: result.message },
    }),
    prepareEvidenceRetry: () => ({
      evidence: { id: 'evidence-test', fileId: spreadsheetId, fileName: 'evidence.pdf' },
      recipients: {
        emails: ['teacher@tdtu.edu.vn'],
        semester: '2026-2027-HK1',
        studentId: 's001',
        purpose: 'claim',
      },
    }),
    evidenceRecipients: () => ({
      emails: ['teacher@tdtu.edu.vn'],
      semester: '2026-2027-HK1',
      studentId: 's001',
    }),
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
    store,
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

test('Drive evidence validates signature, uploads binary multipart and shares only with current assigned recipients', async () => {
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
  assert.equal(result.sharingComplete, true);
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

const evidencePayload = {
  semester: '2026-2027-HK1',
  studentId: 's001',
  fileName: 'evidence.pdf',
  mimeType: 'application/pdf',
  fileBase64: Buffer.from('%PDF-1.7\nMock evidence').toString('base64'),
};

test('Drive upload rechecks recipients after upload and does not grant a revoked lecturer', async () => {
  let recipients = ['old-teacher@tdtu.edu.vn'];
  const { google, calls, store } = fixture((url) => {
    if (url.includes('/upload/')) {
      recipients = ['new-teacher@tdtu.edu.vn'];
      return { id: spreadsheetId, name: 'evidence.pdf' };
    }
    return { id: 'new-permission-id' };
  });
  store.evidenceRecipients = (actor, context) => ({
    emails: recipients,
    semester: context.semester,
    studentId: context.studentId,
  });
  const result = await google.uploadEvidence({}, evidencePayload);
  const grants = calls.filter(
    (call) => call.method === 'POST' && call.url.includes('/permissions'),
  );
  assert.deepEqual(
    grants.map((call) => call.body.emailAddress),
    ['new-teacher@tdtu.edu.vn'],
  );
  assert.deepEqual(result.sharedWith, ['new-teacher@tdtu.edu.vn']);
  assert.equal(result.scopeChanged, true);
  assert.equal(result.sharingComplete, true);
});

test('Drive lifecycle records actual file metadata before upload and records a failed attempt without pretending completion', async () => {
  const { google, store } = fixture(() => {
    throw Object.assign(new Error('Upload denied'), { status: 403 });
  });
  const begun = [],
    failed = [];
  store.beginEvidence = (actor, payload) => {
    begun.push(payload);
    return { evidence: { id: 'persisted-attempt' } };
  };
  store.failEvidence = (actor, id, result) => {
    failed.push({ id, result });
    return { evidence: { id, state: 'failed' } };
  };
  await assert.rejects(() => google.uploadEvidence({}, evidencePayload), { status: 403 });
  assert.equal(begun.length, 1);
  assert.equal(begun[0].size, Buffer.from(evidencePayload.fileBase64, 'base64').length);
  assert.match(begun[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(failed[0].id, 'persisted-attempt');
  assert.equal(failed[0].result.message, 'Upload denied');
});

test('Drive sharing retry uses the existing owned file and preserves appeal context across checks', async () => {
  const { google, store, calls } = fixture((url, options) =>
    !options.method ? { permissions: [] } : { id: 'permission-retry' },
  );
  const contexts = [];
  store.prepareEvidenceRetry = () => ({
    evidence: { id: 'appeal-evidence', fileId: spreadsheetId, fileName: 'appeal.pdf' },
    recipients: {
      semester: 'custom-term',
      studentId: 's001',
      purpose: 'appeal',
      appealId: 'appeal-1',
      emails: ['teacher@tdtu.edu.vn'],
    },
  });
  store.evidenceRecipients = (actor, context) => {
    contexts.push(context);
    return { ...context, emails: ['teacher@tdtu.edu.vn'] };
  };
  const result = await google.retryEvidence({}, 'appeal-evidence');
  assert.equal(result.evidenceId, 'appeal-evidence');
  assert.equal(result.sharingComplete, true);
  assert.equal(
    calls.some((call) => call.url.includes('/upload/')),
    false,
  );
  assert.ok(contexts.length >= 2);
  assert.ok(
    contexts.every(
      (context) =>
        context.purpose === 'appeal' &&
        context.appealId === 'appeal-1' &&
        context.semester === 'custom-term',
    ),
  );
});

test('Drive sharing retry rejects a non-owner or disconnected session before remote permission changes', async () => {
  const { google, store, auth, calls } = fixture(() => {
    throw new Error('No remote calls expected');
  });
  store.prepareEvidenceRetry = () => {
    throw Object.assign(new Error('Only owner may retry'), { status: 403 });
  };
  await assert.rejects(() => google.retryEvidence({}, 'other-owner-file'), { status: 403 });
  auth.workspaceStatus = () => ({ connected: false });
  await assert.rejects(() => google.uploadEvidence({}, evidencePayload), { status: 403 });
  await assert.rejects(() => google.retryEvidence({}, 'any-file'), { status: 403 });
  assert.equal(calls.length, 0);
});

test('Drive retry verifies existing rights and does not recreate or delete a historical grant', async () => {
  const { google, calls } = fixture((url, options) => {
    if (!options.method)
      return {
        permissions: [
          {
            id: 'historical-permission',
            type: 'user',
            emailAddress: 'teacher@tdtu.edu.vn',
            role: 'reader',
          },
        ],
      };
    throw new Error('Historical grant must not be changed');
  });
  const result = await google.retryEvidence({}, 'evidence-test');
  assert.equal(result.sharingComplete, true);
  assert.deepEqual(result.sharedWith, ['teacher@tdtu.edu.vn']);
  assert.equal(calls.length, 1);
});

test('Drive retry never cleans up a permission known to predate the retry even if Google returns its ID', async () => {
  let recipients = ['teacher@tdtu.edu.vn'];
  const { google, store, calls } = fixture((url, options) => {
    if (!options.method)
      return { permissions: [{ id: 'historical-permission', type: 'user', role: 'reader' }] };
    if (options.method === 'POST') {
      recipients = [];
      return { id: 'historical-permission' };
    }
    throw new Error('Must not delete historical permissions');
  });
  store.evidenceRecipients = (actor, context) => ({ ...context, emails: recipients });
  const result = await google.retryEvidence({}, 'evidence-test');
  assert.equal(result.sharingComplete, false);
  assert.equal(
    calls.some((call) => call.method === 'DELETE'),
    false,
  );
  assert.deepEqual(result.cleanupErrors, ['teacher@tdtu.edu.vn']);
});

test('Drive retry refuses to mutate permissions when current rights cannot be verified', async () => {
  const { google, calls } = fixture(() => ({ unexpected: 'not a permission list' }));
  await assert.rejects(() => google.retryEvidence({}, 'evidence-test'), { status: 502 });
  assert.equal(calls.length, 1);
  assert.equal(
    calls.some((call) => call.method === 'POST'),
    false,
  );
});

test('Drive owner synchronization removes obsolete app-managed grants and leaves manual permissions unchanged', async () => {
  const { google, store, calls } = fixture((url, options) => {
    if (!options.method)
      return {
        permissions: [
          {
            id: 'managed-old',
            type: 'user',
            role: 'reader',
            emailAddress: 'old-teacher@tdtu.edu.vn',
          },
          { id: 'manual-right', type: 'user', role: 'writer', emailAddress: 'manual@example.test' },
        ],
      };
    if (options.method === 'DELETE') return undefined;
    return { id: 'managed-new' };
  });
  const prepare = store.prepareEvidenceRetry;
  store.prepareEvidenceRetry = () => {
    const result = prepare();
    result.evidence.managedPermissions = [{ id: 'managed-old', email: 'old-teacher@tdtu.edu.vn' }];
    return result;
  };
  const result = await google.retryEvidence({}, 'evidence-test');
  assert.equal(result.sharingComplete, true);
  assert.deepEqual(result.revokedManagedShares, ['old-teacher@tdtu.edu.vn']);
  assert.deepEqual(result.managedPermissions, [
    { id: 'managed-new', email: 'teacher@tdtu.edu.vn' },
  ]);
  assert.deepEqual(
    calls.filter((call) => call.method === 'DELETE').map((call) => call.url),
    [`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions/managed-old`],
  );
});

test('Drive synchronization keeps a visible incomplete state if an obsolete managed grant cannot be revoked', async () => {
  const { google, store } = fixture((url, options) => {
    if (!options.method)
      return {
        permissions: [
          {
            id: 'managed-old',
            type: 'user',
            role: 'reader',
            emailAddress: 'old-teacher@tdtu.edu.vn',
          },
        ],
      };
    if (options.method === 'DELETE') throw new Error('Google denies removal');
    return { id: 'managed-new' };
  });
  const prepare = store.prepareEvidenceRetry;
  store.prepareEvidenceRetry = () => {
    const result = prepare();
    result.evidence.managedPermissions = [{ id: 'managed-old', email: 'old-teacher@tdtu.edu.vn' }];
    return result;
  };
  const result = await google.retryEvidence({}, 'evidence-test');
  assert.equal(result.sharingComplete, false);
  assert.ok(result.managedPermissions.some((permission) => permission.id === 'managed-old'));
  assert.ok(result.cleanupErrors.includes('old-teacher@tdtu.edu.vn'));
  assert.match(result.warning, /Chưa đồng bộ/);
});

test('Drive upload keeps a private file and warns when term closes or actor scope expires during upload', async () => {
  for (const status of [403, 409]) {
    let stillAllowed = true;
    const { google, calls, store } = fixture((url) => {
      if (url.includes('/upload/')) stillAllowed = false;
      return { id: spreadsheetId, name: 'evidence.pdf' };
    });
    store.evidenceRecipients = (actor, context) => {
      if (!stillAllowed) throw Object.assign(new Error('Scope/window changed'), { status });
      return {
        emails: ['teacher@tdtu.edu.vn'],
        semester: context.semester,
        studentId: context.studentId,
      };
    };
    const result = await google.uploadEvidence({}, evidencePayload);
    assert.equal(result.id, spreadsheetId);
    assert.deepEqual(result.sharedWith, []);
    assert.equal(result.sharingComplete, false);
    assert.equal(result.scopeChanged, true);
    assert.match(result.warning, /Đã dừng chia sẻ/);
    assert.equal(calls.length, 1, 'No permission request after scope/term becomes invalid');
  }
});

test('Drive sharing rolls back only its new permission if assignment changes while permission POST is pending', async () => {
  let recipients = ['teacher@tdtu.edu.vn'];
  const { google, calls, store } = fixture((url, options) => {
    if (url.includes('/permissions?') && options.method === 'POST') {
      recipients = [];
      return { id: 'just-created-permission' };
    }
    if (options.method === 'DELETE') return undefined;
    return { id: spreadsheetId, name: 'evidence.pdf' };
  });
  store.evidenceRecipients = (actor, context) => ({
    emails: recipients,
    semester: context.semester,
    studentId: context.studentId,
  });
  const result = await google.uploadEvidence({}, evidencePayload);
  const deletions = calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(
    deletions.map((call) => call.url),
    [
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions/just-created-permission`,
    ],
  );
  assert.deepEqual(result.sharedWith, []);
  assert.deepEqual(result.revokedShares, ['teacher@tdtu.edu.vn']);
  assert.equal(result.sharingComplete, false);
  assert.match(result.warning, /Đã thu hồi/);
});

test('Drive sharing warns about unconfirmed cleanup and never claims completion after rollback failure', async () => {
  let recipients = ['teacher@tdtu.edu.vn'];
  const { google, calls, store } = fixture((url, options) => {
    if (url.includes('/permissions?') && options.method === 'POST') {
      recipients = [];
      return { id: 'new-permission' };
    }
    if (options.method === 'DELETE') throw new Error('Owner must remove permission manually');
    return { id: spreadsheetId, name: 'evidence.pdf' };
  });
  store.evidenceRecipients = (actor, context) => ({
    emails: recipients,
    semester: context.semester,
    studentId: context.studentId,
  });
  const result = await google.uploadEvidence({}, evidencePayload);
  assert.equal(result.id, spreadsheetId);
  assert.deepEqual(result.cleanupErrors, ['teacher@tdtu.edu.vn']);
  assert.equal(result.sharingComplete, false);
  assert.match(result.warning, /thu hồi trực tiếp/);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1);
});

test('Drive sharing rechecks earlier grants when a later recipient request changes the assignment', async () => {
  let recipients = ['first@tdtu.edu.vn', 'second@tdtu.edu.vn'];
  const { google, calls, store } = fixture((url, options) => {
    if (options.method === 'POST' && url.includes('/permissions?')) {
      if (options.body.emailAddress === 'second@tdtu.edu.vn') recipients = ['second@tdtu.edu.vn'];
      return {
        id:
          options.body.emailAddress === 'first@tdtu.edu.vn'
            ? 'permission-first'
            : 'permission-second',
      };
    }
    if (options.method === 'DELETE') return undefined;
    return { id: spreadsheetId, name: 'evidence.pdf' };
  });
  store.evidenceRecipients = (actor, context) => ({
    emails: recipients,
    semester: context.semester,
    studentId: context.studentId,
  });
  const result = await google.uploadEvidence({}, evidencePayload);
  assert.deepEqual(result.sharedWith, ['second@tdtu.edu.vn']);
  assert.deepEqual(result.revokedShares, ['first@tdtu.edu.vn']);
  assert.deepEqual(
    calls.filter((call) => call.method === 'DELETE').map((call) => call.url),
    [`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions/permission-first`],
  );
  assert.equal(result.sharingComplete, true);
});
