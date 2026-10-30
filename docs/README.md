# Centinel documentation

Start with the product and design sources of truth, then open the module folder you are working in.

## Sources of truth

1. [`../DESIGN.md`](../DESIGN.md): all user-facing design decisions
2. [`Centinel_PRD_Revised.md`](Centinel_PRD_Revised.md): product scope and requirements
3. [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) and [`DEVELOPMENT_PROGRESS.md`](DEVELOPMENT_PROGRESS.md): current plan and delivery status

## Setup

- [`LOCAL_RUNTIME_SETUP.md`](LOCAL_RUNTIME_SETUP.md): running the sidecar, frontend and desktop app locally
- [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md): Supabase project, auth and storage
- Environment: one `.env` at the repository root (template: [`../.env.example`](../.env.example)). It is git-ignored; the sidecar and frontend both read it.

## Folders

| Folder | Contents |
|---|---|
| [`review/`](review/) | Review (Static) specs and decisions: workflow, activity, findings, embedding, indexing, provider pause, usage accounting |
| [`dynamic/`](dynamic/) | Dynamic Testing specs: missions and runs, environments, browser execution, evidence, reports, release protocol |
| [`project/`](project/) | Project-level features: readiness, assessment, sources and sync (GitHub, Google Drive), authentication, model providers |
| [`acceptance/`](acceptance/) | Acceptance and evaluation runs: dated outcome reports and their recorded data (large JSON). Historical evidence; do not edit recorded results |
| [`qa/`](qa/) | QA and UX reviews of the whole system |
| [`archive/`](archive/) | Superseded plans and one-off notes kept for reference |

## Conventions

- Date-stamped files (`NAME_YYYY-MM-DD.md`) record a decision or result at that date; newer files supersede older ones on the same topic.
- Put new specs in the module folder they describe. Put run outputs under `acceptance/<RUN_NAME>_YYYY-MM-DD/`.
- Local screenshots and evidence live in the git-ignored `evidence/` folder at the repository root, so links to it only resolve on the machine that captured them.
