# API authorization matrix

This matrix records the role gate for each API method present on `main` at the time of writing.
It describes the result for an authenticated user with a valid request and an in-scope resource.
Malformed input, missing resources, conflicts, and database rule violations can return other 4xx
statuses as documented by the routes.

`2xx` means the role is allowed to reach the operation; create routes normally return `201`.
`403` means the route rejects the role before doing the operation. `403*` marks an additional
resource-scope check: a teacher must manage the course or lecture, and an instructor may decide
only requests they are allowed to approve. For protected routes, a missing or invalid session
returns `401` for every role column.

| Method and route | Student | Instructor | Admin | Scope enforced after role gate |
|---|---:|---:|---:|---|
| `GET /api/courses` | 2xx | 2xx | 2xx | Course overview is available to signed-in users. |
| `POST /api/courses` | 403 | 403 | 2xx | `create_course()` rechecks the admin role. |
| `PATCH /api/courses/{id}` | 403 | 403 | 2xx | Admin-only route; missing course returns `404`. |
| `DELETE /api/courses/{id}` | 403 | 403 | 2xx | Admin-only route; missing course returns `404`. |
| `GET /api/courses/{id}/lectures` | 403 | 2xx* | 2xx | `course_lectures()` checks that the instructor teaches the course. |
| `POST /api/courses/{id}/lectures` | 403 | 2xx* | 2xx | Instructor must teach the course; database rules validate lecture data. |
| `GET /api/search` | 2xx | 2xx | 2xx | Search functions return in-scope and locked results without exposing locked video IDs or transcript passages. |
| `GET /api/lectures/{id}` | 2xx* | 2xx* | 2xx* | `get_lecture()` checks lecture access; an out-of-scope caller receives `403`. |
| `PATCH /api/lectures/{id}` | 403 | 2xx* | 2xx | Instructor must teach the lecture’s course. |
| `DELETE /api/lectures/{id}` | 403 | 2xx* | 2xx | Instructor must teach the lecture’s course. |
| `POST /api/lectures/{id}/transcript` | 403 | 2xx* | 403 | Upload is instructor-only; the instructor must teach the lecture’s course. |
| `DELETE /api/lectures/{id}/transcript` | 403 | 2xx* | 2xx* | Database procedure checks lecture-management permission. |
| `POST /api/lectures/{id}/reembed` | 403 | 2xx* | 2xx* | Instructor must teach the lecture; a missing transcript returns `404`. |
| `GET /api/lectures/{id}/thumbnail` | 2xx | 2xx | 2xx | Authenticated users may view the proxied thumbnail; the route returns image bytes, not the video ID. |
| `PATCH /api/chunks/{id}` | 403 | 2xx* | 2xx* | `update_chunk_text()` checks that the caller may manage the lecture. |
| `GET /api/inbox` | 403 | 2xx* | 2xx | The database returns only requests this instructor may decide; admins see all pending requests. |
| `GET /api/requests` | 2xx | 2xx | 2xx | RLS limits students to their own requests and instructors to requests on their uploaded lectures; admins see all. |
| `POST /api/requests` | 2xx | 403 | 403 | Student-only; `request_access()` checks existing access, transcript availability, and duplicate pending requests. |
| `POST /api/requests/{id}/decision` | 403 | 2xx* | 2xx | The database permits the lecture uploader or an admin and serializes concurrent decisions. |

## Public authentication endpoints

These routes intentionally do not require a prior session:

| Method and route | Expected behavior |
|---|---|
| `POST /api/dev-login` | Accepts valid credentials for any seeded role; redirects to `/search`. Invalid credentials redirect to `/login` with a generic error. |
| `POST /api/logout` | Clears the session and redirects to `/login`. |

The dev-login/logout rows describe the stand-ins currently present on `main`. When the Auth.js
branch is merged, replace them with the public `/api/auth/[...nextauth]` handler and keep the
role-gate rows above unchanged.

## Authorization layers

1. `requireApi()` rejects unauthenticated calls with `401` and disallowed roles with `403`.
2. Resource checks such as `canManageCourse()` and `canManageLecture()` restrict instructors to
   their assigned courses.
3. Database functions, procedures, triggers, and row-level security repeat the sensitive access
   checks. In particular, request history is scoped by RLS and `decide_request()` checks the
   uploader/admin rule while holding a row lock.

The implementation is in `lib/guard.ts`, `lib/manage.ts`, `db/migrations/070_request_workflow.sql`,
`db/migrations/080_search_functions.sql`, and the relevant API route handlers under `app/api/`.
