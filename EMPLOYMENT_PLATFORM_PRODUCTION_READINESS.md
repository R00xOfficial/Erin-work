# Employment platform: production readiness

The single place to see what is genuinely finished and what is not. Statuses are only these four:

| Status | Meaning |
|---|---|
| **PASSED** | Checked, with evidence given in the row. |
| **FAILED** | Checked or inspected, and it does not meet the requirement. |
| **BLOCKED** | Cannot be checked yet because something outside the code is missing (named in the row). |
| **NOT ASSESSED** | Not checked yet. No claim either way. |

Where something is partly done, the row is split so each half has its own status. A row is never marked PASSED on the strength of "the code exists": it needs a test, a query, a measured result or an inspection, written down in the Evidence column. Last audited: 2026-10-28, against commit `HEAD` of `claude/site-setup-claude-api-0ksyao`.

**Bottom line today:** the five stages are built, typecheck, and pass their unit tests, and the database rules that were tested hold. **No real vacancy has ever been discovered, scored or applied to**: the worker is not deployed, so Gates 2, 4 and 5 cannot pass yet, and the scraper has never run against a real site. Nothing here should be relied on for a real job search until the BLOCKED rows are cleared.

What unblocks the most: (1) Supabase service role key, (2) architecture-jobs database password (session pooler URL), (3) `ANTHROPIC_API_KEY`, (4) a Supabase Auth user, (5) home postcode, (6) Cloudflare domain. Then deploy the worker and run the Gate 5 pilot below.

---

## Gate summary

| Gate | Status | Why |
|---|---|---|
| 1. Data integrity | **NOT ASSESSED** (partly PASSED) | Constraints and key rules verified; real records, deduplication on real data and recovery not yet. |
| 2. Functional correctness | **BLOCKED** | Logic unit-tested in isolation; the stages have never run together on real data (needs worker + keys). |
| 3. Security and privacy | **NOT ASSESSED** (partly PASSED) | SSRF guard, headers, upload checks, advisors clean; auth settings, authorisation review and pen-test items remain. |
| 4. Operational reliability | **BLOCKED** | Retry/singleton design in place; nothing has run on a schedule, no alerts, no restore test. |
| 5. Real-world validation | **BLOCKED** | Needs a live worker and a real end-to-end pilot. |

---

## A. Additional features

| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| A1 | Every vacancy, employer, score and recommendation traceable to its source | **PASSED** (design) | Vacancies keep `original_url`, `canonical_url`, `discovery_source`, `first_seen_at`, `last_checked_at`, snapshots (`vacancy_snapshots`); claims carry `source_id`/evidence status; assessments store `inputs_hash`, profile and weight versions; recommendations store their evidence JSON. Not yet exercised on real records. |
| A2 | Detect stale records, conflicting information, duplicate companies, expired vacancies | **NOT ASSESSED** | Jobs exist (`review.stale_records`, `enrich.page_check`, dedup in shared with tests) but have not run on real data. Unique indexes confirmed in the database: `employers_normalised_name_uq`, `employers_domain_uq`, `employers_ch_number_uq`, `vacancies_canonical_url_hash_uq`, `applications_vacancy_uq`. |
| A3 | Verified fact / inference / unknown kept distinct | **PASSED** | Evidence-status badges in the UI; Stage 2 tests: unknown excluded from scores (`assessment.test.ts` "treats missing information as unknown"), conflicts preserved ("preserves source conflicts"), quoted evidence verified verbatim (`research.test.ts`). |
| B | Stage changes preserve identity, research, score, documents and history | **PASSED** (database rules) / **BLOCKED** (end to end) | Stage 4 trigger tested in rolled-back transactions earlier (post-submission stages need confirmation; documents frozen after confirmation). Insight reports immutable: verified 2026-10-28 by a rolled-back test (update blocked, delete blocked, note edit allowed). Applications link to vacancy/employer by id and survive vacancy expiry by design (`applications_vacancy_uq`, no cascade from vacancy). A full real-data walk through all five stages has not happened. |
| C1 | Jobs run independently of the website | **BLOCKED** | Worker is a separate Railway service (pg-boss, cron). Not deployed: needs service role key and DB URL. |
| C2 | Retries, timeouts, rate limits | **PASSED** (code) / **NOT ASSESSED** (live) | `queues.ts` sets `retryLimit` and `expireInSeconds` per queue; `politeFetch` has per-host serialisation, robots.txt, Retry-After, 429 pause, 30 s timeout. Not observed live. |
| C3 | Job status and failure reporting | (split into the rows below) | n/a | |
| C3a | Failed jobs recorded | **PASSED** (code) | `job_requests` has status/error; dead-letter handler turns exhausted jobs into a task. Not observed live. |
| C3b | Alerts when discovery fails | **FAILED** | No alerting or error tracking is wired up. A failed run is visible only in the app and logs. |
| C4 | Protection against duplicate processing | **PASSED** (code) / **NOT ASSESSED** (concurrency test) | `singleton` queue policy for scheduled discovery; `singletonKey` on web-requested jobs; `ai_runs` idempotent on input hash; `dedupe_key` unique indexes on plan actions and notifications. No concurrent-run test has been run. |
| D1 | Reusable documents with version history | **PASSED** | Documents table with version label, `is_current`, SHA-256; uploads no longer overwrite (content hash in path); soft delete. Static review plus type/build checks; no live upload test. |
| D2 | Application-specific snapshots | **PASSED** (DB rule) | `submitted_snapshot` and `documents_snapshot` frozen at confirmation; trigger blocks edits after (tested earlier in a rolled-back transaction). |
| D3 | Pre-submission checklist for CV, portfolio, cover letter | **PASSED** (unit) | `defaultChecklist`, `applicationReadiness` (CV selected, recipient, method, final message, open checklist items) with tests in `applications.test.ts`. UI not exercised on real data. |
| E | One shared task and deadline engine | **FAILED** | Reminders and due items come from four separate tables: `tasks` (Stage 1), `plan_actions` (Stage 3), `application_followups` (Stage 4) and interviews/deadlines on `applications`. All reminder output converges on `notifications` with a dedupe key, which prevents duplicate notices, but there is no single task model, so the same real-world obligation can appear in more than one list. Needs a design decision before changing (see "Recommended next work"). |
| F1 | Export of employers, applications, notes, documents | **PASSED** (code, build) / **NOT ASSESSED** (run) | `/api/export/everything` (employers, offices, contacts, vacancies, research, priorities, applications and history, feedback, document manifest with hashes), `/api/export/applications`, `/api/export/insights`. Needs a login to try. Document files themselves are not in the JSON; they stay in storage. |
| F2 | A restore has been tested | **BLOCKED** | Needs a clean Supabase project and the DB password. Supabase free plans have no automatic database backups; a backup file existing is not evidence. |

---

## B. Mandatory checks

### Discovery and web extraction

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Test against real architecture careers pages | **BLOCKED** | Worker not running; fixtures exist only for RIBA RSS and Adzuna. |
| JavaScript-rendered pages | **FAILED** (unsupported) | Extraction uses `fetch` + HTML parsing; there is no headless browser, so pages that build their listings with JavaScript return little or nothing. The Scrapling proof of concept was discussed but not built. |
| Pagination | **NOT ASSESSED** | Not tested; careers-page extraction reads one page per site. |
| Cookie banners | **NOT ASSESSED** | Banners are not an issue for plain HTML fetches but not tested on real sites. |
| PDFs | **FAILED** (unsupported) | PDF text is not extracted. |
| Malformed pages | **PASSED** (limited) | `extract.test.ts` / `careers.test.ts` run on small fixtures; titles must be quoted from the page (`careers.test.ts` "rejects a title the page does not contain"). |
| Extracted fields verified against the original page | **BLOCKED** | Needs a ground-truth sample (see scraper gate). |
| Blocked sites, timeouts, rate limits, temporary failures | **PASSED** (code) / **NOT ASSESSED** (live) | robots.txt honoured; 429/503 pause the host; 403 not retried; 30 s timeout; SSRF guard returns a "blocked" result instead of throwing. |
| A changed page cannot silently overwrite good data with empty or wrong fields | **NOT ASSESSED** | `last_extracted_hash` and snapshots exist; no test proves empty extraction is refused. Add a regression test before the pilot. |

### Database and workflow integrity

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Constraints, indexes, migrations, rollback | **PASSED** (partly) | 101 foreign keys, all now indexed (`fk_*` indexes, migration 2900; verified by query, 0 unindexed). Migrations 1700-2900 are in `supabase/migrations`. **FAILED**: no written rollback/down procedure exists; the practical rollback is restoring a backup, which is untested. |
| Duplicate detection with varied URLs, titles, company names | **PASSED** (unit) / **NOT ASSESSED** (real data) | `dedup.test.ts`, `normalise.test.ts`; unique indexes above. |
| Concurrent discovery jobs and repeated retries | **NOT ASSESSED** | See C4. |
| Stage changes preserve history and document references | **PASSED** (DB rule tests earlier) | As row B above. |
| Deleting, archiving, restoring, exporting | **NOT ASSESSED** | Soft delete (`deleted_at`) is used throughout; no restore-from-archive test; export exists. |

