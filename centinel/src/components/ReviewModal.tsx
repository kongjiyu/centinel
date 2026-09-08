import { Modal } from './Modal';
import { StaticReviewForm, type StaticReviewFormData } from './StaticReviewForm';

type Props = {
  projectId: string;
  onSubmit: (data: StaticReviewFormData) => Promise<void>;
  onClose: () => void;
  staleSourceCount?: number;
};

export function ReviewModal({ projectId, onSubmit, onClose, staleSourceCount }: Props) {
  return (
    <Modal isOpen={true} onClose={onClose} title="New review" width={520}>
      <StaticReviewForm
        projectId={projectId}
        onSubmit={onSubmit}
        onCancel={onClose}
        staleSourceCount={staleSourceCount}
      />
    </Modal>
  );
}
