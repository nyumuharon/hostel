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

router.use((req, res, next) => {
  db.checkAndExpireLeases();
  next();
});

// Helper to generate a unique Booking Reference Code
function generateBookingCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BK-${code}`;
}

// GET /api/allocations (Students see their own, admins see all)
router.get('/', (req, res) => {
  try {
    let allocations = db.allocations.find();
    
    // If student, filter to only their allocations
    if (req.session.role === 'student') {
      allocations = allocations.filter(a => a.student_id === req.session.userId);
    }

    const students = db.students.find();
    const rooms = db.rooms.find();

    const data = allocations.map(a => {
      const student = students.find(s => s.student_id === a.student_id);
      const room = rooms.find(r => r.room_id === a.room_id);

      return {
        ...a,
        full_name: student ? student.full_name : 'Unknown Student',
        student_name: student ? student.full_name : 'Unknown Student', // For backward compatibility
        admission_number: student ? student.admission_number : 'N/A',
        room_number: room ? room.room_number : 'N/A',
        room_type: room ? room.room_type : 'N/A',
        capacity: room ? room.capacity : 0,
        floor: room ? room.floor : null,
        block_name: room ? room.block_name : 'N/A',
        gender_restriction: room ? room.gender_restriction : 'N/A'
      };
    });

    data.sort((a, b) => (b.allocation_date || '').localeCompare(a.allocation_date || ''));

    res.json({ success: true, data: data, count: data.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// POST /api/allocations (Student bookings or admin allocations)
router.post('/', async (req, res) => {
  let { 
    student_id, 
    room_id, 
    allocation_date, 
    expected_checkout_date,
    payment_method,
    payment_amount,
    payment_reference
  } = req.body;

  // If student logs in, automatically set student_id to their user ID
  if (req.session.role === 'student') {
    student_id = req.session.userId;
  }

  if (!student_id || !room_id || !allocation_date) {
    return res.status(400).json({ success: false, message: 'Student, Room, and Allocation Date are required' });
  }

  const sId = parseInt(student_id);
  const rId = parseInt(room_id);

  try {
    const student = db.students.findOne(s => s.student_id === sId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const room = db.rooms.findOne(r => r.room_id === rId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    // 1. Check gender restriction match
    if (student.gender !== room.gender_restriction) {
      return res.status(400).json({
        success: false,
        message: `Gender mismatch: Student is ${student.gender} but room is designated for ${room.gender_restriction}s.`
      });
    }

    // 2. Check if student already has active allocation
    const activeAlloc = db.allocations.findOne(a => a.student_id === sId && a.status === 'active');
    if (activeAlloc) {
      return res.status(400).json({ success: false, message: 'Student already has an active room allocation/booking.' });
    }

    // 3. Check general room capacity (max 2 students)
    if (room.current_occupancy >= room.capacity) {
      return res.status(400).json({ success: false, message: 'Selected room is full' });
    }

    // 4. Generate unique Booking Reference Code
    const bookingCode = generateBookingCode();

    // Automatically calculate expected_checkout_date as 1 month from allocation_date if not provided
    if (!expected_checkout_date && allocation_date) {
      const allocD = new Date(allocation_date);
      if (!isNaN(allocD.getTime())) {
        allocD.setMonth(allocD.getMonth() + 1);
        expected_checkout_date = allocD.toISOString().split('T')[0];
      }
    }

    // 5. Create allocation
    const newAlloc = await db.allocations.insert({
      student_id: sId,
      room_id: rId,
      allocation_date: allocation_date,
      expected_checkout_date: expected_checkout_date || null,
      status: 'active',
      booking_code: bookingCode
    });

    // 5b. Create initial completed payment if provided
    if (payment_method && payment_amount && parseFloat(payment_amount) > 0) {
      const billingMonth = allocation_date.slice(0, 7) + '-01'; // YYYY-MM-01
      await db.payments.insert({
        student_id: sId,
        hostel_block: room.block_name,
        fee_category: 'Monthly Bed Payment',
        billing_month: billingMonth,
        amount: parseFloat(payment_amount),
        payment_date: allocation_date,
        status: 'completed',
        payment_method: payment_method,
        remarks: `Initial month booking payment. Ref: ${bookingCode}. Tx: ${payment_reference || 'Cash Admission slip'}`
      });
    }

    // 6. Update room occupancy
    const newOccupancy = room.current_occupancy + 1;
    db.rooms.update(rId, {
      current_occupancy: newOccupancy,
      status: newOccupancy >= room.capacity ? 'occupied' : 'available'
    });

    // 7. Log audit
    await db.auditLogs.insert({
      user_id: req.session.role === 'admin' ? req.session.userId : null,
      action: 'BOOK_ROOM',
      table_name: 'allocations',
      record_id: newAlloc.allocation_id,
      details: `Room ${room.room_number} booked for student ${student.full_name}. Reference: ${bookingCode}`
    });

    res.status(201).json({
      success: true,
      message: 'Room booked successfully!',
      allocation_id: newAlloc.allocation_id,
      booking_code: bookingCode
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// PUT /api/allocations (Allows checking out / updates)
router.put('/', (req, res) => {
  const { allocation_id, status, expected_checkout_date, bed_number } = req.body;

  if (!allocation_id) {
    return res.status(400).json({ success: false, message: 'allocation_id is required' });
  }

  const allocId = parseInt(allocation_id);

  try {
    const alloc = db.allocations.findOne(a => a.allocation_id === allocId);
    if (!alloc) {
      return res.status(404).json({ success: false, message: 'Allocation not found' });
    }

    // Students can only update their own allocations
    if (req.session.role === 'student' && alloc.student_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const previousStatus = alloc.status;
    const updates = {};
    if (status) updates.status = status;
    if (expected_checkout_date !== undefined) updates.expected_checkout_date = expected_checkout_date;

    const success = db.allocations.update(allocId, updates);

    if (success) {
      // If status changed from active to checked_out/inactive
      if (previousStatus === 'active' && status && status !== 'active') {
        const room = db.rooms.findOne(r => r.room_id === alloc.room_id);
        if (room) {
          const newOccupancy = Math.max(0, room.current_occupancy - 1);
          db.rooms.update(room.room_id, {
            current_occupancy: newOccupancy,
            status: newOccupancy < room.capacity ? 'available' : 'occupied'
          });
        }
      } 
      // If status changed back to active
      else if (previousStatus !== 'active' && status === 'active') {
        const room = db.rooms.findOne(r => r.room_id === alloc.room_id);
        if (room) {
          const newOccupancy = room.current_occupancy + 1;
          db.rooms.update(room.room_id, {
            current_occupancy: newOccupancy,
            status: newOccupancy >= room.capacity ? 'occupied' : 'available'
          });
        }
      }

      db.auditLogs.insert({
        user_id: req.session.role === 'admin' ? req.session.userId : null,
        action: 'UPDATE_ALLOCATION',
        table_name: 'allocations',
        record_id: allocId,
        details: `Updated allocation ID ${allocId} status to ${status || previousStatus}`
      });

      res.json({ success: true, message: 'Allocation updated successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update allocation' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// DELETE /api/allocations (Admin only)
router.delete('/', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }

  const allocationId = req.body.allocation_id || req.query.allocation_id;

  if (!allocationId) {
    return res.status(400).json({ success: false, message: 'allocation_id is required' });
  }

  const allocId = parseInt(allocationId);

  try {
    const alloc = db.allocations.findOne(a => a.allocation_id === allocId);
    if (!alloc) {
      return res.status(404).json({ success: false, message: 'Allocation not found' });
    }

    if (alloc.status === 'active') {
      const room = db.rooms.findOne(r => r.room_id === alloc.room_id);
      if (room) {
        const newOccupancy = Math.max(0, room.current_occupancy - 1);
        db.rooms.update(room.room_id, {
          current_occupancy: newOccupancy,
          status: newOccupancy < room.capacity ? 'available' : 'occupied'
        });
      }
    }

    const success = db.allocations.delete(allocId);
    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'DELETE_ALLOCATION',
        table_name: 'allocations',
        record_id: allocId,
        details: `Deleted allocation ID ${allocationId}`
      });

      res.json({ success: true, message: 'Allocation deleted successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to delete allocation' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// GET /api/allocations/swap-candidates (Students can fetch eligible swap targets of same gender)
router.get('/swap-candidates', (req, res) => {
  if (req.session.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Forbidden: Students only' });
  }

  try {
    const student = db.students.findOne(s => s.student_id === req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Get all active or pending_payment allocations for other students
    const allocations = db.allocations.find(a => (a.status === 'active' || a.status === 'pending_payment') && a.student_id !== student.student_id);
    const rooms = db.rooms.find();
    const students = db.students.find(s => s.gender === student.gender && s.student_id !== student.student_id);

    const candidates = [];
    allocations.forEach(alloc => {
      const matchStudent = students.find(s => s.student_id === alloc.student_id);
      const room = rooms.find(r => r.room_id === alloc.room_id);
      if (matchStudent && room) {
        candidates.push({
          student_id: matchStudent.student_id,
          full_name: matchStudent.full_name,
          admission_number: matchStudent.admission_number,
          room_number: room.room_number,
          block_name: room.block_name
        });
      }
    });

    res.json({ success: true, data: candidates });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// POST /api/allocations/transfer (Students submit a transfer or swap request for admin approval)
router.post('/transfer', async (req, res) => {
  if (req.session.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Forbidden: Students only' });
  }

  const sId = req.session.userId;
  const { new_room_id, swap_student_id, reason } = req.body;

  try {
    const student = db.students.findOne(s => s.student_id === sId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const activeAlloc = db.allocations.findOne(a => a.student_id === sId && (a.status === 'active' || a.status === 'pending_payment'));
    if (!activeAlloc) {
      return res.status(400).json({ success: false, message: 'You do not have an active booking to transfer/swap.' });
    }

    // Check if student already has a pending transfer request
    const existingPending = db.transferRequests.findOne(r => r.student_id === sId && r.status === 'pending');
    if (existingPending) {
      return res.status(400).json({ success: false, message: 'You already have a pending room transfer request waiting for admin approval.' });
    }

    // Validate target room or swap partner
    if (swap_student_id) {
      const targetStudentId = parseInt(swap_student_id);
      if (targetStudentId === sId) {
        return res.status(400).json({ success: false, message: 'You cannot swap rooms with yourself.' });
      }

      const targetStudent = db.students.findOne(s => s.student_id === targetStudentId);
      if (!targetStudent) {
        return res.status(404).json({ success: false, message: 'Target student not found.' });
      }

      if (student.gender !== targetStudent.gender) {
        return res.status(400).json({ success: false, message: 'You can only swap rooms with students of the same gender.' });
      }

      const targetAlloc = db.allocations.findOne(a => a.student_id === targetStudentId && (a.status === 'active' || a.status === 'pending_payment'));
      if (!targetAlloc) {
        return res.status(400).json({ success: false, message: 'Target student does not have an active room allocation.' });
      }

      if (targetAlloc.room_id === activeAlloc.room_id) {
        return res.status(400).json({ success: false, message: 'You are already in the same room.' });
      }

      const newReq = await db.transferRequests.insert({
        student_id: sId,
        request_type: 'swap',
        current_room_id: activeAlloc.room_id,
        target_room_id: targetAlloc.room_id,
        swap_student_id: targetStudentId,
        reason: reason || 'Room swap request',
        status: 'pending'
      });

      await db.auditLogs.insert({
        user_id: sId,
        action: 'SUBMIT_SWAP_REQUEST',
        table_name: 'transfer_requests',
        record_id: newReq.request_id,
        details: `Student ${student.full_name} submitted a room swap request with ${targetStudent.full_name}. Pending admin approval.`
      });

      return res.json({
        success: true,
        message: `Swap request submitted successfully! Awaiting admin approval.`
      });
    }

    if (new_room_id) {
      const rId = parseInt(new_room_id);
      if (activeAlloc.room_id === rId) {
        return res.status(400).json({ success: false, message: 'You are already in this room.' });
      }

      const newRoom = db.rooms.findOne(r => r.room_id === rId);
      if (!newRoom) {
        return res.status(404).json({ success: false, message: 'Target room not found.' });
      }

      if (newRoom.current_occupancy >= newRoom.capacity) {
        return res.status(400).json({ success: false, message: 'Target room is full.' });
      }

      if (student.gender !== newRoom.gender_restriction) {
        return res.status(400).json({ success: false, message: `Gender restriction: Room is designated for ${newRoom.gender_restriction}s.` });
      }

      const newReq = await db.transferRequests.insert({
        student_id: sId,
        request_type: 'transfer',
        current_room_id: activeAlloc.room_id,
        target_room_id: rId,
        reason: reason || 'Room transfer request',
        status: 'pending'
      });

      await db.auditLogs.insert({
        user_id: sId,
        action: 'SUBMIT_TRANSFER_REQUEST',
        table_name: 'transfer_requests',
        record_id: newReq.request_id,
        details: `Student ${student.full_name} submitted a transfer request to Room ${newRoom.room_number}. Pending admin approval.`
      });

      return res.json({
        success: true,
        message: `Transfer request to Room ${newRoom.room_number} submitted successfully! Awaiting admin approval.`
      });
    }

    return res.status(400).json({ success: false, message: 'Please specify a target room or student to swap with.' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// GET /api/allocations/transfer-requests (Returns all transfer requests for admin or student)
router.get('/transfer-requests', (req, res) => {
  try {
    let requests = db.transferRequests.find();

    if (req.session.role === 'student') {
      requests = requests.filter(r => r.student_id === req.session.userId);
    }

    const students = db.students.find();
    const rooms = db.rooms.find();

    const data = requests.map(r => {
      const student = students.find(s => s.student_id === r.student_id);
      const currRoom = rooms.find(rm => rm.room_id === r.current_room_id);
      const targetRoom = rooms.find(rm => rm.room_id === r.target_room_id);
      const swapStudent = r.swap_student_id ? students.find(s => s.student_id === r.swap_student_id) : null;

      return {
        ...r,
        student_name: student ? student.full_name : 'Unknown Student',
        admission_number: student ? student.admission_number : 'N/A',
        current_room_number: currRoom ? currRoom.room_number : 'N/A',
        current_block: currRoom ? currRoom.block_name : 'N/A',
        target_room_number: targetRoom ? targetRoom.room_number : 'N/A',
        target_block: targetRoom ? targetRoom.block_name : 'N/A',
        swap_student_name: swapStudent ? swapStudent.full_name : null,
        swap_student_admission: swapStudent ? swapStudent.admission_number : null
      };
    });

    data.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    res.json({ success: true, data: data, count: data.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// POST /api/allocations/transfer-requests/:id/approve (Admin approves transfer/swap request)
router.post('/transfer-requests/:id/approve', async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }

  const reqId = parseInt(req.params.id);

  try {
    const request = db.transferRequests.findOne(r => r.request_id === reqId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Transfer request not found.' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}.` });
    }

    const student = db.students.findOne(s => s.student_id === request.student_id);
    const activeAlloc = db.allocations.findOne(a => a.student_id === request.student_id && (a.status === 'active' || a.status === 'pending_payment'));
    
    if (!activeAlloc) {
      db.transferRequests.update(reqId, { status: 'rejected', admin_remarks: 'Student no longer has an active allocation.' });
      return res.status(400).json({ success: false, message: 'Student no longer has an active allocation.' });
    }

    const oldRoom = db.rooms.findOne(r => r.room_id === activeAlloc.room_id);

    if (request.request_type === 'swap') {
      const targetStudentId = request.swap_student_id;
      const targetAlloc = db.allocations.findOne(a => a.student_id === targetStudentId && (a.status === 'active' || a.status === 'pending_payment'));
      
      if (!targetAlloc) {
        db.transferRequests.update(reqId, { status: 'rejected', admin_remarks: 'Swap target student no longer has an active allocation.' });
        return res.status(400).json({ success: false, message: 'Swap target student no longer has an active allocation.' });
      }

      const roomA = activeAlloc.room_id;
      const roomB = targetAlloc.room_id;

      db.allocations.update(activeAlloc.allocation_id, { room_id: roomB });
      db.allocations.update(targetAlloc.allocation_id, { room_id: roomA });
      db.transferRequests.update(reqId, { status: 'approved' });

      await db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'APPROVE_ROOM_SWAP',
        table_name: 'allocations',
        record_id: reqId,
        details: `Admin approved room swap between ${student ? student.full_name : 'Student'} and target student.`
      });

      return res.json({ success: true, message: 'Room swap request approved and executed successfully!' });
    } else {
      // Room Transfer
      const targetRoom = db.rooms.findOne(r => r.room_id === request.target_room_id);
      if (!targetRoom) {
        return res.status(404).json({ success: false, message: 'Target room not found.' });
      }

      if (targetRoom.current_occupancy >= targetRoom.capacity) {
        return res.status(400).json({ success: false, message: 'Target room is currently full.' });
      }

      // Decrement old room
      if (oldRoom) {
        const oldOccupancy = Math.max(0, oldRoom.current_occupancy - 1);
        db.rooms.update(oldRoom.room_id, {
          current_occupancy: oldOccupancy,
          status: 'available'
        });
      }

      // Increment new room
      const newOccupancy = targetRoom.current_occupancy + 1;
      db.rooms.update(targetRoom.room_id, {
        current_occupancy: newOccupancy,
        status: newOccupancy >= targetRoom.capacity ? 'occupied' : 'available'
      });

      // Update student allocation record
      db.allocations.update(activeAlloc.allocation_id, { room_id: targetRoom.room_id });
      db.transferRequests.update(reqId, { status: 'approved' });

      await db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'APPROVE_ROOM_TRANSFER',
        table_name: 'allocations',
        record_id: reqId,
        details: `Admin approved room transfer for ${student ? student.full_name : 'Student'} to Room ${targetRoom.room_number}.`
      });

      return res.json({ success: true, message: `Room transfer to ${targetRoom.room_number} approved and updated successfully!` });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/allocations/transfer-requests/:id/reject (Admin rejects request)
