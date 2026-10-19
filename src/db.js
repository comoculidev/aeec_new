'use strict';
// SQLite access layer (built-in node:sqlite). Every query is a prepared statement with bound
// parameters - user input is never concatenated into SQL.
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    if (cache.size > 800) cache.clear();
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const get = (sql, ...p) => stmt(sql).get(...p);
const all = (sql, ...p) => stmt(sql).all(...p);
const run = (sql, ...p) => stmt(sql).run(...p);
let depth = 0;
function tx(fn) {
  if (depth > 0) return fn(); // nested call joins the outer transaction
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}
const now = () => new Date().toISOString();
// Local calendar day (YYYY-MM-DD) for a timestamp, using the configured fixed UTC offset.
const dayOf = (d) => new Date((d ? new Date(d).getTime() : Date.now()) + config.tzOffsetMin * 60000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ schema */
const MIGRATIONS = [
  /* v1 */ `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE permissions (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, module TEXT NOT NULL, label TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id));
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, password_changed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, remember INTEGER NOT NULL DEFAULT 0, mfa_pending INTEGER NOT NULL DEFAULT 0,
  ip TEXT, user_agent TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE media (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('image','video','file')),
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, ext TEXT NOT NULL,
  size INTEGER NOT NULL, folder TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '',
  is_private INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL);
CREATE INDEX idx_media_lib ON media(is_private, created_at);

CREATE TABLE news (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '', cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  gallery TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  is_featured INTEGER NOT NULL DEFAULT 0, published_at TEXT, seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '', i18n TEXT NOT NULL DEFAULT '{}', views INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_news_status ON news(status, published_at);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '', sector TEXT NOT NULL DEFAULT '', project_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','completed','archived')),
  is_active INTEGER NOT NULL DEFAULT 1, main_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  gallery TEXT NOT NULL DEFAULT '[]', documents TEXT NOT NULL DEFAULT '[]', stats TEXT NOT NULL DEFAULT '[]',
  seo_title TEXT NOT NULL DEFAULT '', seo_description TEXT NOT NULL DEFAULT '', i18n TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_projects_status ON projects(status, is_active);

CREATE TABLE services (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, short_description TEXT NOT NULL DEFAULT '',
  full_description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
  image_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, features TEXT NOT NULL DEFAULT '[]',
  seo_title TEXT NOT NULL DEFAULT '', seo_description TEXT NOT NULL DEFAULT '', i18n TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE team_members (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
  photo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, biography TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', linkedin TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, i18n TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  file_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public','internal')),
  i18n TEXT NOT NULL DEFAULT '{}', downloads INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE project_requests (
  id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '', email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0, consent_at TEXT,
  lang TEXT NOT NULL DEFAULT 'az', source_page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','discussion','proposal','won','lost','archived')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, follow_up_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_preq_status ON project_requests(status, created_at);
CREATE TABLE project_request_files (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES project_requests(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE);

CREATE TABLE contact_requests (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL DEFAULT 0, consent_at TEXT, lang TEXT NOT NULL DEFAULT 'az', source_page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','closed')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_creq_status ON contact_requests(status, created_at);

CREATE TABLE request_notes (
  id INTEGER PRIMARY KEY, request_type TEXT NOT NULL CHECK (request_type IN ('project','contact')),
  request_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','status','assign','email','followup')),
  body TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, user_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL);
CREATE INDEX idx_notes_req ON request_notes(request_type, request_id);

CREATE TABLE analytics_sessions (
  id TEXT PRIMARY KEY, visitor_hash TEXT NOT NULL, day TEXT NOT NULL, started_at TEXT NOT NULL, last_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0, pageviews INTEGER NOT NULL DEFAULT 0,
  landing_page TEXT NOT NULL DEFAULT '', exit_page TEXT NOT NULL DEFAULT '', referrer TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'direct', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '', screen TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', is_returning INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_as_day ON analytics_sessions(day);
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, ts TEXT NOT NULL);
CREATE INDEX idx_pv_day ON page_views(day);
CREATE INDEX idx_pv_session ON page_views(session_id);
CREATE TABLE analytics_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
  module TEXT NOT NULL, record_id TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  previous_value TEXT, new_value TEXT, ip TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
-- The audit log is append-only: the database itself refuses changes and deletions.
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER);
CREATE TABLE seo_pages (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seo_title TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', og_title TEXT NOT NULL DEFAULT '',
  og_description TEXT NOT NULL DEFAULT '', og_image_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  canonical TEXT NOT NULL DEFAULT '', in_sitemap INTEGER NOT NULL DEFAULT 1, i18n TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE backups (
  id INTEGER PRIMARY KEY, file TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL CHECK (kind IN ('auto','manual')),
  status TEXT NOT NULL CHECK (status IN ('ok','failed')), message TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body_text TEXT NOT NULL, reply_to TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, sent_at TEXT);
`,
  // 2: news are published as static pages of the website (src/site-news.js).
  `
ALTER TABLE news ADD COLUMN slug_en TEXT NOT NULL DEFAULT '';
ALTER TABLE news ADD COLUMN slug_ru TEXT NOT NULL DEFAULT '';
ALTER TABLE news ADD COLUMN cover_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE news ADD COLUMN site_image TEXT NOT NULL DEFAULT '';
CREATE TABLE site_files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, generated_at TEXT NOT NULL);
CREATE TABLE site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  // 3: office modules (src/routes/office.js) - document register, counterparties, income/expense
  //    journal, employees and payroll. Money is stored as INTEGER qəpik (1 AZN = 100) so that sums
  //    are exact. Records that other records point to cannot be deleted (RESTRICT).
  `
CREATE TABLE counterparties (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client','supplier','state','other')),
  tax_id TEXT NOT NULL DEFAULT '', legal_address TEXT NOT NULL DEFAULT '', bank_name TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '',
  bank_code TEXT NOT NULL DEFAULT '', swift TEXT NOT NULL DEFAULT '', contact_person TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_cp_name ON counterparties(name);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  hire_date TEXT, leave_date TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  base_salary INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE registry_docs (
  id INTEGER PRIMARY KEY, doc_date TEXT NOT NULL, doc_type TEXT NOT NULL, doc_index TEXT NOT NULL, doc_year INTEGER NOT NULL, seq INTEGER NOT NULL,
  doc_no TEXT NOT NULL UNIQUE, counterparty_id INTEGER REFERENCES counterparties(id) ON DELETE RESTRICT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE RESTRICT, recipient TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', executor TEXT NOT NULL DEFAULT '',
  send_method TEXT NOT NULL DEFAULT '', sent_date TEXT, status TEXT NOT NULL DEFAULT '', response_required INTEGER NOT NULL DEFAULT 0,
  response_date TEXT, response_no TEXT NOT NULL DEFAULT '', response_summary TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0, vat_amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AZN', due_date TEXT,
  note TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_reg_date ON registry_docs(doc_date);
CREATE INDEX idx_reg_seq ON registry_docs(doc_index, doc_year, seq);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY, entry_date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('income','expense')), category TEXT NOT NULL DEFAULT '',
  counterparty_id INTEGER REFERENCES counterparties(id) ON DELETE RESTRICT, doc_id INTEGER REFERENCES registry_docs(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0), vat_amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AZN',
  method TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('bank','cash','card','other')), description TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_ledger_date ON ledger(entry_date);
CREATE INDEX idx_ledger_doc ON ledger(doc_id);

CREATE TABLE payroll (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, period TEXT NOT NULL,
  gross INTEGER NOT NULL DEFAULT 0, income_tax INTEGER NOT NULL DEFAULT 0, dsmf_employee INTEGER NOT NULL DEFAULT 0,
  unemployment_employee INTEGER NOT NULL DEFAULT 0, health_employee INTEGER NOT NULL DEFAULT 0, other_deductions INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0, dsmf_employer INTEGER NOT NULL DEFAULT 0, unemployment_employer INTEGER NOT NULL DEFAULT 0,
  health_employer INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')), paid_date TEXT,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (employee_id, period));

-- Scans and attachments of documents, journal entries and employees (files are private media).
CREATE TABLE office_files (
  id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL CHECK (owner_type IN ('doc','ledger','employee')), owner_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_ofiles_owner ON office_files(owner_type, owner_id);

-- The register as the panel lists it: paid amount, number of files and counterparty name.
CREATE VIEW registry_view AS
  SELECT d.*, COALESCE(c.name, '') AS cp_name, COALESCE(e.full_name, '') AS employee_name,
    COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) AS paid,
    (SELECT COUNT(*) FROM office_files f WHERE f.owner_type = 'doc' AND f.owner_id = d.id) AS files_count,
    CASE WHEN d.amount <= 0 THEN 'none'
         WHEN COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) >= d.amount THEN 'paid'
         WHEN COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) > 0 THEN 'partial' ELSE 'unpaid' END AS pay_state,
    CASE WHEN d.status = 'Ləğv edildi' THEN 'cancelled' WHEN d.response_required = 0 THEN 'none'
         WHEN d.response_date IS NOT NULL THEN 'received' ELSE 'waiting' END AS response_state
  FROM registry_docs d LEFT JOIN counterparties c ON c.id = d.counterparty_id LEFT JOIN employees e ON e.id = d.employee_id;
CREATE VIEW ledger_view AS
  SELECT l.*, COALESCE(c.name, '') AS cp_name, COALESCE(d.doc_no, '') AS doc_no,
    (SELECT COUNT(*) FROM office_files f WHERE f.owner_type = 'ledger' AND f.owner_id = l.id) AS files_count
  FROM ledger l LEFT JOIN counterparties c ON c.id = l.counterparty_id LEFT JOIN registry_docs d ON d.id = l.doc_id;
CREATE VIEW payroll_view AS
  SELECT p.*, e.full_name, e.position FROM payroll p JOIN employees e ON e.id = p.employee_id;
`,
  // 4: personal files of employees, file categories, approval of journal entries, file-safe
  //    document numbers (P-004/10-26 -> P-004-10-26) and employees as recipients of any document.
  `
ALTER TABLE office_files ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN father_name TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN birth_date TEXT;
ALTER TABLE employees ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN id_series TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN id_number TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN photo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE ledger ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved'));
ALTER TABLE ledger ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ledger ADD COLUMN approved_at TEXT;
-- existing names "Soyad Ad" are split once; full_name stays the display name
UPDATE employees SET last_name = CASE WHEN instr(trim(full_name), ' ') > 0 THEN substr(trim(full_name), 1, instr(trim(full_name), ' ') - 1) ELSE trim(full_name) END,
  first_name = CASE WHEN instr(trim(full_name), ' ') > 0 THEN trim(substr(trim(full_name), instr(trim(full_name), ' ') + 1)) ELSE '' END
  WHERE last_name = '';
DROP VIEW registry_view;
CREATE VIEW registry_view AS
  SELECT d.*, replace(d.doc_no, '/', '-') AS doc_key, COALESCE(c.name, '') AS cp_name, COALESCE(e.full_name, '') AS employee_name, COALESCE(e.position, '') AS employee_position,
    COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) AS paid,
    (SELECT COUNT(*) FROM office_files f WHERE f.owner_type = 'doc' AND f.owner_id = d.id) AS files_count,
    CASE WHEN d.amount <= 0 THEN 'none'
         WHEN COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) >= d.amount THEN 'paid'
         WHEN COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.doc_id = d.id), 0) > 0 THEN 'partial' ELSE 'unpaid' END AS pay_state,
    CASE WHEN d.status = 'Ləğv edildi' THEN 'cancelled' WHEN d.response_required = 0 THEN 'none'
         WHEN d.response_date IS NOT NULL THEN 'received' ELSE 'waiting' END AS response_state
  FROM registry_docs d LEFT JOIN counterparties c ON c.id = d.counterparty_id LEFT JOIN employees e ON e.id = d.employee_id;
