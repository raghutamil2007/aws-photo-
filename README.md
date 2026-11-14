# EventSnap – Event Photo Sharing App 📸

Share a QR code at your event. Guests scan it with their phone and upload photos directly — no login required.

## Features
- 🎉 Create named events with a unique QR code
- 📲 Mobile-friendly upload page (tap to pick photos or drag & drop)
- 🖼️ Masonry gallery with lightbox viewer
- 🔍 Filter photos by uploader name
- ⬇️ Download individual photos or QR code
- 🔄 Gallery auto-refreshes every 15 seconds
- 🗑️ Delete photos from the gallery
- 📁 Photos stored on disk (20MB max per file, up to 20 at once)

## Quick Start

```bash
cd event-photos
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## Project Structure

```
event-photos/
├── server.js          # Express backend
├── package.json
├── public/
│   ├── index.html     # Admin / create event page
│   ├── upload.html    # Guest upload page (QR scan target)
│   ├── gallery.html   # Photo gallery
│   └── qrcodes/       # Generated QR code PNGs
├── uploads/           # Uploaded photos (created at runtime)
│   └── <eventId>/
└── data/
    └── events.json    # Event metadata
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Admin panel |
| POST | `/api/events` | Create event |
| GET | `/api/events` | List all events |
| GET | `/api/events/:id` | Get event info |
| POST | `/api/events/:id/upload` | Upload photos (multipart) |
| GET | `/api/events/:id/photos` | List photos |
| DELETE | `/api/events/:id/photos/:photoId` | Delete a photo |
| GET | `/upload/:id` | Guest upload page |
| GET | `/gallery/:id` | Photo gallery |

