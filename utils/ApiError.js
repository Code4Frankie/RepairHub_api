// Throw these from controllers/services; middleware/errorHandler.js turns them into JSON.
export class ApiError extends Error {
  constructor(status, message, errors = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

export const badRequest = (msg = 'Bad request', errors) => new ApiError(400, msg, errors);
export const unauthorized = (msg = 'Not authorized') => new ApiError(401, msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const conflict = (msg = 'Conflict') => new ApiError(409, msg);
