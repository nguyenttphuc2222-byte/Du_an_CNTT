import { useEffect, useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api/v1";

const STORAGE_KEY = "conduct_session";
function readSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.expiresAt || Date.now() >= data.expiresAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
function navigate(path) {
  if (window.location.pathname !== path) window.history.replaceState({}, "", path);
}
export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(readSession);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const verify = async () => {
      const current = readSession();
      if (!current) {
        if (active) { setSession(null); setChecking(false); navigate("/login"); }
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${current.accessToken}` },
        });
        if (!res.ok) throw new Error("Phiên không hợp lệ");
        if (active) { setSession(current); setChecking(false); navigate("/dashboard"); }
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
        if (active) { setSession(null); setChecking(false); navigate("/login"); }
      }
    };
    verify();
    const timer = window.setInterval(() => {
      if (session && !readSession()) {
        setSession(null);
        navigate("/login");
      }
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.accessToken]);

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

      const next = { user: data.user, accessToken: data.access_token,
        expiresAt: Date.now() + 10 * 60 * 1000 };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
      navigate("/dashboard");
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
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    navigate("/login");
    setUsername("");
    setPassword("");
    setError("");
  }

  if (checking) return <main className="page-shell"><p>Đang kiểm tra phiên đăng nhập...</p></main>;
  if (session) return <Dashboard user={session.user} logout={logout} expiresAt={session.expiresAt} />;

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

const CRITERIA = [
  { number: "I", name: "Ý thức học tập", max: 20 },
  { number: "II", name: "Chấp hành pháp luật và nội quy", max: 25 },
  { number: "III", name: "Chấp hành nội quy, quy chế, quy định trong Trường", max: 20 },
  { number: "IV", name: "Tham gia hoạt động chính trị, xã hội, văn hóa, văn nghệ, thể thao và phong trào", max: 20 },
  { number: "V", name: "Tham gia hoạt động cộng đồng, công tác xã hội, công tác tình nguyện", max: 20 },
];
function Dashboard({ user, logout, expiresAt }) {
  const [semester, setSemester] = useState("2026-1");
  const [tab, setTab] = useState("activities");
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const interval = setInterval(() => setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-logo">DR</div>
        <div className="dashboard-nav">
          <div className="nav-active">▦ <span>Điểm rèn luyện</span></div>
          <div>▤ <span>Hoạt động</span></div>
          <div>☷ <span>Lịch sử điểm</span></div>
          <div>◉ <span>Thông báo</span></div>
        </div>
        <div className="sidebar-footer">Bản thử nghiệm · 0.2</div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div><p className="dashboard-kicker">HỆ THỐNG QUẢN LÝ ĐIỂM RÈN LUYỆN</p><h1>Trang chủ</h1></div>
          <div className="dashboard-account"><span>{user.full_name}<small>{roleLabel(user.role)} · {user.username}</small></span><button onClick={logout}>Đăng xuất</button></div>
        </header>
        <div className="session-strip">Phiên đăng nhập còn <strong>{minutes}:{seconds}</strong> · Hết 10 phút sẽ yêu cầu đăng nhập lại.</div>
        <section className="semester-bar"><label htmlFor="semester">Học kỳ:</label><select id="semester" value={semester} onChange={e => setSemester(e.target.value)}><option value="2026-1">Học kỳ 1 / 2026 - 2027</option><option value="2025-2">Học kỳ 2 / 2025 - 2026</option></select><span className="sample-badge">Dữ liệu minh họa</span></section>
        <section className="dashboard-panel">
          <div className="dashboard-tabs"><button className={tab === "activities" ? "selected" : ""} onClick={() => setTab("activities")}>Nội dung hoạt động</button><button className={tab === "results" ? "selected" : ""} onClick={() => setTab("results")}>Kết quả đánh giá điểm rèn luyện</button></div>
          {tab === "activities" ? <div className="criteria-content">{CRITERIA.map(group => <section className="criteria-section" key={group.number}><h2>{group.number}. {group.name} <span>(Tối đa {group.max} điểm)</span></h2><div className="table-scroll"><table><thead><tr><th>STT</th><th>Tên sự kiện</th><th>Thời gian tổ chức</th><th>Điểm (+/-)</th><th>Phản hồi</th></tr></thead><tbody><tr><td colSpan="5" className="empty-cell">Chưa có hoạt động được ghi nhận trong dữ liệu thử nghiệm.</td></tr></tbody></table></div></section>)}</div> : <div className="results-placeholder"><h2>Kết quả đánh giá điểm rèn luyện</h2><p>Chưa có dữ liệu đánh giá cho học kỳ này. Khi tích hợp API điểm rèn luyện, kết quả sẽ hiển thị tại đây.</p></div>}
        </section>
      </div>
    </div>
  );
}
