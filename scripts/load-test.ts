/**
 * Daisy Load Test — simulates concurrent wedding guests uploading photos.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts [options]
 *
 * Options:
 *   --url        API base URL          (default: http://localhost:8787)
 *   --guests     Number of guests      (default: 60)
 *   --photos     Photos per guest      (default: 5)
 *   --stagger    Stagger arrival (ms)  (default: 500 — guests don't all arrive at once)
 *   --size       Fake photo size in KB (default: 500)
 *   --slug       Album slug to use     (if omitted, creates a new album)
 *   --code       Access code           (if album requires one)
 *   --admin      Admin email:password  (default: admin@daisy.app:changeme)
 */

const args = parseArgs(process.argv.slice(2));

const CONFIG = {
  url: args.url || 'http://localhost:8787',
  guests: parseInt(args.guests || '60'),
  photosPerGuest: parseInt(args.photos || '5'),
  staggerMs: parseInt(args.stagger || '500'),
  photoSizeKB: parseInt(args.size || '500'),
  slug: args.slug || '',
  accessCode: args.code || '',
  admin: args.admin || 'admin@daisy.app:changeme',
};

// --- Types ---

type GuestResult = {
  guestId: number;
  uploads: UploadResult[];
  totalMs: number;
};

type UploadResult = {
  photoIndex: number;
  slotMs: number;
  uploadMs: number;
  thumbMs: number;
  totalMs: number;
  success: boolean;
  error?: string;
};

type Summary = {
  totalGuests: number;
  totalPhotos: number;
  successfulUploads: number;
  failedUploads: number;
  totalTimeMs: number;
  avgUploadMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  uploadsPerSecond: number;
  mbUploaded: number;
};

// --- Helpers ---

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      result[key] = argv[i + 1] || '';
      i++;
    }
  }
  return result;
}

function generateFakePhoto(sizeKB: number): Uint8Array {
  const bytes = new Uint8Array(sizeKB * 1024);
  // JPEG header so it looks real
  bytes[0] = 0xFF; bytes[1] = 0xD8; bytes[2] = 0xFF; bytes[3] = 0xE0;
  // Fill with random-ish data to prevent compression cheating
  for (let i = 4; i < bytes.length; i++) {
    bytes[i] = (i * 7 + 13) & 0xFF;
  }
  return bytes;
}

function generateFakeThumbnail(): Uint8Array {
  const bytes = new Uint8Array(20 * 1024); // 20KB thumb
  bytes[0] = 0xFF; bytes[1] = 0xD8; bytes[2] = 0xFF; bytes[3] = 0xE0;
  for (let i = 4; i < bytes.length; i++) {
    bytes[i] = (i * 3 + 7) & 0xFF;
  }
  return bytes;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${CONFIG.url}${path}`, options);
}

// --- Setup ---

async function getAuthToken(): Promise<string> {
  const [email, password] = CONFIG.admin.split(':');
  const res = await apiRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json() as { token: string };
  return body.token;
}

async function createTestAlbum(token: string): Promise<string> {
  const res = await apiRequest('/api/albums', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: `Load Test ${new Date().toISOString()}`,
      access_code: CONFIG.accessCode || undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`Album creation failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json() as { slug: string };
  return body.slug;
}

// --- Guest Simulation ---

