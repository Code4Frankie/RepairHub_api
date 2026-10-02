import RepairJob from '../model/repairJobModel.js';
import RepairRequest from '../model/repairRequestModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import User from '../model/userModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { conflict, forbidden, notFound } from '../utils/ApiError.js';
import { assertJobParticipant, isCustomerOf, isProviderOf } from '../services/access.js';
import { notifyUser } from '../services/notificationService.js';
import { issueWarranty } from '../services/warrantyService.js';
import { settleJob } from '../services/escrowService.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';

// Allowed moves. `completed` is reachable from any "work done" stage so simple repairs
// don't have to click through every step.
const TRANSITIONS = {
  accepted: ['diagnosing', 'in_progress', 'on_hold'],
  diagnosing: ['awaiting_parts', 'in_progress', 'on_hold'],
  awaiting_parts: ['in_progress', 'on_hold'],
  in_progress: ['quality_check', 'awaiting_parts', 'on_hold', 'ready', 'completed'],
  quality_check: ['in_progress', 'ready', 'completed'],
  ready: ['completed'],
  on_hold: ['diagnosing', 'in_progress'],
};
const PROGRESS = { accepted: 0, diagnosing: 10, awaiting_parts: 30, on_hold: undefined, in_progress: 50, quality_check: 80, ready: 90, completed: 100 };
const NEEDS_PAYMENT = ['in_progress', 'quality_check', 'ready', 'completed'];

// GET /api/repair-jobs?status=  (mine)
export const listMyJobs = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'customer') filter.customerUserId = req.user._id;
  else if (req.user.role !== 'admin') filter.$or = [{ payeeUserId: req.user._id }, { technicianUserId: req.user._id }];
  if (req.query.status) filter.status = req.query.status;
  const pg = parsePagination(req.query);
  const [items, total] = await Promise.all([
    RepairJob.find(filter).populate('repairRequestId', 'itemType problemDescription').sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    RepairJob.countDocuments(filter),
  ]);
  return ok(res, items, 'Repair jobs', 200, pageMeta(pg, total));
});

// GET /api/repair-jobs/:id — includes the counterpart's phone (call button) once booked.
export const getRepairJobById = asyncHandler(async (req, res) => {
  const job = await RepairJob.findById(req.params.id).populate('repairRequestId', 'itemType brandModel problemDescription mediaUrls address');
  if (!job) throw notFound('Repair job not found');
  assertJobParticipant(job, req.user);

  const counterpartId = isCustomerOf(job, req.user) ? job.technicianUserId : job.customerUserId;
  const counterpart = await User.findById(counterpartId).select('fullName phone');
  return ok(res, { ...job.toObject(), contact: counterpart ? { name: counterpart.fullName, phone: counterpart.phone } : null });
});

// PATCH /api/repair-jobs/:id/status  (the provider side: technician, their center)
export const updateJobStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const job = await RepairJob.findById(req.params.id);
  if (!job) throw notFound('Repair job not found');
  if (!isProviderOf(job, req.user) && String(job.technicianUserId) !== String(req.user._id)) {
    throw forbidden('Only the assigned technician or their service center can update this job');
  }

  if (!(TRANSITIONS[job.status] || []).includes(status)) {
    throw conflict(`Cannot move a job from "${job.status}" to "${status}"`);
  }
  if (NEEDS_PAYMENT.includes(status) && !['held', 'cash'].includes(job.payment.status)) {
    throw conflict('Work cannot begin until the customer has paid (escrow) or chosen pay-on-delivery');
  }

  job.status = status;
  if (PROGRESS[status] !== undefined) job.progress = PROGRESS[status];
  job.statusHistory.push({ status, note, by: req.user._id });
  if (status === 'in_progress' && !job.startedAt) {
    job.startedAt = new Date();
    await RepairRequest.findByIdAndUpdate(job.repairRequestId, { status: 'in_progress' });
  }

  if (status === 'completed') {
    job.completedAt = new Date();
    await job.save();
    await issueWarranty(job); // FR-19: certificate is issued the moment work is completed
    await RepairRequest.findByIdAndUpdate(job.repairRequestId, { status: 'completed' });
    await TechnicianProfile.updateOne({ _id: job.technicianId }, { $inc: { jobsCompleted: 1 } });
    if (job.serviceCenterId) await ServiceCenterProfile.updateOne({ _id: job.serviceCenterId }, { $inc: { jobsCompleted: 1 } });
    await notifyUser(job.customerUserId, 'status_update', 'Your repair is complete. Please inspect and confirm satisfaction to release payment.', job._id);
  } else {
    await job.save();
    await notifyUser(job.customerUserId, 'status_update', `Repair status: ${status.replace('_', ' ')}`, job._id);
  }
  return ok(res, job, 'Job status updated');
});