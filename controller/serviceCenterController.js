import ServiceCenterProfile from '../model/serviceCenterModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import User from '../model/userModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { uploadManyToCloudinary } from '../utils/cloudinaryUpload.js';
import { toPoint, withinRadius } from '../utils/geo.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/ApiError.js';
import { notifyUser } from '../services/notificationService.js';
import { requireCenterProfile } from '../services/access.js';

const PUBLIC_HIDE = '-verificationDocs -verificationFeedback -ratingSum';

const loadOwned = async (req) => {
  const c = await ServiceCenterProfile.findById(req.params.id);
  if (!c) throw notFound('Service center not found');
  if (String(c.userId) !== String(req.user._id)) throw forbidden('Not your service center');
  return c;
};

// GET /api/service-centers  (public, verified only)
export const listServiceCenters = asyncHandler(async (req, res) => {
  const q = req.query;
  const suspended = await User.find({ role: 'service_center', status: 'suspended' }).distinct('_id');
  const filter = { verificationStatus: 'verified', userId: { $nin: suspended } };
  if (q.serviceCategoryId) filter.serviceCategoryIds = q.serviceCategoryId;
  if (q.lng !== undefined) Object.assign(filter, withinRadius('location', q.lng, q.lat, q.radiusKm));
  const pg = parsePagination(q);
  const [items, total] = await Promise.all([
    ServiceCenterProfile.find(filter).select(PUBLIC_HIDE).sort({ ratingAvg: -1 }).skip(pg.skip).limit(pg.limit),
    ServiceCenterProfile.countDocuments(filter),
  ]);
  return ok(res, items, 'Service centers', 200, pageMeta(pg, total));
});

export const getMyServiceCenter = asyncHandler(async (req, res) => ok(res, await requireCenterProfile(req.user)));

export const getServiceCenterById = asyncHandler(async (req, res) => {
  const c = await ServiceCenterProfile.findById(req.params.id).select(PUBLIC_HIDE);
  if (!c || c.verificationStatus !== 'verified') throw notFound('Service center not found');
  return ok(res, c);
});

export const updateServiceCenter = asyncHandler(async (req, res) => {
  const c = await loadOwned(req);
  const { location, ...rest } = req.body;
  Object.assign(c, rest);
  if (location) c.location = toPoint(location.lng, location.lat);
  await c.save();
  return ok(res, c, 'Service center updated');
});

export const uploadCenterDocs = asyncHandler(async (req, res) => {
  const c = await loadOwned(req);
  if (!req.files?.length) throw badRequest('Attach at least one document (field "docs")');
  c.verificationDocs.push(...(await uploadManyToCloudinary(req.files, 'center-verification')));
  if (c.verificationStatus === 'rejected') { c.verificationStatus = 'pending'; c.verificationFeedback = null; }
  await c.save();
  return ok(res, c, 'Documents uploaded');
});

// ---- team management (owner only)
export const listTeam = asyncHandler(async (req, res) => {
  const c = await loadOwned(req);
  const team = await TechnicianProfile.find({ serviceCenterId: c._id }).populate('userId', 'fullName email phone');
  return ok(res, team);
});

export const addTeamMember = asyncHandler(async (req, res) => {
  const c = await loadOwned(req);
  const user = await User.findOne({ email: req.body.email, role: 'technician' });
  if (!user) throw notFound('No technician account found for that email');
  const profile = await TechnicianProfile.findOne({ userId: user._id });
  if (profile.serviceCenterId) throw conflict('Technician already belongs to a service center');
  profile.serviceCenterId = c._id;
  await profile.save();
  await notifyUser(user._id, 'status_update', `You were added to the team at ${c.businessName}.`, c._id);
  return ok(res, profile, 'Technician added to team');
});

export const removeTeamMember = asyncHandler(async (req, res) => {
  const c = await loadOwned(req);
  const profile = await TechnicianProfile.findOneAndUpdate({ _id: req.params.technicianId, serviceCenterId: c._id }, { serviceCenterId: null }, { new: true });
  if (!profile) throw notFound('Team member not found');
  return ok(res, profile, 'Technician removed from team');
});

// ---- admin verification
export const listPendingCenters = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const filter = { verificationStatus: 'pending' };
  const [items, total] = await Promise.all([
    ServiceCenterProfile.find(filter).populate('userId', 'fullName email phone').sort({ createdAt: 1 }).skip(pg.skip).limit(pg.limit),
    ServiceCenterProfile.countDocuments(filter),
  ]);
  return ok(res, items, 'Pending service centers', 200, pageMeta(pg, total));
});

export const verifyServiceCenter = asyncHandler(async (req, res) => {
  const { decision, feedback } = req.body;
  const c = await ServiceCenterProfile.findById(req.params.id);
  if (!c) throw notFound('Service center not found');
  if (decision === 'approve') {
    if (!c.verificationDocs.length) throw badRequest('Cannot approve: no verification documents were submitted');
    c.verificationStatus = 'verified'; c.verificationFeedback = null; c.verifiedAt = new Date();
    await notifyUser(c.userId, 'verification', 'Your service center has been verified!', c._id);
  } else {
    c.verificationStatus = 'rejected';
    c.verificationFeedback = feedback || 'Documents did not meet verification standards.';
    await notifyUser(c.userId, 'verification', `Verification rejected: ${c.verificationFeedback}`, c._id);
  }
  await c.save();
  return ok(res, c, `Service center ${decision === 'approve' ? 'approved' : 'rejected'}`);
});
