import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import User from '../model/userModel.js';
import CustomerProfile from '../model/customerProfileModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { generateToken } from '../utils/generateToken.js';
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/ApiError.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';

const ROUNDS = () => Number(process.env.BCRYPT_ROUNDS) || 12;
const sameUser = (req) => String(req.params.id) === String(req.user._id);
const assertSelfOrAdmin = (req) => {
  if (req.user.role !== 'admin' && !sameUser(req)) throw forbidden('You can only access your own account');
};

// POST /api/users/register   (admin accounts can NOT be self-registered — see scripts/seedAdmin.js)
export const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, role, businessName } = req.body;

  if (await User.exists({ email })) throw conflict('Email already registered');

  const passwordHash = await bcrypt.hash(password, ROUNDS());
  // New accounts start unverified: the person confirms an email address or phone number, then logs in.
  const user = await User.create({ fullName, email, phone, passwordHash, role, isVerified: false });

  // Auto-create the role-specific profile shell.
  if (role === 'customer') await CustomerProfile.create({ userId: user._id });
  if (role === 'technician') await TechnicianProfile.create({ userId: user._id });
  if (role === 'service_center') await ServiceCenterProfile.create({ userId: user._id, businessName: businessName || fullName });

  return created(res, { user }, 'Account created. Verify your email or phone, then log in.');
});

// POST /api/users/login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  // Same error for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Invalid credentials');
  if (user.status !== 'active') throw forbidden('Account suspended. Contact support.');
  // Verification is the gate: an unconfirmed account can not sign in. The app sends them to the
  // code screen (errors.verificationRequired) to confirm an email address or phone number first.
  if (!user.isVerified) throw new ApiError(403, 'Confirm your email or phone to continue.', { verificationRequired: true });

  user.lastLoginAt = new Date();
  await user.save();
  return ok(res, { user, token: generateToken({ id: user._id, role: user.role }) }, 'Login successful');
});

export const getMe = asyncHandler(async (req, res) => ok(res, req.user, 'Current user'));

export const getUserById = asyncHandler(async (req, res) => {
  assertSelfOrAdmin(req);
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  return ok(res, user);
});

export const updateUser = asyncHandler(async (req, res) => {
  assertSelfOrAdmin(req);
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!user) throw notFound('User not found');
  return ok(res, user, 'User updated');
});

// DELETE /api/users/:id  — soft delete (suspend). Self-service account closure, or admin.
export const deleteUser = asyncHandler(async (req, res) => {
  assertSelfOrAdmin(req);
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' }, { new: true });
  if (!user) throw notFound('User not found');
  return ok(res, user, 'Account deactivated');
});

// POST /api/users/change-password
export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(req.body.newPassword, ROUNDS());
  await user.save();
  return ok(res, null, 'Password changed');
});

// POST /api/users/forgot-password  — self-service password reset (FR: gap that /forgot-password
// screen fills). Issues a one-time token that expires in 1 hour. The mobile app is the delivery
// channel for now (no SMTP service yet), so the token is returned for the app to present.
// When an email service is added, send the reset link instead.
export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  // Same response whether or not the email exists — do not leak which accounts are registered.
  if (!user || user.status !== 'active') return ok(res, { sent: true }, 'If that email exists, a reset token was issued');

  const token = crypto.randomBytes(32).toString('hex');
  user.passwordResetHash = crypto.createHash('sha256').update(token).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  return ok(res, { sent: true, resetToken: token, expiresInMinutes: 60 }, 'Password reset token issued');
});

// POST /api/users/reset-password  { token, newPassword } — redeems the token.
export const resetPassword = asyncHandler(async (req, res) => {
  const hash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const user = await User.findOne({ passwordResetHash: hash }).select('+passwordResetHash');
  if (!user) throw unauthorized('Invalid or expired reset token');
  if (user.status !== 'active') throw forbidden('Account suspended. Contact support.');
  if (!user.passwordResetExpires || user.passwordResetExpires.getTime() < Date.now()) {
    await User.updateOne({ _id: user._id }, { $unset: { passwordResetHash: 1, passwordResetExpires: 1 } });
    throw unauthorized('This reset token has expired. Request a new one.');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, ROUNDS());
  user.passwordResetHash = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  return ok(res, null, 'Password reset. Log in with your new password.');
});

/* ───────── account verification (email or phone) ───────── */

const VERIFICATION_TTL_MIN = 10;
const hashCode = (v) => crypto.createHash('sha256').update(v).digest('hex');
/** Six digits, leading zeros kept ("004821"). */
const newVerificationCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const clearVerification = (user) => { user.verificationCodeHash = undefined; user.verificationExpires = undefined; user.verificationChannel = undefined; };

// POST /api/users/verify/send  { email, channel } — issues a 6-digit code for an email address OR a phone
// number (the person chooses which). No email/SMS provider is configured yet, so the code is returned here
// and the app presents it — the same delivery approach as the password-reset token above.
export const sendVerificationCode = asyncHandler(async (req, res) => {
  const { email, channel } = req.body;
  const user = await User.findOne({ email });
  // Neutral response for unknown emails — do not reveal which accounts are registered.
  if (!user) return ok(res, { sent: true }, 'If that account exists, a code was issued');
  if (user.isVerified) return ok(res, { sent: true, verified: true, channel }, 'Account already verified');
  const destination = channel === 'phone' ? user.phone : user.email;
  if (!destination) throw badRequest(`Add a ${channel === 'phone' ? 'phone number' : 'email address'} to your account first`);

  const code = newVerificationCode();
  user.verificationCodeHash = hashCode(code);
  user.verificationExpires = new Date(Date.now() + VERIFICATION_TTL_MIN * 60 * 1000);
  user.verificationChannel = channel;
  await user.save();
  return ok(res, { sent: true, channel, destination, code, expiresInMinutes: VERIFICATION_TTL_MIN }, `Code sent to your ${channel === 'phone' ? 'phone' : 'email'}`);
});

// POST /api/users/verify/confirm  { email, code } — redeems the code and activates the account.
export const confirmVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email }).select('+verificationCodeHash');
  if (!user) throw unauthorized('That code is incorrect or has expired');
  if (user.isVerified) return ok(res, { user, verified: true }, 'Account already verified');
  if (!user.verificationCodeHash || user.verificationCodeHash !== hashCode(req.body.code)) throw unauthorized('That code is incorrect. Check it and try again.');
  if (!user.verificationExpires || user.verificationExpires.getTime() < Date.now()) {
    clearVerification(user);
    await user.save();
    throw unauthorized('That code has expired. Request a new one.');
  }
  user.isVerified = true;
  clearVerification(user);
  await user.save();
  return ok(res, { user, verified: true }, 'Account verified. Log in to continue.');
});

// GET /api/users  (admin)  ?role=&status=&q=&page=&limit=
export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }];
  }
  const pg = parsePagination(req.query);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    User.countDocuments(filter),
  ]);
  return ok(res, items, 'Users', 200, pageMeta(pg, total));
});

// PATCH /api/users/:id/status  (admin) — block / suspend / reactivate
export const setUserStatus = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw notFound('User not found');
  if (target.role === 'admin') throw new ApiError(403, 'Admin accounts cannot be suspended here');
  target.status = req.body.status;
  await target.save();
  return ok(res, target, `User ${target.status}`);
});
