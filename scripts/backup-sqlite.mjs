import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || !path.isAbsolute(source) || !path.isAbsolute(destination))
  throw new Error('Absolute database paths required');
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source);
try {
  db.exec("VACUUM INTO '" + destination.replaceAll("'", "''") + "'");
  console.log('SQLite snapshot created');
} finally {
  db.close();
}
