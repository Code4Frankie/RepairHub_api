import mongoose from 'mongoose';

const serviceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    parentCategory: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('ServiceCategory', serviceCategorySchema);
