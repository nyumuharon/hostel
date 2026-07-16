const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Express Session
app.use(session({
  name: 'HOSTELSESSID',
  secret: 'everest_university_hostel_secret_key_12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 30 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Health check endpoint — always available
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: global.dbReady ? 'connected' : 'not ready', time: new Date().toISOString() });
});

// Mount API routes
app.use('/api', require('./routes/auth'));
app.use('/api/students', require('./routes/students'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/allocations', require('./routes/allocations'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server AFTER DB is ready ──────────────────────────────────────────
async function startServer() {
  try {
    console.log('====================================================');
    console.log('🔌 Connecting to MongoDB Atlas...');
    await initializeDatabase();
    global.dbReady = true;

    app.listen(PORT, () => {
      console.log('====================================================');
      console.log('🏫 Hostel Management System is running!');
      console.log(`👉 Access URL: http://localhost:${PORT}`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('❌ Failed to connect to database:', err.message);
    console.error('👉 Make sure MONGODB_URI environment variable is set correctly.');
    process.exit(1);
  }
}

startServer();
