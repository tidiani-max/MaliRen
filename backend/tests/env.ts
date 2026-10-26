// Runs in every test worker before test files are loaded.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://maliren:maliren@localhost:5432/maliren_test'
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456'
process.env.SCRYPT_N = '1024' // fast hashing in tests only
process.env.LOG_LEVEL = 'silent'
process.env.MAIL_MODE = 'log'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.UPLOAD_DIR = './uploads-test'
process.env.LOGIN_RATE_LIMIT_MAX = '1000'
process.env.CONTACT_RATE_LIMIT_MAX = '1000'
process.env.GLOBAL_RATE_LIMIT_MAX = '100000'
process.env.ADMIN_NOTIFY_EMAIL = ''
