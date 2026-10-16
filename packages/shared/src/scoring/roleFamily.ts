import type { RoleFamily, QualificationRequired } from "../enums.js";

export interface TitleClassification {
  family: RoleFamily;
  /** Qualification the title itself implies. "unknown" when the title is silent. */
  impliedQualification: QualificationRequired;
  /** Whether the family is one an entry-level architecture graduate can realistically apply for. */
  entryLevel: boolean;
  matchedPattern: string | null;
}

interface Rule {
  family: RoleFamily;
  qualification: QualificationRequired;
  entryLevel: boolean;
  pattern: RegExp;
}

// Ordered: the first match wins, so disqualifying seniority patterns come first.
const RULES: Rule[] = [
  { family: "senior_or_unsuitable", qualification: "part3", entryLevel: false, pattern: /\b(senior|associate|director|principal|lead|head of|partner|project architect|team leader|manager)\b/i },
  { family: "architect_part3", qualification: "part3", entryLevel: false, pattern: /\b(part\s*(3|iii)|registered architect|qualified architect|arb\b)/i },
  { family: "part2_assistant", qualification: "part2", entryLevel: false, pattern: /\bpart\s*(2|ii)\b/i },
  { family: "part1_assistant", qualification: "part1", entryLevel: true, pattern: /\b(part\s*(1|i)|year[\s-]?out)\b/i },
  { family: "placement_internship", qualification: "none", entryLevel: true, pattern: /\b(intern(ship)?|placement|work experience|summer student|sandwich)\b/i },
  { family: "bim_cad", qualification: "none", entryLevel: true, pattern: /\b(junior|graduate|trainee|assistant)\b.*\b(bim|cad|revit|drafts?(man|person)|modell?er)\b|\b(bim|cad)\b.*\b(junior|graduate|trainee)\b/i },
  { family: "technologist", qualification: "technician", entryLevel: true, pattern: /\b(graduate|junior|trainee|assistant)\b.*\btechnologist\b|\btechnologist\b.*\b(graduate|junior|trainee)\b/i },
  { family: "technician", qualification: "technician", entryLevel: true, pattern: /\b(graduate|junior|trainee|assistant)\b.*\btechnician\b|\btechnician\b.*\b(graduate|junior|trainee)\b/i },
  { family: "design_coordinator", qualification: "none", entryLevel: true, pattern: /\b(graduate|junior|trainee|assistant)\b.*\b(design (coordinator|manager|assistant)|technical (assistant|coordinator)|development assistant)\b/i },
  { family: "urban_design_junior", qualification: "none", entryLevel: true, pattern: /\b(graduate|junior|trainee|assistant)\b.*\b(urban design|masterplann|landscape)/i },
  { family: "planning_assistant", qualification: "none", entryLevel: true, pattern: /\b(graduate|junior|trainee|assistant)\b.*\bplann(er|ing)\b|\bplanning (assistant|technician)\b/i },
  { family: "visualisation", qualification: "none", entryLevel: true, pattern: /\b(junior|graduate|trainee)\b.*\b(visuali[sz]er|visuali[sz]ation|cgi|render)/i },
  { family: "graduate_assistant", qualification: "part1", entryLevel: true, pattern: /\b(graduate|junior|trainee)\b.*\barchitect(ural)?\b.*\b(assistant|designer)\b/i },
  { family: "part1_assistant", qualification: "part1", entryLevel: true, pattern: /\barchitectural assistant\b/i },
  { family: "graduate_assistant", qualification: "part1", entryLevel: true, pattern: /\b(graduate|junior) architectural designer\b/i },
  { family: "other_entry", qualification: "none", entryLevel: true, pattern: /\b(graduate|junior|trainee|entry[\s-]level|apprentice)\b/i },
  { family: "senior_or_unsuitable", qualification: "unknown", entryLevel: false, pattern: /\b(technician|technologist|bim|cad|visuali[sz]er)\b/i },
  { family: "senior_or_unsuitable", qualification: "part3", entryLevel: false, pattern: /\barchitect\b/i },
];

export function classifyTitle(title: string | null | undefined): TitleClassification {
  if (!title || !title.trim()) {
    return { family: "unknown", impliedQualification: "unknown", entryLevel: false, matchedPattern: null };
  }
  const t = title.replace(/\s+/g, " ").trim();
  for (const r of RULES) {
    if (r.pattern.test(t)) {
      return { family: r.family, impliedQualification: r.qualification, entryLevel: r.entryLevel, matchedPattern: r.pattern.source };
    }
  }
  return { family: "unknown", impliedQualification: "unknown", entryLevel: false, matchedPattern: null };
}

/** Extract an explicit qualification requirement from description text, if the text states one. */
export function qualificationFromText(text: string | null | undefined): QualificationRequired {
  if (!text) return "unknown";
  const t = text.toLowerCase();
  if (/\bpart\s*(3|iii)\b|\bregistered architect\b|\barb[\s-]registered\b/.test(t)) return "part3";
  if (/\bpart\s*(2|ii)\b/.test(t)) return "part2";
  if (/\bpart\s*(1|i)\b|\briba part one\b/.test(t)) return "part1";
  if (/\b(hnc|hnd|ciat|architectural technolog)/.test(t)) return "technician";
  return "unknown";
}

/** Minimum years of experience explicitly demanded, or null. */
export function experienceYearsFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(?:minimum|at least|min\.?)?\s*(\d{1,2})\+?\s*(?:-\s*\d{1,2}\s*)?years?'?\s*(?:of\s*)?(?:relevant\s*|post[-\s]?qualification\s*|uk\s*|practice\s*|industry\s*)?experience/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}
