import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-002 — repair requests (FR-6, FR-7)
describe('UAT-002 — Repair request creation & visibility', () => {
  test('a customer creates a request against an active category', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(c, cat._id);
    expect(rr.status).toBe('open');
    expect(rr.location.coordinates).toEqual([3.3792, 6.5244]);
  });

  test('a technician cannot create a request; invalid input is rejected', async () => {
    const admin = await h.createAdmin();
    const t = await h.registerUser('technician');
    const c = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    expect((await api().post('/api/repair-requests').set(auth(t)).field('serviceCategoryId', cat._id).field('itemType', 'Laptop').field('problemDescription', 'Screen is broken badly')).status).toBe(403);
    expect((await api().post('/api/repair-requests').set(auth(c)).field('serviceCategoryId', cat._id).field('itemType', 'Laptop').field('problemDescription', 'short')).status).toBe(400);
    expect((await api().post('/api/repair-requests').set(auth(c)).field('serviceCategoryId', '64b7f3c2a1b2c3d4e5f6a7b8').field('itemType', 'Laptop').field('problemDescription', 'Screen is broken badly')).status).toBe(400);
  });

  test('customers only see their own requests', async () => {
    const admin = await h.createAdmin();
    const a = await h.registerUser('customer');
    const b = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    const ra = await h.createRepairRequest(a, cat._id);
    await h.createRepairRequest(b, cat._id);
    const list = await api().get('/api/repair-requests').set(auth(a));
    expect(list.body.data.length).toBe(1);
    expect((await api().get(`/api/repair-requests/${ra._id}`).set(auth(b))).status).toBe(403);
  });

  test('unverified technicians see no job board; verified ones see open work', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    const t = await h.registerUser('technician');
    const cat = await h.createCategory(admin);
    await h.createRepairRequest(c, cat._id);
    expect((await api().get('/api/repair-requests').set(auth(t))).body.data.length).toBe(0);
    await h.verifyTechnician(admin, t);
    expect((await api().get('/api/repair-requests').set(auth(t))).body.data.length).toBe(1);
  });

  test('matching verified technicians are notified of a new request (FR-7)', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    const t = await h.registerUser('technician');
    const cat = await h.createCategory(admin);
    await h.verifyTechnician(admin, t);
    const p = await h.getTechnicianProfile(t.user._id);
    await api().patch(`/api/technician-profiles/${p._id}`).set(auth(t)).send({ serviceCategoryIds: [cat._id] });
    await h.createRepairRequest(c, cat._id);
    await new Promise((r) => setTimeout(r, 300));
    const n = await api().get('/api/notifications').set(auth(t));
    expect(n.body.data.some((x) => x.type === 'repair_request')).toBe(true);
  });

  test('only the owner can cancel, and only before booking', async () => {
    const admin = await h.createAdmin();
    const a = await h.registerUser('customer');
    const b = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(a, cat._id);
    expect((await api().patch(`/api/repair-requests/${rr._id}/cancel`).set(auth(b))).status).toBe(404);
    const res = await api().patch(`/api/repair-requests/${rr._id}/cancel`).set(auth(a));
    expect(res.body.data.status).toBe('cancelled');
    expect((await api().patch(`/api/repair-requests/${rr._id}/cancel`).set(auth(a))).status).toBe(409);
  });

  test('pagination meta is returned and limit is capped', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    for (let i = 0; i < 3; i++) await h.createRepairRequest(c, cat._id);
    const res = await api().get('/api/repair-requests?limit=2&page=2').set(auth(c));
    expect(res.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, pages: 2 });
    expect(res.body.data.length).toBe(1);
    expect((await api().get('/api/repair-requests?limit=5000').set(auth(c))).status).toBe(400);
  });
});
