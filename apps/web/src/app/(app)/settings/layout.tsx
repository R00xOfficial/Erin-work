import Link from "next/link";

const TABS = [["profile", "Candidate profile"], ["scoring", "Scoring"], ["planner", "Planner & reminders"], ["geography", "Geography"], ["caps", "Caps & cadence"], ["gmail", "Gmail & stop switch"], ["templates", "Templates"], ["documents", "Documents"]] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <nav className="tabs">{TABS.map(([k, label]) => <Link key={k} href={`/settings/${k}`}>{label}</Link>)}</nav>
      {children}
    </div>
  );
}
