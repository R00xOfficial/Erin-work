# Handoff notes (2026-10-16)

Branch: `claude/architecture-job-intelligence-iwwfb5`. No PR has been opened.

## State
- App, worker, migrations and CI are built (see README). Supabase project `sdxteghszuqscbnpjpnz` (architecture-jobs) holds all migrations.
- **709 employers loaded** (5 original + 552 round 1 + 152 round 2), all at `awaiting_research`, one research task each.
  Zones: A 413, B 97, C 71, EXT 116, OUT 12. 219 have entry-level evidence (a linked claim). No duplicate domains.
- Seed files: `supabase/seed/employers_research_2026-10.*` (round 1) and `employers_research_2026-10b.*` (round 2): csv, idempotent sql, report.json.
  Raw researcher output (with source URLs): `supabase/seed/research_raw/round1|round2/slice_*.jsonl`.
- Research brief and rules: `scripts/seed-research/BRIEF.md`. Pipeline: `liveness.py` -> `merge.ts` (set `EXCLUDE_DIRS` to the earlier rounds' raw dirs) -> `load_NN.sql` batches
  (generated into `*.batches/`, gitignored) -> run each through the Supabase SQL API -> compare the md5 fingerprint with a local docker run (`supabase/tests/smoke.sh`).

## Still open
1. **Companies House key (DONE 2026-10-16: authenticates, HTTP 200).** Worker reads `COMPANIES_HOUSE_API_KEY`. It was added to the cloud environment after the session started, so it was not visible; a new session should see it.
   Next step: test one lookup, then enumerate architecture firms by SIC 71111 to find firms not yet researched (avoids the web-search cap that limited round 2).
   Result: `supabase/seed/round3/companies_house_candidates_2026-10-16.csv` lists 372 active SIC 71111 companies (14 West/East Sussex search areas) not matched to the repo by number or name.
   Caveats: most are 1-person shells with no size/website/careers data; only a minority of seeded rows carry a CH number so name matching is fuzzy; some are not architecture (surveyors, yacht design). Needs triage and web research before loading.
2. **Indeed.** Connector hit a rate limit and then disconnected. Found about 22 plausible roles in ~45 searches; none saved to the database. Checked in full:
   ADF Scaffold Design (Graduate Revit/Scaffold technician, London, from £29k), Evoke (CAD and Technical Assistant, Wallington, £13-16/h part time),
   Tiny House Pro (Potters Bar, £20k), Witcher Crawford (Winchester; needs several years' experience, so a speculative target only).
   Title-only (unchecked): Montagu Evans 2027 Graduate Historic Environment adviser, Willmott Dixon graduate/degree apprenticeship (Interiors), Maplin Engineering Architectural Assistant (Upminster),
   Architectus (Worthing), Carrington West Planning Assistant, Hampshire CC Landscape Architectural Assistant, Salutem draftsperson, EPP AutoCAD technician, Tuffin Ferraby Taylor junior CAD site technician, Arup placement and graduate town planner.
3. **Round 3 research gaps:** Chichester/Bognor/Littlehampton, Horsham/Crawley mid-size firms, Brighton practices of 10+ staff, in-house council/housing design teams.
   Hampshire County Council property services looks promising but its site blocks automated fetches (check in a browser).
4. Set the home postcode in Settings so geocoding and commute times can run (all offices currently show as not geocoded).

## Known data caveats
- Size bands are mostly `unknown`; `hires_part1` is `yes` for 47 firms only, where evidence was seen.
- Registered-office postcodes (zone may be off): Southern Housing, Wandle, CALA, Surrey County Council.
- Round 2 estates/university/NHS-type records were dropped for low confidence; Vistry and Persimmon entry-level evidence is group-wide, not architecture-specific.
- One round 2 loader agent mistyped the Humber Architecture office id; it was corrected in the database and all fingerprints match the repo files.
- Supabase SQL API stalls on any DROP statement; use idempotent CREATE-only SQL through it.
