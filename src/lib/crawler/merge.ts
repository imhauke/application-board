// Merges a crawl's listings into the board: known offers are matched by URL first (so imported
// rows are recognised even when the classifier would skip them), then by company + title + type.
// Unmatched listings that pass the filters become new rows, one per role with all its cities.

import { createHash } from "node:crypto";
import type { Application, Board, CompanyInfo, Database, JobLocation, Kind } from "../types";
import {
  cvFor,
  eligibilityFor,
  fitFor,
  interviewTypeFor,
  placeOf,
  priorityFor,
  REGION_ORDER,
  roleFor,
  scoreFor,
  visaFor,
  type Place,
} from "./classify";
import { buildProfiles, buildResolver, DEFAULT_INTERVIEW_NOTE } from "./companies";
import type { RawListing, SourceResult } from "./sources";

// ---------- URL identity

export function urlKey(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "").replace(/\/apply$/, "");
  const gh = u.searchParams.get("gh_jid") ?? (host.includes("greenhouse.io") ? (path.match(/\/jobs\/(\d+)/)?.[1] ?? u.searchParams.get("token")) : null);
  if (gh) return `gh:${gh}`;
  const m =
    (host.endsWith("lever.co") && path.match(/([0-9a-f-]{36})/i)) ||
    (host.endsWith("ashbyhq.com") && path.match(/([0-9a-f-]{36})/i));
  if (m) return `${host.split(".").slice(-2, -1)[0]}:${m[1].toLowerCase()}`;
  if (host.endsWith("amazon.jobs")) return `amazon:${path.match(/\/jobs\/(\d+)/)?.[1] ?? path}`;
  if (/lifeattiktok\.com|bytedance\.com/.test(host)) return `tiktok:${path.match(/(\d{12,})/)?.[1] ?? path}`;
  if (host === "google.com") return `google:${path.match(/results\/(\d+)/)?.[1] ?? path}`;
  const keep = ["id", "jobid", "jobreq", "jobcode", "token", "job"]
    .map((k) => [...u.searchParams.entries()].find(([key]) => key.toLowerCase() === k))
    .filter(Boolean)
    .map((e) => `${e![0]}=${e![1]}`);
  return `${host}${path.toLowerCase()}${keep.length ? "?" + keep.join("&") : ""}`;
}

const titleKey = (company: string, title: string, kind: Kind) =>
  `${company}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${kind}`;

// ---------- merge

const NEW_COMPANY_TYPES = new Set(["proprietary", "hedge_fund"]);
const MAX_URLS = 10;

export interface MergeOutcome {
  added: Application[];
  /** Duplicate rows folded into an earlier row with the same posting URL */
  removed: string[];
  newCompanies: CompanyInfo[];
  updated: number;
  closed: number;
  reopened: number;
}

function sortLocations(locs: JobLocation[]): JobLocation[] {
  return [...locs].sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));
}

/** Folds rows the crawler created twice for the same posting (trackers list it under different titles). */
function dedupe(db: Database): string[] {
  const owner = new Map<string, Application>();
  const removed: string[] = [];
  const keep: Application[] = [];
  for (const a of db.applications) {
    const keys = [...a.urls, ...a.locations.map((l) => l.url)].map(urlKey);
    const dupOf = a.firstSeenAt && !db.tracking[a.id] ? keys.map((k) => owner.get(k)).find(Boolean) : undefined;
    if (dupOf && dupOf.kind === a.kind) {
      for (const u of a.urls) if (!dupOf.urls.includes(u) && dupOf.urls.length < MAX_URLS) dupOf.urls.push(u);
      for (const l of a.locations) if (!dupOf.locations.some((x) => x.city === l.city)) dupOf.locations.push(l);
      for (const v of a.visas) if (!dupOf.visas.some((x) => x.region === v.region)) dupOf.visas.push(v);
      for (const src of a.sources) if (!dupOf.sources.includes(src)) dupOf.sources.push(src);
      for (const k of a.sourceKeys) if (!dupOf.sourceKeys.includes(k)) dupOf.sourceKeys.push(k);
      dupOf.locations = sortLocations(dupOf.locations);
      removed.push(a.id);
      continue;
    }
    for (const k of keys) if (!owner.has(k)) owner.set(k, a);
    keep.push(a);
  }
  db.applications = keep;
  return removed;
}

export interface MergeOptions {
  /** The board whose offers `db.applications` holds; new rows belong to it */
  board?: Board;
  /** Other boards' offers: listings that match one of them are skipped, so no offer exists twice */
  foreign?: Application[];
  /** Creates the company of a listing no list knows (for a board that takes any employer) */
  newCompany?: (l: RawListing) => CompanyInfo | null;
  /** Places the classifier does not know */
  place?: (loc: string) => Place | null;
  /** Whether your CV has a language (offers turned down for one are judged again once it does) */
  speaks?: (lang: string) => boolean;
  /** Only places `place` recognises count */
  placesOnly?: boolean;
}

