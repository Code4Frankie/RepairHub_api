import mongoose from 'mongoose';

const technicianProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Set when the technician belongs to a service center's team.
    serviceCenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCenterProfile', default: null },
    bio: { type: String, trim: true, maxlength: 1000 },
    experienceYears: { type: Number, min: 0, max: 60 },
    serviceCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory' }],
    // Optional per-category pricing shown on the profile (e.g. Laptops ₦8,000/hr).
    services: [
      {
        _id: false,
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', required: true },
        hourlyRate: { type: Number, min: 0 },
      },
    ],
    serviceAreas: [{ type: String, trim: true }],
    baseLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    isAvailable: { type: Boolean, default: true },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    verificationDocs: [{ type: String }], // Cloudinary URLs
    verificationFeedback: { type: String, default: null },
    verifiedAt: { type: Date },
    availabilityCalendar: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

technicianProfileSchema.index({ baseLocation: '2dsphere' });
technicianProfileSchema.index({ verificationStatus: 1, serviceCategoryIds: 1 });

export default mongoose.model('TechnicianProfile', technicianProfileSchema);
