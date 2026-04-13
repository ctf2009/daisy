import { useState } from 'react';

type Props = {
  onSubmit: (code: string) => void;
  error?: string;
};

export function CodeEntry({ onSubmit, error }: Props) {
  const [code, setCode] = useState('');

  return (
    <div className="code-entry">
      <h2>Enter access code</h2>
      <p>This album is protected. Enter the code to upload photos.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(code);
        }}
      >
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          autoFocus
          className="input"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Continue
        </button>
      </form>
    </div>
  );
}
