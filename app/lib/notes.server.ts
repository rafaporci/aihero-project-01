import { and, desc, eq } from "drizzle-orm";
import { courses, lessons, modules, notes } from "~/db/schema";
import type { Db } from "~/lib/comments.server";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

// ─── Notes ───
// A Student's own writing about a Lesson, private to them. One per Student per
// Lesson, enforced by the unique index on (user_id, lesson_id). Plain text,
// never rendered as Markdown. See GLOSSARY.md.
//
// Nothing outside the owning Student's Lesson page and Saved page may read a
// Note body. Every function here is scoped to one Student.

/** What the owning Student sees of their Note on the Lesson page. */
export type Note = { body: string; updatedAt: string };

export type NoteFailure = { ok: false; error: string };

export type SaveNoteResult =
  | { ok: true; note: typeof notes.$inferSelect | null }
  | NoteFailure;

/** The Student's Note on a Lesson, or null when they have not written one. */
export function getNote(
  db: Db,
  userId: number,
  lessonId: number
): Note | null {
  return (
    db
      .select({ body: notes.body, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
      .get() ?? null
  );
}

/**
 * Creates the Student's Note on a Lesson, or replaces its body and moves
 * `updatedAt` on. The body is trimmed; an empty body clears the Note.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    };
  }

  const owned = and(eq(notes.userId, userId), eq(notes.lessonId, lessonId));

  if (trimmed.length === 0) {
    db.delete(notes).where(owned).run();
    return { ok: true, note: null };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning()
    .get();
  return { ok: true, note };
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
