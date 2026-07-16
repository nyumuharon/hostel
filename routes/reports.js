const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
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
  return Math.max(1, (yearsDiff * 12) + monthsDiff + 1);
}

const blockRates = { Batian: 50000, Nelion: 30000, Lenana: 20000 };

// GET /api/reports - summary data, room occupancy list, and monthly payment stats
router.get('/', (req, res) => {
  try {
    const students = db.students.find();
    const rooms = db.rooms.find();
    const payments = db.payments.find();

    const activeStudents = students.filter(s => s.status === 'active').length;
    const totalRooms = rooms.length;
    const capacity = rooms.reduce((acc, r) => acc + (r.capacity || 0), 0);
    const occupied = rooms.reduce((acc, r) => acc + (r.current_occupancy || 0), 0);
    
    const collected = payments
      .filter(p => p.status === 'completed')
      .reduce((acc, p) => acc + (p.amount || 0), 0);
      
    const pending = payments
      .filter(p => p.status === 'pending')
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const availableBeds = Math.max(0, capacity - occupied);
    const occupancyRate = capacity > 0 ? parseFloat(((occupied / capacity) * 100).toFixed(1)) : 0;

    const summary = {
      students: students.length,
      active_students: activeStudents,
      rooms: totalRooms,
      capacity: capacity,
      occupied: occupied,
      collected: collected,
      pending: pending,
      available_beds: availableBeds,
      occupancy_rate: occupancyRate
    };

    const roomOccupancies = rooms.map(r => {
      const avail = Math.max(0, r.capacity - r.current_occupancy);
      let status = 'Occupied';
      if (r.current_occupancy >= r.capacity) status = 'Full';
      else if (r.current_occupancy === 0) status = 'Empty';

      return {
        room_number: r.room_number,
        room_type: r.room_type,
        capacity: r.capacity,
        current_occupancy: r.current_occupancy,
        available_beds: avail,
        occupancy_status: status,
        gender_restriction: r.gender_restriction
      };
    });
    roomOccupancies.sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''));

    const monthlyGroups = {};
    payments
      .filter(p => p.status === 'completed')
      .forEach(p => {
        const dateStr = p.payment_date;
        if (dateStr) {
          const parts = dateStr.split('-');
          if (parts.length >= 2) {
            const year = parts[0];
            const monthIdx = parseInt(parts[1]) - 1;
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const label = `${months[monthIdx]} ${year}`;
            const key = `${year}-${parts[1]}`;
            
            if (!monthlyGroups[key]) {
              monthlyGroups[key] = { key: key, period: label, total: 0 };
            }
            monthlyGroups[key].total += p.amount;
          }
        }
      });

    const sortedPayments = Object.values(monthlyGroups);
    sortedPayments.sort((a, b) => a.key.localeCompare(b.key));
    const recentPayments = sortedPayments.slice(-12).map(p => ({
      period: p.period,
      total: p.total
    }));

    res.json({
      success: true,
      summary: summary,
      rooms: roomOccupancies,
      monthly_payments: recentPayments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// GET /api/reports/dashboard-stats - counts and lists specifically for the main dashboard
router.get('/dashboard-stats', (req, res) => {
  try {
    const students = db.students.find();
    const rooms = db.rooms.find();
    const payments = db.payments.find();
    const allocations = db.allocations.find();

    const activeStudents = students.filter(s => s.status === 'active').length;
    const totalRooms = rooms.length;
    const totalBeds = rooms.reduce((acc, r) => acc + (r.capacity || 0), 0);
    const occupiedBeds = rooms.reduce((acc, r) => acc + (r.current_occupancy || 0), 0);
    const availableBeds = Math.max(0, totalBeds - occupiedBeds);
    
    const totalPayments = payments
      .filter(p => p.status === 'completed')
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const stats = {
      total_students: activeStudents,
      all_students: students.length,
      total_rooms: totalRooms,
      total_beds: totalBeds,
      occupied_beds: occupiedBeds,
      available_beds: availableBeds,
      total_payments: totalPayments
    };

    // Calculate remaining beds by blocks
    const blocksStats = {
      Batian: { total: 0, occupied: 0, gender: 'male' },
      Nelion: { total: 0, occupied: 0, gender: 'female' },
      Lenana: { total: 0, occupied: 0, gender: 'split' }
    };
    rooms.forEach(r => {
      if (blocksStats[r.block_name]) {
        blocksStats[r.block_name].total += r.capacity;
        blocksStats[r.block_name].occupied += r.current_occupancy;
      }
    });

    // Recent student registrations (last 5, sorted by created_at desc)
    const recentStudents = [...students]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 5)
      .map(s => ({
        admission_number: s.admission_number,
        full_name: s.full_name,
        course: s.course,
        gender: s.gender,
        created_at: s.created_at
      }));

    // Recent room allocations (last 5)
    const sortedAllocations = [...allocations]
      .sort((a, b) => (b.allocation_date || '').localeCompare(a.allocation_date || ''))
      .slice(0, 5);

    const recentAllocations = sortedAllocations.map(a => {
      const student = students.find(s => s.student_id === a.student_id);
      const room = rooms.find(r => r.room_id === a.room_id);
      return {
        allocation_date: a.allocation_date,
        full_name: student ? student.full_name : 'Unknown Student',
        room_number: room ? room.room_number : 'N/A',
        room_type: room ? room.room_type : 'N/A',
        booking_code: a.booking_code || 'N/A'
      };
    });

    res.json({
      success: true,
      stats: stats,
      blocks_stats: blocksStats,
      recent_students: recentStudents,
      recent_allocations: recentAllocations
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// GET /api/reports/ledgers (Admin only - returns balance ledgers for all active students)
router.get('/ledgers', requireAdmin, (req, res) => {
  try {
    const students = db.students.find(s => s.status === 'active');
    const rooms = db.rooms.find();
    const payments = db.payments.find();
    const allocations = db.allocations.find(a => a.status === 'active');

    const ledgers = students.map(student => {
      // Find active allocations
      const sAllocations = allocations.filter(a => a.student_id === student.student_id);
      const sPayments = payments.filter(p => p.student_id === student.student_id && p.status === 'completed');

      const totalPaid = sPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
      let totalCharged = 0;

      sAllocations.forEach(alloc => {
        const room = rooms.find(r => r.room_id === alloc.room_id);
        if (room) {
          const rate = blockRates[room.block_name] || 0;
          const months = getBillingMonths(alloc.allocation_date);
          totalCharged += rate * months;
        }
      });

      const balance = totalPaid - totalCharged;

      return {
        student_id: student.student_id,
        full_name: student.full_name,
        admission_number: student.admission_number,
        gender: student.gender,
        total_paid: totalPaid,
        total_charged: totalCharged,
        balance: balance,
        status: balance >= 0 ? 'paid' : 'due',
        allocated_room: sAllocations.length > 0 ? rooms.find(r => r.room_id === sAllocations[0].room_id)?.room_number || '-' : 'Not allocated'
      };
    });

    // Sort ledgers: show students with outstanding dues first (negative balances)
    ledgers.sort((a, b) => a.balance - b.balance);

    res.json({
      success: true,
      data: ledgers
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

module.exports = router;
