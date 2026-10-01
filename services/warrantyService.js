import WarrantyRecord from '../model/warrantyRecordModel.js';
import { notifyUser } from './notificationService.js';

// Idempotent: unique index on repairJobId means a second call just returns the existing record.
export const issueWarranty = async (job) => {
  const existing = await WarrantyRecord.findOne({ repairJobId: job._id });
  if (existing) return existing;
  if (!job.warrantyDays) return null; // quotation offered no warranty
  const expiresAt = new Date(Date.now() + job.warrantyDays * 86400000);
  const warranty = await WarrantyRecord.create({
    repairJobId: job._id,
    customerId: job.customerId,
    technicianId: job.technicianId,
    durationDays: job.warrantyDays,
    expiresAt,
  });
  await notifyUser(job.customerUserId, 'warranty', `Your ${job.warrantyDays}-day warranty is now active.`, warranty._id);
  return warranty;
};
