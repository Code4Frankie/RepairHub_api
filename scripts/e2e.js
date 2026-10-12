// End-to-end smoke test for the whole API.
//
// Boots the real Express app against an in-memory MongoDB (seeded categories + an
// admin), then exercises every feature over HTTP using node's built-in fetch.
// No external services, no live database, no jest — just:
//
//   npm run e2e
//
// Exits non-zero if any assertion fails, so it can gate CI / deploys.
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Test-style configuration, set BEFORE the app modules are imported.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_test_jwt_secret_1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_repairhub';
process.env.PAYSTACK_MOCK = 'true';
process.env.COMMISSION_RATE = '0.1';
process.env.AUTO_RELEASE_HOURS = '72';
process.env.MIN_WITHDRAWAL = '1000';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();

const { default: mongoose } = await import('mongoose');
const { default: app } = await import('../app.js');
const { default: User } = await import('../model/userModel.js');
const { default: TechnicianProfile } = await import('../model/technicianProfileModel.js');
const { default: ServiceCenterProfile } = await import('../model/serviceCenterModel.js');
const { default: RepairRequest } = await import('../model/repairRequestModel.js');
const { generateToken } = await import('../utils/generateToken.js');
const bcrypt = (await import('bcryptjs')).default;
const { seedCategoriesDB } = await import('./seedCategories.js');

await mongoose.connect(mongo.getUri());
const seeded = await seedCategoriesDB();

const adminUser = await User.create({
  fullName: 'RepairHub Admin',
  email: 'admin@e2e.test',
  passwordHash: await bcrypt.hash('adminpass123', 4),
  role: 'admin',
});
const ADMIN_TOKEN = generateToken({ id: adminUser._id, role: 'admin' });

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

// ---------------------------------------------------------------- tiny harness
let pass = 0;
let fail = 0;
const failures = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL  ${label}${extra ? `  (${extra})` : ''}`); }
};

const call = async (method, path, { token, body, form, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const init = { method, headers: h };
  if (body) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  else if (form) { init.body = form; }
  const res = await fetch(base + path, init);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

// ---------------------------------------------------------------- infra
console.log('\n[infra]');
{
  const health = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  check('GET /health is ok', health.status === 200);
  const docs = await fetch(`http://127.0.0.1:${server.address().port}/api-docs`);
  const specRes = await fetch(`http://127.0.0.1:${server.address().port}/api-docs.json`);
  const spec = await specRes.json().catch(() => null);
  check('GET /api-docs serves the UI', docs.status === 200);
  check('GET /api-docs.json builds (swagger rows valid)', specRes.status === 200 && spec && spec.paths && Object.keys(spec.paths).length > 10, `status=${specRes.status}`);
  const cats = await call('GET', '/service-categories');
  const names = (cats.json?.data || []).map((c) => c.name);
  check('seed ran: categories listed over HTTP', cats.status === 200 && names.length >= 5, `got ${names.length}`);
  check('seed includes Smartphones', names.includes('Smartphones'));
  check('seed category Smartphones is active', (cats.json?.data || []).find((c) => c.name === 'Smartphones')?.isActive === true);
}

