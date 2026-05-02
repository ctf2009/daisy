type Props = {
  mode: 'select' | 'done';
  onClick: () => void;
};

function SelectIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5v7M4.5 8h7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8.2l2 2.1 4-4.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ModeToggleButton({ mode, onClick }: Props) {
  const label = mode === 'select' ? 'Select' : 'Done';

  return (
    <button className="btn btn-linkish" onClick={onClick}>
      <span className="btn-linkish-icon">
        {mode === 'select' ? <SelectIcon /> : <DoneIcon />}
      </span>
      {label}
    </button>
  );
}
