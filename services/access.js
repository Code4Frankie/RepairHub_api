import CustomerProfile from '../model/customerProfileModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { ApiError, forbidden, notFound } from '../utils/ApiError.js';

export const requireCustomerProfile = async (user) => {
  const p = await CustomerProfile.findOne({ userId: user._id });
  if (!p) throw notFound('Customer profile not found');
  return p;
};

export const requireTechnicianProfile = async (user) => {
  const p = await TechnicianProfile.findOne({ userId: user._id });
  if (!p) throw notFound('Technician profile not found');
  return p;
};

export const requireCenterProfile = async (user) => {
  const p = await ServiceCenterProfile.findOne({ userId: user._id });
  if (!p) throw notFound('Service center profile not found');
  return p;
};

export const requireVerified = (profile, label = 'Account') => {
  if (profile.verificationStatus !== 'verified') {
    throw new ApiError(403, `${label} must be verified by an admin before performing this action`);
  }
};

// Who may see / act on a job?
export const isCustomerOf = (job, user) => String(job.customerUserId) === String(user._id);
export const isProviderOf = (job, user) => String(job.payeeUserId) === String(user._id);

export const assertJobParticipant = (job, user) => {
  if (user.role === 'admin' || isCustomerOf(job, user) || isProviderOf(job, user)) return;
  // A technician on a center's team may also see/update the job they were assigned.
  if (job.technicianUserId && String(job.technicianUserId) === String(user._id)) return;
  throw forbidden('You are not a participant in this job');
};

export const assertOwner = (ownerUserId, user) => {
  if (user.role === 'admin') return;
  if (String(ownerUserId) !== String(user._id)) throw forbidden('You can only modify your own resources');
};
