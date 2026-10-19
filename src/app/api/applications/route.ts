import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readDb({ postings: false }));
}
