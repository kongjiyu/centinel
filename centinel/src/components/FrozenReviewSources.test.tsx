import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ReviewSourceManifest } from '../types';
import { FrozenReviewSources } from './FrozenReviewSources';

const sourceApi = vi.hoisted(() => ({ getReviewArtifactContent: vi.fn() }));
vi.mock('../api/client', () => ({ api: sourceApi }));

const manifest: ReviewSourceManifest = {
  projectId: 'project-1', sessionId: 'review-1', status: 'available', artifactCount: 1,
  sources: [],
  artifacts: [{ id: 'artifact-frozen', fileName: 'checkout.ts', filePath: 'src/checkout.ts', artifactVersionId: 'version-1', contentHash: 'sha256:abc123' }],
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:frozen-review-preview');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(api.getReviewArtifactContent).mockResolvedValue({
    versionId: 'version-1', content: btoa('const checkout = true;'), contentHash: 'abc123', mimeType: 'text/typescript',
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('FrozenReviewSources', () => {
  it('lists only the Review manifest and loads the exact saved version on request', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Sources used' })).toBeInTheDocument();
    expect(screen.getByText('1 reviewed artifact')).toBeInTheDocument();
    expect(screen.getByText('src/checkout.ts')).toBeInTheDocument();
    expect(screen.getByText('version-1')).toBeInTheDocument();
    expect(screen.queryByText('current/checkout.ts')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Preview saved version' }));

    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('project-1', 'review-1', 'artifact-frozen');
    expect(await screen.findByText('const checkout = true;')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download saved version' })).toHaveAttribute('download', 'checkout.ts');
  });

  it('does not read content when a frozen version id is missing', () => {
    renderPanel({
      ...manifest,
      artifacts: [{ ...manifest.artifacts![0], artifactVersionId: null }],
    });

    expect(screen.getByText('The exact saved version is unavailable for preview.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Preview saved version/ })).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).not.toHaveBeenCalled();
  });

  it('rejects a version or hash mismatch without showing returned content', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValueOnce({
      versionId: 'version-current', content: btoa('current project content'), contentHash: 'different', mimeType: 'text/typescript',
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Preview saved version' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable or could not be verified');
    expect(screen.queryByText('current project content')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('ignores a late saved-version response after navigating to another Review with the same artifact id', async () => {
    const user = userEvent.setup();
    let resolveContent!: (value: Awaited<ReturnType<typeof api.getReviewArtifactContent>>) => void;
    vi.mocked(api.getReviewArtifactContent).mockReturnValueOnce(new Promise(resolve => { resolveContent = resolve; }));
    const view = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Preview saved version' }));
    expect(screen.getByRole('button', { name: 'Loading saved version…' })).toBeDisabled();

    view.rerender(<FrozenReviewSources
      projectId="project-1"
      reviewId="review-2"
      manifest={{ ...manifest, sessionId: 'review-2', artifacts: [{ ...manifest.artifacts![0], artifactVersionId: 'version-2' }] }}
      readState="loaded"
      onRetryEvidence={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Preview saved version' })).toBeEnabled();
    expect(screen.queryByText('const checkout = true;')).not.toBeInTheDocument();

    await act(async () => resolveContent({
      versionId: 'version-1', content: btoa('old Review content'), contentHash: 'abc123', mimeType: 'text/typescript',
    }));
    expect(screen.queryByText('old Review content')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps legacy manifest limitations explicit and offers project-source navigation', () => {
    const onManageSources = vi.fn();
    renderPanel({ ...manifest, artifacts: undefined }, onManageSources);

    expect(screen.getByText(/predates per-artifact version details/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage project sources' }));
    expect(onManageSources).toHaveBeenCalledOnce();
  });
});

function renderPanel(value: ReviewSourceManifest | null = manifest, onManageSources?: () => void) {
  return render(<FrozenReviewSources
    projectId="project-1"
    reviewId="review-1"
    manifest={value}
    readState="loaded"
    onRetryEvidence={vi.fn()}
    onManageSources={onManageSources}
  />);
}
