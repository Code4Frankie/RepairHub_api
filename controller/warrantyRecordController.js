import WarrantyRecord from '../model/warrantyRecordModel.js';
import RepairJob from '../model/repairJobModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/ApiError.js';
import { assertJobParticipant, isCustomerOf, isProviderOf } from '../services/access.js';
import { notifyUser } from '../services/notificationService.js';

const loadWithJob = async (warranty, user) => {
  const job = await RepairJob.findById(warranty.repairJobId);
  assertJobParticipant(job, user);
  return job;
};

export const getWarrantyByJob = asyncHandler(async (req, res) => {
  const job = await RepairJob.findById(req.params.jobId);
  if (!job) throw notFound('Repair job not found');
  assertJobParticipant(job, req.user);
  const warranty = await WarrantyRecord.findOne({ repairJobId: job._id });
  if (!warranty) throw notFound('Warranty record not found');
  return ok(res, warranty);
});

export const getWarrantyById = asyncHandler(async (req, res) => {
  const warranty = await WarrantyRecord.findById(req.params.id);
  if (!warranty) throw notFound('Warranty record not found');
  await loadWithJob(warranty, req.user);
  return ok(res, warranty);
});

// POST /api/warranty-records/:id/claims  (customer, within the coverage window)
export const fileWarrantyClaim = asyncHandler(async (req, res) => {
  const warranty = await WarrantyRecord.findById(req.params.id);
  if (!warranty) throw notFound('Warranty record not found');
  const job = await loadWithJob(warranty, req.user);
  if (!isCustomerOf(job, req.user)) throw forbidden('Only the customer can file a warranty claim');
  if (new Date() > warranty.expiresAt) throw badRequest('Warranty has expired, claim cannot be filed');
  if (warranty.claims.some((c) => c.status === 'open')) throw conflict('You already have an open claim on this warranty');

  warranty.claims.push({ description: req.body.description });
  await warranty.save();
  await notifyUser(job.payeeUserId, 'warranty', 'A warranty claim was filed on one of your jobs', warranty._id);
  return created(res, warranty, 'Warranty claim filed');
});

// PATCH /api/warranty-records/:id/claims/:claimId  (provider or admin)
export const resolveWarrantyClaim = asyncHandler(async (req, res) => {
  const warranty = await WarrantyRecord.findById(req.params.id);
  if (!warranty) throw notFound('Warranty record not found');
  const job = await loadWithJob(warranty, req.user);
  if (req.user.role !== 'admin' && !isProviderOf(job, req.user) && String(job.technicianUserId) !== String(req.user._id)) throw forbidden('Only the provider can resolve claims');

  const claim = warranty.claims.id(req.params.claimId);
  if (!claim) throw notFound('Claim not found');
  if (claim.status !== 'open') throw conflict('Claim already resolved');
  claim.status = req.body.status;
  claim.resolutionNote = req.body.resolutionNote;
  claim.resolvedAt = new Date();
  await warranty.save();
  await notifyUser(job.customerUserId, 'warranty', `Your warranty claim was ${claim.status}`, warranty._id);
  return ok(res, warranty, 'Claim updated');
});
