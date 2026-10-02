import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-004 — booking (FR-10)
describe('UAT-004 — Appointment booking', () => {
  test('booking an accepted quotation creates the appointment AND the job, and books the request', async () => {
    const { customer, repairRequest, appointment, job, quotation } = await h.buildBookedJob({ price: 18000 });
    expect(appointment.status).toBe('scheduled');
    expect(appointment.serviceMode).toBe('dropoff');
    expect(job.status).toBe('accepted');
    expect(job.price).toBe(18000); // copied from the quotation, not client-supplied
    expect(job.payment.status).toBe('unpaid');
    expect(String(job.quotationId)).toBe(quotation._id);
    const rr = await api().get(`/api/repair-requests/${repairRequest._id}`).set(auth(customer));
    expect(rr.body.data.status).toBe('booked');
  });

  test('cannot book a quotation that was never accepted, or book it twice', async () => {
    const admin = await h.createAdmin();
    const customer = await h.registerUser('customer');
    const t = await h.registerUser('technician');
    await h.verifyTechnician(admin, t);
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(customer, cat._id);
    const q = (await h.submitQuotation(t, rr._id)).body.data;
    const when = new Date(Date.now() + 86400000).toISOString();
    expect((await api().post('/api/appointments').set(auth(customer)).send({ quotationId: q._id, scheduledAt: when })).status).toBe(409);
    await h.acceptAndBook(customer, q._id);
    expect((await api().post('/api/appointments').set(auth(customer)).send({ quotationId: q._id, scheduledAt: when })).status).toBe(409);
  });

  test('a stranger cannot book someone else\'s accepted quotation; past dates are rejected', async () => {
    const { customer, quotation } = await h.buildBookedJob();
    const stranger = await h.registerUser('customer');
    const when = new Date(Date.now() + 86400000).toISOString();
    expect((await api().post('/api/appointments').set(auth(stranger)).send({ quotationId: quotation._id, scheduledAt: when })).status).toBe(403); // not their request
    expect((await api().post('/api/appointments').set(auth(customer)).send({ quotationId: quotation._id, scheduledAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
  });

  test('either party can reschedule; outsiders cannot', async () => {
    const { technician, appointment } = await h.buildBookedJob();
    const outsider = await h.registerUser('customer');
    const newDate = new Date(Date.now() + 3 * 86400000).toISOString();
    expect((await api().patch(`/api/appointments/${appointment._id}/reschedule`).set(auth(outsider)).send({ scheduledAt: newDate })).status).toBe(403);
    const res = await api().patch(`/api/appointments/${appointment._id}/reschedule`).set(auth(technician)).send({ scheduledAt: newDate });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rescheduled');
  });

  test('cancelling before work cancels the job and refunds escrow in full to the wallet', async () => {
    const { customer, appointment, job } = await h.buildPaidJob({ price: 12000 });
    const res = await api().patch(`/api/appointments/${appointment._id}/cancel`).set(auth(customer)).send({ reason: 'changed my mind' });
    expect(res.status).toBe(200);
    const after = await h.getJob(customer, job._id);
    expect(after.status).toBe('cancelled');
    expect(after.payment.status).toBe('refunded');
    expect((await h.getWallet(customer.user._id)).balance).toBe(12000);
  });

  test('once work has started, cancelling is refused (dispute instead)', async () => {
    const { customer, technician, appointment, job } = await h.buildPaidJob();
    await h.setStatus(technician, job._id, 'in_progress');
    expect((await api().patch(`/api/appointments/${appointment._id}/cancel`).set(auth(customer))).status).toBe(409);
  });
});
