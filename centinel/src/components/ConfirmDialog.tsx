import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

type Props = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
};

/** Progress wording that matches the confirm action ("Deleting…", "Removing…"). */
function busyLabelFor(confirmLabel: string): string {
  const verb = confirmLabel.trim().split(/\s+/)[0]?.toLowerCase();
  if (verb === 'delete') return 'Deleting…';
  if (verb === 'remove') return 'Removing…';
  return 'Working…';
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
}: Props) {
  return (
    <Modal isOpen={isOpen} onClose={busy ? () => undefined : onClose} title={title} width={440}>
      <div className="confirm-dialog-content">
        <span className="confirm-dialog-icon" aria-hidden="true">
          <AlertTriangle size={20} />
        </span>
        <p>{description}</p>
      </div>
      <div className="form-actions confirm-dialog-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy} data-autofocus>
          Cancel
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => void onConfirm()}
          disabled={busy}
        >
          {busy ? busyLabelFor(confirmLabel) : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
