import crypto from 'crypto';
import { config } from './env.js';
import { ApiError } from '../utils/ApiError.js';

const BASE = 'https://api.paystack.co';

const call = async (path, options = {}) => {
  const { secretKey } = config.paystack;
  if (!secretKey) throw new ApiError(503, 'Payment gateway is not configured');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw new ApiError(502, json.message || 'Payment gateway error');
  }
  return json.data;
};

// amount is in NAIRA; Paystack wants kobo.
export const initializeTransaction = async ({ email, amount, reference, metadata }) => {
  if (config.paystack.mock) {
    return {
      authorization_url: `https://checkout.paystack.test/${reference}`,
      access_code: `mock_${reference}`,
      reference,
    };
  }
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: Math.round(amount * 100),
      reference,
      metadata,
      callback_url: config.paystack.callbackUrl,
    }),
  });
};

// Server-to-server check used by GET /transactions/verify/:reference (never trust the client).
export const verifyTransaction = async (reference) => {
  if (config.paystack.mock) return { status: 'pending', reference };
  const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: data.status, reference: data.reference, amount: data.amount / 100 };
};

// Paystack signs the RAW request body with HMAC-SHA512 using the secret key.
export const isValidWebhookSignature = (rawBody, signature) => {
  const { secretKey } = config.paystack;
  if (!secretKey || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
