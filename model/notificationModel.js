import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        type: {
            type: String,
            enum: [
                'repair_request',
                'quotation',
                'appointment',
                'status_update',
                'payment',
                'warranty',
                'review',
                'dispute',
                'verification',
            ],
            required: true,
        },
        message: { type: String, required: true },
        refId: { type: mongoose.Schema.Types.ObjectId }, // optional deep-link target (job, request, ...)
        isRead: { type: Boolean, default: false },
    },
    { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
