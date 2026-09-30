import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { validateEnv } from './config/env.js';
import { autoReleaseDue } from './services/escrowService.js';

validateEnv();
const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  const server = app.listen(PORT, () => console.log(`RepairHub API running on port ${PORT}`));
    // Escrow auto-release sweep (customer silence after completion => pay the technician).
  // Single-instance safe: the release itself is an atomic guarded update, so overlapping
  // sweeps on multiple instances cannot double-pay.
  const sweep = setInterval(() => autoReleaseDue().catch((e) => console.error('auto-release failed:', e.message)), 10 * 60 * 1000);
  sweep.unref();
};

start();