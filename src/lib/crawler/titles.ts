// Job titles written in German, French or Italian (European postings): read as English for the role
// classifier, and the non-tech jobs the English filters do not catch in those languages.

const TITLE_WORDS: [RegExp, string][] = [
  [/\b(software|applikations?|anwendungs|web|frontend|front-end|backend|back-end|full[- ]?stack|java|python|\.net|mobile|app|cloud|daten|data)[- ]?entwickler(in|innen)?\b/gi, "$1 developer"],
  [/\bentwickler(in|innen)?\b/gi, "developer"],
  [/\bsoftware[- ]?ingenieur(in)?\b/gi, "software engineer"],
  [/\bdaten[- ]?ingenieur(in)?\b/gi, "data engineer"],
  [/\bdaten[- ]?wissenschaftler(in)?\b/gi, "data scientist"],
  [/\bsystem[- ]?techniker(in)?\b/gi, "systems engineer"],
  [/\bsystem[- ]?(administrator|ingenieur)(in)?\b/gi, "systems engineer"],
  [/\bplattform[- ]?ingenieur(in)?\b/gi, "platform engineer"],
  [/\bnetzwerk[- ]?(techniker|ingenieur)(in)?\b/gi, "network engineer"],
  [/\binformatiker(in)?\b/gi, "software engineer"],
  [/\bingenieur(in)?\b/gi, "engineer"],
  [/\bing[ée]nieur(e)?s? (logiciel|software|d[ée]veloppement|syst[eè]mes?|donn[ée]es|cloud|devops)\b/gi, "$2 engineer"],
  [/\bing[ée]nieur(e)?\b/gi, "engineer"],
  [/\bd[ée]veloppeu(r|se)s?\b/gi, "developer"],
  [/\bsviluppat(ore|rice)\b/gi, "developer"],
  [/\bingegnere\b/gi, "engineer"],
  [/\b(praktikant(in|innen)?|praktikum|hochschulpraktikum|praktika|stagiaire|stage|stagista|tirocinio|werkstudent(in)?|working student)\b/gi, "intern"],
  [/\bberufseinsteiger(in)?|absolvent(in)?|hochschulabsolvent(in)?|jeune dipl[ôo]m[ée]e?|neolaureat[oa]\b/gi, "graduate"],
  [/\bsicherheit\b/gi, "security"],
];

/** English reading of a German, French or Italian title, for the role classifier (an English title is left as it is). */
export function normalizeTitle(title: string): string {
  let t = title;
  for (const [re, to] of TITLE_WORDS) t = t.replace(re, to);
  return t;
}

/** Jobs outside tech that the global filter does not catch in German or French. */
export const NOT_TECH_LOCAL =
  /verkauf|vertrieb|aussendienst|buchhalt|controlling|treuhand|pflege|ärzt|arzt|koch\b|köchin|mechaniker|elektriker|logistik|sachbearbeit|kundendienst|kundenberat|personal(fach|berat|leit)|marketing|einkauf|immobilien|jurist|rechtsdienst|lehrer|betreuer|verkäufer|reinigung|chauffeur|lager|detailhandel|gastro|monteur|maler|schreiner|bauleit|bauführer|polier|steuer|revision|finanzbuch|kaufm|vendeu|comptab|infirmi|commercial|assistant(e)? de direction|logisticien|magasinier|cuisinier|serveu|camarier|contabil|vendit|infermier|automatiker|mechatronik|konstrukteur|elektroingenieur|elektronik|hardware|maschinenbau|verfahrenstechn|bauingenieur|geomatik|zeichner|electrical|elektro|instrument|mechanical|hydraulic|process engineer|chemi|biotech|laborant|professor|dozent|lecturer|postdoc|wissenschaftliche[rn]? mitarbeiter|content developer|learning content|instructional|e-learning|redakt|lipid|reagent|chemist|biolog|packaging|clinical|business developer|business development|account executive|sales|\bhr\b|human resources|facilitator|coach|trainer\b|teacher/i;
