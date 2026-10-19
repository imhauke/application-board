// Which CV to send. Your two CVs share most of their content and differ in one project, so the
// choice is which of those projects argues better for this role:
//
//   1. What each project shows, read from the PDFs: a service running in production (deployed,
//      containerised, CI/CD, open source, real users) or low-level depth (compiler, parser, code
//      generation, assembly). If you swap a project in a PDF, the choice follows.
//   2. What the role is (role, title): reliability, infrastructure, platform, "systems" in the
//      operations sense, backend, product and applied AI value a live service; compilers,
//      languages, kernels, embedded and low-latency trading systems value low-level depth.
//   3. Above all, what the posting itself asks for: each signal it mentions adds to one side.

import type { CvProfile } from "./cv";
import type { Application, CvKind, PostingDetails } from "./types";

type Archetype = "production" | "lowlevel";

export interface CvChoice {
  kind: CvKind;
  /** The project that makes the difference (only in this CV) */
  project: string;
  other: { kind: CvKind; project: string };
  score: Record<CvKind, number>;
  /** Why, in words (role first, then the posting) */
  reasons: string[];
  /** Words of the posting that pushed towards each CV */
  signals: Record<CvKind, string[]>;
  /** The posting tipped it against what the role alone would suggest */
  byPosting: boolean;
  margin: "clear" | "close";
}

const PRODUCTION_SIGNALS: [string, RegExp][] = [
  ["production", /\bproduction\b|\blive (systems?|services?|traffic)\b/i],
  ["reliability / SRE", /reliab|\bsre\b|uptime|availability|on[- ]call|incident|post[- ]?mortem|\bslos?\b|\bslas?\b/i],
  ["observability", /monitor|observab|alerting|grafana|prometheus|datadog|logging|tracing/i],
  ["containers", /docker|container|kubernetes|\bk8s\b|\bhelm\b/i],
  ["CI/CD", /ci\/cd|continuous (integration|delivery|deployment)|github actions|jenkins|gitlab ci|deployment pipeline/i],
  ["cloud", /\baws\b|\bgcp\b|google cloud|azure|\bcloud\b/i],
  ["infrastructure as code", /terraform|ansible|infrastructure[- ]as[- ]code|pulumi|puppet|chef\b/i],
  // ("backend" of a compiler is code generation, not web services)
  ["backend / APIs", /(?<!(llvm|compiler|gpu|codegen|code generation) )back[- ]?end|\bapis?\b|\brest(ful)?\b|microservice|\bgrpc\b|distributed services/i],
  ["web / full-stack", /full[- ]?stack|front[- ]?end|\breact\b|typescript|javascript|\bweb\b/i],
  ["Python", /\bpython\b|fastapi|django|flask/i],
  ["databases", /postgres|\bsql\b|database|mysql|redis|mongodb/i],
  ["applied AI", /\bllms?\b|\brag\b|embedding|vector (search|database|db)|generative|gen ?ai|machine learning|\bml\b/i],
  ["open source", /open[- ]source/i],
  ["product and users", /\bproduct\b|customer[- ]facing|user[- ]facing|end users/i],
  ["Linux / systems", /\blinux\b|\bunix\b|\bbash\b|shell script|system administration|sysadmin|networking|tcp\/ip|\bdns\b/i],
];

const LOWLEVEL_SIGNALS: [string, RegExp][] = [
  ["compilers", /compiler|\bllvm\b|\bmlir\b|\bgcc\b|\bclang\b|code ?gen(eration)?|\bjit\b|interpreter|\bparser\b|\blexer\b|bytecode/i],
  ["programming languages", /programming languages|type systems?|static analysis|formal (methods|verification)|\bocaml\b|\bhaskell\b|functional programming/i],
  ["low level", /assembly|\bx86\b|\barm64\b|\bmips\b|risc-?v|instruction set|memory management|garbage collect/i],
  ["OS / kernel / embedded", /\bkernel\b|operating systems?|\bos internals\b|\bdrivers?\b|firmware|embedded|\brtos\b|bare[- ]metal/i],
  ["C / C++ / Rust", /c\+\+|\bc\/c\+\+|\brust\b|\bc programming\b/i],
  ["performance / latency", /performance (optimi|engineering|critical)|low[- ]latency|latency[- ]sensitive|\bsimd\b|vectori[sz]|profiling|cache[- ]efficient/i],
  ["trading systems", /\bhft\b|high[- ]frequency|trading systems|market data|order book|exchange connectivity/i],
  ["GPU / HPC", /\bcuda\b|gpu kernels?|\bhpc\b|high[- ]performance computing|\bmpi\b/i],
];

