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

const SWIPE_THRESHOLD = 64;
const SWIPE_ANIMATION_MS = 260;

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
  const pendingIndexRef = useRef<number | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);

  const canNavigate = photos.length > 1;

  const clearAnimationTimeout = () => {
    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
  };

  // Land the in-flight slide: commit the pending index and recenter the track
  // in a single transition-free render.
  const finalizeAnimation = () => {
    clearAnimationTimeout();
    if (pendingIndexRef.current !== null) {
      setSelectedIndex(pendingIndexRef.current);
      pendingIndexRef.current = null;
    }
    setIsAnimating(false);
    setDragOffset(0);
  };

  const closeLightbox = () => {
    clearAnimationTimeout();
    pendingIndexRef.current = null;
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

  const scheduleFinalize = () => {
    clearAnimationTimeout();
    animationTimeoutRef.current = window.setTimeout(() => {
      animationTimeoutRef.current = null;
      finalizeAnimation();
    }, SWIPE_ANIMATION_MS);
  };

  const animateTo = (direction: 1 | -1) => {
    if (selectedIndex === null || !canNavigate) return;

    // If a slide is mid-flight, land it now so rapid presses never get dropped.
    let baseIndex = selectedIndex;
    if (pendingIndexRef.current !== null) {
      baseIndex = pendingIndexRef.current;
      finalizeAnimation();
    }

    pendingIndexRef.current = shiftIndex(baseIndex, direction);
    startXRef.current = null;
    setIsDragging(false);
    setIsAnimating(true);
    setDragOffset(direction === 1 ? -getStageWidth() : getStageWidth());
    scheduleFinalize();
  };

  const snapBack = () => {
    setIsAnimating(true);
    setDragOffset(0);
    scheduleFinalize();
  };

  const handleCardClick = (photo: Photo) => {
    if (selectable && onToggleSelect) {
      onToggleSelect(photo.id);
      return;
    }

    const index = photos.findIndex((candidate) => candidate.id === photo.id);
    pendingIndexRef.current = null;
    setSelectedIndex(index >= 0 ? index : null);
    setDragOffset(0);
    setIsAnimating(false);
  };

  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        animateTo(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        animateTo(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Keep the page from scrolling behind the open lightbox
  useEffect(() => {
    if (selectedIndex === null) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedIndex !== null]);

  useEffect(() => {
    return () => clearAnimationTimeout();
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Swipe is a touch/pen gesture; mouse users get the buttons and arrow keys.
    if (event.pointerType === 'mouse' || !canNavigate) return;

    if (pendingIndexRef.current !== null) {
      finalizeAnimation();
    }

    startXRef.current = event.clientX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || startXRef.current === null) return;
    setDragOffset(event.clientX - startXRef.current);
  };

  const releaseCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release failures if capture was lost.
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    releaseCapture(event);
    if (!isDragging) return;

    startXRef.current = null;
    setIsDragging(false);

    if (Math.abs(dragOffset) < SWIPE_THRESHOLD) {
      snapBack();
      return;
    }

    animateTo(dragOffset < 0 ? 1 : -1);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    releaseCapture(event);
    startXRef.current = null;
    setIsDragging(false);
    snapBack();
  };

  if (photos.length === 0) {
    return (
      <div className="photo-grid-empty">
        <p>No photos yet. Share the link to start collecting!</p>
      </div>
    );
  }

  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  // Three-slide track: the previous and next photos are already rendered
  // beside the current one, so navigation slides real content in and out.
  const slides = selectedIndex !== null
    ? (canNavigate
        ? [photos[shiftIndex(selectedIndex, -1)], photos[selectedIndex], photos[shiftIndex(selectedIndex, 1)]]
        : [photos[selectedIndex]])
    : [];
  const baseShift = canNavigate ? '-100%' : '0%';

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
                draggable={false}
              />
              {selectable && (
                <div className={`select-indicator ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '✓' : ''}
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
        <div className="lightbox" role="dialog" aria-modal="true" onClick={closeLightbox}>
          {canNavigate && (
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
          )}

          <div
            ref={stageRef}
            className="lightbox-stage"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <div
              className={`lightbox-track${isAnimating && !isDragging ? ' animating' : ''}`}
              style={{ transform: `translateX(calc(${baseShift} + ${dragOffset}px))` }}
            >
              {slides.map((photo, slot) => (
                <div className="lightbox-slide" key={`${slot}-${photo.id}`}>
                  <img
                    src={api.getPhotoUrl(photo, assetToken)}
                    alt={photo.original_filename || 'Full size'}
                    draggable={false}
                    style={{
                      // The grid thumbnail is already cached — show it behind
                      // the full-size image while that loads.
                      backgroundImage: `url(${api.getThumbnailUrl(photo, assetToken)})`,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {canNavigate && (
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
          )}

          {canNavigate && selectedIndex !== null && (
            <div className="lightbox-counter" onClick={(e) => e.stopPropagation()}>
              {selectedIndex + 1} / {photos.length}
            </div>
          )}

          <button className="lightbox-close" onClick={closeLightbox} aria-label="Close preview">
            &times;
          </button>
        </div>
      )}
    </>
  );
}
