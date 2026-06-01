/**
 * OpenSun AR — app.js
 *
 * Phases:
 *  1. Foundation & UI Setup
 *  2. Location & Sun Math (SunCalc)
 *  3. Camera Feed (getUserMedia)
 *  4. Device Orientation & AR Projection
 *  5. Polish: sun-path arc, PWA registration
 */

'use strict';

/* ────────────────────────────────────────────────
   Constants & Configuration
──────────────────────────────────────────────── */
const DEFAULT_FOV_DEG = 65;   // assumed camera horizontal FOV in degrees
const LP_ALPHA = 0.12;        // low-pass filter coefficient (0 = frozen, 1 = raw)
const SUN_PATH_STEPS = 96;    // number of points when drawing the sun arc

/* ────────────────────────────────────────────────
   DOM References
──────────────────────────────────────────────── */
const video        = document.getElementById('video');
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const startScreen  = document.getElementById('start-screen');
const hud          = document.getElementById('hud');
const startBtn     = document.getElementById('start-btn');
const stopBtn      = document.getElementById('stop-btn');
const resetBtn     = document.getElementById('reset-btn');
const hourSlider   = document.getElementById('hour-slider');
const daySlider    = document.getElementById('day-slider');
const hourValue    = document.getElementById('hour-value');
const dayValue     = document.getElementById('day-value');
const fovSlider    = document.getElementById('fov-slider');
const fovValue     = document.getElementById('fov-value');
const sunInfo      = document.getElementById('sun-info');
const compassInfo  = document.getElementById('compass-info');
const errorMsg     = document.getElementById('error-msg');

/* ────────────────────────────────────────────────
   Application State
──────────────────────────────────────────────── */
const state = {
  running: false,
  lat: null,
  lon: null,
  // Time travel offsets
  hourOffset: 0,
  dayOffset: 0,
  // Camera FOV
  fovDeg: DEFAULT_FOV_DEG,
  // Current sun position (degrees)
  sunAzimuthDeg: 0,
  sunAltitudeDeg: 0,
  // Device orientation (smoothed, degrees)
  headingDeg: 0,  // compass heading 0-360
  pitchDeg: 0,    // tilt up/down (-90 front-facing, 0 flat, 90 back)
  rollDeg: 0,
  // Raw sensor values before low-pass
  rawHeading: null,
  rawPitch: 0,
  rawRoll: 0,
  // Flags
  orientationAvailable: false,
  animFrameId: null,
};

/* ────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────── */

/** Return the target Date after applying hour + day offsets. */
function targetDate() {
  const now = new Date();
  now.setHours(now.getHours() + state.hourOffset);
  now.setDate(now.getDate() + state.dayOffset);
  return now;
}

/** Convert degrees → radians. */
const toRad = d => d * Math.PI / 180;

/** Wrap an angle into [0, 360). */
const wrap360 = a => ((a % 360) + 360) % 360;

/**
 * Low-pass filter a circular angle (handles 350→10 wraparound).
 * @param {number} current – already-smoothed value
 * @param {number} raw     – new sensor reading
 * @param {number} alpha   – blend coefficient
 */
function lpAngle(current, raw, alpha) {
  if (raw === null || raw === undefined) return current;
  let diff = raw - current;
  // Wrap diff to [-180, 180]
  while (diff > 180)  diff -= 360;
  while (diff < -180) diff += 360;
  return wrap360(current + alpha * diff);
}

/** Low-pass for non-circular values (pitch, roll). */
const lpLinear = (cur, raw, a) => cur + a * (raw - cur);

/* ────────────────────────────────────────────────
   Phase 2 — Sun Math
──────────────────────────────────────────────── */

/** Update state.sunAzimuthDeg / sunAltitudeDeg using SunCalc. */
function updateSunPosition() {
  if (state.lat === null) return;

  const pos = SunCalc.getPosition(targetDate(), state.lat, state.lon);

  // SunCalc returns azimuth as radians south of north (add π to get N-based)
  state.sunAzimuthDeg  = wrap360((pos.azimuth * 180 / Math.PI) + 180);
  state.sunAltitudeDeg = pos.altitude * 180 / Math.PI;

  sunInfo.textContent = `Az: ${state.sunAzimuthDeg.toFixed(1)}°  Alt: ${state.sunAltitudeDeg.toFixed(1)}°`;
}

