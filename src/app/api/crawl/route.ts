import { lastCrawl } from "@/lib/db";
import { crawlState, startCrawl } from "@/lib/crawler/run";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = "global";
  const state = crawlState(board);
  const last = state.lastRun ?? (await lastCrawl(board));
  return Response.json({ ...state, lastRun: last });
}

export async function POST() {
  const board = "global";
  if (!startCrawl(board)) return Response.json({ error: "A search is already running" }, { status: 409 });
  return Response.json(crawlState(board), { status: 202 });
}
