'use strict';
// Company profile — the ONE place in the code where AEEC's own contact details and social
// network links are written down.
//
// How these values are used:
//   - They are the DEFAULTS of the panel's "Tənzimləmələr → Əlaqə / Sosial şəbəkələr" groups
//     (src/settings.js). What an administrator saves in the panel overrides them.
//   - The website pages (site/) are written with exactly these default values. When a page is
//     served, src/site-layout.js replaces them with the current panel values, so a change in the
//     panel appears on every page at once, without editing any HTML file.
//
// Change a value here only if the default itself changes (e.g. for a fresh installation);
// day-to-day changes are made in the panel.

const company = {
  legalName: 'Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC',
  legalNameEn: 'Azerbaijan Energy Engineering & Consulting LLC',
  brand: 'AEEC',
  // The single public e-mail address of the company (site, forms, notifications).
  email: 'office@aeec.az',
  phone: '+994 50 362 30 38',
  // Address exactly as the website pages show it, per language.
  address: {
    az: 'Xırdalan şəhəri, Həsən Əliyev küçəsi',
    en: 'Hasan Aliyev Street, Khirdalan, Azerbaijan',
    ru: 'г. Хырдалан, улица Гасана Алиева, Азербайджан',
  },
  mapsUrl: 'https://maps.app.goo.gl/y3ChPxsBJ8R6JhLT9',
  // WhatsApp number of the company in international form (+994 …). Not known yet: it is entered
  // in the panel (Tənzimləmələr → Əlaqə); until then the site shows no WhatsApp button.
  whatsapp: '',
  // Social networks. An empty value = not shown on the site.
  // The Instagram address is not known yet: it is entered in the panel
  // (Tənzimləmələr → Sosial şəbəkələr) and then appears on every page.
  social: {
    linkedin: 'https://www.linkedin.com/company/9441410/',
    facebook: 'https://www.facebook.com/AeecCompany/',
    instagram: '',
    youtube: '',
    telegram: '',
    other: '',
  },
};

// Order and visible names of the networks on the site. `hosts` = the only domains accepted for
// that field in the panel (protection against a mistyped or malicious link); null = any https site.
const SOCIAL_NETWORKS = [
  { key: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'] },
  { key: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
  { key: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
  { key: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'telegram', label: 'Telegram', hosts: ['t.me', 'telegram.me'] },
  { key: 'other', label: null, hosts: null }, // label = the site's host name
];

// "+994 50 362 30 38" -> "+994503623038" (the form used in tel: links and structured data).
const phoneHref = (phone) => String(phone || '').replace(/[^\d+]/g, '');

module.exports = { company, SOCIAL_NETWORKS, phoneHref };
