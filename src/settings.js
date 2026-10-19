'use strict';
// Site settings stored as JSON documents, one per group.
// Defaults of the company-related groups come from src/company.js (single source).
const { get, run, now } = require('./db');
const { v, validate } = require('./validate');
const { company, SOCIAL_NETWORKS } = require('./company');

const L = (shape) => v.i18n(shape);
const listOf = (shape, max = 20) => v.arr(v.obj(shape), { max, dropEmpty: false });
const valueShape = { title: v.str({ max: 120 }), text: v.text({ max: 1000 }) };
const statShape = { label: v.str({ max: 120 }), value: v.str({ max: 40 }), is_active: v.bool({ default: true }) };
const companyText = { about: v.text({ max: 8000 }), mission: v.text({ max: 2000 }), vision: v.text({ max: 2000 }), values: listOf(valueShape, 12), stats: listOf(statShape, 12) };

const GROUPS = {
  general: {
    shape: { company_name: v.str({ max: 200, required: true }), site_name: v.str({ max: 120 }), working_hours: v.str({ max: 200 }),
      logo_media_id: v.int({ min: 1 }), favicon_media_id: v.int({ min: 1 }), i18n: L({ company_name: v.str({ max: 200 }), working_hours: v.str({ max: 200 }) }) },
    defaults: { company_name: company.legalName, site_name: company.brand, working_hours: '', logo_media_id: null, favicon_media_id: null,
      i18n: { en: { company_name: company.legalNameEn } } },
    public: true,
  },
  // Shown on the website (src/site-layout.js): e-mail and phone on every page, address per language.
  contact: {
    shape: { address: v.str({ max: 300 }), phone: v.phone(), email: v.email(), whatsapp: v.phone(), maps_url: v.url(), i18n: L({ address: v.str({ max: 300 }) }) },
    defaults: { address: company.address.az, phone: company.phone, email: company.email, whatsapp: '', maps_url: company.mapsUrl,
      i18n: { en: { address: company.address.en }, ru: { address: company.address.ru } } },
    public: true,
  },
  // Shown on the website: footer of every page, Contact page, structured data (sameAs).
  social: {
    shape: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, v.socialUrl(n.hosts)])),
    defaults: { ...company.social },
    public: true,
  },
  seo: {
    shape: { site_title: v.str({ max: 120 }), meta_description: v.str({ max: 300 }), keywords: v.str({ max: 300 }), google_verification: v.str({ max: 120, pattern: /^[\w-]*$/ }),
      og_image_media_id: v.int({ min: 1 }), robots_txt: v.text({ max: 4000 }),
      news_url: v.str({ max: 120, pattern: /^\/[\w\-/{}]*$/ }), project_url: v.str({ max: 120, pattern: /^\/[\w\-/{}]*$/ }),
      i18n: L({ site_title: v.str({ max: 120 }), meta_description: v.str({ max: 300 }), keywords: v.str({ max: 300 }) }) },
    defaults: { site_title: 'AEEC — Azərbaycan Enerji Encinirinq ənd Konsaltinq', meta_description: '', keywords: '', google_verification: '', og_image_media_id: null,
      robots_txt: '', news_url: '', project_url: '', i18n: {} },
    public: true,
  },
  footer: {
    shape: { text: v.str({ max: 400 }), copyright: v.str({ max: 200 }), show_social: v.bool({ default: true }), i18n: L({ text: v.str({ max: 400 }), copyright: v.str({ max: 200 }) }) },
    defaults: { text: '', copyright: '© 2026 Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC', show_social: 1, i18n: {} },
    public: true,
  },
  company: {
    shape: { ...companyText, i18n: L(companyText) },
    defaults: {
      about: '',
      mission: 'Enerji, sənaye, infrastruktur və ictimai xidmət sektorlarında elmi əsaslı, texnoloji, təhlükəsiz, dayanıqlı və iqtisadi cəhətdən səmərəli mühəndislik həlləri yaradırıq.',
      vision: 'Azərbaycan və regionda enerji mühəndisliyi, rəqəmsal sənaye həlləri, e-mobillik, yaşıl enerji və mühəndislik təlimləri üzrə aparıcı texnologiya əsaslı şirkət olmaq.',
      values: [
        { title: 'Elmilik', text: 'Elmi əsaslı tədqiqat mədəniyyəti və çətin problemlər üçün innovativ həllər.' },
        { title: 'Səmərəlilik', text: 'Müştərinin problemini özümüzünkü kimi qəbul edir, praktik və sərfəli həll veririk.' },
        { title: 'Mükəmməllik', text: 'Texniki bacarıq, layihə idarəetməsi, təhlükəsizlik və keyfiyyətdə yüksək standart.' },
        { title: 'Həssaslıq', text: 'Biznes etikası, ətraf mühit və dayanıqlı inkişaf prinsiplərinə hörmət.' },
      ],
      // Figures already published on the site are active; the other labels are placeholders to be filled in.
      stats: [
        { label: 'Enerji təchizatı nasazlıqları', value: '−30%', is_active: 1 },
        { label: 'Neft-qaz hasilatı', value: '+5%', is_active: 1 },
        { label: 'Enerji istehlakı', value: '−20%', is_active: 1 },
        { label: 'Tamamlanmış layihələr', value: '', is_active: 0 },
        { label: 'Aktiv layihələr', value: '', is_active: 0 },
        { label: 'İllik təcrübə', value: '', is_active: 0 },
        { label: 'Mütəxəssislər', value: '', is_active: 0 },
        { label: 'Ölkələr', value: '', is_active: 0 },
        { label: 'Tərəfdaşlar', value: '', is_active: 0 },
      ],
      i18n: {},
    },
    public: true,
  },
  notifications: {
    shape: { emails: v.arr(v.email(), { max: 10 }), lead_subject: v.str({ max: 150, required: true }), contact_subject: v.str({ max: 150, required: true }),
      email_on_lead: v.bool({ default: true }), email_on_contact: v.bool({ default: true }) },
    defaults: { emails: [], lead_subject: 'New Project Discussion Request – AEEC Website', contact_subject: 'New Contact Request – AEEC Website', email_on_lead: 1, email_on_contact: 1 },
  },
  analytics: {
    shape: { enabled: v.bool({ default: true }), respect_dnt: v.bool({ default: true }), retention_days: v.int({ min: 30, max: 1825, default: 400 }) },
    defaults: { enabled: 1, respect_dnt: 1, retention_days: 400 },
  },
  backup: {
    shape: { auto: v.bool({ default: true }), hour: v.int({ min: 0, max: 23, default: 3 }), keep: v.int({ min: 1, max: 90, default: 14 }), include_files: v.bool({ default: true }) },
    defaults: { auto: 1, hour: 3, keep: 14, include_files: 1 },
  },
  // Lists of the office modules (Sənəd reyestri → Siyahılar). Editable in the panel, so the
  // categories can follow the company's own practice without a programmer.
  office: {
    shape: {
      doc_types: v.arr(v.obj({ name: v.str({ max: 40, required: true }), index: v.str({ max: 4, required: true, pattern: /^[A-Z]{1,4}$/, message: 'Yalnız 1–4 böyük latın hərfi (məs. AE)' }) }), { max: 30, dropEmpty: false }),
      statuses: v.arr(v.str({ max: 40 }), { max: 30 }), send_methods: v.arr(v.str({ max: 40 }), { max: 30 }), results: v.arr(v.str({ max: 40 }), { max: 30 }),
      income_categories: v.arr(v.str({ max: 60 }), { max: 40 }), expense_categories: v.arr(v.str({ max: 60 }), { max: 40 }),
      executors: v.arr(v.str({ max: 60 }), { max: 30 }),
    },
    // Taken over from the company's Excel register (Növlər sheet).
    defaults: {
      doc_types: [{ name: 'Müqavilə', index: 'AE' }, { name: 'Əmr', index: 'A' }, { name: 'Protokol', index: 'P' }, { name: 'Qərar', index: 'Q' }, { name: 'Akt', index: 'AK' }, { name: 'Məktub', index: 'M' }, { name: 'Hesab', index: 'H' }],
      statuses: ['Hazırlanır', 'Göndərildi', 'Çatdırıldı', 'İmzalandı', 'Ləğv edildi'],
      send_methods: ['Sürücü ilə', 'Şirkət tərəfindən', 'Elektron poçt ilə'],
      results: ['Müsbət', 'Mənfi', 'Qismən təmin edildi', 'İcra edildi', 'Əlavə sorğu', 'Cavabsız qaldı'],
      income_categories: ['Xidmət haqqı (sınaq, ölçmə)', 'Konsaltinq', 'Digər gəlir'],
      expense_categories: ['Əmək haqqı', 'Vergi və DSMF ödənişləri', 'İcarə', 'Kommunal xidmətlər', 'Nəqliyyat və yanacaq', 'Avadanlıq və alət', 'Material', 'Kalibrləmə və attestasiya', 'Bank xidməti', 'Rabitə və internet', 'Digər xərc'],
      executors: ['Hacılı T.'],
    },
  },
  // Stored now so the integrations can be switched on later without a schema change.
  integrations: {
    shape: { google_analytics_id: v.str({ max: 40, pattern: /^[\w-]*$/ }), search_console_verification: v.str({ max: 120, pattern: /^[\w-]*$/ }),
      crm_webhook_url: v.url(), telegram_chat: v.str({ max: 80 }), whatsapp_number: v.phone() },
    defaults: { google_analytics_id: '', search_console_verification: '', crm_webhook_url: '', telegram_chat: '', whatsapp_number: '' },
  },
};

