import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { signOut } from "@/server/actions/auth";
import { StopSwitchBanner } from "@/components/stop-switch-banner";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Today" },
  { href: "/employers", label: "Employers" },
  { href: "/vacancies", label: "Vacancies" },
  { href: "/applications", label: "Applications" },
  { href: "/contacts", label: "Contacts" },
  { href: "/outreach", label: "Outreach" },
  { href: "/tasks", label: "Tasks" },
  { href: "/data-quality", label: "Data quality" },
  { href: "/sources", label: "Sources" },
  { href: "/settings/profile", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireUser();
  const { data: counts } = await supabase.from("v_dashboard_counts").select("stop_switch, dry_run").maybeSingle();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 flex items-center gap-4 h-12">
          <Link href="/" className="font-semibold tracking-tight">AJIS</Link>
          <nav className="flex gap-1 overflow-x-auto text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="px-2 py-1 rounded hover:bg-surface-2 whitespace-nowrap">{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs muted">
            <span className="hidden sm:inline">{user.email}</span>
            <form action={signOut}><button className="btn btn-sm">Sign out</button></form>
          </div>
        </div>
      </header>
      <StopSwitchBanner stopSwitch={counts?.stop_switch ?? true} dryRun={counts?.dry_run ?? true} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 flex-1">{children}</main>
    </div>
  );
}
