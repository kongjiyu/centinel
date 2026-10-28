# Recorded Review tokens and file reads — 25 October 2026

Fresh authenticated all-scope usage reads reconcile exactly with saved harness attempt counts and input/output totals. No new assessments or provider calls were made to prepare this report.

| Review execution | Status | Unique files read (JS/TS) | Calls | Input | Output | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Axios | pending_approval | 52 (48) | 20 | 873,802 | 99,619 | 973,421 |
| Docusaurus | pending_approval | 29 (23) | 28 | 1,216,774 | 148,234 | 1,365,008 |
| Immutable.js — earlier paused attempt | blocked | 80 (75) | 5 | 160,503 | 20,463 | 180,966 |
| Immutable.js — current paused retry | blocked | 80 (75) | 57 | 2,243,365 | 276,302 | 2,519,667 |

All read counts require a matched read-start/read-completion event, a known artifact ID, and `hashChecked:true`. Each file was read once per execution and reused from the frozen read pool.

## Recorded pipeline stage totals

| Review execution | Read/freeze | Index/retrieve | Static rules | First-pass AI | Additional repair AI | Final persistence/correlation |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Axios | 0 | 0 | 0 | 973,421 | 0 | 0 |
| Docusaurus | 0 | 0 | 0 | 1,210,143 | 154,865 | 0 |
| Immutable.js — earlier paused attempt | 0 | 0 | 0 | 180,966 | 0 | Not reached |
| Immutable.js — current paused retry | 0 | 0 | 0 | 2,471,495 | 48,172 | Not reached |

First-pass and repair calls are subdivisions of the persisted `model_analysis` stage. They are calculated from attempt numbers, not separate domain estimates. Initial totals include responses that later failed validation. Separately, validation-rejected response tokens were Axios: 0; Docusaurus: 155,796; Immutable.js — earlier paused attempt: 0; Immutable.js — current paused retry: 47,878. Do not add those rejected-response totals again: they are already included above.

## Limits

- Recorded input plus output, not an independent billing invoice. Quota-failed calls without usage are unknown, not proven free.
- Readiness, older runs not listed here, coding-chat and adjudication-agent consumption are excluded.
- First-pass calls include failed validation responses. Repair is additional attempt>1 usage; failed-response waste is reported separately.
- Four domains share requests; no exact security/business/technical/personnel token allocation exists.
- Files read are unique hash-checked frozen reads. Reuse across batches increases prompt tokens without another physical read.
- All-scope ledger totals and record counts exactly reconcile with the model_analysis attempt events; no separate embedding/indexing usage is recorded.
- Final persistence/correlation was not reached on the two paused Immutable.js executions; partial retention is separate.

## Axios: batch details

Review ID: `4cf606de-7bc7-482d-aee2-8df0f3cbdb97`. Built 20 source packets with 142 total file inclusions across those packets. Repeated inclusions are not additional unique reads. Counts omit repeated packet exposure from repair calls.

| Batch ID | Features | Files in packet | Calls | Input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `bf46d6f06cc09aca` | 8 | 6 | 1 | 49,766 | 5,520 | 55,286 |
| `0167b9478fa32990` | 8 | 6 | 1 | 45,881 | 4,776 | 50,657 |
| `132c51f937e4bfd5` | 8 | 8 | 1 | 45,246 | 5,887 | 51,133 |
| `3552197e13c36726` | 8 | 7 | 1 | 44,610 | 5,368 | 49,978 |
| `213ae2e447d8dd3b` | 8 | 6 | 1 | 41,117 | 6,068 | 47,185 |
| `845cdee6723382eb` | 8 | 7 | 1 | 43,830 | 4,647 | 48,477 |
| `6cad9a9320933689` | 8 | 8 | 1 | 42,855 | 5,107 | 47,962 |
| `6d532e3ab2775d09` | 8 | 7 | 1 | 41,044 | 5,272 | 46,316 |
| `7472913d3de1c3cf` | 8 | 10 | 1 | 43,987 | 5,526 | 49,513 |
| `0ea12672958cd46a` | 8 | 9 | 1 | 44,091 | 5,580 | 49,671 |
| `3cce75b55dd9398b` | 8 | 9 | 1 | 43,190 | 5,232 | 48,422 |
| `3fe74c88e2d2cda5` | 8 | 9 | 1 | 45,462 | 5,767 | 51,229 |
| `0c719c9ceff88a7e` | 8 | 10 | 1 | 38,364 | 5,144 | 43,508 |
| `7f5bdf9f9978a8cd` | 8 | 6 | 1 | 44,056 | 4,806 | 48,862 |
| `3071e01618ca3649` | 8 | 5 | 1 | 43,604 | 4,966 | 48,570 |
| `271710fa0e739535` | 8 | 5 | 1 | 45,418 | 4,397 | 49,815 |
| `ce018be9b36fc303` | 8 | 5 | 1 | 45,782 | 5,963 | 51,745 |
| `d2c786b1f4e32f50` | 8 | 5 | 1 | 45,623 | 5,460 | 51,083 |
| `566df0194a898a7a` | 3 | 5 | 1 | 39,973 | 2,608 | 42,581 |
| `b7ac52619a466b9c` | 0 | 9 | 1 | 39,903 | 1,525 | 41,428 |

