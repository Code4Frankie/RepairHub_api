import Notification from '../model/notificationModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { notFound } from '../utils/ApiError.js';
import { pageMeta, parsePagination } from '../utils/paginate.js';
export { notifyUser } from '../services/notificationService.js';

// GET /api/notifications?unread=true
export const listMyNotifications = asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.unread === true) filter.isRead = false;
    const pg = parsePagination(req.query);
    const [items, total, unreadCount] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
        Notification.countDocuments(filter),
        Notification.countDocuments({ userId: req.user._id, isRead: false }),
    ]);
    return ok(res, items, 'Notifications', 200, { ...pageMeta(pg, total), unreadCount });
});

// PATCH /api/notifications/:id/read  — only your own
export const markAsRead = asyncHandler(async (req, res) => {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { isRead: true }, { new: true });
    if (!n) throw notFound('Notification not found');
    return ok(res, n, 'Notification marked as read');
});

// PATCH /api/notifications/read-all
export const markAllAsRead = asyncHandler(async (req, res) => {
    const r = await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    return ok(res, { updated: r.modifiedCount }, 'All notifications marked as read');
});
