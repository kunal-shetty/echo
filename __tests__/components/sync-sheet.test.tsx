import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncSheet } from '@/components/profile/sync-sheet';

vi.mock('@/lib/use-remote-user', () => ({
  useRemoteUser: vi.fn(() => ({
    user: null,
    refresh: vi.fn(),
  })),
}));

// Mock BottomSheet to just render children
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ children, open }: any) => open ? <div>{children}</div> : null,
}));

// Mock Field to just render an input
vi.mock('@/components/ui/field', () => ({
  Field: ({ label, onChange, value, placeholder }: any) => {
    const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          data-testid="field-input"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      </div>
    );
  },
}));

describe('SyncSheet', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders the email step initially', () => {
    render(<SyncSheet open={true} onClose={mockOnClose} />);
    expect(screen.getByText(/Enter your email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
  });

  it('transitions to code step on successful start', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sent: true }),
    });

    render(<SyncSheet open={true} onClose={mockOnClose} />);

    const input = screen.getByTestId('field-input');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const button = screen.getByText(/Send code/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/We sent a 6-digit code/i)).toBeInTheDocument();
    });
  });

  it('shows error on failed start', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid email' }),
    });

    render(<SyncSheet open={true} onClose={mockOnClose} />);

    const input = screen.getByTestId('field-input');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const button = screen.getByText(/Send code/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Invalid email')).toBeInTheDocument();
    });
  });

  it('transitions to done step on successful verification', async () => {
    // First mock start to get to code step
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sent: true }),
    });
    // Then mock verify
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true, migrated: false }),
    });

    render(<SyncSheet open={true} onClose={mockOnClose} />);

    // Start flow
    const emailInput = screen.getByTestId('field-input');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText(/Send code/i));

    // Verification flow
    await waitFor(() => {
      const codeInput = screen.getByTestId('field-input');
      fireEvent.change(codeInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByText(/Verify/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });
  });

  it('shows migration message when migrated is true', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sent: true }),
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true, migrated: true }),
    });

    render(<SyncSheet open={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId('field-input');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText(/Send code/i));

    await waitFor(() => {
      const codeInput = screen.getByTestId('field-input');
      fireEvent.change(codeInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByText(/Verify/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/merged data from another device/i)).toBeInTheDocument();
    });
  });
});