Evidence: `0055-review-harness.json` (SHA-256 `db33d6100f306d7129a1f8c8d118d5cfb8f874ae4edfa2ac87aa3ed43df68dc6`); `0171-review-usage-all-scopes.json` (SHA-256 `326488c568f6b5278eb49ea73a10a6cb3f69a77406c69e04505d99b410bbbfd2`).

## Docusaurus: batch details

Review ID: `2bae2cf4-a5d0-4705-9eb3-77d893dac421`. Built 25 source packets with 218 total file inclusions across those packets. Repeated inclusions are not additional unique reads. Counts omit repeated packet exposure from repair calls.

| Batch ID | Features | Files in packet | Calls | Input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `107d3ed26f096dc7` | 8 | 8 | 1 | 38,524 | 4,745 | 43,269 |
| `7669950551b716d2` | 8 | 8 | 1 | 36,622 | 5,605 | 42,227 |
| `e5f6566cf87ff475` | 8 | 8 | 2 | 88,109 | 13,039 | 101,148 |
| `ca268af39132b845` | 8 | 9 | 1 | 42,577 | 5,616 | 48,193 |
| `4f532a48bcb9f689` | 8 | 9 | 1 | 40,558 | 5,155 | 45,713 |
| `91846b671217f6a8` | 8 | 8 | 1 | 38,472 | 4,631 | 43,103 |
| `42f274a90f2a17bd` | 8 | 7 | 1 | 35,665 | 5,245 | 40,910 |
| `7142ad7deadec6a1` | 8 | 11 | 1 | 50,050 | 6,523 | 56,573 |
| `8a3d3dcf4c6b90c2` | 8 | 9 | 2 | 95,902 | 10,974 | 106,876 |
| `0db222b88790a132` | 8 | 8 | 1 | 43,555 | 5,394 | 48,949 |
| `4ae3ecb9253f66cf` | 8 | 9 | 1 | 47,731 | 6,038 | 53,769 |
| `5e0b264d619df4b2` | 8 | 11 | 1 | 52,565 | 5,405 | 57,970 |
| `26254f4df323ac72` | 8 | 9 | 1 | 42,545 | 5,474 | 48,019 |
| `3ec685968e2fd2ff` | 8 | 12 | 1 | 45,394 | 5,392 | 50,786 |
| `53c193d6fc8a0c69` | 8 | 10 | 1 | 41,935 | 5,443 | 47,378 |
| `a71a9cfbd6165a5a` | 8 | 10 | 2 | 92,048 | 10,589 | 102,637 |
| `7311ace10500f479` | 8 | 8 | 1 | 46,799 | 4,947 | 51,746 |
| `a8c14d9af9f1b958` | 8 | 7 | 1 | 46,519 | 5,210 | 51,729 |
| `432c92cde7772984` | 8 | 7 | 1 | 43,357 | 5,148 | 48,505 |
| `7113c2680571e48d` | 8 | 8 | 1 | 41,796 | 5,392 | 47,188 |
| `71d0717843a9f8e9` | 8 | 11 | 1 | 40,612 | 5,105 | 45,717 |
| `6671eabcce0cb1c5` | 8 | 8 | 1 | 43,306 | 5,481 | 48,787 |
| `ed1cf2e5f110d078` | 8 | 7 | 1 | 42,992 | 5,246 | 48,238 |
| `14b17db63682d924` | 8 | 8 | 1 | 43,177 | 5,687 | 48,864 |
| `c9acac1a2794d784` | 0 | 8 | 1 | 35,964 | 750 | 36,714 |

