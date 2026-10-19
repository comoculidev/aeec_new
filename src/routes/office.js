'use strict';
// Office modules (internal - nothing here is shown on the website). Each part lives in src/office/:
//   registry.js     /api/registry        Sənəd reyestri (numbers, scans, import, PDF)
//   finance.js      /api/counterparties  Kontragentlər; /api/ledger Gəlir-xərc; /api/finance/summary
//   hr.js           /api/employees       Kadrlar (personal files, 3×4 photo); /api/payroll Əmək haqqı
//   attachments.js  /api/office/files    scans and attachments of all three
//   reports.js      printable PDFs of all of them (A4)
//   common.js       shared rules: money, numbers (P-004/10-26 <-> P-004-10-26), lists
// Permissions: registry.*, finance.* (+ finance.approve), hr.* (+ hr.personal for personal data).
// By default only the Super Admin has them; they can be granted to other roles in the panel.
const config = require('../config');
const { all, dayOf } = require('../db');
const { can } = require('../auth');
const C = require('../office/common');
const attachments = require('../office/attachments');
const reports = require('../office/reports');

module.exports = (app) => {
  // Everything the office screens need for their dropdowns, readable with any office permission.
  app.get('/api/office/meta', can('registry.view', 'finance.view', 'hr.view'), (ctx) => {
    ctx.json({
      lists: C.lists(), currencies: C.CURRENCIES, kinds: C.KIND_LABEL, methods: C.METHOD_LABEL, cp_kinds: C.CP_KIND, ledger_status: C.LEDGER_STATUS,
      order_type: C.ORDER_TYPE, cancelled_status: C.CANCELLED, file_categories: attachments.CATEGORIES,
      counterparties: all('SELECT id, name FROM counterparties WHERE is_active = 1 ORDER BY fold(name)'),
      employees: all("SELECT id, full_name, position, status FROM employees ORDER BY status = 'left', fold(full_name)"),
      allowed: attachments.ALLOWED, max_mb: config.maxUploadMb, today: dayOf(),
      can: { registry_edit: ctx.perms.has('registry.edit'), finance_edit: ctx.perms.has('finance.edit'), finance_approve: ctx.perms.has('finance.approve'),
        hr_edit: ctx.perms.has('hr.edit'), hr_personal: ctx.perms.has('hr.personal') },
    });
  });
  attachments.routes(app);
  require('../office/registry').routes(app, reports);
  require('../office/finance').routes(app, reports);
  require('../office/hr').routes(app, reports);
};
