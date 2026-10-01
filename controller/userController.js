import bcrypt from 'bcryptjs';
import User from '../model/userModel.js';
import CustomerProfile from '../model/customerProfileModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { generateToken } from '../utils/generateToken.js';
import { ApiError, conflict, forbidden, notFound, unauthorized } from '../utils/ApiError.js';
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
  const user = await User.create({ fullName, email, phone, passwordHash, role });

  // Auto-create the role-specific profile shell.
  if (role === 'customer') await CustomerProfile.create({ userId: user._id });
  if (role === 'technician') await TechnicianProfile.create({ userId: user._id });
  if (role === 'service_center') await ServiceCenterProfile.create({ userId: user._id, businessName: businessName || fullName });

  return created(res, { user, token: generateToken({ id: user._id, role: user.role }) }, 'Registration successful');
});

// POST /api/users/login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  // Same error for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Invalid credentials');
  if (user.status !== 'active') throw forbidden('Account suspended. Contact support.');

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
