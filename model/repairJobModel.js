import mongoose from 'mongoose';

export const JOB_STATUSES = [
    'accepted',
    'diagnosing',
    'awaiting_parts',
    'in_progress',
    'quality_check',
    'ready',
    'on_hold',
    'completed',
    'disputed',
    'cancelled',
];

const repairJobSchema = new mongoose.Schema(
    {
        appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
        quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', required: true },
        repairRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairRequest', required: true },
        customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile', required: true },
        technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicianProfile', required: true },
        serviceCenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCenterProfile', default: null },
        // Whose wallet is credited when escrow releases (the technician, or the center that owns the job).
        payeeUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        customerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        technicianUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // the person doing the work
        price: { type: Number, required: true }, // agreed price, copied from the accepted quotation
        warrantyDays: { type: Number, default: 30 },

        status: { type: String, enum: JOB_STATUSES, default: 'accepted' },
        progress: { type: Number, default: 0, min: 0, max: 100 },
        statusBeforeDispute: { type: String },
        statusHistory: [
            {
                _id: false,
                status: String,
                changedAt: { type: Date, default: Date.now },
                note: String,
                by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            },
        ],

        payment: {
            method: { type: String, enum: ['paystack', 'wallet', 'cash'], default: null },
            // unpaid -> held -> released | refunded ; cash jobs: cash -> cash_settled
            status: {
                type: String,
                enum: ['unpaid', 'held', 'released', 'refunded', 'cash', 'cash_settled'],
                default: 'unpaid',
            },
            reference: { type: String },
            heldAt: Date,
            settledAt: Date,
        },
        finalPrice: { type: Number },
        platformCommission: { type: Number, default: 0 },

        startedAt: Date,
        completedAt: Date,
        customerConfirmedAt: Date,
    },
    { timestamps: true }
);

repairJobSchema.index({ customerUserId: 1, createdAt: -1 });
repairJobSchema.index({ payeeUserId: 1, createdAt: -1 });
repairJobSchema.index({ technicianId: 1, status: 1 });
repairJobSchema.index({ status: 1, 'payment.status': 1, completedAt: 1 });

export default mongoose.model('RepairJob', repairJobSchema);
