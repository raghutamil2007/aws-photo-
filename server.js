const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const cloudinary = require('cloudinary').v2;
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Network IP Helper (Local Development) ───────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(nets)) {
    for (const net of addrs) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const ip = net.address;
      const lname = name.toLowerCase();

      let score = 0;
      if (lname.includes('wi-fi') || lname.includes('wifi') || lname.includes('wlan')) score += 30;
      if (lname.includes('ethernet') && !lname.includes('ethernet 2')) score += 20;
      if (ip.startsWith('10.')) score += 10;
      if (ip.startsWith('192.168.')) score += 5;
      if (ip.startsWith('172.')) score += 3;
      if (lname.includes('virtual') || lname.includes('vmware') || lname.includes('hyper-v') ||
          lname.includes('vethernet') || lname.includes('local area connection*')) score -= 20;

      candidates.push({ ip, score, name });
    }
  }

  if (!candidates.length) return 'localhost';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].ip;
}

// ─── Base URL Helper (Render HTTPS vs Local IP) ──────────────────────────────
function getBaseUrl(req) {
  // If explicitly configured in environment (e.g. Render dashboard)
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  // Auto-detect Render or reverse proxy headers (e.g. https://my-app.onrender.com)
  if (req && req.headers['x-forwarded-host']) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${req.headers['x-forwarded-host']}`;
  }
  // If request has a host header that isn't localhost/127.0.0.1
  if (req && req.get('host')) {
    const host = req.get('host');
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      return `${proto}://${host}`;
    }
  }
  // Local network IP so phone on Wi-Fi works during local dev
  const localIP = process.env.LOCAL_IP || getLocalIP();
  return `http://${localIP}:${PORT}`;
}

// ─── Cloudinary Setup (Free Cloud Photo Storage) ─────────────────────────────
const hasCloudinary = Boolean(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (hasCloudinary) {
  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }
  console.log('☁️  Cloudinary enabled: photos will be hosted free on Cloudinary CDN');
} else {
  console.log('📁 Local disk mode: photos stored in ./uploads (add Cloudinary for Render hosting)');
}

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

// ─── Local Disk Fallback Setup ───────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EVENTS_FILE = path.join(__dirname, 'data', 'events.json');

[UPLOADS_DIR, path.join(__dirname, 'data'), path.join(__dirname, 'public', 'qrcodes')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function loadLocalEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveLocalEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// ─── Database Layer (MongoDB Atlas or Local JSON) ────────────────────────────
let dbClient = null;
let eventsCollection = null;

async function initDB() {
  if (process.env.MONGODB_URI) {
    try {
      dbClient = new MongoClient(process.env.MONGODB_URI);
      await dbClient.connect();
      const db = dbClient.db(process.env.MONGODB_DB_NAME || 'event_photos');
      eventsCollection = db.collection('events');
      console.log('🍃 MongoDB Atlas connected: event records persist across Render restarts');
    } catch (err) {
      console.error('⚠️  MongoDB connection failed, falling back to local file:', err.message);
    }
  } else {
    console.log('📄 Using local JSON database (add MONGODB_URI to persist across Render restarts)');
  }
}

async function getAllEvents() {
  if (eventsCollection) {
    return await eventsCollection.find({}).sort({ createdAt: -1 }).toArray();
  }
  const events = loadLocalEvents();
  return Object.values(events).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getEventById(eventId) {
  if (eventsCollection) {
    return await eventsCollection.findOne({ id: eventId });
  }
  const events = loadLocalEvents();
  return events[eventId] || null;
}

async function saveEvent(event) {
  if (eventsCollection) {
    await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
    return;
  }
  const events = loadLocalEvents();
  events[event.id] = event;
  saveLocalEvents(events);
}

async function deleteEvent(eventId) {
  if (eventsCollection) {
    await eventsCollection.deleteOne({ id: eventId });
    return;
  }
  const events = loadLocalEvents();
  delete events[eventId];
  saveLocalEvents(events);
}

// ─── Multer Configuration ───────────────────────────────────────────────────
const storage = hasCloudinary
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const eventId = req.params.eventId;
        const eventDir = path.join(UPLOADS_DIR, eventId);
        if (!fs.existsSync(eventDir)) fs.mkdirSync(eventDir, { recursive: true });
        cb(null, eventDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
      }
    });

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max per image
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype || '';
    if (allowed.test(ext) || mime.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Only image files are allowed'), { code: 'INVALID_FILE_TYPE' }));
    }
  }
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── API: Dynamic QR Code Generation (Zero-disk, ephemeral-safe) ─────────────
app.get('/api/events/:eventId/qr', async (req, res) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).send('Event not found');

    const baseUrl = getBaseUrl(req);
    const uploadUrl = `${baseUrl}/upload/${event.id}`;

    const qrBuffer = await QRCode.toBuffer(uploadUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
    res.send(qrBuffer);
  } catch (err) {
    console.error('Error serving QR:', err);
    res.status(500).send('Error generating QR code');
  }
});