Evidence: `0092-review-harness.json` (SHA-256 `72fcd7a226f868867ab08630d2d294430452b3d16f4a7e818c61a4c03eb71cb4`); `0172-review-usage-all-scopes.json` (SHA-256 `1c85a6fa85338b2970c23f386b11bcf5ef26439b1f6dd5ace8fec9983ff0716c`).

## Immutable.js — earlier paused attempt: batch details

Review ID: `5f360a4f-6567-4f24-b7a0-9bff2dc44746`. Built 5 source packets with 41 total file inclusions across those packets. Repeated inclusions are not additional unique reads. Counts omit repeated packet exposure from repair calls.

| Batch ID | Features | Files in packet | Calls | Input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `382d38e68346ea10` | 8 | 7 | 1 | 39,712 | 4,299 | 44,011 |
| `506775caecfeeac4` | 8 | 11 | 1 | 43,840 | 5,374 | 49,214 |
| `68c81ef2e7892bcb` | 8 | 7 | 1 | 38,391 | 6,321 | 44,712 |
| `d670368211a23c85` | 8 | 10 | 1 | 38,560 | 4,469 | 43,029 |
| `2d0b0003f8e5c7a1` | 8 | 6 | 1 | 0 | 0 | 0 |

Evidence: `0107-review-harness.json` (SHA-256 `681579420eeaf32875d918d3930367c0f7d7b9dedb37ec3d2574ae657d5818c9`); `0173-review-usage-all-scopes.json` (SHA-256 `648272f4cf3ab592909a38631e284570a666897585a57ca22613cfbca12100ee`).

## Immutable.js — current paused retry: batch details

Review ID: `5256d998-0636-4ecd-a599-127d63ebb2c7`. Built 56 source packets with 456 total file inclusions across those packets. Repeated inclusions are not additional unique reads. Counts omit repeated packet exposure from repair calls.

