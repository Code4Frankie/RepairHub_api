import Joi from 'joi';
import mongoose from 'mongoose';

const objectId = Joi.string().custom((v, helpers) =>
  mongoose.isValidObjectId(v) && String(v).length === 24 ? v : helpers.error('any.invalid')
, 'ObjectId');

// Nigerian mobile: 0803..., 0703..., +234803... (also tolerates spaces/dashes)
const phone = Joi.string()
  .pattern(/^(\+234|234|0)[789][01]\d{8}$/)
  .message('phone must be a valid Nigerian mobile number');

// GeoJSON point from {lng, lat}
const point = Joi.object({ lng: Joi.number().min(-180).max(180).required(), lat: Joi.number().min(-90).max(90).required() });
const page = { page: Joi.number().integer().min(1), limit: Joi.number().integer().min(1).max(100) };

// ---- auth / users
export const register = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().required(),
  phone,
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid('customer', 'technician', 'service_center').required(),
  businessName: Joi.string().trim().max(150), // service_center only
});
export const login = Joi.object({ email: Joi.string().trim().lowercase().email().required(), password: Joi.string().required() });
export const updateUser = Joi.object({ fullName: Joi.string().trim().min(2).max(100), phone }).min(1);
export const changePassword = Joi.object({ currentPassword: Joi.string().required(), newPassword: Joi.string().min(8).max(128).required() });
export const userList = Joi.object({ role: Joi.string().valid('customer', 'technician', 'service_center', 'admin'), status: Joi.string().valid('active', 'suspended'), q: Joi.string().trim().max(100), ...page });
export const userStatus = Joi.object({ status: Joi.string().valid('active', 'suspended').required() });

// ---- profiles
export const customerProfileUpdate = Joi.object({
  address: Joi.string().trim().max(300),
  location: point,
  savedDevices: Joi.array().items(Joi.string().trim().max(100)).max(20),
}).min(1);

export const technicianProfileUpdate = Joi.object({
  bio: Joi.string().trim().max(1000),
  experienceYears: Joi.number().min(0).max(60),
  serviceCategoryIds: Joi.array().items(objectId).max(30),
  services: Joi.array().items(Joi.object({ categoryId: objectId.required(), hourlyRate: Joi.number().min(0) })).max(30),
  serviceAreas: Joi.array().items(Joi.string().trim().max(80)).max(30),
  baseLocation: point,
  isAvailable: Joi.boolean(),
  availabilityCalendar: Joi.object().unknown(true),
}).min(1);

export const technicianSearch = Joi.object({
  serviceCategoryId: objectId,
  area: Joi.string().trim().max(80),
  lng: Joi.number().min(-180).max(180),
  lat: Joi.number().min(-90).max(90),
  radiusKm: Joi.number().min(1).max(200),
  sort: Joi.string().valid('rating', 'jobs', 'newest'),
  ...page,
}).and('lng', 'lat');

export const verifyDecision = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  feedback: Joi.string().trim().max(500).when('decision', { is: 'reject', then: Joi.optional() }),
});

export const centerUpdate = Joi.object({
  businessName: Joi.string().trim().max(150),
  description: Joi.string().trim().max(1000),
  address: Joi.string().trim().max(300),
  location: point,
  coverageRadiusKm: Joi.number().min(1).max(200),
  workingHours: Joi.object().unknown(true),
  serviceCategoryIds: Joi.array().items(objectId).max(30),
}).min(1);
export const centerSearch = Joi.object({ serviceCategoryId: objectId, lng: Joi.number().min(-180).max(180), lat: Joi.number().min(-90).max(90), radiusKm: Joi.number().min(1).max(200), ...page }).and('lng', 'lat');
export const addTeamMember = Joi.object({ email: Joi.string().trim().lowercase().email().required() });

// ---- categories
export const categoryCreate = Joi.object({ name: Joi.string().trim().min(2).max(80).required(), parentCategory: Joi.string().trim().max(80).allow(null) });
export const categoryUpdate = Joi.object({ name: Joi.string().trim().min(2).max(80), parentCategory: Joi.string().trim().max(80).allow(null), isActive: Joi.boolean() }).min(1);

