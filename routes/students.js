const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// Check if user is admin
function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }
  next();
}

router.use(requireAuth);

// GET /api/students (Allows both students to fetch their own profile, or admins to search all)
router.get('/', (req, res) => {
  const studentId = req.query.student_id;

  try {
    if (req.session.role === 'student') {
      // Students can only see their own profile
      const student = db.students.findOne(s => s.student_id === req.session.userId);
      if (student) {
        return res.json({ success: true, data: student });
      } else {
        return res.status(404).json({ success: false, message: 'Student profile not found' });
      }
    }

    // Admin access
    if (studentId) {
      const student = db.students.findOne(s => s.student_id === parseInt(studentId));
      if (student) {
        res.json({ success: true, data: student });
      } else {
        res.status(404).json({ success: false, message: 'Student not found' });
      }
    } else {
      const students = db.students.find();
      // Sort alphabetically by full_name
      students.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
      res.json({ success: true, data: students, count: students.length });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// POST /api/students (Admin creates student account)
router.post('/', requireAdmin, async (req, res) => {
  const {
    admission_number,
    password,
    gender,
    full_name,
    email,
    phone,
    course,
    date_of_admission,
    next_of_kin_name,
    next_of_kin_phone
  } = req.body;

  if (!admission_number || !full_name || !course || !gender) {
    return res.status(400).json({ success: false, message: 'Admission number, full name, gender, and course are required' });
  }

  const phoneStr = String(phone || '').trim();
  if (phoneStr && !/^\+254[17][0-9]{8}$/.test(phoneStr)) {
    return res.status(400).json({ success: false, message: 'Invalid phone number format.' });
  }

  try {
    const existing = db.students.findOne(s => s.admission_number.toLowerCase() === admission_number.trim().toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, message: 'Admission number already exists.' });
    }

    // Set a default password if admin didn't provide one
    const pass = String(password || 'student123').trim();
    const hashedPassword = await bcrypt.hash(pass, 10);
    const today = new Date().toISOString().split('T')[0];

    const newStudent = db.students.insert({
      admission_number: admission_number.trim().toUpperCase(),
      password: hashedPassword,
      gender: gender.toLowerCase() === 'female' ? 'female' : 'male',
      full_name: full_name.trim(),
      email: (email || '').trim(),
      phone: phoneStr,
      course: course.trim(),
      date_of_admission: date_of_admission || today,
      next_of_kin_name: (next_of_kin_name || '').trim(),
      next_of_kin_phone: (next_of_kin_phone || '').trim(),
      status: 'active'
    });

    // Log audit
    db.auditLogs.insert({
      user_id: req.session.userId,
      action: 'ADMIN_CREATE_STUDENT',
      table_name: 'students',
      record_id: newStudent.student_id,
      details: `Admin registered student ${newStudent.full_name} (${newStudent.admission_number})`
    });

    res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      student_id: newStudent.student_id
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// PUT /api/students (Admin updates student details)
router.put('/', requireAdmin, async (req, res) => {
  const {
    student_id,
    full_name,
    password,
    gender,
    email,
    phone,
    course,
    next_of_kin_name,
    next_of_kin_phone,
    status
  } = req.body;

  if (!student_id) {
    return res.status(400).json({ success: false, message: 'student_id is required' });
  }

  try {
    const student = db.students.findOne(s => s.student_id === parseInt(student_id));
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name.trim();
    if (email !== undefined) updates.email = (email || '').trim();
    if (phone !== undefined) {
      const phoneStr = String(phone || '').trim();
      if (phoneStr && !/^\+254[17][0-9]{8}$/.test(phoneStr)) {
        return res.status(400).json({ success: false, message: 'Invalid phone number format.' });
      }
      updates.phone = phoneStr;
    }
    if (course !== undefined) updates.course = course.trim();
    if (gender !== undefined) updates.gender = gender.toLowerCase() === 'female' ? 'female' : 'male';
    if (next_of_kin_name !== undefined) updates.next_of_kin_name = (next_of_kin_name || '').trim();
    if (next_of_kin_phone !== undefined) updates.next_of_kin_phone = (next_of_kin_phone || '').trim();
    if (status !== undefined) updates.status = status;

    if (password && String(password).trim() !== '') {
      updates.password = await bcrypt.hash(String(password).trim(), 10);
    }

    const success = db.students.update(student_id, updates);

    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'ADMIN_UPDATE_STUDENT',
        table_name: 'students',
        record_id: parseInt(student_id),
        details: `Updated details for student ID ${student_id}`
      });

      res.json({ success: true, message: 'Student updated successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update student' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// DELETE /api/students (Admin deletes student)
router.delete('/', requireAdmin, (req, res) => {
  const studentId = req.body.student_id || req.query.student_id;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'student_id is required' });
  }

  try {
    // Cascading deletes of allocations and payments
    const studentAllocations = db.allocations.find(a => a.student_id === parseInt(studentId));
    for (const alloc of studentAllocations) {
      db.allocations.delete(alloc.allocation_id);
      const room = db.rooms.findOne(r => r.room_id === alloc.room_id);
      if (room) {
        const newOccupancy = Math.max(0, room.current_occupancy - 1);
        db.rooms.update(room.room_id, {
          current_occupancy: newOccupancy,
          status: newOccupancy < room.capacity ? 'available' : 'occupied'
        });
      }
    }

    const studentPayments = db.payments.find(p => p.student_id === parseInt(studentId));
    for (const payment of studentPayments) {
      db.payments.delete(payment.payment_id);
    }

    const success = db.students.delete(studentId);
    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'DELETE_STUDENT',
        table_name: 'students',
        record_id: parseInt(studentId),
        details: `Deleted student ID ${studentId}`
      });

      res.json({ success: true, message: 'Student deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Student not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

module.exports = router;
