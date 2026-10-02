import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-008 — admin verification (US-009, FR-5)
describe('UAT-008 — Technician & service-center verification', () => {
  test('a new technician starts pending and is hidden from public search', async () => {
    const t = await h.registerUser('technician');
    const profile = await h.getTechnicianProfile(t.user._id);
    expect(profile.verificationStatus).toBe('pending');
    const list = await api().get('/api/technician-profiles');
    expect(list.body.data.find((x) => x._id === String(profile._id))).toBeUndefined();
    expect((await api().get(`/api/technician-profiles/${profile._id}`)).status).toBe(404);
  });

  test('only admins see the verification queue', async () => {
    const t = await h.registerUser('technician');
    const admin = await h.createAdmin();
    expect((await api().get('/api/technician-profiles/pending').set(auth(t))).status).toBe(403);
    const res = await api().get('/api/technician-profiles/pending').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  test('approval is refused when no documents were submitted', async () => {
    const admin = await h.createAdmin();
    const t = await h.registerUser('technician');
    const p = await h.getTechnicianProfile(t.user._id);
    const res = await api().patch(`/api/technician-profiles/${p._id}/verify`).set(auth(admin)).send({ decision: 'approve' });
    expect(res.status).toBe(400);
  });

  test('approving makes the technician publicly listed, without exposing documents', async () => {
    const admin = await h.createAdmin();
    const t = await h.registerUser('technician');
    expect((await h.verifyTechnician(admin, t)).body.data.verificationStatus).toBe('verified');
    const p = await h.getTechnicianProfile(t.user._id);
    const list = await api().get('/api/technician-profiles');
    const found = list.body.data.find((x) => x._id === String(p._id));
    expect(found).toBeDefined();
    expect(found.verificationDocs).toBeUndefined();
    const single = await api().get(`/api/technician-profiles/${p._id}`);
    expect(single.body.data.verificationDocs).toBeUndefined();
  });

  test('rejection stores feedback; the technician sees it on /me', async () => {
    const admin = await h.createAdmin();
    const t = await h.registerUser('technician');
    const p = await h.getTechnicianProfile(t.user._id);
    const res = await api().patch(`/api/technician-profiles/${p._id}/verify`).set(auth(admin)).send({ decision: 'reject', feedback: 'ID was blurry' });
    expect(res.body.data.verificationStatus).toBe('rejected');
    const me = await api().get('/api/technician-profiles/me').set(auth(t));
    expect(me.body.data.verificationFeedback).toMatch(/blurry/);
  });

  test('technicians cannot edit someone else\'s profile', async () => {
    const a = await h.registerUser('technician');
    const b = await h.registerUser('technician');
    const pb = await h.getTechnicianProfile(b.user._id);
    const res = await api().patch(`/api/technician-profiles/${pb._id}`).set(auth(a)).send({ bio: 'hijacked' });
    expect(res.status).toBe(403);
  });

  test('an unverified technician cannot submit quotations', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    const t = await h.registerUser('technician');
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(c, cat._id);
    expect((await h.submitQuotation(t, rr._id)).status).toBe(403);
  });

  test('service centers are verified the same way and can manage a team', async () => {
    const admin = await h.createAdmin();
    const center = await h.registerUser('service_center');
    const tech = await h.registerUser('technician', { email: 'member@example.com' });
    const cp = await h.getCenterProfile(center.user._id);
    expect((await api().get('/api/service-centers')).body.data.length).toBe(0);
    expect((await h.verifyCenter(admin, center)).body.data.verificationStatus).toBe('verified');
    expect((await api().get('/api/service-centers')).body.data.length).toBe(1);

    const add = await api().post(`/api/service-centers/${cp._id}/team`).set(auth(center)).send({ email: 'member@example.com' });
    expect(add.status).toBe(200);
    expect((await api().post(`/api/service-centers/${cp._id}/team`).set(auth(center)).send({ email: 'member@example.com' })).status).toBe(409);
    const team = await api().get(`/api/service-centers/${cp._id}/team`).set(auth(center));
    expect(team.body.data.length).toBe(1);
    const tp = await h.getTechnicianProfile(tech.user._id);
    expect((await api().delete(`/api/service-centers/${cp._id}/team/${tp._id}`).set(auth(center))).status).toBe(200);
  });
});
