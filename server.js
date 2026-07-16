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

// Configure Express Session (equivalent to PHP session setup)
app.use(session({
  name: 'HOSTELSESSID',
  secret: 'everest_university_hostel_secret_key_12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 30 * 60 * 1000, // 30 minutes (matching PHP SESSION_TIMEOUT)
    sameSite: 'lax'
  }
}));

// Initialize database (JSON files and seeding)
initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
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

// Fallback to index.html for undefined frontend routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🏫 Hostel Management System is running!`);
  console.log(`👉 Access URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
