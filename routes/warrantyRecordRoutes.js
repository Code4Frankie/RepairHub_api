import { Router } from 'express';
import { getWarrantyByJob, getWarrantyById, fileWarrantyClaim, resolveWarrantyClaim } from '../controller/warrantyRecordController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);
router.param('jobId', idParam);
router.param('claimId', idParam);

router.get('/job/:jobId', protect, getWarrantyByJob);
router.get('/:id', protect, getWarrantyById);
router.post('/:id/claims', protect, authorize('customer'), validate(s.warrantyClaim), fileWarrantyClaim);
router.patch('/:id/claims/:claimId', protect, authorize('technician', 'service_center', 'admin'), validate(s.claimResolve), resolveWarrantyClaim);

export default router;