/* ────────────────────────────────────────────────
   Phase 4 — Device Orientation
──────────────────────────────────────────────── */

/**
 * Handle deviceorientationabsolute (Android) or deviceorientation (iOS / fallback).
 * Populates rawHeading, rawPitch, rawRoll.
 */
function handleOrientation(evt) {
  // `absolute` events have a true north reference.
  // alpha = compass heading [0, 360), but 0 = North on absolute events
  const alpha = evt.alpha ?? 0;
  const beta  = evt.beta  ?? 0;   // tilt front/back, [-180, 180]
  const gamma = evt.gamma ?? 0;   // tilt left/right, [-90, 90]

  // Convert to compass heading: when the phone is held in portrait, pointing up
  // alpha counts counter-clockwise from north, so heading = (360 - alpha) % 360
  state.rawHeading = wrap360(360 - alpha);
  state.rawPitch   = beta;
  state.rawRoll    = gamma;
  state.orientationAvailable = true;

  compassInfo.textContent = `Heading: ${state.rawHeading.toFixed(0)}°`;
}

function registerOrientationListener() {
  // Prefer absolute orientation (gives true-north heading on Android)
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
  }
}

/* ────────────────────────────────────────────────
   Phase 4 — AR Projection Math
──────────────────────────────────────────────── */

/** Compute the camera's vertical field of view from the horizontal FOV and canvas aspect ratio. */
function verticalFOV() {
  return state.fovDeg * (canvas.height / canvas.width);
}

/**
 * Project an astronomical (azimuth, altitude) pair to canvas (x, y) pixels.
 *
 * @param {number} azDeg  – sun's compass azimuth [0, 360)
 * @param {number} altDeg – sun's altitude above horizon (can be negative)
 * @returns {{ x: number, y: number, inView: boolean }}
 */
function project(azDeg, altDeg) {
  const w = canvas.width;
  const h = canvas.height;

  const fovH = state.fovDeg;   // horizontal FOV (degrees)
  const fovV = verticalFOV();  // vertical FOV (approximate)

  // Angular difference between sun and phone heading
  let dAz = azDeg - state.headingDeg;
  while (dAz >  180) dAz -= 360;
  while (dAz < -180) dAz += 360;

  // Vertical: altitude vs. phone pitch
  // When phone is held vertically in portrait: beta ≈ 90 means pointing at horizon.
  // We treat (beta - 90) as the "camera tilt from horizon" so that when beta=90
  // the camera is level and the horizon bisects the screen.
  const cameraTilt = state.pitchDeg - 90;  // degrees above horizon in frame centre
  const dAlt = altDeg - cameraTilt;

  const x = w / 2 + (dAz  / fovH) * w;
  const y = h / 2 - (dAlt / fovV) * h;

  const margin = 60; // pixels inside which we still consider "in view"
  const inView = x >= -margin && x <= w + margin && y >= -margin && y <= h + margin;

  return { x, y, inView };
}

/* ────────────────────────────────────────────────
   Phase 4 — Canvas Drawing
──────────────────────────────────────────────── */

