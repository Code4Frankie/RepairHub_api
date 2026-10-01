import RepairRequest from '../model/repairRequestModel.js';
import ServiceCategory from '../model/serviceCategoryModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import Quotation from '../model/quotationModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { uploadManyToCloudinary } from '../utils/cloudinaryUpload.js';
import { toPoint, withinRadius } from '../utils/geo.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/ApiError.js';
import { requireCustomerProfile } from '../services/access.js';
import { notifyMany } from '../services/notificationService.js';

// Tell verified providers in this category (FR-7 matching). Best-effort, capped.
const notifyMatchingProviders = async (request) => {
  const [techs, centers] = await Promise.all([
    TechnicianProfile.find({ verificationStatus: 'verified', isAvailable: true, serviceCategoryIds: request.serviceCategoryId }).select('userId').limit(50),
    ServiceCenterProfile.find({ verificationStatus: 'verified', serviceCategoryIds: request.serviceCategoryId }).select('userId').limit(20),
  ]);
  const ids = [...techs, ...centers].map((p) => p.userId);
  await notifyMany(ids, 'repair_request', `New ${request.itemType} repair request in your category`, request._id);
};

// POST /api/repair-requests  (customer, multipart; media field "media")
export const createRepairRequest = asyncHandler(async (req, res) => {
  const customer = await requireCustomerProfile(req.user);
  const category = await ServiceCategory.findOne({ _id: req.body.serviceCategoryId, isActive: true });
  if (!category) throw badRequest('Unknown or inactive service category');

  const mediaUrls = req.files?.length ? await uploadManyToCloudinary(req.files, 'repair-requests') : [];
  const loc = req.body.location;

  const request = await RepairRequest.create({
    customerId: customer._id,
    serviceCategoryId: category._id,
    itemType: req.body.itemType,
    brandModel: req.body.brandModel,
    problemDescription: req.body.problemDescription,
    urgency: req.body.urgency,
    address: req.body.address || customer.address,
    mediaUrls,
    location: loc ? toPoint(loc.lng, loc.lat) : customer.location,
  });

  notifyMatchingProviders(request).catch(() => {});
  return created(res, request, 'Repair request created');
});

// GET /api/repair-requests
//  customer -> their own; technician/service_center -> open work in their categories; admin -> all
export const listRepairRequests = asyncHandler(async (req, res) => {
  const q = req.query;
  const filter = {};

  if (req.user.role === 'customer') {
    filter.customerId = (await requireCustomerProfile(req.user))._id;
  } else if (req.user.role === 'technician' || req.user.role === 'service_center') {
    const profile = req.user.role === 'technician'
      ? await TechnicianProfile.findOne({ userId: req.user._id })
      : await ServiceCenterProfile.findOne({ userId: req.user._id });
    if (!profile || profile.verificationStatus !== 'verified') return ok(res, [], 'Verify your account to see job requests', 200, pageMeta({ page: 1, limit: 20 }, 0));
    filter.status = { $in: ['open', 'quoted'] };
    if (profile.serviceCategoryIds?.length) filter.serviceCategoryId = { $in: profile.serviceCategoryIds };
  }

  if (q.status && req.user.role !== 'technician' && req.user.role !== 'service_center') filter.status = q.status;
  if (q.serviceCategoryId) filter.serviceCategoryId = q.serviceCategoryId;
  if (q.lng !== undefined) Object.assign(filter, withinRadius('location', q.lng, q.lat, q.radiusKm));

  const pg = parsePagination(q);
  const [items, total] = await Promise.all([
    RepairRequest.find(filter).populate('serviceCategoryId', 'name').sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    RepairRequest.countDocuments(filter),
  ]);
  return ok(res, items, 'Repair requests', 200, pageMeta(pg, total));
});

// GET /api/repair-requests/:id
export const getRepairRequestById = asyncHandler(async (req, res) => {
  const request = await RepairRequest.findById(req.params.id).populate('serviceCategoryId', 'name');
  if (!request) throw notFound('Repair request not found');

  const { role, _id } = req.user;
  if (role === 'customer') {
    const me = await requireCustomerProfile(req.user);
    if (String(request.customerId) !== String(me._id)) throw forbidden('Not your repair request');
  } else if (role !== 'admin') {
    // Providers can see open work, or any request they have quoted on.
    const open = ['open', 'quoted'].includes(request.status);
    const tech = role === 'technician' ? await TechnicianProfile.findOne({ userId: _id }) : null;
    const center = role === 'service_center' ? await ServiceCenterProfile.findOne({ userId: _id }) : null;
    const quoted = tech ? await Quotation.exists({ repairRequestId: request._id, technicianId: tech._id })
      : center ? await Quotation.exists({ repairRequestId: request._id, serviceCenterId: center._id }) : null;
    if (!open && !quoted) throw forbidden('You cannot view this request');
  }
  return ok(res, request);
});

// PATCH /api/repair-requests/:id/cancel  (owner; only before a quotation is accepted)
export const cancelRepairRequest = asyncHandler(async (req, res) => {
  const me = await requireCustomerProfile(req.user);
  const request = await RepairRequest.findOneAndUpdate(
    { _id: req.params.id, customerId: me._id, status: { $in: ['open', 'quoted'] } },
    { status: 'cancelled' },
    { new: true }
  );
  if (!request) {
    const exists = await RepairRequest.findOne({ _id: req.params.id, customerId: me._id });
    if (!exists) throw notFound('Repair request not found');
    throw conflict(`A ${exists.status} request cannot be cancelled here`);
  }
  await Quotation.updateMany({ repairRequestId: request._id, status: 'pending' }, { status: 'rejected' });
  return ok(res, request, 'Repair request cancelled');
});