const PRODUCTION_PROJECT = /deploy|production|open[- ]source|\blive\b|users|containeri[sz]|kubernetes|ci\/cd|monitor/i;
const LOWLEVEL_PROJECT = /compiler|interpreter|parser|code generation|assembly|\bmips\b|\bx86\b|kernel|operating system|bytecode|virtual machine/i;

/** What a project shows: a live service, low-level depth, or both. */
function archetypes(p: { summary: string; skills: string[] }): Set<Archetype> {
  const out = new Set<Archetype>();
  if (PRODUCTION_PROJECT.test(p.summary) || p.skills.some((s) => /Docker|CI\/CD|Cloud/.test(s))) out.add("production");
  if (LOWLEVEL_PROJECT.test(p.summary) || p.skills.includes("Compilers")) out.add("lowlevel");
  return out;
}

/** Projects only one of the CVs has (what actually differs between them). */
function distinctive(cvs: Record<CvKind, CvProfile>, kind: CvKind) {
  const other = cvs[kind === "quant" ? "swe" : "quant"];
  const names = new Set(other.projects.map((p) => p.name));
  return cvs[kind].projects.filter((p) => !names.has(p.name));
}

/** Low-level work named in the title: it decides whatever the role category */
const LOWLEVEL_TITLE = /compiler|\bllvm\b|kernel|embedded|firmware|driver|toolchain|programming language|runtime|low[- ]latency|\bhpc\b|\bgpu\b|c\+\+|trading systems|\bhft\b/i;
const PRODUCTION_TITLE =
  /site reliability|\bsre\b|reliab|devops|infra|platform|cloud|production|operations|systems? engineer|systems? administrator|\bit\b|network|security|(?<!(llvm|compiler|gpu) )back[- ]?end|full[- ]?stack|front[- ]?end|web|product|mobile|\bapi\b|data engineer|machine learning|\bml\b|\bai\b|\bllm/i;

/** What the role alone suggests, before reading the posting (points for each archetype and why). */
function rolePrior(app: Pick<Application, "role" | "title" | "sector">): { production: number; lowlevel: number; why: string } {
  const t = app.title;
  const low = LOWLEVEL_TITLE.test(t);
  const prod = PRODUCTION_TITLE.test(t);
  if (low && app.role !== "Quant Dev/SWE" && app.role !== "SRE/Infra")
    return { production: 0, lowlevel: 3, why: "A low-level role (compilers, kernel, embedded, GPU or C++): the low-level project is the closest." };
  switch (app.role) {
    case "SRE/Infra":
      return { production: 3, lowlevel: low ? 1 : 0, why: "A reliability or infrastructure role: a real service in production counts more than the low-level project." };
    case "AI/ML/Data Eng":
      return { production: 2, lowlevel: 0, why: "Applied AI or data: a deployed product that uses data or AI counts more." };
    case "Data Science":
      return { production: 1, lowlevel: 0, why: "Data science: a product built on data weighs more than the low-level project." };
    case "Quant Dev/SWE":
      return prod && !low
        ? { production: 2, lowlevel: 1, why: "Infrastructure or platform at a quant firm: running a service in production counts more." }
        : { production: 0, lowlevel: 2, why: "Development at a quant firm (C++, trading systems): the low-level project shows the fundamentals better." };
    case "Quant Research":
    case "Quant Trading":
      return { production: 0, lowlevel: 2, why: "Research or trading at a quant firm: the low-level project shows more CS rigour (that is what the Quant CV is for)." };
    default:
      if (low && !prod) return { production: 0, lowlevel: 2, why: "Low-level software (compilers, kernel, performance): the low-level project is the closest." };
      if (/systems?\b/i.test(t) && !low)
        return { production: 2, lowlevel: 0, why: "A systems role: having shipped and run a service in production counts more." };
      return prod
        ? { production: 2, lowlevel: 0, why: "Backend, product or platform: a real service in production counts more." }
        : { production: 1, lowlevel: 0, why: "General SWE: a product in production says more about the daily work than the low-level project." };
  }
}

