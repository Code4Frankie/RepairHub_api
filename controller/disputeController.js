import Dispute from '../model/disputeModel.js';
import RepairJob from '../model/repairJobModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/ApiError.js';
import { uploadManyToCloudinary } from '../utils/cloudinaryUpload.js';
import { assertJobParticipant } from '../services/access.js';
import { notifyUser } from '../services/notificationService.js';
import { refundEscrow, releaseEscrow, settleCash } from '../services/escrowService.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';

const DISPUTABLE = ['in_progress', 'quality_check', 'ready', 'completed', 'awaiting_parts', 'on_hold', 'diagnosing'];

// POST /api/disputes  (multipart, optional field "evidence") — customer or provider on the job.
// Freezes the job (and any escrow) until an admin rules on it.
export const openDispute = asyncHandler(async (req, res) => {
  const job = await RepairJob.findById(req.body.repairJobId);
  if (!job) throw notFound('Repair job not found');
  assertJobParticipant(job, req.user);
  if (req.user.role === 'admin') throw forbidden('Admins resolve disputes, they do not open them');
  if (!DISPUTABLE.includes(job.status)) throw conflict(`A ${job.status} job cannot be disputed`);
  if (['released', 'refunded', 'cash_settled'].includes(job.payment.status)) throw conflict('This job has already been settled');

  const evidenceUrls = req.files?.length ? await uploadManyToCloudinary(req.files, 'disputes') : [];
  const dispute = await Dispute.create({ repairJobId: job._id, raisedBy: req.user._id, reason: req.body.reason, evidenceUrls });

  job.statusBeforeDispute = job.status;
  job.status = 'disputed';
  job.statusHistory.push({ status: 'disputed', note: req.body.reason.slice(0, 200), by: req.user._id });
  await job.save();

  const other = String(job.customerUserId) === String(req.user._id) ? job.payeeUserId : job.customerUserId;
  await notifyUser(other, 'dispute', 'A dispute was opened on your job. Payment is frozen pending review.', dispute._id);
  return created(res, dispute, 'Dispute opened');
});

// GET /api/disputes  — admin: all (?status=open); others: those on their own jobs
export const listDisputes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role !== 'admin') {
    const jobs = await RepairJob.find({ $or: [{ customerUserId: req.user._id }, { payeeUserId: req.user._id }, { technicianUserId: req.user._id }] }).select('_id');
    filter.repairJobId = { $in: jobs.map((j) => j._id) };
  }
  const pg = parsePagination(req.query);
  const [items, total] = await Promise.all([
    Dispute.find(filter).populate('repairJobId', 'price status payment').sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    Dispute.countDocuments(filter),
  ]);
  return ok(res, items, 'Disputes', 200, pageMeta(pg, total));
});

export const getDisputeById = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw notFound('Dispute not found');
  assertJobParticipant(await RepairJob.findById(dispute.repairJobId), req.user);
  return ok(res, dispute);
});

// PATCH /api/disputes/:id/resolve  (admin)  { decision: release|refund|partial, refundAmount?, note? }
export const resolveDispute = asyncHandler(async (req, res) => {
  const { decision, refundAmount, note } = req.body;
  const dispute = await Dispute.findOneAndUpdate({ _id: req.params.id, status: 'open' }, { status: 'resolved' }, { new: true });
  if (!dispute) {
    if (await Dispute.exists({ _id: req.params.id })) throw conflict('Dispute already resolved');
    throw notFound('Dispute not found');
  }
  const job = await RepairJob.findById(dispute.repairJobId);
  const isEscrow = job.payment.status === 'held';

  if (decision === 'partial' && refundAmount >= job.price) {
    await Dispute.updateOne({ _id: dispute._id }, { status: 'open' });
    throw badRequest('Partial refund must be less than the job price; use "refund" for a full refund');
  }

  if (isEscrow) {
    if (decision === 'release') await releaseEscrow(job._id);
    else if (decision === 'refund') await refundEscrow(job._id);
    else await refundEscrow(job._id, refundAmount);
  } else if (job.payment.status === 'cash' && decision === 'release') {
    await settleCash(job._id);
  }

  job.status = decision === 'refund' ? 'cancelled' : 'completed';
  job.progress = decision === 'refund' ? job.progress : 100;
  if (job.status === 'completed' && !job.completedAt) job.completedAt = new Date();
  job.statusHistory.push({ status: job.status, note: `Dispute resolved: ${decision}`, by: req.user._id });
  await job.save();

  dispute.resolution = { decision: isEscrow || job.payment.status === 'cash_settled' ? decision : 'none', refundAmount, note, resolvedBy: req.user._id, resolvedAt: new Date() };
  await dispute.save();

  await notifyUser(job.customerUserId, 'dispute', `Your dispute was resolved: ${decision}`, dispute._id);
  await notifyUser(job.payeeUserId, 'dispute', `The dispute on your job was resolved: ${decision}`, dispute._id);
  return ok(res, dispute, 'Dispute resolved');
});
