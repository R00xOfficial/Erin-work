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
- **Web:** `pnpm --filter @ajis/web build`; run on Railway or Vercel with the Supabase keys and Google OAuth
  variables; add the deployed callback URL to the Google OAuth client.
- **Gmail:** apps in Google's *Testing* publishing state expire grants after 7 days; when that happens the
  worker marks the credential `needs_reauth`, creates a task and halts sending until you reconnect.