// ─── API: Create Event ───────────────────────────────────────────────────────
app.post('/api/events', async (req, res, next) => {
  try {
    const { name, description, hostName } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Event name is required' });

    const eventId = uuidv4().slice(0, 8);
    const baseUrl = getBaseUrl(req);
    const uploadUrl = `${baseUrl}/upload/${eventId}`;

    const newEvent = {
      id: eventId,
      name: name.trim(),
      description: (description || '').trim(),
      hostName: (hostName || 'Host').trim(),
      createdAt: new Date().toISOString(),
      photos: []
    };

    await saveEvent(newEvent);

    res.json({
      eventId,
      name: newEvent.name,
      uploadUrl,
      qrCodeUrl: `/api/events/${eventId}/qr`,
      galleryUrl: `/gallery/${eventId}`
    });
  } catch (err) {
    next(err);
  }
});

// ─── API: Get Event Info ─────────────────────────────────────────────────────
app.get('/api/events/:eventId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    next(err);
  }
});

// ─── API: List All Events ─────────────────────────────────────────────────────
app.get('/api/events', async (req, res, next) => {
  try {
    const events = await getAllEvents();
    const list = events.map(e => ({
      id: e.id,
      name: e.name,
      hostName: e.hostName,
      createdAt: e.createdAt,
      photoCount: (e.photos || []).length
    }));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ─── API: Upload Photos ───────────────────────────────────────────────────────
app.post('/api/events/:eventId/upload', upload.array('photos', 20), async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos selected' });
    }

    const uploaderName = (req.body.uploaderName || 'Guest').trim();
    const uploaded = [];

    if (hasCloudinary) {
      // Cloudinary cloud upload
      for (const file of req.files) {
        const result = await uploadBufferToCloudinary(file.buffer, `event-photos/${event.id}`);
        const photo = {
          id: uuidv4().slice(0, 8),
          publicId: result.public_id,
          filename: file.originalname,
          originalName: file.originalname,
          size: result.bytes || file.size,
          url: result.secure_url,
          uploadedAt: new Date().toISOString(),
          uploaderName
        };
        event.photos.push(photo);
        uploaded.push(photo);
      }
    } else {
      // Local disk fallback
      for (const file of req.files) {
        const photo = {
          id: uuidv4().slice(0, 8),
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          url: `/uploads/${event.id}/${file.filename}`,
          uploadedAt: new Date().toISOString(),
          uploaderName
        };
        event.photos.push(photo);
        uploaded.push(photo);
      }
    }

    await saveEvent(event);
    res.json({ success: true, uploaded, totalPhotos: event.photos.length });
  } catch (err) {
    next(err);
  }
});

// ─── API: Get Photos for Event ────────────────────────────────────────────────
app.get('/api/events/:eventId/photos', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event.photos || []);
  } catch (err) {
    next(err);
  }
});

// ─── API: Delete Event ───────────────────────────────────────────────────────
app.delete('/api/events/:eventId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (hasCloudinary) {
      try {
        await cloudinary.api.delete_resources_by_prefix(`event-photos/${event.id}`);
        await cloudinary.api.delete_folder(`event-photos/${event.id}`).catch(() => {});
      } catch (e) {
        console.warn('Cloudinary cleanup note:', e.message);
      }
    } else {
      const eventDir = path.join(UPLOADS_DIR, req.params.eventId);
      if (fs.existsSync(eventDir)) {
        fs.rmSync(eventDir, { recursive: true, force: true });
      }
    }

    await deleteEvent(req.params.eventId);
    res.json({ success: true, deleted: req.params.eventId });
  } catch (err) {
    next(err);
  }
});

// ─── API: Delete Photo ────────────────────────────────────────────────────────
app.delete('/api/events/:eventId/photos/:photoId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const idx = (event.photos || []).findIndex(p => p.id === req.params.photoId);
    if (idx === -1) return res.status(404).json({ error: 'Photo not found' });

    const photo = event.photos[idx];

    if (hasCloudinary && photo.publicId) {
      try {
        await cloudinary.uploader.destroy(photo.publicId);
      } catch (e) {
        console.error('Cloudinary photo deletion error:', e.message);
      }
    } else if (photo.filename) {
      const filePath = path.join(UPLOADS_DIR, req.params.eventId, photo.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    event.photos.splice(idx, 1);
    await saveEvent(event);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Page Routes ─────────────────────────────────────────────────────────────
app.get('/upload/:eventId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/gallery/:eventId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 20MB per photo.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err && err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const localIP = process.env.LOCAL_IP || getLocalIP();
    console.log(`\n🎉 Event Photo Sharing App running on port ${PORT}!`);
    console.log(`📸 Admin panel   → http://localhost:${PORT}/`);
    console.log(`📲 Phone QR URL  → http://${localIP}:${PORT}/upload/<eventId>`);
    if (process.env.BASE_URL) {
      console.log(`🌐 Public URL    → ${process.env.BASE_URL}`);
    }
    console.log('');
  });
});
