> **Bản cập nhật quy chế:** xem [hướng dẫn kiểm thử mới](HUONG_DAN_KIEM_THU.md) và [quy tắc đã tích hợp](docs/QUY_TAC_CHAM_DIEM.md). Dùng mẫu nhập mới có `criterionId`; các khoản cũ cần đối chiếu, không tự đổi nhóm.

# Ứng dụng demo quản lý điểm rèn luyện TDTU

Bản demo chạy trên máy bằng Node.js hoặc Docker, có giao diện tiếng Việt cho sinh viên và giảng viên, lưu dữ liệu SQLite và kết nối Google OAuth Internal, Google Sheets, Google Drive. Dữ liệu tên, hoạt động và điểm ban đầu là minh họa; hai email demo được cấu hình theo yêu cầu.

## Chạy nhanh bằng Docker

Cài và mở Docker Desktop ở chế độ Linux containers. Mở thư mục này trong VS Code, mở Terminal rồi chạy:

```powershell
docker compose up -d --build
```

Mở **http://localhost:3000**. Chưa có credentials vẫn dùng được các nút tài khoản minh họa. Có thể nhấp đúp `start-docker.cmd` để chạy cùng lệnh.

```powershell
docker compose logs -f app
docker compose down
```

`down` dừng ứng dụng và giữ dữ liệu. SQLite nằm trong volume `tdtu-conduct-demo_conduct-data`; không xóa volume nếu cần giữ dữ liệu. Thư mục `data` khi chạy Node và volume khi chạy Docker là hai cơ sở dữ liệu riêng.

## Chạy bằng VS Code và Node.js

Cần Node.js **24 trở lên**. Mở `TDTU Conduct Demo.code-workspace`, hoặc mở chính thư mục `tdtu-conduct-demo` trong VS Code.

```powershell
npm ci
npm start
```

Mở **http://localhost:3000**. Dùng `npm.cmd` nếu PowerShell chặn `npm.ps1`. Có thể nhấp đúp `start-demo.cmd`; script sẽ cài thư viện nếu chưa có rồi chạy server. Trong VS Code nhấn **F5**, chọn “Chạy demo TDTU” để debug. Các task cài thư viện, kiểm thử và Docker nằm trong Terminal → Run Task.

Chỉ chạy một phiên Node hoặc Docker trên cổng 3000. Muốn chạy Node ở cổng khác, đặt đồng thời `PORT` và `BASE_URL` trong `.env`, rồi cập nhật redirect URI tương ứng của Google.

## Tài khoản và phân quyền
523h0080@student.tdtu.edu.vn - phuc123456@
523h0025@student.tdtu.edu.vn - KTPM523CaoHau

| Email                          | Vai trò trong ứng dụng                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| `523h0080@student.tdtu.edu.vn` | Sinh viên, liên kết hồ sơ có 40 điểm chính thức và 10 điểm kê khai ban đầu |
| `523h0025@student.tdtu.edu.vn` | Giảng viên, được cấp qua `LECTURER_EMAILS` ở máy chủ                       |

Các nút minh họa không xác thực quyền sở hữu email; chúng chỉ dùng với bộ dữ liệu demo. Đăng nhập Google thật sẽ xác minh tài khoản và liên kết cùng hồ sơ, giữ lịch sử điểm. `DEMO_ENABLED=false` tắt toàn bộ đường đăng nhập minh họa; khi đó phải cấu hình Google trước.

Vai trò được kiểm tra tại backend ở từng thao tác. Sinh viên chỉ xem và kê khai cho chính mình, không được nhập điểm chính thức, duyệt hay xuất dữ liệu toàn khoa. Phiên đăng nhập minh họa không được dùng kết nối Google của phiên đăng nhập thật dù cùng hồ sơ.

## Cấu hình Google OAuth Internal

1. Sao chép `.env.example` thành `.env` nếu chưa có:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Trong project Google Cloud thuộc tổ chức TDTU, vào **Google Auth Platform → Audience**, giữ **Internal**. Bật **Google Sheets API** và **Google Drive API**.
3. Tạo OAuth client loại **Web application**. Khai báo redirect URI chính xác:

   ```text
   http://localhost:3000/auth/google/callback
   ```

   Có thể khai báo JavaScript origin `http://localhost:3000`. Hai cách chạy Node/Docker mặc định dùng cùng redirect URI.

4. Điền trực tiếp trên máy vào `.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=gia-tri-client-id-cua-ban
   GOOGLE_CLIENT_SECRET=gia-tri-client-secret-cua-ban
   LECTURER_EMAILS=523h0025@student.tdtu.edu.vn
   ```

