/**
 * Vacancy search terms. Employers use inconsistent titles, so every discovery adapter runs
 * several variants. Keep Part 1 / Part 2 / Part 3 / technician families separate downstream
 * (see scoring/roleFamily.ts) — a title containing "architectural" is not automatically entry-level.
 */
export const VACANCY_SEARCH_TERMS: readonly string[] = [
  "Part 1 Architectural Assistant",
  "Part I Architectural Assistant",
  "Graduate Architectural Assistant",
  "Year Out Architectural Assistant",
  "Architectural Assistant",
  "Graduate Architectural Designer",
  "Junior Architectural Designer",
  "Junior Architectural Technician",
  "Graduate Architectural Technician",
  "Graduate Architectural Technologist",
  "Graduate Urban Designer",
  "Graduate Building Designer",
  "Junior BIM Technician",
  "Graduate Design Coordinator",
  "Architectural Internship",
  "Architectural Placement",
  "Graduate Technical Assistant",
  "Graduate Development Assistant",
  "Junior CAD Technician",
  "Architectural Visualiser Junior",
  "Graduate Planner",
  "Planning Assistant",
];

/** Compact subset for rate-limited APIs (Adzuna 250/day, Reed). */
export const PRIORITY_SEARCH_TERMS: readonly string[] = [
  "Part 1 Architectural Assistant",
  "Architectural Assistant",
  "Graduate Architectural Assistant",
  "Junior Architectural Technician",
  "Graduate Architectural Technologist",
  "Junior BIM Technician",
  "Graduate Design Coordinator",
  "Graduate Urban Designer",
  "Architectural Internship",
  "Planning Assistant",
];