// ---------------------------------------------------------------- password reset
console.log('\n[sign-up verification & password reset]');
let cust, tech, center, techProfileId, centerId;
{
  // Register creates an UNVERIFIED account and no session: the person confirms an email address OR a
  // phone number with a 6-digit code, then logs in.
  const reg = (role, extra = {}) => call('POST', '/users/register', { body: { fullName: `E2E ${role}`, email: `${role}@e2e.test`, phone: '08031234567', password: 'password123', role, ...extra } });
  const cr = await reg('customer'), tr = await reg('technician'), sr = await reg('service_center', { businessName: 'E2E Gadget Hub' });
  check('register customer / technician / service_center all succeed', [cr.status, tr.status, sr.status].every((s) => s === 201), `cust=${cr.status} tech=${tr.status} center=${sr.status}`);
  check('register does not hand out a session token', !cr.json?.data?.token && !tr.json?.data?.token && !sr.json?.data?.token);
  check('new accounts start unverified', cr.json?.data?.user?.isVerified === false && tr.json?.data?.user?.isVerified === false);
  if (cr.status !== 201 || tr.status !== 201 || sr.status !== 201) {
    console.log(`\nABORT: registration failed (customer=${cr.status}, technician=${tr.status}, center=${sr.status}) :: ${JSON.stringify([cr.json, tr.json, sr.json]).slice(0, 400)}`);
    server.close(); await mongoose.disconnect(); await mongo.stop();
    process.exit(2);
  }

  const blocked = await call('POST', '/users/login', { body: { email: 'customer@e2e.test', password: 'password123' } });
  check('login is refused until the account is verified (403 + flag)', blocked.status === 403 && blocked.json?.errors?.verificationRequired === true, `status=${blocked.status}`);

  // The person chooses the channel: email for the customer, phone for the technician.
  const sendCust = await call('POST', '/users/verify/send', { body: { email: 'customer@e2e.test', channel: 'email' } });
  check('verify/send issues a 6-digit email code', sendCust.status === 200 && sendCust.json?.data?.sent === true && /^\d{6}$/.test(sendCust.json?.data?.code || ''));
  const sendTech = await call('POST', '/users/verify/send', { body: { email: 'technician@e2e.test', channel: 'phone' } });
  check('verify/send issues a phone code on request', sendTech.status === 200 && sendTech.json?.data?.channel === 'phone' && /^\d{6}$/.test(sendTech.json?.data?.code || ''));
  const sendCenter = await call('POST', '/users/verify/send', { body: { email: 'service_center@e2e.test', channel: 'email' } });

  const ghostSend = await call('POST', '/users/verify/send', { body: { email: 'ghost@e2e.test', channel: 'email' } });
  check('verify/send is neutral for unknown emails (no code leaked)', ghostSend.status === 200 && ghostSend.json?.data?.sent === true && !ghostSend.json?.data?.code);
  const badChannel = await call('POST', '/users/verify/send', { body: { email: 'customer@e2e.test', channel: 'carrier-pigeon' } });
  check('verify/send rejects an unknown channel (400)', badChannel.status === 400);

  const wrong = await call('POST', '/users/verify/confirm', { body: { email: 'customer@e2e.test', code: '000000' } });
  check('verify/confirm rejects a wrong code (401)', wrong.status === 401, `status=${wrong.status}`);
  const malformed = await call('POST', '/users/verify/confirm', { body: { email: 'customer@e2e.test', code: 'abc' } });
  check('verify/confirm rejects a malformed code (400)', malformed.status === 400);

  const okCust = await call('POST', '/users/verify/confirm', { body: { email: 'customer@e2e.test', code: sendCust.json?.data?.code } });
  check('verify/confirm activates the customer', okCust.status === 200 && okCust.json?.data?.verified === true);
  await call('POST', '/users/verify/confirm', { body: { email: 'technician@e2e.test', code: sendTech.json?.data?.code } });
  await call('POST', '/users/verify/confirm', { body: { email: 'service_center@e2e.test', code: sendCenter.json?.data?.code } });

  const reLogin = await call('POST', '/users/login', { body: { email: 'customer@e2e.test', password: 'password123' } });
  check('verified customer can log in and gets a token', reLogin.status === 200 && !!reLogin.json?.data?.token);
  const techLogin = await call('POST', '/users/login', { body: { email: 'technician@e2e.test', password: 'password123' } });
  const centerLogin = await call('POST', '/users/login', { body: { email: 'service_center@e2e.test', password: 'password123' } });
  check('verified technician & center can log in', !!techLogin.json?.data?.token && !!centerLogin.json?.data?.token);
  cust = reLogin.json?.data; tech = techLogin.json?.data; center = centerLogin.json?.data;
  if (!cust?.token || !tech?.token || !center?.token) {
    console.log('\nABORT: verification login failed');
    server.close(); await mongoose.disconnect(); await mongo.stop();
    process.exit(2);
  }
}
console.log('\n[password reset]');
{
  const forgot = await call('POST', '/users/forgot-password', { body: { email: 'customer@e2e.test' } });
  check('forgot-password issues a token for a known email', forgot.status === 200 && forgot.json?.data?.sent === true && !!forgot.json?.data?.resetToken);
  const resetTok = forgot.json?.data?.resetToken;

  const unknown = await call('POST', '/users/forgot-password', { body: { email: 'ghost@e2e.test' } });
  check('forgot-password is neutral for unknown emails (no token leaked)', unknown.status === 200 && unknown.json?.data?.sent === true && !unknown.json?.data?.resetToken);

  const badEmail = await call('POST', '/users/forgot-password', { body: { email: 'not-an-email' } });
  check('forgot-password rejects a malformed email', badEmail.status === 400);

  const reset = await call('POST', '/users/reset-password', { body: { token: resetTok, newPassword: 'brand-new-pass1' } });
  check('reset-password swaps the password', reset.status === 200);

  const oldLogin = await call('POST', '/users/login', { body: { email: 'customer@e2e.test', password: 'password123' } });
  check('old password stops working', oldLogin.status === 401);
  const newLogin = await call('POST', '/users/login', { body: { email: 'customer@e2e.test', password: 'brand-new-pass1' } });
  check('new password logs in and mints a fresh token', newLogin.status === 200 && !!newLogin.json?.data?.token);
  cust = newLogin.json.data;

  const reuse = await call('POST', '/users/reset-password', { body: { token: resetTok, newPassword: 'yet-another1' } });
  check('reset token dies after one use', reuse.status === 401);

  const short = await call('POST', '/users/reset-password', { body: { token: 'x'.repeat(64), newPassword: 'short' } });
  check('reset-password rejects a weak new password', short.status === 400);
}

