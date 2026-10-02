import mongoose from 'mongoose';

// A repair shop / business account. Technicians can join its team (TechnicianProfile.serviceCenterId);
// jobs won by the center are paid into the center's wallet.
const serviceCenterSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, trim: true, required: true },
    description: { type: String, trim: true, maxlength: 1000 },
    address: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    coverageRadiusKm: { type: Number, default: 15, min: 1, max: 200 },
    workingHours: { type: mongoose.Schema.Types.Mixed, default: {} },
    serviceCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory' }],
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verificationDocs: [{ type: String }],
    verificationFeedback: { type: String, default: null },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

serviceCenterSchema.index({ location: '2dsphere' });

export default mongoose.model('ServiceCenterProfile', serviceCenterSchema);
