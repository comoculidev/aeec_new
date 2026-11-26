'use strict';
// Adding panel users and their first sign-in: earlier failed attempts must never keep a new or
// reset account out, and a sign-in block is visible (and removable) in «İstifadəçilər».
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client } = require('./helpers');

const ADMIN = ['office@aeec.az', 'Sinaq-Parol-2026!'];
let T, admin, viewerRole;

test.before(async () => {
  T = await boot();
  admin = new Client(T.base, '10.40.0.1');
  await admin.login(...ADMIN);
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN[1], password: 'Istifadeci-Admin-91!' })).status, 200);
  await admin.login(ADMIN[0], 'Istifadeci-Admin-91!');
  viewerRole = (await admin.get('/api/roles')).data.roles.find((r) => r.key === 'viewer').id;
});
test.after(() => { T.stop(); setTimeout(() => process.exit(0), 200).unref(); });

const user = (u) => admin.get('/api/users?per_page=100').then((r) => r.data.items.find((x) => x.email === u));

test('a new user can sign in with the temporary password even after earlier failed attempts', async () => {
  const c = new Client(T.base, '10.40.1.1');
  // somebody tries the address before the account exists (e.g. the admin testing it) - 5 failures
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: 'aynur@aeec.az', password: 'Sehv-Parol-1!' })).status, 401);
  // the admin creates the account
  const mk = await admin.post('/api/users', { name: 'Aynur Əliyeva', email: 'Aynur@aeec.az', role_id: viewerRole, password: ' Muveqqeti-Parol-42# ', is_active: true });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  // ... and the new user signs in right away from the same computer (leading/trailing spaces ignored)
  const r = await c.login('aynur@aeec.az', 'Muveqqeti-Parol-42#');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(c.me.user.must_change_password, true, 'must set an own password');
  assert.equal((await c.get('/api/dashboard')).status, 403, 'nothing else until the password is changed');
  assert.equal((await c.post('/api/auth/password', { current: 'Muveqqeti-Parol-42#', password: 'Oz-Gizli-Sozum-7!' })).status, 200);
  assert.equal((await c.login('aynur@aeec.az', 'Oz-Gizli-Sozum-7!')).status, 200);
  assert.equal(c.me.user.must_change_password, false);
});

test('a sign-in block is shown in the users list and is removed by «Bloku götür» and by a password reset', async () => {
  const mk = await admin.post('/api/users', { name: 'Rauf Məmmədov', email: 'rauf@aeec.az', role_id: viewerRole, password: 'Ilk-Parol-Saat-55!', is_active: true });
  assert.equal(mk.status, 201);
  const c = new Client(T.base, '10.40.2.1');
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'rauf@aeec.az', password: 'yanlis-parol' });
  assert.equal((await c.post('/api/auth/login', { email: 'rauf@aeec.az', password: 'Ilk-Parol-Saat-55!' })).status, 401, 'blocked from this computer');
  assert.equal((await user('rauf@aeec.az')).locked, true, 'the list shows the block');
  // «Bloku götür»
  assert.equal((await admin.post(`/api/users/${mk.data.item.id}/unlock`)).status, 200);
  assert.equal((await user('rauf@aeec.az')).locked, false);
  assert.equal((await c.post('/api/auth/login', { email: 'rauf@aeec.az', password: 'Ilk-Parol-Saat-55!' })).status, 200);
  // blocked again, then the admin gives a new temporary password: the block goes away with it
  const d = new Client(T.base, '10.40.2.2');
  for (let i = 0; i < 5; i++) await d.post('/api/auth/login', { email: 'rauf@aeec.az', password: 'yenə-yanlis' });
  assert.equal((await user('rauf@aeec.az')).locked, true);
  assert.equal((await admin.post(`/api/users/${mk.data.item.id}/reset-password`, { password: 'Yeni-Muveqqeti-77!' })).status, 200);
  assert.equal((await user('rauf@aeec.az')).locked, false);
  assert.equal((await d.post('/api/auth/login', { email: 'rauf@aeec.az', password: 'Yeni-Muveqqeti-77!' })).status, 200);
});
