import { signIn } from "@/server/actions/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form action={signIn} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Architecture Job Intelligence</h1>
          <p className="muted text-xs mt-1">Single-user system. Sign in with the Supabase Auth account created for this project.</p>
        </div>
        {sp.error && <p className="text-danger text-sm">{sp.error}</p>}
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        <button className="btn btn-primary w-full justify-center" type="submit">Sign in</button>
      </form>
    </main>
  );
}
