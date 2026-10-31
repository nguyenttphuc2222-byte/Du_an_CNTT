# Cập nhật 0.3.0

- Thêm GOOGLE_AUTH_AUDIENCE để chuyển chính sách Internal/External mà không sửa mã nguồn.
- Internal phân quyền theo miền trường và ngoại lệ; External chỉ cấp Lecturer cho LECTURER_EMAILS.
- Cập nhật vai trò khi đăng nhập lại; giữ định danh Google, hồ sơ sinh viên, điểm và minh chứng khi đổi vai trò.
- Thêm trang Quy chế Điểm rèn luyện cho cả hai vai trò, xem PDF 2025–2026 trực tiếp trong ứng dụng.
- Bỏ banner minh họa đầu trang/cuối sidebar; giữ các thông báo cần đối chiếu dữ liệu hoặc thiếu thông tin đánh giá.
- Cập nhật Docker, cấu hình mẫu và kiểm thử phân quyền/hiển thị. Hướng dẫn chuyển chế độ: GOOGLE_AUTH_AUDIENCE.md.

Quy chế và công thức điểm giữ như bản 0.2.0. Chuyển Audience không tự thay đổi quy chế, reset cơ sở dữ liệu hoặc tạo điểm demo cho tài khoản Google mới.

Xác minh: 137 kiểm thử tự động đạt, bao gồm OAuth giả lập đi qua HTTP và SQLite thực tế trong bộ kiểm thử. Kiểm tra trình duyệt và container được thực hiện riêng; đăng nhập và cấp quyền Google thật cần thao tác bằng tài khoản của người demo.
