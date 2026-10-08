// Creates (or promotes) the first admin account. Admins can never self-register via the API.
//   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin
import 'dotenv/config';
import dns from 'node:dns';
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../model/userModel.js';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'RepairHub Admin', MONGO_URI } = process.env;
if (!MONGO_URI || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set MONGO_URI, ADMIN_EMAIL and ADMIN_PASSWORD');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 10) {
  console.error('ADMIN_PASSWORD must be at least 10 characters');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
const email = ADMIN_EMAIL.toLowerCase().trim();
const existing = await User.findOne({ email });
if (existing) {
  existing.role = 'admin'; existing.passwordHash = passwordHash; existing.status = 'active';
  await existing.save();
  console.log(`Updated existing user ${email} -> admin`);
} else {
  await User.create({ fullName: ADMIN_NAME, email, passwordHash, role: 'admin' });
  console.log(`Created admin ${email}`);
}
await mongoose.disconnect();
