const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.use((req, res, next) => {
  db.checkAndExpireLeases();
  next();
});

// GET /api/rooms (Supports filtering by gender or block)
router.get('/', (req, res) => {
  try {
    let rooms = db.rooms.find();
    
    // Check if there is an active session or a public query filter
    const genderQuery = req.query.gender;
    const sessionGender = req.session ? req.session.gender : null;
    const role = req.session ? req.session.role : null;
    
    // If student role is active, force gender matching
    if (role === 'student' && sessionGender) {
      rooms = rooms.filter(r => r.gender_restriction === sessionGender);
    } else if (genderQuery) {
      rooms = rooms.filter(r => r.gender_restriction === genderQuery.toLowerCase());
    }

    const blockQuery = req.query.block_name;
    if (blockQuery) {
      rooms = rooms.filter(r => r.block_name.toLowerCase() === blockQuery.toLowerCase());
    }

    // Sort alphabetically by room_number
    rooms.sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''));
    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// Middleware to check authentication for modifying endpoints
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

// POST /api/rooms (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  let {
    room_number,
    room_type,
    capacity,
    current_occupancy,
    status,
    floor,
    block_name,
    gender_restriction,
    amenities
  } = req.body;

  const blockMap = {
    'Batian': { type: 'Double', capacity: 2, prefix: 'BAT-', gender: 'male' },
    'Nelion': { type: 'Double', capacity: 2, prefix: 'NEL-', gender: 'female' }
  };

  if (blockMap[block_name]) {
    const preset = blockMap[block_name];
    if (!room_type) room_type = preset.type;
    if (!capacity || parseInt(capacity) <= 0) capacity = preset.capacity;
    if (!gender_restriction) gender_restriction = preset.gender;
    
    if (!room_number) {
      const blockRooms = db.rooms.find(r => r.block_name === block_name);
      const nextNum = blockRooms.length + 1;
      room_number = preset.prefix + String(nextNum).padStart(3, '0');
    } else {
      room_number = String(room_number).trim();
      if (!room_number.startsWith(preset.prefix)) {
        room_number = preset.prefix + room_number;
      }
    }
  } else {
    if (!room_number || !room_type || !capacity || !gender_restriction) {
      return res.status(400).json({ success: false, message: "Fields 'room_number', 'room_type', 'capacity', and 'gender_restriction' are required" });
    }
    room_number = String(room_number).trim();
  }

  try {
    const existing = db.rooms.findOne(r => r.room_number.toLowerCase() === room_number.toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, message: 'This room number already exists. Please choose another one.' });
    }

    const newRoom = await db.rooms.insert({
      room_number: room_number,
      room_type: room_type,
      capacity: parseInt(capacity),
      current_occupancy: parseInt(current_occupancy || 0),
      status: status || 'available',
      floor: floor ? parseInt(floor) : 1,
      block_name: block_name || null,
      gender_restriction: gender_restriction.toLowerCase() === 'female' ? 'female' : 'male',
      amenities: amenities || ''
    });

    await db.auditLogs.insert({
      user_id: req.session.userId,
      action: 'CREATE_ROOM',
      table_name: 'rooms',
      record_id: newRoom.room_id,
      details: `Created room ${newRoom.room_number} (${newRoom.gender_restriction} restriction)`
    });

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      room_id: newRoom.room_id
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// PUT /api/rooms (Admin only)
router.put('/', requireAuth, requireAdmin, (req, res) => {
  let {
    room_id,
    room_number,
    room_type,
    capacity,
    current_occupancy,
    status,
    floor,
    block_name,
    gender_restriction,
    amenities
  } = req.body;

  if (!room_id) {
    return res.status(400).json({ success: false, message: 'room_id is required' });
  }

  try {
    const room = db.rooms.findOne(r => r.room_id === parseInt(room_id));
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (room_number && room_number !== room.room_number) {
      const existing = db.rooms.findOne(r => r.room_number.toLowerCase() === room_number.toLowerCase());
      if (existing) {
        return res.status(400).json({ success: false, message: 'This room number already exists. Please choose another one.' });
      }
    }

    const success = db.rooms.update(room_id, {
      room_number: room_number || room.room_number,
      room_type: room_type || room.room_type,
      capacity: capacity !== undefined ? parseInt(capacity) : room.capacity,
      current_occupancy: current_occupancy !== undefined ? parseInt(current_occupancy) : room.current_occupancy,
      status: status || room.status,
      floor: floor !== undefined ? parseInt(floor) : room.floor,
      block_name: block_name !== undefined ? block_name : room.block_name,
      gender_restriction: gender_restriction ? (gender_restriction.toLowerCase() === 'female' ? 'female' : 'male') : room.gender_restriction,
      amenities: amenities !== undefined ? amenities : room.amenities
    });

    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'UPDATE_ROOM',
        table_name: 'rooms',
        record_id: parseInt(room_id),
        details: `Updated room ${room_number || room.room_number}`
      });

      res.json({ success: true, message: 'Room updated successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update room' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

// DELETE /api/rooms (Admin only)
router.delete('/', requireAuth, requireAdmin, (req, res) => {
  const roomId = req.body.room_id || req.query.room_id;

  if (!roomId) {
    return res.status(400).json({ success: false, message: 'room_id is required' });
  }

  try {
    const activeAllocations = db.allocations.find(a => a.room_id === parseInt(roomId) && a.status === 'active');
    if (activeAllocations.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete room: it has active student allocations. Remove allocations first.' });
    }

    const success = db.rooms.delete(roomId);
    if (success) {
      db.auditLogs.insert({
        user_id: req.session.userId,
        action: 'DELETE_ROOM',
        table_name: 'rooms',
        record_id: parseInt(roomId),
        details: `Deleted room ID ${roomId}`
      });

      res.json({ success: true, message: 'Room deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Room not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

module.exports = router;
