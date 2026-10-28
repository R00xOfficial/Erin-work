# Architecture Job Intelligence System (AJIS)

A personal recruitment-intelligence platform for an entry-level architecture job search across the
London–Petersfield corridor: an employer database (every business is a *potential* employer), a separate
vacancy register (not every employer has a *current* vacancy), a contacts and outreach CRM, application
tracking, scheduled discovery workers, and a Gmail-integrated, human-approved outreach flow.

| Layer | Where | Notes |
|---|---|---|
| Database | Supabase project `architecture-jobs` (`sdxteghszuqscbnpjpnz`, eu-west-2, Postgres 17) | Schema in `supabase/migrations`, seed in `supabase/seed.sql` |
| Dashboard | `apps/web` — Next.js 16, App Router, server actions | Supabase Auth, single user |
| Worker | `apps/worker` — Node 22 + pg-boss, deploy to Railway | Discovery, enrichment, scoring, AI briefings, Gmail |
| Shared logic | `packages/shared` | Enums, normalisation, dedup, scoring, eligibility, pre-send checklist, zod schemas |
| DB types | `packages/db` | Generated Supabase types + client factories |

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in the Supabase keys (see below); other keys are optional
pnpm -r --filter './packages/*' build
pnpm test                       # shared + worker unit tests
pnpm db:test                    # applies every migration + seed to a throwaway PostGIS container (needs docker)
pnpm dev                        # dashboard on http://localhost:3000
pnpm dev:worker                 # worker (needs SUPABASE_DB_URL)
```

### Required configuration

1. **Supabase keys** (`.env` / `apps/web/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and for the worker `SUPABASE_DB_URL` using the **Supavisor session pooler**
   (`aws-0-eu-west-2.pooler.supabase.com:5432`). Railway is IPv4-only, so the direct `db.*.supabase.co` host
   will not work there, and transaction mode (port 6543) breaks pg-boss.
2. **A login**: create one user in Supabase Studio → Authentication → Users (sign-ups are disabled). That
   account is the only one that can see the dashboard.
3. `TOKEN_ENC_KEY`: 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   Encrypts the Gmail OAuth tokens at rest.

### Optional keys (each source stays disabled until its key is present)

| Key | Enables | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI employer briefings and vacancy requirement extraction | console.anthropic.com |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna job search (250 requests/day free) | developer.adzuna.com |
| `REED_API_KEY` | Reed Jobseeker API | reed.co.uk/developers |
| `COMPANIES_HOUSE_API_KEY` | Company verification, SIC codes, officers (claims only) | developer.company-information.service.gov.uk |
| `GOOGLE_MAPS_API_KEY` | Public-transport and driving journey times (Routes API) | Google Cloud console (needs billing; ~10k free events/month) |
| `TFL_APP_KEY` | TfL cross-check of London/Surrey journey times | api-portal.tfl.gov.uk |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail connection (drafts, approved send, reply sync) | Google Cloud console → OAuth web client, Gmail API enabled |

Without `GOOGLE_MAPS_API_KEY` the worker records a clearly labelled straight-line **estimate** so the commute
factor is never silently "unknown"; without `ANTHROPIC_API_KEY` briefings are skipped and research stays manual.

## Database

Migrations are plain SQL in `supabase/migrations` (the schema is the contract for everything else):