router.post('/transfer-requests/:id/reject', async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  }

  const reqId = parseInt(req.params.id);
  const { remarks } = req.body;

  try {
    const request = db.transferRequests.findOne(r => r.request_id === reqId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Transfer request not found.' });
    }

    db.transferRequests.update(reqId, {
      status: 'rejected',
      admin_remarks: remarks || 'Rejected by administration.'
    });

    await db.auditLogs.insert({
      user_id: req.session.userId,
      action: 'REJECT_TRANSFER_REQUEST',
      table_name: 'transfer_requests',
      record_id: reqId,
      details: `Admin rejected transfer request #${reqId}`
    });

    res.json({ success: true, message: 'Transfer request rejected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// DELETE /api/allocations/transfer-requests/:id (Student or Admin cancels request)
router.delete('/transfer-requests/:id', async (req, res) => {
  const reqId = parseInt(req.params.id);

  try {
    const request = db.transferRequests.findOne(r => r.request_id === reqId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Transfer request not found.' });
    }

    if (req.session.role === 'student' && request.student_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    db.transferRequests.delete(reqId);

    await db.auditLogs.insert({
      user_id: req.session.userId,
      action: 'CANCEL_TRANSFER_REQUEST',
      table_name: 'transfer_requests',
      record_id: reqId,
      details: `Cancelled transfer request #${reqId}`
    });

    res.json({ success: true, message: 'Transfer request cancelled.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

module.exports = router;
