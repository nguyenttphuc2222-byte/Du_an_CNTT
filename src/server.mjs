import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { createAuth } from './auth.mjs';
import { createGoogleWorkspace } from './google.mjs';
import { RULE_VERSION, RULE_SOURCE } from './regulations.mjs';
import {
  parseUpload,
  makeCsv,
  makeImportWorkbook,
  makeReportWorkbook,
  reportRows,
  IMPORT_COLUMNS,
} from './files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 12 * 1024 * 1024;
function error(status, message) {
  return Object.assign(new Error(message), { status });
}
const list = (value, fallback) =>
  String(value ?? fallback)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
export async function createApp(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const config = {
    port,
    host: process.env.HOST || '127.0.0.1',
    baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    demoEnabled: process.env.DEMO_ENABLED === 'true',
    authAudience: process.env.GOOGLE_AUTH_AUDIENCE ?? 'internal',
    lecturerEmails: list(process.env.LECTURER_EMAILS, '523h0025@student.tdtu.edu.vn'),
    allowedDomains: list(process.env.ALLOWED_EMAIL_DOMAINS, 'student.tdtu.edu.vn,tdtu.edu.vn'),
    allowedHostedDomains: list(
      process.env.ALLOWED_HOSTED_DOMAINS,
      'student.tdtu.edu.vn,tdtu.edu.vn',
    ),
    ...options.config,
  };
  config.authAudience = String(config.authAudience).trim().toLowerCase();
  if (!['internal', 'external'].includes(config.authAudience))
    throw error(500, 'GOOGLE_AUTH_AUDIENCE phải là internal hoặc external.');
  if (!config.demoEnabled && (!config.googleClientId || !config.googleClientSecret))
    throw error(500, 'Đã tắt tài khoản demo nhưng chưa cấu hình Google OAuth.');
  const dbPath =
    options.dbPath ??
    path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data'), 'conduct.sqlite');
  if (dbPath !== ':memory:') await mkdir(path.dirname(dbPath), { recursive: true });
  const store = openStore({ dbPath });
  const auth = createAuth({ store, config });
  const google = createGoogleWorkspace({ auth, store, config });
  const loginAttempts = new Map();
  function guardRate(req) {
    const address = req.socket.remoteAddress || 'local';
    const now = Date.now();
    const entry = loginAttempts.get(address);
    if (entry && now - entry.start < 60000) {
      if (entry.count >= 40)
        throw error(429, 'Bạn thao tác đăng nhập quá nhanh. Hãy thử lại sau một phút.');
      entry.count++;
    } else loginAttempts.set(address, { start: now, count: 1 });
    if (loginAttempts.size > 1000)
      for (const [key, value] of loginAttempts)
        if (now - value.start > 60000) loginAttempts.delete(key);
  }
  function current(req) {
    const user = auth.getUser(req);
    if (!user) throw error(401, 'Vui lòng đăng nhập để tiếp tục.');
    return user;
  }
  function lecturer(req) {
    const user = current(req);
    if (user.role !== 'LECTURER') throw error(403, 'Chức năng này dành cho cán bộ/giảng viên.');
    return user;
  }
  function json(res, status, payload) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  }
  function download(res, content, name, type) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'))
      throw error(415, 'Yêu cầu cần dùng application/json.');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw error(413, 'Dữ liệu vượt quá giới hạn 12 MB.');
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw error(400, 'Nội dung JSON không hợp lệ.');
    }
  }
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    let url;
    try {
      const base = new URL(config.baseUrl);
      url = new URL(req.url, base);
      const actualPort = server.address()?.port ?? config.port;
      const hosts = new Set([base.host, `localhost:${actualPort}`, `127.0.0.1:${actualPort}`]);
      if (!hosts.has(req.headers.host))
        throw error(403, 'Host không được phép. Hãy mở địa chỉ localhost của ứng dụng.');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.headers.origin;
        const expected = new Set([
          base.origin,
          `http://localhost:${actualPort}`,
          `http://127.0.0.1:${actualPort}`,
        ]);
        if ((origin && !expected.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site')
          throw error(403, 'Yêu cầu khác nguồn đã bị từ chối.');
      }
      const pathname = url.pathname;
      const method = req.method;
      const filters = Object.fromEntries(url.searchParams);
      if (method === 'GET' && pathname === '/api/health')
        return json(res, 200, {
          ok: true,
          version: '0.3.0',
          storage: 'SQLite',
          ruleVersion: RULE_VERSION,
          scoringSource: RULE_SOURCE.url,
        });
      if (method === 'GET' && pathname === '/api/session')
        return json(res, 200, auth.sessionData(req));
      if (method === 'POST' && pathname === '/api/auth/demo') {
        guardRate(req);
        return json(res, 200, auth.demoLogin(req, res, await body(req)));
      }
      if (method === 'POST' && pathname === '/api/auth/logout') {
        await body(req);
        return json(res, 200, auth.logout(req, res));
      }
      if (method === 'GET' && pathname === '/auth/google') {
        guardRate(req);
        return await auth.startGoogle(req, res);
      }
      if (method === 'GET' && pathname === '/auth/google/connect') {
        guardRate(req);
        return await auth.startWorkspace(req, res, url);
      }
      if (method === 'GET' && pathname === '/auth/google/callback')
        return await auth.finishGoogle(req, res, url);
      if (method === 'GET' && pathname === '/api/google/status') {
        current(req);
        return json(res, 200, google.status(req));
      }
      if (method === 'GET' && pathname === '/api/google/files') {
        current(req);
        return json(res, 200, await google.listFiles(req));
      }
      if (method === 'POST' && pathname === '/api/google/sheets/preview') {
        lecturer(req);
        return json(res, 200, await google.previewSheet(req, await body(req)));
      }
      if (method === 'POST' && pathname === '/api/google/sheets/commit') {
        const user = lecturer(req);
        const payload = await body(req);
        return json(
          res,
          200,
          store.commitImport(user, {
            rows: await parseUpload(payload),
            batchName: payload.batchName || 'Google Sheets',
          }),
        );
      }
      if (method === 'POST' && pathname === '/api/google/reports') {
        lecturer(req);
        return json(res, 201, await google.exportReport(req, await body(req)));
      }
      if (method === 'POST' && pathname === '/api/google/evidence') {
        current(req);
        return json(res, 201, await google.uploadEvidence(req, await body(req)));
      }
      if (method === 'GET' && /^\/regulations\/page-(0[1-9]|10)\.png$/.test(pathname)) {
        const content = await readFile(
          path.join(ROOT, 'public', 'regulations', path.basename(pathname)),
        );
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        res.end(content);
        return;
      }
      if (method === 'GET' && pathname === '/docs/quy-che-ren-luyen-tdtu.pdf') {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self'");
        const content = await readFile(path.join(ROOT, 'docs', 'quy-che-ren-luyen-tdtu.pdf'));
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-cache',
          'Content-Disposition': 'inline; filename="quy-che-ren-luyen-tdtu.pdf"',
        });
        res.end(content);
        return;
      }
      if (/^\/api\/assessments\/[^/]+$/.test(pathname)) {
        const studentId = decodeURIComponent(pathname.split('/').pop());
        if (method === 'GET')
          return json(res, 200, store.getAssessment(current(req), studentId, filters));
        if (method === 'PUT')
          return json(res, 200, store.saveAssessment(lecturer(req), studentId, await body(req)));
      }
      if (method === 'GET' && /^\/api\/course\/[^/]+$/.test(pathname))
        return json(
          res,
          200,
          store.courseSummary(current(req), decodeURIComponent(pathname.split('/').pop()), filters),
        );
      if (method === 'GET' && pathname === '/api/legacy')
        return json(res, 200, store.legacyData(lecturer(req), filters));
      if (method === 'POST' && pathname === '/api/legacy/reclassify')
        return json(res, 200, store.reclassifyLegacy(lecturer(req), await body(req)));
      if (method === 'GET' && pathname === '/api/dashboard')
        return json(res, 200, store.dashboard(current(req), filters));
      if (method === 'GET' && pathname === '/api/students')
        return json(res, 200, store.students(lecturer(req), filters));
      if (method === 'GET' && pathname === '/api/activities')
        return json(res, 200, store.activities(current(req), filters));
      if (method === 'POST' && pathname === '/api/activities')
        return json(res, 201, store.createActivity(lecturer(req), await body(req)));
      if (method === 'GET' && pathname === '/api/claims')
        return json(res, 200, store.claims(current(req), filters));
      if (method === 'POST' && pathname === '/api/claims')
        return json(res, 201, store.createClaim(current(req), await body(req)));
      if (method === 'PATCH' && /^\/api\/claims\/[^/]+$/.test(pathname))
        return json(
          res,
          200,
          store.reviewClaim(
            lecturer(req),
            decodeURIComponent(pathname.split('/').pop()),
            await body(req),
          ),
        );
      if (method === 'GET' && pathname === '/api/official-records')
        return json(res, 200, store.officialRecords(current(req), filters));
      if (method === 'POST' && pathname === '/api/import/preview') {
        const user = lecturer(req);
        return json(res, 200, store.previewImport(user, await parseUpload(await body(req))));
      }
      if (method === 'POST' && pathname === '/api/import/commit') {
        const user = lecturer(req);
        const payload = await body(req);
        return json(
          res,
          200,
          store.commitImport(user, {
            rows: await parseUpload(payload),
            batchName: payload.batchName || payload.fileName || 'Nhập dữ liệu',
          }),
        );
      }
      if (method === 'GET' && pathname === '/api/reconciliation')
        return json(res, 200, store.reconciliation(lecturer(req), filters));
      if (method === 'POST' && pathname === '/api/reconciliation')
        return json(res, 200, store.matchClaim(lecturer(req), await body(req)));
      if (method === 'GET' && pathname === '/api/reports')
        return json(res, 200, store.reports(lecturer(req), filters));
      if (method === 'GET' && pathname === '/api/audit')
        return json(res, 200, store.audit(lecturer(req)));
      if (method === 'GET' && pathname === '/api/settings') {
        current(req);
        return json(res, 200, { settings: store.getSettings() });
      }
      if (method === 'PUT' && pathname === '/api/settings')
        return json(res, 200, store.updateSettings(lecturer(req), await body(req)));
      if (method === 'GET' && /^\/api\/import\/template\.(xlsx|csv)$/.test(pathname)) {
        lecturer(req);
        if (pathname.endsWith('.csv'))
          return download(
            res,
            makeCsv(IMPORT_COLUMNS, []),
            'mau-nhap-diem.csv',
            'text/csv; charset=utf-8',
          );
        return download(
          res,
          await makeImportWorkbook([]),
          'mau-nhap-diem.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      }
      if (method === 'GET' && /^\/api\/demo\/scenario\.(xlsx|csv)$/.test(pathname)) {
        lecturer(req);
        if (!config.demoEnabled) throw error(404, 'Chức năng dữ liệu mẫu đang tắt.');
        const rows = store.getScenarioRows();
        if (pathname.endsWith('.csv'))
          return download(
            res,
            makeCsv(IMPORT_COLUMNS, rows),
            'du-lieu-demo-doi-soat.csv',
            'text/csv; charset=utf-8',
          );
        return download(
          res,
          await makeImportWorkbook(rows),
          'du-lieu-demo-doi-soat.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      }
      if (method === 'GET' && /^\/api\/export\/report\.(xlsx|csv)$/.test(pathname)) {
        const report = store.reports(lecturer(req), filters);
        if (pathname.endsWith('.csv')) {
          const rows = reportRows(report);
          return download(
            res,
            makeCsv(rows.length ? Object.keys(rows[0]) : ['MSSV', 'Họ tên', 'Lớp'], rows),
            'bao-cao-ren-luyen.csv',
            'text/csv; charset=utf-8',
          );
        }
        return download(
          res,
          await makeReportWorkbook(report),
          'bao-cao-ren-luyen.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      }
      const assets = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
        '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
      };
      if (method === 'GET' && assets[pathname]) {
        const [name, type] = assets[pathname];
        const content = await readFile(path.join(ROOT, 'public', name));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(content);
        return;
      }
      if (method === 'GET' && pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      throw error(404, 'Không tìm thấy đường dẫn.');
    } catch (cause) {
      if (res.writableEnded) return;
      const status = Number(cause.status) || 500;
      const message =
        status < 500
          ? cause.message
          : 'Ứng dụng gặp lỗi. Hãy thử lại hoặc kiểm tra cửa sổ máy chủ.';
      if (status >= 500) console.error('[server]', cause.stack || cause.message);
      if (url?.pathname === '/auth/google/callback') {
        res.writeHead(303, {
          Location: '/?authError=' + encodeURIComponent(message),
          'Cache-Control': 'no-store',
        });
        res.end();
      } else json(res, status, { error: message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    store,
    auth,
    config,
    close: async () => {
      auth.close();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const app = await createApp();
    app.server.once('error', (cause) => {
      console.error(
        cause.code === 'EADDRINUSE'
          ? `Cổng ${app.config.port} đang được dùng. Hãy đổi PORT và BASE_URL trong .env.`
          : cause.message,
      );
      process.exitCode = 1;
      app.auth.close();
      app.store.close();
    });
    app.server.listen(app.config.port, app.config.host, () => {
      console.log(`\nTDTU Conduct Demo: ${app.config.baseUrl}`);
      console.log(
        `Lưu trữ: SQLite | Tài khoản demo: ${app.config.demoEnabled ? 'bật' : 'tắt'} | Google OAuth: ${app.config.googleClientId && app.config.googleClientSecret ? 'đã cấu hình' : 'chưa cấu hình'}`,
      );
      console.log(
        'Dữ liệu demo. Chấm điểm theo PDF TDTU được cung cấp, hiệu lực từ năm học 2025–2026.\n',
      );
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        await app.close();
        process.exit(0);
      });
  } catch (cause) {
    console.error('Không khởi động được:', cause.message);
    process.exitCode = 1;
  }
}
