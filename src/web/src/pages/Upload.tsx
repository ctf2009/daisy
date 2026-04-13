import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CodeEntry } from '../components/CodeEntry';
import { FileUploader } from '../components/FileUploader';

type AlbumInfo = {
  name: string;
  slug: string;
  welcome_text: string | null;
  background_url: string | null;
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

        {!codeVerified ? (
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
          </>
        )}
      </div>
    </div>
  );
}
