import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-007 — reviews & warranty (FR-17, FR-19, FR-20)
describe('UAT-007 — Reviews & warranty', () => {
    test('a customer reviews a completed job; the technician average updates', async () => {
        const { customer, technician, technicianProfile, job } = await h.buildCompletedJob();
        const res = await api().post('/api/reviews').set(auth(customer)).send({ repairJobId: job._id, rating: 5, tags: ['On time'], comment: 'Excellent' });
        expect(res.status).toBe(201);
        const profile = await api().get(`/api/technician-profiles/${technicianProfile._id}`);
        expect(profile.body.data.ratingAvg).toBe(5);
        expect(profile.body.data.ratingCount).toBe(1);
        expect(profile.body.data.jobsCompleted).toBe(1);
        const list = await api().get(`/api/reviews/technician/${technicianProfile._id}`);
        expect(list.body.data.length).toBe(1);
        const n = await api().get('/api/notifications').set(auth(technician));
        expect(n.body.data.some((x) => x.type === 'review')).toBe(true);
    });

    test('one review per job; only the job\'s customer; only after completion; tech/customer come from the job', async () => {
        const paid = await h.buildPaidJob();
        expect((await api().post('/api/reviews').set(auth(paid.customer)).send({ repairJobId: paid.job._id, rating: 4 })).status).toBe(409); // not completed
        const done = await h.buildCompletedJob();
        const stranger = await h.registerUser('customer');
        expect((await api().post('/api/reviews').set(auth(stranger)).send({ repairJobId: done.job._id, rating: 1 })).status).toBe(403);
        expect((await api().post('/api/reviews').set(auth(done.technician)).send({ repairJobId: done.job._id, rating: 5 })).status).toBe(403);
        expect((await api().post('/api/reviews').set(auth(done.customer)).send({ repairJobId: done.job._id, rating: 9 })).status).toBe(400);
        expect((await api().post('/api/reviews').set(auth(done.customer)).send({ repairJobId: done.job._id, rating: 4 })).status).toBe(201);
        expect((await api().post('/api/reviews').set(auth(done.customer)).send({ repairJobId: done.job._id, rating: 5 })).status).toBe(409);
    });

    test('a warranty claim can be filed by the customer within the window, one open claim at a time', async () => {
        const { customer, job } = await h.buildCompletedJob();
        const w = (await api().get(`/api/warranty-records/job/${job._id}`).set(auth(customer))).body.data;
        const claim = await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(customer)).send({ description: 'Screen flickering again' });
        expect(claim.status).toBe(201);
        expect(claim.body.data.claims[0].status).toBe('open');
        expect((await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(customer)).send({ description: 'Another problem' })).status).toBe(409);
    });

    test('expired warranties reject claims; outsiders and the technician cannot file claims', async () => {
        const { customer, technician, job } = await h.buildCompletedJob();
        const w = (await api().get(`/api/warranty-records/job/${job._id}`).set(auth(customer))).body.data;
        const stranger = await h.registerUser('customer');
        expect((await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(stranger)).send({ description: 'not mine at all' })).status).toBe(403);
        expect((await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(technician)).send({ description: 'not the customer' })).status).toBe(403);
        expect((await api().get(`/api/warranty-records/${w._id}`).set(auth(stranger))).status).toBe(403);
        const Warranty = (await import('../model/warrantyRecordModel.js')).default;
        await Warranty.updateOne({ _id: w._id }, { expiresAt: new Date(Date.now() - 1000) });
        expect((await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(customer)).send({ description: 'too late for this' })).status).toBe(400);
    });

    test('the provider can resolve a claim; the customer is told', async () => {
        const { customer, technician, job } = await h.buildCompletedJob();
        const w = (await api().get(`/api/warranty-records/job/${job._id}`).set(auth(customer))).body.data;
        const filed = await api().post(`/api/warranty-records/${w._id}/claims`).set(auth(customer)).send({ description: 'Screen flickering again' });
        const claimId = filed.body.data.claims[0]._id;
        expect((await api().patch(`/api/warranty-records/${w._id}/claims/${claimId}`).set(auth(customer)).send({ status: 'resolved' })).status).toBe(403);
        const res = await api().patch(`/api/warranty-records/${w._id}/claims/${claimId}`).set(auth(technician)).send({ status: 'resolved', resolutionNote: 'Replaced cable' });
        expect(res.body.data.claims[0].status).toBe('resolved');
        expect((await api().patch(`/api/warranty-records/${w._id}/claims/${claimId}`).set(auth(technician)).send({ status: 'rejected' })).status).toBe(409);
    });
});
