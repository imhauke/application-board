import { Check, CircleAlert, ExternalLink, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { BackToBoard, CopyContext, OfferActions, PolicyPanel, SeenOnVisit, TrackingPanel, TrackingProvider, TrashBanner } from "@/components/OfferPanels";
import { PayBadge } from "@/components/ui";
import VisaPanel from "@/components/VisaPanel";
import { compFor, compLabel, eurEquivalent, marketOf, money } from "@/lib/comp";
import { CV_INFO, ELIGIBILITY_LABEL, GONE_REASON, INTERVIEW_LABEL, KIND_LABEL, PREFERRED_REGIONS, ROLE_LABEL, STATUS_OPTIONS } from "@/lib/constants";
import { normalizePosting } from "@/lib/crawler/extract";
import { priorityFor, scoreFor } from "@/lib/crawler/classify";
import { candidateOf, loadCvs } from "@/lib/cv";
import { trackerName, webDateOf } from "@/lib/board";
import { getOfferName, loadPostings, newSince, postingText, readDb } from "@/lib/db";
import { isNew } from "@/lib/filters";
import { assessFit, eligibilityOf, experienceTerms } from "@/lib/fit";
import { fmtDate, isStale, longDate, publishedOf } from "@/lib/format";
import { blockedOffers, crossTrack, hardRuleFor, ruleSummary } from "@/lib/limits";
import type { OfferContext } from "@/lib/offerContext";
import type { ApplicationForm, Status, VisaCode } from "@/lib/types";
import { VISAS } from "@/lib/visa";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<number, string> = {
  5: "level 5 of 5 (top quant and AI)",
  4: "level 4 of 5 (big tech and top startups)",
  3: "level 3 of 5 (banking and solid tech)",
  2: "level 2 of 5",
  1: "level 1 of 5",
};
const MARKET_LABEL: Record<string, string> = {
  US: "the US", UK: "the UK", CH: "Switzerland", EU: "Europe", HK: "Hong Kong", CA: "Canada", SG: "Singapore", AU: "Australia", ASIA: "Asia",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COVER_LABEL: Record<ApplicationForm["coverLetter"], string> = { required: "Cover letter required", optional: "Cover letter optional", none: "No cover letter option" };
const PAY_ORIGIN = { posted: "published in the posting", tracker: "not in the posting", estimate: "the posting gives no salary" } as const;
/** ATS whose form only shows once you start applying */
const FORM_ATS: [RegExp, string][] = [
  [/^workday/, "Workday"], [/^eightfold/, "Eightfold"], [/^smartrecruiters/, "SmartRecruiters"], [/^apple/, "Apple"], [/^oracle/, "Oracle"],
];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await getOfferName(id);
  return { title: app ? `${app.company} · ${app.title}` : "Offer" };
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [db, cvs] = await Promise.all([readDb({ postings: false }), loadCvs()]);
  const app = db.applications.find((a) => a.id === id);
  if (!app) notFound();
  // Only this company's postings: this offer and its siblings (and this one's full text, for copying)
  const [postings, fullText] = await Promise.all([loadPostings({ company: app.company }), postingText(app.id)]);
  db.postings = postings;

  const posting = normalizePosting(db.postings[app.id]);
  const company = db.companies[app.company];
  const track = db.tracking[app.id];
  const me = candidateOf(cvs);
  const comp = compFor(app, posting);
  const fit = assessFit(app, posting, cvs);
  const elig = eligibilityOf(app, db.reference.eligibilityNotes[app.eligibilityNote], posting, me);
  const cv = CV_INFO[fit.cvBest];
  const cvProfile = cvs[fit.cvBest];
  const firstVisa = VISAS[app.visas.find((v) => v.region === app.locations[0]?.region)?.visa ?? app.visa];
  const noVisaCities = app.locations.filter((l) => app.visas.find((v) => v.region === l.region)?.visa === "eu").map((l) => l.city);
  const limit = hardRuleFor(company?.policy, app.kind);
  const region = app.locations[0]?.region ?? "USA (other)";
  const score = scoreFor({ pay: app.pay, difficulty: app.difficulty, fit: fit.fit, prestige: app.prestige, eligibility: elig.value, region, kind: app.kind, visa: firstVisa.code });
  const priority = app.preApplied ? "X" : priorityFor(score, elig.value, region);
  const active = app.active && !posting?.gone;
  const expTerms = experienceTerms(posting?.experienceReq);
  const closedReason = app.active && posting?.gone ? GONE_REASON : app.closedReason;

  const siblings = db.applications.filter((a) => a.company === app.company && a.id !== app.id && !db.tracking[a.id]?.trashed);
  const policies = Object.fromEntries(Object.values(db.companies).filter((c) => c.policy).map((c) => [c.name, c.policy!]));
  const blocked = blockedOffers(db.applications, db.tracking, policies);
  const myBlock = blocked.get(app.id);
  const per = app.kind === "intern" ? "month" : "year";
  const market = marketOf(app);
  const salarySearch = `https://www.google.com/search?q=${encodeURIComponent(`${app.company} ${app.kind === "intern" ? "intern" : "new grad"} salary ${app.locations[0]?.city ?? ""} levels.fyi`)}`;
  const gradLabel = `${MONTHS[me.grad.month - 1]} ${me.grad.year}`;
  // Same rules as the board (publishedOfOffer)
  const webDate = webDateOf(posting ?? undefined, app.firstSeenAt);
  const pub = publishedOf(app.postedAt, webDate);
  // Published over a year ago and not for 2027: in the Archive, never new
  const stale = isStale(pub?.date, app.title);
  // New until opened: this visit counts as seeing it (SeenOnVisit)
  const isNewOffer = isNew({ ...app, stale }, await newSince(app.board ?? "global"), track?.seenAt);
  const tracker = app.postedBy ?? trackerName(app.sources);
  const where = (from: "web" | "tracker") =>
    from === "web" ? (webDate && posting?.dateFrom ? `on ${posting.dateFrom}` : "on the company's site") : `on ${tracker}`;

  // Application form: cover letter field and written questions (only some ATS publish it)
  const form = posting?.form ?? null;
  const coverText = !form
    ? null
    : form.coverLetter === "required"
      ? `The form has a required "${form.coverField}" field.`
      : form.coverLetter === "optional"
        ? `The form has a "${form.coverField}" field, but it is optional.`
        : `The form has no field for a cover letter${form.freeText ? `; only a free-text box ("${form.freeText}")` : ""}.`;
  const formAts = posting ? FORM_ATS.find(([re]) => re.test(posting.via))?.[1] : undefined;
  const unknownForm =
    posting && /^(greenhouse|ashby|lever|workable)/.test(posting.via)
      ? "Its form has not been read yet: it is read the next time the offer is refreshed."
      : `${formAts ?? "Its site"} only shows the form once you start applying, so it is not known whether it asks for a cover letter.`;

  const statusLabel = (s: Status) => STATUS_OPTIONS.find(([v]) => v === s)?.[1] ?? s;
  // One line per visa, with the cities it applies to
  const visaCities = new Map<VisaCode, string[]>();
  for (const l of app.locations) {
    const code = app.visas.find((x) => x.region === l.region)?.visa ?? app.visa;
    visaCities.set(code, [...(visaCities.get(code) ?? []), l.city]);
  }
  const visaLines = [...visaCities].map(([code, cities]) => `${cities.join(", ")}: ${VISAS[code].label}. ${VISAS[code].long}`);
  const context: OfferContext = {
    heading: `${app.company} — ${app.title}`,
    path: `/offers/${app.id}`,
    sections: [
      {
        id: "offer",
        title: "Offer",
        items: [
          { k: "Company", v: app.company },
          { k: "Role", v: app.title },
          { k: "Type", v: `${KIND_LABEL[app.kind]} · ${ROLE_LABEL[app.role] ?? app.role}${app.season ? ` · ${app.season}` : ""}` },
          { k: "Locations", v: `${app.locations.map((l) => l.city).join(", ")}${app.moreLocations ? " and others" : ""}` },
          { k: "Link", v: app.urls[0] },
          { k: "Other links", v: app.urls.slice(1) },
          { k: "Published", v: pub ? `${longDate(pub.date)} ${where(pub.from)}` : "no known date" },
          { k: "Deadline", v: app.deadlineDate ? longDate(app.deadlineDate) : app.deadline },
          { k: "Status", v: active ? "open" : `closed (${closedReason})` },
          { k: "Priority on the board", v: `${priority === "X" ? "already applied" : priority} (score ${score})` },
        ],
      },
      {
        id: "company",
        title: "Company",
        items: [
          { k: "Sector", v: `${app.sector}${app.offList ? " (not on your list)" : ""}` },
          { k: "Tier", v: `${app.prestige}, pay ${TIER_LABEL[app.pay]}` },
          {
            k: "Application limit",
            v: myBlock
              ? `${ruleSummary(myBlock.rule)}: already used (${myBlock.appliedTo.map((a) => a.title).join(", ")})`
              : limit
                ? ruleSummary(limit)
                : company?.policy?.status === "found"
                  ? "no strict limit"
                  : "no known limit",
          },
          { k: "Rules it publishes", v: (company?.policy?.rules ?? []).map((r) => `${ruleSummary(r)}: "${r.quote}"`) },
          {
            k: `${KIND_LABEL[app.kind]} and ${app.kind === "intern" ? "new grad" : "internship"} at the same time`,
            v: siblings.some((s) => s.kind !== app.kind) ? crossTrack(company?.policy ?? undefined, app.kind).text : "",
          },
          {
            k: "Its other offers on the board",
            v: siblings
              .slice(0, 15)
              .map((s) => `${s.title} (${KIND_LABEL[s.kind]}${db.tracking[s.id]?.status ? `, ${statusLabel(db.tracking[s.id].status)}` : ""}${s.active ? "" : ", closed"})`),
          },
        ],
      },
      {
        id: "pay",
        title: "Pay",
        items: [
          { k: "Amount", v: `${comp.source === "estimate" ? "≈ " : ""}${compLabel(comp)}${comp.currency !== "EUR" ? ` (≈ ${eurEquivalent(comp, per)})` : ""}` },
          {
            k: "Source",
            v:
              comp.source === "posted"
                ? "Official: published in the posting itself (base salary)"
                : comp.source === "tracker"
                  ? `From the tracker (${app.sources.join(", ")}), not the posting; it may include bonus`
                  : `Approximate: the posting publishes no salary. Estimate for ${app.kind === "intern" ? "an internship" : "a new grad role"} in ${MARKET_LABEL[market]}, with the company at pay ${TIER_LABEL[app.pay]}`,
          },
          {
            k: "What the posting says",
            v: comp.source === "posted" ? comp.all.map((p) => `${money(p.min, p.max, p.currency, p.period)}: "${p.text}"`) : comp.source === "tracker" ? `"${app.salary}"` : "",
          },
        ],
      },
      {
        id: "eligibility",
        title: "Eligibility",
        items: [
          { k: "Verdict", v: `${ELIGIBILITY_LABEL[elig.value]}: ${elig.summary}` },
          { k: "What the posting says", v: elig.evidence.map((e) => `"${e}"`) },
          { k: "General rule for this type of role", v: db.reference.eligibilityNotes[app.eligibilityNote] ?? "" },
        ],
      },
      {
        id: "fit",
        title: "Fit with your CV",
        items: [
          { k: "Fit", v: `${fit.fit} of 5: ${fit.headline}` },
          { k: "For", v: fit.pros },
          { k: "Against", v: fit.cons },
          { k: "CV to send", v: `${cv.label} (with ${fit.cvChoice.project} instead of ${fit.cvChoice.other.project})` },
          { k: "Why that CV", v: fit.cvChoice.reasons },
          { k: "From your CV, the posting asks for", v: fit.matched },
        ],
      },
      {
        id: "requirements",
        title: "The posting's requirements",
        items: posting?.ok
          ? [
              { k: "Requirements", v: posting.requirements.map((r) => r.replace(/^[-–*·]\s*/, "")) },
              { k: "Nice to have", v: posting.niceToHave },
              { k: "Experience", v: expTerms.length ? expTerms.map((t) => `${t.text} ("${t.quote}")`) : posting.experience.slice(0, 2) },
              { k: "Languages", v: posting.languages.map((l) => `${l.name}${!l.required ? " (a plus)" : l.explicit ? " (required)" : ""}`).join(", ") },
              { k: "Degree", v: posting.degree ? `${posting.degree.level === "phd" ? "PhD" : "Master's"} ${posting.degree.required ? "required" : "preferred"}` : "" },
              { k: "Technologies it mentions", v: posting.skills.found.join(", ") },
            ]
          : [{ v: "The posting's text could not be read." }],
      },
      {
        id: "application",
        title: "Application form",
        items: [
          { k: "Cover letter", v: form ? `${COVER_LABEL[form.coverLetter]}. ${coverText}` : `Unknown. ${unknownForm}` },
          {
            k: "Questions to answer in writing",
            v: (form?.questions ?? []).map((q) =>
              q.trap ? `AI TRAP, leave it blank (the posting asks people not to answer it): "${q.label}"` : `${q.label} (${q.required ? "required" : "optional"})`,
            ),
          },
        ],
      },
      { id: "visa", title: "Work visa", items: [{ v: visaLines }] },
      {
        id: "interview",
        title: "Interview",
        items: [
          { k: "Type", v: `${INTERVIEW_LABEL[app.interview.type]}${app.interview.confirmed ? "" : " (estimated from the type of company)"}` },
          { k: "What to expect", v: db.reference.interviewNotes[app.interview.note] ?? "" },
          { k: "Process difficulty", v: `${app.difficulty} of 5` },
        ],
      },
      {
        id: "source",
        title: "Source",
        items: [
          { k: "Trackers", v: app.sources.join(", ") },
          { k: "On the board since", v: app.firstSeenAt ? fmtDate(app.firstSeenAt.slice(0, 10)) : "the initial import" },
          { k: "Note", v: app.note },
        ],
      },
    ],
    profile: {
      id: "profile",
      title: "My profile",
      items: [
        { k: "Graduation", v: gradLabel },
        { k: "Experience", v: `${me.months} months in total, ${me.fullTimeMonths} without internships` },
        { k: "Languages", v: me.languages.map((l) => `${l.name} (${l.raw})`).join(", ") },
        { k: `Skills on your ${cv.label}`, v: cvProfile.skills.join(", ") },
        { k: "What differs between the CVs", v: `${CV_INFO.swe.label} has ${CV_INFO.swe.project}; ${CV_INFO.quant.label} has ${CV_INFO.quant.project}` },
      ],
    },
    text: fullText,
  };

  return (
    <TrackingProvider id={app.id} initial={track ?? null} company={app.company}>
      <div className="detail-page">
        <BackToBoard href="/" label="Board" />
        <SeenOnVisit isNew={isNewOffer} />

        <TrashBanner />

        <header className="offer-head">
          <p className="offer-co">
            <span className={`pr pr-${priority === "X" ? "X" : priority}`} title={`Priority ${priority} · score ${score}`}>
              {priority === "X" ? "Sent" : priority === "D" ? "No" : priority}
            </span>
            <span className="co-name">{app.company}</span>
            <span className={`pre pre-${app.prestige}`} title={`Tier ${app.prestige} · pay ${app.pay}/5`}>
              {app.prestige}
            </span>
            <span className="muted">
              {app.sector}
              {app.offList ? " · not on your list" : ""}
            </span>
          </p>
          <h1>{app.title}</h1>
          <p className="tags">
            {isNewOffer && <span className="tag tag-new">New</span>}
            {stale && <span className="tag tag-old">Old</span>}
            <span className={`tag tag-${app.kind}`}>{KIND_LABEL[app.kind]}</span>
            <span className="tag">{ROLE_LABEL[app.role] ?? app.role}</span>
            {app.season && <span className="tag">{app.season}</span>}
            {form?.coverLetter === "none" && <span className="tag tag-nocover">No cover letter</span>}
            {form?.coverLetter === "required" && <span className="tag tag-cover-req">Cover letter required</span>}
            {!active && <span className="tag tag-closed">Closed · {closedReason}</span>}
            {pub && (
              <span className="muted small published">
                Published on {longDate(pub.date)} {where(pub.from)}
              </span>
            )}
          </p>
          <p className="offer-cities">
            <MapPin size={15} aria-hidden />
            {app.locations.map((l, i) => (
              <span key={l.city}>
                {i > 0 && <span className="sep"> · </span>}
                <a href={l.url} target="_blank" rel="noopener noreferrer" className={PREFERRED_REGIONS.includes(l.region) ? "pref" : undefined}>
                  {l.city}
                </a>
              </span>
            ))}
            {app.moreLocations && <span className="muted"> and others</span>}
          </p>
          <OfferActions url={app.urls[0]} cvKind={fit.cvBest} cvLabel={cv.label} title={`${app.company} ${app.title}`} />
        </header>

        <dl className="facts">
          <div>
            <dt>Pay</dt>
            <dd className={`fact-value pay-${comp.source}`}>
              {comp.source === "estimate" && "≈ "}
              {compLabel(comp)}
            </dd>
            <dd className="fact-sub fact-pay">
              <PayBadge source={comp.source} /> {PAY_ORIGIN[comp.source]}
            </dd>
          </div>
          <div>
            <dt>Fit with your CV</dt>
            <dd className="fact-value">{fit.fit} of 5</dd>
            <dd className="fact-sub">
              {fit.headline}
              {fit.fit !== fit.base ? ` (role: ${fit.base})` : ""}
            </dd>
          </div>
          <div>
            <dt>Eligibility</dt>
            <dd className={`fact-value e-text-${elig.value}`}>{ELIGIBILITY_LABEL[elig.value]}</dd>
            <dd className="fact-sub">{elig.from === "posting" ? "from the posting's text" : "from the type of role"}</dd>
          </div>
          <div>
            <dt>Visa</dt>
            <dd className="fact-value">{noVisaCities.length ? "Not needed" : firstVisa.label}</dd>
            <dd className="fact-sub">{noVisaCities.length ? `in ${noVisaCities.join(", ")}` : firstVisa.long.split(":")[0]}</dd>
          </div>
          <div>
            <dt>Applications</dt>
            <dd className="fact-value">{myBlock ? "Limit used" : limit ? `Max. ${limit.max}` : company?.policy?.status === "found" ? "No strict limit" : "No known limit"}</dd>
            <dd className="fact-sub">{limit ? ruleSummary(limit) : company?.policy ? "checked in its postings" : "checked when you apply"}</dd>
          </div>
        </dl>

        <div className="offer-body">
          <main className="offer-main">
            <section>
              <h2 className="h2-badge">
                Pay <PayBadge source={comp.source} />
              </h2>
              {comp.source === "posted" ? (
                <>
                  <ul className="pay-list">
                    {comp.all.map((p, i) => (
                      <li key={i}>
                        <span className="pay-amount">{money(p.min, p.max, p.currency, p.period)}</span>
                        <span className="muted">
                          {[
                            p.period === "hour" ? `≈ ${money(Math.round(p.min * 173), Math.round(p.max * 173), p.currency, "month")} full time` : "",
                            p.currency !== "EUR" ? `≈ ${eurEquivalent(p, p.period === "year" ? "year" : "month")}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <q className="quote">{p.text}</q>
                      </li>
                    ))}
                  </ul>
                  <p className="muted small">Range published in the posting itself (required by law in the US). It is base salary: no bonus or equity.</p>
                </>
              ) : comp.source === "tracker" ? (
                <>
                  <p className="pay-amount pay-tracker">{compLabel(comp)}</p>
                  <p className="muted small">
                    Figure published by the tracker ({app.sources.join(", ")}); it may include bonus. The posting does not include it in its text.
                    {comp.currency !== "EUR" && ` About ${eurEquivalent(comp, per)}.`}
                  </p>
                </>
              ) : (
                <>
                  <p className="pay-amount pay-estimate">≈ {compLabel(comp)}</p>
                  <p>
                    The posting publishes no salary. Estimate for {app.kind === "intern" ? "an internship" : "a new grad role"} in {MARKET_LABEL[market]}, with the company at
                    pay {TIER_LABEL[app.pay]}. {comp.currency !== "EUR" && `About ${eurEquivalent(comp, per)}.`}
                  </p>
                  <p className="muted small">
                    It is base salary{app.pay >= 5 && app.sector === "Quant/Trading" ? "; at quant firms the bonus can add 30% to 100% more" : ""}. Compare it on{" "}
                    <a href={salarySearch} target="_blank" rel="noopener noreferrer">
                      levels.fyi and Glassdoor <ExternalLink size={12} aria-hidden />
                    </a>
                    .
                  </p>
                </>
              )}
            </section>

            <section>
              <h2>Why it fits your CV (or not)</h2>
              <ul className="reasons">
                {fit.pros.map((p) => (
                  <li key={p} className="pro">
                    <Check size={15} aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
                {fit.cons.map((c) => (
                  <li key={c} className="con">
                    <CircleAlert size={15} aria-hidden />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Computed with your {cv.label} ({cvProfile.ok ? `read from the PDF on ${fmtDate(cvProfile.modifiedAt.slice(0, 10))}` : "the PDF could not be read"}). Update the PDF and it is
                computed again.
              </p>
            </section>

            <section>
              <h2>Eligibility</h2>
              <p>
                <span className={`pill e-${elig.value}`}>{ELIGIBILITY_LABEL[elig.value]}</span> {elig.summary}
              </p>
              {elig.evidence.length > 0 && (
                <>
                  <p className="muted small">
                    What the posting says
                    {elig.basis === "grad"
                      ? ` (compared with your graduation, ${gradLabel})`
                      : elig.basis === "experience"
                        ? ` (compared with your experience: ${me.months} months, ${me.fullTimeMonths} without internships)`
                        : ""}
                    :
                  </p>
                  {elig.evidence.map((e) => (
                    <q key={e} className="quote">
                      {e}
                    </q>
                  ))}
                </>
              )}
              {elig.from === "posting" && <p className="muted small">General rule for this type of role: {db.reference.eligibilityNotes[app.eligibilityNote]}</p>}
            </section>

            <section>
              <h2>The posting's requirements</h2>
              {posting?.ok ? (
                <>
                  {posting.requirements.length ? (
                    <ul className="req-list">
                      {posting.requirements.map((r) => (
                        <li key={r}>{r.replace(/^[-–*·]\s*/, "")}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">The posting has no separate list of requirements; read it in full on its site.</p>
                  )}
                  {posting.niceToHave.length > 0 && (
                    <>
                      <h3>Nice to have</h3>
                      <ul className="req-list">
                        {posting.niceToHave.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(expTerms.length > 0 || posting.experience.length > 0 || posting.languages.length > 0 || posting.degree) && (
                    <dl className="meta-list">
                      {expTerms.length > 0 ? (
                        <>
                          <dt>Experience</dt>
                          <dd>
                            {expTerms.map((t) => (
                              <span key={t.text} className="exp-term">
                                {t.text}
                                <q className="quote">{t.quote}</q>
                              </span>
                            ))}
                          </dd>
                        </>
                      ) : (
                        posting.experience.length > 0 && (
                          <>
                            <dt>Experience</dt>
                            <dd>{posting.experience[0]}</dd>
                          </>
                        )
                      )}
                      {posting.languages.length > 0 && (
                        <>
                          <dt>Languages</dt>
                          <dd>{posting.languages.map((l) => `${l.name}${l.required ? "" : " (a plus)"}`).join(", ")}</dd>
                        </>
                      )}
                      {posting.degree && (
                        <>
                          <dt>Degree</dt>
                          <dd>
                            {posting.degree.level === "phd" ? "PhD" : "Master's"} {posting.degree.required ? "required" : "preferred"}
                          </dd>
                        </>
                      )}
                    </dl>
                  )}
                  <p className="muted small">
                    Read from the posting{posting.via === "kadoa" ? " (Kadoa's copy: its site blocks automated reads)" : ""} on {fmtDate(posting.fetchedAt.slice(0, 10))}.
                    {posting.gone ? " The company has taken it down from its site: this is the last version read." : ""}{" "}
                    <a href={posting.url} target="_blank" rel="noopener noreferrer">
                      See the full posting <ExternalLink size={12} aria-hidden />
                    </a>
                  </p>
                </>
              ) : (
                <p className="muted">
                  The posting's text could not be read{posting?.error ? ` (${posting.error})` : ""}.{" "}
                  <a href={app.urls[0]} target="_blank" rel="noopener noreferrer">
                    Open it on its site <ExternalLink size={12} aria-hidden />
                  </a>
                </p>
              )}
            </section>

            <section>
              <h2>Application form</h2>
              {form ? (
                <>
                  <p>
                    <span className={`pill cover-${form.coverLetter}`}>{COVER_LABEL[form.coverLetter]}</span> {coverText}
                  </p>
                  {form.questions.length > 0 && (
                    <>
                      <h3>Questions you will answer in writing</h3>
                      <ul className="form-qs">
                        {form.questions.map((q) => (
                          <li key={q.label} data-trap={q.trap || undefined}>
                            {q.trap && <span className="pill pill-trap">AI trap</span>} <span>{q.label}</span>{" "}
                            <span className="muted small">{q.trap ? "If you are a person, the posting asks you to leave it blank." : q.required ? "required" : "optional"}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="muted small">
                    Read from the {form.from} form on {fmtDate(posting!.fetchedAt.slice(0, 10))}.
                  </p>
                </>
              ) : (
                <p className="muted">{unknownForm}</p>
              )}
            </section>

            <section>
              <h2>Work visa</h2>
              <VisaPanel app={app} />
            </section>
          </main>

          <aside className="offer-aside">
            <TrackingPanel />

            <CopyContext ctx={context} />

            <PolicyPanel
              company={app.company}
              kind={app.kind}
              policy={company?.policy ?? null}
              block={myBlock ? { summary: ruleSummary(myBlock.rule), appliedTo: myBlock.appliedTo, cooldown: myBlock.rule.kind === "cooldown" } : null}
              siblings={siblings.map((s) => ({
                id: s.id,
                title: s.title,
                kind: s.kind,
                active: s.active && !db.postings[s.id]?.gone,
                status: db.tracking[s.id]?.status ?? "",
                blocked: blocked.has(s.id),
                ineligible: eligibilityOf(s, db.reference.eligibilityNotes[s.eligibilityNote], db.postings[s.id], me).value === "no",
              }))}
            />

            <section>
              <h2>CV to send</h2>
              <p>
                <b>{cv.label}</b> · with {fit.cvChoice.project} instead of {fit.cvChoice.other.project}.
              </p>
              {fit.cvChoice.reasons.map((r) => (
                <p key={r}>{r}</p>
              ))}
              <p className="muted small">
                {fit.cvChoice.margin === "clear" ? "Clear choice" : "Close call"}: {fit.cvChoice.score.swe} points for the SWE CV and{" "}
                {fit.cvChoice.score.quant} for the Quant one{fit.cvChoice.byPosting ? " (the posting's text overturned what the role suggests)" : ""}.
              </p>
              {fit.matched.length > 0 && (
                <p className="muted small">From your CV, the posting asks for: {fit.matched.join(", ")}.</p>
              )}
              <a className="btn" href={`/api/cv/${fit.cvBest}`} target="_blank" rel="noopener">
                Open the PDF <ExternalLink size={14} aria-hidden />
              </a>
            </section>

            <section>
              <h2>Interview</h2>
              <p>
                <span className={`pill iv-${app.interview.type}`}>{INTERVIEW_LABEL[app.interview.type]}</span>
                {!app.interview.confirmed && <span className="muted small"> estimated from the type of company</span>}
              </p>
              <p>{db.reference.interviewNotes[app.interview.note]}</p>
              <p className="muted small">Process difficulty: {app.difficulty} of 5.</p>
            </section>

            <section>
              <h2>Source</h2>
              <dl className="meta-list">
                <dt>Trackers</dt>
                <dd>{app.sources.join(", ")}</dd>
                {pub && (
                  <>
                    <dt>Published</dt>
                    <dd>
                      {longDate(pub.date)} {where(pub.from)}
                      {pub.other && (
                        <span className="muted">
                          {" "}
                          · {where(pub.other.from)}: {longDate(pub.other.date)}
                          {pub.from === "tracker" && pub.other.from === "web" && pub.other.date < pub.date ? " (opening open since then)" : ""}
                        </span>
                      )}
                    </dd>
                  </>
                )}
                <dt>On the board</dt>
                <dd>{app.firstSeenAt ? `since ${fmtDate(app.firstSeenAt.slice(0, 10))}` : "since the initial import"}</dd>
                <dt>Status</dt>
                <dd>{active ? "open" : `closed: ${closedReason}`}</dd>
                {app.note && (
                  <>
                    <dt>Note</dt>
                    <dd>{app.note}</dd>
                  </>
                )}
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </TrackingProvider>
  );
}
