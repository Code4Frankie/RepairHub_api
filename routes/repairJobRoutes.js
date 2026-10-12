import { Router } from 'express';
import { listMyJobs, getRepairJobById, updateJobStatus, confirmCompletion } from '../controller/repairJobController.js';
import { protect, authorize } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

// Jobs are created by the system when an appointment is booked — there is no POST here.
router.get('/', protect, validate(s.jobList, 'query'), listMyJobs);
router.get('/:id', protect, getRepairJobById);
// upload.array runs first so multipart text fields (status, note) are parsed before validation.
// Plain JSON bodies are unaffected: multer only touches multipart requests.
router.patch('/:id/status', protect, authorize('technician', 'service_center'), upload.array('media', 6), validate(s.jobStatus), updateJobStatus);
router.post('/:id/confirm', protect, authorize('customer'), confirmCompletion);

export default router;
