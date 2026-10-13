import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-001b — sign-up verification (confirm an email address OR a phone number, then log in)
describe('Sign-up verification (email or phone)', () => {
  const register = (over = {}) => api().post('/api/users/register').send({ fullName: 'Ada Obi', email: 'ada@example.com', phone: '08031234567', password: 'password123', role: 'customer', ...over });
  const send = (channel, email = 'ada@example.com') => api().post('/api/users/verify/send').send({ email, channel });
  const confirm = (code, email = 'ada@example.com') => api().post('/api/users/verify/confirm').send({ email, code });
  const login = (email = 'ada@example.com') => api().post('/api/users/login').send({ email, password: 'password123' });

  test('a fresh account is unverified and cannot log in', async () => {
    await register();
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.errors.verificationRequired).toBe(true);
  });

  test('an email code activates the account, and a wrong code is refused', async () => {
    await register();
    const sent = await send('email');
    expect(sent.status).toBe(200);
    expect(sent.body.data.channel).toBe('email');
    expect(sent.body.data.code).toMatch(/^\d{6}$/);
    expect((await confirm('000000')).status).toBe(401);
    expect((await confirm(sent.body.data.code)).body.data.verified).toBe(true);
    expect((await login()).status).toBe(200);
  });

  test('the person can choose the phone channel', async () => {
    await register();
    const sent = await send('phone');
    expect(sent.body.data.channel).toBe('phone');
    expect(sent.body.data.destination).toBe('08031234567');
    expect((await confirm(sent.body.data.code)).body.data.verified).toBe(true);
  });

  test('sending again replaces the previous code', async () => {
    await register();
    const first = await send('email');
    const second = await send('phone');
    expect((await confirm(first.body.data.code)).status).toBe(401);
    expect((await confirm(second.body.data.code)).status).toBe(200);
  });

  test('verify/send is neutral for unknown emails and rejects a bad channel', async () => {
    const unknown = await send('email', 'ghost@example.com');
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.code).toBeUndefined();
    expect((await send('carrier-pigeon')).status).toBe(400);
    expect((await confirm('12345')).status).toBe(400);
  });

  test('an already-verified account reports verified instead of a fresh code', async () => {
    await register();
    const sent = await send('email');
    await confirm(sent.body.data.code);
    const again = await send('email');
    expect(again.body.data.verified).toBe(true);
    expect(again.body.data.code).toBeUndefined();
  });
});
