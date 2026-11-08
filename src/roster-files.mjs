import ExcelJS from 'exceljs';
import { parseUpload } from './files.mjs';

export const ROSTER_COLUMNS = [
  'sourceId',
  'studentCode',
  'name',
  'email',
  'classId',
  'className',
  'faculty',
  'cohortYear',
  'semester',
  'approvalReference',
];

const ROSTER_SCHEMA = {
  columns: ROSTER_COLUMNS,
  requiredColumns: ['sourceId', 'studentCode', 'name', 'email', 'classId', 'semester'],
  headerAliases: {
    sourceid: 'sourceId',
    manguon: 'sourceId',
    madong: 'sourceId',
    mathamchieu: 'sourceId',
    studentcode: 'studentCode',
    mssv: 'studentCode',
    masinhvien: 'studentCode',
    name: 'name',
    hoten: 'name',
    tensinhvien: 'name',
    hotensinhvien: 'name',
    email: 'email',
    thudientu: 'email',
    emailsinhvien: 'email',
    classid: 'classId',
    malop: 'classId',
    classname: 'className',
    tenlop: 'className',
    faculty: 'faculty',
    khoa: 'faculty',
    tenkhoa: 'faculty',
    cohortyear: 'cohortYear',
    namtuyensinh: 'cohortYear',
    nambatdaudaihoc: 'cohortYear',
    khoatuyensinh: 'cohortYear',
    khoahoc: 'cohortYear',
    semester: 'semester',
    hocky: 'semester',
    approvalreference: 'approvalReference',
    vanbanpheduyet: 'approvalReference',
    cancu: 'approvalReference',
    vanbancancu: 'approvalReference',
  },
};

// Reuse the scoring importer’s bounded CSV/XLSX reader, including archive
// preflight and formula rejection. Identity, catalogue and permissions are
// validated together by the store before a complete batch is committed.
export async function parseRosterUpload(payload) {
  return parseUpload(payload, ROSTER_SCHEMA);
}

function addTable(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) =>
    typeof column === 'string'
      ? { header: column, key: column, width: 24 }
      : { width: 24, ...column },
  );
  for (const row of rows) sheet.addRow(row);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: columns.length },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153B50' } };
  sheet.getRow(1).height = 28;
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: 'middle', wrapText: true };
    if (index > 1 && index % 2 === 0)
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6F7' } };
  });
  return sheet;
}

export async function makeRosterWorkbook(rows = [], semesters = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TDTU Conduct Demo';
  const roster = addTable(workbook, 'Danh sach sinh vien', ROSTER_COLUMNS, rows);
  for (const name of ['sourceId', 'studentCode', 'email', 'classId', 'semester'])
    roster.getColumn(name).numFmt = '@';
  roster.getColumn('name').width = 32;
  roster.getColumn('email').width = 42;
  roster.getColumn('className').width = 30;
  roster.getColumn('faculty').width = 30;
  roster.getColumn('approvalReference').width = 42;
  addTable(
    workbook,
    'Huong dan',
    [{ header: 'Hướng dẫn nhập danh sách', key: 'text', width: 120 }],
    [
      { text: 'Đây là mẫu danh sách sinh viên và lớp theo học kỳ, không phải mẫu điểm rèn luyện.' },
      {
        text: 'Mỗi dòng chỉ định semester là mã trong trang Hoc ky. Tệp được phép chứa nhiều học kỳ; kỳ đang chọn trên giao diện không thay thế mã trong dòng.',
      },
      {
        text: 'sourceId là mã nguồn đối chiếu của dòng danh sách trong học kỳ. Giữ nguyên mã khi nhập lại cùng dữ liệu; không đổi mã để ghi đè một khoản cũ.',
      },
      {
        text: 'studentCode, email và classId phải là định danh chính xác. Đặt cột mã ở dạng văn bản trước khi nhập để giữ số 0 đầu; không dùng công thức.',
      },
      {
        text: 'name là họ tên sinh viên. classId là mã lớp; className là tên lớp. faculty là khoa; cohortYear là năm tuyển sinh dạng bốn chữ số.',
      },
      {
        text: 'Khi lập một lớp mới, cung cấp đầy đủ tên lớp, khoa và năm tuyển sinh theo căn cứ thật. approvalReference lưu tham chiếu danh sách hoặc văn bản phê duyệt.',
      },
      {
        text: 'Không tự ghép hồ sơ chỉ vì mã sinh viên giống phần trước dấu @. Xung đột danh tính phải được xử lý theo căn cứ, không tạo lại ID để di chuyển điểm.',
      },
      {
        text: 'Chuyển lớp chỉ áp dụng theo học kỳ của từng dòng, không sửa báo cáo lịch sử. Mỗi lần nhập được kiểm tra quyền, trạng thái kỳ và xung đột trước khi ghi toàn đợt.',
      },
      {
        text: 'Một dòng có lỗi khiến toàn đợt bị từ chối. Danh mục ở trang Hoc ky là ảnh lúc tải; máy chủ kiểm tra lại danh mục và khóa kỳ khi nhập.',
      },
      {
        text: 'Cột bắt buộc trong tệp: sourceId, studentCode, name, email, classId, semester. Các yêu cầu về giá trị và căn cứ được kiểm tra khi xem trước và ghi dữ liệu.',
      },
    ],
  );
  addTable(
    workbook,
    'Hoc ky',
    [
      { header: 'Mã học kỳ', key: 'id', width: 30 },
      { header: 'Tên học kỳ', key: 'name', width: 38 },
      { header: 'Năm học', key: 'academicYear', width: 20 },
      { header: 'Thứ tự kỳ', key: 'term', width: 15 },
      { header: 'Trạng thái', key: 'state', width: 20 },
    ],
    semesters.map((semester) => ({
      ...semester,
      state:
        { open: 'Mở', review: 'Tổng hợp', closed: 'Đã chốt' }[semester.state] || semester.state,
    })),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
