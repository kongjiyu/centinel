import { useId } from 'react';
import type { ConversationRequest } from '../../check/conversationTypes';

const recovery = {
  context_limit: ['Too much evidence for one response', 'ORIN could not fit all the selected evidence into one response.', 'Attach one or two relevant problems or files and send the request again.'],
  missing_reference: ['An attachment is unavailable', 'ORIN could not open one of the saved Checks or problems you attached.', 'Remove the unavailable attachment, select it again from the current project, and resend your message.'],
  browser_startup: ['The app could not start', 'Browser verification stopped before it could inspect the page.', 'Check that the selected project has a local app that starts. If a Browser attempt was saved, open it to see the startup details.'],
  assessment_hold: ['AI assessment is paused', 'ORIN paused the request before it could continue with AI assessment.', 'Resume AI assessment, then send a new message.'],
  provider_paused: ['The AI provider paused the request', 'The provider could not accept more work for this request.', 'Check your model provider’s availability and usage. Send a new message once the provider can accept requests.'],
  context: ['ORIN could not load the context', 'The response stopped while ORIN was reading the saved project evidence.', 'Check that the relevant files or Checks still open, then reattach the evidence and resend.'],
  planning: ['ORIN could not prepare a response', 'The request stopped before ORIN had a complete answer or plan.', 'Check your model provider in Settings, then resend your message.'],
  validation: ['ORIN could not verify its response', 'ORIN saved the validation stage for this response. The specific check that failed is unavailable.', 'For a Review, select Code and name the exact folder or attach the relevant source files. For an explanation, ask about one attached issue.'],
  execution: ['The Check could not finish', 'The request reached execution and stopped before it recorded a complete result.', 'Inspect any saved Check in this conversation before deciding whether to run it again. If there is no saved Check, resend with the exact scope.'],
  interrupted: ['The response was interrupted', 'The local service stopped before ORIN could finish this request.', 'Check for a saved result first. If the request still needs work, send a new message.'],
  unknown: ['ORIN could not finish the response', 'The request stopped before a complete response was saved.', 'Check any saved evidence in the conversation, then resend with the relevant scope or attachment.'],
} as const;

const validation: Record<NonNullable<ConversationRequest['validationReason']>, readonly [string, string, string]> = {
  response_format: ['ORIN received an incomplete response', 'The model returned an answer ORIN could not read as a complete plan or reply.', 'Resend your message. If this repeats, check the model selected in Settings.'],
  citation_missing: ['The answer was missing a source citation', 'The model’s response did not cite the saved evidence it received.', 'Resend with the most relevant saved issue, Check, or file attached.'],
  citation_unknown: ['The answer cited unavailable evidence', 'The model referred to a citation outside the evidence supplied for this turn.', 'Resend with the specific saved record or file you want ORIN to use.'],
  quote_unmatched: ['A quote did not match the saved evidence', 'ORIN could not match the model’s supporting quote to the source supplied for this turn.', 'Ask again about the specific finding or attach the relevant file.'],
  outcome_unverified: ['The proposed answer claimed an unverified outcome', 'The model described a result that would require saved Check evidence.', 'Attach the saved result to discuss it, or request a new verification Check.'],
  scope_unbound: ['The Review plan did not identify saved files', 'ORIN could not match the proposed scope to eligible repository files for this turn.', 'Select Code and name the exact repository folder or attach the files to review.'],
  mode_conflict: ['The proposed action conflicts with the selected mode', 'The model proposed a different kind of Check from the current mode.', 'Choose the mode that matches the Check you want, then send the request again.'],
  evidence_unavailable: ['The plan needs evidence ORIN could not open', 'Some of the saved evidence required for this Check was unavailable.', 'Reattach a readable Check or select the current files to verify.'],
  current_evidence_required: ['The plan needs a current source reference', 'Earlier chat gave ORIN context, but the plan did not cite evidence from this request.', 'Attach the relevant current files or saved Check, then resend the request.'],
  question_options: ['ORIN could not present its follow-up options', 'The model returned incomplete or incompatible choices for the question.', 'Resend your request, or include the option you want directly in your message.'],
};

export function conversationFailureDetails(request: ConversationRequest) {
  if (!['failed', 'paused', 'interrupted'].includes(request.state) && !request.answerUnavailable) return null;
  if (request.validationReason && validation[request.validationReason]) return validation[request.validationReason];
  // Recognize the former fixed service copy on older turns without showing raw errors.
  const legacyReason = request.error?.startsWith('An attached record is unavailable.') ? 'missing_reference'
    : request.error?.startsWith('The app could not start.') ? 'browser_startup'
    : request.error?.startsWith('AI assessment') ? 'assessment_hold'
    : request.error?.startsWith('The provider paused') ? 'provider_paused' : undefined;
  return recovery[request.failureReason ?? legacyReason ?? (request.state === 'interrupted' ? 'interrupted'
    : request.answerUnavailable ? 'validation' : request.failureStage ?? 'unknown')];
}

export function ConversationFailure({ request, onClose }: { request: ConversationRequest; onClose: () => void }) {
  const headingId = useId();
  const failure = conversationFailureDetails(request);
  if (!failure) return null;
  const [title, description, nextStep] = failure;
  return <section className="pc-card pc-chat-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="pc-card-title" aria-live="polite">{title}</h2>
      <div className="pc-markdown">
        <p>{description}</p>
        <p><strong>What to do next</strong></p>
        <p>{nextStep}</p>
      </div>
      <button type="button" className="ck-link pc-chat-card-toggle" onClick={onClose}>Dismiss error</button>
  </section>;
}