### Scoring and AI quality

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Fixed test dataset with known expected scores | **PASSED** (suitability and priority) | `assessment.test.ts` (16 cases) and `prioritise.test.ts` (20+ cases), reproducibility test (same inputs, same hash). **Gap**: cases are hand-built, not a curated set of real vacancies. |
| Missing qualifications, unknown deadlines, conflicting evidence | **PASSED** | Tests named in the bullets above ("treats an unknown closing date as unknown", "preserves source conflicts…"). |
| Essential requirements cannot be hidden by a high aggregate | **PASSED** | "flags an essential requirement above Erin's qualification as a blocker even when the total is high"; "puts an item with an essential blocker on hold… however well it scores". |
| Prompt injection in scraped text | (split into the rows below) | |
| …system prompts treat page text as untrusted data | **PASSED** (inspection) | `research.vacancy.ts`, `discovery.careers_pages.ts` say so. `employer_briefing` and draft prompts were not re-read in this audit: **NOT ASSESSED**. |
| …output cannot carry an injected claim into the record | **PASSED** (unit) | Extractions must quote the source verbatim or are dropped (`research.test.ts`, `careers.test.ts`); drafts use only approved facts and unsupported claims are flagged (`applications.test.ts` `checkDraft`). **No adversarial injection test with a real model has been run**: **BLOCKED** (needs API key). |
| AI cannot invent sources, qualifications, vacancies or employer responses | **PASSED** (unit) / **BLOCKED** (live) | As above; Stage 5 recommendations are rule-based, not AI-generated, so they cannot invent evidence. |

