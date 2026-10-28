export interface VacancyFact {
  id: string; label: string; employerId: string | null; source: string; firstSeenAt: Date; status: string; discoveryState: string; eligibility: string;
  duplicateOf: string | null; isTest: boolean; researched: boolean; prioritised: boolean; priorityStatus: string | null; dismissedReason: string | null;
  roleFamily: string | null; practiceType: string | null; zone: string | null; hardFlags: string[]; disappeared: boolean;
}
export interface ApplicationFact {
  id: string; label: string; employerId: string; vacancyId: string | null; type: string; stage: string; selectedAt: Date; submittedAt: Date | null; confirmed: boolean;
  outcomeAt: Date | null; source: string | null; roleFamily: string | null; practiceType: string | null; zone: string | null; cvVersion: string | null;
  suitability: number | null; priorityStatus: string | null; matchedPreferences: boolean | null; discoveredAt: Date | null; firstResponseAt: Date | null;
  interviews: number; assessments: number; isTest: boolean;
}
export interface FeedbackFact { id: string; applicationId: string; source: "employer" | "own"; kind: string; tags: string[]; occurredAt: Date }
export interface FollowupFact { status: string; dueAt: Date; completedAt: Date | null }
export interface SourceRunFact { source: string; startedAt: Date; status: string; errors: number }
export interface RequirementGapFact { vacancyId: string; suitability: number | null; missing: string[] }
export interface SourceLabel { code: string; label: string; enabled: boolean }
export interface PrefsFact { maturityDays: number; backlogDays: number }

export interface InsightFacts {
  vacancies: VacancyFact[]; applications: ApplicationFact[]; feedback: FeedbackFact[]; followups: FollowupFact[]; sourceRuns: SourceRunFact[]; gaps: RequirementGapFact[];
  sources: SourceLabel[]; priorityFeedback: { accepted: number; rejected: number }; employersDiscovered: { id: string; discoveredAt: Date; isTest: boolean }[];
}
