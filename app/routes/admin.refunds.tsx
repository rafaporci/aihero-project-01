import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, Check, ReceiptText, X } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { formatPrice } from "~/lib/utils";
import {
  decideRefundRequest,
  getProgressSummary,
  listRefundRequests,
} from "~/lib/refunds.server";

const adminRefundActionSchema = z.object({
  intent: z.enum(["approve", "decline"]),
  refundRequestId: z.coerce.number().int(),
});

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/**
 * The decision email. There is no mail transport wired up yet, so the built
 * message goes to the server log.
 */
function buildRefundDecisionEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
  decision: "approve" | "decline";
}) {
  const body =
    input.decision === "approve"
      ? [
          `Your refund request for "${input.courseTitle}" has been approved.`,
          `We are sending ${formatPrice(input.amount)} back to the card you paid with.`,
          "You no longer have access to the course, and your progress in it has been erased.",
        ]
      : [
          `We could not approve your refund request for "${input.courseTitle}".`,
          "You still have full access to the course. If you are still eligible, you can ask again from the course page.",
        ];

  return {
    to: input.learnerEmail,
    subject: `Refund ${input.decision === "approve" ? "approved" : "declined"} — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      ...body,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

function formatWatched(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  const refundRequests = listRefundRequests().map((refundRequest) => ({
    ...refundRequest,
    // Only an Open request still has Progress to show — approval erases it.
    progress:
      refundRequest.status === RefundStatus.Open
        ? getProgressSummary(refundRequest.learnerId, refundRequest.courseId)
        : null,
  }));

  return { refundRequests };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can decide refund requests.", { status: 403 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminRefundActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent, refundRequestId } = parsed.data;
  const result = decideRefundRequest({
    refundRequestId,
    adminUserId: currentUser.id,
    decision: intent,
  });

  if (!result.ok) {
    return data(
      {
        error:
          result.error === "not-found"
            ? "That refund request does not exist."
            : "That refund request has already been decided.",
      },
      { status: result.error === "not-found" ? 404 : 409 }
    );
  }

  const decided = listRefundRequests().find(
    (refundRequest) => refundRequest.id === refundRequestId
  );

  if (decided) {
    const email = buildRefundDecisionEmail({
      learnerName: decided.learnerName,
      learnerEmail: decided.learnerEmail,
      courseTitle: decided.courseTitle,
      amount: decided.amountRefunded ?? decided.amountPaid,
      decision: intent,
    });
    console.log(
      `[email] to=${email.to} subject=${email.subject}\n${email.body}`
    );
  }

  return {
    success: true,
    message:
      intent === "approve" ? "Refund approved." : "Refund request declined.",
  };
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["refundRequests"][number];

const thClassName =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";

function DecisionButtons({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("success" in fetcher.data) toast.success(fetcher.data.message);
    if ("error" in fetcher.data) toast.error(fetcher.data.error);
  }, [fetcher.state, fetcher.data]);

  function decide(intent: "approve" | "decline") {
    const confirmation =
      intent === "approve"
        ? `Approve a refund of ${formatPrice(refundRequest.amountPaid)} to ${refundRequest.learnerName}?\n\nThey will lose access to "${refundRequest.courseTitle}" and their progress in it will be erased. This cannot be undone.`
        : `Decline ${refundRequest.learnerName}'s refund request for "${refundRequest.courseTitle}"?\n\nThis cannot be undone.`;

    if (!confirm(confirmation)) return;

    fetcher.submit(
      { intent, refundRequestId: refundRequest.id },
      { method: "post" }
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" onClick={() => decide("approve")} disabled={isSubmitting}>
        <Check className="mr-1 size-3.5" />
        Approve
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => decide("decline")}
        disabled={isSubmitting}
      >
        <X className="mr-1 size-3.5" />
        Decline
      </Button>
    </div>
  );
}

function OpenRow({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const { progress } = refundRequest;

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="font-medium">{refundRequest.learnerName}</div>
        <div className="text-sm text-muted-foreground">
          {refundRequest.learnerEmail}
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/courses/${refundRequest.courseSlug}`}
          className="hover:underline"
        >
          {refundRequest.courseTitle}
        </Link>
      </td>
      <td className="px-4 py-3">{formatPrice(refundRequest.amountPaid)}</td>
      <td className="max-w-xs px-4 py-3 text-sm">{refundRequest.reason}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {new Date(refundRequest.requestedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-sm">
        {progress ? (
          <>
            <div>
              {progress.completedLessons}/{progress.totalLessons} lessons
            </div>
            <div className="text-muted-foreground">
              {formatWatched(progress.secondsWatched)} watched
            </div>
          </>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <DecisionButtons refundRequest={refundRequest} />
      </td>
    </tr>
  );
}

function DecidedRow({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const approved = refundRequest.status === RefundStatus.Approved;

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="font-medium">{refundRequest.learnerName}</div>
        <div className="text-sm text-muted-foreground">
          {refundRequest.learnerEmail}
        </div>
      </td>
      <td className="px-4 py-3">{refundRequest.courseTitle}</td>
      <td className="px-4 py-3">{formatPrice(refundRequest.amountPaid)}</td>
      <td className="max-w-xs px-4 py-3 text-sm">{refundRequest.reason}</td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            approved
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {approved ? "Approved" : "Declined"}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {refundRequest.decidedByName ?? "Unknown"}
        {refundRequest.decidedAt
          ? ` · ${new Date(refundRequest.decidedAt).toLocaleDateString()}`
          : null}
      </td>
    </tr>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;
  const open = refundRequests.filter(
    (refundRequest) => refundRequest.status === RefundStatus.Open
  );
  const decided = refundRequests.filter(
    (refundRequest) => refundRequest.status !== RefundStatus.Open
  );

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline what learners have asked for. Both decisions are
          final.
        </p>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Open ({open.length})</h2>
      {open.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No refund requests are waiting on a decision.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className={thClassName}>Learner</th>
                    <th className={thClassName}>Course</th>
                    <th className={thClassName}>Paid</th>
                    <th className={thClassName}>Reason</th>
                    <th className={thClassName}>Requested</th>
                    <th className={thClassName}>Progress</th>
                    <th className={thClassName}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((refundRequest) => (
                    <OpenRow key={refundRequest.id} refundRequest={refundRequest} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold">Decided</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className={thClassName}>Learner</th>
                      <th className={thClassName}>Course</th>
                      <th className={thClassName}>Paid</th>
                      <th className={thClassName}>Reason</th>
                      <th className={thClassName}>Decision</th>
                      <th className={thClassName}>Decided by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decided.map((refundRequest) => (
                      <DecidedRow
                        key={refundRequest.id}
                        refundRequest={refundRequest}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