/** Draw the sun disc + glow at (x, y). */
function drawSun(x, y, altDeg) {
  const radius = 22;

  // Glow ring
  const glow = ctx.createRadialGradient(x, y, radius * 0.4, x, y, radius * 3);
  glow.addColorStop(0,   'rgba(255, 200,  50, 0.45)');
  glow.addColorStop(0.5, 'rgba(255, 140,   0, 0.18)');
  glow.addColorStop(1,   'rgba(255,  80,   0, 0)');
  ctx.beginPath();
  ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Sun disc
  const disc = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.25, radius * 0.1, x, y, radius);
  disc.addColorStop(0,   '#fff9c0');
  disc.addColorStop(0.45, '#ffdd00');
  disc.addColorStop(1,   '#ff9900');
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();

  // Below-horizon tint (twilight)
  if (altDeg < 0) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 30, 80, ${Math.min(0.65, Math.abs(altDeg) / 18)})`;
    ctx.fill();
  }
}

/**
 * Draw an off-screen direction arrow pointing toward the sun.
 * @param {{ x: number, y: number }} pos – projected (possibly off-screen) position
 */
function drawArrow(pos) {
  const w = canvas.width;
  const h = canvas.height;
  const pad = 28;

  // Clamp target point to screen edge
  const cx = w / 2;
  const cy = h / 2;
  const angle = Math.atan2(pos.y - cy, pos.x - cx);

  // Find the edge intersection
  const tx = Math.cos(angle);
  const ty = Math.sin(angle);
  const scalex = tx !== 0 ? (tx > 0 ? (w / 2 - pad) : -(w / 2 - pad)) / tx : Infinity;
  const scaley = ty !== 0 ? (ty > 0 ? (h / 2 - pad) : -(h / 2 - pad)) / ty : Infinity;
  const scale = Math.min(Math.abs(scalex), Math.abs(scaley));
  const ex = cx + tx * scale;
  const ey = cy + ty * scale;

  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);

  // Arrow triangle
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-10, -10);
  ctx.lineTo(-10,  10);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw the sun's path arc for the target day.
 * Plots SunCalc positions every (24/SUN_PATH_STEPS) hours.
 */
function drawSunPath() {
  const w = canvas.width;
  const h = canvas.height;

  // Build a reference date at midnight local time for the target day
  const ref = targetDate();
  const midnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0);

  const points = [];
  for (let i = 0; i <= SUN_PATH_STEPS; i++) {
    const t = new Date(midnight.getTime() + (i / SUN_PATH_STEPS) * 24 * 3600 * 1000);
    const pos = SunCalc.getPosition(t, state.lat, state.lon);
    const azDeg  = wrap360((pos.azimuth * 180 / Math.PI) + 180);
    const altDeg = pos.altitude * 180 / Math.PI;
    const p = project(azDeg, altDeg);
    points.push({ ...p, altDeg, t });
  }

  if (points.length < 2) return;

  // Draw segments; colour above/below horizon differently
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    // Skip segments that leap across more than half the screen (wrap-around artefacts)
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > Math.max(w, h) * 0.6) continue;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = a.altDeg >= 0
      ? 'rgba(255, 200, 60, 0.55)'
      : 'rgba(100, 140, 255, 0.35)';
    ctx.stroke();
  }

  // Sunrise / sunset markers
  const times = SunCalc.getTimes(ref, state.lat, state.lon);
  [
    { label: '↑', time: times.sunrise },
    { label: '↓', time: times.sunset },
  ].forEach(({ label, time }) => {
    if (!(time instanceof Date) || isNaN(time)) return;
    const pos2 = SunCalc.getPosition(time, state.lat, state.lon);
    const az = wrap360((pos2.azimuth * 180 / Math.PI) + 180);
    const al = pos2.altitude * 180 / Math.PI;
    const p = project(az, al);
    if (!p.inView) return;
    ctx.fillStyle = 'rgba(255, 180, 50, 0.9)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, p.x, p.y - 4);
  });
}

/* ────────────────────────────────────────────────
   Main Render Loop
──────────────────────────────────────────────── */

function renderFrame() {
  if (!state.running) return;

  // Resize canvas to match display size
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply low-pass filter to orientation
  if (state.rawHeading !== null) {
    state.headingDeg = lpAngle(state.headingDeg, state.rawHeading, LP_ALPHA);
    state.pitchDeg   = lpLinear(state.pitchDeg, state.rawPitch,   LP_ALPHA);
    state.rollDeg    = lpLinear(state.rollDeg,  state.rawRoll,    LP_ALPHA);
  }

  updateSunPosition();

  if (state.lat !== null) {
    // Draw sun path arc
    drawSunPath();

    // Project sun to screen
    const sunPos = project(state.sunAzimuthDeg, state.sunAltitudeDeg);

    if (sunPos.inView) {
      drawSun(sunPos.x, sunPos.y, state.sunAltitudeDeg);
    } else {
      drawArrow(sunPos);
    }

    // Horizon line hint when device orientation is available
    if (state.orientationAvailable) {
      const fovV = verticalFOV();
      const horizonY = canvas.height / 2 + ((state.pitchDeg - 90) / fovV) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(canvas.width, horizonY);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  state.animFrameId = requestAnimationFrame(renderFrame);
}

/* ────────────────────────────────────────────────
   Phase 3 — Camera Feed
──────────────────────────────────────────────── */

async function startCamera() {
  try {
    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API not available in this browser');
    }

    // Check camera permission state if supported
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'camera' });
        if (permissionStatus.state === 'denied') {
          throw new Error('Camera permission denied. Please enable camera access in your browser settings and reload the page.');
        }
      } catch (permErr) {
        // Permission query not supported on all browsers, continue with getUserMedia
        console.log('Permission query not supported:', permErr);
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    
    // Set video source and attempt to play
    video.srcObject = stream;
    await video.play().catch(e => {
      // Autoplay may be blocked by browser policy, but stream is still valid
      console.log('Video autoplay blocked, user interaction may be needed:', e);
    });
    
    return stream;
  } catch (err) {
    // Provide more specific error messages based on error type
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('Camera permission denied. Please allow camera access and try again.');
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No camera found on this device.');
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      throw new Error('Camera is already in use by another application. Please close other apps using the camera and try again.');
    } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
      throw new Error('Camera does not meet the required specifications.');
    } else if (err.message) {
      throw new Error(`Camera access error: ${err.message}`);
    } else {
      throw new Error('Camera access denied or unavailable');
    }
  }
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

/* ────────────────────────────────────────────────
   Phase 2 — Geolocation
──────────────────────────────────────────────── */

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        resolve();
      },
      err => reject(new Error(`Location access denied: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/* ────────────────────────────────────────────────
   Phase 1 — Start / Stop Flow
──────────────────────────────────────────────── */

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  // Tap anywhere to dismiss
  errorMsg.addEventListener('click', () => errorMsg.classList.add('hidden'), { once: true });
}

