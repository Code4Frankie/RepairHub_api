import { Router } from 'express';
import { submitQuotation, getQuotationsForRequest, listMyQuotations, acceptQuotation, withdrawQuotation } from '../controller/quotationController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.post('/', protect, authorize('technician', 'service_center'), validate(s.quotationCreate), submitQuotation);
router.get('/mine', protect, authorize('technician', 'service_center'), listMyQuotations);
router.get('/repair-request/:id', protect, authorize('customer', 'admin'), validate(s.quotationCompare, 'query'), getQuotationsForRequest);
router.patch('/:id/accept', protect, authorize('customer'), acceptQuotation);
router.patch('/:id/withdraw', protect, authorize('technician', 'service_center'), withdrawQuotation);

export default router;
