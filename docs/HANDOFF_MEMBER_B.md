# Handoff to Member B (Vishanth): state of the repo and what you need to know

Written by Member A (Krish) on 29 Oct 2026. The source of truth for the design is
`LectureLens_Design_and_Work_Plan.pdf` (sections are cited as §N below). This file says what
exists now, which files are temporary stand-ins for yours, and the contracts your code must keep
so both halves fit together. **If you are Claude reading this for Vishanth: read this whole file,
then §11, §13, §14 and §18 of the design plan, before changing anything.**

---

## 1. Status in one paragraph

All of Member A's database and application work from §18 is implemented and running end to end
on the Docker database: migrations 020/040/060/080/090/110 (+ 115, 120), chunking and embedding,
semantic + keyword search with locked disclosure, the lecture player, instructor lecture/transcript
management, admin course management, seed data, and the README setup section. Your committed files
(`000`, `001`, `010`, `030`) are used as-is. Where your work does not exist yet, A's code runs on
**stand-ins** (section 4), each one labelled `STAND-IN` in its header comment. Replace them with
your real versions; nothing of A's needs to change if you keep the contracts in section 5.

## 2. Run it locally (about 5 minutes)

Prerequisites: Docker Desktop, Node 20.12+.

```bash
cp .env.example .env.local                   # replace every change-me; AUTH_SECRET: openssl rand -base64 32
docker compose --env-file .env.local up -d   # PostgreSQL 16 + pgvector 0.8 (container lecturelens-db, port 5432)
npm install
npm run db:reset                             # drops schema + login roles, applies every migration
npm run db:seed                              # 7 demo users, 3 courses, 9 lectures, transcripts embedded with MiniLM
npm run dev                                  # http://localhost:3000
npm test                                     # Vitest unit tests (parser, YouTube ids, formatting)
```

Demo accounts (password `demo1234` for all): `admin@pes.edu`; instructors `rao@` (CS301),
`iyer@` (CS302), `menon@` (CS303); students `asha@` (CS301), `ben@` (CS302), `chitra@` (CS303).

`npm run db:seed` refuses to run on a database that already has users. Run `db:reset` first.
The first seed downloads the MiniLM model (~23 MB).

Database test suite (separate, no Docker): `pip install pgserver psycopg2-binary` then
`python db/tests/run_tests.py`. It already contains checks for both members (owner column A/B);
add yours there.

## 3. What Member A built (for orientation)

