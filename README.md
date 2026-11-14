# EventSnap – Event Photo Sharing App 📸

Share a QR code at your event. Guests scan it with their phone (mobile data or Wi-Fi) and upload photos directly — no login required.

---

## ⚡ Free Stack (Vercel + Firebase)

| Component | Service | Free Tier Allowance |
|---|---|---|
| **Web Hosting & Serverless** | **[Vercel.com](https://vercel.com)** | Free Hobby Tier (Fast Edge CDN) |
| **Photo Storage** | **[Firebase Storage](https://firebase.google.com)** | 5 GB free storage & fast Google CDN |
| **Database** | **[Firebase Firestore](https://firebase.google.com)** | 1 GB permanent free database |
| **Code & Auto-Deploy** | **[GitHub](https://github.com)** | Free public/private repo |

---

## 🛠️ Step-by-Step Vercel Deployment Guide

### Step 1: Create a Free Firebase Project (2 minutes)
1. Go to **[console.firebase.google.com](https://console.firebase.google.com)** and click **Add Project**.
2. Name your project (e.g. `event-photos-app`) and complete setup.
3. In the Firebase console left menu:
   - Click **Build** → **Firestore Database** → **Create Database** (accept default settings).
   - Click **Build** → **Storage** → **Get Started** (accept default settings).

---

### Step 2: Get Your Firebase Service Account Key (1 minute)
1. In Firebase console, click the **⚙️ Gear icon** (top left next to Project Overview) → **Project settings**.
2. Click the **Service accounts** tab.
3. Click **Generate new private key** → **Generate key**.
4. A `.json` file will download to your computer.

---

### Step 3: Push Changes to GitHub
Your code is configured for Vercel. Push to GitHub:
```bash
git add .
git commit -m "Configure for Vercel deployment with client compression"
git push origin main
```

---

### Step 4: Deploy on Vercel (Free & Instant)
1. Go to **[vercel.com](https://vercel.com)** and log in with GitHub.
2. Click **Add New...** → **Project**.
3. Find your **`aws-photo-`** repository and click **Import**.
4. Leave Framework Preset as **Other** (it automatically uses `vercel.json` and `api/index.js`).
5. Under **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | *Open your downloaded Firebase `.json` file in Notepad, copy all text, and paste it here!* |
6. Click **Deploy**!

Within 30 seconds, Vercel will deploy your app and give you a live production URL:
👉 `https://aws-photo-xxxx.vercel.app`

---

## 📱 How It Works for Guests
1. Open your Vercel link (`https://your-project.vercel.app`).
2. Create an event → QR code is generated on-the-fly linking to your live Vercel domain.
3. Guests scan the QR code from their phone (using mobile data 4G/5G or any Wi-Fi).
4. Photos are optimized on the phone and saved directly to your Firebase Storage bucket!
5. Everyone can view the gallery, lightbox, and download photos.

---

## 💻 Local Testing
To test on your laptop:
```bash
npm install
npm start
```
- Open `http://localhost:3000`.
- Automatically uses local disk storage (`uploads/`) when Firebase credentials are not provided.
