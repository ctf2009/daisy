import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, isLoggedIn, clearToken } from '../lib/api';
import { ModeToggleButton } from '../components/ModeToggleButton';
import { PhotoGrid } from '../components/PhotoGrid';

const QRCode = lazy(() => import('../components/QRCode').then(m => ({ default: m.QRCode })));

type Photo = {
  id: string;
  original_filename: string;
  content_type: string;
  uploaded_at: string;
};

type AlbumData = {
  id: string;
  name: string;
  slug: string;
  access_code: string | null;
  is_open: number;
  is_viewable: number;
  welcome_text: string | null;
  asset_token: string;
  uploads: Photo[];
};

type PublicAlbumData = {
  name: string;
  asset_token: string;
  photos: Photo[];
};

export function Gallery() {
  const { slug } = useParams<{ slug: string }>();
  const [album, setAlbum] = useState<AlbumData | null>(null);
  const [publicAlbum, setPublicAlbum] = useState<PublicAlbumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showQR, setShowQR] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const isOwner = isLoggedIn() && album !== null;
  const uploadUrl = `${window.location.origin}/a/${slug}`;

  useEffect(() => {
    if (!slug) return;

    if (isLoggedIn()) {
      // Try to load as owner
      api.getAlbumManage(slug)
        .then(setAlbum)
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Failed to load';
          if (message === 'Invalid or expired token' || message === 'Unauthorized') {
            clearToken();
            // Fall through to public view
            loadPublicGallery();
          } else {
            setError(message);
          }
        })
        .finally(() => setLoading(false));
    } else {
      loadPublicGallery();
    }
  }, [slug]);

  const loadPublicGallery = async () => {
    if (!slug) return;
    try {
      const [albumInfo, photosData] = await Promise.all([
        api.getAlbum(slug),
        api.getAlbumPhotos(slug),
      ]);

      if (!albumInfo.is_viewable) {
        setError('This gallery is not available');
        return;
      }

      setPublicAlbum({
        name: albumInfo.name,
        asset_token: photosData.asset_token,
        photos: photosData.photos,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gallery not available');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (uploadId: string) => {
    if (!slug) return;
    try {
      await api.deleteUpload(slug, uploadId);
      setAlbum((prev) =>
        prev ? { ...prev, uploads: prev.uploads.filter((u) => u.id !== uploadId) } : null
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleToggleOpen = async () => {
    if (!slug || !album) return;
    const newState = !album.is_open;
    try {
      await api.updateAlbum(slug, { is_open: newState });
      setAlbum((prev) => prev ? { ...prev, is_open: newState ? 1 : 0 } : null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleToggleViewable = async () => {
    if (!slug || !album) return;
    const newState = !album.is_viewable;
    try {
      await api.updateAlbum(slug, { is_viewable: newState });
      setAlbum((prev) => prev ? { ...prev, is_viewable: newState ? 1 : 0 } : null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stopSelecting = () => {
    setIsSelecting(false);
    setSelectedPhotos(new Set());
    setDownloading(false);
    setDownloadProgress('');
  };

  const handleDownloadSelected = async () => {
    const selectedIds = (album?.uploads || publicAlbum?.photos || [])
      .filter((p) => selectedPhotos.has(p.id))
      .map((photo) => photo.id);
    if (selectedIds.length === 0 || !slug) return;

    setDownloading(true);
    setDownloadProgress('Preparing...');
    try {
      const assetToken = album?.asset_token || publicAlbum?.asset_token || '';
      await api.downloadSelectedPhotos(slug, selectedIds, assetToken);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
      setDownloadProgress('');
      setSelectedPhotos(new Set());
    }
  };

  if (loading) {
    return <div className="page-center"><p>Loading...</p></div>;
  }

  if (error) {
    return <div className="page-center"><p className="error">{error}</p></div>;
  }

  // Public gallery view
  if (!isOwner && publicAlbum) {
    return (
      <div className="gallery-page">
        <div className="gallery-header">
          <div>
            <h1>{publicAlbum.name}</h1>
            <p className="photo-count">{publicAlbum.photos.length} photo{publicAlbum.photos.length !== 1 ? 's' : ''}</p>
            <div className="guest-page-actions guest-page-actions-left">
              {isSelecting ? (
                <ModeToggleButton mode="done" onClick={stopSelecting} />
              ) : (
                <ModeToggleButton
                  mode="select"
                  onClick={() => {
                    setSelectedPhotos(new Set());
                    setIsSelecting(true);
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {isSelecting && (
          <div className="selection-bar">
            <span>{selectedPhotos.size} selected</span>
            <div className="selection-bar-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedPhotos(new Set())}>
                Clear
              </button>
              <button
                className="btn btn-primary"
                disabled={selectedPhotos.size === 0 || downloading}
                onClick={handleDownloadSelected}
              >
                {downloading ? downloadProgress : 'Download'}
              </button>
            </div>
          </div>
        )}

        <PhotoGrid
          photos={publicAlbum.photos}
          assetToken={publicAlbum.asset_token}
          selectable={isSelecting}
          selectedIds={selectedPhotos}
          onToggleSelect={togglePhotoSelection}
        />
      </div>
    );
  }

  if (!album) {
    return <div className="page-center"><p className="error">Album not found</p></div>;
  }

  // Owner gallery view
  return (
    <div className="gallery-page">
      <Link to="/" className="back-link">&larr; Albums</Link>
      <div className="gallery-header">
        <div>
          <h1>{album.name}</h1>
          <p className="photo-count">
            {album.uploads.length} photo{album.uploads.length !== 1 ? 's' : ''}
            {' '}&middot;{' '}
            <span className={album.is_open ? 'status-open' : 'status-closed'}>
              {album.is_open ? 'Open' : 'Closed'}
            </span>
            {' '}&middot;{' '}
            <span className={album.is_viewable ? 'status-open' : 'status-closed'}>
              Gallery: {album.is_viewable ? 'Visible' : 'Hidden'}
            </span>
          </p>
        </div>
        <div className="gallery-actions">
          <button className="btn btn-secondary" onClick={handleToggleOpen}>
            Uploads: {album.is_open ? 'On' : 'Off'}
          </button>
          <button className="btn btn-secondary" onClick={handleToggleViewable}>
            Gallery: {album.is_viewable ? 'On' : 'Off'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowQR(!showQR)}>
            {showQR ? 'Hide QR' : 'Show QR Code'}
          </button>
          {album.uploads.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await api.downloadAlbum(slug!);
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Download failed');
                }
              }}
            >
              Download All
            </button>
          )}
        </div>
      </div>

      {showQR && (
        <Suspense fallback={<div className="qr-section"><p>Loading...</p></div>}>
        <div className="qr-section">
          <QRCode url={uploadUrl} albumName={album.name} />
          <p>Share this QR code with your guests</p>
          {album.access_code && (
            <p className="access-code-display">
              Access code: <strong>{album.access_code}</strong>
            </p>
          )}
        </div>
        </Suspense>
      )}

      <PhotoGrid
        photos={album.uploads}
        assetToken={album.asset_token}
        canDelete
        onDelete={handleDelete}
      />
    </div>
  );
}
