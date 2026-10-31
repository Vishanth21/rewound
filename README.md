# Rewound

**Rewound searches across uploaded lectures by meaning and returns the passages most similar to your query, each with a timestamp, so you can jump to that point in the video.**

> *“Where in any of my courses is deadlock prevention explained?”* → `CS302 · Lecture 7 — Deadlock Prevention · ▶ 23:41`

Rewound combines semantic and keyword search with timestamped transcript passages. Students can request temporary access to a locked lecture; its uploader or an administrator can approve or reject the request. Instructors manage lecture content, and administrators manage users, enrollments, and analytics.

For the formal project report, database design, SQL/vector implementation, and rubric status, see [docs/REPORT.md](docs/REPORT.md). The per-route role policy is in [docs/API_AUTH_MATRIX.md](docs/API_AUTH_MATRIX.md).

## Technology

Next.js and TypeScript; PostgreSQL 16 with pgvector; local `all-MiniLM-L6-v2` embeddings; Auth.js credentials with bcrypt; and plain parameterized SQL through `node-postgres`.

## Getting started

### Prerequisites

- Docker Desktop
- Node.js 20.12+
- Python 3.10+ (for the database test suite)

### Run the app

```bash
cp .env.example .env.local                      # replace every change-me and set AUTH_SECRET
docker compose --env-file .env.local up -d      # PostgreSQL 16 + pgvector on localhost:5432
npm install
npm run db:migrate
npm run db:seed
npm run dev                                     # http://localhost:3000
```

`db:seed` downloads the MiniLM model on first use. It expects a freshly migrated database; run `npm run db:reset` before reseeding.

Demo accounts use password `demo1234`: `admin@pes.edu`, instructors `rao@pes.edu`, `iyer@pes.edu`, `menon@pes.edu`, and students `asha@pes.edu`, `ben@pes.edu`, `chitra@pes.edu`.

### Run the tests

```bash
npm test
python -m pip install pgserver psycopg2-binary
python db/tests/run_tests.py
```

The Python suite starts a temporary PostgreSQL instance with pgvector. It prints the current check results when run.

## Security

- Passwords are stored as bcrypt hashes; secrets and database credentials are read from the ignored `.env.local` file.
- The application uses the least-privilege `lecturelens_app` database role.
- Parameterized SQL, database constraints, role checks, row-level security, and scoped database functions protect data access.

## Team

| Name | Contribution |
|---|---|
| Krish Mathur | Course and lecture content, transcript ingestion, embeddings, semantic and keyword search, and lecture player. |
| Vishanth | Users and enrollments, access-request workflow, database authorization, authentication, administration, and analytics. |

## Repository layout

```text
.
├── app/                     Next.js pages and API handlers
├── auth.config.ts           Auth.js configuration
├── db/
│   ├── migrations/          PostgreSQL and pgvector migrations
│   ├── queries/             SQL query examples
│   ├── seed/                Demo users, courses, transcripts, and requests
│   └── tests/run_tests.py   Database test suite
├── docs/
│   ├── API_AUTH_MATRIX.md
│   ├── REPORT.md
│   └── er_diagram.png
├── lib/                     Database, authentication, search, and ingestion helpers
└── middleware.ts            Page authentication and role gates
```
