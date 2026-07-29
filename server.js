require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const connectDB = require('./db/connection');

// Connect to MongoDB
connectDB();

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
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/export', require('./routes/export'));

// Web Routes
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/dashboard', (req, res) => res.render('dashboard'));
app.get('/clients', (req, res) => res.render('clients'));
app.get('/new-invoice', (req, res) => res.render('new-invoice'));
app.get('/client-details', (req, res) => res.render('client-details'));

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all API 404
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'الرابط غير موجود' });
});

// Catch-all frontend route to support client-side routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit();
});