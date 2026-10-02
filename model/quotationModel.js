import mongoose from 'mongoose';

const quotationSchema = new mongoose.Schema(
    {
        repairRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairRequest', required: true },
        // The technician who will do the work (a service center picks one from its team).
        technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicianProfile', required: true },
        serviceCenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCenterProfile', default: null },
        laborCost: { type: Number, min: 0, default: 0 },
        partsCost: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 1 }, // total, always = labor + parts when both given
        estimatedDays: { type: Number, min: 0, max: 365 },
        warrantyDays: { type: Number, min: 0, max: 730, default: 30 },
        notes: { type: String, trim: true, maxlength: 1000 },
        expiresAt: { type: Date },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected', 'expired', 'withdrawn'],
            default: 'pending',
        },
    },
    { timestamps: true }
);

// One live quote per technician per request.
quotationSchema.index({ repairRequestId: 1, technicianId: 1 }, { unique: true });

export default mongoose.model('Quotation', quotationSchema);
