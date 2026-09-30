import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { validateEnv } from './config/env.js';

validateEnv();
const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`RepairHub API running on port ${PORT}`));
};

start();