// ---------------------------------------------------------------- structured requests
console.log('\n[repair requests: preferred date / time / service mode]');
let requestId;
{
  const baseForm = async () => {
    const fd = new FormData();
    fd.append('serviceCategoryId', (await call('GET', '/service-categories')).json.data[0]._id);
    fd.append('itemType', 'Laptop');
    fd.append('problemDescription', 'Keyboard keys are stuck after a water spill and two keys are dead');
    fd.append('location', JSON.stringify({ lng: 3.3792, lat: 6.5244 }));
    return fd;
  };
  const good = await baseForm();
  good.append('preferredDate', 'Mon 20 Oct');
  good.append('preferredTime', '2:00 pm');
  good.append('serviceMode', 'home');
  const rr = await call('POST', '/repair-requests', { token: cust.token, form: good });
  check('request created with structured preferences', rr.status === 201);
  check('preferredDate / preferredTime / serviceMode persisted', rr.json?.data?.preferredDate === 'Mon 20 Oct' && rr.json?.data?.preferredTime === '2:00 pm' && rr.json?.data?.serviceMode === 'home');
  requestId = rr.json?.data?._id;

  const bad = await baseForm();
  bad.append('serviceMode', 'castle');
  const rrBad = await call('POST', '/repair-requests', { token: cust.token, form: bad });
  check('invalid serviceMode is rejected (400)', rrBad.status === 400);
}

