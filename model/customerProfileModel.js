import mongoose from 'mongoose';

const customerProfileSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        address: { type: String, trim: true },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
        },
        savedDevices: [{ type: String, trim: true }],
    },
    { timestamps: true }
);

customerProfileSchema.index({ location: '2dsphere' });

export default mongoose.model('CustomerProfile', customerProfileSchema);
