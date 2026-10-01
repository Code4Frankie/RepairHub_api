// Central place for runtime configuration. Values are read lazily (at call time) so tests can
// tweak process.env, and validateEnv() is called once at boot to fail fast on a bad deploy.

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },
  get isProd() {
    return this.nodeEnv === 'production';
  },
  // Platform commission taken from every completed job (0.10 = 10%).
  get commissionRate() {
    return num(process.env.COMMISSION_RATE, 0.1);
  },
  get defaultWarrantyDays() {
    return num(process.env.DEFAULT_WARRANTY_DAYS, 30);
  },
  // Escrow is auto-released to the technician if the customer neither confirms nor
  // disputes within this many hours after the technician marks the job complete.
  get autoReleaseHours() {
    return num(process.env.AUTO_RELEASE_HOURS, 72);
  },
  get minWithdrawal() {
    return num(process.env.MIN_WITHDRAWAL, 1000);
  },
  get paystack() {
    return {
      secretKey: process.env.PAYSTACK_SECRET_KEY || '',
      mock: process.env.PAYSTACK_MOCK === 'true',
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || undefined,
    };
  },
};

export const validateEnv = () => {
  const problems = [];
  if (!process.env.MONGO_URI) problems.push('MONGO_URI is required');
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is required');
  if (config.isProd) {
    if ((process.env.JWT_SECRET || '').length < 32) problems.push('JWT_SECRET must be >= 32 chars in production');
    if (config.paystack.mock) problems.push('PAYSTACK_MOCK must not be true in production');
    if (!config.paystack.secretKey) problems.push('PAYSTACK_SECRET_KEY is required in production');
    for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLIENT_URL']) {
      if (!process.env[k]) problems.push(`${k} is required in production`);
    }
  }
  const rate = config.commissionRate;
  if (rate < 0 || rate >= 1) problems.push('COMMISSION_RATE must be between 0 and 1');
  if (problems.length) throw new Error(`Invalid environment:\n - ${problems.join('\n - ')}`);
};
