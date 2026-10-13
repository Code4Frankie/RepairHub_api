// Self-service password reset (the /forgot-password screen in the app).
import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe('Self-service password reset', () => {
  test('forgot-password issues a one-time token; reset-password swaps the password; the token dies', async () => {
    await h.registerUser('customer', { email: 'reset-me@example.com' });

    const f = await api().post('/api/users/forgot-password').send({ email: 'reset-me@example.com' });
    expect(f.status).toBe(200);
    expect(f.body.data.sent).toBe(true);
    const token = f.body.data.resetToken;
    expect(token).toBeDefined();

    // The old password stops working immediately after the reset.
    expect((await api().post('/api/users/reset-password').send({ token, newPassword: 'brand-new-pass1' })).status).toBe(200);
    expect((await api().post('/api/users/login').send({ email: 'reset-me@example.com', password: 'password123' })).status).toBe(401);
    expect((await api().post('/api/users/login').send({ email: 'reset-me@example.com', password: 'brand-new-pass1' })).status).toBe(200);

    // A token can only be redeemed once.
    expect((await api().post('/api/users/reset-password').send({ token, newPassword: 'another-pass1' })).status).toBe(401);
  });

  test('an unknown email gets a neutral response and never reveals a token', async () => {
    const r = await api().post('/api/users/forgot-password').send({ email: 'nobody@example.com' });
    expect(r.status).toBe(200);
    expect(r.body.data.sent).toBe(true);
    expect(r.body.data.resetToken).toBeUndefined();
  });

  test('validation: bad email is rejected, short new password is rejected', async () => {
    expect((await api().post('/api/users/forgot-password').send({ email: 'not-an-email' })).status).toBe(400);
    expect((await api().post('/api/users/reset-password').send({ token: 'x'.repeat(32), newPassword: 'short' })).status).toBe(400);
  });
});