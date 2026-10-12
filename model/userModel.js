import mongoose from 'mongoose';

export const ROLES = ['customer', 'technician', 'service_center', 'admin'];
// Roles a person may self-register as. 'admin' accounts are created only via scripts/seedAdmin.js.
export const SELF_REGISTER_ROLES = ['customer', 'technician', 'service_center'];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastLoginAt: { type: Date },
    // Password reset (self-service). Only the SHA-256 hash of the token is stored; expires in 1h.
    passwordResetHash: { type: String, select: false },
    passwordResetExpires: { type: Date },
    // Account verification. A new sign-up confirms an email address OR a phone number with a 6-digit
    // code before they can log in. Only the SHA-256 hash of the code is stored; expires in 10 minutes.
    // Default true so accounts created before verification existed are not locked out.
    isVerified: { type: Boolean, default: true },
    verificationCodeHash: { type: String, select: false },
    verificationExpires: { type: Date },
    verificationChannel: { type: String, enum: ['email', 'phone'] },
  },
  { timestamps: true }
);

// Never leak the password hash in any JSON response.
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
