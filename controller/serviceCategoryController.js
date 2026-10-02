import ServiceCategory from '../model/serviceCategoryModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { notFound } from '../utils/ApiError.js';

export const listServiceCategories = asyncHandler(async (req, res) => {
  const categories = await ServiceCategory.find({ isActive: true }).sort({ name: 1 });
  return ok(res, categories);
});

export const createServiceCategory = asyncHandler(async (req, res) => {
  const category = await ServiceCategory.create(req.body);
  return created(res, category, 'Service category created');
});

export const updateServiceCategory = asyncHandler(async (req, res) => {
  const category = await ServiceCategory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!category) throw notFound('Service category not found');
  return ok(res, category, 'Service category updated');
});
