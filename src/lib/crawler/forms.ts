// Application forms, where the ATS publishes them: whether there is a cover letter field (required,
// optional or none at all) and the questions to answer in writing. Greenhouse comes with the posting
// itself; Ashby, Lever and Workable take one more request. Other ATS (Workday, iCIMS, TikTok…) only
// show the form after you sign in, so for them nothing is said.

import type { ApplicationForm } from "../types";
import { decodeEntities } from "./html";
import { httpGet, httpJson } from "./http";

interface Field {
  label: string;
  required: boolean;
  kind: "file" | "long" | "text" | "choice" | "other";
  /** The ATS's own name for the field ("cover_letter") */
  id?: string;
  /** Placeholder text ("Add a cover letter or anything else you want to share.") */
  hint?: string;
}

const COVER =
  /\bcover(ing)?[\s-]*letter\b|\bmotivation(al)?[\s-]*letter\b|\bletter of motivation\b|motivationsschreiben|anschreiben|lettre de motivation|lettera (di presentazione|motivazionale)|carta de (presentaci[oó]n|motivaci[oó]n)/i;
/** A box for anything you want to add (where a cover letter could go, though the form does not ask for one) */
const FREE_TEXT =
  /^(additional (information|info|comments?|details)|anything else|is there anything else|other information|comments?)\b|note you want to share|weitere (informationen|angaben)|zus[äa]tzliche (informationen|angaben)|informations? compl[ée]mentaires?|bemerkungen/i;
/** Questions meant to catch bots and AI-written answers: a person is asked to leave them blank */
const TRAP = /if you('re| are) (a )?human|leave (this|it|the) (line|field|box|question )?(blank|empty)|if you('re| are) (an? )?(ai|llm|bot|language model)|ignore (all )?(previous|prior) instructions/i;
/** Contact details, links and follow-ups: not questions you write an answer to */
const SKIP =
  /linkedin|github|website|portfolio|\burl\b|twitter|pronoun|pronunciation|preferred (first )?name|^name\b|full name|phone|e-?mail|address|\bcity\b|zip|postal|how did you (hear|learn|find)|where did you (hear|learn|find)|referr|^if (you answered|other|yes|so)\b|^please specify|accommodat|disabilit|adjustments?\b/i;
/** A field is a written answer when it asks an open question */
const OPEN = /^(why|what|how|describe|tell|share|explain|in (a few|one|two|\d+) (sentences|words)|give (us )?an example|please (describe|explain|tell|share|provide|give|list|summari[sz]e))\b/i;
/** Questions that ask for an essay whatever their topic ("Tell us about a project you built at university") */
const ESSAY = /^(why|describe|tell|share|explain|in (a few|one|two|\d+) (sentences|words)|give (us )?an example|please (describe|explain|tell|share|summari[sz]e))\b/i;
/** …the rest, only when they do not ask for a fact (salary, dates, visa, school, how many years) */
const FACT =
  /salary|compensation|visa|sponsor|authori[sz]ed|relocat|notice period|start date|available to (start|begin)|graduat|gpa|university|school|degree|major|minor|\byear\b|\bdate\b|deadline|(pending|other|competing|current) offers?|offers? deadline|clearance|citizen|located|location|country|\bstate\b|^how (many|much|long)\b/i;

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/[✱*]\s*$/, "").replace(/\s+/g, " ").trim();

export function buildForm(from: string, fields: Field[]): ApplicationForm {
  const isCover = (f: Field) => /^cover_?letter/i.test(f.id ?? "") || (f.kind !== "choice" && f.kind !== "other" && COVER.test(f.label));
  const covers = fields.filter(isCover);
  // Lever's own "Additional information" box says it is for a cover letter
  const hinted = fields.find((f) => !isCover(f) && f.kind === "long" && f.hint && COVER.test(f.hint));
  const free = fields.find((f) => !isCover(f) && f.kind === "long" && FREE_TEXT.test(f.label));
  const questions: ApplicationForm["questions"] = [];
  for (const f of fields) {
    if (isCover(f) || f === hinted || f === free || questions.some((q) => q.label === f.label)) continue;
    const trap = TRAP.test(f.label);
    // A box for a long answer that asks something ("School Major:" is a fact); a one-line one only with an open question
    const asks = OPEN.test(f.label) || (f.kind === "long" && (/\?\s*(\(.*\))?$/.test(f.label) || f.label.length >= 40));
    const fact = !ESSAY.test(f.label) && FACT.test(f.label);
    const written = (f.kind === "long" || f.kind === "text") && f.label.length >= 15 && asks && !SKIP.test(f.label) && !fact;
    if (trap || written) questions.push({ label: f.label.slice(0, 300), required: f.required, ...(trap ? { trap: true } : {}) });
  }
  return {
    from,
    coverLetter: covers.length ? (covers.some((f) => f.required) ? "required" : "optional") : hinted ? "optional" : "none",
    ...(covers.length ? { coverField: covers[0].label } : hinted ? { coverField: hinted.label } : free ? { freeText: free.label } : {}),
    questions: questions.slice(0, 12),
  };
}

