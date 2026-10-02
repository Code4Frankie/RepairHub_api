import Notification from '../model/notificationModel.js';

// Persists an in-app notification. Never throws: a failed notification must not break the
// business action that triggered it.
export const notifyUser = async (userId, type, message, refId) => {
    try {
        return await Notification.create({ userId, type, message, refId });
    } catch (err) {
        console.error('notifyUser failed:', err.message);
        return null;
    }
};

export const notifyMany = async (userIds, type, message, refId) => {
    if (!userIds.length) return;
    try {
        await Notification.insertMany(userIds.map((userId) => ({ userId, type, message, refId })));
    } catch (err) {
        console.error('notifyMany failed:', err.message);
    }
};