async function simulateGuestUpload(guestId: number, slug: string, photo: Uint8Array, thumb: Uint8Array): Promise<UploadResult> {
  const start = performance.now();
  let slotMs = 0, uploadMs = 0, thumbMs = 0;

  try {
    // 1. Request upload slot
    const slotStart = performance.now();
    const slotRes = await apiRequest(`/api/albums/${slug}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: 'image/jpeg',
        filename: `guest${guestId}_photo.jpg`,
        access_code: CONFIG.accessCode || undefined,
      }),
    });
    slotMs = performance.now() - slotStart;

    if (!slotRes.ok) {
      const err = await slotRes.text();
      return { photoIndex: 0, slotMs, uploadMs: 0, thumbMs: 0, totalMs: performance.now() - start, success: false, error: `Slot: ${slotRes.status} ${err}` };
    }

    const { upload_id } = await slotRes.json() as { upload_id: string };

    // 2. Upload photo
    const uploadStart = performance.now();
    const uploadRes = await apiRequest(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: photo,
    });
    uploadMs = performance.now() - uploadStart;

    if (!uploadRes.ok) {
      return { photoIndex: 0, slotMs, uploadMs, thumbMs: 0, totalMs: performance.now() - start, success: false, error: `Upload: ${uploadRes.status}` };
    }

    // 3. Upload thumbnail
    const thumbStart = performance.now();
    const thumbRes = await apiRequest(`/api/uploads/${upload_id}/thumbnail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: thumb,
    });
    thumbMs = performance.now() - thumbStart;

    if (!thumbRes.ok) {
      return { photoIndex: 0, slotMs, uploadMs, thumbMs, totalMs: performance.now() - start, success: false, error: `Thumb: ${thumbRes.status}` };
    }

    return { photoIndex: 0, slotMs, uploadMs, thumbMs, totalMs: performance.now() - start, success: true };

  } catch (err) {
    return { photoIndex: 0, slotMs, uploadMs, thumbMs, totalMs: performance.now() - start, success: false, error: String(err) };
  }
}

async function simulateGuest(guestId: number, slug: string, photo: Uint8Array, thumb: Uint8Array): Promise<GuestResult> {
  const start = performance.now();
  const uploads: UploadResult[] = [];

  for (let i = 0; i < CONFIG.photosPerGuest; i++) {
    const result = await simulateGuestUpload(guestId, slug, photo, thumb);
    result.photoIndex = i + 1;
    uploads.push(result);

    // Small delay between photos (mimics user picking next photo)
    if (i < CONFIG.photosPerGuest - 1) {
      await sleep(200 + Math.random() * 300);
    }
  }

  return { guestId, uploads, totalMs: performance.now() - start };
}

// --- Reporting ---

