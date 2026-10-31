// /lectures/:id?t=SECONDS  (Member A) -- video + full transcript, only if the user has access.
// get_lecture() is the gate: it raises insufficient_privilege (42501) for lectures out of scope.
import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { canManageLecture, parseId } from "@/lib/manage";
import LecturePlayer from "./LecturePlayer";

export const dynamic = "force-dynamic";

type Chunk = { chunkId: number; seqNo: number; startSec: number; endSec: number; text: string };

export default async function LecturePage({ params, searchParams }: { params: { id: string }; searchParams: { t?: string } }) {
  const session = await requirePage();
  const id = parseId(params.id);
  if (!id) notFound();

  let data;
  try {
    data = await withUser(session.user.id, async (c) => {
      const rows = (await c.query("SELECT * FROM get_lecture($1)", [id])).rows;
      const meta = (
        await c.query(
          `SELECT l.lecture_no, l.delivered_on, l.description, l.course_id, co.title AS course_title
             FROM lecture l JOIN course co ON co.course_id = l.course_id WHERE l.lecture_id = $1`,
          [id],
        )
      ).rows[0];
      return { rows, meta, canEdit: await canManageLecture(c, session, id) };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "42501") {
      return (
        <main>
          <div className="card stack">
            <h1>You don’t have access to this lecture</h1>
            <p className="muted" style={{ margin: 0 }}>
              It belongs to a course you are not enrolled in, or your temporary access has expired.
              {session.user.role === "student" ? " Search for its topic to request access." : ""}
            </p>
            <div><Link className="btn" href="/search">Back to search</Link></div>
          </div>
        </main>
      );
    }
    throw e;
  }

  if (!data.meta) notFound();
  if (data.rows.length === 0) {
    return (
      <main>
        <div className="card stack">
          <h1>No transcript yet</h1>
          <p className="muted" style={{ margin: 0 }}>This lecture cannot be played here until its instructor uploads a transcript.</p>
          {data.canEdit && <div><Link className="btn" href={`/instructor/courses/${data.meta.course_id}`}>Upload a transcript</Link></div>}
        </div>
      </main>
    );
  }

  const first = data.rows[0];
  const chunks: Chunk[] = data.rows.map((r) => ({
    chunkId: Number(r.chunk_id), seqNo: r.seq_no, startSec: Number(r.start_sec), endSec: Number(r.end_sec), text: r.content,
  }));
  const t = Math.max(0, Math.floor(Number(searchParams.t) || 0));

  return (
    <main>
      <div className="page-head">
        <div>
          <p className="muted small" style={{ margin: 0 }}>
            <span className="course-code">{first.course_code}</span>
            {data.meta.course_title} · Lecture {data.meta.lecture_no}
            {data.meta.delivered_on && ` · ${new Date(data.meta.delivered_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
          </p>
          <h1>{first.lecture_title}</h1>
          {data.meta.description && <p className="muted" style={{ margin: 0 }}>{data.meta.description}</p>}
        </div>
        <Link className="btn" href="/search">← Search</Link>
      </div>
      <LecturePlayer videoId={String(first.youtube_video_id).trim()} start={t} chunks={chunks} canEdit={data.canEdit} />
    </main>
  );
}