DROP VIEW ledger_view;
CREATE VIEW ledger_view AS
  SELECT l.*, COALESCE(c.name, '') AS cp_name, COALESCE(d.doc_no, '') AS doc_no, COALESCE(u.name, '') AS approved_by_name,
    (SELECT COUNT(*) FROM office_files f WHERE f.owner_type = 'ledger' AND f.owner_id = l.id) AS files_count
  FROM ledger l LEFT JOIN counterparties c ON c.id = l.counterparty_id LEFT JOIN registry_docs d ON d.id = l.doc_id LEFT JOIN users u ON u.id = l.approved_by;
`,
];

// Before an existing database is changed, a full copy is written to data/backups/
// (aeec-pre-migration-v<old>-<time>.sqlite). Returning to the previous version = stop the service,
// put that file back as data/aeec.sqlite and start the previous version of the application.
// Data steps that are easier in JavaScript than in SQL; they run inside the same transaction as
// the migration with the same number (a failure rolls both back).
const AFTER = {
  // 4: "Məmmədov Elçin Rauf oğlu" -> last_name, first_name, father_name; full_name = "Soyad Ad".
  4: () => {
    const { splitName } = require('./office/common');
    for (const e of db.prepare('SELECT id, full_name FROM employees').all()) {
      const n = splitName(e.full_name);
      if (!n.father_name) continue;
      db.prepare('UPDATE employees SET last_name = ?, first_name = ?, father_name = ?, full_name = ? WHERE id = ?')
        .run(n.last_name, n.first_name, n.father_name, `${n.last_name} ${n.first_name}`, e.id);
    }
  },
};

function migrate() {
  let v = get('PRAGMA user_version').user_version;
  if (v > 0 && v < MIGRATIONS.length) {
    const fs = require('node:fs');
    const path = require('node:path');
    fs.mkdirSync(config.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(config.backupDir, `aeec-pre-migration-v${v}-${stamp}.sqlite`);
    db.prepare('VACUUM INTO ?').run(file);
    try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
    console.log(`[db] Baza v${v} → v${MIGRATIONS.length} yenilənir. Əvvəlki vəziyyətin nüsxəsi: ${file}`);
  }
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      if (AFTER[v + 1]) AFTER[v + 1]();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

module.exports = { db, get, all, run, tx, now, dayOf, migrate };
