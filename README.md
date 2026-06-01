# OpenSun AR ☀

A lightweight, **privacy-respecting Progressive Web App (PWA)** that overlays the sun's current and future position onto your phone's live camera feed.  
No backend. No ads. No data ever leaves your device.

## Live Demo

Hosted on GitHub Pages → **[https://pascal-schober.github.io/Suntime/](https://pascal-schober.github.io/Suntime/)**

## Features

| Feature | Details |
|---------|---------|
| 📷 **Live AR Overlay** | Sun icon + full-day arc path superimposed on the back camera |
| ⏱ **Time-Travel Sliders** | Scrub ±47 h and ±365 days to preview future sun positions |
| 🧭 **Compass & Tilt** | Uses `deviceorientationabsolute` for true-north AR alignment |
| 🔒 **100% Private** | All calculations happen on-device; nothing is transmitted |
| 📲 **Add to Home Screen** | Full PWA – works offline after first load |
| 🎛 **FOV Calibration** | Slider to fine-tune the camera field-of-view for your phone |

## Technology Stack

- **HTML5 + CSS3 + Vanilla JavaScript** – zero build tools, zero npm
- **[SunCalc.js](https://github.com/mourner/suncalc)** – tiny library for sun position calculations
- **`navigator.mediaDevices.getUserMedia`** – back-camera access
- **`Geolocation API`** – latitude / longitude
- **`deviceorientationabsolute`** – compass heading + gyroscope
- **HTML5 Canvas** – AR overlay rendering
- **Service Worker** – offline PWA caching

## Project Structure

```
Suntime/
├── index.html      ← App shell + local SunCalc script import
├── style.css       ← Mobile-first full-screen layout
├── app.js          ← All logic: location, sun math, camera, AR projection
├── sw.js           ← Service Worker for offline caching
├── manifest.json   ← PWA manifest (Add to Home Screen)
└── icons/          ← App icons (192 × 192 and 512 × 512 PNG)
```

## How It Works

1. **Start** – tap the button; the browser asks for Camera and Location permissions.
2. **Sun Math** – `SunCalc.getPosition(date, lat, lon)` returns **Azimuth** and **Altitude**.
3. **AR Projection** – the difference between the sun's azimuth and the phone's compass heading, divided by the camera's field of view, gives the sun's pixel position on screen.
4. **Low-Pass Filter** – raw sensor values are smoothed to prevent jitter, using `pos = pos + α × (raw − pos)` with α = 0.12.
5. **Time Travel** – moving the sliders recomputes the sun position for a future date/time without re-requesting permissions.

## Browser Support

| Browser | Camera | Location | Compass |
|---------|--------|----------|---------|
| Chrome for Android ✅ | ✅ | ✅ | ✅ (`deviceorientationabsolute`) |
| Samsung Internet ✅ | ✅ | ✅ | ✅ |
| Safari / iOS 17+ ✅ | ✅ | ✅ | ⚠ needs user permission tap |
| Desktop Chrome ✅ | ✅ | ✅ | ❌ no compass (shows sun math only) |

> **Requires HTTPS.** GitHub Pages provides this automatically.

## Deployment

This is a purely static site. GitHub Pages serves the `main` branch root directly.  
No build step is required.

## Privacy

- No analytics, no tracking, no cookies.
- Location is read once at startup and kept in memory only.
- Camera frames are rendered locally to a `<canvas>` element and never encoded or uploaded.

## License

MIT