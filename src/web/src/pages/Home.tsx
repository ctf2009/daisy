import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, isLoggedIn, clearToken } from '../lib/api';
import { Logo } from '../components/Logo';

type AlbumSummary = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  upload_count: number;
};

export function Home() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'landing' | 'login' | 'dashboard' | 'create'>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [welcomeText, setWelcomeText] = useState('');
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadAlbums = async () => {
    try {
      const data = await api.listAlbums();
      setAlbums(data.albums as AlbumSummary[]);
    } catch {
      // Token may be expired
      clearToken();
      setStep('login');
    }
  };

  const handleStart = () => {
    if (isLoggedIn()) {
      setStep('dashboard');
      loadAlbums();
    } else {
      setStep('login');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      setStep('dashboard');
      loadAlbums();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      const album = await api.createAlbum({
        name: albumName,
        access_code: accessCode || undefined,
        welcome_text: welcomeText || undefined,
      });
      navigate(`/a/${album.slug}/gallery`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create album');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setStep('landing');
    setAlbums([]);
  };

  // Auto-load dashboard if already logged in
  useEffect(() => {
    if (isLoggedIn()) {
      setStep('dashboard');
      loadAlbums();
    }
  }, []);

  return (
    <div className="home-page">
      <div className="home-container">
        <Logo width={420} className="logo" />
        <p className="tagline">Simple photo sharing for your events</p>

        {step === 'landing' && (
          <div className="home-actions">
            <button className="btn btn-primary" onClick={handleStart}>
              Manage albums
            </button>
            <p className="home-hint">
              Guests scan a QR code to upload photos. No app needed.
            </p>
          </div>
        )}

        {step === 'login' && (
          <form onSubmit={handleLogin} className="form">
            <p>Sign in to manage your albums.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              autoFocus
              className="input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="input"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}

        {step === 'dashboard' && (
          <div className="dashboard">
            {albums.length > 0 && (
              <div className="album-list">
                <h2>Your albums</h2>
                {albums.map((album) => (
                  <div
                    key={album.id}
                    className="album-card"
                    onClick={() => navigate(`/a/${album.slug}/gallery`)}
                  >
                    <div className="album-card-info">
                      <span className="album-card-name">{album.name}</span>
                      <span className="album-card-meta">
                        {album.upload_count} photo{album.upload_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="album-card-arrow">&rsaquo;</span>
                  </div>
                ))}
              </div>
            )}
            <div className="dashboard-actions">
              <button className="btn btn-primary" onClick={() => setStep('create')}>
                Create new album
              </button>
              <button className="btn btn-secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </div>
        )}

        {step === 'create' && (
          <form onSubmit={handleCreateAlbum} className="form">
            <h2>Create your album</h2>
            <label>
              Event name
              <input
                type="text"
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Sarah & Tom's Wedding"
                required
                className="input"
              />
            </label>
            <label>
              Welcome message (optional)
              <input
                type="text"
                value={welcomeText}
                onChange={(e) => setWelcomeText(e.target.value)}
                placeholder="Share your favourite moments!"
                className="input"
              />
            </label>
            <label>
              Access code (optional)
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Leave blank for open access"
                className="input"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create album'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { setStep('dashboard'); setError(undefined); }}>
              Back
            </button>
          </form>
        )}
      </div>
      <footer className="home-footer">
        <a href="https://chrisflaherty.au" target="_blank" rel="noopener noreferrer">chrisflaherty.au</a>
      </footer>
    </div>
  );
}
