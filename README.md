# Application Board

A local board for deciding which **2027 internship and new-grad roles** (SWE, SRE/infra, data, quant) to apply to today, and for tracking what you sent. It gathers offers from public trackers, reads each posting and checks it against your two PDF CVs: whether you are eligible, how well you fit, which CV to send, what it pays, which visa you need and how many applications each company accepts.

![The board](docs/screenshots/board.png)

## What it does

- **Offers from public trackers**: SimplifyJobs (Summer 2027 and New Grad), vanshb03, speedyapply, Kadoa (quant) and Northwestern FinTech (quant). One search when you press "Search offers" (or `npm run crawl`); it closes the ones that disappear and flags the new ones.
- **Reads each posting from its ATS** (Greenhouse, Lever, Ashby, Workday, Eightfold, Workable, SmartRecruiters, Oracle, Apple, JSON-LD) and extracts pay, requirements, years of experience, languages, the graduation date it asks for and the publication date.
- **Eligibility against your CV**: graduation ("final year", "graduating in 2027", "must return to university"…), seniority (years of experience and whether internships count) and languages (only ruled out when the posting says the language is mandatory). Offers you cannot apply to are not kept.
- **Which CV to send**: the two CVs differ in one project (one in production, one low-level); for each offer it picks one and explains why.
- **Pay**: the range published in the posting (**Official**), the tracker's figure, or an estimate (**Approx.**) from the company's pay level, the city and the type of role.
- **Application form**: where the ATS publishes it (Greenhouse, Ashby, Lever, Workable), whether there is a cover letter field (required, optional or **none at all**), the questions to answer in writing, and AI traps ("If you're a human, leave this line blank").
- **Per-company application limits**: it reads their postings and FAQs ("one application per season", "an OA blocks the other track for 8 months"…) and archives what you can no longer apply to.
- **Work visa** for each city, for an EU citizen.
- **Filters** by region, role, pay range, whether the pay is official, publication date, status, cover letter, CV, type, eligibility, tier, fit and interview; **multi-level sorting**; **New** (only what was published after the previous search); trash and bulk selection.
- **Copy context**: on each offer page, everything the board knows (and the full posting text) as text or JSON, ready to paste elsewhere.

| Filters | An offer |
|---|---|
| ![Filters](docs/screenshots/filters.png) | ![An offer](docs/screenshots/offer.png) |

Dark mode too:

![The board in dark mode](docs/screenshots/board-dark.png)

## Getting started

