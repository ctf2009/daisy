<p align="center">
  <img src="daisy.png" alt="Daisy" width="400">
</p>

<p align="center">
  Simple photo sharing for your events
</p>

---

Daisy lets guests at your event upload photos by scanning a QR code or visiting a link. No app downloads, no sign-ups — just tap, pick photos, and upload. Album owners can view, manage, and download everything from one place.

## How it works

1. **Create an album** — sign in, name your event, optionally set an access code
2. **Share the link** — print the QR code for tables, or share a vanity URL like `photos.yourdomain.com`
3. **Guests upload** — they scan the QR, select photos from their camera roll, done
4. **Guests browse** — if the gallery is enabled, guests can view and download photos too
5. **Owner manages** — toggle uploads on/off, gallery visible/hidden, download everything as a zip

## Architecture

```
Guest's phone                    Cloudflare Edge
     |                                |
     |  1. Select photos              |
     |  2. Convert HEIC -> JPEG       |
     |  3. Generate thumbnail         |
     |  4. Hash for dedup check       |
     |                                |
     |--- POST /upload -------------->|  Reserve slot + start multipart
     |                                |
     |--- PUT /part/1 (5MB chunk) --->|  R2 multipart uploadPart
     |--- PUT /part/2 (5MB chunk) --->|  (with automatic retries)
     |--- PUT /part/N ... ----------->|
     |                                |
     |--- POST /complete ------------>|  R2 assembles final object
     |--- PUT /thumbnail ------------>|  Small single upload
     |                                |
     |<-- Photo visible in gallery ---|
```