// ---------------------------------------------------------------- technician flow
console.log('\n[technician: verification, quote, book, pay, on-the-way, complete]');
let techProfileTokenJob;
{
  const me = await call('GET', '/technician-profiles/me', { token: tech.token });
  techProfileId = me.json?.data?._id;
  check('technician sees their own profile', me.status === 200 && !!techProfileId);
  await TechnicianProfile.updateOne({ _id: techProfileId }, { verificationDocs: ['https://example.com/id-card.jpg'] });
  const verify = await call('PATCH', `/technician-profiles/${techProfileId}/verify`, { token: ADMIN_TOKEN, body: { decision: 'approve' } });
  check('admin approves the technician', verify.status === 200);

  const quote = await call('POST', '/quotations', {
    token: tech.token,
    body: { repairRequestId: requestId, price: 20000, estimatedDays: 2, warrantyDays: 30 },
  });
  check('technician quotes the request', quote.status === 201);
  const quotationId = quote.json?.data?._id;

  const accept = await call('PATCH', `/quotations/${quotationId}/accept`, { token: cust.token });
  check('customer accepts the quotation', accept.status === 200);

  const appt = await call('POST', '/appointments', {
    token: cust.token,
    body: { quotationId, scheduledAt: new Date(Date.now() + 86400000).toISOString(), serviceMode: 'dropoff' },
  });
  check('booking an appointment creates the job', appt.status === 201 && !!appt.json?.data?.repairJobId);
  const jobId = appt.json?.data?.repairJobId;

  const init = await call('POST', '/transactions/pay', { token: cust.token, body: { repairJobId: jobId, method: 'paystack' } });
  check('paystack payment initialised', [200, 201].includes(init.status) && !!init.json?.data?.reference);
  let job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  if (job.json?.data?.payment?.status !== 'held') {
    // Simulate Paystack's charge.success webhook — the raw bytes must hit the server untouched,
    // because the HMAC is computed over the exact body received.
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: init.json?.data?.reference, amount: 2000000, status: 'success' } });
    const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    await call('POST', '/transactions/webhook/paystack', { form: raw, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig } });
    job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  }
  check('payment lands in escrow', job.json?.data?.payment?.status === 'held', `payment=${job.json?.data?.payment?.status}`);

  const illegal = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: 'completed' } });
  check('skipping straight to completed is refused (409)', illegal.status === 409);

  const otw = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: 'on_the_way', note: 'Leaving the workshop now' } });
  check('technician signals on_the_way', otw.status === 200);
  job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  const otwHist = job.json?.data?.statusHistory || [];
  check('job is now on_the_way (a real status)', job.json?.data?.status === 'on_the_way');
  check('on_the_way advances progress (5)', job.json?.data?.progress === 5, `progress=${job.json?.data?.progress}`);
  check('status note is recorded', otwHist.at(-1)?.note === 'Leaving the workshop now');

  const back = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: 'on_the_way' } });
  check('going back to on_the_way from on_the_way is refused (409)', back.status === 409);

  const inProgress = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: 'in_progress' } });
  const done = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: 'completed', note: 'Screen replaced and tested' } });
  check('in_progress then completed both accepted', inProgress.status === 200 && done.status === 200);

  // To give the customer something to dispute, that job must be paid but unconfirmed —
  // customer confirms nothing on purpose. Save the ids for the dispute sections.
  techProfileTokenJob = { jobId, token: tech.token };
}

// ---------------------------------------------------------------- reviews + replies
console.log('\n[reviews & technician replies]');
let reviewId;
{
  const rev = await call('POST', '/reviews', {
    token: cust.token,
    body: { repairJobId: techProfileTokenJob.jobId, rating: 5, tags: ['On time', 'Professional'], comment: 'Fixed fast' },
  });
  check('customer reviews the completed job', rev.status === 201);
  reviewId = rev.json?.data?._id;

  const reply = await call('POST', `/reviews/${reviewId}/reply`, { token: tech.token, body: { reply: 'Thank you, glad it helped!' } });
  check('technician can reply once', reply.status === 200 && reply.json?.data?.reply === 'Thank you, glad it helped!' && !!reply.json?.data?.repliedAt);

  // A registered outsider: register → verify → log in, then try to reply.
  await call('POST', '/users/register', { body: { fullName: 'E2E Stranger', email: 'stranger@e2e.test', phone: '08031234567', password: 'password123', role: 'customer' } });
  const strangerSend = await call('POST', '/users/verify/send', { body: { email: 'stranger@e2e.test', channel: 'email' } });
  await call('POST', '/users/verify/confirm', { body: { email: 'stranger@e2e.test', code: strangerSend.json?.data?.code } });
  const stranger = (await call('POST', '/users/login', { body: { email: 'stranger@e2e.test', password: 'password123' } })).json.data;
  const strangerReply = await call('POST', `/reviews/${reviewId}/reply`, { token: stranger.token, body: { reply: 'nope' } });
  check('outsiders cannot reply (403)', strangerReply.status === 403);

  const list = await call('GET', `/reviews/technician/${techProfileId}`);
  check('review list shows the reply', list.status === 200 && list.json?.data?.[0]?.reply === 'Thank you, glad it helped!');
}

