import { Router } from 'express';
import {
  listServiceCenters, getMyServiceCenter, getServiceCenterById, updateServiceCenter, uploadCenterDocs,
  listTeam, addTeamMember, removeTeamMember, listPendingCenters, verifyServiceCenter,
} from '../controller/serviceCenterController.js';
import { protect, authorize } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);
router.param('technicianId', idParam);

router.get('/pending', protect, authorize('admin'), listPendingCenters);
router.get('/me', protect, authorize('service_center'), getMyServiceCenter);
router.get('/', validate(s.centerSearch, 'query'), listServiceCenters);
router.get('/:id', getServiceCenterById);
router.patch('/:id', protect, authorize('service_center'), validate(s.centerUpdate), updateServiceCenter);
router.patch('/:id/verify', protect, authorize('admin'), validate(s.verifyDecision), verifyServiceCenter);
router.post('/:id/verification-docs', protect, authorize('service_center'), upload.array('docs', 5), uploadCenterDocs);
router.get('/:id/team', protect, authorize('service_center'), listTeam);
router.post('/:id/team', protect, authorize('service_center'), validate(s.addTeamMember), addTeamMember);
router.delete('/:id/team/:technicianId', protect, authorize('service_center'), removeTeamMember);

export default router;
