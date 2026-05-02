# Sequence Diagrams

## Guest uploads a photo

```mermaid
sequenceDiagram
    participant G as Guest Phone
    participant W as Worker
    participant R2 as R2 Storage
    participant D1 as D1 Database

    G->>G: Convert HEIC→JPEG, generate thumbnail, hash file
    G->>W: POST /albums/:slug/upload {content_type, filename, content_hash}
    W->>D1: Check duplicate (content_hash)
    alt Duplicate found
        W-->>G: {duplicate: true}
    else New file
        W->>R2: createMultipartUpload(key)
        R2-->>W: multipartUploadId
        W->>D1: INSERT upload record
        W-->>G: {upload_id, multipart_upload_id, r2_key}
    end

    loop Each 5MB chunk (via Uppy)
        G->>W: PUT /uploads/:id/part/:n (chunk bytes)
        W->>R2: uploadPart(partNumber, bytes)
        R2-->>W: ETag
        W->>D1: Save part (upload_parts)
        W-->>G: 204 + ETag header
    end

    G->>W: POST /uploads/:id/complete {parts}
    W->>R2: complete(parts)
    R2-->>W: Final object
    W->>D1: UPDATE file_size, clear parts
    W-->>G: {ok: true}

    G->>W: PUT /uploads/:id/thumbnail (JPEG)
    W->>R2: put(thumbnail_key, bytes)
    W-->>G: {ok: true}
```

## Owner downloads all photos

```mermaid
sequenceDiagram
    participant O as Owner
    participant W as Worker
    participant R2 as R2 Storage

    O->>W: POST /albums/:slug/download-token (Bearer auth)
    W-->>O: {token} (5min expiry, scoped to album)

    O->>W: GET /albums/:slug/download?token=...
    W->>W: Verify download token + ownership

    loop Each photo in album
        W->>R2: get(r2_key)
        R2-->>W: Photo bytes
        W-->>O: Stream into ZIP
    end

    O->>O: Browser saves .zip file
```

## Guest views gallery and downloads selected photos

```mermaid
sequenceDiagram
    participant G as Guest
    participant W as Worker

    G->>W: GET /albums/:slug/photos
    W-->>G: {asset_token, photos[]}

    Note over G: Guest browses thumbnails using asset_token

    G->>G: Selects photos to download
    G->>W: POST /albums/:slug/selected-download-token {ids, asset_token}
    W-->>G: {token} (5min expiry, scoped to selected IDs)

    G->>W: GET /albums/:slug/selected-download?token=...
    W-->>G: ZIP stream of selected photos
```

## Admin login + album creation

```mermaid
sequenceDiagram
    participant A as Admin
    participant W as Worker
    participant D1 as D1 Database

    A->>W: POST /api/auth/login {email, password}
    W->>D1: Check rate limit (login_attempts)
    alt Rate limited
        W-->>A: 429 Too Many Requests
    else
        W->>W: Verify credentials (timing-safe compare)
        alt Invalid
            W->>D1: Record failed attempt
            W-->>A: 401 Invalid credentials
        else Valid
            W->>D1: Clear attempts
            W-->>A: {token} (1h JWT)
        end
    end

    A->>W: POST /api/albums {name, access_code?, welcome_text?}
    W->>D1: INSERT album (slug auto-generated)
    W-->>A: {id, slug, name}

    A->>W: PUT /api/albums/:slug {is_open: true, is_viewable: true}
    W->>D1: UPDATE album
    W-->>A: {ok: true}
```

## Multipart upload retry flow

```mermaid
sequenceDiagram
    participant G as Guest Phone
    participant U as Uppy
    participant W as Worker
    participant R2 as R2 Storage

    G->>U: addFile(photo)
    U->>U: Split into 5MB chunks

    U->>W: PUT /part/1 (5MB)
    W->>R2: uploadPart(1, bytes)
    R2-->>W: ETag
    W-->>U: 204 + ETag

    U->>W: PUT /part/2 (5MB)
    Note over U,W: Network fails mid-transfer
    U--xW: Connection lost

    Note over U: Uppy waits [0, 1s, 3s, 5s, 10s] then retries

    U->>W: PUT /part/2 (5MB) — retry
    W->>R2: uploadPart(2, bytes)
    R2-->>W: ETag
    W-->>U: 204 + ETag

    U->>W: PUT /part/3 (remaining bytes)
    W->>R2: uploadPart(3, bytes)
    R2-->>W: ETag
    W-->>U: 204 + ETag

    U->>W: POST /complete {parts: [{1, etag}, {2, etag}, {3, etag}]}
    W->>R2: complete(parts)
    W-->>U: {ok: true}
    U-->>G: Upload complete
```
