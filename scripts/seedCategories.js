// Seeds the launch service categories (idempotent). npm run seed:categories
import 'dotenv/config';
import mongoose from 'mongoose';
import ServiceCategory from '../model/serviceCategoryModel.js';

const CATEGORIES = [
    ['Phones', null], ['Screen replacement', 'Phones'], ['Battery replacement', 'Phones'],
    ['Laptops', null], ['Screen & keyboard', 'Laptops'], ['Motherboard & chip-level', 'Laptops'], ['Software & virus removal', 'Laptops'],
    ['Televisions', null], ['Generators', null], ['Air conditioners', null],
    ['Refrigerators & freezers', null], ['Washing machines', null], ['Gaming consoles', null], ['Printers', null],
];

if (!process.env.MONGO_URI) { console.error('Set MONGO_URI'); process.exit(1); }
await mongoose.connect(process.env.MONGO_URI);
for (const [name, parentCategory] of CATEGORIES) {
    await ServiceCategory.updateOne({ name }, { $setOnInsert: { name, parentCategory, isActive: true } }, { upsert: true });
}
console.log(`Seeded ${CATEGORIES.length} categories`);
await mongoose.disconnect();
