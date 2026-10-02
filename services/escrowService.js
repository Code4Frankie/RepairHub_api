import crypto from 'crypto';
import RepairJob from '../model/repairJobModel.js';
import Wallet from '../model/walletModel.js';
import { config } from '../config/env.js';
import { creditWallet, debitWallet, getOrCreateWallet, record } from './walletService.js';
import { notifyUser } from './notificationService.js';
import { conflict } from '../utils/ApiError.js';
import { issueWarranty } from './warrantyService.js';

export const newReference = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;

export const commissionFor = (amount) => Math.round(amount * config.commissionRate);

// Moves the job's payment unpaid -> held. Guarded so a replayed webhook is a no-op.
export const markHeld = async (jobId, { method, reference }) => {
  const job = await RepairJob.findOneAndUpdate(
    { _id: jobId, 'payment.status': 'unpaid' },
    { $set: { 'payment.method': method, 'payment.status': 'held', 'payment.reference': reference, 'payment.heldAt': new Date() } },
    { new: true }
  );
  if (job) {
    await notifyUser(job.payeeUserId, 'payment', 'Customer payment is secured in escrow. You can start the repair.', job._id);
  }
  return job; // null => already held/settled
};

// Customer chose "pay on delivery": no escrow, commission is collected from the next payout.
export const markCash = async (jobId) =>
  RepairJob.findOneAndUpdate(
    { _id: jobId, 'payment.status': 'unpaid' },
    { $set: { 'payment.method': 'cash', 'payment.status': 'cash' } },
    { new: true }
  );

// Pays the customer's wallet balance into escrow.
export const payFromWallet = async (job) => {
  const reference = newReference('wal');
  await debitWallet(job.customerUserId, job.price);
  const held = await markHeld(job._id, { method: 'wallet', reference });
  if (!held) {
    await creditWallet(job.customerUserId, job.price); // lost a race: give the money back
    throw conflict('This job has already been paid for');
  }
  await record({
    userId: job.customerUserId, repairJobId: job._id, type: 'escrow_payment', gateway: 'wallet',
    amount: job.price, status: 'success', reference,
  });
  return held;
};

// Credits the payee, netting off any commission they still owe from cash jobs.
const payOut = async (job, gross, { commission, reference }) => {
  const net = gross - commission;
  const wallet = await getOrCreateWallet(job.payeeUserId);
  const offset = Math.min(wallet.commissionOwed || 0, net);
  if (offset > 0) {
    await Wallet.updateOne({ userId: job.payeeUserId }, { $inc: { commissionOwed: -offset } });
  }
  const credit = net - offset;
  if (credit > 0) await creditWallet(job.payeeUserId, credit);

  await record({ userId: job.payeeUserId, repairJobId: job._id, type: 'payout', gateway: 'internal', amount: credit, status: 'success', reference: `${reference}_payout`, note: offset ? `after ₦${offset} commission offset` : undefined });
  if (commission > 0) {
    await record({ userId: job.payeeUserId, repairJobId: job._id, type: 'commission', gateway: 'internal', amount: commission, status: 'success', reference: `${reference}_fee` });
  }
};

// held -> released: platform commission is deducted, the rest goes to the payee's wallet.
export const releaseEscrow = async (jobId, { amount } = {}) => {
  const existing = await RepairJob.findById(jobId);
  const gross = amount ?? existing.price;
  const commission = commissionFor(gross);
  const job = await RepairJob.findOneAndUpdate(
    { _id: jobId, 'payment.status': 'held' },
    { $set: { 'payment.status': 'released', 'payment.settledAt': new Date(), finalPrice: gross, platformCommission: commission } },
    { new: true }
  );
  if (!job) return null; // already released/refunded — idempotent

  await payOut(job, gross, { commission, reference: `rel_${job._id}` });
  await notifyUser(job.payeeUserId, 'payment', `₦${gross - commission} has been released to your wallet.`, job._id);
  return job;
};

// held -> refunded: money goes back to the customer's in-app wallet. `refundAmount` < price
// is a partial refund; the remainder is released to the payee (less commission).
export const refundEscrow = async (jobId, refundAmount) => {
  const existing = await RepairJob.findById(jobId);
  const refund = Math.min(refundAmount ?? existing.price, existing.price);
  const remainder = existing.price - refund;
  const commission = commissionFor(remainder);

  const job = await RepairJob.findOneAndUpdate(
    { _id: jobId, 'payment.status': 'held' },
    { $set: { 'payment.status': remainder > 0 ? 'released' : 'refunded', 'payment.settledAt': new Date(), finalPrice: remainder, platformCommission: commission } },
    { new: true }
  );
  if (!job) return null;

  if (refund > 0) {
    await creditWallet(job.customerUserId, refund);
    await record({ userId: job.customerUserId, repairJobId: job._id, type: 'refund', gateway: 'internal', amount: refund, status: 'success', reference: `ref_${job._id}` });
    await notifyUser(job.customerUserId, 'payment', `₦${refund} has been refunded to your RepairHub wallet.`, job._id);
  }
  if (remainder > 0) await payOut(job, remainder, { commission, reference: `rel_${job._id}` });
  return job;
};

// Cash job confirmed: record the commission as owed by the payee.
export const settleCash = async (jobId) => {
  const existing = await RepairJob.findById(jobId);
  const commission = commissionFor(existing.price);
  const job = await RepairJob.findOneAndUpdate(
    { _id: jobId, 'payment.status': 'cash' },
    { $set: { 'payment.status': 'cash_settled', 'payment.settledAt': new Date(), finalPrice: existing.price, platformCommission: commission } },
    { new: true }
  );
  if (!job) return null;
  await getOrCreateWallet(job.payeeUserId);
  await Wallet.updateOne({ userId: job.payeeUserId }, { $inc: { commissionOwed: commission } });
  await record({ userId: job.payeeUserId, repairJobId: job._id, type: 'commission', gateway: 'cash', amount: commission, status: 'success', reference: `cash_${job._id}_fee`, note: 'commission owed on cash job' });
  return job;
};

// Customer says "I'm satisfied" (or the timer expires): settle whichever way the job was paid.
export const settleJob = async (jobId) => {
  const job = await RepairJob.findById(jobId);
  if (!job) return null;
  if (job.payment.status === 'held') return releaseEscrow(jobId);
  if (job.payment.status === 'cash') return settleCash(jobId);
  return null;
};

// Called on an interval: releases escrow the customer neither confirmed nor disputed in time.
export const autoReleaseDue = async () => {
  const cutoff = new Date(Date.now() - config.autoReleaseHours * 3600 * 1000);
  const due = await RepairJob.find({ status: 'completed', 'payment.status': 'held', completedAt: { $lte: cutoff } }).limit(100);
  let released = 0;
  for (const job of due) {
    const done = await releaseEscrow(job._id);
    if (done) {
      released += 1;
      await notifyUser(job.customerUserId, 'payment', 'Payment was automatically released to your technician.', job._id);
    }
  }
  return released;
};

export { issueWarranty };
