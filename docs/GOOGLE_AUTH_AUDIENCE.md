# Chuyển Google OAuth giữa Internal và External

Áp dụng từ bản 0.3.0. Giữ OAuth Client ID/Secret và callback hiện tại nếu vẫn dùng cùng Web client. Không đưa Client Secret hoặc nội dung `.env` vào báo cáo/chat.

## 1. Quy tắc phân quyền

| Chế độ backend | Tài khoản Google đã xác minh                                   | Vai trò  |
| -------------- | -------------------------------------------------------------- | -------- |
| Internal       | `@student.tdtu.edu.vn`, không thuộc ngoại lệ                   | STUDENT  |
| Internal       | `@tdtu.edu.vn`                                                 | LECTURER |
| Internal       | `523h0025@student.tdtu.edu.vn` trong LECTURER_EMAILS           | LECTURER |
| Internal       | Tài khoản ngoài hai miền, kể cả có tên trong ngoại lệ          | Từ chối  |
| External       | Email bất kỳ không thuộc LECTURER_EMAILS, kể cả `@tdtu.edu.vn` | STUDENT  |
| External       | Email nằm chính xác trong LECTURER_EMAILS                      | LECTURER |

Internal còn xác minh claim `hd` của Google Workspace trong ID token, không chỉ nhìn đuôi email. Hai miền trường cùng tổ chức có thể dùng chung `hd=tdtu.edu.vn`; không cần `hd` trùng tuyệt đối với phần miền email. External không buộc có `hd`, nên Gmail cá nhân dùng được.

## 2. Chuyển sang External để kiểm thử

1. Trong đúng Google Cloud project, vào **Google Auth Platform → Audience → Make external** và xác nhận. Giữ **Testing** nếu đang thử nghiệm.
2. Trong **Test users**, thêm các tài khoản dự định thử Sheets/Drive, gồm cả email được chọn làm giảng viên. Nếu chỉ đăng nhập bằng `openid email profile`, Google có ngoại lệ không bắt buộc danh sách test; bước cấp quyền Workspace bổ sung không thuộc ngoại lệ này.
3. Sửa hoặc thêm các dòng sau trong `.env` hiện có; giữ nguyên các giá trị Client ID/Secret và các cấu hình khác:

```dotenv
GOOGLE_AUTH_AUDIENCE=external
LECTURER_EMAILS=523h0025@student.tdtu.edu.vn,giangvien.demo@gmail.com
```

Thay `giangvien.demo@gmail.com` bằng tài khoản thật bạn dùng. Nhiều email cách nhau bằng dấu phẩy. Chỉ muốn mọi tài khoản là Student: đặt `LECTURER_EMAILS=`. Không cần xóa ALLOWED_EMAIL_DOMAINS/ALLOWED_HOSTED_DOMAINS; External bỏ qua các bộ lọc đó, còn Internal dùng lại.

4. Trong terminal VS Code ở thư mục dự án, chạy:

```powershell
docker compose up -d --build
docker compose ps
```

Nếu chạy Node trực tiếp, dừng tiến trình cũ rồi chạy `npm start`. Không chỉ dùng `docker compose restart` sau khi sửa biến môi trường: cần tạo lại container để nhận cấu hình mới.

5. Mở `http://localhost:3000`, Ctrl+F5 và đăng nhập Google lại. Các phiên và token được giữ trong RAM nên kết nối Workspace lại nếu cần. Không dùng nút tài khoản demo để kiểm chứng phân quyền Google thật.

Để chỉ thử Google thật, có thể đặt `DEMO_ENABLED=false` khi Client ID/Secret đã cấu hình đầy đủ.

## 3. Chuyển về Internal

1. Google Auth Platform → Audience → **Make internal**. Project phải thuộc tổ chức Google Workspace/Cloud Identity tương ứng và bạn phải có quyền cấu hình.
2. Đặt `GOOGLE_AUTH_AUDIENCE=internal` trong `.env`. Giữ các email trường được gán ngoại lệ trong `LECTURER_EMAILS`; ngoại lệ Gmail không cho phép vượt bộ lọc Internal.
3. Dựng lại container bằng lệnh phía trên, đăng nhập lại với tài khoản trường.
4. Kiểm tra email sinh viên thông thường là Student, email cán bộ `@tdtu.edu.vn` là Lecturer, `523h0025@student.tdtu.edu.vn` là Lecturer nếu vẫn có trong ngoại lệ. Gmail cá nhân phải bị Google hoặc backend từ chối.

Backend không tự biết thay đổi trên Console. ID token `aud` chứa Client ID, không chứa cờ Internal/External. Cần đồng bộ **Console + GOOGLE_AUTH_AUDIENCE** sau mỗi lần đổi. Không cần sửa mã nguồn.

## 4. Kiểm tra chuyển vai trò và bảo toàn dữ liệu

- External: đăng nhập một Gmail không có trong ngoại lệ → Student, chỉ thấy dữ liệu của mình, không xem được báo cáo/nhật ký/nhập điểm.
- Thêm Gmail đó vào LECTURER_EMAILS, tạo lại container, đăng nhập lại → Lecturer.
- Bỏ Gmail khỏi ngoại lệ, tạo lại container và đăng nhập lại → Student; giữ đúng hồ sơ và dữ liệu đã có. Tài khoản lần đầu được tạo dưới vai trò Lecturer cũng phải dùng được sau khi chuyển Student, với hồ sơ trống riêng.
- External: thử email `@tdtu.edu.vn` không thuộc ngoại lệ → Student. Chuyển Internal rồi đăng nhập lại → Lecturer.
- Cả hai vai trò mở **Không gian làm việc → Quy chế Điểm rèn luyện**: Mười trang nội dung quy chế năm học 2025–2026 xuất hiện ngay trong ứng dụng; có nút phóng to/thu nhỏ, mở riêng và tải PDF gốc. Các trang là bản hiển thị từ PDF gốc, không gồm trang bìa Studocu; toàn bộ PDF gốc vẫn tải được.
- Hai thông báo minh họa ở đầu trang và cuối sidebar không còn. Các cảnh báo dữ liệu cũ, thiếu điểm hoặc chưa hoàn tất đánh giá vẫn có vì ảnh hưởng đến kết quả.

Việc đổi chế độ không reset SQLite và không chuyển điểm sang tài khoản khác. Không chạy `docker compose down -v` khi cần giữ dữ liệu.

## 5. Giới hạn trên Google khi Testing

External không tự cấp quyền Drive/Sheets. Google vẫn áp dụng danh sách test và các chính sách tài khoản/tổ chức khi xin scope bổ sung. Với External + Testing và scope ngoài đăng nhập cơ bản, quyền/refresh token thử nghiệm có thể hết hạn sau bảy ngày, cần kết nối lại. Chính sách quản trị Workspace cũng có thể chặn ứng dụng dù backend đã cho phép.

Nguồn chính thức:

- [Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en): Internal/External, Testing, ngoại lệ scope đăng nhập cơ bản và hạn bảy ngày.
- [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect): ý nghĩa aud, sub và hd.
- [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview): publishing status và kiểm soát của quản trị Workspace.
