import { Router } from 'express';
import { openDispute, listDisputes, getDisputeById, resolveDispute } from '../controller/disputeController.js';
import { protect, authorize } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.post('/', protect, upload.array('evidence', 5), validate(s.disputeCreate), openDispute);
router.get('/', protect, validate(s.adminList, 'query'), listDisputes);
router.get('/:id', protect, getDisputeById);
router.patch('/:id/resolve', protect, authorize('admin'), validate(s.disputeResolve), resolveDispute);

export default router;