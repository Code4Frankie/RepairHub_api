import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, default: 0, min: 0 },
    // Commission owed on cash-paid jobs; automatically netted off the next payout.
    commissionOwed: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'NGN' },
  },
  { timestamps: true }
);

export default mongoose.model('Wallet', walletSchema);