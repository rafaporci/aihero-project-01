import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  enrollments,
  purchases,
  refunds,
  RefundStatus,
} from "~/db/schema";

export function getCouponByCode(code: string) {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

export const COUPON_HOLD_MESSAGES = {
  void: "This coupon is no longer valid because its purchase was refunded",
  "under-review":
    "This purchase is under review for a refund, so its seats are on hold",
} as const;

export type CouponHold = keyof typeof COUPON_HOLD_MESSAGES;

/**
 * Why a coupon cannot be redeemed because of a refund on the purchase behind
 * it, or null if the refund rules do not stand in its way.
 */
export function getCouponHold(
  coupon: typeof coupons.$inferSelect
): CouponHold | null {
  if (coupon.voidedAt !== null) return "void";

  const openRequest = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, coupon.purchaseId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get();

  return openRequest ? "under-review" : null;
}

export type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

export function redeemCoupon(
  code: string,
  userId: number,
  userCountry: string
): RedeemResult {
  const coupon = getCouponByCode(code);
  if (!coupon) {
    return { ok: false, error: "Coupon not found" };
  }

  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const hold = getCouponHold(coupon);
  if (hold) {
    return { ok: false, error: COUPON_HOLD_MESSAGES[hold] };
  }

  const existingEnrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, coupon.courseId)
      )
    )
    .get();

  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({
      redeemedByUserId: userId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, coupon.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId: coupon.courseId })
    .returning()
    .get();

  return { ok: true, enrollment };
}
