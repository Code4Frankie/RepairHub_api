import mongoose from 'mongoose';

const disputeSchema = new mongoose.Schema(
  {
    repairJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    evidenceUrls: [{ type: String }],
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolution: {
      decision: { type: String, enum: ['release', 'refund', 'partial', 'none'] },
      refundAmount: { type: Number, min: 0 },
      note: String,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date,
    },
  },
  { timestamps: true }
);

// Only one open dispute per job.
disputeSchema.index(
  { repairJobId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

export default mongoose.model('Dispute', disputeSchema);