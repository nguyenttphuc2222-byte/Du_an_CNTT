# Hệ thống quản lý điểm rèn luyện — Student Conduct System

Dự án web quản lý điểm rèn luyện sinh viên, đang phát triển theo từng giai đoạn. **Phiên bản hiện tại** đã có đăng nhập, trang chủ minh họa và kiểm soát phiên JWT trong 10 phút. Dữ liệu hoạt động/điểm trên trang chủ hiện là **dữ liệu mẫu**, chưa kết nối với dữ liệu điểm rèn luyện thực tế.

## 1. Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | React (JavaScript), Vite |
| Backend | Python, FastAPI |
| Database | MySQL |
| Xác thực | Mật khẩu băm, JWT Bearer |

## 2. Chức năng hiện tại

- Đăng nhập bằng tên đăng nhập và mật khẩu qua `POST /api/v1/auth/login`.
- Trang chủ `/dashboard`: menu bên trái, lựa chọn học kỳ, tab nội dung hoạt động/kết quả đánh giá và bảng điểm minh họa.
- Đăng xuất và điều hướng về `/login`.
- Bảo vệ trang `/dashboard`: chưa đăng nhập hoặc phiên hết hạn sẽ chuyển về `/login`.
- Phiên đăng nhập **10 phút tính từ lúc đăng nhập**, không tự gia hạn khi thao tác. Token được lưu trong `sessionStorage` của tab: reload trước hạn vẫn giữ phiên, đóng tab sẽ mất phiên.
- Khi tải lại trang, frontend gọi `GET /api/v1/auth/me` để xác minh JWT; backend từ chối token không hợp lệ hoặc đã hết hạn.

> Đây là bản thử nghiệm local, chưa phải hệ thống xác thực sẵn sàng triển khai thực tế. Các chức năng quản lý hoạt động, chấm điểm, phê duyệt và khiếu nại sẽ được phát triển sau.

## 3. Cấu trúc thư mục

```text
Du_an_CNTT/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/auth.py
│   │   ├── core/config.py
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── main.py
│   │   └── seed_demo_user.py
│   ├── .env.example
│   └── requirements.txt
├── database/
│   └── schema.sql
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

## 4. Yêu cầu môi trường

- Python 3.11 trở lên
- Node.js (bản LTS) và npm
- MySQL Server 8 trở lên (hoặc bản tương thích)
- Git (nếu làm việc nhóm)

Các lệnh dưới đây dành cho **PowerShell trên Windows**, chạy từ thư mục gốc dự án.

## 5. Cài đặt và chạy local

### 5.1. Tạo database

Mở MySQL Workbench hoặc MySQL CLI và chạy file `database/schema.sql`. Script tạo database `student_conduct` và bảng `users` phục vụ đăng nhập.

### 5.2. Backend FastAPI

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Mở `backend/.env` và thay thông tin MySQL cùng khóa JWT bằng giá trị **riêng trên máy**. Ví dụ cấu hình:

```dotenv
DATABASE_URL=mysql+pymysql://root:YOUR_PASSWORD@127.0.0.1:3306/student_conduct
JWT_SECRET_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Nếu đã có `.env` hoạt động, **không chép đè**; chỉ kiểm tra `ACCESS_TOKEN_EXPIRE_MINUTES=10`.

Tạo tài khoản demo lần đầu và khởi động API:

```powershell
python -m app.seed_demo_user
python -m uvicorn app.main:app --reload
```

Backend: <http://127.0.0.1:8000>  
Swagger API: <http://127.0.0.1:8000/docs>

Tài khoản demo local (nếu đã chạy seed):

- Tên đăng nhập: `student1`
- Mật khẩu: `Student@123`

**Không dùng thông tin đăng nhập demo trên môi trường thật.**

### 5.3. Frontend React

Mở terminal thứ hai tại thư mục gốc dự án:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Nếu đã có `frontend/.env` thì giữ nguyên. Đảm bảo file có:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

Mở <http://127.0.0.1:5173/login> (hoặc địa chỉ Vite hiển thị).

## 6. API xác thực

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | Xác minh tài khoản và cấp JWT |
| GET | `/api/v1/auth/me` | Lấy thông tin người dùng từ JWT hợp lệ |
| GET | `/api/v1/auth/health` | Kiểm tra endpoint sức khỏe phần auth |

Khi gọi `/auth/me`, gửi header:

```http
Authorization: Bearer <ACCESS_TOKEN>
```

Trong Swagger, nếu endpoint đã cấu hình HTTP Bearer, nhấn **Authorize**, nhập JWT vừa nhận từ `/login`, rồi thử `/auth/me`.

## 7. Kiểm thử trước khi commit

1. Đăng nhập đúng → chuyển đến `/dashboard`.
2. Đăng nhập sai → hiển thị lỗi, không vào trang chủ.
3. Reload trong vòng 10 phút → vẫn giữ đăng nhập.
4. Đợi hơn 10 phút từ lúc cấp JWT, gọi lại `/auth/me` bằng **token cũ** → nhận `401 Unauthorized`.
5. Reload trang sau khi hết hạn → quay về `/login`.
6. Đăng xuất rồi truy cập trực tiếp `/dashboard` → quay về `/login`.
7. Kiểm tra menu, học kỳ, tab và bảng dữ liệu minh họa trên trang chủ.

## 8. Làm việc nhóm và Git

- `main`: nhánh ổn định; `dev`: tích hợp và thử nghiệm chức năng mới.
- Chỉ commit mã nguồn, `database/schema.sql`, `requirements.txt`, `package.json`, `package-lock.json`, `.env.example` và tài liệu.
- **Không commit** `.env`, `.venv/`, `node_modules/`, `__pycache__/`, mật khẩu hoặc JWT secret thật.
- Mỗi thành viên tạo `.env` từ `.env.example` và cấu hình MySQL trên máy mình.
- Trước khi push: chạy `git status --short` và kiểm tra danh sách file đã stage.

## 9. Hướng phát triển tiếp theo

- Thiết kế bảng học kỳ, tiêu chí rèn luyện, hoạt động và bản ghi điểm.
- Kết nối trang chủ với dữ liệu MySQL qua API FastAPI.
- Phân quyền sinh viên, đơn vị tổ chức và người duyệt điểm.
- Xây dựng đăng ký hoạt động, điểm danh, xét duyệt điểm, lịch sử thay đổi và khiếu nại.
- Bổ sung kiểm thử tự động, giới hạn đăng nhập, quản lý tài khoản và bảo mật triển khai trước khi đưa lên môi trường thật.
