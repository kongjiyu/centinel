import { Modal } from './Modal';
import { StaticReviewForm } from './StaticReviewForm';
import type { Artifact, ReviewType } from '../types';

type Props = {
  projectId: string;
  artifacts: Artifact[];
  onSubmit: (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => Promise<void>;
  onClose: () => void;
};

export function ReviewModal({ projectId, artifacts, onSubmit, onClose }: Props) {
  return (
    <Modal isOpen={true} onClose={onClose} title="New Static Review" width={520}>
      <StaticReviewForm
        projectId={projectId}
        artifacts={artifacts}
        onSubmit={onSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
