import type { ConversationRequest } from './types.js';

const reviewVerb = '(?:conduct|start|run|perform|proceed(?:\\s+with)?)';
const namedReview = new RegExp(`^(?:(?:please|can you|could you|would you)\\s+)*(?:${reviewVerb}\\s+(?:(?:a|the)\\s+)?(?:(?:code|static)\\s+)?review\\s+(?:on|of|for)\\s+|review\\s+)(?:the\\s+)?[\x60"']?([\\w./-]+)[\x60"']?(?:\\s+module)?[.!]?$`, 'i');
const unscopedReview = new RegExp(`^(?:(?:please|can you|could you|would you)\\s+)*${reviewVerb}\\s+(?:(?:a|the)\\s+)?(?:(?:code|static)\\s+)?review(?:\\s+check)?[.!]?$`, 'i');

export function namedReviewScope(text: string) {
  const match = namedReview.exec(text.trim());
  return match?.[1].toLowerCase().replace(/^\.\//, '').replace(/\/$/, '');
}

export function asksForUnscopedReview(text: string) {
  return unscopedReview.test(text.trim());
}

export function asksForProjectStatus(text: string) {
  return /^(?:where (?:are )?we(?: at)?(?: now)?|(?:(?:what(?:'s| is) (?:the |our )?|show me the )?(?:current |project )?)status(?: now)?)[?.!\s]*$/i.test(text.trim());
}

export function requestsFullCheck(text: string) {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:run|start|conduct)\s+(?:(?:a|the)\s+full\s+check|both(?:\s+checks)?|code\s+(?:and|\+)\s+browser(?:\s+checks?)?)[.!?]?$/i.test(text.trim());
}

export function asksForUnscopedBrowserCheck(text: string) {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:run|start|conduct)\s+(?:(?:a|the)\s+)?browser\s+(?:check|test)[.!?]?$/i.test(text.trim());
}

export function conversationApproval(text: string): 'any' | 'code' | null {
  const match = /^(?:please\s+)?(?:proceed|go ahead)(?:\s+(?:with|in)\s+(code)(?:\s+review)?(?:\s+only)?(?:\s+first)?)?[.!]?$/i.exec(text.trim());
  return match ? (match[1] ? 'code' : 'any') : null;
}
export function conversationQuestionOptions(request: Pick<ConversationRequest, 'action' | 'reply' | 'questionOptions' | 'reviewContinuation' | 'questions' | 'pendingQuestionId'>) {
  const pending = request.pendingQuestionId && request.questions?.find(question => question.id === request.pendingQuestionId && !question.answer);
  if (pending) return pending.options;
  if (request.reviewContinuation) return request.questionOptions ?? [];
  if (!request.reply) return [];
  if (request.action === 'clarify' && request.questionOptions?.length) return request.questionOptions;
  if (request.action !== 'clarify' && request.action !== 'explain') return [];
  const pair = /^Which\s+[^\n*]{1,400}:\s+\*\*([^\n*]{1,100})\*\*,?\s+or\s+\*\*([^\n*]{1,100})\*\*(?:\s+verification)?\?$/i.exec(request.reply.trim());
  return pair && pair[1] !== pair[2] ? [pair[1], pair[2]] : [];
}

export function isCodeReviewChoice(question: string | undefined, option: string | undefined) {
  return Boolean(question && option && /\b(?:verification|review|check mode)\b/i.test(question)
    && /^(?:run\s+)?(?:code(?:\s+review)?\s+only|code\s+review|code)$/i.test(option.trim()));
}