| Batch ID | Features | Files in packet | Calls | Input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `382d38e68346ea10` | 8 | 7 | 1 | 39,712 | 4,838 | 44,550 |
| `506775caecfeeac4` | 8 | 11 | 1 | 43,840 | 5,239 | 49,079 |
| `68c81ef2e7892bcb` | 8 | 7 | 1 | 38,391 | 5,960 | 44,351 |
| `d670368211a23c85` | 8 | 10 | 1 | 38,560 | 5,000 | 43,560 |
| `2d0b0003f8e5c7a1` | 8 | 6 | 2 | 84,632 | 11,418 | 96,050 |
| `5358765f70c6dd37` | 8 | 9 | 1 | 40,450 | 4,915 | 45,365 |
| `b2af8c1dae7a9be4` | 8 | 7 | 1 | 45,064 | 4,475 | 49,539 |
| `22bef61a6f2f08c3` | 8 | 6 | 1 | 40,361 | 4,999 | 45,360 |
| `8ebd81a22f9ad81e` | 8 | 7 | 1 | 43,647 | 4,664 | 48,311 |
| `b58103ac4322c316` | 8 | 7 | 1 | 42,728 | 5,478 | 48,206 |
| `960d4950e0574834` | 8 | 6 | 1 | 39,929 | 4,416 | 44,345 |
| `ff39693fff4eb2b4` | 8 | 6 | 1 | 41,798 | 5,072 | 46,870 |
| `262cc39a93c8894c` | 8 | 7 | 1 | 43,018 | 4,464 | 47,482 |
| `ad2597144a5090b1` | 8 | 7 | 1 | 42,214 | 4,526 | 46,740 |
| `0ed4deb9b1ffe8b7` | 8 | 6 | 1 | 36,196 | 4,560 | 40,756 |
| `d73818395dd0e93d` | 8 | 6 | 1 | 36,263 | 4,475 | 40,738 |
| `895a75dff14d6385` | 8 | 7 | 1 | 36,485 | 4,621 | 41,106 |
| `5f4b4ec7973ce463` | 8 | 7 | 1 | 39,482 | 5,188 | 44,670 |
| `9625bca9d617eab4` | 8 | 6 | 1 | 36,135 | 4,487 | 40,622 |
| `90e0eff42fa5e255` | 8 | 7 | 1 | 41,979 | 5,168 | 47,147 |
| `45d35b21bce58c77` | 8 | 7 | 1 | 37,191 | 4,689 | 41,880 |
| `9974ea115b19d30d` | 8 | 6 | 1 | 34,717 | 4,765 | 39,482 |
| `1c04f2cbd9046c88` | 8 | 14 | 1 | 43,371 | 5,258 | 48,629 |
| `ad73591829080295` | 8 | 14 | 1 | 36,454 | 4,981 | 41,435 |
| `a2de32a83c5408c6` | 8 | 14 | 1 | 38,476 | 5,359 | 43,835 |
| `0a48fe20bba1adb5` | 8 | 12 | 1 | 40,606 | 5,622 | 46,228 |
| `d80330a451014674` | 8 | 13 | 1 | 44,296 | 5,528 | 49,824 |
| `6147c962c30e37ba` | 8 | 14 | 1 | 36,460 | 4,381 | 40,841 |
| `162e22132655383f` | 8 | 14 | 1 | 37,529 | 4,547 | 42,076 |
| `256dd62cb4b2b2a5` | 8 | 11 | 1 | 40,430 | 5,251 | 45,681 |
| `0e085fcab371d7f3` | 8 | 11 | 1 | 39,047 | 5,181 | 44,228 |
| `596468b0c7a7b0b3` | 8 | 6 | 1 | 33,857 | 4,510 | 38,367 |
| `633f90f95cc5d383` | 8 | 7 | 1 | 38,945 | 4,765 | 43,710 |
| `3b690d1e91be212a` | 8 | 6 | 1 | 44,675 | 4,582 | 49,257 |
| `2b611495aded978b` | 8 | 6 | 1 | 42,469 | 5,337 | 47,806 |
| `617293741384cba7` | 8 | 6 | 1 | 41,967 | 5,316 | 47,283 |
| `1513f6e0198975de` | 8 | 7 | 1 | 40,278 | 4,510 | 44,788 |
| `e95755d76ee14c8b` | 8 | 11 | 1 | 36,028 | 4,757 | 40,785 |
| `027df81c015a30ce` | 8 | 10 | 1 | 34,374 | 4,786 | 39,160 |
| `0484c2c10eb42795` | 8 | 11 | 1 | 41,778 | 5,282 | 47,060 |
| `30a24b02a5bd4671` | 8 | 6 | 1 | 40,590 | 4,547 | 45,137 |
| `d03621546ad65828` | 8 | 6 | 1 | 40,144 | 4,435 | 44,579 |
| `4513967823ce6334` | 8 | 6 | 1 | 39,934 | 4,933 | 44,867 |
| `34eab9042642bd89` | 8 | 6 | 1 | 44,589 | 5,536 | 50,125 |
| `acfc3e7751e40b1c` | 8 | 6 | 1 | 46,433 | 5,161 | 51,594 |
| `16fadb6923d9b1a9` | 8 | 6 | 1 | 40,985 | 5,198 | 46,183 |
| `e34750c975afaef5` | 8 | 6 | 1 | 45,014 | 4,984 | 49,998 |
| `b235d7e0ff6ca435` | 8 | 6 | 1 | 43,475 | 4,948 | 48,423 |
| `195a88fc83e9bc83` | 8 | 6 | 1 | 41,507 | 5,609 | 47,116 |
| `79680c026de65a8f` | 8 | 7 | 1 | 42,842 | 4,529 | 47,371 |
| `11ca6179aa7ec250` | 8 | 7 | 1 | 35,260 | 4,521 | 39,781 |
| `c74b95e0a260c801` | 8 | 13 | 1 | 33,204 | 4,572 | 37,776 |
| `0b3b7be1700f6217` | 8 | 13 | 1 | 35,304 | 4,588 | 39,892 |
| `ceb006c11a2ea563` | 8 | 8 | 1 | 43,354 | 4,803 | 48,157 |
| `1822a74126f8423c` | 8 | 6 | 1 | 36,898 | 4,568 | 41,466 |
| `0aaa1980df20ce09` | 8 | 6 | 1 | 0 | 0 | 0 |

Evidence: `0169-review-harness.json` (SHA-256 `6003c4c1bca83ae981886258513652b57b5aadf74ed4077bf3f8ce7a56fb9bee`); `0174-review-usage-all-scopes.json` (SHA-256 `00bfe1bd4c001b9b6e5d449ca48e30768374546b99a1197ddff71942efdc24d6`).

