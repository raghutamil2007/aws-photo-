# EventSnap – Event Photo Sharing App 📸

Share a QR code at your event. Guests scan it with their phone (mobile data or Wi-Fi) and upload photos directly — no login required.

---

## 🚀 Free Cloud Hosting Stack (100% Free Forever)

Render's free tier has an **ephemeral disk** (local files are wiped when the app restarts/sleeps). To keep everything **100% free forever** and permanent:

| Component | Service | Free Tier Allowance |
|---|---|---|
| **App Hosting** | **[Render.com](https://render.com)** | Free Web Service (Node.js) |
| **Photo Storage & CDN** | **[Cloudinary.com](https://cloudinary.com)** | 25 GB free storage & bandwidth/month |
| **Database** | **[MongoDB Atlas](https://www.mongodb.com/cloud/atlas)** | 512 MB free M0 cluster forever |

---

## 🛠️ Step-by-Step Deployment Guide

### Step 1: Get Free Cloudinary Account (1 minute)
1. Sign up free at [cloudinary.com](https://cloudinary.com).
2. Go to your **Dashboard**.
3. Copy these 3 values:
   - **Cloud Name**
   - **API Key**
   - **API Secret**

---

### Step 2: Get Free MongoDB Atlas Database (2 minutes)
1. Sign up free at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
2. Create a **Shared (M0 Free)** cluster (free forever, no credit card needed).
3. Under **Database Access**, create a user with username and password.
4. Under **Network Access**, click **Add IP Address** → Choose **Allow Access from Anywhere (`0.0.0.0/0`)**.
5. Click **Connect** → **Drivers** → Copy your connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   *(Replace `<username>` and `<password>` with your database user credentials).*

---

### Step 3: Push Code to GitHub
Open your terminal in `d:\aws\event-photos`:
```bash
git remote add origin https://github.com/YOUR_USERNAME/event-photos.git
git branch -M main
git push -u origin main
```

---

### Step 4: Deploy on Render (Free)
1. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** → **Web Service**.
2. Connect your GitHub repository `event-photos`.
3. Configure the settings:
   - **Name**: `event-photos` (or your choice)
   - **Region**: Closest to you (e.g., Singapore, Frankfurt, Oregon)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
4. Scroll down to **Environment Variables** and add:
   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `18.18.0` |
   | `CLOUDINARY_CLOUD_NAME` | *(from Step 1)* |
   | `CLOUDINARY_API_KEY` | *(from Step 1)* |
   | `CLOUDINARY_API_SECRET` | *(from Step 1)* |
   | `MONGODB_URI` | *(from Step 2)* |
5. Click **Create Web Service**.

Render will build and deploy your app. Within 2 minutes, you will get a live URL:
👉 `https://event-photos.onrender.com`

---

## 📱 How Guests Use It Anywhere
1. Open your Render URL (`https://event-photos.onrender.com`).
2. Create an event → QR code is generated instantly.
3. The QR code links to `https://event-photos.onrender.com/upload/<eventId>`.
4. Guests can scan with any phone on **cellular data (4G/5G) or Wi-Fi**.
5. Photos are uploaded straight to Cloudinary's fast global CDN and saved in MongoDB Atlas.

---

## 💻 Local Testing
To run locally on your PC without cloud services:
```bash
npm install
npm start
```
- App runs at `http://localhost:3000`
- Automatically falls back to local disk (`./uploads`) and local JSON (`./data/events.json`) when Cloudinary/MongoDB keys are not provided.
