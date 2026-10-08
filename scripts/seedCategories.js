import 'dotenv/config';
import dns from 'node:dns';
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}
import bcrypt from 'bcryptjs';