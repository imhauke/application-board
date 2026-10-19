// What the offer page copies: everything the board knows about an offer and its company, as Markdown
// (to paste into a chat, your notes or an email) or as JSON (for other tools). Client-safe.

export type CtxValue = string | string[];
/** A "label: value" line, or a paragraph / list when it has no label */
export interface CtxItem {
  k?: string;
  v: CtxValue;
}
export interface CtxSection {
  id: string;
  title: string;
  items: CtxItem[];
}

export interface OfferContext {
  /** "Company — Title" */
  heading: string;
  /** Board path of the offer ("/offers/abc"), made absolute in the browser */
  path: string;
  sections: CtxSection[];
  /** Your graduation, experience, languages and skills (included on request) */
  profile: CtxSection;
  /** The posting's full text, when it was read */
  text: string | null;
}

export interface ContextOptions {
  text: boolean;
  tracking: boolean;
  profile: boolean;
  format: "md" | "json";
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = { text: true, tracking: true, profile: false, format: "md" };

const filled = (v: CtxValue) => (Array.isArray(v) ? v.length > 0 : v.trim() !== "");

function markdown(s: CtxSection): string[] {
  const out = ["", `## ${s.title}`];
  for (const { k, v } of s.items.filter((i) => filled(i.v))) {
    if (k && Array.isArray(v)) out.push(`- **${k}:**`, ...v.map((x) => `  - ${x}`));
    else if (k) out.push(`- **${k}:** ${v}`);
    else if (Array.isArray(v)) out.push(...v.map((x) => `- ${x}`));
    else out.push(v);
  }
  return out;
}

function json(s: CtxSection): Record<string, CtxValue> {
  const out: Record<string, CtxValue> = {};
  const loose: string[] = [];
  for (const { k, v } of s.items.filter((i) => filled(i.v))) {
    if (k) out[k] = v;
    else loose.push(...(Array.isArray(v) ? v : [v]));
  }
  if (loose.length) out.Notes = loose;
  return out;
}

/** The text to copy. `tracking` is your live status and notes on this page; `origin` makes the board link absolute. */
export function renderContext(ctx: OfferContext, o: ContextOptions, tracking: CtxSection | null, origin = ""): string {
  const link: CtxSection = { id: "board", title: "On the board", items: [{ k: "Offer page", v: `${origin}${ctx.path}` }] };
  const sections = [...ctx.sections, ...(o.tracking && tracking ? [tracking] : []), ...(o.profile ? [ctx.profile] : []), link];
  const text = o.text ? ctx.text : null;
  if (o.format === "json") {
    const out: Record<string, unknown> = { title: ctx.heading };
    for (const s of sections) out[s.title] = json(s);
    if (text) out["Full posting text"] = text;
    return JSON.stringify(out, null, 2);
  }
  const md = [`# ${ctx.heading}`, ...sections.flatMap(markdown)];
  if (text) md.push("", "## Full posting text", "", text);
  return md.join("\n");
}