// ---------- Greenhouse (the posting's questions, from the same API call)

export interface GreenhouseQuestion {
  label: string;
  required: boolean;
  fields: { name: string; type: string }[];
}

export function greenhouseForm(questions: GreenhouseQuestion[] | undefined): ApplicationForm | undefined {
  if (!questions?.length) return undefined;
  const kindOf = (types: string[]): Field["kind"] =>
    types.includes("input_file") ? "file" : types.includes("textarea") ? "long" : types.includes("input_text") ? "text" : types.some((t) => t.startsWith("multi_value")) ? "choice" : "other";
  return buildForm(
    "Greenhouse",
    questions.map((q) => ({ label: clean(q.label), required: !!q.required, kind: kindOf(q.fields.map((f) => f.type)), id: q.fields[0]?.name })),
  );
}

// ---------- Ashby (its job board's GraphQL API)

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    applicationForm { sections { fieldEntries { field isRequired } } }
  }
}`;

export async function ashbyForm(org: string, id: string): Promise<ApplicationForm | undefined> {
  const r = await httpJson<{
    data?: { jobPosting?: { applicationForm?: { sections: { fieldEntries: { field: { title?: string; type?: string; path?: string }; isRequired: boolean }[] }[] } } };
  }>("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: org, jobPostingId: id }, query: ASHBY_QUERY }),
  });
  const sections = r?.data?.jobPosting?.applicationForm?.sections;
  if (!sections) return undefined;
  const KIND: Record<string, Field["kind"]> = { LongText: "long", String: "text", File: "file", Boolean: "choice", ValueSelect: "choice", MultiValueSelect: "choice" };
  return buildForm(
    "Ashby",
    sections.flatMap((s) => s.fieldEntries.map((e) => ({ label: clean(e.field.title ?? ""), required: e.isRequired, kind: KIND[e.field.type ?? ""] ?? "other", id: e.field.path }))),
  );
}

// ---------- Lever (the apply page's HTML form)

export async function leverForm(host: string, company: string, id: string): Promise<ApplicationForm | undefined> {
  const res = await httpGet(`https://${host}/${company}/${id}/apply`).catch(() => null);
  if (!res || res.status !== 200) return undefined;
  const start = res.text.indexOf("<form");
  if (start < 0) return undefined;
  const end = res.text.indexOf("</form>", start);
  const form = res.text.slice(start, end > 0 ? end : undefined);
  const fields: Field[] = [];
  for (const block of form.split('<li class="application-question').slice(1)) {
    // Up to the next section ("Additional information", the EEO survey): choices have <li>s of their own
    const next = block.indexOf('<div class="section');
    const li = next > 0 ? block.slice(0, next) : block;
    const label = li.match(/<div class="application-label[^"]*">([\s\S]*?)<\/div>\s*(?:<\/div>\s*)?<div class="application-field/)?.[1] ?? li.match(/<div class="text">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const field = li.slice(li.indexOf('class="application-field'));
    const kind: Field["kind"] = /<textarea/.test(field) ? "long" : /type="file"|resume-upload/.test(field) ? "file" : /<select|type="radio"|type="checkbox"/.test(field) ? "choice" : /type="text"/.test(field) ? "text" : "other";
    const required = /class="required"/.test(label) || /\brequired\b/.test(field.slice(0, 600));
    fields.push({ label: clean(label), required, kind, id: field.match(/name="([^"]+)"/)?.[1] });
  }
  // The standard "Additional information" box (name="comments") sits outside the question list
  const comments = form.match(/<textarea[^>]*name="comments"[^>]*>/)?.[0];
  if (comments) fields.push({ label: "Additional information", required: /\brequired\b/.test(comments), kind: "long", id: "comments", hint: decodeEntities(comments.match(/placeholder="([^"]*)"/)?.[1] ?? "") });
  return fields.length ? buildForm("Lever", fields.filter((f) => f.label)) : undefined;
}

// ---------- Workable (its public form API)

export async function workableForm(shortcode: string): Promise<ApplicationForm | undefined> {
  const sections = await httpJson<{ fields?: { id: string; label?: string; required?: boolean; type?: string }[] }[]>(`https://apply.workable.com/api/v1/jobs/${shortcode}/form`);
  if (!Array.isArray(sections)) return undefined;
  const KIND: Record<string, Field["kind"]> = { paragraph: "long", text: "text", file: "file", boolean: "choice", dropdown: "choice", multiple: "choice" };
  return buildForm(
    "Workable",
    sections
      .flatMap((s) => s.fields ?? [])
      // Profile fields, not questions
      .filter((f) => !["summary", "headline", "avatar"].includes(f.id))
      .map((f) => ({ label: clean(f.label ?? ""), required: !!f.required, kind: KIND[f.type ?? ""] ?? "other", id: f.id })),
  );
}
