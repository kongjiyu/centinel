import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DynamicTestForm } from './DynamicTestForm';

describe('DynamicTestForm', () => {
  it('leaves the modal shell responsible for title and dismissal', () => {
    render(<DynamicTestForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: 'New test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close test form' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('retains values after a request failure and shows a submission state while waiting', async () => {
    const user = userEvent.setup();
    let resolveSubmit: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>(resolve => { resolveSubmit = resolve; }));

    render(<DynamicTestForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Website address'), 'https://example.com');
    await user.type(screen.getByLabelText('Test goal'), 'Verify the home page loads');
    await user.click(screen.getByRole('button', { name: 'Run test' }));

    const submitButton = await screen.findByRole('button', { name: 'Starting…' });
    expect(submitButton).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledWith({
      targetUrl: 'https://example.com',
      goal: 'Verify the home page loads',
      missionType: 'user_journey',
      maxSteps: 15,
    });

    resolveSubmit();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run test' })).toBeEnabled());
    expect(screen.getByLabelText('Website address')).toHaveValue('https://example.com');
    expect(screen.getByLabelText('Test goal')).toHaveValue('Verify the home page loads');
  });

  it('keeps entered values and exposes the error when the request fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Dynamic service unavailable'));

    render(<DynamicTestForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Website address'), 'https://example.com');
    await user.type(screen.getByLabelText('Test goal'), 'Verify the home page loads');
    await user.click(screen.getByRole('button', { name: 'Run test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Dynamic service unavailable');
    expect(screen.getByLabelText('Website address')).toHaveValue('https://example.com');
    expect(screen.getByLabelText('Test goal')).toHaveValue('Verify the home page loads');
  });
});
