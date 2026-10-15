import { useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api/v1";

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loggedInUser, setLoggedInUser] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "Không thể đăng nhập. Vui lòng thử lại.");
      }

      // Keep token in memory for this starter; refreshing signs the user out.
      setLoggedInUser({ ...data.user, accessToken: data.access_token });
      setPassword("");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Không kết nối được máy chủ. Hãy kiểm tra backend FastAPI."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setLoggedInUser(null);
    setUsername("");
    setPassword("");
    setError("");
  }

  if (loggedInUser) {
    return (
      <main className="page-shell">
        <section className="welcome-card" aria-live="polite">
          <div className="brand-mark large">DR</div>
          <p className="eyebrow">ĐĂNG NHẬP THÀNH CÔNG</p>
          <h1>Xin chào, {loggedInUser.full_name}!</h1>
          <p className="welcome-copy">
            Bạn đã đăng nhập vào bản thử nghiệm của Hệ thống quản lý điểm rèn luyện.
          </p>
          <div className="user-detail">
            <span>Tên đăng nhập</span>
            <strong>{loggedInUser.username}</strong>
          </div>
          <div className="user-detail">
            <span>Vai trò</span>
            <strong>{roleLabel(loggedInUser.role)}</strong>
          </div>
          <p className="prototype-note">
            Đây mới là màn hình xác nhận đăng nhập. Dashboard và các chức năng
            nghiệp vụ sẽ được xây dựng ở bước tiếp theo.
          </p>
          <button className="primary-button" onClick={logout}>Đăng xuất</button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="login-card">
        <div className="brand-area">
          <div className="brand-mark">DR</div>
          <div>
            <p className="brand-name">RÈN LUYỆN SỐ</p>
            <p className="brand-caption">Hệ thống quản lý điểm rèn luyện</p>
          </div>
        </div>

        <div className="heading-area">
          <p className="eyebrow">CHÀO MỪNG BẠN</p>
          <h1>Đăng nhập</h1>
          <p className="subtitle">
            Đăng nhập để theo dõi hoạt động và quá trình rèn luyện của bạn.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Tên đăng nhập</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="Nhập tên đăng nhập"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={50}
          />

          <div className="password-label-row">
            <label htmlFor="password">Mật khẩu</label>
          </div>
          <div className="password-input-wrap">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={128}
            />
            <button
              className="show-password"
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              {showPassword ? "Ẩn" : "Hiện"}
            </button>
          </div>

          {error && <div className="error-message" role="alert">{error}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <div className="demo-box">
          <span className="demo-dot" />
          <div>
            <strong>Tài khoản thử nghiệm</strong>
            <p>Tên đăng nhập: <code>student1</code></p>
            <p>Mật khẩu: <code>Student@123</code></p>
          </div>
        </div>

        <p className="footer-note">
          Bản thử nghiệm dành cho phát triển nội bộ của nhóm.
        </p>
      </section>

      <aside className="side-panel">
        <div className="side-decoration decoration-one" />
        <div className="side-decoration decoration-two" />
        <div className="side-content">
          <div className="side-icon">✦</div>
          <p className="side-kicker">CHỦ ĐỘNG RÈN LUYỆN</p>
          <h2>Mỗi hoạt động,<br />một bước trưởng thành.</h2>
          <p>
            Theo dõi hoạt động, cập nhật điểm và quản lý hành trình rèn luyện
            của bạn trên một nền tảng tập trung.
          </p>
          <div className="side-bottom">
            <span className="status-dot" />
            Phiên bản thử nghiệm · 0.1
          </div>
        </div>
      </aside>
    </main>
  );
}

function roleLabel(role) {
  const labels = {
    student: "Sinh viên",
    organizer: "Ban tổ chức",
    staff: "Đơn vị phụ trách",
    admin: "Quản trị viên",
  };
  return labels[role] || role;
}
