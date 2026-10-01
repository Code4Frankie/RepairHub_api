import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const { getJob, getWallet } = h;

// Disputes freeze escrow until an admin rules (gap #2)
describe('Disputes & escrow arbitration', () => {
  const open = (u, jobId, reason = 'The laptop still does not boot after repair') =>
    api().post('/api/disputes').set(auth(u)).send({ repairJobId: jobId, reason });

  test('opening a dispute freezes the job and blocks release and auto-release', async () => {
    const { admin, customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    const res = await open(customer, job._id);
    expect(res.status).toBe(201);
    expect((await getJob(customer, job._id)).status).toBe('disputed');
    expect((await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer))).status).toBe(409);
    const RepairJob = (await import('../model/repairJobModel.js')).default;
    await RepairJob.updateOne({ _id: job._id }, { completedAt: new Date(0) });
    expect((await api().post('/api/admin/run-auto-release').set(auth(admin))).body.data.released).toBe(0);
    expect((await open(technician, job._id)).status).toBe(409); // one dispute at a time
    const n = await api().get('/api/notifications').set(auth(technician));
    expect(n.body.data.some((x) => x.type === 'dispute')).toBe(true);
  });

  test('only participants can open one; admins cannot; validation applies', async () => {
    const { admin, job } = await h.buildCompletedJob();
    const stranger = await h.registerUser('customer');
    expect((await open(stranger, job._id)).status).toBe(403);
    expect((await open(admin, job._id)).status).toBe(403);
    const { customer, job: j2 } = await h.buildCompletedJob();
    expect((await open(customer, j2._id, 'short')).status).toBe(400);
  });

  test('admin resolves: refund -> customer wallet gets everything, technician nothing', async () => {
    const { admin, customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    const d = (await open(customer, job._id)).body.data;
    expect((await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(customer)).send({ decision: 'refund' })).status).toBe(403);
    const res = await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'refund', note: 'Not fixed' });
    expect(res.status).toBe(200);
    const j = await getJob(customer, job._id);
    expect(j.payment.status).toBe('refunded');
    expect(j.status).toBe('cancelled');
    expect((await getWallet(customer.user._id)).balance).toBe(20000);
    expect((await getWallet(technician.user._id))?.balance || 0).toBe(0);
    expect((await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'release' })).status).toBe(409);
  });

  test('admin resolves: release -> technician is paid less commission', async () => {
    const { admin, customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    const d = (await open(customer, job._id)).body.data;
    await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'release' });
    expect((await getWallet(technician.user._id)).balance).toBe(18000);
    expect((await getJob(customer, job._id)).status).toBe('completed');
  });

  test('admin resolves: partial refund splits the money correctly', async () => {
    const { admin, customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    const d = (await open(customer, job._id)).body.data;
    expect((await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'partial' })).status).toBe(400); // amount required
    expect((await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'partial', refundAmount: 20000 })).status).toBe(400); // that's a full refund
    const ok = await api().patch(`/api/disputes/${d._id}/resolve`).set(auth(admin)).send({ decision: 'partial', refundAmount: 5000 });
    expect(ok.status).toBe(200);
    expect((await getWallet(customer.user._id)).balance).toBe(5000);
    expect((await getWallet(technician.user._id)).balance).toBe(15000 - 1500); // 15,000 less 10%
  });

  test('disputes list: admin sees all, users see only their own', async () => {
    const a = await h.buildCompletedJob();
    const b = await h.buildCompletedJob();
    await open(a.customer, a.job._id);
    await open(b.customer, b.job._id);
    expect((await api().get('/api/disputes').set(auth(a.admin))).body.data.length).toBe(2);
    expect((await api().get('/api/disputes').set(auth(a.customer))).body.data.length).toBe(1);
    expect((await api().get('/api/disputes?status=resolved').set(auth(a.admin))).body.data.length).toBe(0);
  });
});
