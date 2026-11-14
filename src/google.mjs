import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseCsv, reportRows } from './files.mjs';
import { parseRosterGrid } from './roster-files.mjs';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const ROSTER_PREVIEW_TTL = 15 * 60 * 1000;
const ROSTER_SHEET_MAX_BYTES = 8 * 1024 * 1024;
const ROSTER_SHEET_MAX_ROWS = 5001; // Header and up to 5,000 records.
const ROSTER_SHEET_MAX_COLUMNS = 40;
function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
function sheetId(payload) {
  const value = payload?.spreadsheetId || payload?.url || payload?.spreadsheetUrl;
  if (typeof value !== 'string') throw fail(400, 'Hãy nhập đường dẫn hoặc mã Google Sheets.');
  let id = value.trim();
  if (/^https?:/i.test(id)) {
    let url;
    try {
      url = new URL(id);
    } catch {
      throw fail(400, 'Đường dẫn Google Sheets không hợp lệ.');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'docs.google.com' ||
      url.username ||
      url.password ||
      url.port
    )
      throw fail(400, 'Chỉ chấp nhận liên kết Google Sheets tại docs.google.com.');
    id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw fail(400, 'Mã Google Sheets không hợp lệ.');
  return id;
}
function sheetUrl(id) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
function quoteSheet(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}
function gridCsv(grid) {
  return grid
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
}

function rosterSheetSelection(payload) {
  const id = sheetId(payload);
  const sheetName = typeof payload.sheetName === 'string' ? payload.sheetName : '';
  if (sheetName.length > 100) throw fail(400, 'Tên trang tính vượt quá 100 ký tự.');
  const link = payload.spreadsheetId || payload.url || payload.spreadsheetUrl;
  if (sheetName.trim() || !/^https:/i.test(link.trim()))
    return { id, sheetName: sheetName.trim() ? sheetName : '' };
  const url = new URL(link.trim());
  const queryGid = url.searchParams.get('gid');
  const fragmentGid = new URLSearchParams(url.hash.slice(1)).get('gid');
  const gid = fragmentGid ?? queryGid;
  if (gid === null) return { id };
  if (
    !/^\d{1,10}$/.test(gid) ||
    Number(gid) > 2147483647 ||
    (queryGid !== null && fragmentGid !== null && queryGid !== fragmentGid)
  )
    throw fail(400, 'Mã trang tính trong liên kết Google Sheets không hợp lệ.');
  return { id, gid: Number(gid) };
}

function rosterGridFromSheet(sheet) {
  const grid = [];
  for (const block of sheet.data || []) {
    const startRow = block.startRow ?? 0;
    const startColumn = block.startColumn ?? 0;
    for (const [rowOffset, row] of (block.rowData || []).entries()) {
      const rowIndex = startRow + rowOffset;
      for (const [columnOffset, cell] of (row.values || []).entries()) {
        const entered = cell.userEnteredValue || {};
        const columnIndex = startColumn + columnOffset;
        if (Object.hasOwn(entered, 'formulaValue'))
          throw fail(
            400,
            `Dòng ${rowIndex + 1}, cột ${columnIndex + 1} có công thức. Hãy dán dưới dạng giá trị.`,
          );
        const value =
          cell.formattedValue ?? entered.stringValue ?? entered.numberValue ?? entered.boolValue;
        if (value === undefined || String(value).trim() === '') continue;
        if (rowIndex >= ROSTER_SHEET_MAX_ROWS || columnIndex >= ROSTER_SHEET_MAX_COLUMNS)
          throw fail(
            400,
            `Dòng ${rowIndex + 1}, cột ${columnIndex + 1} vượt phạm vi nhập. Hãy để tiêu đề và tối đa 5.000 dòng dữ liệu trong 5.001 dòng đầu và 40 cột đầu.`,
          );
        grid[rowIndex] ??= [];
        grid[rowIndex][columnIndex] = value;
      }
    }
  }
  return Array.from(grid, (row) => row || []);
}

function staleRosterPreview() {
  return fail(409, 'Bản xem trước đã hết hạn hoặc dữ liệu đã thay đổi. Hãy xem trước lại.');
}

export function createGoogleWorkspace({ auth, store, config = {} }) {
  // Like the session and Workspace grant, the signed preview is scoped to this server run.
  const rosterPreviewKey = randomBytes(32);
  const signRosterPreview = (encoded) =>
    createHmac('sha256', rosterPreviewKey).update(encoded).digest('base64url');
  const rosterDigest = (loaded, preview) =>
    createHash('sha256')
      .update(JSON.stringify([loaded, preview]))
      .digest('base64url');
  function userFor(req) {
    const user = auth.getUser(req);
    if (!user) throw fail(401, 'Vui lòng đăng nhập.');
    return user;
  }
  function lecturerFor(req) {
    const user = userFor(req);
    if (user.role !== 'LECTURER') throw fail(403, 'Chức năng này chỉ dành cho giảng viên.');
    return user;
  }
  function status(req) {
    return auth.workspaceStatus(req);
  }
  async function listFiles(req) {
    userFor(req);
    const url = new URL(DRIVE);
    url.searchParams.set(
      'q',
      "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'",
    );
    url.searchParams.set('pageSize', '30');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)');
    const result = await auth.googleRequest(req, url.href);
    return {
      files: (result.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime,
        url: sheetUrl(file.id),
      })),
    };
  }
  async function previewSheet(req, payload = {}) {
    const user = lecturerFor(req),
      id = sheetId(payload);
    const metadataUrl = new URL(`${SHEETS}/${id}`);
    metadataUrl.searchParams.set(
      'fields',
      'spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties))',
    );
    const metadata = await auth.googleRequest(req, metadataUrl.href);
    const sheets = [...(metadata.sheets || [])].sort(
      (a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0),
    );
    const requestedName = typeof payload.sheetName === 'string' ? payload.sheetName.trim() : '';
    const sheet = requestedName
      ? sheets.find((item) => item.properties?.title === requestedName)
      : sheets[0];
    if (!sheet?.properties?.title)
      throw fail(
        400,
        requestedName ? 'Không tìm thấy trang tính đã chọn.' : 'Google Sheets chưa có trang tính.',
      );
    const range = `${quoteSheet(sheet.properties.title)}!A1:AN5002`;
    const valuesUrl = new URL(`${SHEETS}/${id}/values/${encodeURIComponent(range)}`);
    valuesUrl.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
    const data = await auth.googleRequest(req, valuesUrl.href);
    const grid = data.values || [];
    if (grid.length > 5001 || grid.some((row) => row.length > 40))
      throw fail(400, 'Mỗi lần đọc tối đa 5.000 dòng dữ liệu và 40 cột. Hãy tách bảng dữ liệu.');
    const importRows = parseCsv(gridCsv(grid));
    const preview = store.previewImport(user, importRows);
    return {
      ...preview,
      importRows,
      source: {
        id,
        name: metadata.properties?.title || id,
        sheetName: sheet.properties.title,
        range,
        url: sheetUrl(id),
      },
    };
  }
  function rosterCoordinator(req) {
    const user = lecturerFor(req);
    if (!store.access(user).isCoordinator)
      throw fail(403, 'Chức năng này dành cho điều phối viên được cấu hình trên máy chủ.');
    return user;
  }
  function rosterSemester(user, payload) {
    const semester = typeof payload.semester === 'string' ? payload.semester.trim() : '';
    if (!semester || semester.length > 100) throw fail(400, 'Hãy chọn học kỳ nhận danh sách.');
    const period = store.listSemesters(user).semesters.find((item) => item.id === semester);
    if (!period) throw fail(400, 'Học kỳ không nằm trong danh mục được cấu hình.');
    if (period.state === 'closed')
      throw fail(409, `Học kỳ ${semester} đã chốt và khóa. Cần mở lại trước khi thay đổi.`);
    return semester;
  }
  async function readRosterSheet(req, selection) {
    const { id, sheetName, gid } = selection;
    const url = new URL(`${SHEETS}/${id}`);
    url.searchParams.set(
      'fields',
      'properties(title),sheets(properties(sheetId,title,index,hidden,sheetType))',
    );
    const options = { maxContentLength: ROSTER_SHEET_MAX_BYTES };
    const metadata = await auth.googleRequest(req, url.href, options);
    const tabs = (metadata?.sheets || []).map((item) => item.properties).filter(Boolean);
    const tab = sheetName
      ? tabs.find((item) => item.title === sheetName)
      : gid !== undefined
        ? tabs.find((item) => item.sheetId === gid)
        : tabs
            .filter((item) => !item.hidden && (!item.sheetType || item.sheetType === 'GRID'))
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
    if (!tab?.title || !Number.isInteger(tab.sheetId))
      throw fail(400, 'Không tìm thấy trang tính. Hãy kiểm tra liên kết hoặc tên trang tính.');
    if (tab.sheetType && tab.sheetType !== 'GRID')
      throw fail(400, 'Hãy chọn trang tính thông thường có dữ liệu danh sách theo mẫu.');

    // Read the whole selected tab with a response cap so data beyond the supported
    // rows or columns is rejected rather than being silently left out of the batch.
    const range = quoteSheet(tab.title);
    url.searchParams.set('ranges', range);
    url.searchParams.set(
      'fields',
      'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue))))',
    );
    const result = await auth.googleRequest(req, url.href, options);
    const sheet = result?.sheets?.find((item) => item.properties?.sheetId === tab.sheetId);
    if (sheet?.properties?.title !== tab.title)
      throw fail(409, 'Trang tính đã thay đổi trong lúc đọc. Hãy xem trước lại.');
    const { rows, sheetRows } = parseRosterGrid(rosterGridFromSheet(sheet));
    const source = {
      id,
      name: metadata.properties?.title || id,
      sheetId: tab.sheetId,
      sheetName: tab.title,
      range,
      url: `${sheetUrl(id)}#gid=${tab.sheetId}`,
    };
    return { rows, sheetRows, source };
  }
  async function previewRosterSheet(req, payload = {}) {
    const user = rosterCoordinator(req);
    const semester = rosterSemester(user, payload);
    const selection = rosterSheetSelection(payload);
    const loaded = await readRosterSheet(req, selection);
    const currentUser = rosterCoordinator(req);
    if (currentUser.id !== user.id) throw fail(403, 'Phiên đăng nhập đã thay đổi.');
    const { rows, sheetRows, source } = loaded;
    const preview = store.previewRoster(currentUser, rows, { semester, sheetRows });
    let previewToken = null;
    if (!preview.summary.errors) {
      const encoded = Buffer.from(
        JSON.stringify({
          userId: user.id,
          semester,
          id: source.id,
          expiresAt: Date.now() + ROSTER_PREVIEW_TTL,
          digest: rosterDigest(loaded, preview),
        }),
      ).toString('base64url');
      previewToken = `${encoded}.${signRosterPreview(encoded)}`;
    }
    return { ...preview, source, previewToken };
  }
  async function commitRosterSheet(req, payload = {}) {
    const user = rosterCoordinator(req);
    const semester = rosterSemester(user, payload);
    const selection = rosterSheetSelection(payload);
    const token = typeof payload.previewToken === 'string' ? payload.previewToken : '';
    if (!/^[A-Za-z0-9_-]{1,1536}\.[A-Za-z0-9_-]{43}$/.test(token)) throw staleRosterPreview();
    const [encoded, signature] = token.split('.');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(signRosterPreview(encoded))))
      throw staleRosterPreview();
    const expected = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      expected.userId !== user.id ||
      expected.semester !== semester ||
      expected.id !== selection.id ||
      expected.expiresAt <= Date.now()
    )
      throw staleRosterPreview();

    let loaded;
    try {
      loaded = await readRosterSheet(req, selection);
    } catch (error) {
      if (error.status === 400) throw staleRosterPreview();
      throw error;
    }
    const currentUser = rosterCoordinator(req);
    if (currentUser.id !== user.id) throw fail(403, 'Phiên đăng nhập đã thay đổi.');
    const { rows, sheetRows, source } = loaded;
    const preview = store.previewRoster(currentUser, rows, { semester, sheetRows });
    if (
      expected.expiresAt <= Date.now() ||
      preview.summary.errors ||
      rosterDigest(loaded, preview) !== expected.digest
    )
      throw staleRosterPreview();
    return store.commitRoster(currentUser, {
      rows,
      semester,
      sheetRows,
      source,
      expectedPreview: preview,
      batchName: payload.batchName || source.name,
      reason: payload.reason,
    });
  }
  async function exportReport(req, filters = {}) {
    const user = lecturerFor(req),
      report = store.reports(user, filters),
      rows = reportRows(report);
    const columns = rows.length
      ? Object.keys(rows[0])
      : ['MSSV', 'Họ tên', 'Lớp', 'Điểm chính thức', 'Điểm dự kiến'];
    const name = `Báo cáo điểm rèn luyện - ${new Date().toISOString().slice(0, 10)}`;
    const created = await auth.googleRequest(req, SHEETS, {
      method: 'POST',
      body: {
        properties: { title: name },
        sheets: ['Sinh viên', 'Thống kê', 'Thông tin'].map((title) => ({
          properties: { title, gridProperties: { frozenRowCount: 1 } },
        })),
      },
    });
    const id = created.spreadsheetId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(id))
      throw fail(502, 'Google chưa trả về mã bảng tính hợp lệ.');
    const details = [
      ['Thông tin', 'Giá trị'],
      ['Cơ sở thống kê', report.basis === 'projected' ? 'Điểm dự kiến' : 'Điểm chính thức'],
      ['Tổng sinh viên', report.stats.total],
      ['Có dữ liệu', report.stats.hasData],
      ['Chưa có dữ liệu', report.stats.noData],
      ['Quy tắc', report.settings.versionName],
      [
        'Lưu ý',
        'Dữ liệu demo; chấm theo PDF TDTU được cung cấp, hiệu lực 2025–2026. Điểm cũ chưa đối chiếu không được cộng. Tệp được lưu riêng tư trong Google Drive của người tạo.',
      ],
    ];
    await auth.googleRequest(req, `${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: [
          {
            range: "'Sinh viên'!A1",
            values: [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))],
          },
          {
            range: "'Thống kê'!A1",
            values: [
              ['Xếp loại', 'Số lượng', 'Tỷ lệ phần trăm'],
              ...report.stats.byClassification.map((item) => [
                item.label,
                item.count,
                item.percentage,
              ]),
            ],
          },
          { range: "'Thông tin'!A1", values: details },
        ],
      },
    });
    return { id, url: sheetUrl(id), name };
  }
  async function uploadEvidence(req, payload = {}) {
    const uploadingUser = userFor(req);
    if (!auth.workspaceStatus(req).connected)
      throw fail(
        403,
        'Hãy kết nối Google Workspace bằng tài khoản sở hữu tệp trước khi tải minh chứng.',
      );
    const recipients = store.evidenceRecipients(uploadingUser, {
      semester: payload.semester,
      studentId: payload.studentId,
      purpose: payload.purpose || 'claim',
      appealId: payload.appealId,
    });
    const types = {
      'application/pdf': 'pdf',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const mimeType = payload.mimeType;
    if (!Object.hasOwn(types, mimeType))
      throw fail(400, 'Minh chứng chỉ nhận PDF, PNG, JPEG hoặc WEBP.');
    if (
      typeof payload.fileBase64 !== 'string' ||
      payload.fileBase64.length > 7 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.fileBase64)
    )
      throw fail(400, 'Tệp minh chứng không hợp lệ hoặc vượt quá 5 MB.');
    const buffer = Buffer.from(payload.fileBase64, 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024)
      throw fail(400, 'Tệp minh chứng rỗng hoặc vượt quá 5 MB.');
    const validSignature =
      mimeType === 'application/pdf'
        ? buffer.subarray(0, 5).toString() === '%PDF-'
        : mimeType === 'image/png'
          ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mimeType === 'image/jpeg'
            ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : buffer.subarray(0, 4).toString() === 'RIFF' &&
              buffer.subarray(8, 12).toString() === 'WEBP';
    if (!validSignature) throw fail(400, 'Nội dung tệp không khớp định dạng minh chứng đã chọn.');
    const name =
      String(payload.fileName || `minh-chung.${types[mimeType]}`)
        .split(/[\\/]/)
        .pop()
        .replace(/[\x00-\x1f]/g, '')
        .slice(0, 150) || `minh-chung.${types[mimeType]}`;
    const boundary = `tdtu_${randomBytes(18).toString('hex')}`;
    const metadata = JSON.stringify({
      name,
      mimeType,
      description: 'Minh chứng kê khai điểm rèn luyện; do người dùng chủ động tải lên.',
    });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const tracked = store.beginEvidence(uploadingUser, {
      semester: recipients.semester,
      studentId: recipients.studentId,
      purpose: payload.purpose || 'claim',
      appealId: payload.appealId,
      fileName: name,
      mimeType,
      size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }).evidence;
    let created;
    try {
      created = await auth.googleRequest(
        req,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          body,
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        },
      );
      if (!created.id || !/^[A-Za-z0-9_-]{10,200}$/.test(created.id))
        throw fail(502, 'Google chưa trả về mã minh chứng hợp lệ.');
    } catch (cause) {
      store.failEvidence(uploadingUser, tracked.id, { message: cause.message });
      throw cause;
    }
    const result = await shareEvidence(
      req,
      uploadingUser,
      {
        ...recipients,
        purpose: payload.purpose || 'claim',
        ...(payload.appealId ? { appealId: payload.appealId } : {}),
      },
      created,
    );
    const saved = store.finishEvidence(uploadingUser, tracked.id, result);
    return { ...result, evidenceId: tracked.id, evidence: saved.evidence };
  }
  async function retryEvidence(req, evidenceId) {
    const user = userFor(req);
    if (!auth.workspaceStatus(req).connected)
      throw fail(403, 'Hãy kết nối Google Workspace bằng tài khoản đã tải tệp để thử chia sẻ lại.');
    const prepared = store.prepareEvidenceRetry(user, evidenceId);
    try {
      const fileId = prepared.evidence.fileId;
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId || ''))
        throw fail(409, 'Tệp chưa được tải thành công; hãy chọn và tải lại tệp nguồn.');
      const permissions = [];
      let pageToken = '';
      for (let page = 0; page < 10; page++) {
        const url = new URL(`${DRIVE}/${fileId}/permissions`);
        url.searchParams.set('fields', 'permissions(id,type,emailAddress,role),nextPageToken');
        url.searchParams.set('pageSize', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const data = await auth.googleRequest(req, url.href);
        if (!Array.isArray(data?.permissions))
          throw fail(502, 'Chưa đọc được quyền hiện tại của tệp; chưa thay đổi chia sẻ.');
        permissions.push(...data.permissions);
        pageToken = data.nextPageToken || '';
        if (!pageToken) break;
      }
      if (pageToken)
        throw fail(409, 'Danh sách quyền tệp vượt giới hạn kiểm tra; chưa thay đổi chia sẻ.');
      const managed = Array.isArray(prepared.evidence.managedPermissions)
        ? prepared.evidence.managedPermissions
        : [];
      const syncErrors = [];
      const removedManaged = [];
      const retainedManaged = [];
      for (const permission of managed) {
        const actual = permissions.find((item) => item.id === permission.id);
        if (!actual) continue;
        const current = store.evidenceRecipients(userFor(req), prepared.recipients);
        if (
          current.emails.some((email) => email.toLowerCase() === permission.email.toLowerCase())
        ) {
          retainedManaged.push(permission);
          continue;
        }
        if (
          actual.type !== 'user' ||
          actual.role !== 'reader' ||
          String(actual.emailAddress || '').toLowerCase() !== permission.email.toLowerCase()
        ) {
          syncErrors.push(permission.email);
          retainedManaged.push(permission);
          continue;
        }
        try {
          await auth.googleRequest(
            req,
            `${DRIVE}/${fileId}/permissions/${encodeURIComponent(permission.id)}`,
            { method: 'DELETE' },
          );
          removedManaged.push(permission.email);
          permissions.splice(permissions.indexOf(actual), 1);
        } catch {
          syncErrors.push(permission.email);
          retainedManaged.push(permission);
        }
      }
      const result = await shareEvidence(
        req,
        user,
        prepared.recipients,
        {
          id: fileId,
          name: prepared.evidence.fileName || prepared.evidence.name || 'Minh chứng',
        },
        permissions,
      );
      result.managedPermissions = [
        ...new Map(
          [...retainedManaged, ...result.managedPermissions].map((permission) => [
            permission.id,
            permission,
          ]),
        ).values(),
      ];
      if (removedManaged.length) result.revokedManagedShares = removedManaged;
      if (syncErrors.length) {
        result.sharingComplete = false;
        result.cleanupErrors = [...new Set([...(result.cleanupErrors || []), ...syncErrors])];
        result.warning = [
          result.warning,
          'Chưa đồng bộ được một số quyền ứng dụng từng cấp; chủ tệp cần kiểm tra trực tiếp trong Drive. Quyền chia sẻ thủ công không bị tự thay đổi.',
        ]
          .filter(Boolean)
          .join(' ');
      }
      const saved = store.finishEvidence(user, evidenceId, {
        ...result,
        retryToken: prepared.retryToken,
      });
      return { ...result, evidenceId, evidence: saved.evidence };
    } catch (cause) {
      store.failEvidence(user, evidenceId, {
        message: cause.message,
        retryToken: prepared.retryToken,
      });
      throw cause;
    }
  }
  async function shareEvidence(req, uploadingUser, recipients, created, existingPermissions = []) {
    const sharedWith = new Set();
    const shareErrors = [];
    const cleanupErrors = [];
    const revokedShares = [];
    const createdPermissions = [];
    const existingPermissionIds = new Set(existingPermissions.map((permission) => permission.id));
    const alreadySharedEmails = new Set(
      existingPermissions
        .filter(
          (permission) =>
            permission.type === 'user' &&
            ['reader', 'writer', 'owner', 'commenter', 'organizer', 'fileOrganizer'].includes(
              permission.role,
            ),
        )
        .map((permission) =>
          String(permission.emailAddress || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    // Pin the validated target. The selected/default term must not change while
    // Google is uploading, and every grant uses the current stored scope.
    const context = {
      semester: recipients.semester,
      studentId: recipients.studentId,
      purpose: recipients.purpose || 'claim',
      ...(recipients.appealId ? { appealId: recipients.appealId } : {}),
      ...(recipients.evidenceId ? { evidenceId: recipients.evidenceId } : {}),
      ...(recipients.retryToken ? { retryToken: recipients.retryToken } : {}),
    };
    const normalizedEmails = (values) =>
      new Set(values.map((email) => email.trim().toLowerCase()).filter(Boolean));
    let previousEmails = normalizedEmails(recipients.emails);
    let scopeChanged = false;
    let scopeLost = false;
    function currentRecipients() {
      if (scopeLost) return null;
      try {
        const currentUser = userFor(req);
        if (currentUser.id !== uploadingUser.id) throw fail(403, 'Phiên đăng nhập đã thay đổi.');
        const current = store.evidenceRecipients(currentUser, context);
        if (current.semester !== context.semester || current.studentId !== context.studentId)
          throw fail(403, 'Phạm vi minh chứng đã thay đổi.');
        const emails = normalizedEmails(current.emails);
        if (
          emails.size !== previousEmails.size ||
          [...emails].some((email) => !previousEmails.has(email))
        )
          scopeChanged = true;
        previousEmails = emails;
        return emails;
      } catch {
        scopeChanged = true;
        scopeLost = true;
        return null;
      }
    }
    async function revokeObsoleteGrants(allowed) {
      for (const permission of createdPermissions) {
        if (permission.revoked || permission.cleanupAttempted || allowed?.has(permission.email))
          continue;
        permission.cleanupAttempted = true;
        try {
          if (!/^[A-Za-z0-9_-]{1,200}$/.test(permission.id || ''))
            throw new Error('Missing permission ID');
          if (existingPermissionIds.has(permission.id))
            throw new Error('Permission predates this sharing attempt');
          // Only permissions returned by this upload's POST calls are eligible.
          // Historical Drive permissions are never enumerated or altered here.
          await auth.googleRequest(req, `${DRIVE}/${created.id}/permissions/${permission.id}`, {
            method: 'DELETE',
          });
          permission.revoked = true;
          sharedWith.delete(permission.email);
          revokedShares.push(permission.email);
        } catch {
          cleanupErrors.push(permission.email);
        }
      }
    }
    const afterUpload = currentRecipients();
    for (const email of afterUpload || []) {
      const beforeGrant = currentRecipients();
      if (!beforeGrant?.has(email)) continue;
      if (alreadySharedEmails.has(email)) {
        sharedWith.add(email);
        continue;
      }
      if (email === String(uploadingUser.email || '').toLowerCase()) {
        sharedWith.add(email);
        continue;
      }
      try {
        const permission = await auth.googleRequest(
          req,
          `${DRIVE}/${created.id}/permissions?sendNotificationEmail=false&fields=id`,
          { method: 'POST', body: { type: 'user', role: 'reader', emailAddress: email } },
        );
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(permission?.id || '')) {
          shareErrors.push(email);
          continue;
        }
        createdPermissions.push({
          email,
          id: permission?.id,
          revoked: false,
          cleanupAttempted: false,
        });
        sharedWith.add(email);
        await revokeObsoleteGrants(currentRecipients());
      } catch {
        shareErrors.push(email);
      }
    }
    const finalRecipients = currentRecipients();
    await revokeObsoleteGrants(finalRecipients);
    const sharingComplete =
      !scopeLost &&
      finalRecipients?.size > 0 &&
      !shareErrors.length &&
      !cleanupErrors.length &&
      [...finalRecipients].every((email) => sharedWith.has(email));
    const warnings = [];
    if (scopeLost)
      warnings.push(
        'Đã tải tệp lên nhưng quyền, phân công hoặc thời hạn đã thay đổi trong lúc tải. Đã dừng chia sẻ; cần kiểm tra lại trước khi gửi kê khai.',
      );
    else if (!finalRecipients?.size)
      warnings.push(
        'Đã tải tệp lên nhưng học kỳ/lớp chưa có người phụ trách đủ quyền nhận chia sẻ. Chưa thể coi bước chia sẻ minh chứng là hoàn tất.',
      );
    else if (scopeChanged)
      warnings.push(
        'Phân công đã thay đổi trong lúc tải; danh sách người nhận đã được kiểm tra lại. Hãy kiểm tra trạng thái chia sẻ trước khi gửi kê khai.',
      );
    if (revokedShares.length)
      warnings.push(
        'Đã thu hồi các quyền mới tạo trong lần tải này khi người nhận không còn thuộc phạm vi phụ trách.',
      );
    if (shareErrors.length)
      warnings.push(
        'Đã tải tệp lên nhưng chưa chia sẻ được với một số giảng viên. Hãy kiểm tra quyền chia sẻ trong Google Drive.',
      );
    if (cleanupErrors.length)
      warnings.push(
        'Chưa xác nhận thu hồi được một số quyền vừa tạo sau khi phạm vi thay đổi. Chủ tệp cần kiểm tra và thu hồi trực tiếp trong Google Drive.',
      );
    return {
      id: created.id,
      url: `https://drive.google.com/file/d/${created.id}/view`,
      name: created.name || name,
      sharedWith: [...sharedWith],
      semester: recipients.semester,
      studentId: recipients.studentId,
      sharingComplete: Boolean(sharingComplete),
      managedPermissions: createdPermissions
        .filter((permission) => !permission.revoked && !existingPermissionIds.has(permission.id))
        .map(({ id, email }) => ({ id, email })),
      ...(scopeChanged ? { scopeChanged: true } : {}),
      ...(shareErrors.length ? { shareErrors } : {}),
      ...(revokedShares.length ? { revokedShares } : {}),
      ...(cleanupErrors.length ? { cleanupErrors } : {}),
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    };
  }
  return {
    status,
    previewSheet,
    previewRosterSheet,
    commitRosterSheet,
    exportReport,
    listFiles,
    uploadEvidence,
    retryEvidence,
  };
}
