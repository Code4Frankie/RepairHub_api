import Review from '../model/reviewModel.js';
import RepairJob from '../model/repairJobModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { conflict, forbidden, notFound } from '../utils/ApiError.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
import { notifyUser } from '../services/notificationService.js';

// Reviews are immutable, so the average is maintained incrementally (sum / count) — O(1) per
// review and no aggregation over the whole review history.
const addRating = async (Model, id, rating) => {
  const doc = await Model.findOneAndUpdate({ _id: id }, { $inc: { ratingSum: rating, ratingCount: 1 } }, { new: true });
  if (doc) await Model.updateOne({ _id: id }, { ratingAvg: Math.round((doc.ratingSum / doc.ratingCount) * 100) / 100 });
};

// POST /api/reviews  (customer, own completed job, once)
export const createReview = asyncHandler(async (req, res) => {
  const job = await RepairJob.findById(req.body.repairJobId);
  if (!job) throw notFound('Repair job not found');
  if (String(job.customerUserId) !== String(req.user._id)) throw forbidden('You can only review your own jobs');
  if (job.status !== 'completed') throw conflict('You can review a repair once it is completed');
  if (await Review.exists({ repairJobId: job._id })) throw conflict('You have already reviewed this job');

  // technician/customer ids come from the JOB, never from the request body
  const review = await Review.create({
    repairJobId: job._id, customerId: job.customerId, technicianId: job.technicianId, serviceCenterId: job.serviceCenterId,
    rating: req.body.rating, tags: req.body.tags, comment: req.body.comment,
  });

  await addRating(TechnicianProfile, job.technicianId, review.rating);
  if (job.serviceCenterId) await addRating(ServiceCenterProfile, job.serviceCenterId, review.rating);
  await notifyUser(job.technicianUserId, 'review', `You received a ${review.rating}-star review`, review._id);
  return created(res, review, 'Review submitted');
});

// GET /api/reviews/technician/:id  (public)
export const getReviewsForTechnician = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const filter = { technicianId: req.params.id };
  const [items, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit), Review.countDocuments(filter)]);
  return ok(res, items, 'Reviews', 200, pageMeta(pg, total));
});
