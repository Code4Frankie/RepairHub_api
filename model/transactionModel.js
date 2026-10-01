import mongoose from 'mongoose';

// Ledger of every money movement. Amounts are NGN (whole naira, not kobo).
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' },
    repairJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob' },
    type: {
      type: String,
      enum: ['escrow_payment', 'payout', 'commission', 'refund', 'topup', 'withdrawal'],
      required: true,
    },
    gateway: { type: String, enum: ['paystack', 'wallet', 'cash', 'internal'], default: 'internal' },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'success', 'failed', 'rejected'], default: 'pending' },
    reference: { type: String },
    note: { type: String },
    payoutDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

transactionSchema.index({ reference: 1 }, { unique: true, sparse: true });
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });

export default mongoose.model('Transaction', transactionSchema);