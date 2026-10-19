import type { Application, PostingDetails } from "../types";
import { analyzePosting, normalizePosting } from "./extract";
import { httpJson, pool } from "./http";
import { fetchPosting, GONE_ERROR, type FetchedPosting } from "./posting";

// Kadoa publishes the full text of the quant postings it tracks; it covers sites that block
// automated reads (Citadel, Squarepoint, Balyasny, D. E. Shaw, AQR…).
const KADOA_DESC = "https://raw.githubusercontent.com/kadoa-org/quant-jobs/main/public/data/job-descriptions.json";
const g = globalThis as unknown as { __kadoaDesc?: { at: number; data: Promise<Record<string, string> | null> } };

function kadoaDescriptions(): Promise<Record<string, string> | null> {
  if (!g.__kadoaDesc || Date.now() - g.__kadoaDesc.at > 6 * 3600e3) {
    g.__kadoaDesc = { at: Date.now(), data: httpJson<Record<string, string>>(KADOA_DESC, { timeoutMs: 90000 }).catch(() => null) };
  }
  return g.__kadoaDesc.data;
}

const KADOA_HEADINGS =
  /\s(?=(About the (Role|Team|Opportunity|Position)|About You|Who You Are|What You('ll)? (Do|Bring|Need)|What We('re| Are) Looking For|Responsibilities|Requirements|Required (Skills|Qualifications)|Qualifications|Preferred (Skills|Qualifications)|Nice to Have|Skills and Experience|Your Profile|Compensation|Benefits)\b:?)/g;

/** Kadoa texts come as one paragraph: restore headings and bullets so the analyser can find sections. */
function kadoaLines(text: string): string[] {
  return text
    .replace(KADOA_HEADINGS, "\n")
    .split(/\n|\s•\s|•/)
    .map((l, i) => (i > 0 && l.length < 220 && !/:\s*$/.test(l) ? `• ${l.trim()}` : l.trim()))
    .flatMap((l) => (l.length > 400 ? l.split(/(?<=[.!?])\s+(?=[A-Z])/) : [l]))
    .filter((l) => l.replace(/^•\s*/, "").length > 2);
}

async function fromKadoa(a: Application): Promise<FetchedPosting | null> {
  const id = a.sourceKeys?.find((k) => k.startsWith("Kadoa quant:"))?.slice("Kadoa quant:".length);
  if (!id) return null;
  const text = (await kadoaDescriptions())?.[id];
  if (!text) return null;
  return { ok: true, via: "kadoa", url: a.urls[0], lines: kadoaLines(text), pay: [] };
}

/**
 * Reads each offer's posting (its other city links if the first fails, then Kadoa's copy).
 * When a read fails but `previous` has a good one, the previous one is kept: nothing already read is lost.
 */
export async function enrichPostings(
  apps: Application[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 8,
  previous: Record<string, PostingDetails> = {},
): Promise<Record<string, PostingDetails>> {
  const out: Record<string, PostingDetails> = {};
  let done = 0;
  await pool(apps, concurrency, async (a) => {
    const urls = [...new Set([a.urls[0], ...a.locations.map((l) => l.url)])].slice(0, 3);
    let details: PostingDetails | null = null;
    let read = false;
    let gone = false;
    for (const url of urls) {
      const f = await fetchPosting(url, a.company, a.title);
      details = analyzePosting(f, a.kind, a.title);
      read = f.ok;
      if (f.ok) break;
      gone ||= f.error === GONE_ERROR;
    }
    if (!details?.ok) {
      const k = await fromKadoa(a);
      if (k) details = analyzePosting(k, a.kind, a.title);
    }
    const prev = normalizePosting(previous[a.id]);
    if (details && !details.ok && prev?.ok) details = prev;
    // A form that could not be read this time (the extra request failed) is still the one read before
    else if (details?.ok && !details.form && prev?.form && prev.via === details.via) details = { ...details, form: prev.form };
    // Taken down on the company's site (even if Kadoa or an earlier read still has its text)
    if (details) out[a.id] = { ...details, gone: !read && gone ? true : undefined };
    onProgress?.(++done, apps.length);
  });
  return out;
}
