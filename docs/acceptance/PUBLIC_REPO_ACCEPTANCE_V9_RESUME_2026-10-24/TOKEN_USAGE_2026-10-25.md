# Recorded Review token usage

Safe terminal `model_attempt` token fields from the saved production harness, summed on 25 October 2026. These figures cover only the named Review execution, not Readiness, earlier attempts, this coding conversation, or independent adjudication agents. Provider/model: `codex/gpt-5.6-sol`.

| Review | Requests recorded | Input tokens | Output tokens | Input + output |
| --- | ---: | ---: | ---: | ---: |
| Axios `4cf606de-7bc7-482d-aee2-8df0f3cbdb97` | 20 successful | 873,802 | 99,619 | 973,421 |
| Docusaurus `2bae2cf4-a5d0-4705-9eb3-77d893dac421` | 25 successful + 3 malformed responses | 1,216,774 | 148,234 | 1,365,008 |
| Immutable.js paused parent `5f360a4f-6567-4f24-b7a0-9bff2dc44746` | 4 successful + 1 capacity failure | 160,503 | 20,463 | 180,966 |

Evidence: `run-2026-10-24T15-46-37-089Z/0055-review-harness.json`, `0092-review-harness.json`, and `0107-review-harness.json` under the ignored public-repository evaluation root. Missing token fields on a failed request contribute zero to this recorded sum; this is not proof that a provider billed zero. Harness attempt metadata does not provide a separate cache breakdown. Cached tokens must not be added to input a second time.

The [official OpenAI pricing documentation](https://learn.chatgpt.com/docs/pricing), retrieved on 25 October 2026, does not establish a fixed token-to-five-hour-percentage conversion. Included subscription usage depends on model, context, reasoning, tools and caching; the credit rate card alone does not determine it. Local Reviews outside GitHub count toward general usage. Use the account usage dashboard for the actual allowance and reset time. Concurrent chats and adjudication share capacity, so an unisolated before/after account percentage cannot be attributed solely to one Centinel Review.

## Efficiency follow-up

Saved progress summaries for this run report zero cache-read tokens. The current generation request places its varying feature map before frozen content, and `schemaForAssessmentMap` varies the structured-output feature-ID enum by batch. These are possible obstacles to prefix reuse, not a verified diagnosis of Codex cache behavior. [OpenAI's prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) explains that shared rendered prefixes matter and output-format schemas affect them. Reordering source text alone may therefore be insufficient. Do not weaken bounded identifier/evidence validation to claim savings; investigate this separately with actual cache/latency measurements and semantic regressions. No cache optimization, new API option or provider/model change was applied to the baseline.
