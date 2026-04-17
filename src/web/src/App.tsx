import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import './App.css';

const Upload = lazy(() => import('./pages/Upload').then((m) => ({ default: m.Upload })));
const Gallery = lazy(() => import('./pages/Gallery').then((m) => ({ default: m.Gallery })));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="page-center"><p>Loading...</p></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/a/:slug" element={<Upload />} />
          <Route path="/a/:slug/gallery" element={<Gallery />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
