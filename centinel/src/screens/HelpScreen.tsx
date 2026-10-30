import { CircleHelp } from 'lucide-react';
import { CommandPageHeader } from '../components/CommandUI';
import './HelpScreen.css';

export function HelpScreen() {
  return (
    <div className="screen command-help-screen">
      <CommandPageHeader eyebrow="Support" title="Help" />
      <div className="help-sections">
        <section className="help-section" aria-labelledby="help-start-heading">
          <h2 id="help-start-heading">Start a Review</h2>
          <ol>
            <li>Enter a name, choose a project and state what the Review should verify.</li>
            <li>Choose repositories and supporting documents, requirements or standards. New Reviews start with the first repository and eligible attached materials selected.</li>
            <li>A retry keeps the saved Review selection. Change it only when you intend to review a different scope.</li>
          </ol>
          <p>Entry selects project sources; it does not browse or inspect repository files.</p>
        </section>

        <section className="help-section" aria-labelledby="help-activity-heading">
          <h2 id="help-activity-heading">Follow Activity</h2>
          <ol>
            <li>Read the current task and completed stages to see what has produced evidence.</li>
            <li>Check elapsed time, interruptions and the action Activity offers when work is waiting, stopped or held.</li>
            <li>Opening Help does not pause, resume or retry work. Waiting does not clear a hold.</li>
          </ol>
        </section>

        <section className="help-section" aria-labelledby="help-result-heading">
          <h2 id="help-result-heading">Read the result</h2>
          <ol>
            <li>Start with the handover recommendation and its reasons.</li>
            <li>Review actions in this order: confirmed blockers, remaining risks, then evidence gaps. A verified unresolved Critical or High finding blocks readiness for handover.</li>
            <li>Check feature and requirement coverage for unknown or incomplete areas. The recommendation does not replace a person's approval.</li>
          </ol>
        </section>

        <section className="help-section" aria-labelledby="help-evidence-heading">
          <h2 id="help-evidence-heading">Inspect evidence</h2>
          <ol>
            <li>Open Findings to read an issue and its evidence; Back returns to the findings list.</li>
            <li>Use Traceability to review recorded requirement coverage. It does not establish that every product behavior was checked.</li>
            <li>Open reviewed sources when needed to browse the saved versions. Included sources are not necessarily fully assessed.</li>
          </ol>
        </section>

        <section className="help-section" aria-labelledby="help-sync-heading">
          <h2 id="help-sync-heading">Update project sources</h2>
          <ol>
            <li>Connected sources are checked about once a minute while Centinel is running. A check may find no change or need more time to import.</li>
            <li>Use Sync on a connected-source row for an incremental check. Imported local repositories are checked while Centinel is running; individual local file uploads still need reimport after changes.</li>
            <li>Source updates and model-backed indexing or assessment are separate. A successful sync does not mean Review work has resumed or completed.</li>
          </ol>
        </section>
      </div>
      <p className="help-note"><CircleHelp size={15} aria-hidden="true" /> Review results describe saved evidence and its limits; they do not certify all runtime behavior.</p>
    </div>
  );
}
