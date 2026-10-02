import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    repairRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairRequest', required: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile', required: true },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicianProfile', required: true },
    serviceMode: { type: String, enum: ['onsite', 'dropoff', 'pickup'], default: 'onsite' },
    address: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 500 },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'rescheduled', 'cancelled', 'completed'],
      default: 'scheduled',
    },
  },
  { timestamps: true }
);

export default mongoose.model('Appointment', appointmentSchema);