export function mergeListings(db: Database, results: SourceResult[], now: string, gradKey = "", expYears = 0, opts: MergeOptions = {}): MergeOutcome {
  const removed = dedupe(db);
  const foreignUrls = new Set((opts.foreign ?? []).flatMap((a) => [...a.urls, ...a.locations.map((l) => l.url)]).map(urlKey));
  const foreignTitles = new Set((opts.foreign ?? []).map((a) => titleKey(a.company, a.title, a.kind)));
  const rejected = db.rejected ?? {};
  const okSources = new Set(results.filter((r) => !r.error && r.listings.length).map((r) => r.name));
  const listings = results.flatMap((r) => r.listings);
  const companies = { ...db.companies };
  const resolve = buildResolver(companies);
  const profiles = buildProfiles(db.applications);

  const byUrl = new Map<string, Application>();
  const byTitle = new Map<string, Application>();
  for (const a of db.applications) {
    for (const u of a.urls) byUrl.set(urlKey(u), a);
    for (const l of a.locations) byUrl.set(urlKey(l.url), a);
    byTitle.set(titleKey(a.company, a.title, a.kind), a);
  }

  const seenActive = new Set<string>();
  const seenInactive = new Map<string, string>();
  let updated = 0;

  const touch = (a: Application, l: RawListing, places: Place[]) => {
    let changed = false;
    if (!a.sourceKeys.includes(l.key)) (a.sourceKeys.push(l.key), (changed = true));
    if (!a.sources.includes(l.source)) (a.sources.push(l.source), (changed = true));
    if (!a.urls.includes(l.url) && a.urls.length < MAX_URLS) (a.urls.push(l.url), (changed = true));
    for (const p of places) {
      if (!a.locations.some((x) => x.city === p.city)) {
        a.locations.push({ city: p.city, region: p.region, url: l.url });
        if (!a.visas.some((v) => v.region === p.region)) a.visas.push({ region: p.region, visa: visaFor(p, a.kind) });
        changed = true;
      }
    }
    if (changed) a.locations = sortLocations(a.locations);
    if (!a.postedAt && l.postedAt) {
      a.postedAt = l.postedAt;
      a.postedBy = l.source;
    }
    if (!a.salary && l.salary) a.salary = l.salary;
    a.lastSeenAt = now;
    if (l.active) seenActive.add(a.id);
    else seenInactive.set(a.id, l.source);
    if (changed) updated++;
  };

  // New rows are grouped by company + title + type before being created
  type Group = { company: string; role: string; raws: RawListing[]; places: Map<string, { place: Place; url: string }> };
  const groups = new Map<string, Group>();
  const groupByUrl = new Map<string, Group>();

  for (const l of listings) {
    const known = byUrl.get(urlKey(l.url));
    if (known) {
      touch(known, l, []);
      continue;
    }
    if (l.matchOnly || foreignUrls.has(urlKey(l.url))) continue;
    // Already judged: you are not eligible (judged again if your graduation date changed or, for the
    // ones turned down for experience, once your CV adds another year of it)
    const judged = rejected[urlKey(l.url)];
    if (judged && judged.grad === gradKey && (judged.exp == null || judged.exp === expYears) && !(judged.lang && opts.speaks?.(judged.lang))) continue;
    // Only this cycle: no 2026 intakes or postings older than this year, unless they say 2027
    if (!/2027/.test(l.title) && ((l.kind === "grad" && /\b2026\b/.test(l.title)) || (l.postedAt && l.postedAt < "2026-01-01"))) continue;
    let company = resolve(l.company);
    if (!company) {
      const made = opts.newCompany?.(l) ?? null;
      if (made) {
        companies[made.name] ??= made;
        resolve.add(companies[made.name]);
        company = made.name;
      } else {
        if (!l.quant || (l.firmType && !NEW_COMPANY_TYPES.has(l.firmType))) continue;
        const name = l.company.replace(/\s*\([^)]*\)\s*$/, "").trim();
        companies[name] = { name, sector: "Quant/Trading", prestige: "B", pay: 4, aliases: [l.company], onList: false };
        resolve.add(companies[name]);
        company = name;
      }
    }
    const role = roleFor(l.title, l.roleHint);
    if (!role) continue;
    const places = l.locations.map((loc) => (opts.placesOnly ? opts.place?.(loc) : placeOf(loc) ?? opts.place?.(loc)) ?? null).filter((p): p is Place => !!p);
    if (!places.length) continue;
    const tk = titleKey(company, l.title, l.kind);
    if (foreignTitles.has(tk)) continue;
    const sameTitle = byTitle.get(tk);
    if (sameTitle) {
      touch(sameTitle, l, places);
      byUrl.set(urlKey(l.url), sameTitle);
      continue;
    }
    // The same posting listed under another title by a different tracker joins that row
    const uk = urlKey(l.url);
    const g: Group = groupByUrl.get(uk) ?? groups.get(tk) ?? { company, role, raws: [], places: new Map() };
    g.raws.push(l);
    for (const p of places) if (!g.places.has(p.city)) g.places.set(p.city, { place: p, url: l.url });
    if (!groupByUrl.has(uk)) groupByUrl.set(uk, g);
    if (![...groups.values()].includes(g)) groups.set(tk, g);
  }

  // Close and reopen
  let closed = 0;
  let reopened = 0;
  for (const a of db.applications) {
    if (seenActive.has(a.id)) {
      if (!a.active) (a.active = true, (a.closedAt = null), (a.closedReason = undefined), reopened++);
      continue;
    }
    if (!a.active) continue;
    const inactiveIn = seenInactive.get(a.id);
    if (inactiveIn) {
      a.active = false;
      a.closedAt = now;
      a.closedReason = `${inactiveIn} marks it as closed`;
      closed++;
      continue;
    }
    const trackerSources = a.sources.filter((s) => s !== "Manual (web)");
    if (trackerSources.length && trackerSources.every((s) => okSources.has(s))) {
      a.active = false;
      a.closedAt = now;
      a.closedReason = `No longer listed on ${trackerSources.join(", ")}`;
      closed++;
    }
  }

  // Create new rows
  const added: Application[] = [];
  const ids = new Set(db.applications.map((a) => a.id));
  for (const [, g] of groups) {
    const first = g.raws[0];
    const info = companies[g.company];
    const profile = profiles.get(g.company);
    const kind = first.kind;
    const locations = sortLocations([...g.places.values()].map(({ place, url }) => ({ city: place.city, region: place.region, url })));
    const visas = [...new Map(locations.map((l) => [l.region, { region: l.region, visa: visaFor({ city: l.city, region: l.region }, kind) }])).values()];
    const season = [...new Set(g.raws.map((r) => r.season).filter(Boolean))].join(", ");
    const elig = eligibilityFor(kind, locations.map((l) => l.region), first.title, season);
    const fit = fitFor(g.role, first.title);
    const ivType = interviewTypeFor(g.role) ?? (profile?.interview.prac && !profile.interview.lc ? "prac" : "lc");
    const iv = profile?.interview[ivType] ?? {
      confirmed: false,
      note: ivType === "lc" && info.sector === "Quant/Trading" ? 22 : DEFAULT_INTERVIEW_NOTE[ivType],
    };
    const difficulty = profile?.difficultyByRole.get(g.role) ?? profile?.difficulty ?? (info.prestige === "S" ? 5 : info.prestige === "A" ? 4 : 3);
    const cv = cvFor(g.role, info.sector, first.title);
    const score = scoreFor({ pay: info.pay, difficulty, fit, prestige: info.prestige, eligibility: elig.eligibility, region: locations[0].region, kind, visa: visas[0].visa });
    let id = createHash("sha1").update(titleKey(g.company, first.title, kind)).digest("hex").slice(0, 10);
    while (ids.has(id)) id = createHash("sha1").update(id).digest("hex").slice(0, 10);
    ids.add(id);
    // The earliest date any source gives, and which source that is (for its label)
    const dated = g.raws.filter((r) => r.postedAt).sort((x, y) => (x.postedAt! < y.postedAt! ? -1 : 1))[0];
    const postedAt = dated?.postedAt ?? null;
    const app: Application = {
      id,
      ...(opts.board && opts.board !== "global" ? { board: opts.board } : {}),
      company: g.company,
      title: first.title,
      offList: !info.onList,
      kind,
      role: g.role,
      sector: info.sector,
      season,
      urls: [...new Set(g.raws.map((r) => r.url))].slice(0, MAX_URLS),
      locations,
      moreLocations: false,
      postedAt,
      ...(dated ? { postedBy: dated.source } : {}),
      deadline: "Rolling",
      deadlineDate: null,
      pay: info.pay,
      difficulty,
      fit,
      prestige: info.prestige,
      priority: priorityFor(score, elig.eligibility, locations[0].region),
      score,
      eligibility: elig.eligibility,
      eligibilityNote: elig.note,
      visa: visas[0].visa,
      visas,
      interview: { type: ivType, confirmed: iv.confirmed, note: iv.note },
      cv,
      salary: g.raws.find((r) => r.salary)?.salary ?? "",
      note: "",
      sources: [...new Set(g.raws.map((r) => r.source))],
      preApplied: false,
      firstSeenAt: now,
      lastSeenAt: now,
      active: g.raws.some((r) => r.active),
      closedAt: null,
      sourceKeys: [...new Set(g.raws.map((r) => r.key))],
    };
    if (!app.active) continue;
    added.push(app);
  }

  const newCompanies = Object.values(companies).filter((c) => !db.companies[c.name] && added.some((a) => a.company === c.name));
  return { added, removed, newCompanies, updated, closed, reopened };
}
