import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-001 — registration & auth (FR-1, FR-2, FR-3)
describe('UAT-001 — Account registration & auth', () => {
  test('registering a customer returns a JWT and never leaks the password hash', async () => {
    const { res } = await h.registerUser('customer');
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.role).toBe('customer');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
  });

  test('anyone can NOT self-register as admin (privilege escalation blocked)', async () => {
    const res = await api().post('/api/users/register').send({ fullName: 'Evil', email: 'evil@example.com', password: 'password123', role: 'admin' });
    expect(res.status).toBe(400);
  });

  test('registering creates the matching profile shell for each role', async () => {
    const c = await h.registerUser('customer');
    const t = await h.registerUser('technician');
    const s = await h.registerUser('service_center', { businessName: 'FixIt Ltd' });
    expect(await h.getCustomerProfile(c.user._id)).toBeTruthy();
    expect((await h.getTechnicianProfile(t.user._id)).verificationStatus).toBe('pending');
    expect((await h.getCenterProfile(s.user._id)).businessName).toBe('FixIt Ltd');
  });

  test('validation: weak password, bad email and bad phone are rejected with field errors', async () => {
    const res = await api().post('/api/users/register').send({ fullName: 'A', email: 'nope', password: '123', role: 'customer', phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(3);
  });

  test('duplicate email cannot register twice', async () => {
    await h.registerUser('customer', { email: 'dupe@example.com' });
    const second = await h.registerUser('customer', { email: 'dupe@example.com' });
    expect(second.res.status).toBe(409);
  });

  test('login works, wrong password and unknown email get the same 401', async () => {
    await h.registerUser('customer', { email: 'login@example.com' });
    const ok = await api().post('/api/users/login').send({ email: 'login@example.com', password: 'password123' });
    expect(ok.status).toBe(200);
    const bad = await api().post('/api/users/login').send({ email: 'login@example.com', password: 'wrong-password' });
    const unknown = await api().post('/api/users/login').send({ email: 'ghost@example.com', password: 'password123' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.message).toBe(unknown.body.message);
  });

  test('protected routes reject missing and garbage tokens', async () => {
    expect((await api().get('/api/users/me')).status).toBe(401);
    expect((await api().get('/api/users/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  test('a suspended user is locked out immediately, even with a valid token', async () => {
    const admin = await h.createAdmin();
    const u = await h.registerUser('customer');
    await api().patch(`/api/users/${u.user._id}/status`).set(auth(admin)).send({ status: 'suspended' });
    expect((await api().get('/api/users/me').set(auth(u))).status).toBe(403);
    const login = await api().post('/api/users/login').send({ email: u.payload.email, password: 'password123' });
    expect(login.status).toBe(403);
  });

  test('users cannot read or edit other users; admins can', async () => {
    const a = await h.registerUser('customer');
    const b = await h.registerUser('customer');
    const admin = await h.createAdmin();
    expect((await api().get(`/api/users/${b.user._id}`).set(auth(a))).status).toBe(403);
    expect((await api().patch(`/api/users/${b.user._id}`).set(auth(a)).send({ fullName: 'Hacked' })).status).toBe(403);
    expect((await api().delete(`/api/users/${b.user._id}`).set(auth(a))).status).toBe(403);
    expect((await api().get(`/api/users/${b.user._id}`).set(auth(admin))).status).toBe(200);
  });

  test('a malformed id returns 400, not a 500', async () => {
    const a = await h.registerUser('customer');
    expect((await api().get('/api/users/not-an-id').set(auth(a))).status).toBe(400);
  });

  test('change password requires the current password', async () => {
    const u = await h.registerUser('customer');
    expect((await api().post('/api/users/change-password').set(auth(u)).send({ currentPassword: 'nope-nope', newPassword: 'newpassword1' })).status).toBe(401);
    expect((await api().post('/api/users/change-password').set(auth(u)).send({ currentPassword: 'password123', newPassword: 'newpassword1' })).status).toBe(200);
    expect((await api().post('/api/users/login').send({ email: u.payload.email, password: 'newpassword1' })).status).toBe(200);
  });

  test('operator-injection in query strings is rejected', async () => {
    const admin = await h.createAdmin();
    const res = await api().get('/api/users?role[$ne]=x').set(auth(admin));
    expect(res.status).toBe(400);
  });
});
