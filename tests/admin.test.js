import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe('Admin, notifications & platform hardening', () => {
  test('stats endpoint is admin-only and reflects activity', async () => {
    const { admin, customer, job } = await h.buildCompletedJob({ price: 20000 });
    await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer));
    expect((await api().get('/api/admin/stats').set(auth(customer))).status).toBe(403);
    const s = (await api().get('/api/admin/stats').set(auth(admin))).body.data;
    expect(s.escrowVolume).toBe(20000);
    expect(s.commissionEarned).toBe(2000);
    expect(s.users.customer).toBe(1);
    expect(s.jobs.completed).toBe(1);
  });

  test('admin can list/search users and suspend a technician who then vanishes from search', async () => {
    const admin = await h.createAdmin();
    const t = await h.registerUser('technician', { fullName: 'Searchable Sam' });
    await h.verifyTechnician(admin, t);
    const found = await api().get('/api/users?q=Searchable&role=technician').set(auth(admin));
    expect(found.body.data.length).toBe(1);
    await api().patch(`/api/users/${t.user._id}/status`).set(auth(admin)).send({ status: 'suspended' });
    expect((await api().get('/api/technician-profiles')).body.data.length).toBe(0);
    expect((await api().patch(`/api/users/${admin.user._id}/status`).set(auth(admin)).send({ status: 'suspended' })).status).toBe(403);
  });

  test('notifications: own only, unread filter, mark one and mark all', async () => {
    const { customer, technician } = await h.buildBookedJob();
    const list = await api().get('/api/notifications').set(auth(technician));
    expect(list.body.meta.unreadCount).toBeGreaterThan(0);
    const first = list.body.data[0];
    expect((await api().patch(`/api/notifications/${first._id}/read`).set(auth(customer))).status).toBe(404); // not yours
    expect((await api().patch(`/api/notifications/${first._id}/read`).set(auth(technician))).body.data.isRead).toBe(true);
    await api().patch('/api/notifications/read-all').set(auth(technician));
    expect((await api().get('/api/notifications?unread=true').set(auth(technician))).body.data.length).toBe(0);
  });

  test('customer profiles are private; customers can edit only their own', async () => {
    const a = await h.registerUser('customer');
    const b = await h.registerUser('customer');
    const pa = await h.getCustomerProfile(a.user._id);
    expect((await api().get(`/api/customer-profiles/${pa._id}`).set(auth(b))).status).toBe(403);
    expect((await api().patch(`/api/customer-profiles/${pa._id}`).set(auth(b)).send({ address: 'x' })).status).toBe(403);
    const ok = await api().patch(`/api/customer-profiles/${pa._id}`).set(auth(a)).send({ address: '12 Allen Ave, Ikeja', location: { lng: 3.35, lat: 6.6 } });
    expect(ok.body.data.address).toMatch(/Allen/);
    expect(ok.body.data.location.coordinates).toEqual([3.35, 6.6]);
  });

  test('categories: public read, admin-only write, duplicates rejected', async () => {
    const admin = await h.createAdmin();
    const c = await h.registerUser('customer');
    expect((await api().post('/api/service-categories').set(auth(c)).send({ name: 'Phones' })).status).toBe(403);
    expect((await api().post('/api/service-categories').set(auth(admin)).send({ name: 'Phones' })).status).toBe(201);
    expect((await api().post('/api/service-categories').set(auth(admin)).send({ name: 'Phones' })).status).toBe(409);
    expect((await api().get('/api/service-categories')).body.data.length).toBe(1);
  });

  test('technician search: by category, paginated, sorted by rating', async () => {
    const admin = await h.createAdmin();
    const cat = await h.createCategory(admin);
    for (let i = 0; i < 3; i++) {
      const t = await h.registerUser('technician');
      await h.verifyTechnician(admin, t);
      const p = await h.getTechnicianProfile(t.user._id);
      await api().patch(`/api/technician-profiles/${p._id}`).set(auth(t)).send({ serviceCategoryIds: [cat._id], serviceAreas: ['Ikeja'] });
    }
    const res = await api().get(`/api/technician-profiles?serviceCategoryId=${cat._id}&area=Ikeja&limit=2`);
    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.data[0].userId.fullName).toBeDefined();
    expect(res.body.data[0].userId.email).toBeUndefined();
  });

  // FerretDB (used only for offline sandbox runs) has no 2dsphere support; real MongoDB / CI runs this.
  const geoTest = process.env.SKIP_GEO_TESTS ? test.skip : test;
  geoTest('geo search returns only technicians within the radius', async () => {
    const admin = await h.createAdmin();
    const near = await h.registerUser('technician');
    const far = await h.registerUser('technician');
    for (const [t, loc] of [[near, { lng: 3.38, lat: 6.52 }], [far, { lng: 7.49, lat: 9.07 }]]) {
      await h.verifyTechnician(admin, t);
      const p = await h.getTechnicianProfile(t.user._id);
      await api().patch(`/api/technician-profiles/${p._id}`).set(auth(t)).send({ baseLocation: loc });
    }
    const res = await api().get('/api/technician-profiles?lng=3.379&lat=6.524&radiusKm=25');
    expect(res.body.data.length).toBe(1);
  });

  test('unknown routes and malformed JSON return clean JSON errors', async () => {
    const nf = await api().get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.success).toBe(false);
    const bad = await api().post('/api/users/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    expect((await api().get('/health')).body.status).toBe('ok');
  });

  test('swagger docs are served', async () => {
    const res = await api().get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(40);
  });
});
