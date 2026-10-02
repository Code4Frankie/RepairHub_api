import { Router } from 'express';
import { createAppointment, getAppointmentById, listMyAppointments, rescheduleAppointment, cancelAppointment } from '../controller/appointmentController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.post('/', protect, authorize('customer'), validate(s.appointmentCreate), createAppointment);
router.get('/', protect, listMyAppointments);
router.get('/:id', protect, getAppointmentById);
router.patch('/:id/reschedule', protect, validate(s.appointmentReschedule), rescheduleAppointment);
router.patch('/:id/cancel', protect, validate(s.cancelBody), cancelAppointment);

export default router;
