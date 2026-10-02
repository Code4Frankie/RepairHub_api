import { Router } from 'express';
import { getMyCustomerProfile, getCustomerProfileById, updateCustomerProfile } from '../controller/customerProfileController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import { customerProfileUpdate } from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.get('/me', protect, authorize('customer'), getMyCustomerProfile);
router.get('/:id', protect, getCustomerProfileById);
router.patch('/:id', protect, authorize('customer', 'admin'), validate(customerProfileUpdate), updateCustomerProfile);

export default router;
