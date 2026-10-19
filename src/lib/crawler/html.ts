// Minimal HTML → text conversion that keeps block structure (one line per paragraph / list item),
// which the extractors rely on to find sections like "Requirements".

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const BLOCK = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|table|dt|dd|blockquote)\b[^>]*>/gi;

/** Converts an HTML fragment to trimmed, non-empty text lines. List items are prefixed with "• ". */
export function htmlToLines(html: string): string[] {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<li\b[^>]*>/gi, "\n• ");
  s = s.replace(BLOCK, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ​]+/g, " ").trim())
    .filter((l) => l && l !== "•");
}

export function htmlToText(html: string): string {
  return htmlToLines(html).join("\n");
}

/** Extracts every JSON-LD block from a page. */
export function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) out.push(...v);
      else if (v && typeof v === "object" && Array.isArray((v as { "@graph"?: unknown[] })["@graph"])) out.push(...(v as { "@graph": unknown[] })["@graph"]);
      else out.push(v);
    } catch {
      // ignore malformed blocks
    }
  }
  return out;
}
