import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CodeEntry } from '../components/CodeEntry';
import { FileUploader } from '../components/FileUploader';
import { ModeToggleButton } from '../components/ModeToggleButton';
import { PhotoGrid } from '../components/PhotoGrid';

function TroubleshootingHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="help-section">
      <button className="help-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Hide help' : 'Having trouble?'}
      </button>
      {open && (
        <div className="help-content">
          <h3>Nothing happens when I select photos</h3>
          <p>Your device may need free storage space to prepare photos for upload. Try freeing up some space and try again.</p>

          <h3>Photos are taking a long time</h3>
          <p>If your photos are stored in iCloud or Google Photos, your device needs to download them first. Try opening the photos in your gallery app before uploading.</p>

          <h3>Upload failed</h3>
          <p>Check your internet connection and try again. Each photo can be up to 50MB.</p>

          <h3>Supported formats</h3>
          <p>JPEG, PNG, HEIC, WebP, AVIF, TIFF, and DNG are all supported.</p>
        </div>
      )}
    </div>
  );
}

type AlbumInfo = {
  name: string;
  slug: string;
  welcome_text: string | null;
  background_url: string | null;
  is_open: boolean;
  is_viewable: boolean;
  requires_code: boolean;
};

type Photo = {
  id: string;
  original_filename: string;
  content_type: string;
  uploaded_at: string;
};

export function Upload() {
  const { slug } = useParams<{ slug: string }>();
  const [album, setAlbum] = useState<AlbumInfo | null>(null);
  const [accessCode, setAccessCode] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string>();
  const [codeVerified, setCodeVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [assetToken, setAssetToken] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const loadPhotos = async () => {
    if (!slug) return;
    try {
      const res = await api.getAlbumPhotos(slug, accessCode);
      setPhotos(res.photos);
      setAssetToken(res.asset_token);
    } catch {}
  };

  useEffect(() => {
    if (!slug) return;
    api.getAlbum(slug)
      .then((data) => {
        setAlbum(data);
        if (!data.requires_code) {
          setCodeVerified(true);
        }
        if (data.is_viewable && !data.requires_code) {
          api.getAlbumPhotos(slug).then((res) => {
            setPhotos(res.photos);
            setAssetToken(res.asset_token);
          }).catch(() => {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleCodeSubmit = async (code: string) => {
    setCodeError(undefined);
    try {
      const res = await api.getAlbumPhotos(slug!, code);
      setAccessCode(code);
      setCodeVerified(true);
      if (album?.is_viewable) {
        setPhotos(res.photos);
        setAssetToken(res.asset_token);
      }
    } catch {
      setCodeError('Invalid access code');
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
    const selectedIds = photos
      .filter((p) => selectedPhotos.has(p.id))
      .map((photo) => photo.id);
    if (selectedIds.length === 0 || !slug) return;

    setDownloading(true);
    setDownloadProgress('Preparing...');
    try {
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

  if (error || !album) {
    return <div className="page-center"><p className="error">Album not found</p></div>;
  }

  // Nothing available
  if (!album.is_open && !album.is_viewable) {
    return (
      <div className="page-center">
        <h1>{album.welcome_text || album.name}</h1>
        <p className="upload-closed">This album is not currently available.</p>
      </div>
    );
  }

  // Protected — need code first
  if (album.requires_code && !codeVerified) {
    return (
      <div className="upload-page">
        <div className="upload-container">
          <h1>{album.welcome_text || album.name}</h1>
          <CodeEntry onSubmit={handleCodeSubmit} error={codeError} />
        </div>
      </div>
    );
  }

  // Upload-only mode (not viewable)
  if (album.is_open && !album.is_viewable) {
    return (
      <div className="upload-page">
        <div className="upload-container">
          <h1>{album.welcome_text || album.name}</h1>
          <p className="upload-intro">
            Select photos from your device to share with everyone.
          </p>
          <FileUploader slug={slug!} accessCode={accessCode} />
          <TroubleshootingHelp />
        </div>
      </div>
    );
  }

  // Gallery view (viewable, optionally with upload)
  return (
    <div className="guest-page">
      <div className="guest-page-header">
        <h1>{album.welcome_text || album.name}</h1>
        {album.is_viewable && (
          <p className="photo-count">
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </p>
        )}
        {album.is_viewable && photos.length > 0 && (
          <div className="guest-page-actions">
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
        )}
      </div>

      {!album.is_open && album.is_viewable && photos.length === 0 && (
        <p className="upload-closed">No photos have been shared yet.</p>
      )}

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

      {album.is_viewable && photos.length > 0 && (
        <PhotoGrid
          photos={photos}
          assetToken={assetToken}
          selectable={isSelecting}
          selectedIds={selectedPhotos}
          onToggleSelect={togglePhotoSelection}
        />
      )}

      {/* Upload CTA + Modal */}
      {album.is_open && (
        <>
          <div className="upload-launcher">
            <button
              className="upload-launch-button"
              onClick={() => setShowUploadModal(true)}
              aria-label="Upload photos"
            >
              <span className="upload-launch-plus" aria-hidden="true">+</span>
              <span>Upload photos</span>
            </button>
          </div>

          {showUploadModal && (
            <div className="upload-modal-overlay" onClick={() => setShowUploadModal(false)}>
              <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
                <div className="upload-modal-header">
                  <h2>Upload photos</h2>
                  <button
                    className="upload-modal-close"
                    onClick={() => setShowUploadModal(false)}
                  >
                    ×
                  </button>
                </div>
                <FileUploader
                  slug={slug!}
                  accessCode={accessCode}
                  onUploadComplete={() => {
                    loadPhotos();
                  }}
                />
                <TroubleshootingHelp />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
