const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const admin = require('firebase-admin');

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

// ─── Base URL Helper (Vercel / Render HTTPS vs Local IP) ─────────────────────
function getBaseUrl(req) {
  // If explicitly configured in environment
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  // Auto-detect reverse proxy headers (Vercel, Render, etc.)
  if (req && req.headers['x-forwarded-host']) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${req.headers['x-forwarded-host']}`;
  }
  // Vercel auto-provided domain
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // If request has host header that is not localhost
  if (req && req.get('host')) {
    const host = req.get('host');
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      return `${proto}://${host}`;
    }
  }
  // Local network IP for Wi-Fi testing
  const localIP = process.env.LOCAL_IP || getLocalIP();
  return `http://${localIP}:${PORT}`;
}

// ─── Firebase Setup (Storage + Firestore) ────────────────────────────────────
let firebaseBucket = null;
let firestoreDb = null;
let hasFirebase = false;

function initFirebase() {
  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      };
    } else {
      const keyPath = path.join(__dirname, 'firebase-service-account.json');
      if (fs.existsSync(keyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      }
    }

    if (serviceAccount) {
      const projectId = serviceAccount.project_id || serviceAccount.projectId;
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucketName
      });

      firestoreDb = admin.firestore();
      firebaseBucket = admin.storage().bucket();
      hasFirebase = true;
      console.log(`🔥 Firebase enabled: Firestore DB + Cloud Storage (${bucketName})`);
    } else {
      console.log('📁 Local mode: photos saved to ./uploads (add Firebase credentials for Render)');
    }
  } catch (err) {
    console.error('⚠️ Firebase init error, falling back to local files:', err.message);
  }
}

initFirebase();

async function uploadToFirebase(buffer, originalname, eventId, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const filename = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
  const filePath = `events/${eventId}/${filename}`;
  const file = firebaseBucket.file(filePath);
  const downloadToken = uuidv4();

  await file.save(buffer, {
    metadata: {
      contentType: mimetype || 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });

  const encodedPath = encodeURIComponent(filePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${firebaseBucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return { filename, filePath, publicUrl };
}

// ─── Local Fallback Setup ───────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EVENTS_FILE = path.join(__dirname, 'data', 'events.json');

[UPLOADS_DIR, path.join(__dirname, 'data')].forEach(dir => {
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

// ─── Event Storage Operations ────────────────────────────────────────────────
async function getAllEvents() {
  if (hasFirebase && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('events').orderBy('createdAt', 'desc').get();
      return snapshot.docs.map(doc => doc.data());
    } catch (e) {
      console.error('Firestore getAllEvents error, using local fallback:', e.message);
    }
  }
  const events = loadLocalEvents();
  return Object.values(events).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getEventById(eventId) {
  if (hasFirebase && firestoreDb) {
    try {
      const doc = await firestoreDb.collection('events').doc(eventId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.error('Firestore getEventById error, using local fallback:', e.message);
    }
  }
  const events = loadLocalEvents();
  return events[eventId] || null;
}

async function saveEvent(event) {
  if (hasFirebase && firestoreDb) {
    try {
      await firestoreDb.collection('events').doc(event.id).set(event, { merge: true });
      return;
    } catch (e) {
      console.error('Firestore saveEvent error, using local fallback:', e.message);
    }
  }
  const events = loadLocalEvents();
  events[event.id] = event;
  saveLocalEvents(events);
}

async function deleteEventDoc(eventId) {
  if (hasFirebase && firestoreDb) {
    try {
      await firestoreDb.collection('events').doc(eventId).delete();
      return;
    } catch (e) {
      console.error('Firestore deleteEvent error, using local fallback:', e.message);
    }
  }
  const events = loadLocalEvents();
  delete events[eventId];
  saveLocalEvents(events);
}

// ─── Multer Config ───────────────────────────────────────────────────────────
const storage = hasFirebase
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
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

// ─── API: Dynamic QR Code Generation (Zero-disk on Render) ───────────────────
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
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(qrBuffer);
  } catch (err) {
    console.error('Error generating QR:', err);
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

    if (hasFirebase && firebaseBucket) {
      // Upload to Firebase Storage
      for (const file of req.files) {
        const { filename, filePath, publicUrl } = await uploadToFirebase(
          file.buffer,
          file.originalname,
          event.id,
          file.mimetype
        );

        const photo = {
          id: uuidv4().slice(0, 8),
          filePath,
          filename,
          originalName: file.originalname,
          size: file.size,
          url: publicUrl,
          uploadedAt: new Date().toISOString(),
          uploaderName
        };
        event.photos.push(photo);
        uploaded.push(photo);
      }
    } else {
      // Local disk upload
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

    // Delete photos from Firebase Storage
    if (hasFirebase && firebaseBucket) {
      try {
        await firebaseBucket.deleteFiles({ prefix: `events/${event.id}/` });
      } catch (e) {
        console.warn('Firebase folder deletion warning:', e.message);
      }
    } else {
      const eventDir = path.join(UPLOADS_DIR, req.params.eventId);
      if (fs.existsSync(eventDir)) {
        fs.rmSync(eventDir, { recursive: true, force: true });
      }
    }

    await deleteEventDoc(req.params.eventId);
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

    // Delete from Firebase Storage or local disk
    if (hasFirebase && firebaseBucket && photo.filePath) {
      try {
        await firebaseBucket.file(photo.filePath).delete({ ignoreNotFound: true });
      } catch (e) {
        console.warn('Firebase photo delete error:', e.message);
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
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// ─── Start (Only when running locally, not in serverless Vercel) ─────────────
if (!process.env.VERCEL) {
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
}

module.exports = app;
