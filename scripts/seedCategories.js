// Seeds the launch service categories. Safe to run more than once (it never creates duplicates).
//   npm run seed:categories
// Reads MONGO_URI from .env, or from the environment when running against production.
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';
import ServiceCategory from '../model/serviceCategoryModel.js';

// Optional: some networks cannot resolve Atlas "mongodb+srv" addresses. Set DNS_SERVERS=8.8.8.8,1.1.1.1 to fix.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}

const CATEGORIES = [
  ['Phones', null], ['Screen replacement', 'Phones'], ['Battery replacement', 'Phones'],
  ['Laptops', null], ['Screen & keyboard', 'Laptops'], ['Motherboard & chip-level', 'Laptops'], ['Software & virus removal', 'Laptops'],
  ['Televisions', null], ['Generators', null], ['Air conditioners', null],
  ['Refrigerators & freezers', null], ['Washing machines', null], ['Gaming consoles', null], ['Printers', null],
];

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is not set');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
for (const [name, parentCategory] of CATEGORIES) {
  await ServiceCategory.updateOne({ name }, { $setOnInsert: { name, parentCategory, isActive: true } }, { upsert: true });
}
const active = await ServiceCategory.countDocuments({ isActive: true });
console.log(`Seeded ${CATEGORIES.length} categories. Active categories in this database: ${active}`);
await mongoose.disconnect();