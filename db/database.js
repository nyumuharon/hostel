const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

async function nextId(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

// Users
const userSchema = new mongoose.Schema({
  user_id:    { type: Number, unique: true },
  username:   { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  email:      String,
  full_name:  String,
  role:       { type: String, default: 'admin' },
  created_at: { type: String, default: () => new Date().toISOString() },
  updated_at: { type: String, default: () => new Date().toISOString() }
});
const User = mongoose.model('User', userSchema);

// Students
const studentSchema = new mongoose.Schema({
  student_id:        { type: Number, unique: true },
  admission_number:  { type: String, required: true, unique: true },
  password:          String,
  gender:            String,
  full_name:         String,
  email:             String,
  phone:             String,
  course:            String,
  date_of_admission: String,
  next_of_kin_name:  String,
  next_of_kin_phone: String,
  status:            { type: String, default: 'active' },
  created_at: { type: String, default: () => new Date().toISOString() },
  updated_at: { type: String, default: () => new Date().toISOString() }
});
const Student = mongoose.model('Student', studentSchema);

// Rooms
const roomSchema = new mongoose.Schema({
  room_id:           { type: Number, unique: true },
  room_number:       { type: String, required: true, unique: true },
  room_type:         String,
  capacity:          { type: Number, default: 2 },
  current_occupancy: { type: Number, default: 0 },
  status:            { type: String, default: 'available' },
  floor:             Number,
  block_name:        String,
  gender_restriction:String,
  amenities:         String,
  created_at: { type: String, default: () => new Date().toISOString() },
  updated_at: { type: String, default: () => new Date().toISOString() }
});
const Room = mongoose.model('Room', roomSchema);

// Allocations
const allocationSchema = new mongoose.Schema({
  allocation_id:         { type: Number, unique: true },
  student_id:            Number,
  room_id:               Number,
  allocation_date:       String,
  expected_checkout_date:String,
  status:                { type: String, default: 'active' },
  booking_code:          String,
  lease_expires_at:      String,
  created_at: { type: String, default: () => new Date().toISOString() },
  updated_at: { type: String, default: () => new Date().toISOString() }
});
const Allocation = mongoose.model('Allocation', allocationSchema);

// Payments
const paymentSchema = new mongoose.Schema({
  payment_id:     { type: Number, unique: true },
  student_id:     Number,
  hostel_block:   String,
  fee_category:   String,
  billing_month:  String,
  due_date:       String,
  amount:         Number,
  payment_date:   String,
  status:         { type: String, default: 'completed' },
  payment_method: String,
  remarks:        String,
  created_at: { type: String, default: () => new Date().toISOString() }
});
const Payment = mongoose.model('Payment', paymentSchema);

// Audit Logs
const auditLogSchema = new mongoose.Schema({
  log_id:     { type: Number, unique: true },
  user_id:    mongoose.Schema.Types.Mixed,
  action:     String,
  table_name: String,
  record_id:  Number,
  details:    String,
  created_at: { type: String, default: () => new Date().toISOString() }
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ─── In-memory cache (populated at startup) ───────────────────────────────────
let cache = {
  users: [],
  students: [],
  rooms: [],
  allocations: [],
  payments: [],
  audit_logs: []
};

async function loadCache() {
  cache.users       = (await User.find().lean()).map(mongoToPlain);
  cache.students    = (await Student.find().lean()).map(mongoToPlain);
  cache.rooms       = (await Room.find().lean()).map(mongoToPlain);
  cache.allocations = (await Allocation.find().lean()).map(mongoToPlain);
  cache.payments    = (await Payment.find().lean()).map(mongoToPlain);
  cache.audit_logs  = (await AuditLog.find().lean()).map(mongoToPlain);
}

function mongoToPlain(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return rest;
}

// ─── Async write helpers (fire-and-forget) ────────────────────────────────────

function saveUser(data)       { User.findOneAndUpdate({ user_id: data.user_id }, data, { upsert: true }).exec().catch(console.error); }
function saveStudent(data)    { Student.findOneAndUpdate({ student_id: data.student_id }, data, { upsert: true }).exec().catch(console.error); }
function saveRoom(data)       { Room.findOneAndUpdate({ room_id: data.room_id }, data, { upsert: true }).exec().catch(console.error); }
function saveAllocation(data) { Allocation.findOneAndUpdate({ allocation_id: data.allocation_id }, data, { upsert: true }).exec().catch(console.error); }
function savePayment(data)    { Payment.findOneAndUpdate({ payment_id: data.payment_id }, data, { upsert: true }).exec().catch(console.error); }
function saveAuditLog(data)   { AuditLog.findOneAndUpdate({ log_id: data.log_id }, data, { upsert: true }).exec().catch(console.error); }

function deleteFromDB(Model, query) { Model.deleteOne(query).exec().catch(console.error); }

// ─── Public db API (mirrors original JSON-file API, all sync) ─────────────────

const db = {
  users: {
    find:    (fn) => fn ? cache.users.filter(fn) : cache.users,
    findOne: (fn) => cache.users.find(fn) || null,
    insert:  async (data) => {
      const id = await nextId('user_id');
      const obj = { user_id: id, ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      cache.users.push(obj);
      saveUser(obj);
      return obj;
    }
  },

  students: {
    find:    (fn) => fn ? cache.students.filter(fn) : [...cache.students],
    findOne: (fn) => cache.students.find(fn) || null,
    insert:  async (data) => {
      const id = await nextId('student_id');
      const obj = { student_id: id, ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      cache.students.push(obj);
      saveStudent(obj);
      return obj;
    },
    update: (studentId, updates) => {
      const idx = cache.students.findIndex(s => s.student_id === parseInt(studentId));
      if (idx === -1) return false;
      cache.students[idx] = { ...cache.students[idx], ...updates, updated_at: new Date().toISOString() };
      saveStudent(cache.students[idx]);
      return true;
    },
    delete: (studentId) => {
      const before = cache.students.length;
      cache.students = cache.students.filter(s => s.student_id !== parseInt(studentId));
      if (cache.students.length < before) {
        deleteFromDB(Student, { student_id: parseInt(studentId) });
        return true;
      }
      return false;
    }
  },

  rooms: {
    find:    (fn) => fn ? cache.rooms.filter(fn) : [...cache.rooms],
    findOne: (fn) => cache.rooms.find(fn) || null,
    insert:  async (data) => {
      const id = await nextId('room_id');
      const obj = {
        room_id: id, ...data,
        current_occupancy: parseInt(data.current_occupancy || 0),
        capacity: parseInt(data.capacity || 2),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.rooms.push(obj);
      saveRoom(obj);
      return obj;
    },
    update: (roomId, updates) => {
      const idx = cache.rooms.findIndex(r => r.room_id === parseInt(roomId));
      if (idx === -1) return false;
      cache.rooms[idx] = {
        ...cache.rooms[idx], ...updates,
        current_occupancy: updates.current_occupancy !== undefined ? parseInt(updates.current_occupancy) : cache.rooms[idx].current_occupancy,
        capacity: updates.capacity !== undefined ? parseInt(updates.capacity) : cache.rooms[idx].capacity,
        updated_at: new Date().toISOString()
      };
      saveRoom(cache.rooms[idx]);
      return true;
    },
    delete: (roomId) => {
      const before = cache.rooms.length;
      cache.rooms = cache.rooms.filter(r => r.room_id !== parseInt(roomId));
      if (cache.rooms.length < before) {
        deleteFromDB(Room, { room_id: parseInt(roomId) });
        return true;
      }
      return false;
    }
  },

  allocations: {
    find:    (fn) => fn ? cache.allocations.filter(fn) : [...cache.allocations],
    findOne: (fn) => cache.allocations.find(fn) || null,
    insert:  async (data) => {
      const id = await nextId('allocation_id');
      const obj = { allocation_id: id, ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      cache.allocations.push(obj);
      saveAllocation(obj);
      return obj;
    },
    update: (allocId, updates) => {
      const idx = cache.allocations.findIndex(a => a.allocation_id === parseInt(allocId));
      if (idx === -1) return false;
      cache.allocations[idx] = { ...cache.allocations[idx], ...updates, updated_at: new Date().toISOString() };
      saveAllocation(cache.allocations[idx]);
      return true;
    },
    delete: (allocId) => {
      const before = cache.allocations.length;
      cache.allocations = cache.allocations.filter(a => a.allocation_id !== parseInt(allocId));
      if (cache.allocations.length < before) {
        deleteFromDB(Allocation, { allocation_id: parseInt(allocId) });
        return true;
      }
      return false;
    }
  },

  payments: {
    find:    (fn) => fn ? cache.payments.filter(fn) : [...cache.payments],
    findOne: (fn) => cache.payments.find(fn) || null,
    insert:  async (data) => {
      const id = await nextId('payment_id');
      const obj = { payment_id: id, ...data, amount: parseFloat(data.amount), created_at: new Date().toISOString() };
      cache.payments.push(obj);
      savePayment(obj);
      return obj;
    },
    update: (paymentId, updates) => {
      const idx = cache.payments.findIndex(p => p.payment_id === parseInt(paymentId));
      if (idx === -1) return false;
      cache.payments[idx] = {
        ...cache.payments[idx], ...updates,
        amount: updates.amount !== undefined ? parseFloat(updates.amount) : cache.payments[idx].amount
      };
      savePayment(cache.payments[idx]);
      return true;
    },
    delete: (paymentId) => {
      const before = cache.payments.length;
      cache.payments = cache.payments.filter(p => p.payment_id !== parseInt(paymentId));
      if (cache.payments.length < before) {
        deleteFromDB(Payment, { payment_id: parseInt(paymentId) });
        return true;
      }
      return false;
    }
  },

  auditLogs: {
    find:   (fn) => fn ? cache.audit_logs.filter(fn) : [...cache.audit_logs],
    insert: async (data) => {
      const id = await nextId('log_id');
      const obj = { log_id: id, ...data, created_at: new Date().toISOString() };
      cache.audit_logs.push(obj);
      saveAuditLog(obj);
      return obj;
    }
  },

  checkAndExpireLeases: () => {
    const nowStr = new Date().toISOString().split('T')[0];
    cache.allocations.forEach(alloc => {
      if (alloc.status === 'pending_payment' && alloc.lease_expires_at && nowStr > alloc.lease_expires_at) {
        alloc.status = 'cancelled';
        alloc.updated_at = new Date().toISOString();
        saveAllocation(alloc);

        const roomIdx = cache.rooms.findIndex(r => r.room_id === alloc.room_id);
        if (roomIdx !== -1) {
          cache.rooms[roomIdx].current_occupancy = Math.max(0, cache.rooms[roomIdx].current_occupancy - 1);
          cache.rooms[roomIdx].status = 'available';
          cache.rooms[roomIdx].updated_at = new Date().toISOString();
          saveRoom(cache.rooms[roomIdx]);
        }

        nextId('log_id').then(id => {
          const log = {
            log_id: id, user_id: null, action: 'LEASE_EXPIRED',
            table_name: 'allocations', record_id: alloc.allocation_id,
            details: `5-day unpaid lease expired for booking code ${alloc.booking_code}. Room released back to pool.`,
            created_at: new Date().toISOString()
          };
          cache.audit_logs.push(log);
          saveAuditLog(log);
        });
      }
    });
  }
};

// ─── Initialize & Seed ────────────────────────────────────────────────────────

async function initializeDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not set!');
  }

  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB Atlas');

  // Load all data into cache
  await loadCache();
  console.log('✓ Data loaded into memory cache');

  // Automatic cleanup of legacy Lenana records from MongoDB Atlas
  const deletedRooms = await Room.deleteMany({ $or: [{ block_name: /lenana/i }, { room_number: /^LEN-/i }] });
  const deletedPayments = await Payment.deleteMany({ hostel_block: /lenana/i });
  if (deletedRooms.deletedCount > 0 || deletedPayments.deletedCount > 0) {
    console.log(`✓ Cleaned legacy Lenana records from MongoDB Atlas (${deletedRooms.deletedCount} rooms, ${deletedPayments.deletedCount} payments)`);
    await loadCache();
  }

  // Seed admin user
  if (!cache.users.find(u => u.username === 'admin')) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.users.insert({ username: 'admin', password: hash, email: 'admin@hostel.com', full_name: 'Administrator', role: 'admin' });
    console.log('✓ Default admin seeded (admin / admin123)');
  }

  // Seed students
  if (cache.students.length === 0) {
    const studentHash = await bcrypt.hash('student123', 10);
    const samples = [
      { admission_number: 'ADM001', password: studentHash, gender: 'male',   full_name: 'John Kiprop',    email: 'john@example.com',   phone: '0712345678', course: 'Computer Science',  date_of_admission: '2024-01-10', next_of_kin_name: 'Mary Kiprop',    next_of_kin_phone: '0723456789', status: 'active' },
      { admission_number: 'ADM002', password: studentHash, gender: 'female', full_name: 'Grace Wambui',   email: 'grace@example.com',  phone: '0712345689', course: 'Business Studies', date_of_admission: '2024-02-15', next_of_kin_name: 'Joseph Wambui',  next_of_kin_phone: '0734567890', status: 'active' },
      { admission_number: 'ADM003', password: studentHash, gender: 'male',   full_name: 'Daniel Otieno',  email: 'daniel@example.com', phone: '0712345690', course: 'Engineering',       date_of_admission: '2024-03-20', next_of_kin_name: 'Rose Otieno',    next_of_kin_phone: '0745678901', status: 'active' }
    ];
    for (const s of samples) await db.students.insert(s);
    console.log('✓ Sample students seeded');
  }

  // Seed rooms
  if (cache.rooms.length === 0) {
    const blocks = [
      ['Batian', 'Double', 2, 'BAT-', 'male'],
      ['Nelion', 'Double', 2, 'NEL-', 'female']
    ];
    for (const [blockName, roomType, capacity, prefix, genderPolicy] of blocks) {
      for (let i = 1; i <= 10; i++) {
        const roomNumber = prefix + String(i).padStart(3, '0');
        const genderRestriction = genderPolicy === 'split' ? (i <= 5 ? 'male' : 'female') : genderPolicy;
        await db.rooms.insert({
          room_number: roomNumber, room_type: roomType, capacity,
          current_occupancy: 0, status: 'available', floor: 1,
          block_name: blockName, gender_restriction: genderRestriction,
          amenities: `${blockName} block hostel room (${genderRestriction} restriction)`
        });
      }
    }
    console.log('✓ Sample rooms seeded (Batian, Nelion)');
  }

  console.log('MongoDB database initialization complete.');
}

module.exports = { db, initializeDatabase };
