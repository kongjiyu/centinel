import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DynamicEvidence } from '../types';
import { EvidenceScreenshotThumbnail, EvidenceScreenshotViewer } from './EvidenceScreenshot';

const screenshots: DynamicEvidence[] = [
  {
    id: 'shot-1',
    type: 'screenshot',
    filePath: 'C:\\evidence\\home.png',
    summary: 'Home page loaded',
    createdAt: '2026-09-04T01:00:00.000Z',
  },
  {
    id: 'shot-2',
    type: 'screenshot',
    filePath: 'C:\\evidence\\checkout.png',
    summary: 'Checkout page',
    createdAt: '2026-09-04T01:01:00.000Z',
  },
];

function ViewerHarness() {
  const [selected, setSelected] = useState(screenshots[0]);
  return (
    <EvidenceScreenshotViewer
      screenshots={screenshots}
      selectedId={selected.id}
      onSelect={setSelected}
      onClose={vi.fn()}
    />
  );
}

describe('Evidence screenshots', () => {
  it('navigates screenshots with buttons and arrow keys', () => {
    render(<ViewerHarness />);

    expect(screen.getByText('Screenshot 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Checkout page' })).toBeInTheDocument();
    expect(screen.getByText('Screenshot 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('dialog', { name: 'Home page loaded' })).toBeInTheDocument();
  });

  it('shows a recoverable error when the full screenshot cannot load', () => {
    render(<ViewerHarness />);

    fireEvent.error(screen.getByRole('img', { name: 'Home page loaded' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Screenshot could not be loaded.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('img', { name: 'Home page loaded' })).toHaveAttribute('src', expect.stringContaining('retry=1'));
  });

  it('keeps a failed thumbnail operable and identifies the missing image', () => {
    const onOpen = vi.fn();
    render(
      <EvidenceScreenshotThumbnail
        item={screenshots[0]}
        onOpen={onOpen}
        className="evidence-screenshot"
      />,
    );

    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('Screenshot unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open screenshot: Home page loaded' }));
    expect(onOpen).toHaveBeenCalledWith(screenshots[0]);
  });
});
