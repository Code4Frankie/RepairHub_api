import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// Reviews are immutable; the technician (or their centre / an admin) can reply once.
describe('Reviews & technician replies', () => {
  test('a customer reviews a completed job and the technician can reply', async () => {
    const { customer, technician, technicianProfile, job } = await h.buildCompletedJob();

    const rev = await api().post('/api/reviews').set(auth(customer))
      .send({ repairJobId: job._id, rating: 5, tags: ['On time', 'Professional'], comment: 'Fixed fast' });
    expect(rev.status).toBe(201);
    const id = rev.body.data._id;

    // The technician replies; the reply shows up in the public review list.
    const reply = await api().post(`/api/reviews/${id}/reply`).set(auth(technician)).send({ reply: 'Thank you, glad it helped!' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.reply).toBe('Thank you, glad it helped!');
    expect(reply.body.data.repliedAt).toBeDefined();
    const list = await api().get(`/api/reviews/technician/${technicianProfile._id}`);
    expect(list.status).toBe(200);
    expect(list.body.data[0].reply).toBe('Thank you, glad it helped!');
  });

  test('no one outside the job can reply — customers cannot reply to their own review', async () => {
    const { customer, job } = await h.buildCompletedJob();
    const rev = await api().post('/api/reviews').set(auth(customer)).send({ repairJobId: job._id, rating: 4 });
    const id = rev.body.data._id;

    const stranger = await h.registerUser('customer');
    expect((await api().post(`/api/reviews/${id}/reply`).set(auth(stranger)).send({ reply: 'nope' })).status).toBe(403);
    expect((await api().post(`/api/reviews/${id}/reply`).set(auth(customer)).send({ reply: 'nope' })).status).toBe(403);

    const admin = await h.createAdmin();
    expect((await api().post(`/api/reviews/${id}/reply`).set(auth(admin)).send({ reply: 'We take this seriously' })).status).toBe(200);
  });

  test('a review cannot be created twice on the same job', async () => {
    const { customer, job } = await h.buildCompletedJob();
    await api().post('/api/reviews').set(auth(customer)).send({ repairJobId: job._id, rating: 5 });
    const again = await api().post('/api/reviews').set(auth(customer)).send({ repairJobId: job._id, rating: 1 });
    expect(again.status).toBe(409);
  });
});