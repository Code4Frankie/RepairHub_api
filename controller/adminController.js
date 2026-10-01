import User from '../model/userModel.js';
import RepairJob from '../model/repairJobModel.js';
import RepairRequest from '../model/repairRequestModel.js';
import Transaction from '../model/transactionModel.js';
import Dispute from '../model/disputeModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { conflict, notFound } from '../utils/ApiError.js';
import { creditWallet } from '../services/walletService.js';
import { notifyUser } from '../services/notificationService.js';
import { autoReleaseDue } from '../services/escrowService.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';

const sum = async (match) => {
  const [r] = await Transaction.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  return r?.total || 0;
};
const countBy = async (Model, field) => {
  const rows = await Model.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
};

// GET /api/admin/stats  — analytics dashboard
export const getStats = asyncHandler(async (req, res) => {
  const [users, jobs, requests, gmv, commission, openDisputes, pendingTech, pendingCenters, pendingWithdrawals] = await Promise.all([
    countBy(User, 'role'), countBy(RepairJob, 'status'), countBy(RepairRequest, 'status'),
    sum({ type: 'escrow_payment', status: 'success' }),
    sum({ type: 'commission', status: 'success' }),
    Dispute.countDocuments({ status: 'open' }),
    TechnicianProfile.countDocuments({ verificationStatus: 'pending' }),
    ServiceCenterProfile.countDocuments({ verificationStatus: 'pending' }),
    Transaction.countDocuments({ type: 'withdrawal', status: 'pending' }),
  ]);
  return ok(res, { users, jobs, requests, escrowVolume: gmv, commissionEarned: commission, openDisputes, pendingVerifications: pendingTech + pendingCenters, pendingWithdrawals });
});

// GET /api/admin/withdrawals?status=pending
export const listWithdrawals = asyncHandler(async (req, res) => {
  const filter = { type: 'withdrawal' };
  if (req.query.status) filter.status = req.query.status;
  const pg = parsePagination(req.query);
  const [items, total] = await Promise.all([
    Transaction.find(filter).populate('userId', 'fullName email').sort({ createdAt: 1 }).skip(pg.skip).limit(pg.limit),
    Transaction.countDocuments(filter),
  ]);
  return ok(res, items, 'Withdrawals', 200, pageMeta(pg, total));
});

// PATCH /api/admin/withdrawals/:id  { decision: paid|rejected, note? }  — rejected funds go back to the wallet.
export const processWithdrawal = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  const txn = await Transaction.findOneAndUpdate(
    { _id: req.params.id, type: 'withdrawal', status: 'pending' },
    { status: decision === 'paid' ? 'success' : 'rejected', note, processedBy: req.user._id },
    { new: true }
  );
  if (!txn) {
    if (await Transaction.exists({ _id: req.params.id, type: 'withdrawal' })) throw conflict('Withdrawal already processed');
    throw notFound('Withdrawal not found');
  }
  if (decision === 'rejected') await creditWallet(txn.userId, txn.amount);
  await notifyUser(txn.userId, 'payment', decision === 'paid' ? `Your ₦${txn.amount} withdrawal was paid out.` : `Your withdrawal was rejected${note ? `: ${note}` : ''}. Funds were returned to your wallet.`);
  return ok(res, txn, `Withdrawal ${decision}`);
});

// POST /api/admin/run-auto-release — manual trigger for the escrow auto-release sweep
export const runAutoRelease = asyncHandler(async (req, res) => ok(res, { released: await autoReleaseDue() }, 'Auto-release sweep complete'));
