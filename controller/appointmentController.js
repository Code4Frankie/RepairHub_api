import Appointment from '../model/appointmentModel.js';
import Quotation from '../model/quotationModel.js';
import RepairRequest from '../model/repairRequestModel.js';
import RepairJob from '../model/repairJobModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { conflict, forbidden, notFound } from '../utils/ApiError.js';
import { requireCustomerProfile, isCustomerOf, isProviderOf } from '../services/access.js';
import { notifyUser } from '../services/notificationService.js';
import { refundEscrow } from '../services/escrowService.js';

// Both parties (and admins) may act on an appointment; returns the appointment + its job.
const loadForParticipant = async (req) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw notFound('Appointment not found');
  const job = await RepairJob.findOne({ appointmentId: appointment._id });
  const allowed = req.user.role === 'admin' || (job && (isCustomerOf(job, req.user) || isProviderOf(job, req.user) || String(job.technicianUserId) === String(req.user._id)));
  if (!allowed) throw forbidden('You are not part of this appointment');
  return { appointment, job };
};

const otherParty = (job, user) => (isCustomerOf(job, user) ? job.payeeUserId : job.customerUserId);

// POST /api/appointments  (customer books an accepted quotation) — also opens the RepairJob.
export const createAppointment = asyncHandler(async (req, res) => {
  const customer = await requireCustomerProfile(req.user);
  const { quotationId, scheduledAt, serviceMode, address, notes } = req.body;

  const quotation = await Quotation.findById(quotationId);
  if (!quotation || quotation.status !== 'accepted') throw conflict('Quotation must be accepted before booking an appointment');

  const request = await RepairRequest.findOne({ _id: quotation.repairRequestId, customerId: customer._id });
  if (!request) throw forbidden('This quotation is not for one of your requests');
  if (await Appointment.exists({ quotationId })) throw conflict('An appointment already exists for this quotation');

  const technician = await TechnicianProfile.findById(quotation.technicianId);
  const center = quotation.serviceCenterId ? await ServiceCenterProfile.findById(quotation.serviceCenterId) : null;

  const appointment = await Appointment.create({
    repairRequestId: request._id, quotationId, customerId: customer._id, technicianId: quotation.technicianId,
    scheduledAt, serviceMode, address: address || request.address, notes,
  });

  try {
    const job = await RepairJob.create({
      appointmentId: appointment._id, quotationId, repairRequestId: request._id,
      customerId: customer._id, technicianId: technician._id, serviceCenterId: center?._id || null,
      customerUserId: req.user._id, technicianUserId: technician.userId,
      payeeUserId: center ? center.userId : technician.userId,
      price: quotation.price, warrantyDays: quotation.warrantyDays,
      statusHistory: [{ status: 'accepted', note: 'Appointment booked', by: req.user._id }],
    });
    await notifyUser(job.payeeUserId, 'appointment', `Appointment booked for ${new Date(scheduledAt).toDateString()}`, job._id);
    return created(res, { ...appointment.toObject(), repairJobId: job._id }, 'Appointment booked');
  } catch (err) {
    await Appointment.deleteOne({ _id: appointment._id }); // never leave an appointment without a job
    throw err;
  }
});

export const getAppointmentById = asyncHandler(async (req, res) => {
  const { appointment, job } = await loadForParticipant(req);
  return ok(res, { ...appointment.toObject(), repairJobId: job?._id });
});

// GET /api/appointments  (mine)
export const listMyAppointments = asyncHandler(async (req, res) => {
  const field = req.user.role === 'customer' ? 'customerUserId' : req.user.role === 'technician' ? 'technicianUserId' : 'payeeUserId';
  const jobs = await RepairJob.find(req.user.role === 'admin' ? {} : { $or: [{ [field]: req.user._id }, { payeeUserId: req.user._id }] }).select('appointmentId');
  const list = await Appointment.find({ _id: { $in: jobs.map((j) => j.appointmentId) } }).sort({ scheduledAt: 1 });
  return ok(res, list);
});

// PATCH /api/appointments/:id/reschedule
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  const { appointment, job } = await loadForParticipant(req);
  if (!['scheduled', 'rescheduled'].includes(appointment.status)) throw conflict(`A ${appointment.status} appointment cannot be rescheduled`);
  if (job && !['accepted', 'diagnosing', 'on_hold'].includes(job.status)) throw conflict('Work has already started on this job');

  appointment.scheduledAt = req.body.scheduledAt;
  appointment.status = 'rescheduled';
  await appointment.save();
  await notifyUser(otherParty(job, req.user), 'appointment', 'The appointment was rescheduled', job._id);
  return ok(res, appointment, 'Appointment rescheduled');
});

// PATCH /api/appointments/:id/cancel — before work starts. Escrowed money is refunded in full.
export const cancelAppointment = asyncHandler(async (req, res) => {
  const { appointment, job } = await loadForParticipant(req);
  if (['cancelled', 'completed'].includes(appointment.status)) throw conflict(`Appointment is already ${appointment.status}`);
  if (!['accepted', 'diagnosing', 'on_hold'].includes(job.status)) throw conflict('Work has started — open a dispute instead of cancelling');

  appointment.status = 'cancelled';
  await appointment.save();

  job.status = 'cancelled';
  job.statusHistory.push({ status: 'cancelled', note: req.body.reason || 'Appointment cancelled', by: req.user._id });
  await job.save();
  if (job.payment.status === 'held') await refundEscrow(job._id);

  await RepairRequest.findByIdAndUpdate(job.repairRequestId, { status: 'cancelled' });
  await notifyUser(otherParty(job, req.user), 'appointment', 'The appointment was cancelled', job._id);
  return ok(res, appointment, 'Appointment cancelled');
});