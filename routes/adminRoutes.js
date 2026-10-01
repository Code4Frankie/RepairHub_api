import { Router } from 'express';
import { getStats, listWithdrawals, processWithdrawal, runAutoRelease } from '../controller/adminController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);
router.use(protect, authorize('admin'));

router.get('/stats', getStats);
router.get('/withdrawals', validate(s.adminList, 'query'), listWithdrawals);
router.patch('/withdrawals/:id', validate(s.withdrawalProcess), processWithdrawal);
router.post('/run-auto-release', runAutoRelease);

export default router;