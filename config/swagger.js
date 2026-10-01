import swaggerUi from 'swagger-ui-express';

// Single source of truth for the API surface: this table generates BOTH the Swagger UI (/api-docs)
// and the Postman collection (npm run docs:generate). Add a row here whenever you add a route.
//
// Body shorthand: { field: 'string!' }  -> '!' = required.  Types: string number integer boolean
// array object date, or an array of allowed values for an enum.

const SCHEMA = (props = {}) => {
  const properties = {};
  const required = [];
  for (const [k, raw] of Object.entries(props)) {
    let v = raw;
    if (typeof v === 'string' && v.endsWith('!')) { required.push(k); v = v.slice(0, -1); }
    if (Array.isArray(v)) properties[k] = { type: 'string', enum: v };
    else if (v === 'date') properties[k] = { type: 'string', format: 'date-time' };
    else if (v === 'array') properties[k] = { type: 'array', items: { type: 'string' } };
    else if (v === 'file') properties[k] = { type: 'array', items: { type: 'string', format: 'binary' } };
    else properties[k] = { type: v };
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
};

const ROLES = { customer: 'customer', tech: 'technician', center: 'service_center', admin: 'admin' };
const PAGE = { page: 'integer', limit: 'integer' };

// [method, path, tag, summary, options]
const R = (method, path, tag, summary, o = {}) => ({ method, path, tag, summary, ...o });

export const routes = [
  // ---- Auth & users
  R('post', '/users/register', 'Users', 'Register (customer | technician | service_center). Admins are seeded, never self-registered', { auth: false, body: { fullName: 'string!', email: 'string!', phone: 'string', password: 'string!', role: ['customer', 'technician', 'service_center'], businessName: 'string' }, example: { fullName: 'Ada Obi', email: 'ada@example.com', phone: '08031234567', password: 'password123', role: 'customer' } }),
  R('post', '/users/login', 'Users', 'Login → JWT', { auth: false, body: { email: 'string!', password: 'string!' }, example: { email: 'ada@example.com', password: 'password123' }, saveToken: true }),
  R('get', '/users/me', 'Users', 'Current user'),
  R('post', '/users/change-password', 'Users', 'Change password', { body: { currentPassword: 'string!', newPassword: 'string!' } }),
  R('get', '/users', 'Users', 'List users', { roles: ['admin'], query: { role: 'string', status: 'string', q: 'string', ...PAGE } }),
  R('get', '/users/{id}', 'Users', 'Get a user (self or admin)'),
  R('patch', '/users/{id}', 'Users', 'Update name/phone (self or admin)', { body: { fullName: 'string', phone: 'string' } }),
  R('delete', '/users/{id}', 'Users', 'Deactivate account (self or admin)'),
  R('patch', '/users/{id}/status', 'Users', 'Suspend / reactivate', { roles: ['admin'], body: { status: ['active', 'suspended'] } }),

  // ---- Profiles
  R('get', '/customer-profiles/me', 'Profiles', 'My customer profile', { roles: ['customer'] }),
  R('get', '/customer-profiles/{id}', 'Profiles', 'Customer profile (owner/admin only — holds home address)'),
  R('patch', '/customer-profiles/{id}', 'Profiles', 'Update address / location / saved devices', { roles: ['customer'], body: { address: 'string', location: 'object', savedDevices: 'array' }, example: { address: '12 Allen Ave, Ikeja', location: { lng: 3.35, lat: 6.6 } } }),
  R('get', '/technician-profiles', 'Technicians', 'Search verified technicians', { auth: false, query: { serviceCategoryId: 'string', area: 'string', lng: 'number', lat: 'number', radiusKm: 'number', sort: ['rating', 'jobs', 'newest'], ...PAGE } }),
  R('get', '/technician-profiles/me', 'Technicians', 'My technician profile (incl. verification state)', { roles: ['technician'] }),
  R('get', '/technician-profiles/pending', 'Technicians', 'Verification queue', { roles: ['admin'] }),
  R('get', '/technician-profiles/{id}', 'Technicians', 'Public technician profile', { auth: false }),
  R('patch', '/technician-profiles/{id}', 'Technicians', 'Update my profile', { roles: ['technician'], body: { bio: 'string', experienceYears: 'number', serviceCategoryIds: 'array', services: 'array', serviceAreas: 'array', baseLocation: 'object', isAvailable: 'boolean' } }),
  R('post', '/technician-profiles/{id}/verification-docs', 'Technicians', 'Upload ID / certificates (multipart "docs")', { roles: ['technician'], multipart: { docs: 'file' } }),
  R('patch', '/technician-profiles/{id}/verify', 'Technicians', 'Approve / reject (approval needs ≥1 document)', { roles: ['admin'], body: { decision: ['approve', 'reject'], feedback: 'string' }, example: { decision: 'approve' } }),
  R('get', '/service-centers', 'Service Centers', 'Search verified service centers', { auth: false, query: { serviceCategoryId: 'string', lng: 'number', lat: 'number', radiusKm: 'number', ...PAGE } }),
  R('get', '/service-centers/me', 'Service Centers', 'My service center', { roles: ['service_center'] }),
  R('get', '/service-centers/pending', 'Service Centers', 'Verification queue', { roles: ['admin'] }),
  R('get', '/service-centers/{id}', 'Service Centers', 'Public service center profile', { auth: false }),
  R('patch', '/service-centers/{id}', 'Service Centers', 'Update business profile / hours / coverage', { roles: ['service_center'], body: { businessName: 'string', description: 'string', address: 'string', location: 'object', coverageRadiusKm: 'number', workingHours: 'object', serviceCategoryIds: 'array' } }),
  R('post', '/service-centers/{id}/verification-docs', 'Service Centers', 'Upload CAC / business documents (multipart "docs")', { roles: ['service_center'], multipart: { docs: 'file' } }),
  R('patch', '/service-centers/{id}/verify', 'Service Centers', 'Approve / reject', { roles: ['admin'], body: { decision: ['approve', 'reject'], feedback: 'string' } }),
  R('get', '/service-centers/{id}/team', 'Service Centers', 'List my team', { roles: ['service_center'] }),
  R('post', '/service-centers/{id}/team', 'Service Centers', 'Add a technician to my team by email', { roles: ['service_center'], body: { email: 'string!' } }),
  R('delete', '/service-centers/{id}/team/{technicianId}', 'Service Centers', 'Remove a team member', { roles: ['service_center'] }),
  R('get', '/service-categories', 'Categories', 'List active categories', { auth: false }),
  R('post', '/service-categories', 'Categories', 'Create category', { roles: ['admin'], body: { name: 'string!', parentCategory: 'string' } }),
  R('patch', '/service-categories/{id}', 'Categories', 'Update / deactivate category', { roles: ['admin'], body: { name: 'string', parentCategory: 'string', isActive: 'boolean' } }),

  // ---- Repair flow
  R('post', '/repair-requests', 'Repair Requests', 'Create request (multipart; media field "media", ≤6 files)', { roles: ['customer'], multipart: { serviceCategoryId: 'string!', itemType: 'string!', problemDescription: 'string!', brandModel: 'string', urgency: ['low', 'normal', 'urgent'], address: 'string', location: 'string', media: 'file' } }),
  R('get', '/repair-requests', 'Repair Requests', 'Customers: my requests. Providers: open job board. Admin: all', { query: { status: 'string', serviceCategoryId: 'string', lng: 'number', lat: 'number', radiusKm: 'number', ...PAGE } }),
  R('get', '/repair-requests/{id}', 'Repair Requests', 'Get a request'),
  R('patch', '/repair-requests/{id}/cancel', 'Repair Requests', 'Cancel (owner, before booking)', { roles: ['customer'] }),
  R('post', '/quotations', 'Quotations', 'Submit a quotation (verified technician, or center naming technicianId)', { roles: ['technician', 'service_center'], body: { repairRequestId: 'string!', technicianId: 'string', laborCost: 'number', partsCost: 'number', price: 'number', estimatedDays: 'integer', warrantyDays: 'integer', notes: 'string', validDays: 'integer' }, example: { repairRequestId: '<repairRequestId>', laborCost: 10000, partsCost: 5000, estimatedDays: 2, warrantyDays: 30, notes: '3-month screen warranty' } }),
  R('get', '/quotations/mine', 'Quotations', 'My quotations', { roles: ['technician', 'service_center'] }),
  R('get', '/quotations/repair-request/{id}', 'Quotations', 'Compare quotations (owner). sort=price|rating|eta|value; flags bestValue', { roles: ['customer', 'admin'], query: { sort: ['price', 'rating', 'eta', 'value'] } }),
  R('patch', '/quotations/{id}/accept', 'Quotations', 'Accept a quotation (rejects the others)', { roles: ['customer'] }),
  R('patch', '/quotations/{id}/withdraw', 'Quotations', 'Withdraw a pending quotation', { roles: ['technician', 'service_center'] }),
  R('post', '/appointments', 'Appointments', 'Book an accepted quotation — also opens the repair job', { roles: ['customer'], body: { quotationId: 'string!', scheduledAt: 'date!', serviceMode: ['onsite', 'dropoff', 'pickup'], address: 'string', notes: 'string' }, example: { quotationId: '<quotationId>', scheduledAt: '2030-01-01T10:00:00Z', serviceMode: 'dropoff' } }),
  R('get', '/appointments', 'Appointments', 'My appointments'),
  R('get', '/appointments/{id}', 'Appointments', 'Get appointment (participants)'),
  R('patch', '/appointments/{id}/reschedule', 'Appointments', 'Reschedule (before work starts)', { body: { scheduledAt: 'date!' } }),
  R('patch', '/appointments/{id}/cancel', 'Appointments', 'Cancel before work starts — held escrow is refunded to the wallet', { body: { reason: 'string' } }),
  R('get', '/repair-jobs', 'Repair Jobs', 'My jobs', { query: { status: 'string', ...PAGE } }),
  R('get', '/repair-jobs/{id}', 'Repair Jobs', 'Job tracking detail (+ counterpart contact)'),
  R('patch', '/repair-jobs/{id}/status', 'Repair Jobs', 'Advance status (diagnosing → awaiting_parts → in_progress → quality_check → ready → completed; on_hold). Needs payment first', { roles: ['technician', 'service_center'], body: { status: ['diagnosing', 'awaiting_parts', 'in_progress', 'quality_check', 'ready', 'on_hold', 'completed'], note: 'string' }, example: { status: 'in_progress', note: 'Started repair' } }),
  R('post', '/repair-jobs/{id}/confirm', 'Repair Jobs', 'Customer confirms satisfaction → releases escrow', { roles: ['customer'] }),

  // ---- Money
  R('post', '/transactions/pay', 'Payments', 'Pay for a job: paystack (checkout URL) | wallet | cash. Amount is taken from the job', { roles: ['customer'], body: { repairJobId: 'string!', method: ['paystack', 'wallet', 'cash'] }, example: { repairJobId: '<repairJobId>', method: 'paystack' } }),
  R('post', '/transactions/topup', 'Payments', 'Fund my wallet via Paystack', { roles: ['customer'], body: { amount: 'integer!' } }),
  R('get', '/transactions/verify/{reference}', 'Payments', 'Verify a payment after checkout redirect'),
  R('post', '/transactions/webhook/paystack', 'Payments', 'Paystack webhook (HMAC-SHA512 signed; set this URL in the Paystack dashboard)', { auth: false, body: { event: 'string', data: 'object' } }),
  R('get', '/transactions/me', 'Payments', 'My ledger', { query: { type: 'string', ...PAGE } }),
  R('get', '/transactions/wallet/{walletId}', 'Payments', 'Ledger for a specific wallet (owner/admin)'),
  R('get', '/wallets/me', 'Wallet', 'My wallet (balance, commissionOwed, withdrawable)'),
  R('post', '/wallets/withdraw', 'Wallet', 'Request a payout to a bank account', { roles: ['technician', 'service_center'], body: { amount: 'integer!', bankName: 'string!', accountNumber: 'string!', accountName: 'string!' }, example: { amount: 10000, bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi' } }),
  R('get', '/wallets/{userId}', 'Wallet', 'Wallet by user (owner/admin)'),

  // ---- After the repair
  R('post', '/reviews', 'Reviews', 'Review a completed job (once)', { roles: ['customer'], body: { repairJobId: 'string!', rating: 'integer!', tags: 'array', comment: 'string' }, example: { repairJobId: '<repairJobId>', rating: 5, tags: ['On time', 'Professional'], comment: 'Great work' } }),
  R('get', '/reviews/technician/{id}', 'Reviews', 'Reviews for a technician', { auth: false, query: PAGE }),
  R('get', '/warranty-records/job/{jobId}', 'Warranty', 'Warranty certificate for a job'),
  R('get', '/warranty-records/{id}', 'Warranty', 'Get a warranty record'),
  R('post', '/warranty-records/{id}/claims', 'Warranty', 'File a claim', { roles: ['customer'], body: { description: 'string!' } }),
  R('patch', '/warranty-records/{id}/claims/{claimId}', 'Warranty', 'Resolve / reject a claim', { roles: ['technician', 'service_center', 'admin'], body: { status: ['resolved', 'rejected'], resolutionNote: 'string' } }),
  R('post', '/disputes', 'Disputes', 'Open a dispute — freezes the job and escrow (multipart, optional "evidence")', { multipart: { repairJobId: 'string!', reason: 'string!', evidence: 'file' } }),
  R('get', '/disputes', 'Disputes', 'Admin: all. Others: mine', { query: { status: 'string', ...PAGE } }),
  R('get', '/disputes/{id}', 'Disputes', 'Get a dispute'),
  R('patch', '/disputes/{id}/resolve', 'Disputes', 'Rule on a dispute: release | refund | partial', { roles: ['admin'], body: { decision: ['release', 'refund', 'partial'], refundAmount: 'number', note: 'string' } }),
  R('get', '/notifications', 'Notifications', 'My notifications (?unread=true)', { query: { unread: 'boolean', ...PAGE } }),
  R('patch', '/notifications/read-all', 'Notifications', 'Mark all as read'),
  R('patch', '/notifications/{id}/read', 'Notifications', 'Mark one as read'),

  // ---- Admin
  R('get', '/admin/stats', 'Admin', 'Dashboard analytics', { roles: ['admin'] }),
  R('get', '/admin/withdrawals', 'Admin', 'Payout queue', { roles: ['admin'], query: { status: 'string', ...PAGE } }),
  R('patch', '/admin/withdrawals/{id}', 'Admin', 'Mark a payout paid / rejected (rejected refunds the wallet)', { roles: ['admin'], body: { decision: ['paid', 'rejected'], note: 'string' } }),
  R('post', '/admin/run-auto-release', 'Admin', 'Run the escrow auto-release sweep now', { roles: ['admin'] }),
];

const pathParams = (path) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));

export const buildSpec = () => {
  const paths = {};
  for (const r of routes) {
    const op = {
      tags: [r.tag],
      summary: r.summary,
      ...(r.roles ? { description: `Roles: ${r.roles.map((x) => ROLES[x] || x).join(', ')}` } : {}),
      parameters: [
        ...pathParams(r.path),
        ...Object.entries(r.query || {}).map(([name, t]) => ({ name, in: 'query', schema: Array.isArray(t) ? { type: 'string', enum: t } : { type: t } })),
      ],
      responses: { 200: { description: 'OK' }, 400: { description: 'Validation failed' }, 401: { description: 'Not authenticated' }, 403: { description: 'Forbidden' }, 404: { description: 'Not found' } },
    };
    if (r.auth === false) op.security = [];
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: SCHEMA(r.body), ...(r.example ? { example: r.example } : {}) } } };
    if (r.multipart) op.requestBody = { content: { 'multipart/form-data': { schema: SCHEMA(r.multipart) } } };
    (paths[r.path] ||= {})[r.method] = op;
  }
  const tags = [...new Set(routes.map((r) => r.tag))].map((name) => ({ name }));
  return {
    openapi: '3.0.0',
    info: {
      title: 'RepairHub API',
      version: '1.1.0',
      description: 'Trusted repair-services marketplace. Escrow payments (Paystack), technician & service-center verification, quotations, live job tracking, warranties, reviews and dispute arbitration. Send `Authorization: Bearer <token>`; list endpoints accept `?page=&limit=` and return `meta`.',
    },
    servers: [{ url: '/api' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    tags,
    paths,
  };
};

export const setupSwagger = (app) => {
  const spec = buildSpec();
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/api-docs.json', (req, res) => res.json(spec));
};
