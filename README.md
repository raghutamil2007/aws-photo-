# EventSnap – Event Photo Sharing App 📸

Share a QR code at your event. Guests scan it with their phone (mobile data or Wi-Fi) and upload photos directly — no login required.

---

## 🚀 Free Hosting Stack

| Component | Service | Free Tier Allowance |
|---|---|---|
| **App Hosting** | **[Render.com](https://render.com)** | Free Web Service (Node.js) |
| **Photo Storage** | **[Firebase Storage](https://firebase.google.com)** | 5 GB free storage & fast Google CDN |
| **Database** | **[Firebase Firestore](https://firebase.google.com)** | 1 GB permanent free database |
| **Code & Deploy** | **[GitHub](https://github.com)** | Free public/private repo & auto-deploy |

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Create a Free Firebase Project (2 minutes)
1. Go to **[console.firebase.google.com](https://console.firebase.google.com)** and click **Add Project**.
2. Name your project (e.g. `event-photos-app`) and click through to create it.
3. In the left sidebar:
   - Click **Build** → **Firestore Database** → Click **Create Database** (choose **Start in production mode** or **test mode**).
   - Click **Build** → **Storage** → Click **Get Started** (accept default settings).

---

### Step 2: Download Firebase Service Account Key (1 minute)
1. In the Firebase console, click the **⚙️ Gear icon** (top left next to Project Overview) → **Project settings**.
2. Click the **Service accounts** tab.
3. Click **Generate new private key** → **Generate key**.
4. A `.json` file will download to your computer.

---

### Step 3: Push Your Code to GitHub
Open your terminal in `d:\aws\event-photos`:
```bash
git remote add origin https://github.com/YOUR_USERNAME/event-photos.git
git branch -M main
git push -u origin main
```

---

### Step 4: Deploy on Render (Free)
1. Go to **[dashboard.render.com](https://dashboard.render.com)** and click **New +** → **Web Service**.
2. Connect your GitHub repository `event-photos`.
3. Configure the settings:
   - **Name**: `event-photos`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
4. Under **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `18.18.0` |
   | `FIREBASE_SERVICE_ACCOUNT` | *Open the downloaded `.json` file, copy all text inside, and paste it here!* |
5. Click **Create Web Service**.

Within 2 minutes, Render will build and deploy your app. You will get a live URL:
👉 `https://event-photos.onrender.com`

---

## 📱 How It Works for Guests
1. Open your live Render link (`https://event-photos.onrender.com`).
2. Create an event → QR code is generated instantly with your live HTTPS domain.
3. Guests scan the QR code from their phone (using mobile data 4G/5G or any Wi-Fi).
4. Photos upload directly to Google Cloud / Firebase Storage and are stored permanently.
5. Anyone can view the gallery, download photos, and view them in the lightbox.

---

## 💻 Local Testing
To test locally:
```bash
npm install
npm start
```
- If Firebase credentials are not set, it automatically saves photos in `./uploads` on your laptop.
