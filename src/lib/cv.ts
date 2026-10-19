// Reads your two CVs (cv/quant.pdf and cv/swe.pdf, or the folder in CV_DIR) straight from the PDFs. Everything the board says about
// fit, experience, languages and graduation comes from here, so updating a PDF updates the board
// (cached by file modification time; nothing already fetched is thrown away).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GradDate } from "./grad";
import { findSkills } from "./skills";
import type { CvKind } from "./types";

export interface CvProject {
  name: string;
  summary: string;
  skills: string[];
}

export interface CvJob {
  title: string;
  company: string;
  from: string;
  to: string | null;
  months: number;
}

export interface CvProfile {
  kind: CvKind;
  file: string;
  hash: string;
  modifiedAt: string;
  ok: boolean;
  error?: string;
  skills: string[];
  projects: CvProject[];
  jobs: CvJob[];
  /** Months of work experience, overlapping periods counted once */
  experienceMonths: number;
  /** The same without internships ("non-internship professional experience") */
  fullTimeMonths: number;
  /** Months worked after your graduation date (what "N years post-graduation" asks for) */
  postGradMonths: number;
  languages: { name: string; level: "high" | "mid" | "low"; raw: string }[];
  graduation: GradDate | null;
}

/** Where each CV is, as shown to you */
export const CV_FILES: Record<CvKind, string> = {
  quant: path.join(process.env.CV_DIR ?? "cv", "quant.pdf"),
  swe: path.join(process.env.CV_DIR ?? "cv", "swe.pdf"),
};

/** The CV's file on disk: cv/ in the project unless CV_DIR says otherwise */
export function cvPath(kind: CvKind): string {
  if (process.env.CV_DIR) return path.resolve(process.env.CV_DIR, kind === "quant" ? "quant.pdf" : "swe.pdf");
  // Literal paths so Next.js does not trace the whole project
  return kind === "quant" ? path.join(process.cwd(), "cv", "quant.pdf") : path.join(process.cwd(), "cv", "swe.pdf");
}

/** Used when a PDF cannot be read: the board keeps working with what it knew. */
export const FALLBACK_GRADUATION: GradDate = { year: 2027, month: 3 };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const PERIOD_RE = new RegExp(String.raw`(${MONTH_RE}\s+\d{4})\s*[–—-]\s*(${MONTH_RE}\s+\d{4}|now|present|current|actualidad|hoy)\s*$`, "i");

function monthIndex(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (!m) return null;
  const i = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)));
  return i < 0 ? null : Number(m[2]) * 12 + i;
}

const INTERNSHIP = /\bintern(ship)?\b|trainee|working student|werkstudent|praktikum|pr[aá]cticas|becari/i;

/** Months covered by a set of [from, to] month spans, overlaps counted once. */
function unionMonths(spans: [number, number][]): number {
  let total = 0;
  let cur: [number, number] | null = null;
  for (const s of [...spans].sort((a, b) => a[0] - b[0])) {
    if (cur && s[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], s[1]);
    else {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [...s];
    }
  }
  return cur ? total + cur[1] - cur[0] + 1 : total;
}

const LANG_NAMES: Record<string, string> = {
  spanish: "Spanish", catalan: "Catalan", english: "English", italian: "Italian", french: "French", german: "German", portuguese: "Portuguese",
  dutch: "Dutch", chinese: "Chinese", mandarin: "Mandarin", japanese: "Japanese", korean: "Korean", russian: "Russian", arabic: "Arabic",
};

function levelOf(raw: string): "high" | "mid" | "low" {
  if (/native|nativ|c2|c1|fluent|bilingual|proficient/i.test(raw)) return "high";
  if (/b2|b1|conversational|intermediate|working/i.test(raw)) return "mid";
  return "low";
}

