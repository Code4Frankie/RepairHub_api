import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import * as h from './helpers.js';
const { api, auth } = h;
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// UAT-003 — quotations & comparison (FR-8, FR-9)
const setup = async () => {
    const admin = await h.createAdmin();
    const customer = await h.registerUser('customer');
    const cat = await h.createCategory(admin);
    const rr = await h.createRepairRequest(customer, cat._id);
    const mkTech = async () => { const t = await h.registerUser('technician'); await h.verifyTechnician(admin, t); return t; };
    return { admin, customer, cat, rr, mkTech };
};

describe('UAT-003 — Quotations', () => {
    test('a verified technician quotes; the request flips to "quoted"; the customer is notified', async () => {
        const { customer, rr, mkTech } = await setup();
        const t = await mkTech();
        const res = await h.submitQuotation(t, rr._id, { laborCost: 10000, partsCost: 5000, price: undefined });
        expect(res.status).toBe(201);
        expect(res.body.data.price).toBe(15000);
        const got = await api().get(`/api/repair-requests/${rr._id}`).set(auth(customer));
        expect(got.body.data.status).toBe('quoted');
        const n = await api().get('/api/notifications').set(auth(customer));
        expect(n.body.data.some((x) => x.type === 'quotation')).toBe(true);
    });

    test('inconsistent price vs labor+parts is rejected; a customer cannot quote', async () => {
        const { customer, rr, mkTech } = await setup();
        const t = await mkTech();
        expect((await h.submitQuotation(t, rr._id, { laborCost: 1000, partsCost: 1000, price: 9999 })).status).toBe(400);
        expect((await h.submitQuotation(customer, rr._id)).status).toBe(403);
    });

    test('a technician can only leave one quotation per request', async () => {
        const { rr, mkTech } = await setup();
        const t = await mkTech();
        expect((await h.submitQuotation(t, rr._id)).status).toBe(201);
        expect((await h.submitQuotation(t, rr._id)).status).toBe(409);
    });

    test('comparison view sorts, flags best value, and is private to the request owner', async () => {
        const { customer, rr, mkTech } = await setup();
        const [a, b] = [await mkTech(), await mkTech()];
        await h.submitQuotation(a, rr._id, { price: 22000, estimatedDays: 1 });
        await h.submitQuotation(b, rr._id, { price: 15000, estimatedDays: 4 });
        const byPrice = await api().get(`/api/quotations/repair-request/${rr._id}?sort=price`).set(auth(customer));
        expect(byPrice.body.data.map((q) => q.price)).toEqual([15000, 22000]);
        const byEta = await api().get(`/api/quotations/repair-request/${rr._id}?sort=eta`).set(auth(customer));
        expect(byEta.body.data[0].estimatedDays).toBe(1);
        expect(byPrice.body.data.filter((q) => q.bestValue).length).toBe(1);
        const other = await h.registerUser('customer');
        expect((await api().get(`/api/quotations/repair-request/${rr._id}`).set(auth(other))).status).toBe(403);
        expect((await api().get(`/api/quotations/repair-request/${rr._id}`).set(auth(a))).status).toBe(403);
    });

    test('only the request owner can accept; accepting rejects the rest; double-accept is blocked', async () => {
        const { customer, rr, mkTech } = await setup();
        const [a, b] = [await mkTech(), await mkTech()];
        const qa = (await h.submitQuotation(a, rr._id)).body.data;
        const qb = (await h.submitQuotation(b, rr._id, { price: 18000 })).body.data;
        const stranger = await h.registerUser('customer');
        expect((await api().patch(`/api/quotations/${qa._id}/accept`).set(auth(stranger))).status).toBe(403);
        expect((await api().patch(`/api/quotations/${qa._id}/accept`).set(auth(customer))).status).toBe(200);
        expect((await api().patch(`/api/quotations/${qb._id}/accept`).set(auth(customer))).status).toBe(409);
        const list = await api().get(`/api/quotations/repair-request/${rr._id}`).set(auth(customer));
        expect(list.body.data.length).toBe(1); // the rejected one is hidden
    });

    test('a provider can withdraw a pending quotation but not someone else\'s', async () => {
        const { rr, mkTech } = await setup();
        const [a, b] = [await mkTech(), await mkTech()];
        const qa = (await h.submitQuotation(a, rr._id)).body.data;
        expect((await api().patch(`/api/quotations/${qa._id}/withdraw`).set(auth(b))).status).toBe(404);
        expect((await api().patch(`/api/quotations/${qa._id}/withdraw`).set(auth(a))).body.data.status).toBe('withdrawn');
    });

    test('a service center quotes through a team member; the job pays the center', async () => {
        const { admin, customer, rr } = await setup();
        const center = await h.registerUser('service_center');
        await h.verifyCenter(admin, center);
        const cp = await h.getCenterProfile(center.user._id);
        const member = await h.registerUser('technician', { email: 'member@example.com' });
        const mp = await h.getTechnicianProfile(member.user._id);
        const outsider = await h.registerUser('technician');
        const op = await h.getTechnicianProfile(outsider.user._id);

        expect((await h.submitQuotation(center, rr._id)).status).toBe(400); // must name a technician
        expect((await h.submitQuotation(center, rr._id, { technicianId: String(mp._id) })).status).toBe(403); // not on the team yet
        await api().post(`/api/service-centers/${cp._id}/team`).set(auth(center)).send({ email: 'member@example.com' });
        expect((await h.submitQuotation(center, rr._id, { technicianId: String(op._id) })).status).toBe(403);
        const q = await h.submitQuotation(center, rr._id, { technicianId: String(mp._id) });
        expect(q.status).toBe(201);

        const { appointment } = await h.acceptAndBook(customer, q.body.data._id);
        const job = await h.getJob(customer, appointment.repairJobId);
        expect(String(job.payeeUserId)).toBe(String(center.user._id));
        expect(String(job.technicianUserId)).toBe(String(member.user._id));
        // the assigned team member (not just the center) can work the job
        await h.payWithPaystack(customer, job._id, job.price);
        expect((await h.setStatus(member, job._id, 'in_progress')).status).toBe(200);
    });
});
