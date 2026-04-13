import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

type Props = {
  url: string;
  size?: number;
  albumName?: string;
};

function downloadAsPng(svgElement: SVGSVGElement, size: number, filename: string) {
  const canvas = document.createElement('canvas');
  const scale = 4; // High-res for print
  canvas.width = size * scale;
  canvas.height = size * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.src = url;
}

export function QRCode({ url, size = 200, albumName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    const safeName = albumName?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'daisy';
    downloadAsPng(svg, size, `${safeName}_qr-code.png`);
  };

  return (
    <div className="qr-code" ref={containerRef}>
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        bgColor="transparent"
        fgColor="currentColor"
      />
      <p className="qr-url">{url}</p>
      <button className="btn btn-secondary qr-download" onClick={handleDownload}>
        Download QR Code
      </button>
    </div>
  );
}
