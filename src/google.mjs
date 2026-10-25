import { randomBytes } from 'node:crypto';
import { parseCsv, reportRows } from './files.mjs';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
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

export function createGoogleWorkspace({ auth, store, config = {} }) {
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
    const created = await auth.googleRequest(
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
    const sharedWith = [];
    const shareErrors = [];
    const lecturerEmails = [
      ...new Set(
        (config.lecturerEmails || []).map((email) => email.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    for (const email of lecturerEmails) {
      if (email === String(uploadingUser.email || '').toLowerCase()) {
        sharedWith.push(email);
        continue;
      }
      try {
        await auth.googleRequest(
          req,
          `${DRIVE}/${created.id}/permissions?sendNotificationEmail=false`,
          { method: 'POST', body: { type: 'user', role: 'reader', emailAddress: email } },
        );
        sharedWith.push(email);
      } catch {
        shareErrors.push(email);
      }
    }
    return {
      id: created.id,
      url: `https://drive.google.com/file/d/${created.id}/view`,
      name: created.name || name,
      sharedWith,
      ...(shareErrors.length
        ? {
            shareErrors,
            warning:
              'Đã tải tệp lên nhưng chưa chia sẻ được với một số giảng viên. Hãy kiểm tra quyền chia sẻ trong Google Drive.',
          }
        : {}),
    };
  }
  return { status, previewSheet, exportReport, listFiles, uploadEvidence };
}
