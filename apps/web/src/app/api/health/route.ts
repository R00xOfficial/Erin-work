export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, service: "ajis-web", time: new Date().toISOString() });
}
