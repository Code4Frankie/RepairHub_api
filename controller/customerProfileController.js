import CustomerProfile from '../model/customerProfileModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { toPoint } from '../utils/geo.js';
import { forbidden, notFound } from '../utils/ApiError.js';

const assertOwnerOrAdmin = (profile, user) => {
    if (user.role !== 'admin' && String(profile.userId) !== String(user._id)) throw forbidden('Not your profile');
};

export const getMyCustomerProfile = asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findOne({ userId: req.user._id });
    if (!profile) throw notFound('Customer profile not found');
    return ok(res, profile);
});

// Customer profiles hold home addresses, so only the owner (or an admin) can read them.
export const getCustomerProfileById = asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findById(req.params.id);
    if (!profile) throw notFound('Customer profile not found');
    assertOwnerOrAdmin(profile, req.user);
    return ok(res, profile);
});

export const updateCustomerProfile = asyncHandler(async (req, res) => {
    const profile = await CustomerProfile.findById(req.params.id);
    if (!profile) throw notFound('Customer profile not found');
    assertOwnerOrAdmin(profile, req.user);

    const { address, location, savedDevices } = req.body;
    if (address !== undefined) profile.address = address;
    if (location) profile.location = toPoint(location.lng, location.lat);
    if (savedDevices) profile.savedDevices = savedDevices;
    await profile.save();
    return ok(res, profile, 'Customer profile updated');
});
