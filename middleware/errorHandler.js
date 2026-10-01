import { ApiError } from '../utils/ApiError.js';

export const notFound = (req, res, next) => next(new ApiError(404, `Route not found - ${req.originalUrl}`));

// Maps every failure mode to a consistent { success:false, message, errors } JSON body.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  let status = err.status || err.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);
  let message = err.message || 'Internal server error';
  let errors = err.errors || null;

  if (err.name === 'ValidationError' && err.errors && !(err instanceof ApiError)) {
    status = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for ${Object.keys(err.keyValue || {}).join(', ') || 'field'}`;
  } else if (err.name === 'MulterError') {
    status = 400;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  if (status < 400) status = 500;
  if (status >= 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') message = 'Internal server error';
  }

  res.status(status).json({
    success: false,
    message,
    errors,
    stack: process.env.NODE_ENV === 'production' || status < 500 ? undefined : err.stack,
  });
};
