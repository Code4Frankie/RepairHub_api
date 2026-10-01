import { Router } from 'express';
import { createReview, getReviewsForTechnician } from '../controller/reviewController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.post('/', protect, authorize('customer'), validate(s.reviewCreate), createReview);
router.get('/technician/:id', getReviewsForTechnician);

export default router;
