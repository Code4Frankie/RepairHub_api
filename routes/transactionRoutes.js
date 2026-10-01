import { Router } from 'express';
import { payForJob, initializeTopup, paystackWebhook, verifyPayment, listMyTransactions, listTransactionsForWallet } from '../controller/transactionController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('walletId', idParam);

router.post('/webhook/paystack', paystackWebhook); // public; HMAC-verified inside
router.post('/pay', protect, authorize('customer'), validate(s.payJob), payForJob);
router.post('/topup', protect, authorize('customer'), validate(s.topup), initializeTopup);
router.get('/verify/:reference', protect, verifyPayment);
router.get('/me', protect, validate(s.txnList, 'query'), listMyTransactions);
router.get('/wallet/:walletId', protect, listTransactionsForWallet);

export default router;
