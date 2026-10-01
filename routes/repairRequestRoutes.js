import { Router } from 'express';
import { createRepairRequest, listRepairRequests, getRepairRequestById, cancelRepairRequest } from '../controller/repairRequestController.js';
import { protect, authorize } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

// upload.array runs first so multipart text fields are parsed before validation.
router.post('/', protect, authorize('customer'), upload.array('media', 6), validate(s.repairRequestCreate), createRepairRequest);
router.get('/', protect, validate(s.repairRequestList, 'query'), listRepairRequests);
router.get('/:id', protect, getRepairRequestById);
router.patch('/:id/cancel', protect, authorize('customer'), cancelRepairRequest);

export default router;
