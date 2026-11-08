import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

const SECOND = '2026-2027-HK2';
async function fixture(t) {
  let instant = '2026-11-08T00:00:00.000Z';
  const app = await createApp({
    port: 0,
    dbPath: ':memory:',
    clock: () => instant,
    config: {
      demoEnabled: true,
      googleClientId: '',
      googleClientSecret: '',
      coordinatorEmails: [],
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function client(userId) {
    let cookies = '';
    const request = async (path, method = 'GET', payload) => {
      const response = await fetch(base + path, {
        method,
        headers: { Cookie: cookies, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (response.headers.getSetCookie().length)
        cookies = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      return response;
    };
    await request('/api/auth/demo', 'POST', { userId });
    return request;
  }
  return {
    app,
    coordinator: await client('demo-lecturer'),
    student: await client('demo-student'),
    other: await client('demo-student-2'),
    setTime: (value) => {
      instant = value;
    },
  };
}
async function ok(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
  return response.json();
}

test('HTTP appeal on a closed term preserves snapshot and appends one effective replacement after explicit reopen', async (t) => {
  const { coordinator, student, other } = await fixture(t);
  await ok(
    await coordinator('/api/assessments/s001', 'PUT', {
      semester: SECOND,
      gpa: 8.5,
      complianceConfirmed: true,
      offlineActivityCount: 7,
    }),
  );
  const activity = (
    await ok(
      await coordinator('/api/activities', 'POST', {
        semester: SECOND,
        title: 'Hội thảo phúc tra',
        organizer: 'Khoa CNTT',
        criterionId: 'academic_seminar',
        quantity: 1,
        date: '2026-11-08',
        mode: 'offline',
      }),
      201,
    )
  ).activity;
  const claim = (
    await ok(
      await student('/api/claims', 'POST', {
        semester: SECOND,
        activityId: activity.id,
        criterionId: 'academic_seminar',
        quantity: 1,
      }),
      201,
    )
  ).claim;
  const source = {
    sourceId: 'APPEAL-ORIGINAL',
    studentCode: '523h0080',
    semester: SECOND,
    activityId: activity.id,
    title: activity.title,
    criterionId: 'academic_seminar',
    quantity: 1,
    date: '2026-11-08',
  };
  await ok(await coordinator('/api/import/commit', 'POST', { rows: [source] }));
  const original = (await (await student('/api/official-records?semester=' + SECOND)).json())
    .records[0];
  const closing = await ok(
    await coordinator(`/api/semesters/${SECOND}/transition`, 'POST', {
      action: 'close',
      reason: 'Công bố trước phúc tra',
      acknowledgeIncomplete: true,
    }),
  );
  const snapshotPath = `/api/semesters/${SECOND}/snapshots/${closing.snapshot.id}`;
  const frozen = await (await coordinator(snapshotPath)).json();
  const appeal = (
    await ok(
      await student('/api/appeals', 'POST', {
        semester: SECOND,
        targetType: 'record',
        targetId: original.id,
        reason: 'Nguồn ghi thiếu một lần tham gia',
        evidenceUrl: 'https://example.test/proof.pdf',
      }),
      201,
    )
  ).appeal;
  assert.ok([403, 404].includes((await other(`/api/appeals/${appeal.id}`)).status));
  const correction = {
    sourceId: 'APPEAL-CORRECTED',
    criterionId: 'academic_seminar',
    quantity: 2,
    approvalReference: 'QD-PHUC-TRA-01',
  };
  assert.equal(
    (
      await coordinator(`/api/appeals/${appeal.id}/resolve`, 'POST', {
        action: 'approve',
        reason: 'Có căn cứ điều chỉnh',
        correction,
      })
    ).status,
    409,
  );
  await ok(
    await coordinator(`/api/appeals/${appeal.id}/resolve`, 'POST', {
      action: 'request_info',
      reason: 'Bổ sung văn bản xác nhận',
    }),
  );
  await ok(
    await student(`/api/appeals/${appeal.id}/respond`, 'POST', {
      action: 'supplement',
      reason: 'Đã bổ sung văn bản xác nhận',
      evidenceUrl: 'https://example.test/confirmation.pdf',
    }),
  );
  await ok(
    await coordinator(`/api/semesters/${SECOND}/transition`, 'POST', {
      action: 'reopen',
      reason: 'Xử lý phúc tra có căn cứ',
    }),
  );
  const decided = await ok(
    await coordinator(`/api/appeals/${appeal.id}/resolve`, 'POST', {
      action: 'approve',
      reason: 'Xác nhận đủ hai lần tham gia',
      correction,
    }),
  );
  assert.equal(decided.appeal.status, 'approved');
  const summary = await (await student('/api/dashboard?semester=' + SECOND)).json();
  assert.equal(
    summary.student.officialTotal,
    46,
    '36 assessment + replacement10; original5 must not add again',
  );
  const records = (await (await student('/api/official-records?semester=' + SECOND)).json())
    .records;
  assert.equal(records.length, 2);
  assert.equal(records.find((row) => row.id === original.id).sourceId, original.sourceId);
  assert.equal(
    (await (await student('/api/claims?semester=' + SECOND)).json()).claims.find(
      (row) => row.id === claim.id,
    ).officialRecordId,
    original.id,
  );
  assert.equal(
    (await ok(await coordinator('/api/import/commit', 'POST', { rows: [source] }))).inserted,
    0,
  );
  assert.ok(
    [400, 409].includes(
      (
        await coordinator(`/api/appeals/${appeal.id}/resolve`, 'POST', {
          action: 'approve',
          reason: 'Không được áp dụng hai lần',
          correction,
        })
      ).status,
    ),
  );
  assert.deepEqual(await (await coordinator(snapshotPath)).json(), frozen);
  const detail = await ok(await student(`/api/appeals/${appeal.id}`));
  assert.ok(detail.events.length >= 4);
});

test('HTTP claim appeal approval only reviews evidence and never awards official points', async (t) => {
  const { coordinator, student } = await fixture(t);
  const claim = (
    await ok(
      await student('/api/claims', 'POST', {
        semester: SECOND,
        title: 'Seminar cần kiểm tra lại',
        organizer: 'Khoa CNTT',
        date: '2026-11-08',
        criterionId: 'academic_seminar',
        quantity: 1,
      }),
      201,
    )
  ).claim;
  await ok(
    await coordinator(`/api/claims/${claim.id}`, 'PATCH', {
      status: 'rejected',
      note: 'Cần xác nhận rõ minh chứng',
    }),
  );
  const appeal = (
    await ok(
      await student('/api/appeals', 'POST', {
        semester: SECOND,
        targetType: 'claim',
        targetId: claim.id,
        reason: 'Có xác nhận tham gia bổ sung',
      }),
      201,
    )
  ).appeal;
  await ok(
    await coordinator(`/api/appeals/${appeal.id}/resolve`, 'POST', {
      action: 'approve',
      reason: 'Minh chứng đủ để kiểm tra lại kê khai',
      correction: { approvalReference: 'PT-KK-01' },
    }),
  );
  const dashboard = await (await student('/api/dashboard?semester=' + SECOND)).json();
  assert.equal(dashboard.student.hasOfficialData, false);
  assert.equal(dashboard.student.pendingTotal, 5);
  assert.equal(
    (await (await student('/api/official-records?semester=' + SECOND)).json()).records.length,
    0,
  );
});

test('HTTP notifications persist read state, enforce ownership and deduplicate server-clock deadline reminders', async (t) => {
  const { coordinator, student, other, setTime } = await fixture(t);
  await ok(
    await coordinator(`/api/semesters/${SECOND}`, 'PATCH', {
      deadline: '2026-11-09T00:00:00.000Z',
    }),
  );
  const first = await ok(await student('/api/notifications'));
  assert.ok(first.notifications.length > 0);
  assert.equal(typeof first.unreadCount, 'number');
  assert.deepEqual(await (await student('/api/notifications')).json(), first);
  const id = first.notifications[0].id;
  assert.ok(
    [403, 404].includes((await other(`/api/notifications/${id}/read`, 'PATCH', {})).status),
  );
  await ok(await student(`/api/notifications/${id}/read`, 'PATCH', {}));
  await ok(await student('/api/notifications/read-all', 'POST', {}));
  assert.equal((await (await student('/api/notifications')).json()).unreadCount, 0);
  setTime('2026-11-09T00:00:00.000Z');
  const afterDeadline = await ok(await student('/api/notifications'));
  assert.ok(afterDeadline.notifications.length > first.notifications.length);
  assert.deepEqual(await (await student('/api/notifications')).json(), afterDeadline);
});

test('HTTP evidence history is private and failed upload state is retained without accepting client-supplied sharing truth', async (t) => {
  const { app, student, other } = await fixture(t);
  const actor = app.store.getUser('demo-student');
  const evidence = app.store.beginEvidence(actor, {
    semester: SECOND,
    studentId: actor.studentId,
    purpose: 'claim',
    fileName: 'minh-chung.pdf',
    mimeType: 'application/pdf',
    size: 12,
    sha256: 'a'.repeat(64),
  }).evidence;
  app.store.failEvidence(actor, evidence.id, { message: 'Google mô phỏng từ chối tải' });
  const saved = (await ok(await student(`/api/evidence/${evidence.id}`))).evidence;
  assert.ok(['failed', 'upload_failed'].includes(saved.state || saved.status));
  assert.ok([403, 404].includes((await other(`/api/evidence/${evidence.id}`)).status));
  assert.equal(
    (await student(`/api/evidence/${evidence.id}/retry`, 'POST', { sharingComplete: true })).status,
    403,
    'Demo cannot repair Google permissions without a real grant',
  );
  assert.equal(
    (await (await student('/api/evidence?semester=' + SECOND)).json()).evidence.length,
    1,
  );
});
