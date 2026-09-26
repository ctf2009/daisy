import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileUploader } from '../src/components/FileUploader';
import { api } from '../src/lib/api';

vi.mock('../src/lib/api', () => ({ api: {
  requestUpload: vi.fn().mockResolvedValue({ duplicate: true }),
} }));
vi.mock('../src/lib/uppyUpload', () => ({ uploadFileMultipart: vi.fn() }));
vi.mock('../src/lib/imageUtils', () => ({
  ensureFileReady: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  getSupportedImageMimeType: (file: File) => file.type,
  isLikelySupportedImage: () => true,
  generateContentHash: vi.fn().mockResolvedValue('hash'),
  convertToJpeg: async (file: File) => file,
  generateThumbnail: vi.fn().mockResolvedValue(new Blob()),
}));

function selectPhoto(event: 'input' | 'change') {
  const input = screen.getByLabelText('Select photos to upload');
  let files = [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })];
  Object.defineProperty(input, 'files', { configurable: true, get: () => files });
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => '',
    set: () => { files = []; },
  });
  fireEvent[event](input);
}

describe('native photo selection events', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['input', 'change'] as const)('uses current album settings for a native %s event', async (event) => {
    const oldComplete = vi.fn();
    const newComplete = vi.fn();
    const { rerender } = render(<FileUploader slug="old-album" onBatchComplete={oldComplete} />);
    rerender(<FileUploader slug="new-album" accessCode="new-code" onBatchComplete={newComplete} />);

    selectPhoto(event);

    await waitFor(() => expect(newComplete).toHaveBeenCalledWith({ succeeded: 1, failed: 0 }));
    expect(api.requestUpload).toHaveBeenCalledExactlyOnceWith('new-album', expect.objectContaining({
      filename: 'photo.jpg', access_code: 'new-code',
    }));
    expect(oldComplete).not.toHaveBeenCalled();
  });
});