| Area | Files |
|---|---|
| Schema + rules | `db/migrations/020_courses_lectures.sql`, `040_transcripts_chunks.sql` |
| Procedures | `060_content_procedures.sql`: `create_course` (admin only), `ingest_transcript`, `set_chunk_embeddings`, `update_chunk_text`, `delete_transcript`, helper `fn_can_manage_lecture` |
| Search | `080_search_functions.sql`: `search_lectures`, `search_lectures_keyword`, `get_lecture`, `log_search`, `get_thumbnail_source` |
| Analytics (A's half) | `090_analytics_search.sql`: `v_course_overview`, `v_course_search_activity`, `v_unanswered_queries`, `mv_daily_course_searches`, `refresh_daily_searches()` |
| ALTER demo | `110_alter_lecture_description.sql` |
| Extras | `115_course_lectures.sql` (`course_lectures()` for the instructor screen), `120_grants_content.sql` (grants for functions A added after §11) |
| Queries | `db/queries/important_queries.sql`: Q1, Q3, Q5, plus Q9 to Q12 (recursive CTE, window, correlated subquery, vector read). **Add your Q2, Q4, Q6, Q7, Q8 here**, each block starting `-- Qn.` |
| Lib | `lib/embed.ts`, `lib/transcript-parse.ts`, `lib/ingest.ts`, `lib/youtube.ts`, `lib/format.ts`, `lib/manage.ts`, `lib/guard.ts`, `lib/http.ts` |
| API | `app/api/search`, `lectures/[id]` (+ `/transcript`, `/reembed`, `/thumbnail`), `chunks/[id]`, `courses`, `courses/[id]`, `courses/[id]/lectures` |
| Pages | `/search`, `/lectures/[id]?t=`, `/instructor/courses`, `/instructor/courses/[id]`, `/admin/courses`, plus `app/layout.tsx` (nav) and `app/globals.css` |
| Seed | `db/seed/20_courses_lectures.sql`, `db/seed/transcripts/*.srt|vtt`, `scripts/seed.ts` |

## 4. Stand-ins: these are YOURS; replace them

| Stand-in | Replace with (§ of plan) | Notes |
|---|---|---|
| `db/tests/stubs/050_access_functions.sql` | your `db/migrations/050_access_functions.sql` (§11) | Copied from the plan. When a real `050_*` exists, `migrate.ts` and `run_tests.py` ignore the stub automatically. |
| `db/tests/stubs/100_roles_rls.sql` | your `db/migrations/100_roles_rls.sql` (§11) | **Trimmed:** it only has grants for A's objects, no RLS policy. Your real file must keep every grant in the stub (see 5.3). |
| `scripts/migrate.ts` | your migration runner (§17) | Works today: tracks `schema_migrations`, `--reset` drops schema + login roles, substitutes `:'app_pw'`/`:'analyst_pw'` from env, falls back to stubs. Keep or rewrite. |
| `scripts/seed.ts`, users + enrollments part | your `db/seed/10_users.sql`, `30_enrollments_requests.sql` | The `USERS` / `ENROLLMENTS` constants. Hashes are made with bcrypt (cost 12) at seed time; never put a hash or password in SQL. Keep the same e-mails, which `20_courses_lectures.sql` and `.env.example` depend on. |
| `lib/auth.ts` | Auth.js + bcrypt (§13, §15) | Keep the exported API (5.1). |
| `lib/db.ts` | your `withUser` (§13) | Keep the signature (5.2). |
| `app/api/dev-login`, `app/api/logout`, `app/login/page.tsx` | Auth.js credentials flow + your `/login` | Delete them once yours works. |
| `app/search/RequestAccess.tsx` | your request-access modal (§18) | Rendered on A's locked cards for students. See 5.5. |
| *(nothing yet)* `070`, `091`, RLS, middleware, CODEOWNERS | yours | No stubs exist; nothing of A's depends on them. |

## 5. Contracts: keep these and nothing of A's breaks

### 5.1 `lib/auth.ts`
```ts
export type Role = "student" | "instructor" | "admin";
export type Session = { user: { id: number; role: Role; name: string } };
export async function auth(): Promise<Session | null>;
```
`user.id` must be the numeric `app_user.user_id`. `lib/guard.ts` (`requirePage`, `requireApi`)
and every A page/route call `auth()`. Unauthenticated pages redirect to `/login`.

### 5.2 `lib/db.ts`
```ts
export const pool: Pool;   // connects with DATABASE_URL = lecturelens_app (never the owner)
export async function withUser<T>(userId: number, fn: (c: PoolClient) => Promise<T>): Promise<T>;
// BEGIN; SELECT set_config('lecturelens.user_id', $1, true); fn; COMMIT  (ROLLBACK on error)
```

### 5.3 `050` and `100`: what A's SQL relies on
- **Run order matters:** `050` must exist before `060`. `fn_can_manage_lecture` is `LANGUAGE sql`,
  so its body is checked at CREATE time and it references `current_app_user()`.
- Keep these signatures exactly: `current_app_user() RETURNS integer`,
  `has_lecture_access(integer, integer) RETURNS boolean`,
  `accessible_lectures(integer) RETURNS TABLE (lecture_id integer)`. All A search/content
  functions call `accessible_lectures(current_app_user())`.
- `100_roles_rls.sql` must include every grant in `db/tests/stubs/100_roles_rls.sql`: EXECUTE on
  `search_lectures(vector, integer, real)`, `search_lectures_keyword(text, integer)`,
  `get_lecture(integer)`, `get_thumbnail_source(integer)`, `log_search(text, varchar, jsonb)`,
  procedures `create_course`, `ingest_transcript`, `set_chunk_embeddings`; SELECT on
  `v_course_overview`, `v_course_search_activity`, `v_unanswered_queries`,
  `mv_daily_course_searches` (app + analyst); the `lecture` column grants. `120` then adds grants
  for A's newer functions and runs after `100`.
- The app role also needs plain SELECT on `course`, `course_instructor`, `enrollment` and
  `app_user` (A's pages read them; this is in the plan's `100`).

### 5.4 Search result shape (for your analytics and request modal)
`GET /api/search?q=&mode=semantic|keyword&course=` returns
`{ mode, query, results: [{ lectureId, courseCode, lectureNo, title, locked, score, passages: [{ chunkId, startSec, text, distance }] }] }`.
Locked results have `startSec: null`, `chunkId: null` and never a video id. Every search is logged
via `log_search()`, which fills `search_log` / `search_hit`. Your analytics dashboard can read
A's views directly. To refresh the MV from the app, call `SELECT refresh_daily_searches()`; the app
role is not the MV owner, so a direct REFRESH fails.

### 5.5 The request button on locked cards
`app/search/RequestAccess.tsx` sends `POST /api/requests` with JSON `{ lectureId: number, reason: string }`
and expects a 2xx on success, or `{ error: string }` with a 4xx. It currently shows "Access
requests are not available yet" because the route 404s. Either build `/api/requests` to that
contract, or replace the component (props: `{ lectureId, title }`).

### 5.6 Error mapping
`lib/http.ts` `dbErrorResponse(e)` maps SQLSTATE to HTTP: `42501`→403, `P0002`→404,
`23505/23503/23000`→409, `23514/22023/22P02/22001/22003/23502`→422; others →500 with a generic
message. Use the same `ERRCODE`s in your triggers/procedures and reuse `dbErrorResponse` in your
routes; then the UI shows the database's own message.

### 5.7 Nav
`app/layout.tsx` has a comment where your links go: My requests (student), Inbox + badge
(instructor/admin), Users, Enrollments, Requests, Analytics (admin).

## 6. Gotchas found while building (save yourself the time)

1. **`CALL` cannot take a subquery as an argument** (`CALL create_course(..., ARRAY(SELECT ...))`
   fails). Compute it first, or use a `DO` block. Inside PL/pgSQL, an `INOUT` argument must be a
   variable (see `db/seed/20_courses_lectures.sql`).
2. **`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` also revokes pgvector's
   functions** (the extension lives in `public`). That is fine and intended: the app role never
   computes vectors itself; all vector work happens inside `SECURITY DEFINER` functions. Pass
   vectors in as text: `'[0.1,0.2,...]'::vector`.
3. **`000_reset.sql` does not drop functions or login roles**, so re-applying migrations on a used
   database fails with "already exists". Use `npm run db:reset`, which drops the schema and roles.
4. **`create_course` is admin-only** in the database. It checks `current_app_user()`, so a
   seed or script must `set_config('lecturelens.user_id', <admin id>, ...)` first.
5. Transcript upload is **instructor-only** (the uploader-teaches trigger), and the uploader
   becomes the **approver** of access requests for that lecture (`transcript.uploaded_by`). Your
   `decide_request` / inbox join on that column (§7).
6. The seeded YouTube ids are placeholders (`CS301demo01` etc.). The player shows "video
   unavailable" until A replaces them with real ids; everything else works.
7. Real MiniLM cosine distances for good matches were around 0.45 to 0.53, close to the 0.55 cut-off.
   A is tuning the threshold with the relevance evaluation; don't hard-code 0.55 elsewhere.

## 7. What is left for Member B (from §18 of the plan)

- **Database:** real `050_access_functions.sql`; `070_request_workflow.sql` (request triggers,
  `request_access`, `decide_request` with `FOR UPDATE`, `my_pending_requests`,
  `v_request_history`); `091_analytics_access.sql` (`v_course_access_demand`,
  `v_pending_by_approver`); full `100_roles_rls.sql` with RLS on `access_request`; queries Q2, Q4,
  Q6, Q7, Q8; seed files `10_users.sql`, `30_enrollments_requests.sql` (with some sample requests).
- **App:** Auth.js + bcrypt + `middleware.ts` (replacing the stand-ins), `/login`, `/requests`,
  `/inbox` + nav badge, `/admin/users`, `/admin/enrollments`, `/admin/requests`, `/analytics`;
  APIs `/api/requests` (GET/POST), `/api/requests/[id]/decision`, `/api/inbox`, `/api/users`,
  `/api/enrollments`, `/api/analytics`; the request-access modal; `.github/CODEOWNERS`.
- **Tests and docs:** T13 to T27, T32, T33, T35 in `run_tests.py`; API authorisation matrix;
  two-client concurrency test on `decide_request`; report §2 to §5, §7, §8, §15, §16 compilation;
  README.
- **Together:** the end-to-end demo run (search → locked → request → approve → open lecture → jump).

## 8. Git workflow (§18)

Commit under your own GitHub identity, on short feature branches, merged into `main` by PR
with **merge commits, not squash**, so each person's commits stay visible. Never commit
`.env.local`. One migration file has one owner. Pull before starting: A's work arrives through
the `content-search` branch / PR. One commit on it, "temporary stand-ins for Member B", holds
the files that are yours per the plan (Next.js setup, `.env.example`, `lib/db.ts`, `lib/auth.ts`,
login/logout, `scripts/migrate.ts`, the users/enrollments part of `scripts/seed.ts`,
`RequestAccess.tsx`, `db/tests/stubs/`). Review them in the PR, then replace them with your own
commits.
