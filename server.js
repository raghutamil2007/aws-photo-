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
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  if (req && req.headers['x-forwarded-host']) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${req.headers['x-forwarded-host']}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (req && req.get('host')) {
    const host = req.get('host');
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      return `${proto}://${host}`;
    }
  }
  const localIP = process.env.LOCAL_IP || getLocalIP();
  return `http://${localIP}:${PORT}`;
}

// ─── Firebase Setup (Storage + Firestore) ────────────────────────────────────
let firebaseBucket = null;
let firestoreDb = null;
let hasFirebase = false;
let firebaseInitError = null;

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();

    // If enclosed in outer quotes, strip them
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
      raw = raw.slice(1, -1).trim();
    }

    // Try base64 decoding if user base64-encoded it
    if (!raw.startsWith('{')) {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
        if (decoded.startsWith('{')) raw = decoded;
      } catch (e) {}
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // Fix unescaped newlines in private key if raw pasted
      try {
        const sanitized = raw.replace(/\r?\n/g, '\\n');
        parsed = JSON.parse(sanitized);
      } catch (e2) {
        throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT JSON: ${parseErr.message}`);
      }
    }

    // Format private key properly for Google Auth
    if (parsed && parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  }

  // Individual env vars
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }

  // Local file
  const keyPath = path.join(__dirname, 'firebase-service-account.json');
  if (fs.existsSync(keyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    } catch (e) {}
  }

  return null;
}

function initFirebase() {
  try {
    // If already initialized in this serverless context, reuse app
    if (admin.apps && admin.apps.length > 0) {
      firestoreDb = admin.firestore();
      hasFirebase = true;
      return;
    }

    const serviceAccount = parseServiceAccount();

    if (serviceAccount) {
      const projectId = serviceAccount.project_id || serviceAccount.projectId;
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucketName
      });

      firestoreDb = admin.firestore();
      try {
        firebaseBucket = admin.storage().bucket();
      } catch (e) {
        console.log('Firebase Cloud Storage not enabled, using Firestore database for photo storage.');
      }
      hasFirebase = true;
      firebaseInitError = null;
      console.log(`🔥 Firebase enabled: Firestore DB active for permanent events & photo storage`);
    } else {
      console.log('📁 Local mode: photos saved to ./uploads');
    }
  } catch (err) {
    firebaseInitError = err.message;
    console.error('⚠️ Firebase init error, falling back to local files:', err.message);
  }
}

initFirebase();

async function uploadToFirebaseStorage(buffer, originalname, eventId, mimetype) {
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
// On Vercel / serverless, local filesystem outside /tmp is read-only
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const BASE_STORAGE_DIR = isServerless ? '/tmp' : __dirname;

// On serverless (Vercel), /tmp is per-instance and wiped on cold start, so a silent
// fallback to local files causes random "Event not found". Fail loudly instead.
function failIfServerless(e) {
  if (isServerless) throw new Error('Firestore failed: ' + e.message);
}
const UPLOADS_DIR = path.join(BASE_STORAGE_DIR, 'uploads');
const EVENTS_FILE = path.join(BASE_STORAGE_DIR, 'data', 'events.json');

try {
  [UPLOADS_DIR, path.join(BASE_STORAGE_DIR, 'data')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
} catch (e) {
  console.warn('Local directory creation skipped:', e.message);
}

function loadLocalEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveLocalEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// ─── Event & Photo Storage Operations ────────────────────────────────────────
async function getAllEvents() {
  if (hasFirebase && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('events').orderBy('createdAt', 'desc').get();
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: data.id,
          name: data.name,
          hostName: data.hostName,
          createdAt: data.createdAt,
          photoCount: data.photoCount !== undefined ? data.photoCount : (data.photos || []).length
        };
      });
    } catch (e) {
      console.error('Firestore getAllEvents error, using local fallback:', e.message);
      failIfServerless(e);
    }
  }
  const events = loadLocalEvents();
  return Object.values(events)
    .map(e => ({
      id: e.id,
      name: e.name,
      hostName: e.hostName,
      createdAt: e.createdAt,
      photoCount: e.photoCount !== undefined ? e.photoCount : (e.photos || []).length
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getEventById(eventId) {
  if (hasFirebase && firestoreDb) {
    try {
      const doc = await firestoreDb.collection('events').doc(eventId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.error('Firestore getEventById error, using local fallback:', e.message);
      failIfServerless(e);
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
      failIfServerless(e);
    }
  }
  const events = loadLocalEvents();
  events[event.id] = event;
  saveLocalEvents(events);
}

async function getPhotosForEvent(eventId) {
  if (hasFirebase && firestoreDb) {
    try {
      const snap = await firestoreDb
        .collection('events')
        .doc(eventId)
        .collection('photos')
        .orderBy('uploadedAt', 'desc')
        .get();
      if (!snap.empty) {
        return snap.docs.map(d => d.data());
      }
    } catch (e) {
      console.error('Firestore getPhotosForEvent error:', e.message);
      failIfServerless(e);
    }
  }
  const event = await getEventById(eventId);
  return event ? (event.photos || []) : [];
}

// Base64 photos must NOT be sent inside JSON lists (Vercel caps responses at ~4.5MB).
// Expose them via a per-photo image URL instead; browsers then load/cache each one separately.
function toPublicPhoto(eventId, p) {
  if (p && typeof p.url === 'string' && p.url.startsWith('data:')) {
    return { ...p, url: `/api/events/${eventId}/photos/${p.id}/image` };
  }
  return p;
}

async function getPhotoById(eventId, photoId) {
  if (hasFirebase && firestoreDb) {
    try {
      const doc = await firestoreDb.collection('events').doc(eventId)
        .collection('photos').doc(photoId).get();
      if (doc.exists) return doc.data();
    } catch (e) {
      console.error('Firestore getPhotoById error:', e.message);
      failIfServerless(e);
    }
  }
  const event = loadLocalEvents()[eventId];
  return event && event.photos ? event.photos.find(p => p.id === photoId) || null : null;
}

async function savePhotoForEvent(eventId, photo) {
  if (hasFirebase && firestoreDb) {
    try {
      // Store in subcollection so each photo has its own 1MB document
      await firestoreDb
        .collection('events')
        .doc(eventId)
        .collection('photos')
        .doc(photo.id)
        .set(photo);

      // Increment photoCount in the parent event document
      await firestoreDb.collection('events').doc(eventId).set({
        photoCount: admin.firestore.FieldValue.increment(1)
      }, { merge: true });
      return;
    } catch (e) {
      console.error('Firestore save photo error:', e.message);
      failIfServerless(e);
    }
  }
  // Local fallback
  const events = loadLocalEvents();
  if (events[eventId]) {
    if (!events[eventId].photos) events[eventId].photos = [];
    events[eventId].photos.unshift(photo);
    events[eventId].photoCount = events[eventId].photos.length;
    saveLocalEvents(events);
  }
}

async function deletePhotoFromEvent(eventId, photoId) {
  if (hasFirebase && firestoreDb) {
    try {
      await firestoreDb
        .collection('events')
        .doc(eventId)
        .collection('photos')
        .doc(photoId)
        .delete();

      await firestoreDb.collection('events').doc(eventId).set({
        photoCount: admin.firestore.FieldValue.increment(-1)
      }, { merge: true });
      return;
    } catch (e) {
      console.error('Firestore delete photo error:', e.message);
      failIfServerless(e);
    }
  }
  // Local fallback
  const events = loadLocalEvents();
  if (events[eventId] && events[eventId].photos) {
    const idx = events[eventId].photos.findIndex(p => p.id === photoId);
    if (idx !== -1) {
      events[eventId].photos.splice(idx, 1);
      events[eventId].photoCount = events[eventId].photos.length;
      saveLocalEvents(events);
    }
  }
}

async function deleteEventDoc(eventId) {
  if (hasFirebase && firestoreDb) {
    try {
      // Delete all photos in subcollection
      const snap = await firestoreDb.collection('events').doc(eventId).collection('photos').get();
      const batch = firestoreDb.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      batch.delete(firestoreDb.collection('events').doc(eventId));
      await batch.commit();
      return;
    } catch (e) {
      console.error('Firestore deleteEvent error, using local fallback:', e.message);
      failIfServerless(e);
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── API: Status & Diagnostics ───────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.VERCEL ? 'vercel' : 'node',
    hasFirebase,
    hasFirestore: Boolean(firestoreDb),
    hasStorageBucket: Boolean(firebaseBucket),
    firebaseError: firebaseInitError,
    serviceAccountConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_PROJECT_ID)
  });
});

// ─── API: Dynamic QR Code Generation (Zero-disk on Vercel) ───────────────────
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
      photoCount: 0,
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
    const { photos, ...info } = event; // never send photo data here
    res.json(info);
  } catch (err) {
    next(err);
  }
});

// ─── API: List All Events ─────────────────────────────────────────────────────
app.get('/api/events', async (req, res, next) => {
  try {
    const list = await getAllEvents();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ─── API: Upload Photos (100% Free: Firestore Base64 or Cloud Storage) ──────
app.post('/api/events/:eventId/upload', upload.array('photos', 20), async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos selected' });
    }

    const uploaderName = (req.body.uploaderName || 'Guest').trim();
    const uploaded = [];

    // If Firebase is active:
    if (hasFirebase) {
      let usedStorage = false;

      // Try Firebase Storage first IF bucket exists
      if (firebaseBucket) {
        try {
          for (const file of req.files) {
            const { filename, filePath, publicUrl } = await uploadToFirebaseStorage(
              file.buffer,
              file.originalname,
              event.id,
              file.mimetype
            );

            const photo = {
              id: uuidv4().slice(0, 8),
              filePath,
              filename,
              size: file.size,
              url: publicUrl,
              uploadedAt: new Date().toISOString(),
              uploaderName
            };
            await savePhotoForEvent(event.id, photo);
            uploaded.push(photo);
          }
          usedStorage = true;
        } catch (storageErr) {
          console.warn('Firebase Cloud Storage requires Blaze plan, switching to 100% Free Firestore DB storage:', storageErr.message);
        }
      }

      // If Storage failed (asks to pay) or not available, use Firestore directly (100% Free, NO payment!)
      if (!usedStorage && firestoreDb) {
        for (const file of req.files) {
          const photo = {
            id: uuidv4().slice(0, 8),
            filename: file.originalname,
            size: file.size,
            url: `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`,
            uploadedAt: new Date().toISOString(),
            uploaderName
          };
          await savePhotoForEvent(event.id, photo);
          uploaded.push(photo);
        }
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
        await savePhotoForEvent(event.id, photo);
        uploaded.push(photo);
      }
    }

    const allPhotos = await getPhotosForEvent(event.id);
    res.json({ success: true, uploaded: uploaded.map(p => toPublicPhoto(event.id, p)), totalPhotos: allPhotos.length });
  } catch (err) {
    next(err);
  }
});

// ─── API: Get Photos for Event ────────────────────────────────────────────────
app.get('/api/events/:eventId/photos', async (req, res, next) => {
  try {
    const photos = await getPhotosForEvent(req.params.eventId);
    res.set('Cache-Control', 'no-store');
    res.json(photos.map(p => toPublicPhoto(req.params.eventId, p)));
  } catch (err) {
    next(err);
  }
});

// ─── API: Serve a single photo (decodes base64 stored in Firestore) ──────────
app.get('/api/events/:eventId/photos/:photoId/image', async (req, res, next) => {
  try {
    const photo = await getPhotoById(req.params.eventId, req.params.photoId);
    if (!photo || !photo.url) return res.status(404).send('Photo not found');
    const m = /^data:([^;]+);base64,(.+)$/s.exec(photo.url);
    if (!m) return res.redirect(photo.url);
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(m[2], 'base64'));
  } catch (err) {
    next(err);
  }
});

// ─── API: Delete Event ───────────────────────────────────────────────────────
app.delete('/api/events/:eventId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Try delete photos from Firebase Storage if it was used
    if (hasFirebase && firebaseBucket) {
      try {
        await firebaseBucket.deleteFiles({ prefix: `events/${event.id}/` });
      } catch (e) {}
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
    const photos = await getPhotosForEvent(req.params.eventId);
    const photo = photos.find(p => p.id === req.params.photoId);

    if (photo && photo.filePath && hasFirebase && firebaseBucket) {
      try {
        await firebaseBucket.file(photo.filePath).delete({ ignoreNotFound: true });
      } catch (e) {}
    } else if (photo && photo.filename) {
      const filePath = path.join(UPLOADS_DIR, req.params.eventId, photo.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await deletePhotoFromEvent(req.params.eventId, req.params.photoId);
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
