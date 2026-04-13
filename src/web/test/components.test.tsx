import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeEntry } from '../src/components/CodeEntry';
import { Logo } from '../src/components/Logo';

describe('CodeEntry', () => {
  it('renders the access code form', () => {
    render(<CodeEntry onSubmit={() => {}} />);
    expect(screen.getByText('Enter access code')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Access code')).toBeInTheDocument();
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('calls onSubmit with entered code', () => {
    let submitted = '';
    render(<CodeEntry onSubmit={(code) => { submitted = code; }} />);

    const input = screen.getByPlaceholderText('Access code');
    fireEvent.change(input, { target: { value: 'mycode' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(submitted).toBe('mycode');
  });

  it('displays error message', () => {
    render(<CodeEntry onSubmit={() => {}} error="Invalid access code" />);
    expect(screen.getByText('Invalid access code')).toBeInTheDocument();
  });
});

describe('Logo', () => {
  it('renders an image with correct alt text', () => {
    render(<Logo />);
    const img = screen.getByAltText('Daisy');
    expect(img).toBeInTheDocument();
  });

  it('applies custom width', () => {
    render(<Logo width={500} />);
    const img = screen.getByAltText('Daisy');
    expect(img).toHaveAttribute('width', '500');
  });

  it('applies custom className', () => {
    render(<Logo className="my-class" />);
    const img = screen.getByAltText('Daisy');
    expect(img).toHaveClass('my-class');
  });
});