Uploads are **chunked** (5MB per part) and **resumable** via [Uppy](https://uppy.io/) + R2's S3-compatible multipart API. Network interruptions retry the failed chunk, not the entire file. The Worker proxies each chunk to R2 — no full-file buffering in memory.

See [docs/sequence-diagrams.md](docs/sequence-diagrams.md) for detailed Mermaid sequence diagrams covering upload, download, gallery viewing, retry flows, and admin login.

## Stack

| Layer | Tech |
|---|---|
| API | [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) |
| Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible, no egress fees) |
| Uploads | [Uppy](https://uppy.io/) (chunked multipart, retries, progress) |
| Frontend | React + Vite, served as static assets via Workers |
| Auth | JWT (1h admin, 6h asset, 5m download tokens) |
| ZIP | [fflate](https://github.com/101arrowz/fflate) (streaming server-side, client-side for selection) |

## Project structure

```
daisy/
├── wrangler.toml               # Cloudflare Workers config
├── package.json                # Root deps + scripts
├── tsconfig.json               # Worker TypeScript config
├── vitest.config.ts            # Worker test config
├── scripts/
│   └── load-test.ts            # Concurrent upload load tester
├── src/
│   ├── index.ts                # Worker entry point + middleware
│   ├── types.ts                # Binding types
│   ├── routes/
│   │   ├── auth.ts             # Login + rate limiting
│   │   ├── albums.ts           # Album CRUD + ZIP downloads
│   │   └── uploads.ts          # Multipart upload + photo serving
│   ├── middleware/
│   │   └── auth.ts             # JWT verification
│   ├── lib/
│   │   ├── auth.ts             # Token issuance + verification (4 scopes)
│   │   ├── tokens.ts           # ID + slug generation
│   │   ├── r2.ts               # R2 key helpers
│   │   └── validation.ts       # Input validation + timing-safe compare
│   ├── db/
│   │   └── schema.sql          # D1 schema (4 tables)
│   └── web/                    # React frontend (own package.json)
│       ├── src/
│       │   ├── pages/          # Home, Upload, Gallery
│       │   ├── components/     # FileUploader, PhotoGrid, CodeEntry, QRCode, Logo, ModeToggleButton
│       │   └── lib/            # API client, Uppy integration, image utils
│       └── test/
├── test/                       # Worker API tests
└── dist/web/                   # Built frontend (gitignored)
```

## Album modes

Albums have three independent toggles:

| Toggle | Effect |
|---|---|
| **Uploads** | Guests can upload photos |
| **Gallery** | Anyone with the link can browse photos |
| **Access code** | Required for upload and/or viewing |

These combine freely:

| Example | Uploads | Gallery | Code |
|---|---|---|---|
| Event in progress | on | on | off |
| Event over, photos browsable | off | on | off |
| Private upload only | on | off | on |
| Locked down | off | off | - |

## Token system

| Token | Scope | Expiry | Purpose |
|---|---|---|---|
| Auth | `auth` | 1 hour | Admin login session |
| Asset | `album-assets` | 6 hours | Serve photos/thumbnails to gallery viewers |
| Download | `album-download` | 5 min | Full album ZIP download (owner) |
| Selected download | `selected-download` | 5 min | Specific photos ZIP download (guests + owner) |

All tokens use HS256 (HMAC-SHA256) signed with `JWT_SECRET`.

## API endpoints

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | - | Login (returns JWT) |
| GET | `/api/auth/me` | Bearer | Get current user |

### Albums

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/albums` | Bearer | Create album |
| GET | `/api/albums` | Bearer | List owner's albums |
| GET | `/api/albums/:slug` | - | Public album info |
| GET | `/api/albums/:slug/manage` | Bearer | Owner album view |
| PUT | `/api/albums/:slug` | Bearer | Update album settings |
| POST | `/api/albums/:slug/background` | Bearer | Upload background image |
| DELETE | `/api/albums/:slug/uploads/:id` | Bearer | Delete a photo |
| POST | `/api/albums/:slug/download-token` | Bearer | Issue full download token |
| GET | `/api/albums/:slug/download` | Download token | Stream all photos as ZIP |
| POST | `/api/albums/:slug/selected-download-token` | Bearer or Asset | Issue selected download token |
| GET | `/api/albums/:slug/selected-download` | Selected token | Stream selected photos as ZIP |

### Uploads

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/albums/:slug/upload` | Access code | Reserve upload slot + start multipart |
| GET | `/api/albums/:slug/photos` | Access code | List photos (returns asset token) |
| PUT | `/api/uploads/:id/file` | - | Single-request upload (legacy fallback) |
| PUT | `/api/uploads/:id/part/:n` | - | Upload multipart chunk |
| GET | `/api/uploads/:id/parts` | - | List uploaded parts |
| POST | `/api/uploads/:id/complete` | - | Complete multipart assembly |
| DELETE | `/api/uploads/:id/abort` | - | Abort + cleanup |
| PUT | `/api/uploads/:id/thumbnail` | - | Upload thumbnail |
| GET | `/api/uploads/:id/photo` | Asset token | Serve full photo |
| GET | `/api/uploads/:id/thumbnail` | Asset token | Serve thumbnail |

## Local development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A Cloudflare account (free tier works)

### Setup

```bash
# Install dependencies (auto-installs web deps via postinstall)
npm install

# Create or upgrade the local D1 database
npm run db:migrate

# Start both API and frontend dev servers
npm run dev
```

This starts:
- **API** on `http://localhost:8787`
- **Frontend** on `http://localhost:5173`

Local dev credentials are in `.dev.vars` (not committed):

```
ADMIN_USERS=admin@daisy.app:changeme
JWT_SECRET=local-dev-secret-change-in-production
```

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + frontend together |
| `npm run dev:api` | Start API only |
| `npm run dev:web` | Start frontend only |
| `npm run build` | Build frontend into `dist/web/` |
| `npm run db:migrate` | Apply local D1 migrations |
| `npm run db:migrate:remote` | Apply remote D1 migrations |
| `npm test` | Run worker tests |
| `npm run test:web` | Run frontend tests |
| `npm run test:all` | Run all tests |
| `npm run load-test` | Run load test (60 guests default) |

## Managing R2 storage

Use [rclone](https://rclone.org/) to manage photos in R2 from the command line. One-time setup:

1. Go to **CF Dashboard** > **R2 Object Storage** > **Manage R2 API Tokens** > **Create API Token**
2. Give it read/write access, note the **Access Key ID** and **Secret Access Key**
3. Configure rclone:

```bash
rclone config create r2 s3 provider Cloudflare \
  access_key_id YOUR_ACCESS_KEY \
  secret_access_key YOUR_SECRET_KEY \
  endpoint https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

Then:

| Command | Description |
|---|---|
| `rclone ls r2:daisy-photos` | List all objects |
| `rclone delete r2:daisy-photos` | Delete all objects |
| `rclone ls r2:daisy-photos --include "my-event-*/**"` | List one album's photos |
| `rclone delete r2:daisy-photos --include "my-event-*/**"` | Delete one album's photos |
| `rclone copy r2:daisy-photos ./download` | Download everything locally |
| `rclone copy r2:daisy-photos ./download --include "my-event-*/**"` | Download one album |

Photos are stored as `{album-slug}/{upload-id}.{ext}` with thumbnails in `{album-slug}/thumbs/`.

## Load testing

Daisy ships with a load test harness that simulates concurrent guests uploading photos.

```bash
# Default: 60 guests, 5 photos each, 500KB per photo
npm run load-test

# Custom scenario
npm run load-test -- --guests 120 --photos 5 --size 500 --stagger 200

# Test production
npm run load-test -- --url https://daisy.yourdomain.com --slug your-album-slug
```

| Option | Description | Default |
|---|---|---|
| `--url` | API base URL | `http://localhost:8787` |
| `--guests` | Number of concurrent guests | `60` |
| `--photos` | Photos per guest | `5` |
| `--size` | Photo size in KB | `500` |
| `--stagger` | Delay between guest arrivals (ms) | `500` |
| `--slug` | Existing album slug (skips album creation) | - |
| `--code` | Access code if album is protected | - |
| `--admin` | Admin credentials for album creation | `admin@daisy.app:changeme` |

### Benchmarks (local dev, Windows 11)

| Scenario | Guests | Photos | Total uploads | Data | Success | p95 |
|---|---|---|---|---|---|---|
| Standard event | 60 | 5 | 300 | 152 MB | 100% | 159ms |
| Heavy event | 60 | 10 | 600 | 305 MB | 100% | 235ms |
| Double capacity | 120 | 5 | 600 | 305 MB | 100% | 524ms |
| Stress test | 200 | 10 | 2,000 | 1 GB | 99.95% | 10s |

Production on Cloudflare Workers distributes requests across their global edge network — expect significantly better latency. Re-test against production once deployed:

```bash
npm run load-test -- --url https://daisy.yourdomain.com --guests 60 --photos 10
```

## Deployment

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database + R2 bucket (first time only)
npx wrangler d1 create daisy
npx wrangler r2 bucket create daisy-photos

# Update wrangler.toml with the D1 database_id from above

# Apply migrations to remote database
npm run db:migrate:remote

# Set production secrets
npx wrangler secret put ADMIN_USERS    # email:password
npx wrangler secret put JWT_SECRET     # random string

# Build and deploy
npm run deploy
```

### Custom domains

Add routes in `wrangler.toml` and create matching DNS records (proxied A record to `192.0.2.1`):

```toml
routes = [
  { pattern = "daisy.yourdomain.com/*", zone_name = "yourdomain.com" },
]
```

### Vanity album URLs

Set `DEFAULT_ALBUM_SLUG` to redirect a subdomain straight to an album's upload page:

```toml
[vars]
DEFAULT_ALBUM_SLUG = "your-album-slug"
```

Then add the subdomain as a route:

```toml
routes = [
  { pattern = "daisy.yourdomain.com/*", zone_name = "yourdomain.com" },
  { pattern = "photos.yourdomain.com/*", zone_name = "yourdomain.com" },
]
```

Guests visit `photos.yourdomain.com` and land directly on the upload page.

## Photo format support

| Format | Source | Handling |
|---|---|---|
| JPEG, PNG, WebP, GIF | All phones | Uploaded as-is, thumbnail via canvas |
| HEIC/HEIF | iPhone (default since iOS 11) | Converted to JPEG client-side, thumbnail via canvas |
| AVIF | Newer Android phones | Uploaded as-is, thumbnail via canvas |
| BMP | Rare | Uploaded as-is, thumbnail via canvas |
| TIFF | Camera workflows | Uploaded as-is, placeholder thumbnail |
| DNG (ProRAW) | iPhone Pro | Uploaded as-is (up to 50MB), placeholder thumbnail |
| Live Photos | iPhone | Photo part extracted by iOS automatically |
| Motion Photos | Samsung | JPEG part uploaded, embedded video ignored |

Thumbnails are generated in the browser and uploaded alongside the full-size photo. For formats the browser can't render natively (DNG, TIFF), a placeholder thumbnail is shown — the original file is still stored and downloadable.

## Security

- **Timing-safe** password and access code comparison
- **Rate limiting** on login (5 attempts, 15-minute lockout, persisted in D1)
- **Scoped JWT tokens** — auth, asset, download, and selected-download tokens with appropriate expiries
- **Input validation** — file type whitelist, filename sanitisation, size limits (50MB photo, 500KB thumbnail, 10MB per chunk)
- **Duplicate detection** — SHA-256 hash of first 64KB + file size, checked before upload starts
- **Production error masking** — verbose errors only on localhost

## License

MIT
