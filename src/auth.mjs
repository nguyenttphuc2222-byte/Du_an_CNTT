import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const SESSION_COOKIE = 'tdtu_conduct_session';
const OAUTH_COOKIE = 'tdtu_conduct_oauth';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DOMAINS = ['student.tdtu.edu.vn', 'tdtu.edu.vn'];
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
function randomToken() {
  return randomBytes(32).toString('base64url');
}
function equalTokens(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const a = Buffer.from(first),
    b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}
function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 16_384) return null;
  const values = raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentId: user.studentId ?? null,
    provider: user.provider,
  };
}

export function createAuth({ store, config }) {
  const configuredBase = new URL(config.baseUrl || 'http://localhost:3000');
  if (
    !['http:', 'https:'].includes(configuredBase.protocol) ||
    configuredBase.username ||
    configuredBase.password
  )
    throw new Error('BASE_URL phải là địa chỉ HTTP hoặc HTTPS hợp lệ.');
  const baseUrl = configuredBase.origin;
  const secure = configuredBase.protocol === 'https:';
  const demoEnabled = config.demoEnabled === true;
  const authAudience = String(config.authAudience ?? 'internal')
    .trim()
    .toLowerCase();
  if (!['internal', 'external'].includes(authAudience))
    throw new Error('GOOGLE_AUTH_AUDIENCE phải là internal hoặc external.');
  const googleConfigured = Boolean(config.googleClientId && config.googleClientSecret);
  const allowedDomains = new Set(
    (config.allowedDomains ?? DEFAULT_DOMAINS).map((value) => value.trim().toLowerCase()),
  );
  const allowedHostedDomains = new Set(
    (config.allowedHostedDomains ?? DEFAULT_DOMAINS).map((value) => value.trim().toLowerCase()),
  );
  const lecturerEmails = new Set(
    (config.lecturerEmails ?? []).map((value) => value.trim().toLowerCase()),
  );
  const sessions = new Map(),
    pendingOAuth = new Map(),
    workspaceGrants = new Map();
  function newClient() {
    return new OAuth2Client({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: `${baseUrl}/auth/google/callback`,
    });
  }
  const client = googleConfigured ? newClient() : null;

  function setCookie(res, name, value, maxAge) {
    const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [
      ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
      cookie,
    ]);
  }
  function prune() {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
    for (const [key, value] of pendingOAuth) if (value.expiresAt <= now) pendingOAuth.delete(key);
  }
  function currentSession(req) {
    const token = readCookie(req, SESSION_COOKIE),
      session = token ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session;
  }
  function getUser(req) {
    const session = currentSession(req);
    if (!session) return null;
    const user = store.getUser(session.userId);
    if (!user) return null;
    // DB provider can change after linking a demo profile; authentication method cannot.
    return publicUser({ ...user, provider: session.authMethod });
  }
  function snapshot(user) {
    return {
      user: publicUser(user),
      auth: { googleConfigured, demoEnabled, authAudience },
      demoUsers: demoEnabled
        ? store.getDemoUsers().map((user) => publicUser({ ...user, provider: 'demo' }))
        : [],
      settings: store.getSettings(),
      access: user ? store.access(user) : null,
    };
  }
  function sessionData(req) {
    return snapshot(getUser(req));
  }
  function createSession(req, res, user, authMethod, googleSub = null) {
    prune();
    const previous = readCookie(req, SESSION_COOKIE);
    if (previous) sessions.delete(previous);
    const token = randomToken();
    sessions.set(token, {
      userId: user.id,
      authMethod,
      googleSub,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    setCookie(res, SESSION_COOKIE, token, SESSION_TTL_MS / 1000);
    return publicUser({ ...user, provider: authMethod });
  }
  function demoLogin(req, res, payload = {}) {
    if (!demoEnabled) throw fail(403, 'Đăng nhập minh họa đang tắt.');
    const demoUser =
      typeof payload?.userId === 'string'
        ? store.getDemoUsers().find((user) => user.id === payload.userId)
        : null;
    if (!demoUser) throw fail(403, 'Vui lòng chọn tài khoản minh họa hợp lệ.');
    const user = store.getUser(demoUser.id);
    if (!user) throw fail(403, 'Tài khoản minh họa không còn khả dụng.');
    return snapshot(createSession(req, res, user, 'demo'));
  }
  function logout(req, res) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    setCookie(res, SESSION_COOKIE, '', 0);
    const binding = readCookie(req, OAUTH_COOKIE);
    if (binding)
      for (const [state, attempt] of pendingOAuth)
        if (equalTokens(attempt.binding, binding)) pendingOAuth.delete(state);
    setCookie(res, OAUTH_COOKIE, '', 0);
    return { ok: true };
  }
  function requireGoogleSession(req) {
    const session = currentSession(req),
      user = getUser(req);
    if (!session || !user) throw fail(401, 'Vui lòng đăng nhập bằng tài khoản Google.');
    if (session.authMethod !== 'google' || !session.googleSub)
      throw fail(
        403,
        'Tài khoản minh họa không kết nối Google Workspace. Hãy đăng nhập Google thật.',
      );
    return { session, user };
  }
  function startFlow(req, res, purpose) {
    if (!client) throw fail(400, 'Đăng nhập Google chưa được cấu hình trên máy chủ.');
    const identity = purpose === 'workspace' ? requireGoogleSession(req) : null;
    prune();
    while (pendingOAuth.size >= 1000) pendingOAuth.delete(pendingOAuth.keys().next().value);
    const state = randomToken(),
      binding = randomToken(),
      nonce = randomToken(),
      verifier = randomToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    pendingOAuth.set(state, {
      binding,
      nonce,
      verifier,
      purpose,
      userId: identity?.user.id,
      googleSub: identity?.session.googleSub,
      expiresAt: Date.now() + OAUTH_TTL_MS,
    });
    setCookie(res, OAUTH_COOKIE, binding, OAUTH_TTL_MS / 1000);
    const authorizationUrl = client.generateAuthUrl({
      scope:
        purpose === 'workspace'
          ? [...IDENTITY_SCOPES, DRIVE_FILE_SCOPE, SHEETS_READONLY_SCOPE]
          : IDENTITY_SCOPES,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: purpose === 'workspace' ? 'offline' : 'online',
      include_granted_scopes: purpose === 'workspace' ? true : undefined,
      prompt: purpose === 'workspace' ? 'consent' : 'select_account',
      login_hint: identity?.user.email,
      ...(authAudience === 'internal' ? { hd: '*' } : {}),
    });
    res.writeHead(303, { Location: authorizationUrl });
    res.end();
  }
  function startGoogle(req, res) {
    return startFlow(req, res, 'login');
  }
  function startWorkspace(req, res) {
    return startFlow(req, res, 'workspace');
  }

  async function finishGoogle(req, res, url) {
    if (!client) throw fail(400, 'Đăng nhập Google chưa được cấu hình trên máy chủ.');
    const callback = url instanceof URL ? url : new URL(url, baseUrl);
    const state = callback.searchParams.get('state'),
      binding = readCookie(req, OAUTH_COOKIE);
    const attempt = typeof state === 'string' ? pendingOAuth.get(state) : null;
    setCookie(res, OAUTH_COOKIE, '', 0);
    if (
      callback.searchParams.getAll('state').length !== 1 ||
      !attempt ||
      attempt.expiresAt <= Date.now() ||
      !equalTokens(attempt.binding, binding)
    )
      throw fail(400, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
    pendingOAuth.delete(state);
    if (callback.searchParams.has('error'))
      throw fail(400, 'Đăng nhập Google chưa hoàn tất. Vui lòng thử lại.');
    const code = callback.searchParams.get('code');
    if (callback.searchParams.getAll('code').length !== 1 || !code || code.length > 4096)
      throw fail(400, 'Google chưa cung cấp mã đăng nhập hợp lệ.');
    const currentIdentity = attempt.purpose === 'workspace' ? requireGoogleSession(req) : null;
    if (
      currentIdentity &&
      (currentIdentity.user.id !== attempt.userId ||
        currentIdentity.session.googleSub !== attempt.googleSub)
    )
      throw fail(403, 'Tài khoản đã thay đổi trong khi kết nối Google. Vui lòng kết nối lại.');
    let payload, tokens;
    try {
      ({ tokens } = await client.getToken({ code, codeVerifier: attempt.verifier }));
      if (!tokens.id_token) throw new Error('Missing ID token');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw fail(400, 'Không thể xác minh đăng nhập Google. Vui lòng thử lại.');
    }
    if (
      !payload ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
      payload.aud !== config.googleClientId ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.email_verified !== true ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now() ||
      !equalTokens(payload.nonce, attempt.nonce)
    )
      throw fail(400, 'Thông tin xác thực Google không hợp lệ. Vui lòng đăng nhập lại.');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 300)
      throw fail(400, 'Email Google không hợp lệ.');
    const parts = email.split('@'),
      hostedDomain = typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : '';
    if (
      authAudience === 'internal' &&
      (!DEFAULT_DOMAINS.includes(parts[1]) ||
        !allowedDomains.has(parts[1]) ||
        !DEFAULT_DOMAINS.includes(hostedDomain) ||
        !allowedHostedDomains.has(hostedDomain))
    )
      throw fail(403, 'Ứng dụng chỉ dành cho tài khoản Google Workspace TDTU được cho phép.');
    if (attempt.purpose === 'workspace') {
      if (payload.sub !== attempt.googleSub || payload.sub !== currentIdentity.session.googleSub)
        throw fail(403, 'Hãy cấp quyền bằng đúng tài khoản Google đang đăng nhập ứng dụng.');
      const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [];
      if (
        !tokens.access_token ||
        !grantedScopes.includes(DRIVE_FILE_SCOPE) ||
        !grantedScopes.includes(SHEETS_READONLY_SCOPE)
      )
        throw fail(
          403,
          'Chưa cấp đủ quyền Google Drive và Google Sheets. Vui lòng kết nối lại và chấp nhận các quyền cần thiết.',
        );
      const existing = workspaceGrants.get(payload.sub);
      const workspaceClient = newClient();
      workspaceClient.setCredentials({
        ...tokens,
        refresh_token: tokens.refresh_token || existing?.client.credentials.refresh_token,
      });
      workspaceGrants.set(payload.sub, { client: workspaceClient, email, scopes: grantedScopes });
      res.writeHead(303, { Location: '/?googleConnected=1' });
      res.end();
      return;
    }
    const role =
      lecturerEmails.has(email) || (authAudience === 'internal' && parts[1] === 'tdtu.edu.vn')
        ? 'LECTURER'
        : 'STUDENT';
    const user = store.ensureGoogleUser({
      sub: payload.sub,
      email,
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email,
      role,
      authAudience,
    });
    createSession(req, res, user, 'google', payload.sub);
    res.writeHead(303, { Location: '/' });
    res.end();
  }

  function workspaceStatus(req) {
    const session = currentSession(req),
      user = getUser(req);
    const grant =
      session?.authMethod === 'google' && user ? workspaceGrants.get(session.googleSub) : null;
    const credentials = grant?.client.credentials;
    const connected = Boolean(
      credentials &&
      (credentials.refresh_token ||
        (credentials.access_token &&
          (!credentials.expiry_date || credentials.expiry_date > Date.now()))),
    );
    return {
      configured: googleConfigured,
      connected,
      scopes: connected ? [...grant.scopes] : [],
      ...(session?.authMethod === 'google' && user ? { email: user.email } : {}),
      ...(config.googleApiKey ? { pickerApiKey: config.googleApiKey } : {}),
      ...(googleConfigured ? { clientId: config.googleClientId } : {}),
      ...(config.googleAppId ? { appId: config.googleAppId } : {}),
    };
  }
  function requireGrant(req) {
    const { session } = requireGoogleSession(req),
      grant = workspaceGrants.get(session.googleSub);
    if (!grant || !workspaceStatus(req).connected)
      throw fail(403, 'Chưa kết nối Google Workspace. Vui lòng chọn Kết nối Google trước.');
    return { grant, sub: session.googleSub };
  }
  function googleApiError(error, sub) {
    const status = Number(error?.response?.status);
    const reason = error?.response?.data?.error;
    if (status === 401 || reason === 'invalid_grant') {
      workspaceGrants.delete(sub);
      return fail(401, 'Quyền kết nối Google đã hết hạn hoặc bị thu hồi. Vui lòng kết nối lại.');
    }
    if (status === 403)
      return fail(
        403,
        'Google từ chối quyền truy cập. Hãy kiểm tra quyền chia sẻ tệp và bảo đảm Drive API, Sheets API đã bật.',
      );
    if (status === 404)
      return fail(404, 'Không tìm thấy tệp Google hoặc tài khoản chưa được cấp quyền truy cập.');
    return fail(502, 'Không thể thực hiện yêu cầu Google Workspace. Vui lòng thử lại.');
  }
  async function googleRequest(req, apiUrl, { method = 'GET', body, headers = {} } = {}) {
    const { grant, sub } = requireGrant(req);
    let url;
    try {
      url = new URL(apiUrl);
    } catch {
      throw fail(400, 'Địa chỉ Google API không hợp lệ.');
    }
    const sheetRoute =
      url.hostname === 'sheets.googleapis.com' &&
      /^\/v4\/spreadsheets(?:\/[A-Za-z0-9_-]+(?:\/values(?::batchUpdate|\/[^/]+)?)?)?$/.test(
        url.pathname,
      );
    const driveRoute =
      url.hostname === 'www.googleapis.com' &&
      /^\/(?:upload\/)?drive\/v3\/files(?:\/[A-Za-z0-9_-]+(?:\/permissions)?)?$/.test(url.pathname);
    const permissionDeleteRoute =
      url.hostname === 'www.googleapis.com' &&
      /^\/drive\/v3\/files\/[A-Za-z0-9_-]+\/permissions\/[A-Za-z0-9_-]+$/.test(url.pathname);
    const supportedRequest =
      method === 'DELETE'
        ? permissionDeleteRoute
        : ['GET', 'POST', 'PUT'].includes(method) && (sheetRoute || driveRoute);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !supportedRequest
    )
      throw fail(400, 'Yêu cầu Google API nằm ngoài phạm vi hỗ trợ.');
    try {
      const response = await grant.client.request({
        url: url.href,
        method,
        ...(body === undefined ? {} : { data: body }),
        headers: Object.fromEntries(
          Object.entries(headers).filter(([name]) => name.toLowerCase() === 'content-type'),
        ),
        responseType: 'json',
        timeout: 20000,
        maxRedirects: 0,
      });
      return response.data;
    } catch (error) {
      throw googleApiError(error, sub);
    }
  }
  async function pickerToken(req) {
    const { grant, sub } = requireGrant(req);
    try {
      const { token } = await grant.client.getAccessToken();
      if (!token) throw new Error('No access token');
      return {
        accessToken: token,
        expiresIn: Math.max(
          0,
          Math.floor(
            ((grant.client.credentials.expiry_date || Date.now() + 3600000) - Date.now()) / 1000,
          ),
        ),
        tokenType: 'Bearer',
      };
    } catch (error) {
      throw googleApiError(error, sub);
    }
  }
  function close() {
    sessions.clear();
    pendingOAuth.clear();
    workspaceGrants.clear();
  }
  return {
    getUser,
    sessionData,
    demoLogin,
    logout,
    startGoogle,
    finishGoogle,
    close,
    workspaceStatus,
    startWorkspace,
    googleRequest,
    pickerToken,
  };
}
