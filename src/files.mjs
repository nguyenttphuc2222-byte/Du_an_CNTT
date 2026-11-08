import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';

export const IMPORT_COLUMNS = [
  'sourceId',
  'studentCode',
  'activityId',
  'title',
  'criterionId',
  'categoryId',
  'points',
  'quantity',
  'date',
  'semester',
  'approvalReference',
];
const LIMIT = 5000;
function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
const aliases = {
  sourceid: 'sourceId',
  manguon: 'sourceId',
  madong: 'sourceId',
  mathamchieu: 'sourceId',
  studentcode: 'studentCode',
  mssv: 'studentCode',
  masinhvien: 'studentCode',
  activityid: 'activityId',
  mahoatdong: 'activityId',
  title: 'title',
  tenhoatdong: 'title',
  criterionid: 'criterionId',
  matieuchi: 'criterionId',
  tieuchi: 'criterionId',
  quantity: 'quantity',
  soluong: 'quantity',
  solan: 'quantity',
  approvalreference: 'approvalReference',
  vanbanpheduyet: 'approvalReference',
  categoryid: 'categoryId',
  mucdiem: 'categoryId',
  loaidiem: 'categoryId',
  points: 'points',
  diem: 'points',
  date: 'date',
  ngay: 'date',
  ngayhoatdong: 'date',
  semester: 'semester',
  hocky: 'semester',
};
function key(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
function cell(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value)
      fail('Không chấp nhận ô công thức. Hãy dán dữ liệu dưới dạng giá trị trước khi nhập.');
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    fail('Có ô dữ liệu không hỗ trợ trong tệp.');
  }
  return value ?? '';
}
function objectsFromGrid(grid, schema = {}) {
  const columns = schema.columns || IMPORT_COLUMNS;
  const requiredColumns = schema.requiredColumns || [
    'sourceId',
    'studentCode',
    'criterionId',
    'date',
    'semester',
  ];
  const headerAliases = { ...aliases, ...schema.headerAliases };
  while (grid.length && grid[0].every((v) => String(v ?? '').trim() === '')) grid.shift();
  if (!grid.length) fail('Tệp không có dữ liệu.');
  const headers = grid
    .shift()
    .map((v) =>
      Object.hasOwn(headerAliases, key(v)) ? headerAliases[key(v)] : String(v ?? '').trim(),
    );
  const known = headers.filter((h) => columns.includes(h));
  if (new Set(known).size !== known.length) fail('Tệp có cột tiêu đề trùng nhau.');
  for (const required of requiredColumns) {
    if (!headers.includes(required))
      fail(`Thiếu cột ${required}. Hãy tải mẫu nhập để dùng đúng cấu trúc.`);
  }
  const rows = grid
    .filter((row) => row.some((v) => String(v ?? '').trim() !== ''))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        if (columns.includes(header)) record[header] = cell(row[index]);
      });
      return record;
    });
  if (!rows.length) fail('Tệp chỉ có tiêu đề, chưa có dòng dữ liệu.');
  if (rows.length > LIMIT) fail(`Mỗi lần nhập tối đa ${LIMIT} dòng.`);
  return rows;
}
export function parseCsv(text, schema = {}) {
  text = String(text).replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const delimiter = [',', ';', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0];
  const grid = [];
  let row = [],
    value = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted || !value) quoted = !quoted;
      else fail('Tệp CSV có dấu ngoặc kép không hợp lệ.');
    } else if (c === delimiter && !quoted) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      grid.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) fail('Tệp CSV có dấu ngoặc kép chưa đóng.');
  if (value || row.length) {
    row.push(value);
    grid.push(row);
  }
  return objectsFromGrid(grid, schema);
}