### Security and privacy

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Authentication on every page and API route | **PASSED** (partly) | Middleware (`proxy.ts`) redirects signed-in-only paths; deployed check 2026-10-28: `/insights` and `/api/export/*` return 307 when signed out. Routes that return data also check the user themselves. A full route-by-route crawl signed out has not been done. |
| Public sign-up disabled | **NOT ASSESSED** | RLS policies are `authenticated_all`: anyone who can create an account can read everything. **Confirm sign-ups are disabled in Supabase Auth settings.** This is the single most important thing to check. |
| Session management | **NOT ASSESSED** | Supabase SSR cookies; no custom review. |
| SQL injection | **PASSED** (inspection) | All access goes through the Supabase client (parameterised); no string-built SQL found in the web app. Worker uses the same client plus pg-boss. |
| XSS | **PASSED** (inspection) | No `dangerouslySetInnerHTML` anywhere in `apps/web/src` (0 matches); React escapes output. Scraped text is rendered as text. |
| CSRF | **NOT ASSESSED** | Next.js server actions apply their own origin checks; not independently tested. |
| IDOR | **PASSED** (by design) | Single-user system, so there are no other users' records to reach; becomes **FAILED** if a second account is ever allowed. |
| Unsafe file uploads | **PASSED** (code) | 25 MB limit, extension allow-list (pdf/doc/docx) plus magic-byte check (`documents.ts`); stored in a private bucket; downloads only via `/api/documents/[id]` with a 60-second signed link. Not yet tried with a malicious file. |
| SSRF: block internal and cloud-metadata destinations | **PASSED** (unit) | New `apps/worker/src/lib/ssrf.ts`: only http(s); no credentials; blocks localhost/.internal/.local, private, loopback, link-local (169.254.x, incl. cloud metadata), CGNAT, multicast, IPv6 unique-local/link-local and IPv4-mapped IPv6; resolves every DNS answer; revalidates every redirect hop; response size cap 5 MB. Tests: `ssrf.test.ts` (3 cases, 30+ addresses/URLs). **Residual risk**: a DNS answer could change between the check and the request (DNS rebinding); fixing it means pinning the resolved IP at connect time. The web app makes no requests to user-controlled URLs (only fixed Google endpoints). |
| Security headers | **PASSED** (config) | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, restrictive CSP (`frame-ancestors 'none'`; no script CSP yet, which needs nonces with Next: **NOT ASSESSED**). **Verified on the deployed site 2026-10-28** (`curl -I /api/health`): `x-frame-options: DENY`, `x-content-type-options: nosniff`, `strict-transport-security`, `referrer-policy: same-origin`, `permissions-policy`, `content-security-policy`; no `x-powered-by` header. Signed-out `/api/export/everything`, `/api/export/insights` and `/insights` return 307. First Railway build of this commit failed with no logs; a clean local rebuild passed and a redeploy succeeded. |
| Protect API keys, CVs, documents, contacts | **PASSED** (partly) | Secrets are Railway variables, not in the repo; worker logger redacts tokens; documents are in a private bucket, never public URLs; exports exclude OAuth tokens and AI logs. **NOT ASSESSED**: secret scanning of git history. |
| Database advisors | **PASSED** | Supabase security advisor: 0 findings (2026-10-28, after pinning one function's `search_path`). Performance advisor: unindexed foreign keys fixed; "unused index" notices are expected on an empty database and should be reviewed after real use. |
| Data retention, deletion, backups, third-party AI data handling | **FAILED** (undocumented) | No retention policy or privacy notice has been written. See "Legal and practical" below. |

### Operations and reliability

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Scheduled jobs run while the site is closed or redeploying | **BLOCKED** | Worker not deployed. |
| Retries, idempotency, queue recovery, duplicate-job prevention | **NOT ASSESSED** | Designed (see C2, C4); needs a kill-and-restart test on the live worker. |
| Structured logs | **PASSED** (code) | `pino` JSON logs with redaction. |
| Error tracking and alerts for failed discovery | **FAILED** | None. Recommended: a daily "last successful run per source" check that creates a visible warning, plus an external uptime/error monitor. |
| Rate limits and resource use under a large backlog | **NOT ASSESSED** | Per-host throttle and daily request caps exist; never load-tested. |
| Restore a backup into a clean environment | **BLOCKED** | See F2. |
| Health check | **PASSED** | `/api/health` returns ok on the deployed site. |
| CI | **PASSED** (exists) | `.github/workflows/ci.yml`; last runs not reviewed in this audit. |

### Accessibility and user experience

| Requirement | Status | Evidence / what is missing |
|---|---|---|
| Mobile and desktop layouts | **NOT ASSESSED** | Not tested in a browser. |
| Keyboard navigation, screen-reader labels | **NOT ASSESSED** | Forms use `<label>`; no audit, no automated check. |
| Loading, empty, error, partial-result states | **PASSED** (partly) | Insights, pipeline and priorities have explicit empty/"no data" states. Error boundaries not reviewed. |
| Filters, sorting, pagination, search together | **NOT ASSESSED** | |
| Dates, time zones, salaries, distances consistent | **NOT ASSESSED** | Shared formatters exist (`fmtDate`, `fmtMoney`); times are shown in the server's zone, which is not necessarily UK time: **likely a defect**, to verify. |
| Clear confirmation, no accidental submission or deletion | **PASSED** (by design) | Submission, accept/decline/withdraw require a ticked confirmation; sending needs approval on the Outreach page; reports cannot be deleted. Some destructive buttons (e.g. remove document, discard draft) act immediately without a confirm step: **FAILED** for those. |

---

## C. Scraper acceptance gate

| Test | Required result | Status | Evidence / what is missing |
|---|---|---|---|
| Real-site extraction | Correct fields from a representative sample of actual sites | **BLOCKED** | Needs the worker running and a sample of 15-25 real practice careers pages. |
| Extraction accuracy | Measured against manually verified ground truth | **BLOCKED** | No ground truth exists yet. Plan: Erin (or the pilot) verifies 100 extracted vacancies by hand; record title, location, deadline and application link accuracy and false positives. |
| Duplicate handling | Repeated runs do not create duplicates | **PASSED** (DB) / **NOT ASSESSED** (runs) | `vacancies_canonical_url_hash_uq`; collapse-duplicates unit test. Run the same source twice and compare counts. |
| Page changes | Changed layouts cause detectable failures, not silent corruption | **NOT ASSESSED** | See "changed page" row. |
| Expired jobs | Closed vacancies identified without deleting application records | **PASSED** (design) | Vacancies get `status`/`disappeared_at`; applications are never deleted when a vacancy closes. Not run live. |
| Failure isolation | One broken site does not stop others | **NOT ASSESSED** | Per-site handling is expected in `discovery.careers_pages.ts`; needs a test with one failing host. |
| Throughput | Time and resources measured on a representative workload | **BLOCKED** | |
| Provenance | Original URL and last-checked time retained | **PASSED** (schema) | `vacancies.original_url`, `last_checked_at`, `last_verified_at`. |

Metrics to record at the pilot: field-level accuracy (title, location, closing date, application link), completeness, false-positive rate (listings that are not vacancies), and processing time and memory per site.

---

## D. Legal and practical

| Item | Status | Evidence / what is missing |
|---|---|---|
| UK GDPR: data collected, purpose, retention, deletion, export | **FAILED** (undocumented) | The README notes a lawful-basis field per contact and a 12-month purge idea; no written record of processing, retention schedule or deletion procedure exists. Export exists. |
| Website access rules, terms, copyright | **PASSED** for rate limits and robots.txt; **NOT ASSESSED** for each source's terms | robots.txt and Crawl-delay are honoured and sources are throttled (**PASSED** in code). Each source's terms have not been reviewed: **NOT ASSESSED**. Store only what is needed (snapshots are for audit; do not republish). |
| Recruitment accuracy: expired/uncertain/unverified clearly labelled | **PASSED** (UI) | Vacancy status, unverified evidence badges, "listing closed" notices. |
| Email and outreach (PECR) | **NOT ASSESSED** | Stop switch, suppression list, caps and approval gate exist; the legal review of speculative outreach to practices has not been done. Sending is off until Erin reviews ICO PECR guidance. |
| Data minimisation about recruiters and other staff | **NOT ASSESSED** | Contacts carry source and relevance fields; no minimisation review. |
| AI transparency and human review before sending | **PASSED** (design) | Drafts labelled "AI-assisted", flags must be acknowledged, sending only through approval; no automatic send path exists. |

---

## E. Production-readiness gates, in detail

### Gate 1: Data integrity: **NOT ASSESSED**
Passed so far: key uniqueness rules (above), FK indexes, immutability of submissions and saved reports, append-only history tables.
To pass: import a real sample, confirm relationships on real rows, run discovery twice and compare counts, restore a backup and compare row counts and hashes.

### Gate 2: Functional correctness: **BLOCKED**
Passed so far: 134 shared and 21 worker unit tests; typecheck and production build; database rule tests.
To pass: walk one real vacancy through all five stages with the worker running, plus edge cases (closed vacancy with an application, speculative approach with prior contact, rejected then re-applied).

### Gate 3: Security and privacy: **NOT ASSESSED**
Passed so far: SSRF guard, upload checks, headers, advisors clean, no HTML injection points.
To pass: confirm sign-ups disabled; signed-out crawl of every route; secret scan of history; write the privacy and retention note; review third-party AI data handling (Anthropic API terms) and record the decision.

### Gate 4: Operational reliability: **BLOCKED**
To pass: deploy worker; kill it mid-job and confirm recovery; run a duplicate-trigger test; add failure alerting; restore into a clean project.

### Gate 5: Real-world validation: **BLOCKED**
To pass: Erin completes a representative job search (discover → research → prioritise → prepare → record submission → follow up → record an outcome) on genuine vacancies, and the Insights page matches her own tally.

---

## F. Recommended next work, in this order

1. **Unblock**: provide the six items at the top; deploy the worker.
2. **Confirm sign-ups are disabled** in Supabase Auth (minutes; highest risk reduction).
3. **Scraper gate**: pick 15-25 real careers pages, build the ground-truth sheet, measure accuracy, and decide on JavaScript rendering and PDFs from the failures found.
4. **Add the "bad extraction must not overwrite good data" regression test** and a failure-isolation test.
5. **Decide the task-engine design** (one `work_items` model that tasks, plan actions and follow-ups all feed, versus keeping separate sources and de-duplicating at the notification layer). This changes three stages, so it should be agreed rather than assumed.
6. **Alerting**: a daily check that raises a visible warning for any source with no success in N days, and an external uptime monitor.
7. **Restore drill** into a clean Supabase project, recorded here with the row counts compared.
8. **Privacy note and retention schedule**; review the PECR position before enabling any sending.
9. **Accessibility and UK-time pass**; add confirmation steps to the immediate destructive buttons.
10. **Pilot** (Gate 5) and record the outcome in this document.

## G. How to update this document

When something is checked, change its status and put the evidence in the same row: the command run, the test name, the query result or the date and what was seen. If a result is later found to be wrong, change the status back and say why. Do not delete FAILED rows when they are fixed; change the status and add the date of the fix.
