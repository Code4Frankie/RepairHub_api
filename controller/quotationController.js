import Quotation from '../model/quotationModel.js';
import RepairRequest from '../model/repairRequestModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/ApiError.js';
import { requireCustomerProfile, requireVerified } from '../services/access.js';
import { notifyUser } from '../services/notificationService.js';

// POST /api/quotations  (verified technician, or a verified service center naming a team member)
export const submitQuotation = asyncHandler(async (req, res) => {
    const { repairRequestId, laborCost = 0, partsCost = 0, estimatedDays, warrantyDays, notes, validDays = 7 } = req.body;

    const request = await RepairRequest.findById(repairRequestId);
    if (!request) throw notFound('Repair request not found');
    if (!['open', 'quoted'].includes(request.status)) throw conflict('This request is no longer accepting quotations');

    let technician;
    let center = null;
    if (req.user.role === 'service_center') {
        center = await ServiceCenterProfile.findOne({ userId: req.user._id });
        if (!center) throw notFound('Service center profile not found');
        requireVerified(center, 'Service center');
        if (!req.body.technicianId) throw badRequest('technicianId is required: pick the team member who will do the work');
        technician = await TechnicianProfile.findOne({ _id: req.body.technicianId, serviceCenterId: center._id });
        if (!technician) throw forbidden('That technician is not on your team');
    } else {
        technician = await TechnicianProfile.findOne({ userId: req.user._id });
        if (!technician) throw notFound('Technician profile not found');
        requireVerified(technician, 'Technician');
    }
    const catIds = (center || technician).serviceCategoryIds || [];
    if (catIds.length && !catIds.some((id) => String(id) === String(request.serviceCategoryId))) {
        throw forbidden('This request is outside your service categories');
    }

    const price = req.body.price ?? laborCost + partsCost;
    if (req.body.price && (laborCost || partsCost) && Math.round(laborCost + partsCost) !== Math.round(req.body.price)) {
        throw badRequest('price must equal laborCost + partsCost');
    }

    const quotation = await Quotation.create({
        repairRequestId, technicianId: technician._id, serviceCenterId: center?._id || null,
        laborCost, partsCost, price, estimatedDays, warrantyDays, notes,
        expiresAt: new Date(Date.now() + validDays * 86400000),
    });

    if (request.status === 'open') { request.status = 'quoted'; await request.save(); }

    const customer = await RepairRequest.findById(repairRequestId).populate({ path: 'customerId', select: 'userId' });
    await notifyUser(customer.customerId.userId, 'quotation', `New quotation of ₦${price.toLocaleString('en-NG')} received`, quotation._id);
    return created(res, quotation, 'Quotation submitted');
});

// GET /api/quotations/repair-request/:id?sort=price|rating|eta|value   — comparison view (FR-9)
export const getQuotationsForRequest = asyncHandler(async (req, res) => {
    const request = await RepairRequest.findById(req.params.id);
    if (!request) throw notFound('Repair request not found');
    if (req.user.role !== 'admin') {
        const me = await requireCustomerProfile(req.user).catch(() => null);
        if (!me || String(request.customerId) !== String(me._id)) throw forbidden('Only the request owner can compare quotations');
    }

    await Quotation.updateMany({ repairRequestId: request._id, status: 'pending', expiresAt: { $lt: new Date() } }, { status: 'expired' });
    const list = await Quotation.find({ repairRequestId: request._id, status: { $in: ['pending', 'accepted'] } })
        .populate({ path: 'technicianId', select: 'userId ratingAvg ratingCount jobsCompleted serviceAreas', populate: { path: 'userId', select: 'fullName' } })
        .populate('serviceCenterId', 'businessName ratingAvg')
        .lean();

    // "Best value": cheapest per rating point (unrated technicians count as 3.0).
    const score = (q) => q.price / (q.technicianId?.ratingAvg || 3);
    const best = list.length ? list.reduce((a, b) => (score(b) < score(a) ? b : a)) : null;
    list.forEach((q) => { q.bestValue = !!best && String(q._id) === String(best._id); });

    const sorters = {
        price: (a, b) => a.price - b.price,
        rating: (a, b) => (b.technicianId?.ratingAvg || 0) - (a.technicianId?.ratingAvg || 0),
        eta: (a, b) => (a.estimatedDays ?? 999) - (b.estimatedDays ?? 999),
        value: (a, b) => score(a) - score(b),
    };
    list.sort(sorters[req.query.sort] || sorters.price);
    return ok(res, list);
});

// GET /api/quotations/mine  (provider's own quotes)
export const listMyQuotations = asyncHandler(async (req, res) => {
    let filter;
    if (req.user.role === 'service_center') {
        const c = await ServiceCenterProfile.findOne({ userId: req.user._id });
        filter = { serviceCenterId: c?._id };
    } else {
        const t = await TechnicianProfile.findOne({ userId: req.user._id });
        filter = { technicianId: t?._id, serviceCenterId: null };
    }
    return ok(res, await Quotation.find(filter).populate('repairRequestId', 'itemType status').sort({ createdAt: -1 }).limit(100));
});

// PATCH /api/quotations/:id/accept   (the request's owner)
export const acceptQuotation = asyncHandler(async (req, res) => {
    const me = await requireCustomerProfile(req.user);
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) throw notFound('Quotation not found');

    const request = await RepairRequest.findOne({ _id: quotation.repairRequestId, customerId: me._id });
    if (!request) throw forbidden('This quotation is not for one of your requests');
    if (!['open', 'quoted'].includes(request.status)) throw conflict('This request has already been booked or closed');
    if (quotation.expiresAt && quotation.expiresAt < new Date()) throw conflict('This quotation has expired');

    // Atomic pending -> accepted: two concurrent accepts cannot both win.
    const accepted = await Quotation.findOneAndUpdate({ _id: quotation._id, status: 'pending' }, { status: 'accepted' }, { new: true });
    if (!accepted) throw conflict('This quotation is no longer available');

    await Quotation.updateMany({ repairRequestId: request._id, _id: { $ne: accepted._id }, status: 'pending' }, { status: 'rejected' });
    request.status = 'booked';
    request.acceptedQuotationId = accepted._id;
    await request.save();

    const tech = await TechnicianProfile.findById(accepted.technicianId).select('userId');
    const payee = accepted.serviceCenterId ? (await ServiceCenterProfile.findById(accepted.serviceCenterId)).userId : tech.userId;
    await notifyUser(payee, 'quotation', 'Your quotation was accepted! The customer will schedule the appointment.', accepted._id);
    return ok(res, accepted, 'Quotation accepted — book an appointment next');
});

// PATCH /api/quotations/:id/withdraw  (the provider who sent it, while still pending)
export const withdrawQuotation = asyncHandler(async (req, res) => {
    const mine = req.user.role === 'service_center'
        ? await ServiceCenterProfile.findOne({ userId: req.user._id })
        : await TechnicianProfile.findOne({ userId: req.user._id });
    const quotation = await Quotation.findOne({ _id: req.params.id, ...(req.user.role === 'service_center' ? { serviceCenterId: mine?._id } : { technicianId: mine?._id, serviceCenterId: null }) });
    if (!quotation) throw notFound('Quotation not found');
    if (quotation.status !== 'pending') throw conflict(`A ${quotation.status} quotation cannot be withdrawn`);
    quotation.status = 'withdrawn';
    await quotation.save();
    return ok(res, quotation, 'Quotation withdrawn');
});
