import Transaction from '../model/transactionModel.js';
import RepairJob from '../model/repairJobModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { conflict, forbidden, notFound } from '../utils/ApiError.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
import { initializeTransaction, isValidWebhookSignature, verifyTransaction } from '../config/paystack.js';
import { markCash, markHeld, newReference, payFromWallet } from '../services/escrowService.js';
import { creditWallet, getOrCreateWallet } from '../services/walletService.js';
import { notifyUser } from '../services/notificationService.js';

// Marks a pending gateway charge successful and fulfils it. The pending -> success flip is
// atomic, so the webhook and the /verify endpoint can both run without double-crediting.
const fulfilCharge = async (reference, paidAmount) => {
  const txn = await Transaction.findOneAndUpdate({ reference, status: 'pending' }, { status: 'success' }, { new: true });
  if (!txn) return null;
  if (paidAmount !== undefined && Math.round(paidAmount) !== Math.round(txn.amount)) {
    await Transaction.updateOne({ _id: txn._id }, { status: 'failed', note: `Amount mismatch: paid ${paidAmount}, expected ${txn.amount}` });
    return null;
  }
  if (txn.type === 'escrow_payment') {
    await markHeld(txn.repairJobId, { method: 'paystack', reference });
    await notifyUser(txn.userId, 'payment', 'Payment received and held safely in escrow.', txn.repairJobId);
  } else if (txn.type === 'topup') {
    await creditWallet(txn.userId, txn.amount);
    await notifyUser(txn.userId, 'payment', `Your wallet was funded with ₦${txn.amount}.`);
  }
  return txn;
};

// POST /api/transactions/pay  { repairJobId, method: paystack|wallet|cash }   (customer)
// The amount is ALWAYS the accepted quotation price stored on the job — never client-supplied.
export const payForJob = asyncHandler(async (req, res) => {
  const { repairJobId, method } = req.body;
  const job = await RepairJob.findById(repairJobId);
  if (!job) throw notFound('Repair job not found');
  if (String(job.customerUserId) !== String(req.user._id)) throw forbidden('This is not your job');
  if (['completed', 'cancelled', 'disputed'].includes(job.status)) throw conflict(`Cannot pay for a ${job.status} job`);
  if (job.payment.status !== 'unpaid') throw conflict('Payment method already chosen for this job');

  if (method === 'cash') {
    const j = await markCash(job._id);
    if (!j) throw conflict('Payment method already chosen for this job');
    return ok(res, { payment: j.payment }, 'Pay-on-delivery selected');
  }
  if (method === 'wallet') {
    const j = await payFromWallet(job);
    return ok(res, { payment: j.payment }, 'Paid from wallet — funds held in escrow');
  }

  // paystack: create a pending ledger row, then hand the customer the checkout URL.
  const reference = newReference('esc');
  await Transaction.create({ userId: req.user._id, repairJobId: job._id, type: 'escrow_payment', gateway: 'paystack', amount: job.price, reference });
  const init = await initializeTransaction({ email: req.user.email, amount: job.price, reference, metadata: { repairJobId: String(job._id), purpose: 'escrow' } });
  return created(res, { reference, authorizationUrl: init.authorization_url, amount: job.price }, 'Complete the payment on the checkout page');
});

// POST /api/transactions/topup  { amount }
export const initializeTopup = asyncHandler(async (req, res) => {
  const reference = newReference('top');
  await Transaction.create({ userId: req.user._id, type: 'topup', gateway: 'paystack', amount: req.body.amount, reference });
  const init = await initializeTransaction({ email: req.user.email, amount: req.body.amount, reference, metadata: { purpose: 'topup' } });
  return created(res, { reference, authorizationUrl: init.authorization_url }, 'Complete the payment on the checkout page');
});

// POST /api/transactions/webhook/paystack — public, authenticated by HMAC signature over the raw body.
export const paystackWebhook = asyncHandler(async (req, res) => {
  if (!isValidWebhookSignature(req.rawBody, req.headers['x-paystack-signature'])) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  const { event, data } = req.body || {};
  if (event === 'charge.success' && data?.reference) {
    await fulfilCharge(data.reference, typeof data.amount === 'number' ? data.amount / 100 : undefined);
  }
  return res.sendStatus(200); // always ack quickly so Paystack doesn't retry
});

// GET /api/transactions/verify/:reference — the callback page calls this after checkout.
export const verifyPayment = asyncHandler(async (req, res) => {
  const txn = await Transaction.findOne({ reference: req.params.reference, userId: req.user._id });
  if (!txn) throw notFound('Transaction not found');
  if (txn.status === 'pending') {
    const result = await verifyTransaction(txn.reference);
    if (result.status === 'success') await fulfilCharge(txn.reference, result.amount);
  }
  return ok(res, await Transaction.findById(txn._id));
});

// GET /api/transactions/me?type=
export const listMyTransactions = asyncHandler(async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.type) filter.type = req.query.type;
  const pg = parsePagination(req.query);
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    Transaction.countDocuments(filter),
  ]);
  return ok(res, items, 'Transactions', 200, pageMeta(pg, total));
});

// GET /api/transactions/wallet/:walletId  (owner or admin)
export const listTransactionsForWallet = asyncHandler(async (req, res) => {
  const wallet = await getOrCreateWallet(req.user._id);
  if (req.user.role !== 'admin' && String(wallet._id) !== req.params.walletId) throw forbidden('Not your wallet');
  const items = await Transaction.find(req.user.role === 'admin' ? { walletId: req.params.walletId } : { userId: req.user._id }).sort({ createdAt: -1 }).limit(100);
  return ok(res, items);
});
