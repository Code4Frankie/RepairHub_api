import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

// Files are held in memory only, then streamed to Cloudinary in the controller layer.
// Nothing is ever written to local disk.
const storage = multer.memoryStorage();

const ALLOWED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf', // verification documents (CAC certificates, IDs)
  'video/mp4',
  'video/quicktime',
];

const fileFilter = (req, file, cb) => {
  if (ALLOWED.includes(file.mimetype)) return cb(null, true);
  cb(new ApiError(400, `Unsupported file type: ${file.mimetype}`), false);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024, files: 8 }, // 25MB per file
});