export function parseCv(text: string): Omit<CvProfile, "kind" | "file" | "hash" | "modifiedAt" | "ok"> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const isHeading = (l: string) => /^[A-ZÁÉÍÓÚÑ &/]{4,}$/.test(l);
  const sections: Record<string, string[]> = {};
  let current = "HEADER";
  for (const l of lines) {
    if (isHeading(l)) {
      current = l;
      sections[current] = [];
    } else (sections[current] ??= []).push(l);
  }
  const section = (re: RegExp) => Object.entries(sections).find(([k]) => re.test(k))?.[1] ?? [];

  // Jobs: "Title @ Company Month YYYY – Month YYYY|Now"
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const jobs: CvJob[] = [];
  for (const l of lines) {
    const p = l.match(PERIOD_RE);
    if (!p || !l.includes("@")) continue;
    const head = l.slice(0, p.index).trim();
    const [title, company] = head.split(/\s+@\s+/);
    const from = monthIndex(p[1]);
    const to = /now|present|current|actualidad|hoy/i.test(p[2]) ? nowIdx : monthIndex(p[2]);
    if (from == null || to == null) continue;
    jobs.push({ title: title?.trim() ?? head, company: company?.trim() ?? "", from: p[1], to: /now|present|current/i.test(p[2]) ? null : p[2], months: Math.max(1, to - from + 1) });
  }
  const spanOf = (j: CvJob): [number, number] => [monthIndex(j.from)!, j.to ? monthIndex(j.to)! : nowIdx];
  const experienceMonths = unionMonths(jobs.map(spanOf));
  const fullTimeMonths = unionMonths(jobs.filter((j) => !INTERNSHIP.test(j.title)).map(spanOf));

  // Projects: title lines (not bullets) inside PROJECTS, with their bullets
  const projects: CvProject[] = [];
  for (const l of section(/PROJECT/)) {
    const last = projects[projects.length - 1];
    if (/^[●•▪◦]/.test(l)) {
      if (last) last.summary = `${last.summary} ${l.replace(/^[●•▪◦]\s*/, "")}`.trim();
    } else if (/^[A-Z0-9]/.test(l) && /\s[–—|]\s/.test(l)) {
      projects.push({ name: l.split(/\s+[–—|]\s+/)[0].trim(), summary: "", skills: [] });
    } else if (last) {
      last.summary = `${last.summary} ${l}`.trim();
    }
  }
  for (const p of projects) p.skills = findSkills(`${p.name} ${p.summary}`, { implied: true });

  // Languages: "Spanish & Catalan (Native), English (C1), Italian (Conversational Level), French (Basic)"
  const languages: CvProfile["languages"] = [];
  for (const part of section(/LANGUAGE|IDIOMA/).join(" ").split(/,(?![^(]*\))/)) {
    const m = part.match(/^\s*([^()]+?)\s*\(([^)]+)\)/);
    if (!m) continue;
    for (const name of m[1].split(/\s*(?:&|\/|\band\b|\by\b)\s*/i)) {
      const key = name.trim().toLowerCase();
      if (key) languages.push({ name: LANG_NAMES[key] ?? name.trim(), level: levelOf(m[2]), raw: m[2].trim() });
    }
  }

  const g = text.match(new RegExp(String.raw`(?:expected )?graduation(?: date)?:?\s*(${MONTH_RE})?\s*(\d{4})`, "i"));
  const graduation: GradDate | null = g
    ? { year: Number(g[2]), month: g[1] ? MONTHS.findIndex((x) => x.startsWith(g[1].toLowerCase().slice(0, 3))) + 1 || 6 : 6 }
    : null;

  // Work after graduating: only the part of each job from the month after graduation
  const gradIdx = graduation ? graduation.year * 12 + graduation.month - 1 : null;
  const postGradMonths =
    gradIdx == null ? 0 : unionMonths(jobs.filter((j) => !INTERNSHIP.test(j.title)).map(spanOf).filter((sp) => sp[1] > gradIdx).map(([a, b]) => [Math.max(a, gradIdx + 1), b]));

  return { skills: findSkills(text, { implied: true }), projects, jobs, experienceMonths, fullTimeMonths, postGradMonths, languages, graduation };
}

// ---------- cached loading

const g = globalThis as unknown as { __cvCache?: Map<string, CvProfile> };
const cache = () => (g.__cvCache ??= new Map());

export async function loadCv(kind: CvKind): Promise<CvProfile> {
  const file = cvPath(kind);
  const empty = (error: string, hash = "", modifiedAt = ""): CvProfile => ({
    kind, file: CV_FILES[kind], hash, modifiedAt, ok: false, error, skills: [], projects: [], jobs: [], experienceMonths: 0, fullTimeMonths: 0, postGradMonths: 0, languages: [], graduation: null,
  });
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return empty(`${CV_FILES[kind]} not found`);
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  const hit = cache().get(key);
  if (hit) return hit;
  const bytes = await fs.readFile(file);
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  let profile: CvProfile;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    profile = { kind, file: CV_FILES[kind], hash, modifiedAt: stat.mtime.toISOString(), ok: true, ...parseCv(text) };
  } catch (e) {
    profile = empty(`Could not read the PDF: ${(e as Error).message}`, hash, stat.mtime.toISOString());
  }
  cache().set(key, profile);
  return profile;
}

export async function loadCvs(): Promise<Record<CvKind, CvProfile>> {
  const [quant, swe] = await Promise.all([loadCv("quant"), loadCv("swe")]);
  return { quant, swe };
}

export const graduationOf = (cvs: Record<CvKind, CvProfile>): GradDate => cvs.quant.graduation ?? cvs.swe.graduation ?? FALLBACK_GRADUATION;

/** You, as the offers' requirements are checked against: graduation date and months worked (from either CV). */
export interface Candidate {
  grad: GradDate;
  months: number;
  fullTimeMonths: number;
  postGradMonths: number;
  /** Languages on your CV with their level */
  languages: CvProfile["languages"];
}

export function candidateOf(cvs: Record<CvKind, CvProfile>): Candidate {
  const ok = [cvs.quant, cvs.swe].filter((c) => c.ok);
  const most = (f: (c: CvProfile) => number) => Math.max(0, ...ok.map(f));
  return {
    grad: graduationOf(cvs),
    months: most((c) => c.experienceMonths),
    fullTimeMonths: most((c) => c.fullTimeMonths),
    postGradMonths: most((c) => c.postGradMonths),
    languages: ok[0]?.languages ?? [],
  };
}
