import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { redeemCoupon } from "./coupons.server";

let base: ReturnType<typeof seedBaseData>;
let teammate: typeof schema.users.$inferSelect;
let purchase: typeof schema.purchases.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  teammate = testDb
    .insert(schema.users)
    .values({
      name: "Teammate",
      email: "teammate@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 15800,
      country: "US",
    })
    .returning()
    .get();

  const team = testDb.insert(schema.teams).values({}).returning().get();
  testDb
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      purchaseId: purchase.id,
      code: "SEAT-1",
    })
    .run();
});

describe("redeemCoupon", () => {
  it("enrolls the learner who redeems a free seat", () => {
    const result = redeemCoupon("SEAT-1", teammate.id, "US");

    expect(result).toMatchObject({
      ok: true,
      enrollment: { userId: teammate.id, courseId: base.course.id },
    });
  });

  it("holds every seat while the purchase has an Open Refund Request", () => {
    testDb
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Bought too many seats" })
      .run();

    expect(redeemCoupon("SEAT-1", teammate.id, "US")).toEqual({
      ok: false,
      error: "This purchase is under review for a refund, so its seats are on hold",
    });
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(0);
  });

  it("refuses a void coupon", () => {
    testDb
      .update(schema.coupons)
      .set({ voidedAt: "2026-03-10T12:00:00.000Z" })
      .run();

    expect(redeemCoupon("SEAT-1", teammate.id, "US")).toEqual({
      ok: false,
      error: "This coupon is no longer valid because its purchase was refunded",
    });
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(0);
  });
});
