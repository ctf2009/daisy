import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, isLoggedIn, clearToken } from '../lib/api';
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
  welcome_text: string | null;
  uploads: Photo[];
};

export function Gallery() {
  const { slug } = useParams<{ slug: string }>();
  const [album, setAlbum] = useState<AlbumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showQR, setShowQR] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const uploadUrl = `${window.location.origin}/a/${slug}`;

  const fetchAlbum = async () => {
    if (!slug) return;
    try {
      const data = await api.getAlbumManage(slug);
      setAlbum(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      if (message === 'Invalid or expired token' || message === 'Unauthorized') {
        clearToken();
        navigate('/', { replace: true });
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate('/', { replace: true });
      return;
    }
    fetchAlbum();
  }, [slug]);

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

  if (loading) {
    return <div className="page-center"><p>Loading...</p></div>;
  }

  if (error || !album) {
    return <div className="page-center"><p className="error">{error || 'Album not found'}</p></div>;
  }

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <div>
          <h1>{album.name}</h1>
          <p className="photo-count">{album.uploads.length} photos</p>
        </div>
        <div className="gallery-actions">
          <button className="btn btn-secondary" onClick={() => setShowQR(!showQR)}>
            {showQR ? 'Hide QR' : 'Show QR Code'}
          </button>
          {album.uploads.length > 0 && (
            <button
              className="btn btn-primary"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                setDownloadProgress('Preparing...');
                try {
                  await api.downloadAlbum(slug!, album.uploads, album.name, (done, total) => {
                    setDownloadProgress(`${done}/${total} photos`);
                  });
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Download failed');
                } finally {
                  setDownloading(false);
                  setDownloadProgress('');
                }
              }}
            >
              {downloading ? downloadProgress : 'Download All'}
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
        canDelete
        slug={slug}
        onDelete={handleDelete}
      />
    </div>
  );
}
