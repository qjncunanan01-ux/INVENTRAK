# INVENTRAK Mobile App

Customer + staff mobile module. **React Native 0.86 on Expo SDK 57** with
React Navigation 7, Reanimated, and the Lazada/Shopee-style catalog UI.

Run locally:

```bash
cd mobile-client
npm install
npm start               # Metro; press a/o/i for Android/iOS/web
npm run start:tunnel    # tunnel — scan the QR with Expo Go from any network
```

Point it at a backend:

```bash
# live Render API (what the production APK uses):
EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com npm run start:tunnel
# local dev backend:
EXPO_PUBLIC_API_URL=http://localhost:4001 npm start
```

Then open in **Expo Go** (SDK 57) or an emulator. For the standalone
Android APK (no Expo Go needed), see the root `APK-INSTALL.md`.
