# LIAH HSD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `liah-learning` into `liah-hsd`, rebrand it under the "Registrar" visual direction, and add a downloadable diploma certificate issued once a student has passed every active course.

**Architecture:** Same Express 5 + Drizzle + PostgreSQL backend and React 19 + Vite frontend as `liah-learning`, copied wholesale and then modified. Certificates are a new `certificates` table plus a model/route/controller layer that reuses the existing best-score-per-course data already computed for progress tracking.

**Tech Stack:** Node.js, TypeScript, Express 5, Drizzle ORM, PostgreSQL 17, Argon2, Zod, React 19, Vite, React Router, `pdfkit` (new), Docker Compose, npm workspaces, `node:test` (backend) / Vitest (frontend).

## Global Constraints

- Source project to copy from: `/Users/sam/Projects/liah-wellness/liah-learning` (read-only — never modify it).
- Target repo: `/Users/sam/Projects/liah-wellness/liah-hsd` (already `git init`'d, remote `origin` → `https://github.com/samklepdev/liah-hsd.git`, branch `main`).
- Roles stay exactly `user` and `admin` — no new roles.
- Curriculum model stays Subjects → Courses → Quizzes — no grade-level layer.
- Certificate trigger: **all active courses passed** (not per-subject), matching the approved spec.
- Certificate format: server-generated downloadable PDF, not just an on-screen page.
- Visual direction: "The Registrar" — navy `#152542` primary, gold `#9c7a2e` accent, white ground, serif headings (system serif stack), sans UI chrome (system sans stack).
- No self-service registration in the UI (the `/auth/register` endpoint itself stays, since tests use it).
- Backend tests run with `--test-concurrency=1` against a database whose name ends in `_test` (enforced by `test/helpers/db.ts`).
- Every commit message style matches the existing repo convention (plain imperative subject line, no footer required here since this is a fresh repo).
- `backend/.env`, `backend/.env.test`, `node_modules`, `dist`, `.vercel` are never copied into the new repo or committed.

---

## File Structure

New/changed files by the end of this plan:

```
liah-hsd/
  backend/
    src/
      models/
        schema.ts                      # + certificates table
        certificate.model.ts           # NEW
        certificate.model.test.ts      # NEW
        user.model.ts                  # + findUserById
      lib/
        certificate-pdf.ts             # NEW
      controllers/
        certificate.controller.ts      # NEW
        certificate.controller.test.ts # NEW
        attempt.controller.ts          # modified: issue certificate after submit
      routes/
        certificate.routes.ts          # NEW
        index.ts                       # modified: mount certificateRouter
      scripts/
        seed-subjects.ts               # NEW
        seed-subjects.test.ts          # NEW
      test/helpers/db.ts                # modified: truncate certificates too
      data/*.quiz.json                 # REMOVED (automotive content, not HSD)
    package.json                       # + pdfkit, @types/pdfkit, seed:subjects script
  frontend/
    src/
      shell/
        BrandMark.tsx                  # NEW
        AppShell.tsx                   # modified: use BrandMark, "LIAH HSD" label
      auth/
        LoginForm.tsx                  # modified: use BrandMark
        ForcedPasswordChangeForm.tsx   # modified: use BrandMark
      certificates/
        api.ts                        # NEW
        CertificateCard.tsx           # NEW
        CertificateCard.test.tsx      # NEW
      pages/
        ProgressPage.tsx              # modified: renders CertificateCard
      index.css                        # rewritten: Registrar palette/type, no Poppins
      App.css                          # modified: .brand-seal, .cert-card rules
    index.html                         # modified: title, theme storage key
    src/shell/useTheme.ts              # modified: theme storage key
    src/assets/liah-logo.png           # REMOVED
    src/assets/fonts/                  # REMOVED
  docker-compose.yml                   # own container/port/db name
  backend/.env.example                 # own DATABASE_URL
  package.json                         # renamed to liah-hsd
  README.md                            # rewritten
```

---

## Task 1: Bootstrap the repo from `liah-learning`

**Files:**
- Create (via copy): `backend/`, `frontend/`, `package.json`, `package-lock.json`, `docker-compose.yml`, `vercel.json`, `README.md`
- Modify: `docker-compose.yml`, `backend/.env.example`, `package.json`

**Interfaces:** None yet — this task produces the running skeleton every later task builds on.

- [ ] **Step 1: Copy `backend/` and `frontend/` from `liah-learning`, excluding build artifacts and secrets**

```bash
cd /Users/sam/Projects/liah-wellness/liah-hsd

rsync -a \
  --exclude 'node_modules' --exclude 'dist' --exclude '.vercel' \
  --exclude '.DS_Store' --exclude '.env' --exclude '.env.test' --exclude '.env.local' \
  /Users/sam/Projects/liah-wellness/liah-learning/backend/ ./backend/

rsync -a \
  --exclude 'node_modules' --exclude 'dist' --exclude '.vercel' --exclude '.DS_Store' \
  /Users/sam/Projects/liah-wellness/liah-learning/frontend/ ./frontend/

cp /Users/sam/Projects/liah-wellness/liah-learning/package.json ./package.json
cp /Users/sam/Projects/liah-wellness/liah-learning/package-lock.json ./package-lock.json
cp /Users/sam/Projects/liah-wellness/liah-learning/docker-compose.yml ./docker-compose.yml
cp /Users/sam/Projects/liah-wellness/liah-learning/vercel.json ./vercel.json
cp /Users/sam/Projects/liah-wellness/liah-learning/README.md ./README.md
```

Expected: no errors; `ls backend frontend` shows the same top-level entries as `liah-learning` minus `node_modules`/`dist`.

- [ ] **Step 2: Remove the automotive quiz content — this app's curriculum is TBD, not LIAH International Academy's**

```bash
ls backend/src/data/*.quiz.json
rm -f backend/src/data/*.quiz.json
```

Expected: the first `ls` lists 8 `*.quiz.json` files before deletion; `backend/src/data/` is empty of `.quiz.json` files afterward. Leave `backend/src/lib/quiz-parser.ts`, `backend/src/scripts/parse-quiz-pdf.ts`, `backend/src/scripts/seed-quizzes.ts`, and `backend/src/test/fixtures/` untouched — the parsing pipeline and its dialect-regression tests are reused as-is, ready for real HSD quiz packs later.

**Important — discovered during execution:** `chassis.quiz.json` is not just app content. Seven test files (`src/scripts/seed-quizzes.test.ts` and six controller tests: `quiz`, `progress`, `grading`, `attempt`, `catalog`, `admin-courses`) read it directly at module scope as their fixture corpus — deleting it breaks the whole backend suite with `ENOENT`. The fix: `cp` `chassis.quiz.json` from `liah-learning` into `backend/src/test/fixtures/` (next to the already-present `chassis.txt` dialect fixture) instead of `backend/src/data/`, then repoint those 7 files' `readFileSync(new URL('../data/chassis.quiz.json', ...))` to `'../test/fixtures/chassis.quiz.json'` (adjust the relative segment per file's own depth). This both fixes the suite and keeps the file out of the `src/data/*.quiz.json` glob `quiz:seed` iterates with no arguments, so a stray `npm run quiz:seed` can never reintroduce automotive content into the running app.

