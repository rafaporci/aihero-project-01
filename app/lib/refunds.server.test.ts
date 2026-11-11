import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  decideRefundRequest,
  getRefundEligibility,
  listRefundRequests,
} from "./refunds.server";

let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00"));

  testDb = createTestDb();
  base = seedBaseData(testDb);

  const courseModule = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: courseModule.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function buy(userId: number, createdAt: string, amountPaid = 7900) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id, enrolledAt: createdAt })
    .run();
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid, createdAt })
    .returning()
    .get();
}

function addAdmin() {
  return testDb
    .insert(schema.users)
    .values({ name: "Ada", email: "admin@example.com", role: schema.UserRole.Admin })
    .returning()
    .get();
}

function openRefundRequest(purchaseId: number) {
  return testDb
    .insert(schema.refunds)
    .values({ purchaseId, reason: "Not what I expected" })
    .returning()
    .get();
}

function addLearner(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function addCoupon(purchaseId: number, code: string) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  return testDb
    .insert(schema.coupons)
    .values({ teamId: team.id, courseId: base.course.id, purchaseId, code })
    .returning()
    .get();
}

function watch(userId: number, lessonId: number, positionSeconds: number) {
  testDb
    .insert(schema.videoWatchEvents)
    .values({ userId, lessonId, eventType: "progress", positionSeconds })
    .run();
}

function complete(userId: number, lessonId: number) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: "2026-03-02T10:00:00",
    })
    .run();
}

function attemptQuiz(userId: number, lessonId: number) {
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check yourself", passingScore: 0.7 })
    .returning()
    .get();
  return testDb
    .insert(schema.quizAttempts)
    .values({ userId, quizId: quiz.id, score: 0.5, passed: false })
    .returning()
    .get();
}

describe("getRefundEligibility", () => {
  it("offers the full amount paid to a learner inside the Refund Window with no Progress", () => {
    buy(base.user.id, "2026-03-01T09:00:00", 7900);

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
      amount: 7900,
      lastDayInWindow: "2026-03-15",
      hasProgress: false,
    });
  });

  it("refuses a learner who has not bought the course", () => {
    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "not-purchased",
    });
  });

  it("closes the Refund Window after the fourteenth whole day", () => {
    buy(base.user.id, "2026-02-24T23:00:00");
    vi.setSystemTime(new Date("2026-03-11T00:30:00"));

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "window-closed",
    });
  });

  it("still allows a request on the fourteenth day", () => {
    buy(base.user.id, "2026-02-24T23:00:00");
    vi.setSystemTime(new Date("2026-03-10T23:59:00"));

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
    });
  });

  it("refuses a second request while one is still open", () => {
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    testDb
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Not what I expected" })
      .run();

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "open-request",
    });
  });

  it("refuses a purchase that has already been refunded", () => {
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    testDb
      .insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        reason: "Not what I expected",
        status: schema.RefundStatus.Approved,
      })
      .run();

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "already-refunded",
    });
  });

  it("allows a new request after a decline", () => {
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    testDb
      .insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        reason: "Not what I expected",
        status: schema.RefundStatus.Declined,
      })
      .run();

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
    });
  });

  it("refuses a team purchase once any seat has been claimed", () => {
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    addCoupon(purchase.id, "SEAT-1");
    const teammate = addLearner("teammate@example.com");
    testDb
      .update(schema.coupons)
      .set({ redeemedByUserId: teammate.id, redeemedAt: "2026-03-02T10:00:00" })
      .run();

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "seat-claimed",
    });
  });

  it("refuses a learner who has watched two hours or more", () => {
    buy(base.user.id, "2026-03-01T09:00:00");
    // Rewatching a lesson does not count twice: only the furthest point in
    // each lesson adds up, so this is 3 × 40 minutes.
    watch(base.user.id, lessonIds[0], 600);
    watch(base.user.id, lessonIds[0], 2400);
    watch(base.user.id, lessonIds[1], 2400);
    watch(base.user.id, lessonIds[2], 2400);

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "watched-too-much",
    });
  });

  it("allows a learner just under two hours, and warns about their Progress", () => {
    buy(base.user.id, "2026-03-01T09:00:00");
    watch(base.user.id, lessonIds[0], 2400);
    watch(base.user.id, lessonIds[1], 2400);
    watch(base.user.id, lessonIds[2], 2399);

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
      hasProgress: true,
    });
  });

  it("refuses a learner who has completed half the lessons", () => {
    buy(base.user.id, "2026-03-01T09:00:00");
    complete(base.user.id, lessonIds[0]);
    complete(base.user.id, lessonIds[1]);

    expect(getRefundEligibility(base.user.id, base.course.id)).toEqual({
      eligible: false,
      reason: "completed-too-much",
    });
  });

  it("warns a learner who has completed a lesson without watching any video", () => {
    buy(base.user.id, "2026-03-01T09:00:00");
    complete(base.user.id, lessonIds[0]);

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
      hasProgress: true,
    });
  });

  it("warns a learner whose only Progress is a quiz attempt", () => {
    buy(base.user.id, "2026-03-01T09:00:00");
    attemptQuiz(base.user.id, lessonIds[0]);

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
      hasProgress: true,
    });
  });
});