| File | Contents |
|---|---|
| 0100 extensions | postgis, pg_trgm, unaccent, pgcrypto; `private` schema |
| 0200 enums | every status/category enum (mirrored in `packages/shared/src/enums.ts`) |
| 0300 functions_core | normalisers (`fn_normalise_company_name`, `fn_normalise_postcode`, `fn_extract_domain`, `fn_sha256`) |
| 0400 reference_tables | candidate_profile, settings, geo_zones, pipeline_stage_meta, scoring_weights, email_templates, documents |
| 0500 sources_evidence | source_definitions, host_policies, sources, source_runs, claims, imports |
| 0600 employers | employers, employer_aliases, offices (PostGIS point), travel_times, contacts |
| 0700 vacancies | vacancies, vacancy_snapshots, hiring_signals, planning_applications |
| 0800 applications | applications, interviews, stage_transitions |
| 0900 outreach | activities (every interaction is an event), email_threads, suppressions, email_alert_messages |
| 1000 research_scoring_tasks | ai_runs, research_notes, employer_scores, tasks, job_requests, audit_log |
| 1100 private_oauth | `private.oauth_credentials` + non-secret status view |
| 1200 triggers / 1250 can_send | derived columns, stage transitions, suppression sync, audit; `fn_can_send()` pre-send gate |
| 1300 views | dashboard counts, today's actions, queues, data-quality issues |
| 1400 rls | RLS on every table (authenticated only), storage bucket `documents` |
| 1500 reference_data | zones, stage metadata, scoring weights v1, settings defaults, templates, source definitions |
| 1600 security_hardening | linter fixes, `fn_can_send` restricted to the worker |
| 1700 discovery_state | Stage 1 triage state (new / saved / dismissed, separate from vacancy status), adjacent-role flag, `v_discovery_*` views behind the Discovery page |
| 1800 careers_search | `employers.careers_search_at`: when the worker last looked for a careers page |
| 1900 careers_extraction | `careers_pages` source definition and per-page extraction state on `sources` |
| 2000 careers_data_quality | careers-page data-quality checks; careers source reads 60 pages a run, 4 at a time |
| 2100 stage2_research | profile versioning/approval, `vacancy_requirements`, versioned `assessments`, `assessment_weights`, `research_runs`, Stage 3 readiness views |
| 2200 research_unmatched_vacancies | vacancies without a matched employer can be researched |
| 2300 stage3_prioritise | priority items (recommendation vs Erin's manual decision), decision history, editable models, planner preferences, plan actions, in-app reminders |
| 2400 stage3_recontact_reason | a recorded reason to approach an employer again before the cooldown |
| 2500 stage4_enum_values | new application stages, notification kinds and activity types |
| 2600 stage4_applications | confirmed-submission guard and frozen snapshot, checklist, drafts, follow-ups, interview/assessment fields, `origin` on activities, reusable snippets, `v_application_pipeline` |

Rules the schema enforces: employers are unique on Companies House number, website domain and normalised
name; vacancies on canonical URL; activities on provider message id and idempotency key; every claim carries
an `evidence_status`; `stop_switch` and `dry_run` default **on**.

Applying to a remote project: `pnpm db:push` (Supabase CLI, after `supabase link`), then `pnpm db:seed` and
`pnpm db:types`. If you apply through the Supabase MCP/SQL API instead, note that `DROP` statements stall on
that connection (Supabase's `sql_drop` event triggers); the repo migrations use `drop … if exists` for
idempotency, which is fine through the CLI/psql.

## How the system behaves

- **Employers ≠ vacancies.** The dashboard counts them separately. Seeded employers arrive at
  `awaiting_research` with no vacancies.
- **Hard eligibility beats score.** Part 2/3-only roles, excessive experience, commute over the limit,
  closed listings and suppressed employers are flagged on the vacancy and never hidden by a high employer score.
- **Facts vs interpretation.** `claims` and the intelligence tabs hold observed facts with evidence status and
  source; `research_notes` hold interpretation and the personalised opener, which must be reviewed before any draft.
- **AI is advisory.** Briefings write claims, research notes and vacancy requirement fields (quoted facts only);
  they never create vacancies or change pipeline stages.
- **Nothing is sent without approval.** Drafts are created in Gmail; you approve in `/outreach`; the worker
  re-runs `fn_can_send()` under a row lock (stop switch, suppression, stage, caps, attachments, domain, approval
  age) and then sends. `OUTREACH_DRY_RUN=true` or the dashboard dry-run flag simulates instead.
- **Replies, bounces and opt-outs** are matched by Gmail thread id every 10 minutes; opt-outs create
  suppressions and the follow-up task is cancelled.
- **Sources respect terms.** Dezeen Jobs, Indeed, LinkedIn and the RIBA directory are email/manual only;
  fetch adapters check robots.txt and crawl delays per host; API adapters honour daily caps.

## Stage 2: research and scoring

Saving a vacancy or employer in Discovery queues a research run (`/research`). Nothing in Stage 2 contacts an employer.

- **Vacancy research** (`research.vacancy`): reads the listing (and the employer's own page only for a vacancy with the same title when the
  listing is thin), has Claude list the requirements the vacancy states, and keeps only those whose quote appears verbatim in that
  vacancy's text. Erin can confirm, correct, dispute or reject each one; her decisions survive a refresh.
- **Suitability score** (`packages/shared/src/assessment`): deterministic 100-point model (qualifications 25, experience 20, skills 20,
  location/practical 15, career relevance 10, training 10; editable under Settings → Scoring). Unknown criteria are excluded from the total and
  shown through the assessed share, the 0-100 range, completeness and confidence. Blockers are reported separately and never hidden by the total.
- **Employer speculative priority**: a separate assessment (geography, relevant work, recruitment evidence, training, case for a speculative
  approach), not comparable with vacancy scores.
- **History and audit**: a new `assessments` row is written only when an input changes (profile version, weights, vacancy data, requirements);
  earlier rows are kept. `research_runs` logs each step and every source that could not be read; failed or partial runs can be retried.
- **Stage 3 readiness** (`v_research_*`): reviewed assessment, approved profile, completeness of at least 60%, no conflicting sources or
  open disputes, and a run that did not fail.
- The candidate profile must be approved (Settings → Candidate profile); editing a fit-related field creates a new version that needs approving again.

## Stage 3: prioritise

Opportunities saved for Stage 3 get a **priority item** (`/priorities`). Priority is separate from Stage 2 suitability, vacancy availability and application progress.

- **Priority score** (`packages/shared/src/prioritise`): suitability 40, deadline 20, career value 15, feasibility 15, evidence 10 (editable, versioned).
  A deadline raises priority only in proportion to suitability; blockers and practical constraints put an item on hold with the reason; closed or expired
  vacancies are never live; an unknown closing date stays unknown; incomplete research gives no score. Employers use a separate model that
  distinguishes confirmed recruitment from a hypothesis and holds back anyone already approached (cooldown in Settings → Planner).
- **Your decisions win**: promote, backlog, hold (with a reason), dismiss, override the ranking, pin, favourite, accept/reject the recommendation.
  They live in separate columns and are never overwritten by recalculation; material changes are explained and flagged for review.
- **Planner**: `planner.generate` fits suggested actions into your stated hours and weekly limits, books deadline work before the deadline and leaves
  the rest unscheduled with a reason. Accepted, edited, completed or dismissed actions are never touched. Effort figures are labelled estimates.
- **Reminders**: `reminders.generate` creates in-app reminders only from stored dates, once each, with one daily/weekly summary. They are not emailed.

## Stage 4: apply and follow up

`/applications` is the pipeline (Preparing → Ready for review → Submitted → Awaiting response → Interviews and assessments → Offers and decisions → Closed),
with a Tasks view and filters. Start one from a priority item, a vacancy or an employer (`/applications/new`), which shows earlier contact and requires a
confirmation and a reason before a repeat approach.

- **Nothing is assumed.** "Ready for review" means prepared. An application is only *submitted* when you fill in the submission form (date, method, recipient,
  tick-box) or link a synchronised sent email; a database trigger refuses any post-submission stage without that confirmation, and refuses edits to the
  documents, recipient or snapshot afterwards. A mistaken record is undone with "Correct the submission record" (reason kept in the timeline).
  A vacancy disappearing is not an outcome; no-response and closed-listing outcomes are chosen by you.
- **What was sent is frozen**: document versions (by SHA-256), cover letter, final drafts and answers are snapshotted at submission. Uploaded files are
  never overwritten (the content hash is in the storage path) and are served only through `/api/documents/[id]` to a signed-in user with a one-minute link.
- **Drafts** (cover letters, speculative emails, recruiter intros, answers, interview prep, follow-ups, thank-yous) use only approved facts: your approved
  profile, approved snippets (Settings → Documents) and verified employer facts. Unsupported claims are flagged and must be checked before a draft is
  marked final. A draft is not a message: "Prepare email for approval" puts it in the existing Outreach approval queue, and the usual stop switch,
  suppression and caps still apply. Nothing in Stage 4 sends anything by itself.
- **Follow-ups and reminders** (`followups.generate`, `reminders.generate`) come from an employer's stated timeframe, a date you set, or your configurable rule
  (Settings → Planner), the last labelled as a suggestion and capped per application. Each links to its application and can be completed, rescheduled,
  snoozed or dismissed.
- **Timeline** merges logged and synchronised events, labelled "Logged by you" or "Synced". Manual logging works without any email integration.
- **Backup**: Applications → Export downloads application history and a document manifest as JSON. Supabase free plans have no automatic database backups,
  so keep an export and your original files.

## Daily routine

1. **Morning** — `/` shows today's actions, new vacancies, the research queue and approvals.
2. **Research** — open an employer → verify website, office, team; add contacts (rank by relevance);
   run the AI briefing; review the fit notes; move to *Verified and eligible* → *Ready to contact*.
3. **Outreach / applications** — create a draft from the Outreach tab, approve in `/outreach`; log
   submissions on the application page so the exact CV version is recorded.
4. **End of day** — `/tasks` for follow-ups and deadlines; `/data-quality` for duplicates and stale records.

## Compliance notes

Contacts are business personal data. Each record carries a lawful-basis note (legitimate interest: seeking
employment), the source of the address and a retention rule (purge 12 months after the employer is closed;
suppressions are kept). Every outreach email identifies you, states its purpose and tells the recipient how to
object; objections are honoured automatically. Review the ICO's PECR/UK GDPR guidance before turning the stop
switch off. Publicly available contact details do not remove these obligations.

## Deploying

- **Worker (Railway):** build from `apps/worker/Dockerfile` with the repo root as context; set every variable
  from `.env.example`; `SUPABASE_DB_URL` must be the session pooler URL. One replica only (pg-boss schedules).
- **Web (Railway):** build from `apps/web/Dockerfile` with the repo root as context. `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set as service variables before the build (they are inlined into the bundle).
  Health check: `/api/health`. Add the deployed callback URL to the Google OAuth client.
- **Gmail:** apps in Google's *Testing* publishing state expire grants after 7 days; when that happens the
  worker marks the credential `needs_reauth`, creates a task and halts sending until you reconnect.
