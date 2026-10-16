import Link from "next/link";

export function StopSwitchBanner({ stopSwitch, dryRun }: { stopSwitch: boolean; dryRun: boolean }) {
  if (!stopSwitch && !dryRun) return null;
  return (
    <div className="bg-accent-soft border-b border-border text-xs px-4 py-1.5">
      <div className="mx-auto max-w-7xl flex flex-wrap gap-3 items-center">
        {stopSwitch && <span><strong>Stop switch is on.</strong> No outbound email will be drafted or sent.</span>}
        {dryRun && <span><strong>Dry run.</strong> Approved sends are simulated.</span>}
        <Link href="/settings/gmail" className="underline ml-auto">Change in Settings → Gmail</Link>
      </div>
    </div>
  );
}