5. Trong **Data Access**, khai báo các scope ứng dụng sử dụng: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/spreadsheets.readonly`.
6. Khởi động lại Node, hoặc chạy `docker compose up -d` để container nhận môi trường mới. Nếu chính sách Workspace chặn app, quản trị tổ chức cần cho phép OAuth client.

Không gửi Client Secret vào chat hoặc commit `.env`. Docker không chép `.env` vào image; Compose truyền các biến cần thiết khi khởi động. `LECTURER_EMAILS` nhận nhiều email, ngăn bằng dấu phẩy. Miền email và claim `hd` được xác minh theo allowlist `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_HOSTED_DOMAINS`.

### Đăng nhập và kết nối Workspace là hai bước

Lúc đăng nhập chỉ xin thông tin nhận diện cơ bản. Trong trang Nhập dữ liệu, Kê khai hoặc Báo cáo, chọn **Kết nối Google** để cấp quyền bổ sung:

- `spreadsheets.readonly`: đọc bảng tính mà tài khoản có quyền truy cập, bằng URL người dùng nhập.
- `drive.file`: tạo báo cáo riêng tư và tải minh chứng do người dùng chọn vào Drive.

Sau khi kết nối, nhập URL Google Sheet có cùng cột với mẫu. Ứng dụng đọc tối đa 5.000 dòng, xem trước và kiểm tra trước khi nhập. Có thể tải CSV mẫu trong `samples`, đưa vào Google Sheets để thử tích hợp. Lưu báo cáo lên Google tạo một bảng tính mới trong Drive của người đăng nhập, không tự chia sẻ công khai.

Tải minh chứng nhận PDF/PNG/JPEG/WEBP tối đa 5 MB; nút tải nói rõ việc chia sẻ quyền đọc cho email giảng viên cấu hình. Nếu upload thành công nhưng chia sẻ bị chặn, ứng dụng trả cảnh báo cùng liên kết để kiểm tra. Nhập liên kết minh chứng thủ công vẫn dùng được.

Phiên ứng dụng và token Google chỉ lưu trong RAM, không ghi token ra SQLite hay log. Khởi động lại máy chủ cần đăng nhập/kết nối lại; điểm và kê khai vẫn được lưu bền vững. Không cần API key Google Picker. Google Forms, Gmail, Calendar và điểm danh QR chưa thuộc phạm vi bản demo này.

## Kịch bản demo khoảng 5–10 phút

1. Ở màn đăng nhập, chọn **Không gian sinh viên** với email `523h0080...`: xem 40 điểm chính thức, 10 điểm đang chờ, 50 điểm dự kiến. Kê khai “Ngày hội tình nguyện xanh” đã có sẵn.
2. Đăng xuất rồi chọn **Không gian giảng viên** với email `523h0025...`. Thử danh sách sinh viên, lọc lớp và xem kê khai. “Đã kiểm tra” vẫn là phần chờ, chưa thành điểm chính thức.
3. Vào **Nhập dữ liệu**, tải **Tệp kịch bản demo**, chọn tệp vừa tải và kiểm tra. Có thể dùng `samples/du-lieu-chinh-thuc-demo.csv`.
4. Ghi nhận một khoản mới. Hệ thống tự đối soát khi trùng sinh viên, học kỳ, mã hoạt động, mục điểm và số điểm, đồng thời chỉ có một cặp khớp.
5. Xem lại sinh viên: 50 điểm chính thức, 0 điểm chờ, 50 điểm dự kiến.
6. Nhập lại cùng tệp, xác nhận bỏ qua trùng. Kết quả không tăng thêm. Nếu cùng `sourceId` nhưng nội dung khác, toàn bộ đợt nhập bị từ chối.
7. Mở **Đối soát** để xem các trường hợp cần xác minh thủ công. Tên gần giống chỉ tạo gợi ý; số điểm khác nhau cần xác nhận thủ công.
8. Mở **Báo cáo**, lọc lớp và chọn cơ sở chính thức/dự kiến, tải Excel/CSV. Khi có Google thật, thử nhập Sheet theo URL, lưu báo cáo lên Sheets và tải minh chứng Drive.
9. Chọn HK2 để thấy dữ liệu được tách theo kỳ; bảng theo dõi năm học trình bày riêng hai học kỳ.

Luồng 40 → 50 chỉ xảy ra một lần cho mỗi cơ sở dữ liệu mới. Sau khi đã nhập, lịch sử vẫn giữ ở 50; bản demo không tự đặt lại dữ liệu khi khởi động. Để diễn lại từ đầu có thể dùng một `DATA_DIR` mới khi chạy Node, hoặc một project name Compose mới sau khi dừng bản cũ.

## Quy tắc điểm và học kỳ

Quy tắc hiện tại lấy từ PDF TDTU do người dùng cung cấp, hiệu lực năm học 2025–2026. Xem `docs/QUY_TAC_CHAM_DIEM.md` và tải lại mẫu nhập có `criterionId` trong ứng dụng.

Điểm chính thức lấy từ từng khoản được nhập; phần kê khai chờ không cộng vào chính thức. Điểm dự kiến cộng phần chờ chưa khớp/chưa bị từ chối rồi áp trần từng mục và trần tổng. Không tự phạt sinh viên vắng tên trong tệp. Không xem danh sách điểm danh chưa được xác nhận là điểm chính thức.

Quy tắc hiện tại lấy từ PDF TDTU do người dùng cung cấp, hiệu lực năm học 2025–2026. Xem `docs/QUY_TAC_CHAM_DIEM.md` và tải lại mẫu nhập có `criterionId` trong ứng dụng.

## Dữ liệu nhập

Các cột: `sourceId, studentCode, activityId, title, categoryId, points, date, semester`.

- `sourceId`: tham chiếu khoản điểm duy nhất trong một học kỳ, giữ nguyên khi nhập lại. Không tự tạo mã mới cho cùng khoản trong mỗi lần xuất.
- `studentCode`: MSSV đã có trong danh sách. `activityId` để trống được nếu có `title`.
- `categoryId`: `c1`, `c2`, `c3`; tên hiển thị có thể cấu hình.
- `points`: số khác 0, từ -100 đến 100. `date`: ISO `YYYY-MM-DD`. `semester`: một trong hai kỳ đã cấu hình.

Đây là mẫu **từng khoản phát sinh**, không phải mẫu tổng điểm tại một thời điểm. Tệp tổng phải có bước chuyển đổi/đối chiếu phù hợp trước khi nhập để tránh cộng trùng. XLSX/CSV tối đa 8 MB, 5.000 dòng; không nhận công thức trong XLSX. Nhập Excel giữ dữ liệu bằng giá trị, không thực thi công thức.

## Kiểm thử và cấu trúc mã

```powershell
npm test
npm run check
npm run test:e2e
```

`test:e2e` sử dụng Edge cài trên máy qua Playwright, tự tạo server/cơ sở dữ liệu trong RAM và chụp ảnh vào `artifacts`. Có thể đặt `BROWSER_CHANNEL=chrome` nếu dùng Chrome. Chạy kiểm thử trình duyệt trên máy có trình duyệt tương ứng; container runtime không chứa trình duyệt hay dev dependencies.

- `src/server.mjs`: HTTP routes, giới hạn request, file tĩnh và xuất tệp.
- `src/store.mjs`: SQLite, điểm, kê khai, nhập dữ liệu, đối soát, phân quyền và thống kê.
- `src/auth.mjs`: Google OAuth, phiên đăng nhập, cấp quyền Workspace theo ngữ cảnh.
- `src/google.mjs`: Sheets và Drive API.
- `src/files.mjs`: đọc/ghi XLSX, CSV.
- `public`: giao diện web không cần build, không phụ thuộc CDN.
- `tests`: kiểm thử nghiệp vụ, OAuth/API giả lập, HTTP, nhập/xuất tệp.
- `.vscode`: cấu hình F5 và task. `Dockerfile`/`compose.yaml`: container và volume.

Các kiểm thử Google sử dụng phản hồi giả lập để kiểm tra luồng và quyền. Việc đăng nhập/gọi API bằng tài khoản thật cần credentials, consent và quyền tổ chức của bạn. Dữ liệu mẫu không đồng bộ với hệ thống điểm chính thức TDTU.
## Kết quả xác minh bản bàn giao

Đã kiểm tra trên Windows với Node.js 24, trình duyệt Edge headless và Docker Desktop Linux containers:

- 46/46 kiểm thử tự động: nghiệp vụ, phân quyền, OAuth giả lập, Sheets/Drive giả lập, HTTP và nhập/xuất tệp.
- Kiểm thử trình duyệt: đăng nhập giảng viên/sinh viên, 9 màn, tạo hoạt động, kê khai, nhập XLSX, đối soát 40 + 10 → 50, nhập trùng, tải báo cáo, đổi học kỳ và giao diện điện thoại.
- Docker build thành công, healthcheck healthy; kiểm tra API, xuất XLSX và xác nhận dữ liệu còn nguyên sau restart.

Quy tắc hiện tại lấy từ PDF TDTU do người dùng cung cấp, hiệu lực năm học 2025–2026. Xem `docs/QUY_TAC_CHAM_DIEM.md` và tải lại mẫu nhập có `criterionId` trong ứng dụng.
