import { useState } from 'react';
import { api } from '../lib/api';

type Photo = {
  id: string;
  original_filename: string;
  content_type: string;
  uploaded_at: string;
};

type Props = {
  photos: Photo[];
  canDelete?: boolean;
  slug?: string;
  onDelete?: (id: string) => void;
};

export function PhotoGrid({ photos, canDelete, onDelete }: Props) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  if (photos.length === 0) {
    return (
      <div className="photo-grid-empty">
        <p>No photos yet. Share the link to start collecting!</p>
      </div>
    );
  }

  return (
    <>
      <div className="photo-grid">
        {photos.map((photo) => (
          <div key={photo.id} className="photo-card" onClick={() => setSelectedPhoto(photo.id)}>
            <img
              src={api.getThumbnailUrl(photo.id)}
              alt={photo.original_filename}
              loading="lazy"
            />
            {canDelete && (
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this photo?')) {
                    onDelete?.(photo.id);
                  }
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {selectedPhoto && (
        <div className="lightbox" onClick={() => setSelectedPhoto(null)}>
          <img
            src={api.getPhotoUrl(selectedPhoto)}
            alt="Full size"
            onClick={(e) => e.stopPropagation()}
          />
          <button className="lightbox-close" onClick={() => setSelectedPhoto(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
