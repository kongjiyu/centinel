import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/centinel-phase0.sqlite');

export async function sqliteSmoke(): Promise<{ status: string; message?: string }> {
  try {
    const SQL = await initSqlJs();

    let db;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(
      'INSERT INTO projects (name, description) VALUES (?, ?)',
      ['Phase 0 Sample Project', 'SQLite persistence validation']
    );

    const stmt = db.prepare('SELECT name, description FROM projects WHERE name = ?');
    stmt.bind(['Phase 0 Sample Project']);
    const rows: string[][] = [];
    while (stmt.step()) {
      rows.push(stmt.get() as string[]);
    }
    stmt.free();

    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    db.close();

    if (rows.length === 0) {
      return { status: 'fail', message: 'Could not read back inserted project' };
    }
    const row = rows[0];
    if (row[0] !== 'Phase 0 Sample Project') {
      return { status: 'fail', message: `Read mismatch: ${JSON.stringify(row)}` };
    }
    return { status: 'pass' };
  } catch (err) {
    return { status: 'fail', message: String(err) };
  }
}
