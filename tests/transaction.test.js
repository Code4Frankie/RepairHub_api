import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

import crypto from 'crypto';
const { getJob, getWallet, Transaction } = h;

// UAT-006 — escrow & commission (FR-13, FR-14, FR-15)
describe('UAT-006 — Escrow, commission & wallets', () => {
  test('paystack: pay -> checkout URL; only the SIGNED webhook moves money into escrow', async () => {
    const { customer, technician, job } = await h.buildBookedJob({ price: 20000 });
    const init = await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'paystack' });
    expect(init.status).toBe(201);
    expect(init.body.data.authorizationUrl).toContain(init.body.data.reference);
    expect(init.body.data.amount).toBe(20000);
    expect((await getJob(customer, job._id)).payment.status).toBe('unpaid'); // not paid until Paystack says so

    // forged webhook (wrong secret) is rejected and changes nothing
    const forged = await h.paystackWebhook(init.body.data.reference, 20000, { secret: 'attacker' });
    expect(forged.status).toBe(401);
    expect((await getJob(customer, job._id)).payment.status).toBe('unpaid');

    expect((await h.paystackWebhook(init.body.data.reference, 20000)).status).toBe(200);
    expect((await getJob(customer, job._id)).payment.status).toBe('held');
    const notes = await api().get('/api/notifications').set(auth(technician));
    expect(notes.body.data.some((n) => n.type === 'payment')).toBe(true);
  });

  test('webhook replay is idempotent; an amount mismatch is not honoured', async () => {
    const { customer, job } = await h.buildBookedJob({ price: 20000 });
    const init = await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'paystack' });
    await h.paystackWebhook(init.body.data.reference, 500); // customer paid only ₦500
    expect((await getJob(customer, job._id)).payment.status).toBe('unpaid');
    const t = await Transaction.findOne({ reference: init.body.data.reference });
    expect(t.status).toBe('failed');

    const init2 = await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'paystack' });
    await h.paystackWebhook(init2.body.data.reference, 20000);
    await h.paystackWebhook(init2.body.data.reference, 20000); // replay
    expect((await getJob(customer, job._id)).payment.status).toBe('held');
    expect(await Transaction.countDocuments({ type: 'escrow_payment', status: 'success' })).toBe(1);
  });

  test('the price cannot be tampered with: amount comes from the job, and only the owner can pay', async () => {
    const { customer, job } = await h.buildBookedJob({ price: 20000 });
    const init = await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'paystack', amount: 1 });
    expect(init.body.data.amount).toBe(20000);
    const other = await h.registerUser('customer');
    expect((await api().post('/api/transactions/pay').set(auth(other)).send({ repairJobId: job._id, method: 'wallet' })).status).toBe(403);
  });

  test('confirming satisfaction releases escrow: 10% commission, net to the technician wallet', async () => {
    const { customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    expect((await getWallet(technician.user._id))?.balance || 0).toBe(0); // nothing released yet
    const res = await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer));
    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('released');
    expect(res.body.data.platformCommission).toBe(2000);
    expect((await getWallet(technician.user._id)).balance).toBe(18000);

    const txns = await Transaction.find({ repairJobId: job._id, status: 'success' }).sort({ createdAt: 1 });
    expect(txns.map((t) => t.type).sort()).toEqual(['commission', 'escrow_payment', 'payout']);
    // double-confirm can never pay twice
    expect((await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer))).status).toBe(409);
    expect((await getWallet(technician.user._id)).balance).toBe(18000);
  });

  test('confirm is customer-only and requires completion', async () => {
    const { customer, technician, job } = await h.buildPaidJob();
    expect((await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer))).status).toBe(409); // not completed
    await h.setStatus(technician, job._id, 'in_progress');
    await h.setStatus(technician, job._id, 'completed');
    expect((await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(technician))).status).toBe(403);
  });

  test('wallet payment: debits the customer, holds in escrow; insufficient balance is refused', async () => {
    const { customer, job } = await h.buildBookedJob({ price: 15000 });
    expect((await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'wallet' })).status).toBe(400);
    await h.fundWallet(customer.user._id, 16000);
    expect((await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'wallet' })).status).toBe(200);
    expect((await getWallet(customer.user._id)).balance).toBe(1000);
    expect((await getJob(customer, job._id)).payment.status).toBe('held');
    expect((await api().post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: job._id, method: 'wallet' })).status).toBe(409);
  });

  test('wallet top-up goes through paystack and is credited by the signed webhook', async () => {
    const c = await h.registerUser('customer');
    const init = await api().post('/api/transactions/topup').set(auth(c)).send({ amount: 5000 });
    expect(init.status).toBe(201);
    await h.paystackWebhook(init.body.data.reference, 5000);
    expect((await getWallet(c.user._id)).balance).toBe(5000);
    await h.paystackWebhook(init.body.data.reference, 5000);
    expect((await getWallet(c.user._id)).balance).toBe(5000);
  });

  test('pay-on-delivery: no escrow; commission is owed and netted from the next payout', async () => {
    const cash = await h.buildBookedJob({ price: 10000 });
    await api().post('/api/transactions/pay').set(auth(cash.customer)).send({ repairJobId: cash.job._id, method: 'cash' });
    await h.setStatus(cash.technician, cash.job._id, 'in_progress');
    await h.setStatus(cash.technician, cash.job._id, 'completed');
    expect((await api().post(`/api/repair-jobs/${cash.job._id}/confirm`).set(auth(cash.customer))).body.data.payment.status).toBe('cash_settled');
    let w = await getWallet(cash.technician.user._id);
    expect(w.balance).toBe(0);
    expect(w.commissionOwed).toBe(1000);

    // a second (escrow) job for the same technician nets the owed commission
    const admin = cash.admin;
    const c2 = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(c2, cat._id);
    const q = (await h.submitQuotation(cash.technician, rr._id, { price: 20000 })).body.data;
    const { appointment } = await h.acceptAndBook(c2, q._id);
    await h.payWithPaystack(c2, appointment.repairJobId, 20000);
    await h.setStatus(cash.technician, appointment.repairJobId, 'in_progress');
    await h.setStatus(cash.technician, appointment.repairJobId, 'completed');
    await api().post(`/api/repair-jobs/${appointment.repairJobId}/confirm`).set(auth(c2));
    w = await getWallet(cash.technician.user._id);
    expect(w.commissionOwed).toBe(0);
    expect(w.balance).toBe(20000 - 2000 - 1000);
  });

  test('auto-release pays the technician when the customer stays silent past the window', async () => {
    const { admin, technician, job } = await h.buildCompletedJob({ price: 10000 });
    const RepairJob = (await import('../model/repairJobModel.js')).default;
    await RepairJob.updateOne({ _id: job._id }, { completedAt: new Date(Date.now() - 73 * 3600 * 1000) });
    const res = await api().post('/api/admin/run-auto-release').set(auth(admin));
    expect(res.body.data.released).toBe(1);
    expect((await getWallet(technician.user._id)).balance).toBe(9000);
    expect((await api().post('/api/admin/run-auto-release').set(auth(admin))).body.data.released).toBe(0);
  });

  test('withdrawals: limited to withdrawable balance, admin pays or rejects (reject refunds)', async () => {
    const { admin, customer, technician, job } = await h.buildCompletedJob({ price: 20000 });
    await api().post(`/api/repair-jobs/${job._id}/confirm`).set(auth(customer));
    const bank = { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Test Tech' };
    expect((await api().post('/api/wallets/withdraw').set(auth(technician)).send({ ...bank, amount: 999999 })).status).toBe(400);
    expect((await api().post('/api/wallets/withdraw').set(auth(technician)).send({ ...bank, amount: 500 })).status).toBe(400); // below minimum
    expect((await api().post('/api/wallets/withdraw').set(auth(customer)).send({ ...bank, amount: 5000 })).status).toBe(403);
    expect((await api().post('/api/wallets/withdraw').set(auth(technician)).send({ ...bank, accountNumber: '12', amount: 5000 })).status).toBe(400);

    const wd = await api().post('/api/wallets/withdraw').set(auth(technician)).send({ ...bank, amount: 10000 });
    expect(wd.status).toBe(201);
    expect((await getWallet(technician.user._id)).balance).toBe(8000);

    const rejected = await api().patch(`/api/admin/withdrawals/${wd.body.data._id}`).set(auth(admin)).send({ decision: 'rejected', note: 'bank name mismatch' });
    expect(rejected.body.data.status).toBe('rejected');
    expect((await getWallet(technician.user._id)).balance).toBe(18000);
    expect((await api().patch(`/api/admin/withdrawals/${wd.body.data._id}`).set(auth(admin)).send({ decision: 'paid' })).status).toBe(409);

    const wd2 = await api().post('/api/wallets/withdraw').set(auth(technician)).send({ ...bank, amount: 18000 });
    expect((await api().patch(`/api/admin/withdrawals/${wd2.body.data._id}`).set(auth(technician)).send({ decision: 'paid' })).status).toBe(403);
    expect((await api().patch(`/api/admin/withdrawals/${wd2.body.data._id}`).set(auth(admin)).send({ decision: 'paid' })).body.data.status).toBe('success');
    expect((await getWallet(technician.user._id)).balance).toBe(0);
  });

  test('wallets and ledgers are private', async () => {
    const a = await h.registerUser('customer');
    const b = await h.registerUser('technician');
    expect((await api().get(`/api/wallets/${b.user._id}`).set(auth(a))).status).toBe(403);
    const mine = await api().get('/api/wallets/me').set(auth(a));
    expect(mine.body.data.balance).toBe(0);
    expect((await api().get(`/api/transactions/wallet/${mine.body.data._id}`).set(auth(b))).status).toBe(403);
  });
});