// Check the ZIP before ExcelJS allocates worksheet structures. Keep uploads bounded
// by actual decompressed bytes as well as the compressed request body.
function validateXlsxArchive(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('Tệp XLSX không có cấu trúc ZIP hợp lệ.');
  const count = buffer.readUInt16LE(end + 10),
    directorySize = buffer.readUInt32LE(end + 12),
    directoryStart = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0 ||
    count !== buffer.readUInt16LE(end + 8) ||
    count > 300 ||
    directoryStart + directorySize > end
  )
    fail('Cấu trúc XLSX vượt giới hạn hỗ trợ.');
  let offset = directoryStart,
    total = 0;
  const names = new Set();
  try {
    for (let i = 0; i < count; i++) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
        fail('Cấu trúc XLSX không hợp lệ.');
      const flags = buffer.readUInt16LE(offset + 8),
        method = buffer.readUInt16LE(offset + 10),
        compressed = buffer.readUInt32LE(offset + 20),
        size = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28),
        extraLength = buffer.readUInt16LE(offset + 30),
        commentLength = buffer.readUInt16LE(offset + 32),
        local = buffer.readUInt32LE(offset + 42);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (
        next > directoryStart + directorySize ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        size > 16 * 1024 * 1024 ||
        total + size > 64 * 1024 * 1024
      )
        fail('XLSX quá lớn sau giải nén hoặc dùng định dạng không hỗ trợ.');
      const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (names.has(name) || name.includes('..') || name.startsWith('/'))
        fail('XLSX có đường dẫn thành phần không hợp lệ.');
      names.add(name);
      if (local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50)
        fail('Thành phần XLSX không hợp lệ.');
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (start + compressed > directoryStart) fail('Thành phần XLSX vượt phạm vi tệp.');
      const data = buffer.subarray(start, start + compressed);
      const decoded =
        method === 0 ? data : inflateRawSync(data, { maxOutputLength: 16 * 1024 * 1024 });
      if (decoded.length !== size) fail('Kích thước thành phần XLSX không hợp lệ.');
      total += decoded.length;
      offset = next;
    }
    if (offset !== directoryStart + directorySize) fail('Danh mục thành phần XLSX không hợp lệ.');
  } catch (error) {
    if (error.status === 400) throw error;
    fail('Không đọc được cấu trúc XLSX hoặc tệp vượt giới hạn giải nén.');
  }
}

