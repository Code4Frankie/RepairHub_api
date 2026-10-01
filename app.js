import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { notFound, errorHandler } from './middleware/errorHandler.js';
import { setupSwagger } from './config/swagger.js';

import userRoutes from './routes/userRoutes.js';
import customerProfileRoutes from './routes/customerProfileRoutes.js';
import technicianProfileRoutes from './routes/technicianProfileRoutes.js';
import serviceCenterRoutes from './routes/serviceCenterRoutes.js';
import serviceCategoryRoutes from './routes/serviceCategoryRoutes.js';
import repairRequestRoutes from './routes/repairRequestRoutes.js';
import quotationRoutes from './routes/quotationRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import repairJobRoutes from './routes/repairJobRoutes.js';
import warrantyRecordRoutes from './routes/warrantyRecordRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import disputeRoutes from './routes/disputeRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const app = express();
const isTest = process.env.NODE_ENV === 'test';

app.set('trust proxy', 1); // behind Render/Railway/Nginx: rate limiting must see the real client IP
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : '*', credentials: true }));
// Keep the raw body: Paystack's webhook signature is computed over the exact bytes received.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
if (!isTest) app.use(morgan('combined'));

if (!isTest) {
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests, slow down.' } }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many attempts, try again later.' } });
  app.use('/api/users/login', authLimiter);
  app.use('/api/users/register', authLimiter);
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'repairhub-api', uptime: process.uptime() }));
setupSwagger(app);

app.use('/api/users', userRoutes);
app.use('/api/customer-profiles', customerProfileRoutes);
app.use('/api/technician-profiles', technicianProfileRoutes);
app.use('/api/service-centers', serviceCenterRoutes);
app.use('/api/service-categories', serviceCategoryRoutes);
app.use('/api/repair-requests', repairRequestRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/repair-jobs', repairJobRoutes);
app.use('/api/warranty-records', warrantyRecordRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
