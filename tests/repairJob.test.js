import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-005 — status tracking (FR-11, FR-12, FR-19)
describe('UAT-005 — Repair status tracking', () => {
  test('work cannot start until the customer has paid (escrow gate)', async () => {
    const { technician, job } = await h.buildBookedJob();
    expect((await h.setStatus(technician, job._id, 'in_progress')).status).toBe(409);
    expect((await h.setStatus(technician, job._id, 'diagnosing')).status).toBe(200); // diagnosis is fine
  });

  test('a job walks the wireframe stages with progress %, timestamps and history', async () => {
    const { customer, technician, job } = await h.buildPaidJob();
    const step = async (s, note) => (await h.setStatus(technician, job._id, s, note)).body.data;
    expect((await step('diagnosing')).progress).toBe(10);
    expect((await step('awaiting_parts', 'Screen ordered')).progress).toBe(30);
    const ip = await step('in_progress');
    expect(ip.progress).toBe(50);
    expect(ip.startedAt).toBeDefined();
    expect((await step('quality_check')).progress).toBe(80);
    expect((await step('ready')).progress).toBe(90);
    const done = await step('completed');
    expect(done.progress).toBe(100);
    expect(done.completedAt).toBeDefined();
    expect(done.statusHistory.length).toBe(7);
    const notes = await api().get('/api/notifications').set(auth(customer));
    expect(notes.body.data.filter((n) => n.type === 'status_update').length).toBeGreaterThanOrEqual(6);
  });

  test('illegal transitions are refused', async () => {
    const { technician, job } = await h.buildPaidJob();
    expect((await h.setStatus(technician, job._id, 'completed')).status).toBe(409); // accepted -> completed
    await h.setStatus(technician, job._id, 'in_progress');
    await h.setStatus(technician, job._id, 'completed');
    expect((await h.setStatus(technician, job._id, 'in_progress')).status).toBe(409); // completed is terminal
  });

  test('only the assigned provider can update status — not the customer, not another technician', async () => {
    const { admin, customer, job } = await h.buildPaidJob();
    const other = await h.registerUser('technician');
    await h.verifyTechnician(admin, other);
    expect((await h.setStatus(other, job._id, 'in_progress')).status).toBe(403);
    expect((await h.setStatus(customer, job._id, 'in_progress')).status).toBe(403);
  });

  test('completing issues a warranty using the quoted warranty days (FR-19)', async () => {
    const { customer, job } = await h.buildCompletedJob({ warrantyDays: 90 });
    const w = await api().get(`/api/warranty-records/job/${job._id}`).set(auth(customer));
    expect(w.status).toBe(200);
    expect(w.body.data.durationDays).toBe(90);
    expect(new Date(w.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
  });

  test('job visibility: participants see it (with counterpart phone); outsiders do not', async () => {
    const { customer, technician, job } = await h.buildBookedJob();
    const outsider = await h.registerUser('customer');
    const asCustomer = await api().get(`/api/repair-jobs/${job._id}`).set(auth(customer));
    expect(asCustomer.body.data.contact.phone).toBe('08031234567');
    expect((await api().get(`/api/repair-jobs/${job._id}`).set(auth(technician))).status).toBe(200);
    expect((await api().get(`/api/repair-jobs/${job._id}`).set(auth(outsider))).status).toBe(403);
    expect((await api().get('/api/repair-jobs').set(auth(customer))).body.data.length).toBe(1);
    expect((await api().get('/api/repair-jobs').set(auth(outsider))).body.data.length).toBe(0);
  });

  test('there is no public endpoint to fabricate a job', async () => {
    const { customer } = await h.buildBookedJob();
    expect((await api().post('/api/repair-jobs').set(auth(customer)).send({})).status).toBe(404);
  });
});
