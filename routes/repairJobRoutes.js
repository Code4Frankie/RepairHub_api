import { Router } from 'express';
import { listMyJobs, getRepairJobById, updateJobStatus, confirmCompletion } from '../controller/repairJobController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

// Jobs are created by the system when an appointment is booked — there is no POST here.
router.get('/', protect, validate(s.jobList, 'query'), listMyJobs);
router.get('/:id', protect, getRepairJobById);
router.patch('/:id/status', protect, authorize('technician', 'service_center'), validate(s.jobStatus), updateJobStatus);
router.post('/:id/confirm', protect, authorize('customer'), confirmCompletion);

export default router;
