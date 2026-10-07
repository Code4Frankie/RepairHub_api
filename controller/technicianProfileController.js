import TechnicianProfile from '../model/technicianProfileModel.js';
import User from '../model/userModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { uploadManyToCloudinary } from '../utils/cloudinaryUpload.js';
import { toPoint, withinRadius } from '../utils/geo.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
import { badRequest, forbidden, notFound } from '../utils/ApiError.js';
import { notifyUser } from '../services/notificationService.js';

const PUBLIC_HIDE = '-verificationDocs -verificationFeedback -availabilityCalendar -ratingSum';

const loadOwned = async (req) => {
  const profile = await TechnicianProfile.findById(req.params.id);
  if (!profile) throw notFound('Technician profile not found');
  if (String(profile.userId) !== String(req.user._id)) throw forbidden('Not your profile');
  return profile;
};

// GET /api/technician-profiles?serviceCategoryId=&area=&lng=&lat=&radiusKm=&sort=  (public; verified only)
export const listTechnicianProfiles = asyncHandler(async (req, res) => {
  const q = req.query;
  const suspended = await User.find({ role: 'technician', status: 'suspended' }).distinct('_id');
  const filter = { verificationStatus: 'verified', userId: { $nin: suspended } };
  if (q.serviceCategoryId) filter.serviceCategoryIds = q.serviceCategoryId;
  if (q.area) filter.serviceAreas = q.area;
  if (q.lng !== undefined) Object.assign(filter, withinRadius('baseLocation', q.lng, q.lat, q.radiusKm));

  const sorts = { rating: { ratingAvg: -1, ratingCount: -1 }, jobs: { jobsCompleted: -1 }, newest: { createdAt: -1 } };
  const pg = parsePagination(q);
  const [items, total] = await Promise.all([
    TechnicianProfile.find(filter).select(PUBLIC_HIDE).populate('userId', 'fullName').sort(sorts[q.sort] || sorts.rating).skip(pg.skip).limit(pg.limit),
    TechnicianProfile.countDocuments(filter),
  ]);
  return ok(res, items, 'Technicians', 200, pageMeta(pg, total));
});

// GET /api/technician-profiles/me  (owner sees everything incl. verification state)
export const getMyTechnicianProfile = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findOne({ userId: req.user._id });
  if (!profile) throw notFound('Technician profile not found');
  return ok(res, profile);
});

// GET /api/technician-profiles/:id  (public — verification docs are never exposed)
export const getTechnicianProfileById = asyncHandler(async (req, res) => {
  const profile = await TechnicianProfile.findById(req.params.id).select(PUBLIC_HIDE).populate('userId', 'fullName');
  if (!profile || profile.verificationStatus !== 'verified') throw notFound('Technician profile not found');
  return ok(res, profile);
});

export const updateTechnicianProfile = asyncHandler(async (req, res) => {
  const profile = await loadOwned(req);
  const { baseLocation, ...rest } = req.body;
  Object.assign(profile, rest);
  if (baseLocation) profile.baseLocation = toPoint(baseLocation.lng, baseLocation.lat);
  await profile.save();
  return ok(res, profile, 'Technician profile updated');
});

// POST /api/technician-profiles/:id/verification-docs  (multipart, field "docs")
// Uploading after a rejection puts the profile back in the admin queue.
export const uploadVerificationDocs = asyncHandler(async (req, res) => {
  const profile = await loadOwned(req);
  if (!req.files?.length) throw badRequest('Attach at least one document (field "docs")');

  const urls = await uploadManyToCloudinary(req.files, 'technician-verification');
  profile.verificationDocs.push(...urls);
  if (profile.verificationStatus === 'rejected') {
    profile.verificationStatus = 'pending';
    profile.verificationFeedback = null;
  }
  await profile.save();
  return ok(res, profile, 'Verification documents uploaded');
});

// GET /api/technician-profiles/pending  (admin)
export const listPendingVerifications = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const filter = { verificationStatus: 'pending' };
  const [items, total] = await Promise.all([
    TechnicianProfile.find(filter).populate('userId', 'fullName email phone').sort({ createdAt: 1 }).skip(pg.skip).limit(pg.limit),
    TechnicianProfile.countDocuments(filter),
  ]);
  return ok(res, items, 'Pending technicians', 200, pageMeta(pg, total));
});

// PATCH /api/technician-profiles/:id/verify  (admin)  body: { decision, feedback? }
export const verifyTechnician = asyncHandler(async (req, res) => {
  const { decision, feedback } = req.body;
  const profile = await TechnicianProfile.findById(req.params.id);
  if (!profile) throw notFound('Technician profile not found');

  if (decision === 'approve') {
    if (!profile.verificationDocs.length) throw badRequest('Cannot approve: no verification documents were submitted');
    profile.verificationStatus = 'verified';
    profile.verificationFeedback = null;
    profile.verifiedAt = new Date();
    await notifyUser(profile.userId, 'verification', 'Your technician profile has been verified!', profile._id);
  } else {
    profile.verificationStatus = 'rejected';
    profile.verificationFeedback = feedback || 'Documents did not meet verification standards.';
    await notifyUser(profile.userId, 'verification', `Verification rejected: ${profile.verificationFeedback}`, profile._id);
  }
  await profile.save();
  return ok(res, profile, `Technician ${decision === 'approve' ? 'approved' : 'rejected'}`);
});
