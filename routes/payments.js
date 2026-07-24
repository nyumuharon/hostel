const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

router.use(requireAuth);

// Helper to calculate billing months
function getBillingMonths(startDateStr) {
  const start = new Date(startDateStr);
  const end = new Date();
  if (isNaN(start.getTime())) return 1;
  const yearsDiff = end.getFullYear() - start.getFullYear();
  const monthsDiff = end.getMonth() - start.getMonth();
  // Billed for the starting month, plus any full months elapsed
  return Math.max(1, (yearsDiff * 12) + monthsDiff + 1);
}

// Helper to get block rates
const blockRates = { Batian: 20000, Nelion: 20000 };

// GET /api/payments/balance (Returns ledger summary for the logged-in student or a query student_id)
router.get('/balance', (req, res) => {
  let studentId = req.session.userId;
  
  if (req.session.role === 'admin' && req.query.student_id) {
    studentId = parseInt(req.query.student_id);
  }

  try {
    const student = db.students.findOne(s => s.student_id === studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const allocations = db.allocations.find(a => a.student_id === studentId && a.status === 'active');
    const payments = db.payments.find(p => p.student_id === studentId && p.status === 'completed');

    const totalPaid = payments.reduce((acc, p) => acc + (p.amount || 0), 0);
    let totalCharged = 0;
    let details = [];

    allocations.forEach(alloc => {
      const room = db.rooms.findOne(r => r.room_id === alloc.room_id);
      if (room) {
        const rate = room.monthly_rate || room.price || blockRates[room.block_name] || 20000;
        const months = getBillingMonths(alloc.allocation_date);
        const charge = rate * months;
        totalCharged += charge;
        details.push({
          room_number: room.room_number,
          block_name: room.block_name,
          allocation_date: alloc.allocation_date,
          rate: rate,
          months_billed: months,
          total_charge: charge
        });
      }
    });

    const balance = totalPaid - totalCharged;

    // Calculate due date automatically
    let dueDate = null;
    if (allocations.length > 0) {
      const activeAlloc = allocations[0];
      if (activeAlloc.expected_checkout_date) {
        dueDate = activeAlloc.expected_checkout_date;
      } else if (activeAlloc.allocation_date) {
        const allocD = new Date(activeAlloc.allocation_date);
        if (!isNaN(allocD.getTime())) {
          allocD.setMonth(allocD.getMonth() + 1);
          dueDate = allocD.toISOString().split('T')[0];
        }
      }
    }

    if (!dueDate && balance < 0) {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 5);
      dueDate = nextMonth.toISOString().split('T')[0];
    }

    res.json({
      success: true,
      totalPaid: totalPaid,
      totalCharged: totalCharged,
      netBalance: balance,
      dueDate: dueDate,
      data: {
        student_id: studentId,
        full_name: student.full_name,
        admission_number: student.admission_number,
        total_paid: totalPaid,
        total_charged: totalCharged,
        balance: balance,
        details: details
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// GET /api/payments (Filter by student_id or status, students only get their own)
router.get('/', (req, res) => {
  const { student_id, status } = req.query;

  try {
    let payments = db.payments.find();

    if (req.session.role === 'student') {
      payments = payments.filter(p => p.student_id === req.session.userId);
    } else if (student_id) {
      payments = payments.filter(p => p.student_id === parseInt(student_id));
    }

    if (status) {
      payments = payments.filter(p => p.status === status);
    }

    const students = db.students.find();

    const data = payments.map(p => {
      const student = students.find(s => s.student_id === p.student_id);
      return {
        ...p,
        full_name: student ? student.full_name : 'Unknown Student',
        student_name: student ? student.full_name : 'Unknown Student', // backward compatibility
        admission_number: student ? student.admission_number : 'N/A'
      };
    });

    data.sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));

    res.json({ success: true, data: data, count: data.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// POST /api/payments (Simulate cash/Mpesa recording)
router.post('/', async (req, res) => {
  let {
    student_id,
    hostel_block,
    fee_category,
    billing_month,
    due_date,
    amount,
    payment_date,
    status,
    payment_method,
    remarks
  } = req.body;

  if (req.session.role === 'student') {
    student_id = req.session.userId;
  }

  if (!student_id || !hostel_block || !amount || !payment_date || !billing_month) {
    return res.status(400).json({ success: false, message: 'Student, hostel block, billing month, payment date, and amount are required' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Payment amount must be a positive number' });
  }

  try {
    const student = db.students.findOne(s => s.student_id === parseInt(student_id));
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const newPayment = await db.payments.insert({
      student_id: parseInt(student_id),
      hostel_block: hostel_block,
      fee_category: fee_category || 'Monthly Bed Payment',
      billing_month: billing_month,
      due_date: due_date || (billing_month ? `${billing_month}-05` : null),
      amount: numericAmount,
      payment_date: payment_date,
      status: status || 'completed',
      payment_method: payment_method || 'M-Pesa',
      remarks: remarks || ''
    });

    // Confirm lease allocation status if pending
    if (newPayment.status === 'completed') {
      const pendingAlloc = db.allocations.findOne(a => a.student_id === parseInt(student_id) && a.status === 'pending_payment');
      if (pendingAlloc) {
        db.allocations.update(pendingAlloc.allocation_id, {
          status: 'active',
          lease_expires_at: null
        });
        
        await db.auditLogs.insert({
          user_id: req.session.role === 'admin' ? req.session.userId : null,
          action: 'LEASE_CONFIRMED',
          table_name: 'allocations',
          record_id: pendingAlloc.allocation_id,
          details: `Lease payment received. Booking reference ${pendingAlloc.booking_code} activated.`
        });
      }
    }

    // Simulate sending email and SMS notification
    console.log(`\n=================== NOTIFICATION DISPATCH SIMULATOR ===================`);
    console.log(`✉️ EMAIL: Dispatched to student registration address for ${student.full_name}.`);
    console.log(`   Message: "Your payment of Ksh ${numericAmount} has been verified successfully. Receipt Ref: ${remarks}"`);
    console.log(`📱 SMS: Dispatched confirmation message to registered mobile number.`);
    console.log(`   Message: "Everest Hostels: Ksh ${numericAmount} received. Ref: ${remarks}. Thank you."`);
    console.log(`========================================================================\n`);

    await db.auditLogs.insert({
      user_id: req.session.role === 'admin' ? req.session.userId : null,
      action: 'CREATE_PAYMENT',
      table_name: 'fee_payments',
      record_id: newPayment.payment_id,
      details: `Recorded payment of Ksh ${numericAmount} for student ${student.full_name}. Notification dispatched via Email/SMS.`
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully!',
      payment_id: newPayment.payment_id,
      notification_sent: `Email sent to student registration address and SMS confirmation sent to registered mobile number.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// PUT /api/payments (Admin only)
router.put('/', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }

  const {
    payment_id,
    amount,
    status,
    payment_method,
    remarks,
    due_date,
    billing_month
  } = req.body;

  if (!payment_id) {
    return res.status(400).json({ success: false, message: 'payment_id is required' });
  }

  const pId = parseInt(payment_id);

  try {
    const payment = db.payments.findOne(p => p.payment_id === pId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    const updates = {};
    if (amount !== undefined) {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
      }
      updates.amount = numericAmount;
    }
    if (status) updates.status = status;
    if (payment_method) updates.payment_method = payment_method;
    if (remarks !== undefined) updates.remarks = remarks;
    if (due_date !== undefined) updates.due_date = due_date;
    if (billing_month) updates.billing_month = billing_month;

    const success = db.payments.update(pId, updates);

    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'UPDATE_PAYMENT',
        table_name: 'fee_payments',
        record_id: pId,
        details: `Updated payment ID ${pId}`
      });

      res.json({ success: true, message: 'Payment updated successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update payment' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// DELETE /api/payments (Admin only)
router.delete('/', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }

  const paymentId = req.body.payment_id || req.query.payment_id;

  if (!paymentId) {
    return res.status(400).json({ success: false, message: 'payment_id is required' });
  }

  const pId = parseInt(paymentId);

  try {
    const success = db.payments.delete(pId);
    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'DELETE_PAYMENT',
        table_name: 'fee_payments',
        record_id: pId,
        details: `Deleted payment record ID ${pId}`
      });

      res.json({ success: true, message: 'Payment deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Payment record not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

module.exports = router;