With Docker (Postgres + migrations + the app on http://localhost:8888):

```bash
cp path/to/your-swe-cv.pdf cv/swe.pdf            # your CVs (see "Your CVs" below)
cp path/to/your-quant-cv.pdf cv/quant.pdf
docker compose up -d --build
docker compose exec app npm run db:seed          # target companies and reference notes (first time only)
docker compose exec app npm run crawl            # first search (afterwards, the "Search offers" button)
```

For development outside Docker (port 3000), with the compose Postgres running (`docker compose up -d db migrate`):

```bash
npm install
npm run db:seed
npm run dev                                      # uses postgres://board:board@localhost:5434/board (DATABASE_URL for another)
npm run crawl -- --dry                           # what would change, without saving
npx tsx scripts/reread.mts --offline             # re-analyses the offers from their stored text
npx tsx scripts/purge-ineligible.mts --dry       # how many stored offers are no longer eligible (without --dry it removes them, after a backup in data/backups/)
```

`CV_DIR=another/folder` reads the CVs from another folder.

## Your CVs

The board parses your CVs: it extracts the text of each PDF (so it needs real text, not a scanned image) when it starts and again whenever a file changes. Everything it says about fit, experience, languages and graduation comes from there:

- **Experience**: lines with an `@` and a period, such as `Software Engineer Intern @ Company  Jun 2025 – Sep 2025` (or `– Present`). It adds up the months; internships count apart from full-time work, for postings that ask for years of non-internship experience.
- **Projects**: under a `PROJECTS` heading, a title line such as `Name – what it is`, followed by its bullet points.
- **Skills**: the languages, frameworks and tools it recognises anywhere in the text (`src/lib/skills.ts`), compared with what each posting asks for.
- **Languages**: under a `LANGUAGES` heading, such as `Spanish (Native), English (C1)`.
- **Graduation**: a line such as `Expected graduation: June 2027`.

Headings are lines in capitals (`EXPERIENCE`, `PROJECTS`, `LANGUAGES`).

It is aimed at **SWE and quant** roles. If you want two different CVs, one for each, put them in `cv/` like this:

- `cv/swe.pdf`: with a project **in production** (a deployed service or product, with users), for SRE, infrastructure, backend, product and applied AI roles.
- `cv/quant.pdf`: the same CV with a **low-level** project instead (a compiler, a kernel, systems work), for compilers, embedded, C++, low-latency and quant research or trading roles.

For each offer it then picks one of the two and explains why on the offer page.

If you would rather have a single CV, you can change the code to unify everything into one: `src/lib/cv.ts` decides which PDFs are read (`CV_FILES` and `cvPath`) and `src/lib/cvChoice.ts` which one each offer gets (`chooseCv`). Without touching the code, putting the same PDF under both names also works; the suggested CV is then the same file either way.

## Assumptions

- The 2027 cycle: 2027 internships and new-grad roles for people finishing their degree in 2027. The exact date is read from the CV.
- The visa guide is for an **EU citizen**. Figures are approximate (October 2026): always check the official website.
- The target companies (`data/seed.json`) each have a tier (S to C) and a pay level (1 to 5): these are estimates, change them as you like.
- It is a local, single-user app: no accounts or passwords, so do not expose it to the internet.

## How it decides

**Priority (A, B, C)**: combines pay, fit, the company's prestige, eligibility, region and visa. "No" if you cannot apply, "Sent" if you already did.

**New**: an offer is new until you open it or mark it as seen, and only if it was published after the previous search (with 2 days of margin, as trackers list late) or has no date. Offers published over a year ago without "2027" in the title go to the Archive as **Old**.

**Publication date**: never the date the crawler found it. From the company (Greenhouse `first_published`, Lever, Ashby, Workday, Eightfold…) or from the tracker ("on Simplify"). When they disagree, the earliest, unless they are more than half a year apart: then this cycle's.

**Statuses**: Not started, Preparing, Applied, OA / Interview, Offer, Rejected (it counts as an application sent for the company's limits) and Dropped. If you reached the OA or an interview, the company's waiting period keeps counting even after you mark it as rejected.

**Internship and new grad at the same company**: each offer page says whether you can apply to both at once under the company's rules, with the quote and the link.

## Database

Postgres 17 with the schema in **Alembic** (`db/migrations/`); the `migrate` service applies the migrations on start.

| Table | What it stores |
|---|---|
| `offers` | Each offer: company, type, title, `active`, `first_seen_at`, `posted_at` and the rest in `data` (JSONB: cities, visas, sources, CV, interview…) |
| `tracking` | Your tracking: `status`, `interested`, `notes`, `applied_at`, `trashed`, `seen_at`, `assessed_at` |
| `postings` | What was read from each posting (`details` JSONB: pay, requirements, experience, languages, form…) and the compressed full text (`text_z`) |
| `companies` | Sector, prestige, pay level, aliases and `policy` (application rules with quote and source) |
| `rejected` | Offers left out as not eligible, with the reason, so they are not read again |
| `crawls`, `ui_state`, `reference` | Recent searches, the "New" marker and the reference notes |

To pin a company's rule by hand, edit `companies.policy` with `"origin": "manual"`: the automatic checks do not overwrite it.

## Layout

```
cv/                           ← your CVs (not committed)
data/seed.json                ← target companies and reference notes
db/                           ← Alembic: Postgres migrations (own Dockerfile)
docs/screenshots/             ← screenshots in this README
scripts/                      ← crawl, seed, reread, purge-ineligible
src/
  app/                        ← / (board), /offers/[id], /visas, api/…
  components/                 ← BoardApp, OffersTable (TanStack Table + Virtual), FilterControls, OfferPanels, CrawlControl, VisaPanel, ui
  lib/
    pg.ts, store.ts, db.ts    ← Postgres: connection, load and write by diff, tracking
    crawler/                  ← sources, merge, classify, titles, posting (ATS readers), forms, extract, policy, run
    cv.ts, cvChoice.ts        ← your CVs and which CV to send
    fit.ts, grad.ts           ← fit and eligibility
    offerContext.ts           ← what "Copy context" copies
    comp.ts, limits.ts, board.ts, filters.ts, format.ts, visa.ts, constants.ts, types.ts
```

Next.js 16, React 19, TanStack Table and Virtual, Postgres 17 (`pg`), Alembic, unpdf.

## License

[MIT](LICENSE).
