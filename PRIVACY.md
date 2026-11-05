# Centinel privacy statement

This statement explains, in plain language, where Centinel keeps your data and what it sends to other services. It describes the desktop app as it is built today. If the code and this page ever disagree, the code is the source of truth and this page should be corrected.

## The short version

- Your projects, saved sources, findings and reports are stored in **your Centinel account**, which is hosted on Supabase.
- When a Review or browser test runs, Centinel sends **selected source excerpts, requirements and test context** to the **model provider you chose** (ChatGPT through Codex, or an OpenAI-compatible API key you entered).
- Some things **never leave your Mac**: the key that encrypts your saved credentials, local test data and recordings, and the app's log file.
- Centinel has **no telemetry, no analytics and no automatic crash reporting**. Diagnostics are only created when you click **Export diagnostics**, and you decide whether to share the file.

## What is stored in your Centinel account (Supabase)

Centinel signs you in with Supabase. Each request uses your own sign-in session, and database rules limit every record to the project's owner and the members they add. The desktop app never holds a Supabase administrator key.

Stored in the database:

- **Your profile and projects**: name, description, members and collaborator settings.
- **Sources and source snapshots**: the files you import or sync (local repositories, uploads, GitHub, Google Drive, Slack), each saved version, its content hash and the text chunks used for search.
- **Requirements and standards** you add or confirm, and how they map to sources.
- **Reviews**: what was selected, frozen copies of the context they used, progress, assessments, evidence excerpts, findings, decisions you record and their history.
- **Dynamic Testing**: saved tests, environments (website address and approved controls, never the local values of your variables), run records, checks, findings and report snapshots.
- **Reports** you export.
- **Model usage records**: provider, model, token counts, durations and short allowlisted outcome codes. They do not contain prompts or responses.
- **Model provider settings**: provider, model and endpoint. An API key you enter is **encrypted on your Mac** before it is saved, so the account only holds ciphertext.
- **Connected-source sign-ins** (GitHub, Google Drive, Slack): the access tokens are encrypted on your Mac the same way before they are saved.

Stored as files (private Supabase Storage buckets, readable only by project members):

- `project-artifacts`: original uploaded files, and search indexes of repository sources so other project members can reuse them.
- `review-evidence`: evidence attachments for Reviews and decisions.
- `dynamic-evidence`: screenshots and traces from browser tests, **only when you choose to share them** with the project.

## What is sent to your model provider

Centinel only contacts a model provider while work you started is running, and only the provider you configured in Settings.

- **Reviews** send selected source excerpts (with file names and line numbers), the confirmed requirements and standards in scope, and a description of what the Review should verify. They do not send whole repositories; each request contains the parts chosen for that step.
- **Requirement extraction and project readiness** send the text of the documents being assessed.
- **Browser tests** send the test goal and checks, the linked requirements, a description of the page (visible text and controls, with your private values and URL credentials removed) and, when the page cannot be understood from its structure alone, a screenshot.
- **Optional embeddings**: if you set up an embedding provider (for example Voyage), source text chunks are sent to it to build the search index.

The provider's own terms apply to what you send them. If you sign in with ChatGPT through Codex, requests go to OpenAI under your ChatGPT account. If you use an API key, requests go to the endpoint you entered.

To pause all model-backed assessment, set `CENTINEL_AI_ASSESSMENT_PAUSED=1` in Centinel's `.env` file and restart the app. Importing sources still works while paused.

## What stays on your Mac

The packaged app keeps its local files in `~/Library/Application Support/com.centinel.app/`:

- `.env`, which holds the **encryption key** created for this installation. Saved API keys and connected-source tokens can only be decrypted with this key. It is never uploaded. If you delete it, you will need to enter those credentials again.
- `data/`, which holds Dynamic Testing's local database, the **local values of your test variables** (encrypted), test upload and download files and recorded browser sessions.
- `evidence/`, which holds screenshots and traces recorded during browser tests. They stay here unless you share a copy with the project.
- `logs/sidecar.log`, the local service log. It is replaced each time the app starts.

Centinel also keeps a private Codex home for each signed-in account, which holds your **Codex (ChatGPT) sign-in**, and a cache of repository search indexes. Both are local files on this Mac. In the current packaged build they are stored with the app's own files rather than in the folder above, so removing the app also removes them.

Your sign-in session is kept in the app's local web storage. Local repositories you import are read from where they already are on disk; Centinel does not move them.

## No telemetry

Centinel does not include analytics, usage tracking or crash reporting, and it does not send any data to the Centinel developers. The only network traffic is to your Supabase account, the model and embedding providers you configured, the sources you connect (GitHub, Google Drive, Slack), the websites you test, and a one-time download of the Chromium browser for Dynamic Testing.

### Export diagnostics

If you need help, open **Help** and choose **Export diagnostics**. Centinel builds a ZIP file on your Mac and asks where to save it. Nothing is uploaded. The file contains:

- the last 2,000 lines (at most) of `logs/sidecar.log`, with bearer tokens, JWTs, API keys, passwords, `.env` values, e-mail addresses, URL credentials and query strings, and your home folder path removed;
- the app and service versions, macOS version and processor architecture;
- recent error codes with their HTTP status and route shape (project and record identifiers are removed).

It never contains prompts, source code, findings, reports, provider settings or credentials. You can open the ZIP and read every file before you share it.

## Deleting your data

- **A project**: open the project and delete it. This removes its records from your account and queues its stored files for deletion.
- **A source**: remove it from the project's Sources page. Reviews that already used it keep their frozen evidence until the project is deleted.
- **Dynamic Testing local data**: forget downloaded files and upload fixtures from the test panels, or delete the files under `data/` and `evidence/` while Centinel is closed.
- **Saved credentials**: clear the API key in Settings, disconnect a connected source, or sign out of Codex.
- **Everything on this Mac**: sign out of Codex in Settings, quit Centinel, then move `~/Library/Application Support/com.centinel.app/` and the Centinel app to the Trash.
- **Your account**: there is no in-app button to delete a Centinel account yet. Delete your projects first, then ask the person who runs your Centinel Supabase project to remove the account.

Data you sent to a model provider is handled under that provider's retention policy; Centinel cannot delete it for you.
