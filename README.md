# LIAH GED

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

```text
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

# seed the GED subjects, courses, and quiz content
npm run quiz:seed
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