function getSetting(group) {
  const g = GROUPS[group];
  if (!g) return null;
  const row = get('SELECT value FROM settings WHERE key = ?', group);
  let stored = {};
  if (row) { try { stored = JSON.parse(row.value); } catch { stored = {}; } }
  return { ...g.defaults, ...stored };
}
// Increases on every save; the website's page cache (src/site-layout.js) uses it to notice changes.
let savedVersion = 0;
const version = () => savedVersion;
function setSetting(group, input, userId) {
  const g = GROUPS[group];
  const value = validate(g.shape, input);
  savedVersion++;
  run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
    group, JSON.stringify(value), now(), userId || null);
  return value;
}
// Merge the translation for `lang` over the base (Azerbaijani) fields.
function localize(obj, lang) {
  if (!obj || typeof obj !== 'object') return obj;
  const { i18n, ...base } = obj;
  let tr = i18n;
  if (typeof tr === 'string') { try { tr = JSON.parse(tr); } catch { tr = {}; } }
  const t = lang && lang !== 'az' && tr && tr[lang];
  if (t) for (const [k, val] of Object.entries(t)) if (val !== '' && val !== null && !(Array.isArray(val) && !val.length)) base[k] = val;
  return base;
}
module.exports = { GROUPS, getSetting, setSetting, localize, version };
