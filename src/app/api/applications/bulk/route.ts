import { updateTrackingMany } from "@/lib/db";

/** POST { ids: string[], trashed?: boolean, seen?: boolean } — trash / restore several offers, or mark them as seen. */
export async function POST(req: Request) {
  let body: { ids?: unknown; trashed?: unknown; seen?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  const trashed = typeof body.trashed === "boolean" ? body.trashed : undefined;
  const seen = typeof body.seen === "boolean" ? body.seen : undefined;
  if (!ids.length || (trashed === undefined && seen === undefined)) return Response.json({ error: "Expected ids and trashed or seen" }, { status: 400 });
  return Response.json({ tracking: await updateTrackingMany(ids, { trashed, seen }) });
}
