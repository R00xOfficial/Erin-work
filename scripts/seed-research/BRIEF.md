# Employer research brief, ROUND 2 (shared by slices 11-16)

Round 1 already loaded ~550 employers (mostly larger and better-known firms). Round 2 goes DEEPER: small studios (1-10 staff), smaller towns, and firms round 1 missed. The exclusion list is EXISTING_R2.txt (same directory): skip anything on it, by domain or by name.

Goal: find REAL, CURRENTLY-TRADING employers that an entry-level architecture graduate (University of Portsmouth
architecture degree, Part 1-equivalent, London-based) could realistically approach for: Part 1 / graduate architectural
assistant, junior architectural technician/technologist, junior BIM/CAD, design coordinator, planning assistant,
urban design junior, visualisation, placements.

## Hard rules
1. VERIFY EVERY RECORD on the employer's OWN website with WebFetch (or a fetch that returns the page). Confirm it loads,
   the business is current (recent projects/news or copyright 2024–2026), and find the studio address/town/postcode
   (contact page or footer). If you cannot load the site or confirm it is current, DROP the record. Never invent
   a company, website, postcode or email.
2. Studio address, not registered office. Multi-office firms: record the office inside your slice's geography.
3. No personal data: never record named individuals or personal emails. Only record a generic/careers email
   (info@, studio@, careers@, jobs@, recruitment@) if it is printed on the employer's own site.
4. Do NOT use or cite the RIBA "Find an Architect" directory. Use web search, AJ100/BD lists, Architecture Social,
   Dezeen/RIBA Jobs/AJ Jobs listings, Building Design, council and housing-association sites for discovery only;
   source_url must be the employer's own page you verified.
5. entry_level_evidence only when you SAW it (e.g. "Team page lists 3 Part 1 Architectural Assistants",
   "Careers page invites Part 1 / year-out applications", "Graduate programme page"). Give the exact URL. Otherwise null.
6. Prefer variety of sizes: include small (1–10) and medium (10–50) studios, not just famous firms — small/medium
   practices are often the best entry route.
7. Exclude these (already in the database): MH Architects, Make Architects, Hampshire Design Consultancy, Farrells,
   Donald Insall Associates.

## Output
Append ONE JSON object per line to your slice file (path given in your task) using a Python or bash heredoc append.
Write as you go (every ~10 records) so nothing is lost. Fields (use null when unknown, never guess):

{"name": "Legal or trading name as shown on site",
 "display_name": "short name or null",
 "website": "https://...",                       // homepage
 "careers_url": "https://... or null",
 "town": "Guildford",
 "postcode": "GU1 3AA or null",                   // studio postcode from the site
 "county": "Surrey or null",
 "practice_type": one of [architecture_practice, architectural_technologists, multidisciplinary_consultancy,
   interior_workplace_design, urban_design_masterplanning, heritage_conservation, planning_consultancy,
   residential_developer, commercial_developer, housing_association, local_authority, construction_design_build,
   building_surveying, bim_visualisation_studio, university_research, specialist_consultancy, other],
 "size_band": one of [1_5, 6_20, 21_50, 51_200, 201_1000, 1000_plus, unknown],   // only from evidence (team page/about)
 "sectors": ["residential","education",...],      // from their projects page
 "specialisms": ["passivhaus","heritage",...],
 "hires_part1": "yes" | "unknown",
 "entry_level_evidence": "string or null",
 "entry_level_evidence_url": "https://... or null",
 "generic_email": "info@... or null",
 "applications_email": "careers@... or null",
 "source_url": "https://... the page where you verified address/currency",
 "notes": "one factual line, e.g. 'RIBA Chartered per site footer; 2025 projects listed'",
 "confidence": 0-100,                              // 90+ = address+currency verified on site
 "slice": <your slice number>}

## Target
About 50 verified records for your slice. Quality over quantity: 40 real records beat 50 doubtful ones. Budget your searches: you share a search cap, so prefer fetching one list/directory-style page (awards shortlists, local business or council lists, Architecture Social practice pages) that names many firms, then verify each firm on its own site with a single fetch of its contact or about page. Write each record to the file as soon as it is verified. At the end, report: number written, number dropped and why, and any doubtful records.
