
import dns from 'node:dns';
import mongoose from 'mongoose';

// Optional: override DNS servers (e.g. DNS_SERVERS=8.8.8.8,1.1.1.1) when the
// default resolver refuses SRV lookups for mongodb+srv:// URIs.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};