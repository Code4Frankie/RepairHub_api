import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDB } from './config/db.js';
import { validateEnv } from './config/env.js';
import { autoReleaseDue } from './services/escrowService.js';
import { seedCategoriesDB } from './scripts/seedCategories.js';
import ServiceCategory from './model/serviceCategoryModel.js';
import User from './model/userModel.js';

validateEnv();
const PORT = process.env.PORT || 5000;

/** A brand-new database comes up ready to serve: launch categories are seeded, and — when
 *  ADMIN_EMAIL + ADMIN_PASSWORD are configured — an admin account is created so the team can
 *  log in and verify technicians and centers. Idempotent; safe to run on any boot. */
const bootstrapSeed = async () => {
  // The app's screens are driven by categories (Smartphones, Laptops, …). Without them, requests
  // and jobs have nothing to attach to, which looks like "requests don't save" to customers.
  if (!(await ServiceCategory.countDocuments())) {
    const r = await seedCategoriesDB();
    console.log(`Seeded ${r.created} service categories (${r.total} total)`);
  }
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'RepairHub Admin' } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 10) {
    const email = ADMIN_EMAIL.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const existing = await User.findOne({ email });
    if (existing) {
      existing.role = 'admin'; existing.status = 'active'; existing.passwordHash = passwordHash;
      await existing.save();
    } else {
      await User.create({ fullName: ADMIN_NAME, email, passwordHash, role: 'admin' });
    }
    console.log('Admin account ready');
  }
};

const start = async () => {
  await connectDB();
  await bootstrapSeed();
  const server = app.listen(PORT, () => console.log(`RepairHub API running on port ${PORT}`));

  // Escrow auto-release sweep (customer silence after completion => pay the technician).
  // Single-instance safe: the release itself is an atomic guarded update, so overlapping
  // sweeps on multiple instances cannot double-pay.
  const sweep = setInterval(() => autoReleaseDue().catch((e) => console.error('auto-release failed:', e.message)), 10 * 60 * 1000);
  sweep.unref();

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    clearInterval(sweep);
    server.close(async () => { await mongoose.connection.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });
start().catch((err) => { console.error('Failed to start server:', err); process.exit(1); });


//enty point for the RepairHub API server. Connects to MongoDB, starts the Express app, and sets up a periodic sweep to auto-release escrow payments for completed jobs where the customer has not responded. Also handles graceful shutdown on termination signals and logs unhandled promise rejections.
