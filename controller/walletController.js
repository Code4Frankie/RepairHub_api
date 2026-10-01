import Wallet from '../model/walletModel.js';
import Transaction from '../model/transactionModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { badRequest, forbidden, notFound } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { debitWallet, getOrCreateWallet } from '../services/walletService.js';
import { newReference } from '../services/escrowService.js';

const withdrawable = (w) => Math.max(w.balance - (w.commissionOwed || 0), 0);

export const getMyWallet = asyncHandler(async (req, res) => {
  const wallet = await getOrCreateWallet(req.user._id);
  return ok(res, { ...wallet.toObject(), withdrawable: withdrawable(wallet) });
});

// Only the owner or an admin may read a wallet.
export const getWalletByUserId = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin' && String(req.params.userId) !== String(req.user._id)) throw forbidden('Not your wallet');
  const wallet = await Wallet.findOne({ userId: req.params.userId });
  if (!wallet) throw notFound('Wallet not found');
  return ok(res, wallet);
});

// POST /api/wallets/withdraw  (technician / service_center)
// Debits immediately and queues a payout for admin to settle; a rejected payout is refunded.
export const requestWithdrawal = asyncHandler(async (req, res) => {
  const { amount, bankName, accountNumber, accountName } = req.body;
  if (amount < config.minWithdrawal) throw badRequest(`Minimum withdrawal is ₦${config.minWithdrawal}`);

  const wallet = await getOrCreateWallet(req.user._id);
  if (amount > withdrawable(wallet)) throw badRequest('Amount exceeds your withdrawable balance');

  await debitWallet(req.user._id, amount);
  const txn = await Transaction.create({
    userId: req.user._id, walletId: wallet._id, type: 'withdrawal', gateway: 'internal', amount,
    status: 'pending', reference: newReference('wd'), payoutDetails: { bankName, accountNumber, accountName },
  });
  return created(res, txn, 'Withdrawal requested');
});
