import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { VisaCard } from "@/components/VisaPanel";
import { readDb } from "@/lib/db";
import type { VisaCode } from "@/lib/types";
import { COUNTRY_NOTES, VISAS } from "@/lib/visa";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visa guide · Applications 2027" };

export default async function VisasPage() {
  const db = await readDb({ postings: false });
  const counts: Partial<Record<VisaCode, number>> = {};
  for (const a of db.applications) {
    for (const code of new Set(a.visas.map((v) => v.visa))) counts[code] = (counts[code] ?? 0) + 1;
  }
  const codes = (Object.keys(VISAS) as VisaCode[]).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));

  return (
    <div className="wrap">
      <Link href="/" className="back">
        <ArrowLeft size={15} aria-hidden /> Board
      </Link>
      <header className="guide-head">
        <h1>Work visas</h1>
        <p>
          What an EU citizen graduating in 2027 needs in each destination. Rough figures as of October 2026: check them on the official website
          and ask HR whether they sponsor before putting hours into the process.
        </p>
      </header>
      <div className="guide">
        {codes.map((code) => (
          <section key={code}>
            <h2>
              {VISAS[code].label} <span className="muted small">· {counts[code] ?? 0} offers</span>
            </h2>
            <VisaCard group={{ info: VISAS[code], cities: [], countryNotes: [] }} />
          </section>
        ))}
        <section>
          <h2>Notes by country</h2>
          {COUNTRY_NOTES.map((n) => (
            <p key={n.country} className="cn">
              <b>{n.country}</b>: {n.note}
            </p>
          ))}
        </section>
      </div>
    </div>
  );
}