function printSummary(results: GuestResult[]) {
  const allUploads = results.flatMap(r => r.uploads);
  const successful = allUploads.filter(u => u.success);
  const failed = allUploads.filter(u => !u.success);
  const times = successful.map(u => u.totalMs).sort((a, b) => a - b);

  const totalTime = Math.max(...results.map(r => r.totalMs));
  const totalMB = (successful.length * (CONFIG.photoSizeKB + 20)) / 1024;

  const summary: Summary = {
    totalGuests: results.length,
    totalPhotos: allUploads.length,
    successfulUploads: successful.length,
    failedUploads: failed.length,
    totalTimeMs: totalTime,
    avgUploadMs: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
    p50Ms: times.length > 0 ? percentile(times, 50) : 0,
    p95Ms: times.length > 0 ? percentile(times, 95) : 0,
    p99Ms: times.length > 0 ? percentile(times, 99) : 0,
    maxMs: times.length > 0 ? times[times.length - 1] : 0,
    minMs: times.length > 0 ? times[0] : 0,
    uploadsPerSecond: times.length > 0 ? (successful.length / (totalTime / 1000)) : 0,
    mbUploaded: totalMB,
  };

  console.log('\n' + '='.repeat(60));
  console.log('  DAISY LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`  Target:            ${CONFIG.url}`);
  console.log(`  Guests:            ${summary.totalGuests}`);
  console.log(`  Photos/guest:      ${CONFIG.photosPerGuest}`);
  console.log(`  Photo size:        ${CONFIG.photoSizeKB} KB`);
  console.log(`  Stagger:           ${CONFIG.staggerMs} ms`);
  console.log('-'.repeat(60));
  console.log(`  Total uploads:     ${summary.totalPhotos}`);
  console.log(`  Successful:        ${summary.successfulUploads}  (${((summary.successfulUploads / summary.totalPhotos) * 100).toFixed(1)}%)`);
  console.log(`  Failed:            ${summary.failedUploads}`);
  console.log(`  Data uploaded:     ${summary.mbUploaded.toFixed(1)} MB`);
  console.log('-'.repeat(60));
  console.log(`  Total time:        ${(summary.totalTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Uploads/sec:       ${summary.uploadsPerSecond.toFixed(1)}`);
  console.log(`  Avg per upload:    ${summary.avgUploadMs.toFixed(0)} ms`);
  console.log(`  p50:               ${summary.p50Ms.toFixed(0)} ms`);
  console.log(`  p95:               ${summary.p95Ms.toFixed(0)} ms`);
  console.log(`  p99:               ${summary.p99Ms.toFixed(0)} ms`);
  console.log(`  Min:               ${summary.minMs.toFixed(0)} ms`);
  console.log(`  Max:               ${summary.maxMs.toFixed(0)} ms`);
  console.log('='.repeat(60));

  if (failed.length > 0) {
    console.log('\nFailed uploads:');
    const errorCounts = new Map<string, number>();
    for (const f of failed) {
      const key = f.error || 'Unknown';
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    for (const [error, count] of errorCounts) {
      console.log(`  ${count}x  ${error}`);
    }
  }

  // Verdict
  console.log('\n' + '-'.repeat(60));
  const successRate = (summary.successfulUploads / summary.totalPhotos) * 100;
  if (successRate === 100 && summary.p95Ms < 5000) {
    console.log('  VERDICT: PASS — all uploads succeeded, p95 under 5s');
  } else if (successRate >= 99 && summary.p95Ms < 10000) {
    console.log('  VERDICT: PASS (marginal) — >99% success, p95 under 10s');
  } else {
    console.log(`  VERDICT: FAIL — ${successRate.toFixed(1)}% success, p95 ${summary.p95Ms.toFixed(0)}ms`);
  }
  console.log('-'.repeat(60) + '\n');
}

// --- Main ---

async function main() {
  console.log('Daisy Load Test');
  console.log(`Target: ${CONFIG.url}`);
  console.log(`Simulating ${CONFIG.guests} guests, ${CONFIG.photosPerGuest} photos each (${CONFIG.photoSizeKB}KB)`);
  console.log(`Total expected uploads: ${CONFIG.guests * CONFIG.photosPerGuest}`);
  console.log('');

  // Setup
  let slug = CONFIG.slug;
  if (!slug) {
    console.log('Logging in and creating test album...');
    const token = await getAuthToken();
    slug = await createTestAlbum(token);
    console.log(`Created album: ${slug}`);
  } else {
    console.log(`Using existing album: ${slug}`);
  }

  // Pre-generate fake photo data (shared across guests — same bytes, different uploads)
  console.log('Generating fake photo data...');
  const photo = generateFakePhoto(CONFIG.photoSizeKB);
  const thumb = generateFakeThumbnail();

  // Launch guests with staggered arrivals
  console.log(`\nStarting ${CONFIG.guests} guests (staggered ${CONFIG.staggerMs}ms apart)...\n`);

  const startTime = performance.now();
  const guestPromises: Promise<GuestResult>[] = [];
  let launched = 0;

  for (let i = 0; i < CONFIG.guests; i++) {
    guestPromises.push(simulateGuest(i + 1, slug, photo, thumb));
    launched++;

    // Progress indicator
    if (launched % 10 === 0 || launched === CONFIG.guests) {
      process.stdout.write(`  Launched ${launched}/${CONFIG.guests} guests\r`);
    }

    // Stagger arrivals
    if (i < CONFIG.guests - 1 && CONFIG.staggerMs > 0) {
      await sleep(CONFIG.staggerMs * (0.5 + Math.random()));
    }
  }

  console.log(`\n  All guests launched, waiting for uploads to complete...\n`);

  const results = await Promise.all(guestPromises);
  const elapsed = performance.now() - startTime;

  // Live progress for completed guests
  let completed = 0;
  for (const r of results) {
    completed++;
    const guestSuccess = r.uploads.filter(u => u.success).length;
    const guestFail = r.uploads.filter(u => !u.success).length;
    if (guestFail > 0) {
      console.log(`  Guest ${r.guestId}: ${guestSuccess}/${r.uploads.length} OK, ${guestFail} failed (${r.totalMs.toFixed(0)}ms)`);
    }
  }

  printSummary(results);
}

main().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});
