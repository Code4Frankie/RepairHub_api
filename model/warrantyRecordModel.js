import mongoose from 'mongoose';

const warrantyRecordSchema = new mongoose.Schema(
  {
    repairJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile', required: true },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicianProfile', required: true },
    durationDays: { type: Number, required: true },
    terms: { type: String, default: 'Covers workmanship and replaced parts for the same fault. Excludes physical or liquid damage after collection.' },
    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    certificateUrl: { type: String },
    claims: [
      {
        description: { type: String, required: true },
        mediaUrls: [String],
        status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open' },
        resolutionNote: String,
        createdAt: { type: Date, default: Date.now },
        resolvedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model('WarrantyRecord', warrantyRecordSchema);
