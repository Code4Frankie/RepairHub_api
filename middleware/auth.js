import jwt from 'jsonwebtoken';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../model/userModel.js';
import { ApiError } from '../utils/ApiError.js';

export const protect = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Not authorized, no token provided');
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    throw new ApiError(401, 'Not authorized, token invalid or expired');
  }

  const user = await User.findById(decoded.id).select('-passwordHash');
  if (!user) throw new ApiError(401, 'Not authorized, user not found');
  if (user.status !== 'active') throw new ApiError(403, 'Account suspended. Contact support.');

  req.user = user;
  next();
});

// Usage: router.post('/', protect, authorize('technician'), controllerFn)
export const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden: insufficient role permissions'));
    }
    next();
  };