/** The posting's words, without the full text (titles, requirements, nice-to-haves, skills it names). */
function postingText(app: Pick<Application, "title">, p: PostingDetails | null | undefined): string {
  if (!p) return app.title;
  return [app.title, ...(p.requirements ?? []), ...(p.niceToHave ?? []), ...(p.skills?.found ?? [])].join("\n");
}

export function chooseCv(app: Pick<Application, "role" | "title" | "sector">, posting: PostingDetails | null | undefined, cvs: Record<CvKind, CvProfile>): CvChoice {
  const proj: Record<CvKind, { name: string; kinds: Set<Archetype> }> = { quant: { name: "", kinds: new Set() }, swe: { name: "", kinds: new Set() } };
  for (const kind of ["quant", "swe"] as CvKind[]) {
    const ps = distinctive(cvs, kind);
    proj[kind] = { name: ps.map((p) => p.name).join(" + ") || (kind === "quant" ? "Low-level project" : "Production project"), kinds: new Set(ps.flatMap((p) => [...archetypes(p)])) };
  }
  // Which CV carries each archetype (by default SWE = production, Quant = low level)
  const carrier = (a: Archetype): CvKind =>
    proj.swe.kinds.has(a) && !proj.quant.kinds.has(a) ? "swe" : proj.quant.kinds.has(a) && !proj.swe.kinds.has(a) ? "quant" : a === "production" ? "swe" : "quant";

  const prior = rolePrior(app);
  const score: Record<CvKind, number> = { quant: 0, swe: 0 };
  score[carrier("production")] += prior.production;
  score[carrier("lowlevel")] += prior.lowlevel;
  const priorKind: CvKind = score.swe >= score.quant ? "swe" : "quant";

  const text = postingText(app, posting);
  const signals: Record<CvKind, string[]> = { quant: [], swe: [] };
  for (const [label, re] of PRODUCTION_SIGNALS) if (re.test(text)) signals[carrier("production")].push(label);
  for (const [label, re] of LOWLEVEL_SIGNALS) if (re.test(text)) signals[carrier("lowlevel")].push(label);
  // Each signal counts, up to five per side, so a long posting does not drown the role. In research and
  // trading nearly every posting mentions Python or machine learning, so those count less there.
  const quantRole = app.role === "Quant Research" || app.role === "Quant Trading";
  for (const k of ["quant", "swe"] as CvKind[]) {
    const cap = quantRole && k === carrier("production") ? 2 : 5;
    score[k] += Math.min(cap, signals[k].length) * (posting ? 1 : 0);
  }

  // Ties: what the role suggests; with no lean either way, the live service
  const kind: CvKind = score.swe === score.quant ? (prior.production === prior.lowlevel ? carrier("production") : priorKind) : score.swe > score.quant ? "swe" : "quant";
  const other: CvKind = kind === "swe" ? "quant" : "swe";
  const reasons = [prior.why];
  if (signals[kind].length) reasons.push(`The posting asks for ${signals[kind].slice(0, 5).join(", ")}: that goes with ${proj[kind].name}.`);
  if (signals[other].length) reasons.push(`It also asks for ${signals[other].slice(0, 3).join(", ")}, closer to ${proj[other].name}.`);
  return {
    kind,
    project: proj[kind].name,
    other: { kind: other, project: proj[other].name },
    score,
    reasons,
    signals,
    byPosting: kind !== priorKind,
    margin: Math.abs(score.swe - score.quant) >= 2 ? "clear" : "close",
  };
}
