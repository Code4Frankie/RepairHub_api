// Runs before every test file (jest "setupFiles"): deterministic config, fast bcrypt, mocked gateway.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_test_jwt_secret_1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_repairhub';
process.env.PAYSTACK_MOCK = 'true';
process.env.COMMISSION_RATE = '0.1';
process.env.AUTO_RELEASE_HOURS = '72';
process.env.MIN_WITHDRAWAL = '1000';