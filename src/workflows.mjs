import { randomUUID, createHash } from 'node:crypto';

export function installWorkflowSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appeals(id TEXT PRIMARY KEY,studentId TEXT NOT NULL REFERENCES students(id),semester TEXT NOT NULL REFERENCES semesters(id),targetType TEXT NOT NULL,targetId TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS appeals_scope ON appeals(studentId,semester,status);
    CREATE TABLE IF NOT EXISTS appeal_events(id TEXT PRIMARY KEY,appealId TEXT NOT NULL REFERENCES appeals(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS adjustments(id TEXT PRIMARY KEY,appealId TEXT NOT NULL UNIQUE REFERENCES appeals(id),studentId TEXT NOT NULL,semester TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS record_replacements(originalId TEXT PRIMARY KEY REFERENCES records(id),replacementId TEXT NOT NULL UNIQUE REFERENCES records(id),appealId TEXT NOT NULL UNIQUE REFERENCES appeals(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,ownerUserId TEXT NOT NULL REFERENCES users(id),studentId TEXT NOT NULL REFERENCES students(id),semester TEXT NOT NULL REFERENCES semesters(id),purpose TEXT NOT NULL,appealId TEXT REFERENCES appeals(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence_events(id TEXT PRIMARY KEY,evidenceId TEXT NOT NULL REFERENCES evidence(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),studentId TEXT,semester TEXT,entityType TEXT,entityId TEXT,dedupeKey TEXT NOT NULL,payload TEXT NOT NULL,readAt TEXT,UNIQUE(userId,dedupeKey));
  `);
  for (const table of ['appeal_events', 'adjustments', 'record_replacements', 'evidence_events']) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Workflow history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Workflow history is immutable'); END;`);
  }
  const columns = db.prepare('PRAGMA table_info(claims)').all();
  if (!columns.some((column) => column.name === 'evidenceId'))
    db.exec('ALTER TABLE claims ADD COLUMN evidenceId TEXT REFERENCES evidence(id)');
}

export function createWorkflows(ctx) {
  const {
    one,
    all,
    run,
    transaction,
    authorize,
    isCoordinator,
    canReadStudent,
    assertStudentScope,
    readSemester,
    assertWritable,
    enrollmentFor,
    studentRow,
    checkedEntry,
    validateUniqueEntry,
    canonicalFor,
    now,
    getStore,
    RULE_VERSION,
    addAudit,
    validDate,
  } = ctx;
  const id = (prefix) => `${prefix}-${randomUUID()}`;
  const text = (value, max = 2000) =>
    String(value ?? '')
      .trim()
      .slice(0, max);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const required = (value, label, max = 2000) => {
    const result = text(value, max);
    if (!result) fail(`Thiếu ${label}.`);
    return result;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const activeAppeals = new Set(['pending', 'needs_info']);
  const parse = (row) => (row ? JSON.parse(row.payload) : null);
  const appealRow = (appealId) => parse(one('SELECT payload FROM appeals WHERE id=?', appealId));
  const evidenceRow = (evidenceId) =>
    parse(one('SELECT payload FROM evidence WHERE id=?', evidenceId));
  const staff = (user) => authorize(user, true);
  const usersForStudent = (studentId) => all('SELECT * FROM users WHERE studentId=?', studentId);
  const teachersForStudent = (studentId, semester) =>
    all("SELECT * FROM users WHERE role='LECTURER'").filter((user) =>
      canReadStudent(user, studentId, semester),
    );
  const scopeVisible = (actor, row) =>
    !row.studentId || canReadStudent(actor, row.studentId, row.semester);
  const notice = (
    recipients,
    { type, title, message, semester, studentId = null, entityType = null, entityId = null, key },
  ) => {
    let created = 0;
    for (const recipient of recipients) {
      if (!recipient?.id) continue;
      const notification = {
        id: id('notification'),
        type,
        title,
        message,
        semester,
        studentId,
        entityType,
        entityId,
        createdAt: now(),
        readAt: null,
      };
      created += Number(
        run(
          'INSERT OR IGNORE INTO notifications(id,userId,studentId,semester,entityType,entityId,dedupeKey,payload,readAt) VALUES(?,?,?,?,?,?,?,?,NULL)',
          notification.id,
          recipient.id,
          studentId,
          semester || null,
          entityType,
          entityId,
          key,
          JSON.stringify(notification),
        ).changes,
      );
    }
    return created;
  };
  const notifyStudent = (
    studentId,
    semester,
    type,
    title,
    message,
    key,
    entityType = null,
    entityId = null,
  ) =>
    notice(usersForStudent(studentId), {
      type,
      title,
      message,
      key,
      semester,
      studentId,
      entityType,
      entityId,
    });
  const notifyStaff = (
    studentId,
    semester,
    type,
    title,
    message,
    key,
    entityType = null,
    entityId = null,
  ) =>
    notice(teachersForStudent(studentId, semester), {
      type,
      title,
      message,
      key,
      semester,
      studentId,
      entityType,
      entityId,
    });
  const decorateAppeal = (row) => ({
    ...row,
    studentCode: studentRow(row.studentId)?.code || '',
    studentName: studentRow(row.studentId)?.name || '',
  });
  const targetFor = (actor, targetType, targetId, semester) => {
    let target, studentId;
    if (targetType === 'record') {
      target = one('SELECT * FROM records WHERE id=? AND semester=?', targetId, semester);
      studentId = target?.studentId;
    } else if (targetType === 'claim') {
      target = one('SELECT * FROM claims WHERE id=? AND semester=?', targetId, semester);
      studentId = target?.studentId;
    } else if (targetType === 'assessment') {
      studentId = targetId || actor.studentId;
      if (!studentRow(studentId)) fail('Hồ sơ sinh viên không tồn tại.', 404);
      target = getStore().getAssessment(actor, studentId, { semester }).assessment;
    } else fail('Loại khoản phúc tra không hợp lệ.');
    if (!target) fail('Khoản phúc tra không tồn tại trong học kỳ.', 404);
    assertStudentScope(actor, studentId, semester);
    if (!enrollmentFor(studentId, semester)) fail('Hồ sơ chưa có trong danh sách học kỳ.', 409);
    if (
      targetType === 'record' &&
      one('SELECT originalId FROM record_replacements WHERE originalId=?', targetId)
    )
      fail('Khoản này đã được thay thế. Hãy yêu cầu phúc tra khoản đang có hiệu lực.', 409);
    if (targetType === 'claim' && (target.status === 'matched' || target.officialRecordId))
      fail(
        'Kê khai đã đối soát. Hãy chọn khoản điểm chính thức đang có hiệu lực để phúc tra kết quả.',
        409,
      );
    return {
      target,
      studentId,
      title: targetType === 'assessment' ? 'Hồ sơ đánh giá học kỳ' : target.title,
    };
  };
  const writeAppeal = (row) =>
    run(
      'UPDATE appeals SET status=?,payload=? WHERE id=?',
      row.status,
      JSON.stringify(row),
      row.id,
    );
  const appealEvent = (actor, appeal, action, reason, before, after) => {
    const event = {
      id: id('appeal-event'),
      appealId: appeal.id,
      actorId: actor.id,
      actorName: actor.name,
      action,
      reason,
      before,
      after,
      createdAt: now(),
    };
    run(
      'INSERT INTO appeal_events(id,appealId,payload) VALUES(?,?,?)',
      event.id,
      appeal.id,
      JSON.stringify(event),
    );
    addAudit(actor, 'Phúc tra và điều chỉnh', JSON.stringify(event));
    return event;
  };
  const validUrl = (value) => {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (['https:', 'http:'].includes(url.protocol)) return url.href;
    } catch {}
    fail('Liên kết minh chứng không hợp lệ.');
  };
  const assertEvidenceAttachment = (actor, evidenceId, studentId, semester, appealId = null) => {
    const evidence = evidenceRow(required(evidenceId, 'mã minh chứng', 200));
    if (!evidence) fail('Minh chứng không tồn tại.', 404);
    if (
      evidence.ownerUserId !== actor.id ||
      evidence.studentId !== studentId ||
      evidence.semester !== semester
    )
      fail('Minh chứng không thuộc tài khoản, hồ sơ và học kỳ này.', 403);
    if (appealId && evidence.appealId !== appealId)
      fail('Minh chứng không thuộc yêu cầu phúc tra này.', 403);
    if (!appealId && evidence.purpose !== 'claim')
      fail('Minh chứng phúc tra không dùng cho kê khai khác.', 403);
    if (!evidence.url || ['uploading', 'failed'].includes(evidence.status))
      fail('Minh chứng chưa tải lên thành công.', 409);
    return evidence;
  };
  const currentAppeal = (actor, appealId) => {
    const appeal = appealRow(required(appealId, 'yêu cầu phúc tra', 200));
    if (!appeal) fail('Yêu cầu phúc tra không tồn tại.', 404);
    assertStudentScope(actor, appeal.studentId, appeal.semester);
    return appeal;
  };
  const approveRecord = (actor, appeal, correction, target) => {
    assertWritable(appeal.semester, actor);
    assertStudentScope(actor, appeal.studentId, appeal.semester, true);
    if (one('SELECT originalId FROM record_replacements WHERE originalId=?', target.id))
      fail('Khoản gốc đã được thay thế bởi một xử lý khác.', 409);
    const sourceId = required(correction.sourceId, 'mã nguồn điều chỉnh', 200);
    if (one('SELECT id FROM records WHERE semester=? AND sourceId=?', appeal.semester, sourceId))
      fail('Mã nguồn điều chỉnh đã tồn tại, không được ghi đè.', 409);
    const approvalReference = required(correction.approvalReference, 'căn cứ phê duyệt', 1000);
    const entry = checkedEntry({ ...correction, approvalReference });
    validateUniqueEntry(appeal.studentId, appeal.semester, entry, { excludeRecordId: target.id });
    const recordId = id('record'),
      batchId = id('batch');
    const row = {
      id: recordId,
      sourceId,
      studentId: appeal.studentId,
      activityId: target.activityId,
      title: required(correction.title || target.title, 'tên khoản', 300),
      categoryId: entry.categoryId,
      points: entry.points,
      date: validDate(correction.date || target.date),
      semester: appeal.semester,
      batchId,
      criterionId: entry.criterionId,
      quantity: entry.quantity,
      approvalReference,
      ruleVersion: RULE_VERSION,
    };
    // Keep an activity relation only when its current criterion still matches.
    if (row.criterionId !== target.criterionId || row.categoryId !== target.categoryId)
      row.activityId = null;
    const canonical = canonicalFor(row);
    run(
      'INSERT INTO batches(id,name,createdAt,rowCount,actorName) VALUES(?,?,?,?,?)',
      batchId,
      `Điều chỉnh phúc tra ${appeal.id}`,
      now(),
      1,
      actor.name,
    );
    run(
      'INSERT INTO records(id,sourceId,studentId,activityId,title,categoryId,points,date,semester,batchId,canonical,criterionId,quantity,approvalReference,ruleVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      row.id,
      row.sourceId,
      row.studentId,
      row.activityId,
      row.title,
      row.categoryId,
      row.points,
      row.date,
      row.semester,
      row.batchId,
      canonical,
      row.criterionId,
      row.quantity,
      row.approvalReference,
      row.ruleVersion,
    );
    const replacement = {
      originalId: target.id,
      replacementId: row.id,
      appealId: appeal.id,
      actorId: actor.id,
      actorName: actor.name,
      reason: appeal.resolutionReason,
      approvalReference,
      createdAt: now(),
      before: clone(target),
      after: { ...row, canonical },
    };
    run(
      'INSERT INTO record_replacements(originalId,replacementId,appealId,payload) VALUES(?,?,?,?)',
      target.id,
      row.id,
      appeal.id,
      JSON.stringify(replacement),
    );
    return replacement;
  };
  const activeRetryLease = (row) => {
    const started =
      row.retryStartedAt || (row.status === 'uploading' && row.fileId ? row.updatedAt : null);
    return !!started && Date.parse(now()) - Date.parse(started) < 5 * 60 * 1000;
  };
  const assertRetryToken = (row, token) => {
    if (
      row.retryToken
        ? token !== row.retryToken
        : token !== undefined && token !== null && token !== ''
    )
      fail(
        'Lượt chia sẻ này đã hết hiệu lực hoặc được thay bằng lượt mới. Hãy tải lại trạng thái minh chứng.',
        409,
      );
  };
  const decorateEvidence = (row, actor) => ({
    ...row,
    studentCode: canReadStudent(actor, row.studentId, row.semester)
      ? studentRow(row.studentId)?.code || ''
      : '',
    studentName: canReadStudent(actor, row.studentId, row.semester)
      ? studentRow(row.studentId)?.name || ''
      : '',
    canRetry:
      row.ownerUserId === actor.id &&
      !!row.fileId &&
      !activeRetryLease(row) &&
      (canReadStudent(actor, row.studentId, row.semester) || actor.studentId === row.studentId),
  });
  const writeEvidence = (row) =>
    run('UPDATE evidence SET payload=? WHERE id=?', JSON.stringify(row), row.id);
  const evidenceEvent = (actor, evidence, action, before) => {
    const event = {
      id: id('evidence-event'),
      evidenceId: evidence.id,
      actorId: actor.id,
      actorName: actor.name,
      action,
      before,
      after: clone(evidence),
      createdAt: now(),
    };
    run(
      'INSERT INTO evidence_events(id,evidenceId,payload) VALUES(?,?,?)',
      event.id,
      evidence.id,
      JSON.stringify(event),
    );
  };
  const evidenceScope = (actor, payload) => {
    const semester = readSemester(payload);
    const studentId =
      actor.role === 'STUDENT' ? actor.studentId : required(payload.studentId, 'sinh viên', 200);
    if (actor.role === 'STUDENT' && payload.studentId && payload.studentId !== actor.studentId)
      fail('Sinh viên chỉ được tải minh chứng cho chính mình.', 403);
    assertStudentScope(actor, studentId, semester, true);
    const purpose = payload.purpose || 'claim';
    let appealId = null;
    if (purpose === 'appeal') {
      const appeal = currentAppeal(actor, payload.appealId);
      if (
        appeal.studentId !== studentId ||
        appeal.semester !== semester ||
        !activeAppeals.has(appeal.status)
      )
        fail('Yêu cầu phúc tra không còn nhận bổ sung minh chứng.', 409);
      appealId = appeal.id;
    } else if (purpose === 'claim') assertWritable(semester, actor);
    else fail('Mục đích minh chứng không hợp lệ.');
    return { studentId, semester, purpose, appealId };
  };
  const evidenceReaders = (actor, row) =>
    canReadStudent(actor, row.studentId, row.semester) ||
    (row.ownerUserId === actor.id && actor.studentId === row.studentId);
  const repairEvidenceContext = (actor, payload) => {
    const evidence = evidenceRow(required(payload.evidenceId, 'minh chứng đã tải', 200));
    if (
      !evidence ||
      evidence.ownerUserId !== actor.id ||
      !evidence.fileId ||
      !evidenceReaders(actor, evidence)
    )
      fail('Không còn quyền chia sẻ lại minh chứng này.', 403);
    if (
      (payload.studentId && payload.studentId !== evidence.studentId) ||
      (payload.semester && payload.semester !== evidence.semester)
    )
      fail('Minh chứng không thuộc hồ sơ hoặc học kỳ đã chọn.', 403);
    if (payload.retryToken !== undefined) assertRetryToken(evidence, payload.retryToken);
    return {
      semester: evidence.semester,
      studentId: evidence.studentId,
      purpose: evidence.purpose,
      appealId: evidence.appealId,
      evidenceId: evidence.id,
      ...(payload.retryToken !== undefined ? { retryToken: payload.retryToken } : {}),
    };
  };
  const api = {
    appeals(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      const appeals = all(
        'SELECT payload FROM appeals WHERE semester=? ORDER BY rowid DESC',
        semester,
      )
        .map(parse)
        .filter(
          (row) =>
            canReadStudent(actor, row.studentId, semester) &&
            (!filters.status || row.status === filters.status),
        )
        .map(decorateAppeal);
      return { appeals, semester };
    },
    appeal(user, appealId) {
      const actor = authorize(user),
        appeal = currentAppeal(actor, appealId);
      const events = all(
        'SELECT payload FROM appeal_events WHERE appealId=? ORDER BY rowid',
        appeal.id,
      ).map(parse);
      let target;
      if (appeal.targetType === 'record')
        target = one('SELECT * FROM records WHERE id=?', appeal.targetId);
      else if (appeal.targetType === 'claim')
        target = one('SELECT * FROM claims WHERE id=?', appeal.targetId);
      else
        target = getStore().getAssessment(actor, appeal.studentId, {
          semester: appeal.semester,
        }).assessment;
      const adjustment = parse(one('SELECT payload FROM adjustments WHERE appealId=?', appeal.id));
      return {
        appeal: decorateAppeal(appeal),
        events,
        target,
        ...(adjustment ? { adjustment } : {}),
      };
    },
    createAppeal(user, payload = {}) {
      const actor = authorize(user);
      if (actor.role !== 'STUDENT') fail('Yêu cầu phúc tra được gửi bởi chính sinh viên.', 403);
      return transaction(() => {
        const semester = readSemester(payload),
          targetType = required(payload.targetType, 'loại khoản'),
          targetId = required(
            payload.targetId || (targetType === 'assessment' ? actor.studentId : ''),
            'mã khoản',
            200,
          );
        const { target, studentId, title } = targetFor(actor, targetType, targetId, semester);
        if (
          one(
            "SELECT id FROM appeals WHERE studentId=? AND semester=? AND targetType=? AND targetId=? AND status IN ('pending','needs_info')",
            studentId,
            semester,
            targetType,
            targetId,
          )
        )
          fail('Khoản này đang có yêu cầu phúc tra chưa kết thúc.', 409);
        if (payload.evidenceId)
          fail(
            'Tạo yêu cầu trước rồi tải/bổ sung minh chứng theo mã yêu cầu để bảo toàn liên kết.',
          );
        const appeal = {
          id: id('appeal'),
          studentId,
          semester,
          targetType,
          targetId,
          targetTitle: title,
          status: 'pending',
          reason: required(payload.reason, 'nội dung phúc tra'),
          evidenceUrl: validUrl(payload.evidenceUrl),
          evidenceId: null,
          createdAt: now(),
          updatedAt: now(),
          targetFingerprint: digest(target),
        };
        run(
          'INSERT INTO appeals(id,studentId,semester,targetType,targetId,status,payload) VALUES(?,?,?,?,?,?,?)',
          appeal.id,
          studentId,
          semester,
          targetType,
          targetId,
          appeal.status,
          JSON.stringify(appeal),
        );
        appealEvent(actor, appeal, 'submit', appeal.reason, null, clone(appeal));
        notifyStaff(
          studentId,
          semester,
          'appeal_submitted',
          'Có yêu cầu phúc tra',
          `${studentRow(studentId).code}: ${title}`,
          `appeal:${appeal.id}:submit`,
          'appeal',
          appeal.id,
        );
        return { appeal: decorateAppeal(appeal) };
      });
    },
    updateAppeal(user, appealId, payload = {}) {
      const actor = authorize(user);
      return transaction(() => {
        const appeal = currentAppeal(actor, appealId),
          before = clone(appeal),
          action = payload.action;
        if (!activeAppeals.has(appeal.status))
          fail('Yêu cầu đã kết thúc, không được ghi đè xử lý.', 409);
        const reason = required(payload.reason, 'lý do xử lý');
        if (actor.role === 'STUDENT') {
          if (actor.studentId !== appeal.studentId || !['supplement', 'withdraw'].includes(action))
            fail('Sinh viên không được duyệt hoặc xử lý thay người khác.', 403);
          if (action === 'withdraw') appeal.status = 'withdrawn';
          else {
            if (payload.evidenceId) {
              const evidence = assertEvidenceAttachment(
                actor,
                payload.evidenceId,
                appeal.studentId,
                appeal.semester,
                appeal.id,
              );
              appeal.evidenceId = evidence.id;
              appeal.evidenceUrl = evidence.url;
            } else if (payload.evidenceUrl !== undefined)
              appeal.evidenceUrl = validUrl(payload.evidenceUrl);
            appeal.status = 'pending';
          }
        } else {
          staff(actor);
          if (!['request_info', 'reject', 'approve'].includes(action))
            fail('Thao tác xử lý phúc tra không hợp lệ.');
          if (payload.evidenceId) {
            const evidence = assertEvidenceAttachment(
              actor,
              payload.evidenceId,
              appeal.studentId,
              appeal.semester,
              appeal.id,
            );
            appeal.evidenceId = evidence.id;
            appeal.evidenceUrl = evidence.url;
          }
          appeal.status = { request_info: 'needs_info', reject: 'rejected', approve: 'approved' }[
            action
          ];
          appeal.resolutionReason = reason;
        }
        let adjustment = null;
        if (action === 'approve') {
          assertWritable(appeal.semester, actor);
          const { target } = targetFor(actor, appeal.targetType, appeal.targetId, appeal.semester);
          if (digest(target) !== appeal.targetFingerprint)
            fail(
              'Dữ liệu khoản đã thay đổi từ khi gửi yêu cầu. Cần đối chiếu và tạo yêu cầu mới cho khoản hiện hành.',
              409,
            );
          const correction = payload.correction;
          if (!correction || typeof correction !== 'object' || Array.isArray(correction))
            fail('Thiếu nội dung điều chỉnh có căn cứ.');
          const approvalReference = required(
            correction.approvalReference,
            'căn cứ phê duyệt',
            1000,
          );
          let after;
          if (appeal.targetType === 'record') {
            const replacement = approveRecord(actor, appeal, correction, target);
            after = replacement.after;
          } else if (appeal.targetType === 'assessment')
            after = getStore().saveAssessment(actor, appeal.studentId, {
              ...correction,
              semester: appeal.semester,
            }).assessment;
          else {
            const outcome = getStore().reviewClaim(actor, appeal.targetId, {
              status: 'reviewed',
              note: `${reason}; căn cứ ${approvalReference}`,
            });
            after = outcome.claim;
          }
          adjustment = {
            id: id('adjustment'),
            appealId: appeal.id,
            studentId: appeal.studentId,
            semester: appeal.semester,
            targetType: appeal.targetType,
            targetId: appeal.targetId,
            actorId: actor.id,
            actorName: actor.name,
            reason,
            approvalReference,
            before: clone(target),
            after: clone(after),
            createdAt: now(),
          };
          run(
            'INSERT INTO adjustments(id,appealId,studentId,semester,payload) VALUES(?,?,?,?,?)',
            adjustment.id,
            appeal.id,
            appeal.studentId,
            appeal.semester,
            JSON.stringify(adjustment),
          );
          appeal.adjustmentId = adjustment.id;
        }
        appeal.updatedAt = now();
        writeAppeal(appeal);
        const event = appealEvent(actor, appeal, action, reason, before, clone(appeal));
        if (actor.role === 'STUDENT')
          notifyStaff(
            appeal.studentId,
            appeal.semester,
            'appeal_updated',
            'Phúc tra có cập nhật',
            reason,
            `appeal:${event.id}`,
            'appeal',
            appeal.id,
          );
        else
          notifyStudent(
            appeal.studentId,
            appeal.semester,
            'appeal_decision',
            'Yêu cầu phúc tra đã được xử lý',
            reason,
            `appeal:${event.id}`,
            'appeal',
            appeal.id,
          );
        return { appeal: decorateAppeal(appeal), ...(adjustment ? { adjustment } : {}) };
      });
    },
    notifications(user, filters = {}) {
      const actor = authorize(user);
      api.refreshNotifications();
      const notifications = all(
        'SELECT * FROM notifications WHERE userId=? ORDER BY rowid DESC',
        actor.id,
      )
        .filter(
          (row) =>
            scopeVisible(actor, row) && (!filters.semester || row.semester === filters.semester),
        )
        .map((row) => ({ ...parse(row), readAt: row.readAt }));
      return { notifications, unreadCount: notifications.filter((row) => !row.readAt).length };
    },
    readNotification(user, notificationId) {
      const actor = authorize(user),
        row = one('SELECT * FROM notifications WHERE id=? AND userId=?', notificationId, actor.id);
      if (!row || !scopeVisible(actor, row)) fail('Thông báo không thuộc phạm vi tài khoản.', 404);
      run(
        'UPDATE notifications SET readAt=COALESCE(readAt,?) WHERE id=? AND userId=?',
        now(),
        row.id,
        actor.id,
      );
      return { ok: true };
    },
    readAllNotifications(user) {
      const actor = authorize(user);
      for (const row of all(
        'SELECT * FROM notifications WHERE userId=? AND readAt IS NULL',
        actor.id,
      ))
        if (scopeVisible(actor, row))
          run('UPDATE notifications SET readAt=? WHERE id=?', now(), row.id);
      return { ok: true };
    },
    refreshNotifications() {
      let created = 0;
      const instant = Date.parse(now());
      for (const saved of all('SELECT payload FROM semesters')) {
        const semester = parse(saved);
        if (!semester.deadline || semester.state !== 'open') continue;
        const remaining = Date.parse(semester.deadline) - instant;
        if (remaining > 24 * 60 * 60 * 1000) continue;
        const kind = remaining <= 0 ? 'deadline_passed' : 'deadline_soon';
        for (const enrollment of all(
          'SELECT studentId FROM enrollments WHERE semester=?',
          semester.id,
        ))
          created += notice(usersForStudent(enrollment.studentId), {
            type: kind,
            title: remaining <= 0 ? 'Đã hết hạn kê khai' : 'Sắp đến hạn kê khai',
            message: `${semester.name}: ${semester.deadline}. Thời gian được kiểm tra bằng đồng hồ máy chủ.`,
            semester: semester.id,
            studentId: enrollment.studentId,
            entityType: 'semester',
            entityId: semester.id,
            key: `${kind}:${semester.id}:${semester.deadline}`,
          });
      }
      return { created };
    },
    beginEvidence(user, payload = {}) {
      const actor = authorize(user);
      return transaction(() => {
        const context = evidenceScope(actor, payload);
        const size = Number(payload.size);
        if (!Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024)
          fail('Kích thước minh chứng không hợp lệ.');
        if (
          !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(payload.mimeType)
        )
          fail('Định dạng minh chứng không hỗ trợ.');
        if (!/^[a-f0-9]{64}$/i.test(payload.sha256 || ''))
          fail('Thiếu checksum minh chứng do máy chủ tính.');
        const evidence = {
          id: id('evidence'),
          ownerUserId: actor.id,
          ...context,
          fileName: required(payload.fileName, 'tên tệp', 200),
          mimeType: payload.mimeType,
          size,
          sha256: payload.sha256.toLowerCase(),
          status: 'uploading',
          fileId: null,
          url: '',
          sharedWith: [],
          managedPermissions: [],
          retryStartedAt: null,
          retryToken: null,
          sharingComplete: false,
          shareErrors: [],
          cleanupErrors: [],
          error: '',
          createdAt: now(),
          updatedAt: now(),
        };
        run(
          'INSERT INTO evidence(id,ownerUserId,studentId,semester,purpose,appealId,payload) VALUES(?,?,?,?,?,?,?)',
          evidence.id,
          actor.id,
          evidence.studentId,
          evidence.semester,
          evidence.purpose,
          evidence.appealId,
          JSON.stringify(evidence),
        );
        evidenceEvent(actor, evidence, 'upload_started', null);
        return { evidence: decorateEvidence(evidence, actor) };
      });
    },
    finishEvidence(user, evidenceId, result = {}) {
      const actor = authorize(user);
      return transaction(() => {
        const evidence = evidenceRow(evidenceId);
        if (!evidence || evidence.ownerUserId !== actor.id)
          fail('Không được cập nhật minh chứng của tài khoản khác.', 403);
        assertRetryToken(evidence, result.retryToken);
        const before = clone(evidence),
          fileId = text(result.id || result.fileId, 200);
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) fail('Mã tệp Drive không hợp lệ.');
        evidence.fileId = fileId;
        evidence.url = `https://drive.google.com/file/d/${fileId}/view`;
        evidence.fileName = text(result.name || evidence.fileName, 200);
        evidence.sharedWith = Array.isArray(result.sharedWith)
          ? [...new Set(result.sharedWith.map((email) => text(email, 300).toLowerCase()))]
          : [];
        evidence.shareErrors = Array.isArray(result.shareErrors)
          ? result.shareErrors.map((email) => text(email, 300))
          : [];
        evidence.cleanupErrors = Array.isArray(result.cleanupErrors)
          ? result.cleanupErrors.map((email) => text(email, 300))
          : [];
        evidence.sharingComplete = result.sharingComplete === true;
        if (result.managedPermissions !== undefined) {
          if (!Array.isArray(result.managedPermissions))
            fail('Danh sách quyền minh chứng không hợp lệ.');
          const managed = new Map();
          for (const permission of result.managedPermissions) {
            const permissionId = text(permission?.id, 200),
              email = text(permission?.email, 300).toLowerCase();
            if (
              !/^[A-Za-z0-9_-]{1,200}$/.test(permissionId) ||
              !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
            )
              fail('Mã quyền hoặc email chia sẻ không hợp lệ.');
            if (managed.has(permissionId) && managed.get(permissionId).email !== email)
              fail('Mã quyền chia sẻ bị xung đột.');
            managed.set(permissionId, { id: permissionId, email });
          }
          evidence.managedPermissions = [...managed.values()];
        }
        evidence.status = evidence.sharingComplete
          ? 'shared'
          : result.scopeChanged
            ? 'needs_reshare'
            : 'sharing_failed';
        evidence.error = text(result.warning || '', 3000);
        evidence.retryStartedAt = null;
        evidence.retryToken = null;
        evidence.updatedAt = now();
        writeEvidence(evidence);
        evidenceEvent(actor, evidence, 'sharing_finished', before);
        notifyStudent(
          evidence.studentId,
          evidence.semester,
          'evidence_status',
          evidence.sharingComplete
            ? 'Minh chứng đã được chia sẻ'
            : 'Minh chứng cần kiểm tra chia sẻ',
          evidence.error || evidence.fileName,
          `evidence:${evidence.id}:${digest([evidence.status, evidence.sharedWith, evidence.error])}`,
          'evidence',
          evidence.id,
        );
        notice([one('SELECT * FROM users WHERE id=?', evidence.ownerUserId)], {
          type: 'evidence_status',
          title: evidence.sharingComplete
            ? 'Minh chứng đã được chia sẻ'
            : 'Minh chứng cần kiểm tra chia sẻ',
          message: evidence.error || evidence.fileName,
          semester: evidence.semester,
          studentId: evidence.studentId,
          entityType: 'evidence',
          entityId: evidence.id,
          key: `evidence:${evidence.id}:${digest([evidence.status, evidence.sharedWith, evidence.error])}`,
        });
        return { evidence: decorateEvidence(evidence, actor) };
      });
    },
    failEvidence(user, evidenceId, payload = {}) {
      const actor = authorize(user);
      return transaction(() => {
        const evidence = evidenceRow(evidenceId);
        if (!evidence || evidence.ownerUserId !== actor.id)
          fail('Không được cập nhật minh chứng của tài khoản khác.', 403);
        assertRetryToken(evidence, payload.retryToken);
        const before = clone(evidence);
        evidence.status = evidence.fileId ? 'sharing_failed' : 'failed';
        evidence.sharingComplete = false;
        evidence.error = text(payload.message || 'Không hoàn tất tải hoặc chia sẻ minh chứng.');
        evidence.retryStartedAt = null;
        evidence.retryToken = null;
        evidence.updatedAt = now();
        writeEvidence(evidence);
        evidenceEvent(actor, evidence, 'failed', before);
        const key = `evidence-failed:${evidence.id}:${digest(evidence.error)}`;
        notifyStudent(
          evidence.studentId,
          evidence.semester,
          'evidence_failed',
          'Minh chứng chưa hoàn tất',
          evidence.error,
          key,
          'evidence',
          evidence.id,
        );
        notice([one('SELECT * FROM users WHERE id=?', evidence.ownerUserId)], {
          type: 'evidence_failed',
          title: 'Minh chứng chưa hoàn tất',
          message: evidence.error,
          semester: evidence.semester,
          studentId: evidence.studentId,
          entityType: 'evidence',
          entityId: evidence.id,
          key,
        });
        return { evidence: decorateEvidence(evidence, actor) };
      });
    },
    evidenceList(user, filters = {}) {
      const actor = authorize(user),
        semester = readSemester(filters);
      return {
        evidence: all('SELECT payload FROM evidence WHERE semester=? ORDER BY rowid DESC', semester)
          .map(parse)
          .filter((row) => evidenceReaders(actor, row))
          .map((row) => decorateEvidence(row, actor)),
        semester,
      };
    },
    evidence(user, evidenceId) {
      const actor = authorize(user),
        evidence = evidenceRow(evidenceId);
      if (!evidence || !evidenceReaders(actor, evidence))
        fail('Minh chứng không thuộc phạm vi tài khoản.', 404);
      return {
        evidence: decorateEvidence(evidence, actor),
        events: all(
          'SELECT payload FROM evidence_events WHERE evidenceId=? ORDER BY rowid',
          evidence.id,
        ).map(parse),
      };
    },
    prepareEvidenceRetry(user, evidenceId) {
      const actor = authorize(user);
      return transaction(() => {
        const evidence = evidenceRow(evidenceId);
        if (!evidence || evidence.ownerUserId !== actor.id)
          fail('Chỉ chủ tệp đã tải lên được thử chia sẻ lại bằng tài khoản Google của mình.', 403);
        if (!evidence.fileId || activeRetryLease(evidence))
          fail('Tệp chưa sẵn sàng để chia sẻ lại.', 409);
        const context = repairEvidenceContext(actor, { ...evidence, evidenceId: evidence.id });
        const before = clone(evidence);
        const retryToken = id('sharing-attempt');
        evidence.status = 'uploading';
        evidence.sharingComplete = false;
        evidence.updatedAt = now();
        evidence.retryStartedAt = now();
        evidence.retryToken = retryToken;
        writeEvidence(evidence);
        const recipients = getStore().evidenceRecipients(actor, { ...context, retryToken });
        evidenceEvent(actor, evidence, 'sharing_retry_started', before);
        return {
          evidence: decorateEvidence(evidence, actor),
          recipients,
          retryToken,
        };
      });
    },
    requestEvidenceShare(user, evidenceId, payload = {}) {
      const actor = authorize(user);
      return transaction(() => {
        const evidence = evidenceRow(evidenceId);
        if (!evidence || !evidenceReaders(actor, evidence))
          fail('Minh chứng không thuộc phạm vi tài khoản.', 404);
        const reason = required(payload.reason, 'lý do yêu cầu chia sẻ lại');
        const before = clone(evidence);
        evidence.status = 'needs_reshare';
        evidence.sharingComplete = false;
        evidence.updatedAt = now();
        evidence.error = reason;
        writeEvidence(evidence);
        evidenceEvent(actor, evidence, 'share_requested', before);
        const owner = one('SELECT * FROM users WHERE id=?', evidence.ownerUserId);
        notice([owner], {
          type: 'evidence_share_requested',
          title: 'Minh chứng cần chia sẻ lại',
          message: reason,
          semester: evidence.semester,
          studentId: evidence.studentId,
          entityType: 'evidence',
          entityId: evidence.id,
          key: `share-request:${evidence.id}:${digest(reason)}`,
        });
        return { evidence: decorateEvidence(evidence, actor) };
      });
    },
  };
  const hooks = {
    assertEvidenceAttachment,
    evidenceScope,
    repairEvidenceContext,
    notifyStudent,
    notifyStaff,
    markEvidenceChanged(studentId, semester, reason) {
      for (const saved of all(
        'SELECT payload FROM evidence WHERE studentId=? AND semester=?',
        studentId,
        semester,
      )) {
        const evidence = parse(saved);
        if (!evidence.fileId || evidence.status === 'needs_reshare') continue;
        const before = clone(evidence);
        evidence.status = 'needs_reshare';
        evidence.sharingComplete = false;
        evidence.error = reason;
        evidence.updatedAt = now();
        writeEvidence(evidence);
        evidenceEvent(
          { id: 'system', name: 'Hệ thống phân công' },
          evidence,
          'scope_changed',
          before,
        );
        notice([one('SELECT * FROM users WHERE id=?', evidence.ownerUserId)], {
          type: 'evidence_scope_changed',
          title: 'Phân công thay đổi cần kiểm tra minh chứng',
          message: reason,
          semester,
          studentId,
          entityType: 'evidence',
          entityId: evidence.id,
          key: `scope:${evidence.id}:${now()}:${digest(reason)}`,
        });
      }
    },
  };
  return { api, hooks };
}
