<p align="center">
  <img src="daisy.png" alt="Daisy" width="400">
</p>

<p align="center">
  Simple photo sharing for your events
</p>

---

Daisy lets guests at your event upload photos by scanning a QR code or visiting a link. No app downloads, no sign-ups — just tap, pick photos, and upload.

## How it works

1. **Create an album** — sign in, name your event, optionally set an access code
2. **Share the link** — print the QR code on tables, or share a vanity URL like `photos.yourdomain.com`
3. **Guests upload** — they scan the QR, select photos from their camera roll, done
4. **View your gallery** — all photos in one place, downloadable by you

## Stack

| Layer | Tech |
|---|---|
| API | [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) |
| Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible, no egress fees) |
| Frontend | React + Vite, served as static assets via Workers |
| Auth | JWT with admin credentials via environment secrets |

## Project structure

```
daisy/
├── wrangler.toml           # Cloudflare Workers config
├── package.json            # Root deps + scripts
├── src/
│   ├── index.ts            # Worker entry point
│   ├── types.ts            # Binding types
│   ├── routes/
│   │   ├── auth.ts         # Login (JWT)
│   │   ├── albums.ts       # Album CRUD
│   │   └── uploads.ts      # Photo upload + serving
│   ├── middleware/
│   │   └── auth.ts         # JWT verification
│   ├── lib/
│   │   ├── tokens.ts       # ID + slug generation
│   │   ├── r2.ts           # R2 key helpers
│   │   └── validation.ts   # Input validation + timing-safe compare
│   ├── db/
│   │   └── schema.sql      # D1 schema
│   └── web/                # React frontend (own package.json)
│       ├── src/
│       │   ├── pages/      # Home, Upload, Gallery
│       │   ├── components/ # FileUploader, CodeEntry, PhotoGrid, QRCode, Logo
│       │   └── lib/        # API client, image utils (HEIC conversion)
│       └── test/
├── test/                   # Worker API tests
└── dist/web/               # Built frontend (gitignored)
```

## Local development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A Cloudflare account (free tier works)

### Setup

```bash
# Install dependencies (auto-installs web deps via postinstall)
npm install

# Apply the D1 schema locally
npx wrangler d1 execute daisy --local --file=src/db/schema.sql

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

### Other commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + frontend together |
| `npm run dev:api` | Start API only |
| `npm run dev:web` | Start frontend only |
| `npm run build` | Build frontend into `dist/web/` |
| `npm test` | Run worker tests |
| `npm run test:web` | Run frontend tests |
| `npm run test:all` | Run all tests |

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

Daisy ships with a load test harness that simulates concurrent guests uploading photos. Run it against local or production to prove the system holds up under pressure.

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
| `--slug` | Existing album slug (skips album creation) | — |
| `--code` | Access code if album is protected | — |
| `--admin` | Admin credentials for album creation | `admin@daisy.app:changeme` |

### Benchmarks (local dev, Windows 11)

| Scenario | Guests | Photos | Total uploads | Data | Success | p95 |
|---|---|---|---|---|---|---|
| Standard event | 60 | 5 | 300 | 152 MB | 100% | 159ms |
| Heavy event | 60 | 10 | 600 | 305 MB | 100% | 235ms |
| Double capacity | 120 | 5 | 600 | 305 MB | 100% | 524ms |
| Stress test | 200 | 10 | 2,000 | 1 GB | 99.95% | 10s |

Local dev runs everything through a single process. Production on Cloudflare Workers distributes requests across their global edge network — expect significantly better latency and throughput. Re-test against production once deployed with:

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

# Apply schema to remote database
npm run db:migrate:remote

# Set production secrets
npx wrangler secret put ADMIN_USERS    # email:password
npx wrangler secret put JWT_SECRET     # random string

# Build and deploy
npm run deploy
```

### Custom domains

Add routes in `wrangler.toml` to serve from your domain:

```toml
routes = [
  { pattern = "daisy.yourdomain.com/*", zone_name = "yourdomain.com" },
]
```

### Vanity album URLs

Set `DEFAULT_ALBUM_SLUG` to redirect a subdomain straight to an album's upload page:

```bash
npx wrangler secret put DEFAULT_ALBUM_SLUG   # your-album-slug
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

Daisy handles all phone photo formats out of the box:

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

Thumbnails are generated in the browser and uploaded alongside the full-size photo. For formats the browser can't render natively (DNG, TIFF), a placeholder thumbnail with the file extension is shown in the gallery — the original file is still stored and downloadable.

## License

MIT
