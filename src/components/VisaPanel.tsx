import { ExternalLink } from "lucide-react";
import type { Application } from "@/lib/types";
import { visaForKind, visaGroups, type VisaGroup } from "@/lib/visa";

export function VisaCard({ group, kind }: { group: VisaGroup; kind?: Application["kind"] }) {
  const { info, cities, countryNotes } = group;
  return (
    <div className="vcard">
      <header>
        <span className={`pill t-${info.tone}`}>{info.label}</span>
        {cities.length > 0 && <span className="where">{cities.join(", ")}</span>}
      </header>
      <p>{info.long}</p>
      <dl>
        {kind ? (
          <>
            <dt>{kind === "intern" ? "Internship" : "New grad"}</dt>
            <dd>{visaForKind(info, kind)}</dd>
          </>
        ) : (
          <>
            <dt>Internship</dt>
            <dd>{info.intern}</dd>
            <dt>New grad</dt>
            <dd>{info.grad}</dd>
          </>
        )}
        <dt>Who</dt>
        <dd>{info.who}</dd>
        <dt>Timeline</dt>
        <dd>{info.timeline}</dd>
        <dt>Cost</dt>
        <dd>{info.cost}</dd>
      </dl>
      {countryNotes.map((n) => (
        <p key={n.country} className="cn">
          <b>{n.country}</b> ({n.cities.join(", ")}): {n.note}
        </p>
      ))}
      <details>
        <summary>Steps and what to watch</summary>
        <ol>
          {info.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {info.watch.length > 0 && (
          <ul>
            {info.watch.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </details>
      <div className="vlinks">
        {info.links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label} <ExternalLink size={11} aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

export default function VisaPanel({ app }: { app: Application }) {
  const groups = visaGroups(app);
  return (
    <div className="visas">
      {groups.map((g) => (
        <VisaCard key={g.info.code} group={g} kind={app.kind} />
      ))}
    </div>
  );
}
