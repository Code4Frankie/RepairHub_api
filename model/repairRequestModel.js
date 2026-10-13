import mongoose from 'mongoose';

const repairRequestSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile', required: true },
    serviceCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', required: true },
    itemType: { type: String, required: true, trim: true },
    brandModel: { type: String, trim: true },
    problemDescription: { type: String, required: true, trim: true },
    urgency: { type: String, enum: ['low', 'normal', 'urgent'], default: 'normal' },
    // Structured scheduling preferences (preferredDate/preferredTime are display strings
    // e.g. "Mon 20 Oct" / "2:00 pm" — the same values the customer sees).
    preferredDate: { type: String, trim: true },
    preferredTime: { type: String, trim: true },
    serviceMode: { type: String, enum: ['home', 'shop'], default: null },
    mediaUrls: [{ type: String }], // Cloudinary photo/video URLs
    address: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    acceptedQuotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    status: {
      type: String,
      enum: ['open', 'quoted', 'booked', 'in_progress', 'completed', 'cancelled'],
      default: 'open',
    },
  },
  { timestamps: true }
);

repairRequestSchema.index({ location: '2dsphere' });
repairRequestSchema.index({ status: 1, serviceCategoryId: 1, createdAt: -1 });
repairRequestSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('RepairRequest', repairRequestSchema);