// ---------------------------------------------------------------- dispute: refund
console.log('\n[disputes: refund cancels the repair request]');
{
  const d = await call('POST', '/disputes', {
    token: cust.token,
    body: { repairJobId: techProfileTokenJob.jobId, reason: 'The laptop still does not boot after the repair' },
  });
  check('customer opens a dispute (201)', d.status === 201);
  const disputeId = d.json?.data?._id;

  const jobNow = await call('GET', `/repair-jobs/${techProfileTokenJob.jobId}`, { token: cust.token });
  check('job freezes as disputed', jobNow.json?.data?.status === 'disputed');

  const notAdmin = await call('PATCH', `/disputes/${disputeId}/resolve`, { token: cust.token, body: { decision: 'refund' } });
  check('only admins can resolve (403)', notAdmin.status === 403);

  const resolve = await call('PATCH', `/disputes/${disputeId}/resolve`, { token: ADMIN_TOKEN, body: { decision: 'refund', note: 'Not fixed' } });
  check('admin rules refund', resolve.status === 200);

  const after = await call('GET', `/repair-jobs/${techProfileTokenJob.jobId}`, { token: cust.token });
  check('refunded job is cancelled, payment refunded', after.json?.data?.status === 'cancelled' && after.json?.data?.payment?.status === 'refunded');

  const request = await RepairRequest.findById(requestId);
  check('repair request no longer sits in_progress after refund', request?.status === 'cancelled', `request=${request?.status}`);

  const techWallet = await call('GET', '/wallets/me', { token: tech.token });
  check('technician gets nothing on a refund', (techWallet.json?.data?.balance || 0) === 0);

  const custWallet = await call('GET', '/wallets/me', { token: cust.token });
  check('customer wallet gets the full 20000 back', (custWallet.json?.data?.balance || 0) === 20000, `balance=${custWallet.json?.data?.balance}`);

  const notifications = await call('GET', '/notifications', { token: tech.token });
  check('technician is notified about the dispute', notifications.status === 200 && (notifications.json?.data || []).some((n) => n.type === 'dispute'));
}

// ---------------------------------------------------------------- dispute: release
console.log('\n[disputes: release pays the technician]');
{
  const fd = new FormData();
  fd.append('serviceCategoryId', (await call('GET', '/service-categories')).json.data[1]._id);
  fd.append('itemType', 'Phone');
  fd.append('problemDescription', 'Broken screen after a drop, digits unreadable');
  fd.append('location', JSON.stringify({ lng: 3.3792, lat: 6.5244 }));
  const rr = await call('POST', '/repair-requests', { token: cust.token, form: fd });
  const quote = await call('POST', '/quotations', { token: tech.token, body: { repairRequestId: rr.json?.data?._id, price: 20000, estimatedDays: 2, warrantyDays: 30 } });
  await call('PATCH', `/quotations/${quote.json?.data?._id}/accept`, { token: cust.token });
  const appt = await call('POST', '/appointments', { token: cust.token, body: { quotationId: quote.json?.data?._id, scheduledAt: new Date(Date.now() + 86400000).toISOString(), serviceMode: 'dropoff' } });
  const jobId = appt.json?.data?.repairJobId;
  const pay = await call('POST', '/transactions/pay', { token: cust.token, body: { repairJobId: jobId, method: 'paystack' } });
  let job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  if (job.json?.data?.payment?.status !== 'held') {
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: pay.json?.data?.reference, amount: 2000000, status: 'success' } });
    const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    await call('POST', '/transactions/webhook/paystack', { form: raw, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig } });
    job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  }
  for (const s of ['on_the_way', 'in_progress', 'completed']) {
    await call('PATCH', `/repair-jobs/${jobId}/status`, { token: tech.token, body: { status: s } });
  }
  const d = await call('POST', '/disputes', { token: cust.token, body: { repairJobId: jobId, reason: 'Screen has developed new dead pixels' } });
  const resolve = await call('PATCH', `/disputes/${d.json?.data?._id}/resolve`, { token: ADMIN_TOKEN, body: { decision: 'release' } });
  check('admin rules release', resolve.status === 200);
  job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  check('released job completes', job.json?.data?.status === 'completed');
  const releaseRequest = await RepairRequest.findById(rr.json?.data?._id);
  const techWallet = await call('GET', '/wallets/me', { token: tech.token });
  check('technician paid 20000 less 10% commission', (techWallet.json?.data?.balance || 0) === 18000, `balance=${techWallet.json?.data?.balance}`);
  check('released repair request finishes as completed', releaseRequest?.status === 'completed');
}

