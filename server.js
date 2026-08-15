require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');

console.log('[server] Starting app initialization...');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Trust proxy for Render/Vercel (required for secure cookies)
app.set('trust proxy', 1);

// Session Configuration
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;

console.log('[server] Is serverless:', isServerless);

let sessionStore;
if (isServerless) {
  sessionStore = new session.MemoryStore();
} else {
  console.log('[server] Loading PrismaSessionStore...');
  const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
  const prisma = require('./lib/prisma');
  sessionStore = new PrismaSessionStore(prisma, {
    checkPeriod: 2 * 60 * 1000,
    dbRecordIdIsSessionId: true,
    dbRecordIdFunction: undefined,
  });
  console.log('[server] PrismaSessionStore loaded');
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax'
  }
}));

console.log('[server] Session middleware configured');

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/end-clients', require('./routes/end-clients'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/export', require('./routes/export'));
app.use('/api/search', require('./routes/search'));

console.log('[server] Routes loaded');

// Web Routes
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/dashboard', (req, res) => res.render('dashboard'));
app.get('/clients', (req, res) => res.render('clients'));
app.get('/new-invoice', (req, res) => res.render('new-invoice'));
app.get('/client-details', (req, res) => res.render('client-details'));

// Health check for Vercel debugging
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all API 404
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'الرابط غير موجود' });
});

// Catch-all frontend route fallback
app.get('*', (req, res) => {
  res.redirect('/dashboard');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

console.log('[server] App initialization complete');

// Start Server when run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit();
  });
}

module.exports = app;