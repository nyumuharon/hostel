const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dataDir = path.resolve(__dirname, './data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const filePaths = {
  users: path.join(dataDir, 'users.json'),
  students: path.join(dataDir, 'students.json'),
  rooms: path.join(dataDir, 'rooms.json'),
  allocations: path.join(dataDir, 'allocations.json'),
  fee_payments: path.join(dataDir, 'fee_payments.json'),
  audit_logs: path.join(dataDir, 'audit_logs.json')
};

// Helper to read data from a file
function readData(table) {
  const filePath = filePaths[table];
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (error) {
    console.error(`Error reading ${table} database:`, error);
    return [];
  }
}

// Helper to write data to a file
function writeData(table, data) {
  const filePath = filePaths[table];
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing ${table} database:`, error);
  }
}

// Database helper functions
const db = {
  // Users
  users: {
    find: (filterFn) => readData('users').filter(filterFn),
    findOne: (filterFn) => readData('users').find(filterFn),
    insert: (user) => {
      const users = readData('users');
      const nextId = users.length > 0 ? Math.max(...users.map(u => u.user_id)) + 1 : 1;
      const newUser = {
        user_id: nextId,
        ...user,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      users.push(newUser);
      writeData('users', users);
      return newUser;
    }
  },

  // Students
  students: {
    find: (filterFn) => {
      const students = readData('students');
      return filterFn ? students.filter(filterFn) : students;
    },
    findOne: (filterFn) => readData('students').find(filterFn),
    insert: (student) => {
      const students = readData('students');
      const nextId = students.length > 0 ? Math.max(...students.map(s => s.student_id)) + 1 : 1;
      const newStudent = {
        student_id: nextId,
        ...student,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      students.push(newStudent);
      writeData('students', students);
      return newStudent;
    },
    update: (studentId, updates) => {
      const students = readData('students');
      const idx = students.findIndex(s => s.student_id === parseInt(studentId));
      if (idx !== -1) {
        students[idx] = {
          ...students[idx],
          ...updates,
          updated_at: new Date().toISOString()
        };
        writeData('students', students);
        return true;
      }
      return false;
    },
    delete: (studentId) => {
      let students = readData('students');
      const initialLength = students.length;
      students = students.filter(s => s.student_id !== parseInt(studentId));
      writeData('students', students);
      return students.length < initialLength;
    }
  },

  // Rooms
  rooms: {
    find: (filterFn) => {
      const rooms = readData('rooms');
      return filterFn ? rooms.filter(filterFn) : rooms;
    },
    findOne: (filterFn) => readData('rooms').find(filterFn),
    insert: (room) => {
      const rooms = readData('rooms');
      const nextId = rooms.length > 0 ? Math.max(...rooms.map(r => r.room_id)) + 1 : 1;
      const newRoom = {
        room_id: nextId,
        ...room,
        current_occupancy: parseInt(room.current_occupancy || 0),
        capacity: parseInt(room.capacity || 1),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      rooms.push(newRoom);
      writeData('rooms', rooms);
      return newRoom;
    },
    update: (roomId, updates) => {
      const rooms = readData('rooms');
      const idx = rooms.findIndex(r => r.room_id === parseInt(roomId));
      if (idx !== -1) {
        rooms[idx] = {
          ...rooms[idx],
          ...updates,
          current_occupancy: updates.current_occupancy !== undefined ? parseInt(updates.current_occupancy) : rooms[idx].current_occupancy,
          capacity: updates.capacity !== undefined ? parseInt(updates.capacity) : rooms[idx].capacity,
          updated_at: new Date().toISOString()
        };
        writeData('rooms', rooms);
        return true;
      }
      return false;
    },
    delete: (roomId) => {
      let rooms = readData('rooms');
      const initialLength = rooms.length;
      rooms = rooms.filter(r => r.room_id !== parseInt(roomId));
      writeData('rooms', rooms);
      return rooms.length < initialLength;
    }
  },

  // Allocations
  allocations: {
    find: (filterFn) => {
      const allocations = readData('allocations');
      return filterFn ? allocations.filter(filterFn) : allocations;
    },
    findOne: (filterFn) => readData('allocations').find(filterFn),
    insert: (allocation) => {
      const allocations = readData('allocations');
      const nextId = allocations.length > 0 ? Math.max(...allocations.map(a => a.allocation_id)) + 1 : 1;
      const newAllocation = {
        allocation_id: nextId,
        ...allocation,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      allocations.push(newAllocation);
      writeData('allocations', allocations);
      return newAllocation;
    },
    update: (allocationId, updates) => {
      const allocations = readData('allocations');
      const idx = allocations.findIndex(a => a.allocation_id === parseInt(allocationId));
      if (idx !== -1) {
        allocations[idx] = {
          ...allocations[idx],
          ...updates,
          updated_at: new Date().toISOString()
        };
        writeData('allocations', allocations);
        return true;
      }
      return false;
    },
    delete: (allocationId) => {
      let allocations = readData('allocations');
      const initialLength = allocations.length;
      allocations = allocations.filter(a => a.allocation_id !== parseInt(allocationId));
      writeData('allocations', allocations);
      return allocations.length < initialLength;
    }
  },

  // Fee Payments
  payments: {
    find: (filterFn) => {
      const payments = readData('fee_payments');
      return filterFn ? payments.filter(filterFn) : payments;
    },
    findOne: (filterFn) => readData('fee_payments').find(filterFn),
    insert: (payment) => {
      const payments = readData('fee_payments');
      const nextId = payments.length > 0 ? Math.max(...payments.map(p => p.payment_id)) + 1 : 1;
      const newPayment = {
        payment_id: nextId,
        ...payment,
        amount: parseFloat(payment.amount),
        created_at: new Date().toISOString()
      };
      payments.push(newPayment);
      writeData('fee_payments', payments);
      return newPayment;
    },
    update: (paymentId, updates) => {
      const payments = readData('fee_payments');
      const idx = payments.findIndex(p => p.payment_id === parseInt(paymentId));
      if (idx !== -1) {
        payments[idx] = {
          ...payments[idx],
          ...updates,
          amount: updates.amount !== undefined ? parseFloat(updates.amount) : payments[idx].amount
        };
        writeData('fee_payments', payments);
        return true;
      }
      return false;
    },
    delete: (paymentId) => {
      let payments = readData('fee_payments');
      const initialLength = payments.length;
      payments = payments.filter(p => p.payment_id !== parseInt(paymentId));
      writeData('fee_payments', payments);
      return payments.length < initialLength;
    }
  },

  // Audit Logs
  auditLogs: {
    find: (filterFn) => {
      const logs = readData('audit_logs');
      return filterFn ? logs.filter(filterFn) : logs;
    },
    insert: (log) => {
      const logs = readData('audit_logs');
      const nextId = logs.length > 0 ? Math.max(...logs.map(l => l.log_id)) + 1 : 1;
      const newLog = {
        log_id: nextId,
        ...log,
        created_at: new Date().toISOString()
      };
      logs.push(newLog);
      writeData('audit_logs', logs);
      return newLog;
    }
  },
  
  checkAndExpireLeases: () => {
    // Read databases directly
    const allocations = readData('allocations');
    const rooms = readData('rooms');
    const auditLogs = readData('audit_logs');
    
    const nowStr = new Date().toISOString().split('T')[0];
    let updatedAllocations = false;
    let updatedRooms = false;

    allocations.forEach(alloc => {
      if (alloc.status === 'pending_payment' && alloc.lease_expires_at && nowStr > alloc.lease_expires_at) {
        alloc.status = 'cancelled';
        alloc.updated_at = new Date().toISOString();
        updatedAllocations = true;
        
        // Decrement room occupancy
        const roomIdx = rooms.findIndex(r => r.room_id === alloc.room_id);
        if (roomIdx !== -1) {
          rooms[roomIdx].current_occupancy = Math.max(0, rooms[roomIdx].current_occupancy - 1);
          rooms[roomIdx].status = 'available';
          rooms[roomIdx].updated_at = new Date().toISOString();
          updatedRooms = true;
        }

        // Add audit log
        auditLogs.push({
          log_id: auditLogs.length > 0 ? Math.max(...auditLogs.map(l => l.log_id || l.audit_id || 1)) + 1 : 1,
          user_id: null,
          action: 'LEASE_EXPIRED',
          table_name: 'allocations',
          record_id: alloc.allocation_id,
          details: `5-day unpaid lease expired for booking code ${alloc.booking_code}. Room released back to pool.`,
          created_at: new Date().toISOString()
        });
      }
    });

    if (updatedAllocations) writeData('allocations', allocations);
    if (updatedRooms) writeData('rooms', rooms);
    if (updatedAllocations) writeData('audit_logs', auditLogs);
  }
};

// Database Initialization and Seeding
async function initializeDatabase() {
  console.log('Initializing JSON File-Based Database...');

  // Initialize empty files if they do not exist
  for (const table of Object.keys(filePaths)) {
    if (!fs.existsSync(filePaths[table])) {
      writeData(table, []);
    }
  }

  // Seed default admin user
  const adminExists = db.users.findOne(u => u.username === 'admin');
  if (!adminExists) {
    const adminPassword = 'admin123';
    const adminHash = await bcrypt.hash(adminPassword, 10);
    db.users.insert({
      username: 'admin',
      password: adminHash,
      email: 'admin@hostel.com',
      full_name: 'Administrator',
      role: 'admin'
    });
    console.log('✓ Default admin user seeded (admin / admin123)');
  }

  // Seed sample students
  const students = db.students.find();
  if (students.length === 0) {
    const studentPassword = await bcrypt.hash('student123', 10);
    const sampleStudents = [
      { admission_number: 'ADM001', password: studentPassword, gender: 'male', full_name: 'John Kiprop', email: 'john@example.com', phone: '0712345678', course: 'Computer Science', date_of_admission: '2024-01-10', next_of_kin_name: 'Mary Kiprop', next_of_kin_phone: '0723456789', status: 'active' },
      { admission_number: 'ADM002', password: studentPassword, gender: 'female', full_name: 'Grace Wambui', email: 'grace@example.com', phone: '0712345689', course: 'Business Studies', date_of_admission: '2024-02-15', next_of_kin_name: 'Joseph Wambui', next_of_kin_phone: '0734567890', status: 'active' },
      { admission_number: 'ADM003', password: studentPassword, gender: 'male', full_name: 'Daniel Otieno', email: 'daniel@example.com', phone: '0712345690', course: 'Engineering', date_of_admission: '2024-03-20', next_of_kin_name: 'Rose Otieno', next_of_kin_phone: '0745678901', status: 'active' }
    ];

    for (const student of sampleStudents) {
      db.students.insert(student);
    }
    console.log('✓ Sample students seeded with login credentials');
  }

  // Seed sample rooms
  const rooms = db.rooms.find();
  if (rooms.length === 0) {
    // Batian = Male, Nelion = Female, Lenana = split (rooms 1-5 Male, 6-10 Female)
    const blockDefinitions = [
      ['Batian', 'Double', 2, 'available', 1, 'BAT-', 'male'],
      ['Nelion', 'Double', 2, 'available', 1, 'NEL-', 'female'],
      ['Lenana', 'Double', 2, 'available', 1, 'LEN-', 'split']
    ];

    for (const block of blockDefinitions) {
      const [blockName, roomType, capacity, status, floor, prefix, genderPolicy] = block;
      for (let i = 1; i <= 10; i++) {
        const roomNumber = prefix + String(i).padStart(3, '0');
        
        let genderRestriction = genderPolicy;
        if (genderPolicy === 'split') {
          genderRestriction = i <= 5 ? 'male' : 'female';
        }

        db.rooms.insert({
          room_number: roomNumber,
          room_type: roomType,
          capacity: parseInt(capacity),
          current_occupancy: 0,
          status: status,
          floor: parseInt(floor),
          block_name: blockName,
          gender_restriction: genderRestriction,
          amenities: `${blockName} block hostel room (${genderRestriction} restriction)`
        });
      }
    }
    console.log('✓ Sample rooms seeded for Batian (male), Nelion (female), and Lenana (split) blocks');
  }

  console.log('JSON database initialization complete.');
}

module.exports = {
  db,
  initializeDatabase
};
