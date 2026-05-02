import logoSrc from '../assets/daisy-logo.webp';

type Props = {
  width?: number;
  className?: string;
};

export function Logo({ width = 300, className }: Props) {
  return (
    <img
      src={logoSrc}
      alt="Daisy"
      width={width}
      className={className}
    />
  );
}
