// Datenbankzugang (Postgres, z. B. Neon über den Vercel Marketplace)
import pg from 'pg';

let pool = null;
let ready = null;

export function setPool(p) { pool = p; ready = null; }   // für Tests
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!cs) throw Object.assign(new Error('DATABASE_URL ist nicht gesetzt'), { expose: true });
    pool = new pg.Pool({ connectionString: cs, max: 3, idleTimeoutMillis: 10000 });
  }
  return pool;
}
export const q = (text, params) => getPool().query(text, params);
export const client = () => getPool().connect();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tp_users (id SERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE, pass_hash TEXT NOT NULL, role VARCHAR(10) NOT NULL, token_ver INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tp_projects (id VARCHAR(64) PRIMARY KEY, name VARCHAR(200) NOT NULL, json TEXT NOT NULL, version INTEGER NOT NULL, updated_at BIGINT NOT NULL, updated_by INTEGER NULL)`,
  `CREATE TABLE IF NOT EXISTS tp_history (id SERIAL PRIMARY KEY, project_id VARCHAR(64) NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, saved_at BIGINT NOT NULL, user_id INTEGER NULL)`,
  `CREATE INDEX IF NOT EXISTS tp_history_idx ON tp_history (project_id, version)`,
  `CREATE TABLE IF NOT EXISTS tp_presence (user_id INTEGER PRIMARY KEY, project_id VARCHAR(64) NULL, seen BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tp_login_attempts (id SERIAL PRIMARY KEY, ip VARCHAR(64) NOT NULL, uname VARCHAR(80) NOT NULL, at BIGINT NOT NULL)`
];
export function ensureSchema() {
  if (!ready) ready = (async () => { for (const s of SCHEMA) await q(s); })().catch(e => { ready = null; throw e; });
  return ready;
}
