import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { alias } from "drizzle-orm/sqlite-core";
import {
  courses,
  coupons,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  quizAnswers,
  quizAttempts,
  quizzes,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundState,
  RefundStatus,
} from "~/db/schema";

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "not-purchased"
  | "already-refunded"
  | "open-request"
  | "window-closed"
  | "seat-claimed"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibility =
  | {
      eligible: true;
      purchaseId: number;
      amount: number;
      lastDayInWindow: string;
      hasProgress: boolean;
    }
  | { eligible: false; reason: RefundIneligibleReason };

// The window is counted in whole days, not hours — someone who buys at 23:00
// should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

// Rewatching does not count twice: only the furthest point reached in each
// lesson adds up.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function hasAttemptedAnyQuiz(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return false;

  const attempt = db
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .where(
      and(eq(quizAttempts.userId, userId), inArray(quizzes.lessonId, lessonIds))
    )
    .get();

  return attempt !== undefined;
}

function findRefundRequest(purchaseId: number, status: RefundStatus) {
  return db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.purchaseId, purchaseId), eq(refunds.status, status)))
    .get();
}

/**
 * Whether the learner may submit a Refund Request for their latest purchase
 * of this course right now. The course page and the submit action both ask
 * this, so they can never disagree.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return { eligible: false, reason: "not-purchased" };

  if (findRefundRequest(purchase.id, RefundStatus.Approved)) {
    return { eligible: false, reason: "already-refunded" };
  }

  if (findRefundRequest(purchase.id, RefundStatus.Open)) {
    return { eligible: false, reason: "open-request" };
  }

  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  const lastDayInWindow = calendarDay(windowEnd);
  const today = calendarDay(new Date());

  if (today < calendarDay(new Date(purchase.createdAt)) || today > lastDayInWindow) {
    return { eligible: false, reason: "window-closed" };
  }

  // A seat that came out of a team licence, and has been claimed, belongs to
  // the team — the buyer cannot hand it back on their own.
  const claimedSeat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchase.id), isNotNull(coupons.redeemedAt))
    )
    .get();

  if (claimedSeat) return { eligible: false, reason: "seat-claimed" };

  const lessonIds = getLessonIdsForCourse(courseId);
  const secondsWatched = getSecondsWatched(userId, lessonIds);

  if (secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  const completedLessons = getCompletedLessonCount(userId, lessonIds);

  if (
    lessonIds.length > 0 &&
    completedLessons / lessonIds.length >= REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed-too-much" };
  }

  return {
    eligible: true,
    purchaseId: purchase.id,
    amount: purchase.amountPaid,
    lastDayInWindow,
    hasProgress:
      secondsWatched > 0 ||
      completedLessons > 0 ||
      hasAttemptedAnyQuiz(userId, lessonIds),
  };
}

export type RefundDecision = "approve" | "decline";

export type DecideRefundRequestResult =
  | { ok: true }
  | { ok: false; error: "not-found" | "already-decided" };

/**
 * An Admin's final decision on an Open Refund Request. The caller checks the
 * role; this only records the decision and its consequences.
 */
export function decideRefundRequest(input: {
  refundRequestId: number;
  adminUserId: number;
  decision: RefundDecision;
}): DecideRefundRequestResult {
  const row = db
    .select({ refund: refunds, purchase: purchases })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, input.refundRequestId))
    .get();

  if (!row) return { ok: false, error: "not-found" };

  const { refund, purchase } = row;

  if (refund.status !== RefundStatus.Open) {
    return { ok: false, error: "already-decided" };
  }

  if (input.decision === "decline") {
    db.update(refunds)
      .set({
        status: RefundStatus.Declined,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: input.adminUserId,
      })
      .where(eq(refunds.id, refund.id))
      .run();

    return { ok: true };
  }

  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.update(refunds)
      .set({
        status: RefundStatus.Approved,
        refundState: RefundState.Pending,
        amountRefunded: purchase.amountPaid,
        resolvedAt: now,
        resolvedByUserId: input.adminUserId,
      })
      .where(eq(refunds.id, refund.id))
      .run();

    tx.update(coupons)
      .set({ voidedAt: now })
      .where(
        and(eq(coupons.purchaseId, purchase.id), isNull(coupons.redeemedAt))
      )
      .run();

    erase(tx, purchase.userId, purchase.courseId);
  });

  return { ok: true };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// See docs/adr/0001: the learner loses access and their Progress, but their
// rating and comments stay.
function erase(tx: Transaction, userId: number, courseId: number) {
  const lessonIds = tx
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((lesson) => lesson.id);

  if (lessonIds.length > 0) {
    const attemptIds = tx
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .where(
        and(
          eq(quizAttempts.userId, userId),
          inArray(quizzes.lessonId, lessonIds)
        )
      )
      .all()
      .map((attempt) => attempt.id);

    if (attemptIds.length > 0) {
      tx.delete(quizAnswers).where(inArray(quizAnswers.attemptId, attemptIds)).run();
      tx.delete(quizAttempts).where(inArray(quizAttempts.id, attemptIds)).run();
    }

    tx.delete(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .run();

    tx.delete(videoWatchEvents)
      .where(
        and(
          eq(videoWatchEvents.userId, userId),
          inArray(videoWatchEvents.lessonId, lessonIds)
        )
      )
      .run();
  }

  tx.delete(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
    .run();
}

const learners = alias(users, "learners");
const deciders = alias(users, "deciders");

/**
 * Refund Requests, Open ones first, newest first within each group. Pass a
 * learner to see only theirs.
 */
export function listRefundRequests(filter: { learnerId?: number } = {}) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      refundState: refunds.refundState,
      amountRefunded: refunds.amountRefunded,
      decidedAt: refunds.resolvedAt,
      decidedByName: deciders.name,
      amountPaid: purchases.amountPaid,
      learnerId: learners.id,
      learnerName: learners.name,
      learnerEmail: learners.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(learners, eq(purchases.userId, learners.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(deciders, eq(refunds.resolvedByUserId, deciders.id))
    .where(
      filter.learnerId === undefined
        ? undefined
        : eq(purchases.userId, filter.learnerId)
    )
    .orderBy(
      sql`case when ${refunds.status} = ${RefundStatus.Open} then 0 else 1 end`,
      sql`${refunds.requestedAt} desc`
    )
    .all();
}

/** How far a learner has got through a course, for an Admin deciding. */
export function getProgressSummary(userId: number, courseId: number) {
  const lessonIds = getLessonIdsForCourse(courseId);
  return {
    completedLessons: getCompletedLessonCount(userId, lessonIds),
    totalLessons: lessonIds.length,
    secondsWatched: getSecondsWatched(userId, lessonIds),
  };
}
