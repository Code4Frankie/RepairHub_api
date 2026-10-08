import cloudinary from '../config/cloudinary.js';

// Streams a single in-memory file buffer (from Multer) up to Cloudinary.
export const uploadBufferToCloudinary = (buffer, folder = 'repairhub') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (err, result) => {
        if (err) return reject(err);
        resolve(result); // result.secure_url, result.public_id
      }
    );
    stream.end(buffer);
  });

// Uploads every file on req.files (array) and returns an array of secure URLs.
export const uploadManyToCloudinary = async (files = [], folder = 'repairhub') => {
  const uploads = await Promise.all(
    files.map((file) => uploadBufferToCloudinary(file.buffer, folder))
  );
  return uploads.map((u) => u.secure_url);
};

export const deleteFromCloudinary = (publicId) => cloudinary.uploader.destroy(publicId);