- [ ] **Step 3: Rename the root package**

Read `package.json`, then:

```json
{
  "name": "liah-hsd",
  "version": "1.0.0",
  "description": "LIAH HSD — a high-school-diploma learning platform: students take quizzes toward a diploma and earn a certificate on completion.",
  ...
}
```

Use Edit to change only the `name` and `description` fields; leave `workspaces`, `scripts`, and `devDependencies` as copied.

- [ ] **Step 4: Point `docker-compose.yml` at this project's own container, port, and database name**

Replace the file's contents:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: liah-hsd-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: liah_hsd
      POSTGRES_PASSWORD: liah_hsd_dev_password
      POSTGRES_DB: liah_hsd
    # liah-learning's own Postgres container already uses 54330, so this
    # project exposes on 54331 instead, bound to loopback only.
    ports:
      - '127.0.0.1:54331:5432'
    volumes:
      - liah_hsd_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U liah_hsd -d liah_hsd']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  liah_hsd_pgdata:
```

- [ ] **Step 5: Point `backend/.env.example` at the same database**

Read `backend/.env.example`, then edit the `DATABASE_URL` line and its comment:

```
# Matches docker-compose.yml (host port 54331 to avoid a clash with other projects)
DATABASE_URL=postgresql://liah_hsd:liah_hsd_dev_password@127.0.0.1:54331/liah_hsd
```

Leave every other line (`PORT`, `CORS_ORIGIN`, `SESSION_TTL_DAYS`, `SERVE_FRONTEND`) unchanged.

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: completes with no errors (warnings about the `xlsx` tarball dependency are expected and pre-existing).

- [ ] **Step 7: Start local Postgres and push the schema**

```bash
npm run db:up
cp backend/.env.example backend/.env
npm run db:push
```

Expected: `db:up` reports the container healthy; `db:push` reports the schema applied with no prompts (first push on an empty database — if drizzle-kit prompts about table creation, accept the create-table option for every table).

- [ ] **Step 8: Boot the app and confirm the API responds**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/api/v1/health
kill %1
```

Expected: `{"status":"ok"}`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Bootstrap liah-hsd from liah-learning"
```

---

## Task 2: Rebrand — placeholder curriculum and the Registrar visual theme

**Files:**
- Create: `backend/src/scripts/seed-subjects.ts`, `backend/src/scripts/seed-subjects.test.ts`, `frontend/src/shell/BrandMark.tsx`
- Modify: `backend/package.json`, `package.json`, `frontend/src/shell/AppShell.tsx`, `frontend/src/auth/LoginForm.tsx`, `frontend/src/auth/ForcedPasswordChangeForm.tsx`, `frontend/src/App.css`, `frontend/src/index.css`, `frontend/index.html`, `frontend/src/shell/useTheme.ts`, `README.md`
- Delete: `frontend/src/assets/liah-logo.png`, `frontend/src/assets/fonts/`

**Interfaces:**
- Produces: `seedPlaceholderSubjects(): Promise<number>` (exported from `seed-subjects.ts`) — not consumed elsewhere in this plan, but documents the pattern later content-seeding scripts should follow.
- Produces: `BrandMark({ className }: { className?: string })` — consumed by `AppShell.tsx`, `LoginForm.tsx`, `ForcedPasswordChangeForm.tsx`.

### Placeholder curriculum

- [ ] **Step 1: Write the failing test for the subject seeder**

Create `backend/src/scripts/seed-subjects.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { subjects } from '../models/schema.ts';
import { seedPlaceholderSubjects } from './seed-subjects.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('seedPlaceholderSubjects inserts the four core subjects', async () => {
  const count = await seedPlaceholderSubjects();
  assert.equal(count, 4);

  const rows = await db.select().from(subjects);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.slug).sort(),
    ['english-language-arts', 'mathematics', 'science', 'social-studies'],
  );
});

