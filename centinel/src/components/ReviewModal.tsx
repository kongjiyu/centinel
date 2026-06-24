import { Modal } from './Modal';
import { StaticReviewForm } from './StaticReviewForm';

type Props = {
  projectId: string;
  onSubmit: (data: { name: string; instructions: string }) => Promise<void>;
  onClose: () => void;
};

export function ReviewModal({ projectId, onSubmit, onClose }: Props) {
  return (
    <Modal isOpen={true} onClose={onClose} title="New Static Review" width={520}>
      <StaticReviewForm
        projectId={projectId}
        onSubmit={onSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
