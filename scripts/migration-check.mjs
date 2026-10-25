import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';
const source = 'artifacts/backups/before-pdf-rules-20261024.sqlite';
const target = 'artifacts/migration-check.sqlite';
const digest = () => createHash('sha256').update(readFileSync(source)).digest('hex');
const hash = digest();
copyFileSync(source, target);
const snapshot = (database) => {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return {
      records: db
        .prepare(
          'SELECT id,sourceId,studentId,activityId,title,categoryId,points,date,semester,batchId FROM records ORDER BY id',
        )
        .all(),
      claims: db
        .prepare(
          'SELECT id,studentId,activityId,title,claimedPoints,evidenceUrl,note,status,officialRecordId,semester FROM claims ORDER BY id',
        )
        .all(),
      users: db
        .prepare('SELECT id,name,email,role,studentId,provider,googleSub FROM users ORDER BY id')
        .all(),
      students: db.prepare('SELECT id,code,name,email,classId FROM students ORDER BY id').all(),
      audit: db.prepare('SELECT count(*) n FROM audit').get().n,
    };
  } finally {
    db.close();
  }
};
const before = snapshot(source);
let store = openStore({ dbPath: target });
const lecturer = store.getUser('demo-lecturer');
const legacy = store.legacyData(lecturer, { semester: '2026-2027-HK1' });
assert.equal(
  legacy.records.length,
  before.records.filter((r) => r.semester === '2026-2027-HK1').length,
);
store.close();
const after = snapshot(target);
assert.deepEqual(after.records, before.records);
assert.deepEqual(after.claims, before.claims);
assert.deepEqual(after.users, before.users);
for (const student of after.students) {
  const previous = before.students.find((s) => s.id === student.id);
  const google = before.users.find(
    (u) => u.studentId === student.id && u.provider === 'google' && u.googleSub && u.name.trim(),
  );
  assert.deepEqual({ ...student, name: previous.name }, { ...previous });
  assert.equal(student.name, google?.name || previous.name);
}
assert.equal(digest(), hash, 'Original backup must remain unchanged');
store = openStore({ dbPath: target });
store.close();
assert.equal(snapshot(target).audit, after.audit, 'Reopening must not repeat migration');
console.log(
  JSON.stringify({
    ok: true,
    recordsPreserved: after.records.length,
    claimsPreserved: after.claims.length,
    usersPreserved: after.users.length,
    studentsPreserved: after.students.length,
    legacyRecords: legacy.records.length,
    backupUnchanged: true,
  }),
);
