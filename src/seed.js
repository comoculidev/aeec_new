'use strict';
// First-run data: roles and permissions, the site's page list for SEO, and the four service areas.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { get, run, tx, now } = require('./db');
const { seedPermissions } = require('./permissions');
const { hashPassword, passwordProblem } = require('./security');

const PAGES = [
  ['/', 'Ana səhifə'], ['/haqqimizda/', 'Haqqımızda'], ['/heller/', 'Həllər'], ['/layiheler/', 'Layihələr'], ['/dayaniqliliq/', 'Dayanıqlılıq'],
  ['/akademiya/', 'AEEC Academy'], ['/xeberler/', 'Xəbərlər'], ['/elaqe/', 'Əlaqə'], ['/mexfilik/', 'Məxfilik siyasəti'],
];
const SERVICES = [
  ['energy-engineering-consulting', 'Energy Engineering & Consulting', '0.4, 6, 10, 35 və 110 kV şəbəkələrdə quraşdırma, sınaq, tənzimləmə, təmir və texniki nəzarət.', 'bolt',
    ['Elektrik şəbəkələrinin texniki auditi', 'Yarımstansiya və xətlərin modernləşdirilməsi', 'Rele mühafizəsi və avtomatika', 'Kabel xətlərinin sınağı və nasazlıqların aşkarlanması', 'Enerji auditi və qənaət proqramları']],
  ['digital-ai-solutions', 'Digital & AI Solutions', 'Rəqəmsal istehsal və data analitika.', 'chip',
    ['CAD/CAM əsaslı sənaye layihələndirməsi', '3D modelləşdirmə və sürətli prototipləşdirmə', 'Sənaye IoT sensor sistemləri', 'Proqnozlaşdırılan texniki xidmət']],
  ['green-energy-e-mobility', 'Green Energy & E-Mobility', 'Yaşıl enerji və elektrik nəqliyyatı.', 'leaf',
    ['EV şarj stansiyalarının layihələndirilməsi', 'Fotovoltaik və külək sistemləri', 'Enerji saxlama', 'Ağıllı sayğaclar və mikroşəbəkələr']],
  ['aeec-academy', 'AEEC Academy', 'Bilik, sertifikasiya və insan kapitalı — proqramlar planlaşdırılır.', 'academy', []],
];

// One-time upgrade (v1.3). Until v1.2 the panel's "Sosial şəbəkələr" values were stored but NOT
// shown on the website, which always showed LinkedIn and Facebook from its own HTML. Since v1.3 the
// website shows exactly the panel values. So that the live site does not lose those two links when
// a group was saved earlier with them empty, they are filled in once from src/company.js.
// Everything else that was entered (e.g. an Instagram address) is kept as it is.
function upgradeSocialSettings() {
  if (get("SELECT value FROM site_meta WHERE key = 'social_v13'")) return;
  const { company } = require('./company');
  const { audit } = require('./audit');
  tx(() => {
    const row = get("SELECT value FROM settings WHERE key = 'social'");
    if (row) {
      let stored = {};
      try { stored = JSON.parse(row.value) || {}; } catch { stored = {}; }
      const filled = {};
      for (const k of ['linkedin', 'facebook']) if (!stored[k] && company.social[k]) { stored[k] = company.social[k]; filled[k] = company.social[k]; }
      if (Object.keys(filled).length) {
        run("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'social'", JSON.stringify(stored), now());
        audit(null, { action: 'Tənzimləmə dəyişikliyi', module: 'Tənzimləmələr', recordId: 'social', summary: 'Yeniləmə v1.3: saytda göstərilən LinkedIn/Facebook keçidləri paneldəki boş sahələrə köçürüldü', next: filled });
      }
    }
    run("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('social_v13', ?)", now());
  });
}

async function seed() {
  seedPermissions();
  upgradeSocialSettings();
  tx(() => {
    if (!get('SELECT id FROM seo_pages LIMIT 1')) {
      PAGES.forEach(([p, name], i) => run('INSERT INTO seo_pages (path, name, in_sitemap, sort_order, updated_at) VALUES (?,?,?,?,?)', p, name, p === '/mexfilik/' ? 0 : 1, i + 1, now()));
    }
    if (!get('SELECT id FROM services LIMIT 1')) {
      SERVICES.forEach(([slug, title, short, icon, features], i) => run('INSERT INTO services (slug, title, short_description, icon, features, sort_order, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
        slug, title, short, icon, JSON.stringify(features), i + 1, now(), now()));
    }
  });
  // First administrator. ADMIN_EMAIL / ADMIN_PASSWORD from .env if given; otherwise a random
  // temporary password is generated, printed once in the console and written to
  // data/ilk-giris.txt (readable only by the server user). The password must be changed at first login.
  if (!get('SELECT id FROM users LIMIT 1')) {
    const email = (process.env.ADMIN_EMAIL || 'office@aeec.az').trim().toLowerCase();
    let pw = process.env.ADMIN_PASSWORD || '', generated = false;
    if (pw) {
      const problem = /BURAYA|MUVEQQETI/i.test(pw) ? '.env faylındakı nümunə mətni öz müvəqqəti şifrənizlə əvəz edin' : passwordProblem(pw, { email });
      if (problem) { console.error(`[seed] ADMIN_PASSWORD qəbul edilmədi: ${problem}`); return; }
    } else {
      // e.g. "Aeec-7Kq2-mP9x-Wd4R": 3 random groups, upper/lower/digit/symbol - always passes the rules
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      const g = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join('');
      pw = `Aeec-${g()}-${g()}-${g()}7`; generated = true;
    }
    const role = get("SELECT id FROM roles WHERE key = 'super_admin'");
    run('INSERT INTO users (email, name, password_hash, role_id, is_active, must_change_password, password_changed_at, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?,?)',
      email, process.env.ADMIN_NAME || 'Super Admin', await hashPassword(pw), role.id, now(), now(), now());
    if (generated) {
      const file = path.join(config.dataDir, 'ilk-giris.txt');
      fs.writeFileSync(file, `AEEC idarəetmə paneli — ilk giriş\nÜnvan: ${config.baseUrl}/admin/\nE-poçt: ${email}\nMüvəqqəti şifrə: ${pw}\n\nİlk girişdə yeni şifrə təyin edəcəksiniz. Sonra bu faylı silin.\n`, { mode: 0o600 });
      console.log(`\n[seed] İlk Super Admin yaradıldı.\n       Ünvan: ${config.baseUrl}/admin/\n       E-poçt: ${email}\n       Müvəqqəti şifrə: ${pw}\n       (həmçinin data/ilk-giris.txt faylında; ilk girişdə yeni şifrə təyin edin)\n`);
    } else {
      console.log(`[seed] İlk Super Admin yaradıldı: ${email}. İlk girişdə şifrəni dəyişmək tələb olunacaq. İndi .env faylından ADMIN_PASSWORD sətrini silin.`);
    }
  }
}
module.exports = { seed, upgradeSocialSettings };
