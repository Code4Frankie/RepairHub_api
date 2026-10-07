import { Router } from 'express';
import { listServiceCategories, createServiceCategory, updateServiceCategory } from '../controller/serviceCategoryController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import { categoryCreate, categoryUpdate } from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.get('/', listServiceCategories);
router.post('/', protect, authorize('admin'), validate(categoryCreate), createServiceCategory);
router.patch('/:id', protect, authorize('admin'), validate(categoryUpdate), updateServiceCategory);

export default router;
