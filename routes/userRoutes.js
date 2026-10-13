import { Router } from 'express';
import { registerUser, loginUser, sendVerificationCode, confirmVerification, getMe, getUserById, updateUser, deleteUser, changePassword, forgotPassword, resetPassword, listUsers, setUserStatus } from '../controller/userController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, idParam } from '../middleware/validate.js';
import * as s from '../validators/schemas.js';

const router = Router();
router.param('id', idParam);

router.post('/register', validate(s.register), registerUser);
router.post('/login', validate(s.login), loginUser);
router.post('/verify/send', validate(s.verifySend), sendVerificationCode);
router.post('/verify/confirm', validate(s.verifyConfirm), confirmVerification);
router.post('/forgot-password', validate(s.forgotPassword), forgotPassword);
router.post('/reset-password', validate(s.resetPassword), resetPassword);
router.get('/me', protect, getMe);
router.post('/change-password', protect, validate(s.changePassword), changePassword);
router.get('/', protect, authorize('admin'), validate(s.userList, 'query'), listUsers);
router.get('/:id', protect, getUserById);
router.patch('/:id/status', protect, authorize('admin'), validate(s.userStatus), setUserStatus);
router.patch('/:id', protect, validate(s.updateUser), updateUser);
router.delete('/:id', protect, deleteUser);

export default router;
