import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    repairJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile', required: true },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicianProfile', required: true },
    serviceCenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCenterProfile', default: null },
    rating: { type: Number, min: 1, max: 5, required: true },
    tags: [{ type: String, trim: true }], // e.g. "On time", "Professional"
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

reviewSchema.index({ technicianId: 1, createdAt: -1 });

export default mongoose.model('Review', reviewSchema);
