import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import User from '../model/userModel.js';
import CustomerProfile from '../model/customerProfileModel.js';
import TechnicianProfile from '../model/technicianProfileModel.js';
import ServiceCenterProfile from '../model/serviceCenterModel.js';
import Wallet from '../model/walletModel.js';
import Transaction from '../model/transactionModel.js';
import { generateToken } from '../utils/generateToken.js';

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;
export const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
export const api = () => request(app);

// Register through the real endpoint (roles: customer | technician | service_center).
export const registerUser = async (role = 'customer', overrides = {}) => {
  const id = unique();
  const payload = {
    fullName: overrides.fullName || `Test ${role} ${id}`,
    email: overrides.email || `${role}${id}@example.com`,
    phone: overrides.phone || '08031234567',
    password: overrides.password || 'password123',
    role,
    ...(role === 'service_center' ? { businessName: overrides.businessName || `Shop ${id}` } : {}),
  };
  const res = await request(app).post('/api/users/register').send(payload);
  return { user: res.body.data?.user, token: res.body.data?.token, res, payload };
};

// Admins can't self-register, so fixtures create them directly (same as scripts/seedAdmin.js).
export const createAdmin = async () => {
  const id = unique();
  const user = await User.create({ fullName: 'Admin', email: `admin${id}@example.com`, passwordHash: await bcrypt.hash('password123', 4), role: 'admin' });
  return { user: user.toJSON(), token: generateToken({ id: user._id, role: 'admin' }) };
};

export const getCustomerProfile = (userId) => CustomerProfile.findOne({ userId });
export const getTechnicianProfile = (userId) => TechnicianProfile.findOne({ userId });
export const getCenterProfile = (userId) => ServiceCenterProfile.findOne({ userId });
export const getWallet = (userId) => Wallet.findOne({ userId });

// Go through the real approval flow: technician "uploads" a doc (fixture writes the URL, since
// Cloudinary is out of scope for tests), then admin approves via the API.
export const verifyTechnician = async (admin, technician) => {
  const profile = await getTechnicianProfile(technician.user._id);
  await TechnicianProfile.updateOne({ _id: profile._id }, { verificationDocs: ['https://example.com/id.jpg'] });
  const res = await request(app).patch(`/api/technician-profiles/${profile._id}/verify`).set(auth(admin)).send({ decision: 'approve' });
  return res;
};
export const verifyCenter = async (admin, center) => {
  const profile = await getCenterProfile(center.user._id);
  await ServiceCenterProfile.updateOne({ _id: profile._id }, { verificationDocs: ['https://example.com/cac.pdf'] });
  return request(app).patch(`/api/service-centers/${profile._id}/verify`).set(auth(admin)).send({ decision: 'approve' });
};

export const createCategory = async (admin, name = `Laptops ${unique()}`) =>
  (await request(app).post('/api/service-categories').set(auth(admin)).send({ name })).body.data;

export const createRepairRequest = async (customer, serviceCategoryId, extra = {}) =>
  (await request(app).post('/api/repair-requests').set(auth(customer))
    .field('serviceCategoryId', serviceCategoryId).field('itemType', extra.itemType || 'Laptop')
    .field('problemDescription', extra.problemDescription || 'Cracked screen, still powers on')
    .field('location', JSON.stringify({ lng: 3.3792, lat: 6.5244 }))).body.data;

export const submitQuotation = async (provider, repairRequestId, body = {}) =>
  request(app).post('/api/quotations').set(auth(provider)).send({ repairRequestId, price: 15000, estimatedDays: 2, warrantyDays: 30, ...body });

export const acceptAndBook = async (customer, quotationId) => {
  const acceptRes = await request(app).patch(`/api/quotations/${quotationId}/accept`).set(auth(customer));
  const apptRes = await request(app).post('/api/appointments').set(auth(customer)).send({ quotationId, scheduledAt: new Date(Date.now() + 86400000).toISOString(), serviceMode: 'dropoff' });
  return { quotation: acceptRes.body.data, appointment: apptRes.body.data, acceptRes, apptRes };
};

export const setStatus = (provider, jobId, status, note) =>
  request(app).patch(`/api/repair-jobs/${jobId}/status`).set(auth(provider)).send({ status, note });

export const getJob = async (viewer, jobId) => (await request(app).get(`/api/repair-jobs/${jobId}`).set(auth(viewer))).body.data;

// Simulate Paystack calling our webhook with a correctly signed body.
export const paystackWebhook = (reference, amountNaira, { secret = process.env.PAYSTACK_SECRET_KEY, event = 'charge.success' } = {}) => {
  const raw = JSON.stringify({ event, data: { reference, amount: amountNaira * 100, status: 'success' } });
  const sig = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  return request(app).post('/api/transactions/webhook/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(raw);
};

// Customer pays via Paystack: initialise, then the (signed) webhook confirms.
export const payWithPaystack = async (customer, jobId, amount) => {
  const init = await request(app).post('/api/transactions/pay').set(auth(customer)).send({ repairJobId: jobId, method: 'paystack' });
  await paystackWebhook(init.body.data.reference, amount);
  return init;
};

// Give a customer wallet balance directly (fixture — top-up flow itself has its own test).
export const fundWallet = (userId, amount) => Wallet.findOneAndUpdate({ userId }, { $inc: { balance: amount } }, { upsert: true, new: true });

// Full happy-path setup up to "booked, job created, unpaid".
export const buildBookedJob = async ({ price = 15000, warrantyDays = 30 } = {}) => {
  const admin = await createAdmin();
  const customer = await registerUser('customer');
  const technician = await registerUser('technician');
  await verifyTechnician(admin, technician);
  const customerProfile = await getCustomerProfile(customer.user._id);
  const technicianProfile = await getTechnicianProfile(technician.user._id);

  const category = await createCategory(admin);
  const repairRequest = await createRepairRequest(customer, category._id);
  const quoteRes = await submitQuotation(technician, repairRequest._id, { price, warrantyDays });
  const quotation = quoteRes.body.data;
  const { appointment, apptRes } = await acceptAndBook(customer, quotation._id);
  const job = await getJob(customer, appointment.repairJobId);
  return { admin, customer, technician, customerProfile, technicianProfile, category, repairRequest, quotation, appointment, apptRes, job };
};

// ... and paid into escrow.
export const buildPaidJob = async (opts) => {
  const ctx = await buildBookedJob(opts);
  await payWithPaystack(ctx.customer, ctx.job._id, ctx.job.price);
  return { ...ctx, job: await getJob(ctx.customer, ctx.job._id) };
};

// ... and completed by the technician.
export const buildCompletedJob = async (opts) => {
  const ctx = await buildPaidJob(opts);
  await setStatus(ctx.technician, ctx.job._id, 'in_progress');
  await setStatus(ctx.technician, ctx.job._id, 'completed', 'Screen replaced');
  return { ...ctx, job: await getJob(ctx.customer, ctx.job._id) };
};

export { Transaction, User };