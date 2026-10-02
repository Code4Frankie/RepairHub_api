import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

// Usage: router.post('/', validate(schema), handler)  |  validate(schema, 'query')
// Replaces req[source] with the sanitised value: unknown keys are stripped, types converted
// (essential for multipart/form-data where every field arrives as a string).
export const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const { value, error } = schema.validate(req[source] || {}, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/"/g, ''),
      }));
      return next(new ApiError(400, 'Validation failed', errors));
    }
    // req.query is a getter in newer Express versions — define instead of assign.
    Object.defineProperty(req, source, { value, writable: true, configurable: true, enumerable: true });
    next();
  };

// router.param('id', idParam) — rejects malformed ObjectIds with a clean 400 instead of a CastError.

export const idParam = (req, res, next, value, name) => {
  if (!mongoose.isValidObjectId(value) || String(value).length !== 24) {
    return next(new ApiError(400, `Invalid ${name}`));
  }
  next();
};
