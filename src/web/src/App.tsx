import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Upload } from './pages/Upload';
import { Gallery } from './pages/Gallery';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/a/:slug" element={<Upload />} />
        <Route path="/a/:slug/gallery" element={<Gallery />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