// ---------------------------------------------------------------- service center
console.log('\n[service center: verify, team, quote, operate]');
{
  const me = await call('GET', '/service-centers/me', { token: center.token });
  centerId = me.json?.data?._id;
  check('center sees its own profile', me.status === 200 && !!centerId && me.json?.data?.businessName === 'E2E Gadget Hub');
  await ServiceCenterProfile.updateOne({ _id: centerId }, { verificationDocs: ['https://example.com/cac.pdf'] });
  const verify = await call('PATCH', `/service-centers/${centerId}/verify`, { token: ADMIN_TOKEN, body: { decision: 'approve' } });
  check('admin approves the center', verify.status === 200);

  const add = await call('POST', `/service-centers/${centerId}/team`, { token: center.token, body: { email: 'technician@e2e.test' } });
  check('center adds a technician by email', [200, 201].includes(add.status));
  const team = await call('GET', `/service-centers/${centerId}/team`, { token: center.token });
  check('team list shows the technician', team.status === 200 && (team.json?.data || []).some((m) => String(m._id) === String(techProfileId)));

  const fd = new FormData();
  fd.append('serviceCategoryId', (await call('GET', '/service-categories')).json.data[2]._id);
  fd.append('itemType', 'TV');
  fd.append('problemDescription', 'No picture, sound only — suspected backlight failure');
  fd.append('location', JSON.stringify({ lng: 3.3792, lat: 6.5244 }));
  const rr = await call('POST', '/repair-requests', { token: cust.token, form: fd });
  const quote = await call('POST', '/quotations', {
    token: center.token,
    body: { repairRequestId: rr.json?.data?._id, technicianId: techProfileId, price: 25000, estimatedDays: 3, warrantyDays: 60 },
  });
  check('center quotes with a team technician', quote.status === 201);
  await call('PATCH', `/quotations/${quote.json?.data?._id}/accept`, { token: cust.token });
  const appt = await call('POST', '/appointments', { token: cust.token, body: { quotationId: quote.json?.data?._id, scheduledAt: new Date(Date.now() + 86400000).toISOString(), serviceMode: 'dropoff' } });
  const jobId = appt.json?.data?.repairJobId;
  check('center booking creates a job', !!jobId);

  const otw = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: center.token, body: { status: 'on_the_way' } });
  check('center can drive the job to on_the_way', otw.status === 200);

  const pay = await call('POST', '/transactions/pay', { token: cust.token, body: { repairJobId: jobId, method: 'paystack' } });
  let job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  if (job.json?.data?.payment?.status !== 'held') {
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: pay.json?.data?.reference, amount: 2500000, status: 'success' } });
    const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    await call('POST', '/transactions/webhook/paystack', { form: raw, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig } });
    job = await call('GET', `/repair-jobs/${jobId}`, { token: cust.token });
  }
  check('center payment lands in escrow', job.json?.data?.payment?.status === 'held', `payment=${job.json?.data?.payment?.status}`);
  const ip = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: center.token, body: { status: 'in_progress' } });
  check('center job moves to in_progress after payment', ip.status === 200);
  const done = await call('PATCH', `/repair-jobs/${jobId}/status`, { token: center.token, body: { status: 'completed', note: 'Backlight replaced' } });
  check('center job completes', done.status === 200);
  const confirm = await call('POST', `/repair-jobs/${jobId}/confirm`, { token: cust.token });
  check('customer confirms the center job', [200, 201].includes(confirm.status));
  const centerWallet = await call('GET', '/wallets/me', { token: center.token });
  check('center wallet credited 25000 less 10%', (centerWallet.json?.data?.balance || 0) === 22500, `balance=${centerWallet.json?.data?.balance}`);
  const centerJobs = await call('GET', '/repair-jobs', { token: center.token });
  check('center lists its jobs', centerJobs.status === 200 && Array.isArray(centerJobs.json?.data));
}

// ---------------------------------------------------------------- wrap up
server.close();
await mongoose.disconnect();
await mongo.stop();

console.log(`\n========================================`);
console.log(`E2E complete: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('Failed checks:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`(seed: ${seeded.created} categories created, ${seeded.total} total)`);