test('seedPlaceholderSubjects is idempotent', async () => {
  await seedPlaceholderSubjects();
  await seedPlaceholderSubjects();

  const rows = await db.select().from(subjects);
  assert.equal(rows.length, 4);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/scripts/seed-subjects.test.ts"
```

Expected: FAIL — `Cannot find module './seed-subjects.ts'` (or similar), since the file doesn't exist yet. If `backend/.env.test` doesn't exist yet, first create it by copying `backend/.env.example` and changing the database name to `liah_hsd_test` (and run `npm run db:push:test` once against it) — mirror whatever `liah-learning/backend/.env.test` does, pointed at this project's own test database.

- [ ] **Step 3: Implement the seeder**

Create `backend/src/scripts/seed-subjects.ts`:

```ts
import { db, pool } from '../db/index.ts';
import { subjects } from '../models/schema.ts';

const PLACEHOLDER_SUBJECTS = [
  { slug: 'mathematics', title: 'Mathematics' },
  { slug: 'english-language-arts', title: 'English Language Arts' },
  { slug: 'science', title: 'Science' },
  { slug: 'social-studies', title: 'Social Studies' },
];

/**
 * Seeds the four core subjects with no courses yet. Real content (courses,
 * modules, questions) arrives later via the quiz:parse / quiz:seed pipeline,
 * once an HSD quiz pack exists — see docs/superpowers/specs for why this is
 * deliberately out of scope here.
 */
export async function seedPlaceholderSubjects(): Promise<number> {
  let count = 0;
  for (const subject of PLACEHOLDER_SUBJECTS) {
    await db
      .insert(subjects)
      .values(subject)
      .onConflictDoUpdate({ target: subjects.slug, set: { title: subject.title } });
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const count = await seedPlaceholderSubjects();
  console.log(`Seeded ${count} placeholder subjects.`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/scripts/seed-subjects.test.ts"
```

Expected: PASS, 2/2 tests.

- [ ] **Step 5: Register the script and seed the dev database**

Edit `backend/package.json`'s `scripts` to add:

```json
"seed:subjects": "node --import tsx --env-file-if-exists=.env src/scripts/seed-subjects.ts"
```

Edit the root `package.json`'s `scripts` to add:

```json
"seed:subjects": "npm run seed:subjects -w backend"
```

Then run it against the dev database:

```bash
npm run seed:subjects
```

Expected: `Seeded 4 placeholder subjects.`

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/seed-subjects.ts backend/src/scripts/seed-subjects.test.ts \
  backend/package.json package.json
git commit -m "Add placeholder HSD subjects seed script"
```

### Registrar visual theme

- [ ] **Step 7: Add the BrandMark component**

Create `frontend/src/shell/BrandMark.tsx`:

```tsx
/** The circular "LH" seal used as the app's wordmark, in the nav bar and on auth screens. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={className ? `brand-seal ${className}` : 'brand-seal'} aria-hidden="true">
      LH
    </span>
  );
}
```

- [ ] **Step 8: Replace the three `liah-logo.png` usages with BrandMark**

In `frontend/src/shell/AppShell.tsx`:
- Replace `import liahLogo from '../assets/liah-logo.png';` with `import { BrandMark } from './BrandMark';`
- Replace `<img src={liahLogo} alt="" className="topnav-mark" />` with `<BrandMark className="topnav-mark" />`
- Replace `<span className="topnav-brand-label">LIAH</span>` with `<span className="topnav-brand-label">LIAH HSD</span>`

In `frontend/src/auth/LoginForm.tsx`:
- Replace `import liahLogo from '../assets/liah-logo.png';` with `import { BrandMark } from '../shell/BrandMark';`
- Replace both `<img src={liahLogo} alt="LIAH" className="auth-mark" />` occurrences with `<BrandMark className="auth-mark" />`

In `frontend/src/auth/ForcedPasswordChangeForm.tsx`:
- Replace `import liahLogo from '../assets/liah-logo.png';` with `import { BrandMark } from '../shell/BrandMark';`
- Replace `<img src={liahLogo} alt="LIAH" className="auth-mark" />` with `<BrandMark className="auth-mark" />`

- [ ] **Step 9: Delete the now-unused logo and self-hosted font files**

```bash
rm -f frontend/src/assets/liah-logo.png
rm -rf frontend/src/assets/fonts
```

- [ ] **Step 10: Rewrite `frontend/src/index.css` with the Registrar palette and system-font stacks**

Replace the entire file:

```css
/* Registrar palette: navy #152542 (headings/primary), gold #9c7a2e (accent),
   white ground, slate-grey body text. No webfonts — a serif system stack
   for headings reads as "official document," a sans system stack for UI
   chrome reads as "application interface." */
:root {
  --text: #3c4458;
  --text-h: #152542;
  --bg: #ffffff;
  --surface: #f6f7fa;
  --border: #dde1e8;
  --code-bg: #f6f7fa;
  --accent: #9c7a2e;
  --accent-bg: rgba(156, 122, 46, 0.1);
  --accent-border: rgba(156, 122, 46, 0.45);
  --on-accent: #2a2000;
  --success: #1f7a4d;
  --warning: #9a6700;
  --danger: #b3261e;
  --danger-bg: rgba(179, 38, 30, 0.08);
  --social-bg: rgba(21, 37, 66, 0.05);
  --shadow:
    rgba(21, 37, 66, 0.12) 0 10px 15px -3px, rgba(21, 37, 66, 0.06) 0 4px 6px -2px;

  --sans: -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
  --heading: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  --mono: ui-monospace, Consolas, monospace;

  font: 16px/150% var(--sans);
  color-scheme: light dark;
  color: var(--text);
  background: var(--bg);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Dark mode: a near-black navy ground, gold lifted for contrast on it.

   Keyed off data-theme rather than a prefers-color-scheme query: an inline
   script in index.html resolves the OS setting (or a stored preference) to a
   concrete light/dark value before first paint, so a manual choice can
   override the OS and dark users get no flash of light. */
:root[data-theme='dark'] {
  --text: #c7cfdf;
  --text-h: #eef1f7;
  --bg: #0f1829;
  --surface: #182238;
  --border: #2c3a55;
  --code-bg: #182238;
  --accent: #c9a227;
  --accent-bg: rgba(201, 162, 39, 0.16);
  --accent-border: rgba(201, 162, 39, 0.45);
  --on-accent: #1b1400;
  --success: #4ecb84;
  --warning: #e0a750;
  --danger: #ef7a72;
  --danger-bg: rgba(239, 122, 114, 0.14);
  --social-bg: rgba(24, 34, 56, 0.6);
  --shadow:
    rgba(0, 0, 0, 0.5) 0 10px 15px -3px, rgba(0, 0, 0, 0.35) 0 4px 6px -2px;
  color-scheme: dark;
}

:root[data-theme='light'] {
  color-scheme: light;
}

/* Full width, no frame. */
#root {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}

body {
  margin: 0;
}

h1,
h2 {
  font-family: var(--heading);
  font-weight: 400;
  color: var(--text-h);
}

h1 {
  font-size: 1.6rem;
  line-height: 1.25;
  margin: 0 0 0.35rem;
}
h2 {
  font-size: 1.15rem;
  line-height: 1.3;
  margin: 0 0 0.5rem;
}
p {
  margin: 0;
}

code,
.counter {
  font-family: var(--mono);
  display: inline-flex;
  border-radius: 4px;
  color: var(--text-h);
}

code {
  font-size: 15px;
  line-height: 135%;
  padding: 4px 8px;
  background: var(--code-bg);
}
```

- [ ] **Step 11: Restyle the brand seal and remove the old image-specific rules**

In `frontend/src/App.css`, replace the `.auth-mark` block:

```css
.auth-mark {
  display: block;
  width: 3.5rem;
  height: 3.5rem;
  margin: 0 auto;
  object-fit: contain;
}
```

with:

```css
.auth-mark {
  width: 3.5rem;
  height: 3.5rem;
  margin: 0 auto;
  font-size: 1.4rem;
  border-width: 2px;
}
```

and the `.topnav-mark` block:

```css
.topnav-mark {
  display: block;
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  object-fit: contain;
}
```

with:

```css
.topnav-mark {
  width: 1.75rem;
  height: 1.75rem;
  font-size: 0.75rem;
}
```

Then add a new rule (anywhere near those two, e.g. just above `.auth-mark`):

```css
.brand-seal {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1.5px solid var(--accent);
  color: var(--accent);
  font-family: var(--heading);
  font-weight: 700;
}
```

- [ ] **Step 12: Update the page title and theme storage key**

In `frontend/index.html`, change `<title>LIAH</title>` to `<title>LIAH HSD</title>`, and change `localStorage.getItem('liah.theme')` to `localStorage.getItem('liah-hsd.theme')`.

In `frontend/src/shell/useTheme.ts`, change `const STORAGE_KEY = 'liah.theme';` to `const STORAGE_KEY = 'liah-hsd.theme';`.

- [ ] **Step 13: Rewrite `README.md`**

```markdown
# LIAH HSD

A high-school-diploma learning platform for LIAH Wellness — students browse
subjects and courses, take quizzes, review their results, track progress, and
earn a downloadable diploma certificate once every course is passed. Admins
can import quizzes/users and review learner attempts.

## Stack

- **Frontend**: React 19 + TypeScript, Vite, React Router, Vitest + Testing Library
- **Backend**: Express 5 + TypeScript, Drizzle ORM, PostgreSQL, Argon2 (password hashing), Zod (validation), pdfkit (certificates)
- **Monorepo**: npm workspaces (`backend`, `frontend`), run together with `concurrently`
- **Deployment**: Vercel (see `vercel.json` — frontend served as a Vite app, backend as a serverless function, `/api/*` routed to the backend)

## Project structure

```
backend/
  src/
    routes/        # auth, catalog, quiz, admin, admin-import, certificates
    controllers/    # request handlers (one per route group, with colocated tests)
    models/         # Drizzle schema + data access (users, quizzes, attempts, sessions, catalog, certificates)
    middleware/
    lib/, config/, types/
    scripts/        # quiz PDF parsing, quiz/admin/subject seeding
  drizzle.config.ts

frontend/
  src/
    pages/          # QuizPage, ResultsPage, ProgressPage, ProfilePage, SubjectCoursesPage, admin/*
    quiz/           # quiz-taking logic & components (useQuizAttempt, QuestionCard, ReviewGrid, ...)
    certificates/   # certificate status card + API client
    admin/, auth/, shell/, shared/, lib/

docs/               # project docs
docker-compose.yml  # local Postgres for development
```

## Getting started

### Prerequisites

- Node.js
- Docker (for local Postgres)

### Setup

```bash
npm install

# start local Postgres (docker-compose.yml)
npm run db:up

# copy and adjust backend env
cp backend/.env.example backend/.env

# push the Drizzle schema to the database
npm run db:push

# seed the four placeholder subjects (Mathematics, English Language Arts,
# Science, Social Studies) — real courses/quizzes arrive later
npm run seed:subjects
```

### Run

```bash
npm run dev          # runs backend (API) and frontend (web) concurrently
npm run dev:api       # backend only
npm run dev:web       # frontend only
```

In dev, Vite proxies API requests so the frontend and backend share an origin.

### Seeding data

```bash
npm run seed:subjects # placeholder subjects with no courses yet
npm run quiz:parse    # parse a quiz PDF into source data, once a pack exists
npm run quiz:seed     # seed quizzes into the database
npm run db:generate    # generate Drizzle migrations from schema changes
```

An admin user seed script is available via the backend workspace (`seed:admin`).

### Testing & type checking

```bash
npm run test          # backend + frontend tests
npm run test:api
npm run test:web
npm run typecheck
```

### Build

```bash
npm run build          # builds backend then frontend
```

## Environment variables

See `backend/.env.example` for the full list, including:

- `DATABASE_URL` — Postgres connection string (matches `docker-compose.yml` by default, on port `54331`)
- `PORT`, `NODE_ENV`
- `CORS_ORIGIN` — only needed if the frontend is served from a different origin than the API
- `SESSION_TTL_DAYS` — login session lifetime
- `SERVE_FRONTEND` — set `true` in production to serve `frontend/dist` from the backend with an SPA fallback
```

- [ ] **Step 14: Verify everything still typechecks and boots**

```bash
npm run typecheck
npm run dev &
sleep 3
curl -s http://localhost:5173 | grep -o '<title>[^<]*</title>'
kill %1
```

Expected: `typecheck` exits 0; the curl output is `<title>LIAH HSD</title>`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "Rebrand to LIAH HSD with the Registrar visual theme"
```

---

## Task 3: Certificates — schema and data layer

**Files:**
- Modify: `backend/src/models/schema.ts`, `backend/src/test/helpers/db.ts`
- Create: `backend/src/models/certificate.model.ts`, `backend/src/models/certificate.model.test.ts`

**Interfaces:**
- Consumes: `db` from `../db/index.ts`; `attempts`, `courses` tables from `./schema.ts` (existing).
- Produces: `CertificateRow = { id: string; userId: string; verificationId: string; issuedAt: Date }`; `EligibilitySummary = { totalCourses: number; passedCourses: number; eligible: boolean }`; `getEligibilitySummary(userId: string): Promise<EligibilitySummary>`; `findCertificateByUserId(userId: string): Promise<CertificateRow | null>`; `findCertificateById(id: string): Promise<CertificateRow | null>`; `findCertificateByVerificationId(verificationId: string): Promise<CertificateRow | null>`; `checkAndIssueCertificate(userId: string): Promise<CertificateRow | null>` — all consumed by Task 4's controller and Task 5's submit hook.

- [ ] **Step 1: Add the `certificates` table to the schema**

In `backend/src/models/schema.ts`, add after the `attemptAnswers` table and its type exports:

```ts
export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Short public code printed on the PDF and checked by the public verify endpoint. */
  verificationId: text('verification_id').notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Certificate = typeof certificates.$inferSelect;
```

- [ ] **Step 2: Push the schema change to the dev and test databases**

```bash
npm run db:push
npm run db:push:test
```

Expected: both report the new `certificates` table created (accept the create-table prompt if drizzle-kit asks).

- [ ] **Step 3: Add `certificates` to the test truncation list**

In `backend/src/test/helpers/db.ts`, change:

```ts
  await db.execute(sql`
    truncate table attempt_answers, attempts, question_options, questions,
                   modules, courses, subjects, sessions, users
    restart identity cascade
  `);
```

to:

```ts
  await db.execute(sql`
    truncate table certificates, attempt_answers, attempts, question_options,
                   questions, modules, courses, subjects, sessions, users
    restart identity cascade
  `);
```

- [ ] **Step 4: Write the failing test for eligibility and issuance**

Create `backend/src/models/certificate.model.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';
import { createUser } from './user.model.ts';
import {
  checkAndIssueCertificate,
  findCertificateByUserId,
  getEligibilitySummary,
} from './certificate.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function makeSubjectWithCourse(passScore = 8) {
  const [subject] = await db
    .insert(subjects)
    .values({ slug: `subject-${Date.now()}-${Math.random()}`, title: 'Test Subject' })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({
      subjectId: subject!.id,
      position: 1,
      slug: `course-${Date.now()}-${Math.random()}`,
      title: 'Test Course',
      passScore,
      questionCount: 10,
    })
    .returning();
  return course!;
}

async function submitScore(userId: string, courseId: string, score: number) {
  await db.insert(attempts).values({ userId, courseId, score, submittedAt: new Date() });
}

test('getEligibilitySummary: not eligible with zero active courses', async () => {
  const user = await createUser('No', 'Courses', 'hash', 'user', false);
  const summary = await getEligibilitySummary(user.id);
  assert.deepEqual(summary, { totalCourses: 0, passedCourses: 0, eligible: false });
});

test('getEligibilitySummary: not eligible until every course is passed', async () => {
  const user = await createUser('Partial', 'Progress', 'hash', 'user', false);
  const courseA = await makeSubjectWithCourse(8);
  const courseB = await makeSubjectWithCourse(8);
  await submitScore(user.id, courseA.id, 9);
  // courseB never attempted.

  const summary = await getEligibilitySummary(user.id);
  assert.equal(summary.totalCourses, 2);
  assert.equal(summary.passedCourses, 1);
  assert.equal(summary.eligible, false);
});

test('getEligibilitySummary: eligible once every active course meets its passScore', async () => {
  const user = await createUser('All', 'Passed', 'hash', 'user', false);
  const courseA = await makeSubjectWithCourse(8);
  const courseB = await makeSubjectWithCourse(8);
  await submitScore(user.id, courseA.id, 9);
  await submitScore(user.id, courseB.id, 8);

  const summary = await getEligibilitySummary(user.id);
  assert.deepEqual(summary, { totalCourses: 2, passedCourses: 2, eligible: true });
});

test('checkAndIssueCertificate: issues nothing when not yet eligible', async () => {
  const user = await createUser('Not', 'Eligible', 'hash', 'user', false);
  await makeSubjectWithCourse(8);

  const result = await checkAndIssueCertificate(user.id);
  assert.equal(result, null);
});

test('checkAndIssueCertificate: issues a certificate once eligible, and is idempotent', async () => {
  const user = await createUser('Graduate', 'Student', 'hash', 'user', false);
  const course = await makeSubjectWithCourse(8);
  await submitScore(user.id, course.id, 9);

  const first = await checkAndIssueCertificate(user.id);
  assert.ok(first);
  assert.match(first!.verificationId, /^LH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const second = await checkAndIssueCertificate(user.id);
  assert.equal(second!.id, first!.id);

  const stored = await findCertificateByUserId(user.id);
  assert.equal(stored!.id, first!.id);
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/models/certificate.model.test.ts"
```

Expected: FAIL — `certificate.model.ts` does not exist.

- [ ] **Step 6: Implement `certificate.model.ts`**

Create `backend/src/models/certificate.model.ts`:

```ts
import { randomInt } from 'node:crypto';
import { and, count, eq, max } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, certificates, courses } from './schema.ts';

export type CertificateRow = {
  id: string;
  userId: string;
  verificationId: string;
  issuedAt: Date;
};

export type EligibilitySummary = {
  totalCourses: number;
  passedCourses: number;
  eligible: boolean;
};

async function countActiveCourses(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(courses)
    .where(eq(courses.isActive, true));
  return Number(row?.total ?? 0);
}

/** Active courses where this user's best submitted score meets passScore. */
async function countPassedActiveCourses(userId: string): Promise<number> {
  const rows = await db
    .select({ passScore: courses.passScore, best: max(attempts.score) })
    .from(courses)
    .innerJoin(attempts, and(eq(attempts.courseId, courses.id), eq(attempts.userId, userId)))
    .where(eq(courses.isActive, true))
    .groupBy(courses.id, courses.passScore);

  return rows.filter((r) => r.best !== null && Number(r.best) >= r.passScore).length;
}

/**
 * Diploma eligibility: every active course passed. Zero active courses means
 * not eligible — there is no curriculum to have completed yet.
 */
export async function getEligibilitySummary(userId: string): Promise<EligibilitySummary> {
  const [totalCourses, passedCourses] = await Promise.all([
    countActiveCourses(),
    countPassedActiveCourses(userId),
  ]);
  return {
    totalCourses,
    passedCourses,
    eligible: totalCourses > 0 && passedCourses === totalCourses,
  };
}

/** `LH-XXXX-XXXX` in base36, uppercased — short enough to read off a certificate. */
function generateVerificationId(): string {
  const part = () => randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
  return `LH-${part()}-${part()}`;
}

export async function findCertificateByUserId(userId: string): Promise<CertificateRow | null> {
  const [row] = await db.select().from(certificates).where(eq(certificates.userId, userId)).limit(1);
  return row ?? null;
}

export async function findCertificateById(id: string): Promise<CertificateRow | null> {
  const [row] = await db.select().from(certificates).where(eq(certificates.id, id)).limit(1);
  return row ?? null;
}

export async function findCertificateByVerificationId(
  verificationId: string,
): Promise<CertificateRow | null> {
  const [row] = await db
    .select()
    .from(certificates)
    .where(eq(certificates.verificationId, verificationId))
    .limit(1);
  return row ?? null;
}

/**
 * Issues a certificate if the user is eligible and doesn't already have one.
 * Idempotent: a second call after issuance just returns the existing row.
 */
export async function checkAndIssueCertificate(userId: string): Promise<CertificateRow | null> {
  const existing = await findCertificateByUserId(userId);
  if (existing) return existing;

  const { eligible } = await getEligibilitySummary(userId);
  if (!eligible) return null;

  const [inserted] = await db
    .insert(certificates)
    .values({ userId, verificationId: generateVerificationId() })
    .onConflictDoNothing({ target: certificates.userId })
    .returning();

  if (inserted) return inserted;

  // Conflict: issued concurrently between our check and insert.
  return findCertificateByUserId(userId);
}
```

- [ ] **Step 7: Run the test again to verify it passes**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/models/certificate.model.test.ts"
```

Expected: PASS, 5/5 tests.

- [ ] **Step 8: Run the full backend suite to confirm nothing else broke**

```bash
npm run test:api
```

Expected: all tests pass, including the pre-existing ones.

- [ ] **Step 9: Commit**

```bash
git add backend/src/models/schema.ts backend/src/models/certificate.model.ts \
  backend/src/models/certificate.model.test.ts backend/src/test/helpers/db.ts
git commit -m "Add certificates table and eligibility/issuance model"
```

---

## Task 4: Certificates — PDF generation and API routes

**Files:**
- Modify: `backend/package.json`, `backend/src/models/user.model.ts`, `backend/src/routes/index.ts`
- Create: `backend/src/lib/certificate-pdf.ts`, `backend/src/controllers/certificate.controller.ts`, `backend/src/controllers/certificate.controller.test.ts`, `backend/src/routes/certificate.routes.ts`

**Interfaces:**
- Consumes: `checkAndIssueCertificate`, `findCertificateById`, `findCertificateByVerificationId`, `getEligibilitySummary` from `../models/certificate.model.ts` (Task 3); `param` from `../lib/http.ts`; `requireAuth` from `../middleware/auth.middleware.ts`.
- Produces: `findUserById(id: string): Promise<PublicUser | null>` on `user.model.ts`; `buildCertificatePdf(data: CertificatePdfData): PDFKit.PDFDocument` on `certificate-pdf.ts`; routes `GET /certificates/me`, `GET /certificates/:id/download`, `GET /certificates/verify/:verificationId` mounted under `/api/v1`.

- [ ] **Step 1: Add `pdfkit`**

Edit `backend/package.json`'s `dependencies` to add:

```json
"pdfkit": "^0.15.0"
```

and `devDependencies` to add:

```json
"@types/pdfkit": "^0.13.4"
```

Then:

```bash
npm install
```

- [ ] **Step 2: Add `findUserById` to `user.model.ts`**

In `backend/src/models/user.model.ts`, add after `findUserByIdWithHash`:

```ts
/** The safe-to-send shape, by id. Used wherever a caller needs someone else's
 *  public profile (e.g. the certificate it belongs to), not their own. */
export async function findUserById(id: string): Promise<PublicUser | null> {
  const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}
```

- [ ] **Step 3: Write the certificate PDF builder**

Create `backend/src/lib/certificate-pdf.ts`:

```ts
import PDFDocument from 'pdfkit';

export type CertificatePdfData = {
  recipientName: string;
  verificationId: string;
  issuedAt: Date;
};

const NAVY = '#152542';
const GOLD = '#9c7a2e';
const SUBTEXT = '#5a6378';

/**
 * Draws the certificate onto a new landscape A4 document and returns it
 * unended. The caller pipes it to a destination and calls `.end()` — kept
 * separate so the same document can be streamed to an HTTP response.
 */
export function buildCertificatePdf({
  recipientName,
  verificationId,
  issuedAt,
}: CertificatePdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const { width, height } = doc.page;
  const margin = 36;

  doc
    .rect(margin, margin, width - margin * 2, height - margin * 2)
    .lineWidth(3)
    .stroke(NAVY);
  doc
    .rect(margin + 14, margin + 14, width - (margin + 14) * 2, height - (margin + 14) * 2)
    .lineWidth(1)
    .stroke(GOLD);

  doc.circle(width / 2, margin + 70, 28).lineWidth(2).stroke(GOLD);
  doc
    .fillColor(GOLD)
    .font('Times-Bold')
    .fontSize(20)
    .text('LH', width / 2 - 28, margin + 60, { width: 56, align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(12)
    .text('CERTIFICATE OF COMPLETION', 0, margin + 125, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(14)
    .text('This certifies that', 0, margin + 155, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Bold')
    .fontSize(30)
    .text(recipientName, 0, margin + 180, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(14)
    .text('has fulfilled all requirements of the', 0, margin + 228, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Bold')
    .fontSize(14)
    .text('LIAH High School Diploma Program', 0, margin + 248, { align: 'center' });

  doc
    .fillColor(SUBTEXT)
    .font('Times-Roman')
    .fontSize(10)
    .text(
      `Issued ${issuedAt.toISOString().slice(0, 10)}  ·  Verification ID: ${verificationId}`,
      0,
      height - margin - 40,
      { align: 'center' },
    );

  return doc;
}
```

- [ ] **Step 4: Write the failing controller test**

Create `backend/src/controllers/certificate.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from '../models/schema.ts';

let server: { baseUrl: string; close: () => Promise<void> };

before(async () => {
  await resetDb();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function makeSubjectWithCourse(passScore = 8) {
  const [subject] = await db
    .insert(subjects)
    .values({ slug: `subject-${Date.now()}-${Math.random()}`, title: 'Test Subject' })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({
      subjectId: subject!.id,
      position: 1,
      slug: `course-${Date.now()}-${Math.random()}`,
      title: 'Test Course',
      passScore,
      questionCount: 10,
    })
    .returning();
  return course!;
}

test('GET /certificates/me reports locked status before completion', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'CertLocked');
  await makeSubjectWithCourse(8);

  const res = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; remainingCourses: number };
  assert.equal(body.status, 'locked');
  assert.equal(body.remainingCourses, 1);
});

test('GET /certificates/me issues and GET /certificates/:id/download streams a PDF once eligible', async () => {
  const { cookie, userId } = await registerTestUser(server.baseUrl, 'CertEligible');
  const course = await makeSubjectWithCourse(8);
  await db.insert(attempts).values({ userId, courseId: course.id, score: 9, submittedAt: new Date() });

  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(meRes.status, 200);
  const meBody = (await meRes.json()) as {
    status: string;
    certificate: { id: string; verificationId: string };
  };
  assert.equal(meBody.status, 'issued');

  const downloadRes = await fetch(
    `${server.baseUrl}/api/v1/certificates/${meBody.certificate.id}/download`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
  const bytes = await downloadRes.arrayBuffer();
  assert.ok(bytes.byteLength > 0);
});

test('GET /certificates/:id/download rejects someone else’s certificate', async () => {
  const owner = await registerTestUser(server.baseUrl, 'CertOwner');
  const course = await makeSubjectWithCourse(8);
  await db
    .insert(attempts)
    .values({ userId: owner.userId, courseId: course.id, score: 9, submittedAt: new Date() });
  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: owner.cookie },
  });
  const meBody = (await meRes.json()) as { certificate: { id: string } };

  const stranger = await registerTestUser(server.baseUrl, 'CertStranger');
  const res = await fetch(`${server.baseUrl}/api/v1/certificates/${meBody.certificate.id}/download`, {
    headers: { Cookie: stranger.cookie },
  });
  assert.equal(res.status, 403);
});

test('GET /certificates/verify/:verificationId is public and 404s on an unknown code', async () => {
  const res = await fetch(`${server.baseUrl}/api/v1/certificates/verify/LH-0000-0000`);
  assert.equal(res.status, 404);
});

test('GET /certificates/verify/:verificationId confirms a real certificate without auth', async () => {
  const { cookie, userId } = await registerTestUser(server.baseUrl, 'CertVerify');
  const course = await makeSubjectWithCourse(8);
  await db.insert(attempts).values({ userId, courseId: course.id, score: 9, submittedAt: new Date() });
  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const meBody = (await meRes.json()) as { certificate: { verificationId: string } };

  const res = await fetch(
    `${server.baseUrl}/api/v1/certificates/verify/${meBody.certificate.verificationId}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { valid: boolean; program: string };
  assert.equal(body.valid, true);
  assert.equal(body.program, 'LIAH High School Diploma Program');
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/controllers/certificate.controller.test.ts"
```

Expected: FAIL — no `/api/v1/certificates/*` routes exist yet (404s where the test expects 200/403).

- [ ] **Step 6: Implement the controller**

Create `backend/src/controllers/certificate.controller.ts`:

```ts
import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import { buildCertificatePdf } from '../lib/certificate-pdf.ts';
import {
  checkAndIssueCertificate,
  findCertificateById,
  findCertificateByVerificationId,
  getEligibilitySummary,
} from '../models/certificate.model.ts';
import { findUserById } from '../models/user.model.ts';

function recipientName(user: { firstName: string | null; lastName: string | null; username: string }): string {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.username;
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const issued = await checkAndIssueCertificate(userId);
  if (issued) {
    res.json({
      status: 'issued',
      certificate: {
        id: issued.id,
        verificationId: issued.verificationId,
        issuedAt: issued.issuedAt,
      },
    });
    return;
  }

  const { totalCourses, passedCourses } = await getEligibilitySummary(userId);
  res.json({ status: 'locked', remainingCourses: totalCourses - passedCourses, totalCourses });
}

export async function download(req: Request, res: Response): Promise<void> {
  const certificate = await findCertificateById(param(req, 'id'));
  if (!certificate) {
    res.status(404).json({ error: 'Certificate not found' });
    return;
  }
  if (certificate.userId !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Not your certificate' });
    return;
  }

  const user = await findUserById(certificate.userId);
  if (!user) {
    res.status(404).json({ error: 'Certificate not found' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="liah-hsd-certificate-${certificate.verificationId}.pdf"`,
  );

  const doc = buildCertificatePdf({
    recipientName: recipientName(user),
    verificationId: certificate.verificationId,
    issuedAt: certificate.issuedAt,
  });
  doc.pipe(res);
  doc.end();
}

export async function verify(req: Request, res: Response): Promise<void> {
  const certificate = await findCertificateByVerificationId(param(req, 'verificationId'));
  if (!certificate) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const user = await findUserById(certificate.userId);
  if (!user) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json({
    valid: true,
    recipientName: recipientName(user),
    program: 'LIAH High School Diploma Program',
    issuedAt: certificate.issuedAt,
  });
}
```

- [ ] **Step 7: Add the routes**

Create `backend/src/routes/certificate.routes.ts`:

```ts
import { Router } from 'express';
import * as certificate from '../controllers/certificate.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const certificateRouter = Router();

certificateRouter.get('/certificates/me', requireAuth, certificate.getMine);
certificateRouter.get('/certificates/:id/download', requireAuth, certificate.download);
certificateRouter.get('/certificates/verify/:verificationId', certificate.verify);
```

In `backend/src/routes/index.ts`, add the import:

```ts
import { certificateRouter } from './certificate.routes.ts';
```

and mount it alongside the other `/`-mounted routers:

```ts
apiRouter.use('/', catalogRouter);
apiRouter.use('/', quizRouter);
apiRouter.use('/', certificateRouter);
```

- [ ] **Step 8: Run the test again to verify it passes**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/controllers/certificate.controller.test.ts"
```

Expected: PASS, 5/5 tests.

- [ ] **Step 9: Run the full backend suite**

```bash
npm run test:api
npm run typecheck -w backend
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add backend/package.json package-lock.json backend/src/models/user.model.ts \
  backend/src/lib/certificate-pdf.ts backend/src/controllers/certificate.controller.ts \
  backend/src/controllers/certificate.controller.test.ts backend/src/routes/certificate.routes.ts \
  backend/src/routes/index.ts
git commit -m "Add certificate PDF generation and API routes"
```

---

## Task 5: Wire certificate issuance into quiz submission

**Files:**
- Create: `backend/src/controllers/attempt.controller.test.ts` (does not exist yet in `liah-learning` — confirmed by listing `backend/src/controllers/*.controller.test.ts` during planning)
- Modify: `backend/src/controllers/attempt.controller.ts`

**Interfaces:**
- Consumes: `checkAndIssueCertificate` from `../models/certificate.model.ts` (Task 3).
- Produces: nothing new consumed later — this task only changes `submit`'s side effect.

- [ ] **Step 1: Write the failing test file**

Create `backend/src/controllers/attempt.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { db } from '../db/index.ts';
import { modules, questionOptions, questions, courses, subjects } from '../models/schema.ts';

let server: { baseUrl: string; close: () => Promise<void> };

before(async () => {
  await resetDb();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

/** One course with exactly one question whose single option is correct, so
 *  answering it and submitting always scores 1/1. */
async function makeSingleQuestionCourse(passScore = 1) {
  const [subject] = await db
    .insert(subjects)
    .values({ slug: `subject-${Date.now()}-${Math.random()}`, title: 'Test Subject' })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({
      subjectId: subject!.id,
      position: 1,
      slug: `course-${Date.now()}-${Math.random()}`,
      title: 'Test Course',
      passScore,
      questionCount: 1,
    })
    .returning();
  const [module] = await db
    .insert(modules)
    .values({ courseId: course!.id, title: 'Module 1' })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({ courseId: course!.id, moduleId: module!.id, position: 1, prompt: 'Q1', explanation: 'E1' })
    .returning();
  const [option] = await db
    .insert(questionOptions)
    .values({ questionId: question!.id, label: 'A', body: 'Correct', isCorrect: true })
    .returning();
  return { course: course!, question: question!, option: option! };
}

test('submitting an attempt that completes the last course issues a certificate', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'SubmitGraduate');
  const { course, question, option } = await makeSingleQuestionCourse(1);

  const startRes = await fetch(`${server.baseUrl}/api/v1/courses/${course.slug}/attempts`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const { attempt } = (await startRes.json()) as { attempt: { id: string } };

  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/answers/${question.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: option.id }),
  });

  const submitRes = await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(submitRes.status, 200);

  const certRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const certBody = (await certRes.json()) as { status: string };
  assert.equal(certBody.status, 'issued');
});

test('submitting an attempt that does not complete every course leaves the certificate locked', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'SubmitPartial');
  const { course: courseA, question: questionA, option: optionA } = await makeSingleQuestionCourse(1);
  await makeSingleQuestionCourse(1); // courseB — never attempted

  const startRes = await fetch(`${server.baseUrl}/api/v1/courses/${courseA.slug}/attempts`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const { attempt } = (await startRes.json()) as { attempt: { id: string } };

  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/answers/${questionA.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: optionA.id }),
  });
  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });

  const certRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const certBody = (await certRes.json()) as { status: string; remainingCourses: number };
  assert.equal(certBody.status, 'locked');
  assert.equal(certBody.remainingCourses, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/controllers/attempt.controller.test.ts"
```

Expected: FAIL — `certificates/me` reports `locked` because `submit` doesn't trigger issuance yet.

- [ ] **Step 3: Wire the issuance check into `submit`**

In `backend/src/controllers/attempt.controller.ts`, add the import:

```ts
import { checkAndIssueCertificate } from '../models/certificate.model.ts';
```

and change `submit` from:

```ts
export async function submit(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  // Idempotent: a second submit returns the existing grade rather than regrading.
  if (!attempt.submittedAt) {
    await submitAttempt(attempt.id);
  }

  const graded = await findGradedAttempt(attempt.id);
  if (!graded) {
    res.status(500).json({ error: 'Attempt could not be graded' });
    return;
  }
  res.json({ attempt: graded });
}
```

to:

```ts
export async function submit(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  // Idempotent: a second submit returns the existing grade rather than regrading.
  if (!attempt.submittedAt) {
    await submitAttempt(attempt.id);
    // Best-effort: a failure here must not fail the submission itself.
    // checkAndIssueCertificate is idempotent, so the next
    // GET /certificates/me simply retries it.
    try {
      await checkAndIssueCertificate(req.user!.id);
    } catch (err) {
      console.error('certificate issuance check failed', err);
    }
  }

  const graded = await findGradedAttempt(attempt.id);
  if (!graded) {
    res.status(500).json({ error: 'Attempt could not be graded' });
    return;
  }
  res.json({ attempt: graded });
}
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
node --import tsx --env-file=backend/.env.test --test --test-concurrency=1 "backend/src/controllers/attempt.controller.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

```bash
npm run test:api
npm run typecheck -w backend
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/attempt.controller.ts backend/src/controllers/attempt.controller.test.ts
git commit -m "Issue a certificate when the last required course is submitted"
```

---

## Task 6: Certificates — frontend card on the Progress page

**Files:**
- Modify: `frontend/src/pages/ProgressPage.tsx`, `frontend/src/App.css`
- Create: `frontend/src/certificates/api.ts`, `frontend/src/certificates/CertificateCard.tsx`, `frontend/src/certificates/CertificateCard.test.tsx`

**Interfaces:**
- Consumes: `request` from `../lib/apiClient` (existing pattern from `quiz/api.ts`).
- Produces: `certificatesApi.getMine(): Promise<CertificateStatus>`; `CertificateCard({ status }: { status: CertificateStatus })` — consumed by `ProgressPage.tsx`.

- [ ] **Step 1: Write the API client module**

Create `frontend/src/certificates/api.ts`:

```ts
import { request } from '../lib/apiClient';

export type CertificateStatus =
  | { status: 'locked'; remainingCourses: number; totalCourses: number }
  | {
      status: 'issued';
      certificate: { id: string; verificationId: string; issuedAt: string };
    };

export const certificatesApi = {
  getMine: () => request<CertificateStatus>('/certificates/me'),
  downloadUrl: (certificateId: string) => `/api/v1/certificates/${certificateId}/download`,
};
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/certificates/CertificateCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CertificateCard } from './CertificateCard';

describe('CertificateCard', () => {
  test('shows remaining course count when locked', () => {
    render(<CertificateCard status={{ status: 'locked', remainingCourses: 2, totalCourses: 6 }} />);
    expect(screen.getByText(/2 subjects? remaining/i)).toBeInTheDocument();
  });

  test('shows a download link when issued', () => {
    render(
      <CertificateCard
        status={{
          status: 'issued',
          certificate: { id: 'abc123', verificationId: 'LH-ABCD-1234', issuedAt: '2026-11-18T00:00:00.000Z' },
        }}
      />,
    );
    expect(screen.getByText('LH-ABCD-1234')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', '/api/v1/certificates/abc123/download');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm run test:web -- CertificateCard
```

Expected: FAIL — `./CertificateCard` module not found.

- [ ] **Step 4: Implement the component**

Create `frontend/src/certificates/CertificateCard.tsx`:

```tsx
import { certificatesApi, type CertificateStatus } from './api';

export function CertificateCard({ status }: { status: CertificateStatus }) {
  if (status.status === 'issued') {
    const { certificate } = status;
    return (
      <div className="cert-card cert-card-issued">
        <span className="brand-seal cert-card-seal" aria-hidden="true">
          LH
        </span>
        <div>
          <h3>Diploma Certificate</h3>
          <p>
            Verification ID: <code>{certificate.verificationId}</code>
          </p>
          <a
            className="cert-card-download"
            href={certificatesApi.downloadUrl(certificate.id)}
          >
            Download certificate
          </a>
        </div>
      </div>
    );
  }

  const label =
    status.remainingCourses === 1
      ? '1 subject remaining'
      : `${status.remainingCourses} subjects remaining`;

  return (
    <div className="cert-card cert-card-locked">
      <span className="brand-seal cert-card-seal" aria-hidden="true">
        LH
      </span>
      <div>
        <h3>Diploma Certificate</h3>
        <p>{label} before your certificate unlocks.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test again to verify it passes**

```bash
npm run test:web -- CertificateCard
```

Expected: PASS, 2/2 tests.

- [ ] **Step 6: Add the card's styles**

Append to `frontend/src/App.css`:

```css
.cert-card {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1.1rem 1.25rem;
  margin: 1.25rem 0;
  background: var(--surface);
}

.cert-card-seal {
  width: 2.75rem;
  height: 2.75rem;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.cert-card h3 {
  font-family: var(--heading);
  font-weight: 400;
  margin: 0 0 0.35rem;
  color: var(--text-h);
}

.cert-card p {
  margin: 0 0 0.5rem;
}

.cert-card-download {
  display: inline-block;
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  border-radius: 3px;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
}
```

- [ ] **Step 7: Wire the card into the Progress page**

In `frontend/src/pages/ProgressPage.tsx`:

Add the import:

```ts
import { certificatesApi, type CertificateStatus } from '../certificates/api';
import { CertificateCard } from '../certificates/CertificateCard';
```

Change the `State` type to also carry certificate status:

```ts
type State =
  | { kind: 'ready'; courses: ProgressCourse[]; certificate: CertificateStatus | null }
  | { kind: 'error'; message: string };
```

Change the effect to fetch both in parallel, tolerating the certificate fetch failing independently of progress:

```ts
useEffect(() => {
  let cancelled = false;

  void (async () => {
    try {
      const [{ courses }, certificate] = await Promise.all([
        quizApi.getMyProgress(),
        certificatesApi.getMine().catch(() => null),
      ]);
      if (!cancelled) setState({ kind: 'ready', courses, certificate });
    } catch (err) {
      if (!cancelled) {
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not load your progress',
        });
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}, []);
```

Change the destructure and render to include the card right after the `<h1>`:

```tsx
const { courses, certificate } = state;

return (
  <div className="course-list">
    <h1>My Progress</h1>

    {certificate && <CertificateCard status={certificate} />}

    {courses.length === 0 ? (
```

- [ ] **Step 8: Run the full frontend suite and typecheck**

```bash
npm run test:web
npm run typecheck -w frontend
```

Expected: all green. (`typecheck -w frontend` runs `tsc -b && vite build` per the workspace's `build` script — use `npm run build -w frontend` if `typecheck` isn't defined at the frontend-workspace level; the root `npm run typecheck` already covers this.)

- [ ] **Step 9: Visual check in a real browser**

```bash
npm run dev &
sleep 3
```

Open `http://localhost:5173` in a browser (or use the `run` skill / claude-in-chrome tools if available), log in as a test user, and visit **Progress**. Confirm the certificate card renders in the Registrar navy/gold style and shows a sensible "N subjects remaining" message when no courses are passed yet. Then:

```bash
kill %1
```

- [ ] **Step 10: Commit**

```bash
git add frontend/src/certificates frontend/src/pages/ProgressPage.tsx frontend/src/App.css
git commit -m "Show diploma certificate status and download on the Progress page"
```

---

## Task 7: Final docs and verification

**Files:**
- Modify: agent-wiki `Home.md` and a new project note (outside this repo)
- No code changes — verification only

**Interfaces:** None — this task closes out the plan.

- [ ] **Step 1: Run the full test suite and typecheck one more time from a clean install**

```bash
cd /Users/sam/Projects/liah-wellness/liah-hsd
npm run typecheck
npm run test
```

Expected: both exit 0.

- [ ] **Step 2: Add an agent-wiki project note**

Create `/Users/sam/Library/Mobile Documents/iCloud~md~obsidian/Documents/agent-wiki/Development Notes/LIAH HSD.md`:

```markdown
---
tags: [project, liah]
created: 2026-11-18
project: "[[LIAH HSD]]"
---

# LIAH HSD

A high-school-diploma learning platform, forked from [[LIAH International Academy]]'s
codebase (`liah-learning`) and rebranded under its own "Registrar" visual
identity (navy `#152542` / gold `#9c7a2e`, serif headings). Repo:
`https://github.com/samklepdev/liah-hsd`, local path
`/Users/sam/Projects/liah-wellness/liah-hsd`.

## What's reused as-is from liah-learning

Auth (cookie sessions, change password, forgot-password-via-admin), the two
roles (`user`/`admin`), the Subjects → Courses → Quizzes catalog model,
quiz-taking and scoring, progress tracking, the admin console, and the
PDF-quiz-parsing pipeline (see [[Quiz Content Pipeline]] — same dialects,
same gotchas, reused verbatim).

## What's new

A `certificates` table plus `backend/src/models/certificate.model.ts`:
`getEligibilitySummary(userId)` and `checkAndIssueCertificate(userId)`, keyed
off the existing best-score-per-course data. A certificate is issued once a
student has passed every **active** course — not per-subject. Issuance is
checked (idempotently) right after `attempt.controller.ts`'s `submit`, and
again lazily on `GET /api/v1/certificates/me` so a failed PDF step never
blocks a quiz submission. The PDF itself is built on demand with `pdfkit`
(`backend/src/lib/certificate-pdf.ts`) — nothing is stored as a binary.

## Curriculum content is still TBD

Only four placeholder subjects exist (Mathematics, English Language Arts,
Science, Social Studies), seeded via `npm run seed:subjects`, with zero
courses. Real HSD quiz packs go through the same `quiz:parse` → review JSON
→ `quiz:seed` pipeline as liah-learning once they exist.

## Status

2026-11-18: scaffold complete — fork, rebrand, and certificate feature all
built and tested. No curriculum content yet.
```

- [ ] **Step 3: Link it from `Home.md`**

In `/Users/sam/Library/Mobile Documents/iCloud~md~obsidian/Documents/agent-wiki/Home.md`, add under `## Projects`:

```markdown
- [[LIAH HSD]] — a high-school-diploma learning platform forked from [[LIAH International Academy]], rebranded under its own "Registrar" visual identity, plus a diploma certificate on completion. Scaffold complete as of 2026-11-18; curriculum content not yet added.
```

- [ ] **Step 4: Push**

```bash
cd /Users/sam/Projects/liah-wellness/liah-hsd
git push origin main
```

Expected: pushes all commits from Tasks 1–6 (and this task, if anything in the repo changed — it shouldn't have) to `https://github.com/samklepdev/liah-hsd`.