describe("decideRefundRequest", () => {
  it("approves a request into a Pending Refund of the full amount paid", () => {
    const admin = addAdmin();
    const purchase = buy(base.user.id, "2026-03-01T09:00:00", 7900);
    const request = openRefundRequest(purchase.id);
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));

    expect(
      decideRefundRequest({
        refundRequestId: request.id,
        adminUserId: admin.id,
        decision: "approve",
      })
    ).toEqual({ ok: true });

    expect(listRefundRequests()).toMatchObject([
      {
        id: request.id,
        status: schema.RefundStatus.Approved,
        refundState: schema.RefundState.Pending,
        amountRefunded: 7900,
        decidedAt: "2026-03-10T12:00:00.000Z",
        decidedByName: "Ada",
        learnerEmail: "test@example.com",
        courseTitle: "Test Course",
      },
    ]);
  });

  it("ends access and erases Progress in the course, but keeps the rating and comments", () => {
    const admin = addAdmin();
    const classmate = addLearner("classmate@example.com");
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    buy(classmate.id, "2026-03-01T09:00:00");

    for (const userId of [base.user.id, classmate.id]) {
      complete(userId, lessonIds[0]);
      watch(userId, lessonIds[0], 300);
      const attempt = attemptQuiz(userId, lessonIds[1]);
      const question = testDb
        .insert(schema.quizQuestions)
        .values({
          quizId: attempt.quizId,
          questionText: "True?",
          questionType: schema.QuestionType.TrueFalse,
          position: 1,
        })
        .returning()
        .get();
      const option = testDb
        .insert(schema.quizOptions)
        .values({ questionId: question.id, optionText: "Yes", isCorrect: true })
        .returning()
        .get();
      testDb
        .insert(schema.quizAnswers)
        .values({
          attemptId: attempt.id,
          questionId: question.id,
          selectedOptionId: option.id,
        })
        .run();
    }
    testDb
      .insert(schema.courseRatings)
      .values({ userId: base.user.id, courseId: base.course.id, rating: 2 })
      .run();
    testDb
      .insert(schema.comments)
      .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Too fast" })
      .run();

    const request = openRefundRequest(purchase.id);
    decideRefundRequest({
      refundRequestId: request.id,
      adminUserId: admin.id,
      decision: "approve",
    });

    const rowsFor = (userId: number) => ({
      enrollments: testDb
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.userId, userId))
        .all().length,
      lessonProgress: testDb
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.userId, userId))
        .all().length,
      watchEvents: testDb
        .select()
        .from(schema.videoWatchEvents)
        .where(eq(schema.videoWatchEvents.userId, userId))
        .all().length,
      quizAttempts: testDb
        .select()
        .from(schema.quizAttempts)
        .where(eq(schema.quizAttempts.userId, userId))
        .all().length,
      ratings: testDb
        .select()
        .from(schema.courseRatings)
        .where(eq(schema.courseRatings.userId, userId))
        .all().length,
      comments: testDb
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.userId, userId))
        .all().length,
    });

    expect(rowsFor(base.user.id)).toEqual({
      enrollments: 0,
      lessonProgress: 0,
      watchEvents: 0,
      quizAttempts: 0,
      ratings: 1,
      comments: 1,
    });
    expect(rowsFor(classmate.id)).toEqual({
      enrollments: 1,
      lessonProgress: 1,
      watchEvents: 1,
      quizAttempts: 1,
      ratings: 0,
      comments: 0,
    });
    expect(testDb.select().from(schema.quizAnswers).all()).toHaveLength(1);
  });

  it("declines a request without a Refund, leaving access and Progress alone", () => {
    const admin = addAdmin();
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    complete(base.user.id, lessonIds[0]);
    const request = openRefundRequest(purchase.id);

    expect(
      decideRefundRequest({
        refundRequestId: request.id,
        adminUserId: admin.id,
        decision: "decline",
      })
    ).toEqual({ ok: true });

    expect(listRefundRequests()).toMatchObject([
      {
        status: schema.RefundStatus.Declined,
        refundState: null,
        amountRefunded: null,
        decidedByName: "Ada",
      },
    ]);
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(1);
    expect(testDb.select().from(schema.lessonProgress).all()).toHaveLength(1);
  });

  it.each([
    ["approve", "decline"],
    ["decline", "approve"],
  ] as const)("refuses to %s and then %s the same request", (first, second) => {
    const admin = addAdmin();
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    const request = openRefundRequest(purchase.id);
    const decide = (decision: "approve" | "decline") =>
      decideRefundRequest({
        refundRequestId: request.id,
        adminUserId: admin.id,
        decision,
      });

    decide(first);

    expect(decide(second)).toEqual({ ok: false, error: "already-decided" });
    expect(listRefundRequests()[0].status).toBe(
      first === "approve"
        ? schema.RefundStatus.Approved
        : schema.RefundStatus.Declined
    );
  });

  it("voids every unredeemed coupon of an approved team purchase", () => {
    const admin = addAdmin();
    const purchase = buy(base.user.id, "2026-03-01T09:00:00");
    const otherPurchase = buy(addLearner("other@example.com").id, "2026-03-01T09:00:00");
    addCoupon(purchase.id, "SEAT-1");
    addCoupon(purchase.id, "SEAT-2");
    addCoupon(otherPurchase.id, "OTHER-1");
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));

    decideRefundRequest({
      refundRequestId: openRefundRequest(purchase.id).id,
      adminUserId: admin.id,
      decision: "approve",
    });

    const voidedAtByCode = Object.fromEntries(
      testDb
        .select()
        .from(schema.coupons)
        .all()
        .map((coupon) => [coupon.code, coupon.voidedAt])
    );
    expect(voidedAtByCode).toEqual({
      "SEAT-1": "2026-03-10T12:00:00.000Z",
      "SEAT-2": "2026-03-10T12:00:00.000Z",
      "OTHER-1": null,
    });
  });
});
