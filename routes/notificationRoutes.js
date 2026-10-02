import { Router } from 'express';
import { listMyNotifications, markAsRead, markAllAsRead } from '../controller/notificationController.js';
import { protect } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import { notificationList } from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.get('/', protect, validate(notificationList, 'query'), listMyNotifications);
router.patch('/read-all', protect, markAllAsRead);
router.patch('/:id/read', protect, markAsRead);

export default router;
