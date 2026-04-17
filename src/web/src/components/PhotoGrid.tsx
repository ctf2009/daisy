import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type Photo = {
  id: string;
  original_filename: string;
  content_type: string;
  uploaded_at: string;
};

type Props = {
  photos: Photo[];
  assetToken: string;
  canDelete?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
};

const SWIPE_THRESHOLD = 72;
const SWIPE_ANIMATION_MS = 280;

export function PhotoGrid({
  photos,
  assetToken,
  canDelete,
  selectable,
  selectedIds,
  onToggleSelect,
  onDelete,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const startXRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const animationTimeoutRef = useRef<number | null>(null);

  if (photos.length === 0) {
    return (
      <div className="photo-grid-empty">
        <p>No photos yet. Share the link to start collecting!</p>
      </div>
    );
  }

  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  const clearAnimationTimeout = () => {
    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
  };

  const closeLightbox = () => {
    clearAnimationTimeout();
    setSelectedIndex(null);
    setDragOffset(0);
    setIsDragging(false);
    setIsAnimating(false);
    startXRef.current = null;
  };

  const getStageWidth = () => {
    return stageRef.current?.clientWidth || Math.max(window.innerWidth - 96, 320);
  };

  const shiftIndex = (current: number, direction: 1 | -1) =>
    direction === 1
      ? (current === photos.length - 1 ? 0 : current + 1)
      : (current === 0 ? photos.length - 1 : current - 1);

  const animateTo = (direction: 1 | -1) => {
    if (selectedIndex === null || isAnimating) return;

    const width = getStageWidth();
    const nextIndex = shiftIndex(selectedIndex, direction);

    clearAnimationTimeout();
    setIsDragging(false);
    setIsAnimating(true);
    startXRef.current = null;

    // 1. Jump the stage to the incoming side (no transition)
    setDragOffset(direction === 1 ? width : -width);
    setSelectedIndex(nextIndex);

    // 2. Wait for the browser to paint at the off-screen position, then slide to center
    requestAnimationFrame(() => {
      // Force layout so the browser registers the off-screen position
      stageRef.current?.getBoundingClientRect();
      requestAnimationFrame(() => {
        setDragOffset(0);
      });
    });

    animationTimeoutRef.current = window.setTimeout(() => {
      setIsAnimating(false);
      animationTimeoutRef.current = null;
    }, SWIPE_ANIMATION_MS);
  };

  const handleCardClick = (photo: Photo) => {
    if (selectable && onToggleSelect) {
      onToggleSelect(photo.id);
      return;
    }

    const index = photos.findIndex((candidate) => candidate.id === photo.id);
    setSelectedIndex(index >= 0 ? index : null);
    setDragOffset(0);
    setIsAnimating(false);
  };

  // Preload adjacent images so swipe transitions are instant
  useEffect(() => {
    if (selectedIndex === null) return;

    const prevIndex = shiftIndex(selectedIndex, -1);
    const nextIndex = shiftIndex(selectedIndex, 1);

    for (const idx of [prevIndex, nextIndex]) {
      if (idx !== selectedIndex) {
        const img = new Image();
        img.src = api.getPhotoUrl(photos[idx], assetToken);
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        animateTo(-1);
      } else if (event.key === 'ArrowRight') {
        animateTo(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, isAnimating]);

  useEffect(() => {
    return () => clearAnimationTimeout();
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isAnimating) return;

    startXRef.current = event.clientX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || startXRef.current === null) return;
    setDragOffset(event.clientX - startXRef.current);
  };

  const resetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release failures if capture was lost.
    }

    startXRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const deltaX = dragOffset;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) {
      resetDrag(event);
      return;
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release failures if capture was lost.
    }

    if (deltaX < 0) {
      animateTo(1);
    } else {
      animateTo(-1);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    resetDrag(event);
  };

  const dragOpacity = isDragging
    ? Math.max(0.78, 1 - Math.min(Math.abs(dragOffset) / 480, 0.22))
    : 1;

  return (
    <>
      <div className="photo-grid">
        {photos.map((photo) => {
          const isSelected = selectedIds?.has(photo.id) ?? false;
          return (
            <div
              key={photo.id}
              className={`photo-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleCardClick(photo)}
            >
              <img
                src={api.getThumbnailUrl(photo, assetToken)}
                alt={photo.original_filename}
                loading="lazy"
              />
              {selectable && (
                <div className={`select-indicator ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '\u2713' : ''}
                </div>
              )}
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
                  &times;
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selectedPhoto && (
        <div className="lightbox" onClick={closeLightbox}>
          <button
            className="lightbox-nav lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              animateTo(-1);
            }}
            aria-label="Previous photo"
          >
            &lsaquo;
          </button>

          <div
            ref={stageRef}
            className={`lightbox-stage${isDragging ? ' dragging' : ''}`}
            style={{
              transform: `translateX(${dragOffset}px)`,
              opacity: dragOpacity,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <img
              src={api.getPhotoUrl(selectedPhoto, assetToken)}
              alt={selectedPhoto.original_filename || 'Full size'}
            />
          </div>

          <button
            className="lightbox-nav lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              animateTo(1);
            }}
            aria-label="Next photo"
          >
            &rsaquo;
          </button>

          <button className="lightbox-close" onClick={closeLightbox} aria-label="Close preview">
            &times;
          </button>
        </div>
      )}
    </>
  );
}