// ---- requests / quotes / bookings
export const repairRequestCreate = Joi.object({
  serviceCategoryId: objectId.required(),
  itemType: Joi.string().trim().max(100).required(),
  brandModel: Joi.string().trim().max(100),
  problemDescription: Joi.string().trim().min(10).max(2000).required(),
  urgency: Joi.string().valid('low', 'normal', 'urgent'),
  address: Joi.string().trim().max(300),
  // multipart sends location as a JSON string; accept either form
  location: Joi.alternatives().try(point, Joi.string().custom((v, h) => {
    try { const o = JSON.parse(v); const { error } = point.validate(o); return error ? h.error('any.invalid') : o; } catch { return h.error('any.invalid'); }
  })),
});
export const repairRequestList = Joi.object({
  status: Joi.string().valid('open', 'quoted', 'booked', 'in_progress', 'completed', 'cancelled'),
  serviceCategoryId: objectId,
  lng: Joi.number().min(-180).max(180), lat: Joi.number().min(-90).max(90), radiusKm: Joi.number().min(1).max(200),
  ...page,
}).and('lng', 'lat');

export const quotationCreate = Joi.object({
  repairRequestId: objectId.required(),
  technicianId: objectId, // service centers must say which team member will do the work
  laborCost: Joi.number().min(0).max(100000000),
  partsCost: Joi.number().min(0).max(100000000),
  price: Joi.number().min(1).max(100000000),
  estimatedDays: Joi.number().integer().min(0).max(365),
  warrantyDays: Joi.number().integer().min(0).max(730),
  notes: Joi.string().trim().max(1000),
  validDays: Joi.number().integer().min(1).max(30),
}).or('price', 'laborCost');
export const quotationCompare = Joi.object({ sort: Joi.string().valid('price', 'rating', 'eta', 'value') });

export const appointmentCreate = Joi.object({
  quotationId: objectId.required(),
  scheduledAt: Joi.date().iso().greater('now').required(),
  serviceMode: Joi.string().valid('onsite', 'dropoff', 'pickup'),
  address: Joi.string().trim().max(300),
  notes: Joi.string().trim().max(500),
});
export const appointmentReschedule = Joi.object({ scheduledAt: Joi.date().iso().greater('now').required() });
export const cancelBody = Joi.object({ reason: Joi.string().trim().max(500) });

// ---- jobs / payments
export const jobStatus = Joi.object({
  status: Joi.string().valid('diagnosing', 'awaiting_parts', 'in_progress', 'quality_check', 'ready', 'on_hold', 'completed').required(),
  note: Joi.string().trim().max(500),
});
export const jobList = Joi.object({ status: Joi.string().valid('accepted', 'diagnosing', 'awaiting_parts', 'in_progress', 'quality_check', 'ready', 'on_hold', 'completed', 'disputed', 'cancelled'), ...page });
export const payJob = Joi.object({ repairJobId: objectId.required(), method: Joi.string().valid('paystack', 'wallet', 'cash').required() });
export const topup = Joi.object({ amount: Joi.number().integer().min(100).max(5000000).required() });
export const withdraw = Joi.object({
  amount: Joi.number().integer().min(1).required(),
  bankName: Joi.string().trim().max(80).required(),
  accountNumber: Joi.string().pattern(/^\d{10}$/).message('accountNumber must be 10 digits').required(),
  accountName: Joi.string().trim().max(120).required(),
});
export const txnList = Joi.object({ type: Joi.string().valid('escrow_payment', 'payout', 'commission', 'refund', 'topup', 'withdrawal'), ...page });

// ---- reviews / warranty / disputes / admin
export const reviewCreate = Joi.object({
  repairJobId: objectId.required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(8),
  comment: Joi.string().trim().max(1000),
});
export const warrantyClaim = Joi.object({ description: Joi.string().trim().min(5).max(1000).required() });
export const claimResolve = Joi.object({ status: Joi.string().valid('resolved', 'rejected').required(), resolutionNote: Joi.string().trim().max(500) });
export const disputeCreate = Joi.object({ repairJobId: objectId.required(), reason: Joi.string().trim().min(10).max(2000).required() });
export const disputeResolve = Joi.object({
  decision: Joi.string().valid('release', 'refund', 'partial').required(),
  refundAmount: Joi.number().min(1).when('decision', { is: 'partial', then: Joi.required(), otherwise: Joi.forbidden() }),
  note: Joi.string().trim().max(1000),
});
export const withdrawalProcess = Joi.object({ decision: Joi.string().valid('paid', 'rejected').required(), note: Joi.string().trim().max(500) });
export const adminList = Joi.object({ status: Joi.string().trim().max(20), ...page });
export const notificationList = Joi.object({ unread: Joi.boolean(), ...page });
