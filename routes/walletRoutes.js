import { Router } from 'express';
import { getMyWallet, getWalletByUserId, requestWithdrawal } from '../controller/walletController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import { withdraw } from '../validators/schemas.js';

const router = Router();
router.param('userId', idParam);

router.get('/me', protect, getMyWallet);
router.post('/withdraw', protect, authorize('technician', 'service_center'), validate(withdraw), requestWithdrawal);
router.get('/:userId', protect, getWalletByUserId);

export default router;