export async function parseUpload(payload, schema = {}) {
  if (Array.isArray(payload.rows)) {
    if (!payload.rows.length || payload.rows.length > LIMIT) fail(`Cần từ 1 đến ${LIMIT} dòng.`);
    return payload.rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        fail('Dòng nhập phải là đối tượng dữ liệu.');
      const record = {};
      for (const column of schema.columns || IMPORT_COLUMNS) record[column] = cell(row[column]);
      return record;
    });
  }
  if (typeof payload.csv === 'string') return parseCsv(payload.csv, schema);
  if (typeof payload.fileName !== 'string' || typeof payload.fileBase64 !== 'string')
    fail('Hãy chọn tệp XLSX hoặc CSV.');
  const extension = payload.fileName.toLowerCase().split('.').pop();
  if (!['csv', 'xlsx'].includes(extension))
    fail('Chỉ hỗ trợ .xlsx và .csv. Với .xls cũ, hãy lưu lại thành .xlsx.');
  if (payload.fileBase64.length > 12 * 1024 * 1024) fail('Tệp vượt quá giới hạn 8 MB.');
  const buffer = Buffer.from(payload.fileBase64, 'base64');
  if (!buffer.length || buffer.length > 8 * 1024 * 1024)
    fail('Tệp rỗng hoặc vượt quá giới hạn 8 MB.');
  if (extension === 'csv') return parseCsv(buffer.toString('utf8'), schema);
  validateXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    fail('Không đọc được tệp XLSX. Hãy kiểm tra định dạng hoặc lưu lại tệp.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) fail('Tệp không có trang tính.');
  if (sheet.rowCount > LIMIT + 20 || sheet.columnCount > 40)
    fail('Tệp quá lớn. Chỉ nhập bảng dữ liệu theo mẫu, tối đa 5.000 dòng và 40 cột.');
  const grid = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    grid.push(Array.from({ length: sheet.columnCount }, (_, i) => cell(row.getCell(i + 1).value)));
  });
  return objectsFromGrid(grid, schema);
}
function csvValue(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value !== 'number' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function makeCsv(columns, rows) {
  return (
    '\uFEFF' +
    [
      columns.map(csvValue).join(','),
      ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
    ].join('\r\n')
  );
}
function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) =>
    typeof column === 'string'
      ? { header: column, key: column, width: 22 }
      : { header: column.header, key: column.key, width: column.width ?? 22 },
  );
  rows.forEach((row) => sheet.addRow(row));
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153B50' } };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: columns.length },
  };
  sheet.eachRow((row, index) => {
    if (index > 1) {
      row.alignment = { vertical: 'middle', wrapText: true };
      if (index % 2 === 0)
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6F7' } };
    }
  });
  return sheet;
}
export async function makeImportWorkbook(rows = [], semesters = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TDTU Conduct Demo';
  addSheet(workbook, 'Du lieu phat sinh', IMPORT_COLUMNS, rows);
  addSheet(
    workbook,
    'Huong dan',
    [{ header: 'Nội dung', key: 'text', width: 115 }],
    [
      { text: 'DỮ LIỆU DEMO. Quy tắc theo PDF TDTU được cung cấp, hiệu lực từ năm học 2025–2026.' },
      {
        text: 'Chỉ nhập từng khoản phát sinh đã có xác nhận. Tệp tổng điểm tại một thời điểm không dùng mẫu này.',
      },
      {
        text: 'sourceId: mã tham chiếu nguồn duy nhất trong học kỳ. Không đổi mã khi nhập lại cùng khoản.',
      },
      {
        text: 'studentCode: MSSV có trong danh sách. activityId: mã hoạt động, có thể để trống nếu nhập title.',
      },
      {
        text: 'criterionId: mã tiêu chí trong trang Quy tắc điểm. categoryId và points có thể để trống để hệ thống tính theo tiêu chí.',
      },
      {
        text: 'quantity: số lần với tiêu chí /lần; 1 với tiêu chí /học kỳ. Điểm theo văn bản cần points và approvalReference. date: YYYY-MM-DD; semester: mã trong trang Hoc ky. Mỗi dòng tự chỉ định kỳ, có thể nhập nhiều kỳ trong một đợt.',
      },
      {
        text: 'Mục điểm: academic / compliance / movement / community / pioneer / bonus; mỗi mục tối đa 20, tổng tối đa 100.',
      },
      {
        text: 'Điểm học tập, chấp hành và chế độ học kỳ được quản lý tại Đánh giá học kỳ. Không nhập lặp cùng thành phần bằng cả biểu mẫu và tệp.',
      },
      {
        text: 'Nhập lại khoản giống hệt không cộng lặp. Cùng sourceId nhưng khác nội dung sẽ bị báo lỗi.',
      },
      {
        text: 'Một sinh viên vắng tên trong tệp không tự động bị trừ điểm. Điểm danh không mặc nhiên là dữ liệu chính thức.',
      },
      {
        text: 'Danh mục là ảnh tại lúc tải mẫu. Máy chủ kiểm tra lại từng dòng khi nhập; một dòng thuộc kỳ đã chốt làm toàn đợt bị từ chối, kể cả kỳ đang chọn trên giao diện còn mở.',
      },
    ],
  );
  addSheet(
    workbook,
    'Hoc ky',
    [
      { header: 'Mã học kỳ', key: 'id', width: 30 },
      { header: 'Tên học kỳ', key: 'name', width: 42 },
      { header: 'Năm học', key: 'academicYear', width: 20 },
      { header: 'Thứ tự kỳ', key: 'term', width: 15 },
      { header: 'Trạng thái', key: 'state', width: 20 },
      { header: 'Bắt đầu kê khai UTC', key: 'startsAt', width: 28 },
      { header: 'Hạn kê khai UTC', key: 'deadline', width: 28 },
      { header: 'Tính điểm năm', key: 'annualIncluded', width: 18 },
      { header: 'Tính toàn khóa', key: 'courseIncluded', width: 18 },
    ],
    semesters.map((semester) => ({
      ...semester,
      state:
        { open: 'Mở', review: 'Tổng hợp', closed: 'Đã chốt' }[semester.state] || semester.state,
      annualIncluded: semester.annualIncluded ? 'Có' : 'Không',
      courseIncluded: semester.courseIncluded ? 'Có' : 'Không',
    })),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function reportRows(report) {
  const statusLabels = {
    evaluated: 'Đủ dữ liệu đánh giá',
    incomplete: 'Chưa đủ dữ liệu đánh giá',
    no_data: 'Chưa có dữ liệu',
    not_evaluated: 'Không đánh giá',
  };
  return report.students.map((student) => {
    const officialTotal = student.snapshotId ? student.publishedTotal : student.officialTotal;
    const hasOfficialResult = student.hasOfficialData && officialTotal !== null;
    const breakdown =
      student.semesterBreakdown ||
      (report.semesterBreakdown || []).map((period) => ({
        semester: period.semester,
        ...(period.students.find((item) => item.id === student.id) || {}),
      }));
    return {
      MSSV: student.code,
      'Họ tên': student.name,
      Lớp: student.className,
      'Học kỳ': student.semester,
      'Bản chốt': student.snapshotVersion ?? report.snapshotVersion ?? null,
      'Thời điểm chốt': student.closedAt ?? report.closedAt ?? null,
      'Trạng thái đánh giá':
        statusLabels[student.evaluationStatus] ||
        (student.hasOfficialData ? 'Có dữ liệu' : 'Chưa có dữ liệu'),
      'Số khoản cũ cần đối chiếu': student.legacyCount || 0,
      'Lưu ý': (student.warnings || []).join('; '),
      'Có dữ liệu chính thức': student.hasOfficialData ? 'Có' : 'Chưa có',
      'Điểm chính thức': hasOfficialResult ? officialTotal : null,
      'Điểm kê khai còn chờ': student.pendingTotal,
      'Điểm dự kiến': student.projectedClassification ? student.projectedTotal : null,
      'Xếp loại chính thức':
        student.snapshotId && !hasOfficialResult
          ? statusLabels[student.evaluationStatus] || 'Chưa đủ dữ liệu đánh giá'
          : (student.officialClassification ?? 'Chưa có dữ liệu'),
      'Xếp loại dự kiến': student.projectedClassification ?? 'Chưa có dữ liệu',
      ...(student.annualTotal !== undefined
        ? {
            'Điểm trung bình năm': student.annualTotal,
            'Xếp loại năm': student.annualClassification || 'Chưa đủ hai học kỳ',
          }
        : {}),
      ...(breakdown.length
        ? Object.fromEntries(
            breakdown.flatMap((item) => [
              [
                `${item.semester} - điểm chính thức`,
                item.hasOfficialData
                  ? item.snapshotId
                    ? item.publishedTotal
                    : item.officialTotal
                  : null,
              ],
              [
                `${item.semester} - xếp loại`,
                item.snapshotId && item.publishedTotal === null
                  ? statusLabels[item.evaluationStatus] || 'Chưa đủ dữ liệu đánh giá'
                  : item.officialClassification || 'Chưa có dữ liệu',
              ],
            ]),
          )
        : {}),
      ...Object.fromEntries(
        student.categoryScores.flatMap((category) => [
          [`${category.name} - chính thức`, hasOfficialResult ? category.official : null],
          [
            `${category.name} - dự kiến`,
            student.projectedClassification ? category.projected : null,
          ],
        ]),
      ),
    };
  });
}
export async function makeReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TDTU Conduct Demo';
  const rows = reportRows(report);
  const headers = rows.length
    ? Object.keys(rows[0])
    : ['MSSV', 'Họ tên', 'Lớp', 'Điểm chính thức', 'Điểm dự kiến'];
  addSheet(workbook, 'Sinh vien', headers, rows);
  addSheet(
    workbook,
    'Thong ke',
    [
      { header: 'Xếp loại', key: 'label' },
      { header: 'Số lượng', key: 'count' },
      { header: 'Tỷ lệ phần trăm', key: 'percentage' },
    ],
    report.stats.byClassification,
  );
  addSheet(
    workbook,
    'Thong tin',
    [
      { header: 'Thông tin', key: 'label', width: 36 },
      { header: 'Giá trị', key: 'value', width: 90 },
    ],
    [
      {
        label: 'Cơ sở thống kê',
        value: report.basis === 'projected' ? 'Điểm dự kiến' : 'Điểm chính thức',
      },
      { label: 'Tổng sinh viên trong phạm vi', value: report.stats.total },
      { label: 'Có dữ liệu theo cơ sở đã chọn', value: report.stats.hasData },
      { label: 'Chưa có dữ liệu theo cơ sở đã chọn', value: report.stats.noData },
      { label: 'Quy tắc', value: report.settings.versionName },
      { label: 'Văn bản nguồn', value: 'docs/quy-che-ren-luyen-tdtu.pdf — Điều 3 đến Điều 16' },
      {
        label: 'Lưu ý',
        value:
          'Dữ liệu demo; quy tắc theo PDF TDTU được cung cấp, hiệu lực 2025–2026. Điểm cũ chưa gắn tiêu chí mới không tính vào tổng. Tỷ lệ lấy mẫu số là toàn bộ sinh viên trong phạm vi lọc.',
      },
    ],
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
