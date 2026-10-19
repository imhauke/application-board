import type { Application, Kind, VisaCode } from "./types";

/**
 * Work visa guide for an EU citizen graduating in 2027.
 * Rough figures as of Oct 2026: always check the official website before deciding.
 */
export interface VisaInfo {
  code: VisaCode;
  label: string;
  long: string;
  /** ok = no paperwork, mid = the company handles it, bad = very hard from abroad */
  tone: "ok" | "mid" | "bad";
  intern: string;
  grad: string;
  who: string;
  timeline: string;
  cost: string;
  steps: string[];
  watch: string[];
  links: { label: string; url: string }[];
}

export const VISAS: Record<VisaCode, VisaInfo> = {
  eu: {
    code: "eu",
    label: "No visa",
    long: "EU citizen: free movement, no work permit needed beforehand.",
    tone: "ok",
    intern: "You can start with the signed contract; there is only some registration when you arrive.",
    grad: "Same as for internships: no visa or sponsorship. Your fastest and safest option.",
    who: "Nobody: you register when you arrive.",
    timeline: "Immediate. Registration happens in the first weeks.",
    cost: "None (at most small municipal fees).",
    steps: [
      "Sign the contract.",
      "Register with the city (Anmeldung in Germany, BSN in the Netherlands, PPS in Ireland…).",
      "Get the local tax or social security number to be paid.",
      "Carry your European Health Insurance Card until you are registered.",
    ],
    watch: ["Some \"EU\" offers are actually in the UK or Switzerland: check the exact city."],
    links: [{ label: "Your Europe: working in another EU country", url: "https://europa.eu/youreurope/citizens/work/work-abroad/index_en.htm" }],
  },
  uk: {
    code: "uk",
    label: "UK sponsor",
    long: "United Kingdom: since Brexit you need a visa sponsored by the company.",
    tone: "mid",
    intern:
      "Temporary Work – Government Authorised Exchange (GAE) visa. The company gets your Certificate of Sponsorship through an authorised \"umbrella body\". Up to 12 months.",
    grad:
      "Skilled Worker visa. The company needs a sponsor licence (quant firms, banks and big tech have one). Since Jul 2025 the general minimum salary is £41,700; as a \"new entrant\" (under 26 or a recent graduate) ~£33,400 is enough. SWE/quant salaries in London are above it.",
    who: "The company issues the Certificate of Sponsorship; you apply for the visa online.",
    timeline: "~3 weeks for a decision from outside the UK once you have the CoS. Apply at the earliest 3 months before starting.",
    cost: "Application ~£300 (GAE) or ~£800-900 (Skilled Worker, up to 3 years) + Immigration Health Surcharge ~£1,035/year. Many companies refund it: ask.",
    steps: [
      "Ask early in the process whether they sponsor a visa for this role.",
      "With the signed offer, the company assigns you the Certificate of Sponsorship (CoS).",
      "Apply online on gov.uk and prove your identity with the \"UK Immigration: ID Check\" app (EU passport).",
      "Pay the fee + Immigration Health Surcharge and receive the eVisa.",
    ],
    watch: [
      "Moving from an internship GAE to a graduate Skilled Worker visa usually means applying from outside the UK.",
      "The Graduate visa is only for people who studied at a UK university.",
    ],
    links: [
      { label: "GOV.UK: Government Authorised Exchange", url: "https://www.gov.uk/government-authorised-exchange" },
      { label: "GOV.UK: Skilled Worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
    ],
  },
  hk: {
    code: "hk",
    label: "HK visa",
    long: "Hong Kong: employment visa handled by the company (General Employment Policy).",
    tone: "mid",
    intern: "The company usually arranges an employment or \"training\" visa. Confirm with HR when you get the offer.",
    grad: "Employment visa under the General Employment Policy (GEP). You need an offer, the degree and a market salary; for quant and tech it is rarely a problem.",
    who: "The company files the application with Hong Kong's Immigration Department; you provide documents.",
    timeline: "~4-6 weeks once Immigration has all the documents.",
    cost: "Cheap: visa label ~HK$230. Usually paid by the company.",
    steps: [
      "Signed offer.",
      "You fill in your part of form ID 990A; the company fills in ID 990B.",
      "You provide your passport, degree (or a certificate that you are graduating) and CV.",
      "You receive the e-Visa and activate residence (HKID) on arrival.",
    ],
    watch: [
      "The Top Talent Pass (TTPS) only works with a degree from a closed list of top universities.",
      "The degree must be awarded before you start: graduating in spring fits summer/autumn start dates.",
    ],
    links: [{ label: "ImmD Hong Kong: General Employment Policy", url: "https://www.immd.gov.hk/eng/services/visas/GEP.html" }],
  },
  us_j1: {
    code: "us_j1",
    label: "J-1",
    long: "USA: J-1 exchange visa (Intern or Trainee), with a designated sponsor.",
    tone: "mid",
    intern:
      "J-1 Intern: valid if you are enrolled or graduated 12 months or less before starting: if you finish in spring 2027, a summer 2027 internship fits. Up to 12 months.",
    grad:
      "For graduates the J-1 route is Trainee: a degree + 1 year or more of relevant experience outside the US (previous work experience can count). Up to 18 months. Few companies use it for full-time roles; H-1B is the usual route.",
    who: "A sponsor designated by the State Department (the company works with one, e.g. Cultural Vistas or Intrax) issues the DS-2019.",
    timeline: "Allow 2-3 months between the sponsor and the consulate appointment.",
    cost: "SEVIS ~$220 + consular fee ~$185 (+ new 2025 fees). Many companies refund it.",
    steps: [
      "Signed offer: the company registers you with its sponsor.",
      "You receive the signed DS-2019 and DS-7002 training plan.",
      "You pay the SEVIS fee (I-901) and fill in the DS-160.",
      "Interview at the US consulate in your country of residence.",
      "You can enter at most 30 days before the start date.",
    ],
    watch: [
      "Two-year home residency rule (212(e)): it can apply depending on country and field; check it on the DS-2019.",
      "Many US summer internships require graduating in Dec 2027 or later: check the eligibility.",
    ],
    links: [
      { label: "J-1 Intern (State Department)", url: "https://j1visa.state.gov/programs/intern" },
      { label: "J-1 Trainee (State Department)", url: "https://j1visa.state.gov/programs/trainee" },
    ],
  },
  us_h1b: {
    code: "us_h1b",
    label: "H-1B",
    long: "USA: H-1B with a yearly lottery and a $100,000 fee for applicants outside the country.",
    tone: "bad",
    intern: "Not used for internships: the route there is J-1.",
    grad:
      "Registration in March, results at the end of March, start from October 1. The lottery now weighs salary level (higher salaries = better odds). Since Sep 2025 every new petition for someone outside the US carries a $100,000 payment: very few companies take it on for a new graduate.",
    who: "The company registers and files the petition with USCIS; you do the consular interview if selected.",
    timeline: "Yearly cycle: March (lottery) → April-June (petition) → October (start).",
    cost: "Paid by the company: registration and petition fees + $100,000 if you are outside the US.",
    steps: [
      "Ask openly whether they sponsor H-1B for graduates from outside the US.",
      "If they do: the company registers you in the March lottery.",
      "If selected: I-129 petition, then the visa at the consulate.",
    ],
    watch: [
      "The more realistic route: join the London, Dublin or Amsterdam office and ask for an L-1 transfer after 1 year at the company (common in quant and big tech).",
      "A longer alternative: a master's in the US (F-1 → OPT/STEM OPT); a change of status inside the country does not pay the $100,000 fee.",
    ],
    links: [{ label: "USCIS: H-1B", url: "https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations" }],
  },
  ca: {
    code: "ca",
    label: "CA permit",
    long: "Canada: work permit through IEC (a draw) or with an offer and an LMIA.",
    tone: "mid",
    intern: "IEC International Co-op: for internships that are part of your studies (you must stay enrolled during the internship).",
    grad:
      "IEC Working Holiday (open permit up to 12 months, ages 18-35, depending on your nationality) or Young Professionals (with an offer). Without IEC, the company needs an LMIA; for tech there is the Global Talent Stream (~2 weeks).",
    who: "You enter the IEC pool; with an LMIA the company handles it.",
    timeline: "Pool → invitation by draw → 20 days to submit → ~8 weeks of processing.",
    cost: "IEC ~CA$250-300 in total (participation + open permit).",
    steps: [
      "Create your IEC profile when the pools open (usually early in the year).",
      "Wait for an invitation (a draw); you have a few days to accept it.",
      "Submit the permit application with a police certificate and health insurance.",
      "You receive the letter of introduction and the permit is issued on entry.",
    ],
    watch: ["IEC quotas run out: sign up as soon as the season opens, even before you have an offer."],
    links: [{ label: "IRCC: International Experience Canada", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/iec.html" }],
  },
  asia: {
    code: "asia",
    label: "Asia visa",
    long: "Asia / Oceania: work visa sponsored by the company (depends on the country).",
    tone: "mid",
    intern: "Depends on the country; Singapore has a specific pass for internships. See the notes per city.",
    grad: "Work visa handled by the company. Salary or experience requirements depend on the country: see the notes per city.",
    who: "The company, almost always.",
    timeline: "From 3 weeks (Singapore) to 2-3 months (Japan, China).",
    cost: "Usually paid by the company.",
    steps: ["Signed offer.", "The company files the application in the country.", "You receive the approval and get the visa stamped (at a consulate or on arrival)."],
    watch: ["Ask whether the offer includes relocation help and visa paperwork."],
    links: [{ label: "Singapore (MOM): Employment Pass", url: "https://www.mom.gov.sg/passes-and-permits/employment-pass" }],
  },
};

export const COUNTRY_NOTES: { match: RegExp; country: string; note: string }[] = [
  {
    match: /z[üu]rich|geneva|gen[eè]ve|zug|basel|bern|lausanne/i,
    country: "Switzerland",
    note:
      "EU-Switzerland free movement: L permit (contract under 1 year, typical for internships) or B permit (1 year or more). You register with the municipality within 14 days of arriving and the canton issues it with your contract.",
  },
  {
    match: /singapore/i,
    country: "Singapore",
    note:
      "Employment Pass: minimum salary S$5,600/month (S$6,200 in finance) and COMPASS points. For internships, the Training Employment Pass (salary of S$3,000 or more, up to 3 months). The company handles it in ~3 weeks.",
  },
  {
    match: /shanghai|beijing|shenzhen/i,
    country: "China",
    note: "Z visa + work permit for foreigners. The rules usually ask for 2 years of experience, with exceptions for recent graduates: confirm with HR.",
  },
  {
    match: /taipei|taiwan/i,
    country: "Taiwan",
    note: "Work permit requested by the company: with a bachelor's degree they usually ask for 2 years of experience and a minimum salary (~NT$48,000/month). Ask if you are close.",
  },
  {
    match: /sydney|melbourne/i,
    country: "Australia",
    note: "Skills in Demand visa (subclass 482, replacing the TSS) sponsored by the company, or Work and Holiday (462) if your age and nationality allow it (capped).",
  },
  {
    match: /bengaluru|bangalore|hyderabad|gurgaon|gurugram|mumbai|india/i,
    country: "India",
    note: "Employment Visa sponsored by the company; it requires a minimum salary of ~$16,250/year, which these roles meet.",
  },
  {
    match: /tokyo/i,
    country: "Japan",
    note: "\"Engineer/Specialist in Humanities/International Services\" visa: the company requests the Certificate of Eligibility (1-3 months) and then you get the visa stamped at the consulate.",
  },
  { match: /seoul/i, country: "Korea", note: "E-7 (professional) visa sponsored by the company." },
];

export function countryNote(city: string) {
  return COUNTRY_NOTES.find((c) => c.match.test(city)) ?? null;
}

export interface VisaGroup {
  info: VisaInfo;
  cities: string[];
  countryNotes: { country: string; note: string; cities: string[] }[];
}

/** Groups an offer's cities by the visa you need in each. */
export function visaGroups(app: Application): VisaGroup[] {
  const byCode = new Map<VisaCode, VisaGroup>();
  const order: VisaCode[] = [];
  for (const loc of app.locations) {
    const code = app.visas.find((v) => v.region === loc.region)?.visa ?? app.visa;
    if (!byCode.has(code)) {
      byCode.set(code, { info: VISAS[code], cities: [], countryNotes: [] });
      order.push(code);
    }
    const g = byCode.get(code)!;
    g.cities.push(loc.city);
    const cn = countryNote(loc.city);
    if (cn) {
      const existing = g.countryNotes.find((n) => n.country === cn.country);
      if (existing) existing.cities.push(loc.city);
      else g.countryNotes.push({ country: cn.country, note: cn.note, cities: [loc.city] });
    }
  }
  const rank = { ok: 0, mid: 1, bad: 2 } as const;
  return order.map((c) => byCode.get(c)!).sort((a, b) => rank[a.info.tone] - rank[b.info.tone]);
}

export function visaForKind(info: VisaInfo, kind: Kind) {
  return kind === "intern" ? info.intern : info.grad;
}

/** An offer's distinct visa codes, from the easiest to the hardest. */
export function visaCodes(app: Application): VisaCode[] {
  return visaGroups(app).map((g) => g.info.code);
}