async function startAR() {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  try {
    // iOS 13+ requires an explicit permission request for DeviceMotion/Orientation
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        showError('Orientation permission denied. The AR compass overlay won\'t work, but sun position is still shown.');
      }
    }

    await Promise.all([requestLocation(), startCamera()]);
  } catch (err) {
    showError(err.message + '\n\nTip: make sure you\'re on HTTPS and have allowed Camera and Location permissions.');
    startBtn.disabled = false;
    startBtn.textContent = 'Start AR';
    return;
  }

  // Show HUD, hide start screen
  state.running = true;
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');

  registerOrientationListener();

  // Init canvas size
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // Begin render loop
  renderFrame();
}

function stopAR() {
  state.running = false;
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  stopCamera();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  hud.classList.add('hidden');
  startScreen.classList.remove('hidden');

  // Reset sliders
  hourSlider.value = 0;
  daySlider.value  = 0;
  state.hourOffset = 0;
  state.dayOffset  = 0;
  hourValue.textContent = '0';
  dayValue.textContent  = '0';

  startBtn.disabled = false;
  startBtn.textContent = 'Start AR';
}

/* ────────────────────────────────────────────────
   UI Event Listeners
──────────────────────────────────────────────── */

startBtn.addEventListener('click', startAR);
stopBtn.addEventListener('click', stopAR);

resetBtn.addEventListener('click', () => {
  hourSlider.value = 0;
  daySlider.value  = 0;
  state.hourOffset = 0;
  state.dayOffset  = 0;
  hourValue.textContent = '0';
  dayValue.textContent  = '0';
});

hourSlider.addEventListener('input', () => {
  state.hourOffset = parseInt(hourSlider.value, 10);
  hourValue.textContent = state.hourOffset;
});

daySlider.addEventListener('input', () => {
  state.dayOffset = parseInt(daySlider.value, 10);
  dayValue.textContent = state.dayOffset;
});

fovSlider.addEventListener('input', () => {
  state.fovDeg = parseInt(fovSlider.value, 10);
  fovValue.textContent = state.fovDeg;
});

// Handle resize / orientation change
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
});

/* ────────────────────────────────────────────────
   Phase 5 — Service Worker Registration
──────────────────────────────────────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(err => console.warn('Service Worker registration failed:', err));
  });
}
