import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CodeEntry } from '../components/CodeEntry';
import { FileUploader } from '../components/FileUploader';

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
  requires_code: boolean;
};

export function Upload() {
  const { slug } = useParams<{ slug: string }>();
  const [album, setAlbum] = useState<AlbumInfo | null>(null);
  const [accessCode, setAccessCode] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string>();
  const [codeVerified, setCodeVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!slug) return;
    api.getAlbum(slug)
      .then((data) => {
        setAlbum(data);
        if (!data.requires_code) {
          setCodeVerified(true);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleCodeSubmit = async (code: string) => {
    setCodeError(undefined);
    try {
      // Verify code by attempting to fetch photos
      await api.getAlbumPhotos(slug!, code);
      setAccessCode(code);
      setCodeVerified(true);
    } catch {
      setCodeError('Invalid access code');
    }
  };

  if (loading) {
    return <div className="page-center"><p>Loading...</p></div>;
  }

  if (error || !album) {
    return <div className="page-center"><p className="error">Album not found</p></div>;
  }

  const backgroundStyle = album.background_url
    ? { backgroundImage: `url(${album.background_url})` }
    : undefined;

  return (
    <div className="upload-page" style={backgroundStyle}>
      <div className="upload-container">
        <h1>{album.welcome_text || album.name}</h1>

        {!album.is_open ? (
          <p className="upload-closed">This album is no longer accepting photos.</p>
        ) : !codeVerified ? (
          <CodeEntry onSubmit={handleCodeSubmit} error={codeError} />
        ) : (
          <>
            <p className="upload-intro">
              Select photos from your device to share with everyone.
            </p>
            <FileUploader
              slug={slug!}
              accessCode={accessCode}
            />
            <TroubleshootingHelp />
          </>
        )}
      </div>
    </div>
  );
}
