// Seeds the launch categories into MongoDB. Idempotent — run it any time, on any database:
//   MONGO_URI=... npm run seed:categories
// Only inserts categories that don't already exist, so it is safe on the live (Render) DB.
import 'dotenv/config';
import dns from 'node:dns';
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import ServiceCategory from '../model/serviceCategoryModel.js';

// The 5 categories the app runs at launch are active; the rest show as "Coming soon".
export const CATEGORIES = [
  { name: 'Smartphones', isActive: true },
  { name: 'Laptops', isActive: true },
  { name: 'Tablets', isActive: true },
  { name: 'Desktops', isActive: true },
  { name: 'Printers', isActive: true },
  { name: 'TVs', isActive: false },
  { name: 'Refrigerators', isActive: false },
];

// Upserts every category by its unique name. An existing row is only given an active flag when
// the seed would activate it — a manual deactivation is never overridden by re-running the seed.
export const seedCategoriesDB = async () => {
  let created = 0, activated = 0;
  for (const c of CATEGORIES) {
    const existing = await ServiceCategory.findOne({ name: c.name });
    if (existing) {
      if (c.isActive && existing.isActive !== c.isActive) {
        existing.isActive = true;
        await existing.save();
        activated++;
      }
      continue;
    }
    await ServiceCategory.create({ name: c.name, isActive: c.isActive });
    created++;
  }
  return { created, activated, total: await ServiceCategory.countDocuments() };
};

// CLI entry — only when executed directly (tests import the exported functions instead).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { MONGO_URI } = process.env;
  if (!MONGO_URI) {
    console.error('Set MONGO_URI');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const result = await seedCategoriesDB();
  console.log(`Categories seeded: ${result.created} created, ${result.activated} activated, ${result.total} total.`);
  await mongoose.disconnect();
}