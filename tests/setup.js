import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;

// If TEST_MONGO_URI is set (CI service container, local docker) use that server with a
// per-file database; otherwise spin up a disposable in-memory MongoDB.
export const connectTestDB = async () => {
    if (process.env.TEST_MONGO_URI) {
        const base = process.env.TEST_MONGO_URI.replace(/\/$/, '');
        await mongoose.connect(`${base}/repairhub_test_${process.pid}_${Date.now()}`);
    } else {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
    }
    // Make sure unique / partial indexes exist before the first test runs.
    await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => { })));
};

export const disconnectTestDB = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongoServer) await mongoServer.stop();
};

export const clearTestDB = async () => {
    for (const key in mongoose.connection.collections) {
        await mongoose.connection.collections[key].deleteMany({});
    }
};
