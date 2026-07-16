const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

// POST /api/login (Admin Login)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  try {
    const user = db.users.findOne(u => u.username === username.trim());

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Set session
    req.session.userId = user.user_id;
    req.session.username = user.username;
    req.session.fullName = user.full_name;
    req.session.role = user.role;
    req.session.loginTime = Date.now();

    // Log action
    db.auditLogs.insert({
      user_id: user.user_id,
      action: 'LOGIN',
      table_name: 'users',
      record_id: user.user_id,
      details: `Admin ${user.username} logged in successfully.`
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.user_id,
        username: user.username,
        name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/student/login (Student Login)
router.post('/student/login', async (req, res) => {
  const { admission_number, password } = req.body;

  if (!admission_number || !password) {
    return res.status(400).json({ success: false, message: 'Admission number and password are required' });
  }

  try {
    const student = db.students.findOne(s => s.admission_number.trim().toUpperCase() === admission_number.trim().toUpperCase());

    if (!student || student.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
    }

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = student.student_id;
    req.session.username = student.admission_number;
    req.session.fullName = student.full_name;
    req.session.role = 'student';
    req.session.gender = student.gender;
    req.session.loginTime = Date.now();

    // Log action
    db.auditLogs.insert({
      user_id: null, // Student is not admin, user_id foreign key refers to users table. So we keep it null.
      action: 'STUDENT_LOGIN',
      table_name: 'students',
      record_id: student.student_id,
      details: `Student ${student.admission_number} logged in.`
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: student.student_id,
        username: student.admission_number,
        name: student.full_name,
        role: 'student',
        gender: student.gender
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/student/register (Student self-registration)
router.post('/student/register', async (req, res) => {
  const {
    admission_number,
    password,
    full_name,
    email,
    phone,
    course,
    gender,
    next_of_kin_name,
    next_of_kin_phone
  } = req.body;

  if (!admission_number || !password || !full_name || !course || !gender) {
    return res.status(400).json({ success: false, message: 'Admission number, password, full name, course, and gender are required' });
  }

  const phoneStr = String(phone || '').trim();
  if (phoneStr && !/^[0-9]{10}$/.test(phoneStr)) {
    return res.status(400).json({ success: false, message: 'Phone number must contain exactly 10 digits.' });
  }

  try {
    const existing = db.students.findOne(s => s.admission_number.toLowerCase() === admission_number.trim().toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, message: 'Admission number already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const today = new Date().toISOString().split('T')[0];
    
    const newStudent = db.students.insert({
      admission_number: admission_number.trim().toUpperCase(),
      password: hashedPassword,
      gender: gender.toLowerCase() === 'female' ? 'female' : 'male',
      full_name: full_name.trim(),
      email: (email || '').trim(),
      phone: phoneStr,
      course: course.trim(),
      date_of_admission: today,
      next_of_kin_name: (next_of_kin_name || '').trim(),
      next_of_kin_phone: (next_of_kin_phone || '').trim(),
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Student account created successfully. You can now log in.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/logout
router.post('/logout', (req, res) => {
  const role = req.session.role;
  const username = req.session.username;

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to log out' });
    }
    res.clearCookie('HOSTELSESSID');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// GET /api/auth/me (Check session status)
router.get('/auth/me', (req, res) => {
  if (req.session.userId) {
    res.json({
      success: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        fullName: req.session.fullName,
        role: req.session.role,
        gender: req.session.gender
      }
    });
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
});

module.exports = router;
