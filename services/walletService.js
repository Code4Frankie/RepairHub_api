import Wallet from '../model/walletModel.js';
import Transaction from '../model/transactionModel.js';
import { badRequest } from '../utils/ApiError.js';

export const getOrCreateWallet = (userId) =>
  Wallet.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true });

export const creditWallet = async (userId, amount) => {
  await getOrCreateWallet(userId);
  return Wallet.findOneAndUpdate({ userId }, { $inc: { balance: amount } }, { new: true });
};

// Atomic: the balance check and the decrement are one operation, so two concurrent
// requests can never overdraw a wallet.
export const debitWallet = async (userId, amount) => {
  const wallet = await Wallet.findOneAndUpdate(
    { userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!wallet) throw badRequest('Insufficient wallet balance');
  return wallet;
};

export const record = (data) => Transaction.create(data);
