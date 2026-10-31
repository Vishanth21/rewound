// lib/http.ts
// Turns PostgreSQL errors into clean HTTP responses. The database raises specific SQLSTATE
// codes (see the migrations), and we map them to 4xx so the UI can show the real reason.
const FRIENDLY_CONSTRAINTS: Record<string, string> = {
  lecture_youtube_video_id_check: "That is not a valid YouTube video id (11 letters, digits, - or _).",
  lecture_duration_sec_check: "Duration must be a positive number of seconds.",
  lecture_lecture_no_check: "Lecture number must be 1 or more.",
  lecture_title_check: "Title cannot be blank.",
  lecture_course_id_lecture_no_key: "This course already has a lecture with that number.",
  chk_lecture_description: "Description cannot be blank (leave it empty instead).",
  course_code_key: "A course with that code already exists.",
  course_code_check: "Course code must be 4-12 capital letters or digits, e.g. CS301.",
  course_semester_check: "Semester must be between 1 and 8.",
  course_title_check: "Title cannot be blank.",
};

export function dbErrorResponse(e: unknown): Response {
  const err = e as { code?: string; message?: string; constraint?: string };
  const code = err?.code ?? "";
  const friendly = err?.constraint ? FRIENDLY_CONSTRAINTS[err.constraint] : undefined;
  const message = friendly ?? err?.message ?? "Unexpected error";
  let status = 500;
  if (code === "42501") status = 403; // insufficient_privilege
  else if (code === "P0002") status = 404; // no_data_found
  else if (code === "23505" || code === "23503" || code === "23000") status = 409; // unique / FK / integrity
  else if (code === "23514" || code === "22023" || code === "22P02" || code === "22001" || code === "22003" || code === "23502")
    status = 422; // check / invalid parameter / bad text / too long / out of range / not null
  if (status === 500) console.error("[db error]", e);
  return Response.json({ error: status === 500 ? "Something went wrong on the server." : message }, { status });
}

export const badRequest = (message: string) => Response.json({ error: message }, { status: 400 });
