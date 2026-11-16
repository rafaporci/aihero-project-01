/**
 * PROTOTYPE — throwaway. Lives only on the `prototype/notification-inbox`
 * branch and must never be merged.
 *
 * Question: how should the bell and the Inbox look and behave?
 * Three variants of the app shell, switchable via `?variant=A|B|C` and the
 * floating bar at the bottom (← / → keys work too):
 *   A — bell in the sidebar header, dropdown popover
 *   B — "Inbox" item in the sidebar nav with a badge, full Inbox page
 *   C — slim top bar with a bell, slide-over drawer with tabs and day groups
 *
 * Notifications are in-memory mock data covering all seven catalogue items
 * (draft wording, to be judged here). Nothing is persisted; reload resets it.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Popover } from "radix-ui";
import {
  Armchair,
  Bell,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Inbox as InboxIcon,
  MessageCircleQuestion,
  MessageSquareReply,
  ReceiptText,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";

// ─── Mock data ───

type NotificationKind =
  | "refund-request-raised"
  | "refund-request-approved"
  | "refund-request-declined"
  | "new-question"
  | "reply-to-your-question"
  | "seat-claimed"
  | "course-status-changed";

type MockNotification = {
  id: number;
  kind: NotificationKind;
  // Draft wording. **bold** marks the names people scan for.
  text: string;
  href: string;
  minutesAgo: number;
  read: boolean;
};

const KIND: Record<NotificationKind, { label: string; icon: ReactNode }> = {
  "refund-request-raised": {
    label: "Refund Request raised",
    icon: <ReceiptText className="size-4" />,
  },
  "refund-request-approved": {
    label: "Refund Request approved",
    icon: <CircleCheck className="size-4 text-green-600" />,
  },
  "refund-request-declined": {
    label: "Refund Request declined",
    icon: <CircleX className="size-4 text-red-600" />,
  },
  "new-question": {
    label: "New question",
    icon: <MessageCircleQuestion className="size-4" />,
  },
  "reply-to-your-question": {
    label: "Reply to your question",
    icon: <MessageSquareReply className="size-4" />,
  },
  "seat-claimed": {
    label: "Seat claimed",
    icon: <Armchair className="size-4" />,
  },
  "course-status-changed": {
    label: "Course status changed",
    icon: <BookOpenCheck className="size-4" />,
  },
};

const INITIAL: MockNotification[] = [
  {
    id: 1,
    kind: "refund-request-raised",
    text: "**Liam Thompson** asked for a refund of $79.00 on **Introduction to TypeScript**.",
    href: "/admin/refunds",
    minutesAgo: 4,
    read: false,
  },
  {
    id: 2,
    kind: "reply-to-your-question",
    text: "**Sarah Chen** replied to your question on **Generics in practice**.",
    href: "/courses",
    minutesAgo: 38,
    read: false,
  },
  {
    id: 3,
    kind: "new-question",
    text: "**Ana Souza** asked a question on **Generics in practice** in Introduction to TypeScript.",
    href: "/instructor/questions",
    minutesAgo: 95,
    read: false,
  },
  {
    id: 4,
    kind: "seat-claimed",
    text: "**Priya Nair** claimed a Seat on your **Building REST APIs with Node.js** Team Licence. 3 of 5 Seats are claimed.",
    href: "/team",
    minutesAgo: 180,
    read: true,
  },
  {
    id: 5,
    kind: "refund-request-approved",
    text: "Your refund for **Introduction to TypeScript** was approved. $79.00 is on its way back to the card you paid with.",
    href: "/settings",
    minutesAgo: 60 * 26,
    read: false,
  },
  {
    id: 6,
    kind: "refund-request-declined",
    text: "Your refund request for **Advanced React Patterns** was declined: “Most of the course has already been watched.”",
    href: "/settings",
    minutesAgo: 60 * 30,
    read: true,
  },
  {
    id: 7,
    kind: "course-status-changed",
    text: "**Alex Rivera** (Platform Admin) archived your course **Advanced React Patterns**.",
    href: "/instructor",
    minutesAgo: 60 * 50,
    read: true,
  },
  {
    id: 8,
    kind: "new-question",
    text: "**Kwame Mensah** asked a question on **Routing basics** in Building REST APIs with Node.js.",
    href: "/instructor/questions",
    minutesAgo: 60 * 72,
    read: true,
  },
];

function timeAgo(minutes: number) {
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// Shared in-memory store so the bar can show the state whatever variant is up.
let store = INITIAL;
const listeners = new Set<() => void>();

function useNotifications() {
  const [notifications, setLocal] = useState(store);
  useEffect(() => {
    const listener = () => setLocal(store);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  function set(next: MockNotification[]) {
    store = next;
    listeners.forEach((listener) => listener());
  }

  return {
    notifications,
    unread: notifications.filter((n) => !n.read).length,
    markRead: (id: number) =>
      set(store.map((n) => (n.id === id ? { ...n, read: true } : n))),
    markAllRead: () => set(store.map((n) => ({ ...n, read: true }))),
    reset: () => set(INITIAL),
    clear: () => set([]),
  };
}

// ─── Variant switching ───

export const VARIANTS = ["A", "B", "C"] as const;
export type Variant = (typeof VARIANTS)[number];
const VARIANT_NAMES: Record<Variant, string> = {
  A: "Sidebar bell + dropdown",
  B: "Inbox page",
  C: "Top bar + drawer",
};

// The param would be lost on every in-app link, so it is remembered for the tab.
export function usePrototypeVariant(): Variant {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get("variant");
  const [remembered, setRemembered] = useState<Variant>("A");

  useEffect(() => {
    if (fromUrl && (VARIANTS as readonly string[]).includes(fromUrl)) {
      try {
        sessionStorage.setItem("notifications-prototype", fromUrl);
      } catch {}
      setRemembered(fromUrl as Variant);
      return;
    }
    try {
      const saved = sessionStorage.getItem("notifications-prototype");
      if (saved && (VARIANTS as readonly string[]).includes(saved)) {
        setRemembered(saved as Variant);
      }
    } catch {}
  }, [fromUrl]);

  return remembered;
}

export function PrototypeSwitcher({ current }: { current: Variant }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { unread, notifications, reset, clear } = useNotifications();

  function go(step: number) {
    const index = VARIANTS.indexOf(current);
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    const params = new URLSearchParams(searchParams);
    params.set("variant", next);
    navigate({ search: params.toString() }, { replace: true });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/10">
      <span className="rounded bg-fuchsia-500 px-1.5 py-0.5 font-bold">
        PROTOTYPE
      </span>
      <button onClick={() => go(-1)} className="rounded p-1 hover:bg-white/10">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-44 text-center font-medium">
        {current} ({VARIANT_NAMES[current]})
      </span>
      <button onClick={() => go(1)} className="rounded p-1 hover:bg-white/10">
        <ChevronRight className="size-4" />
      </button>
      <span className="ml-1 border-l border-white/20 pl-2 tabular-nums">
        unread {unread}/{notifications.length}
      </span>
      <button onClick={reset} className="rounded px-1.5 py-0.5 hover:bg-white/10">
        reset
      </button>
      <button onClick={clear} className="rounded px-1.5 py-0.5 hover:bg-white/10">
        empty
      </button>
    </div>
  );
}

// ─── Shared pieces ───

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
      <InboxIcon className="size-8 opacity-40" />
      <p className="font-medium text-foreground">You're all caught up</p>
      <p>Refund decisions, replies to your questions and other news land here.</p>
    </div>
  );
}

// ─── Variant A: bell in the sidebar header, dropdown ───

export function VariantABell() {
  const { notifications, unread, markRead, markAllRead } = useNotifications();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell className="size-4" />
          <UnreadBadge count={unread} className="absolute -right-1 -top-1" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-baseline justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-primary hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-h-[28rem] overflow-y-auto py-1">
              {notifications.map((n) => (
                <Popover.Close asChild key={n.id}>
                  <Link
                    to={n.href}
                    onClick={() => markRead(n.id)}
                    className="flex gap-3 px-4 py-2.5 text-sm hover:bg-accent"
                  >
                    <span className="relative mt-0.5 shrink-0 text-muted-foreground">
                      {KIND[n.kind].icon}
                    </span>
                    <span className="flex-1 text-muted-foreground">
                      <RichText text={n.text} />
                      <span className="mt-0.5 block text-xs">
                        {timeAgo(n.minutesAgo)}
                      </span>
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-600" />
                    )}
                  </Link>
                </Popover.Close>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: Inbox nav item + full page ───

export function VariantBNavItem({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  const { unread } = useNotifications();
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <InboxIcon className="size-4" />
      Inbox
      <UnreadBadge count={unread} className="ml-auto" />
    </button>
  );
}

export function VariantBInboxPage({ onClose }: { onClose: () => void }) {
  const { notifications, unread, markRead, markAllRead } = useNotifications();
  const [selected, setSelected] = useState<number | null>(null);
  const current = notifications.find((n) => n.id === selected) ?? null;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inbox</h1>
          <p className="mt-1 text-muted-foreground">
            {unread === 0 ? "Nothing unread." : `${unread} unread`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={markAllRead}
            disabled={unread === 0}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-40"
          >
            Mark all as read
          </button>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Back to the page
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border">
          <EmptyState />
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_1.2fr] overflow-hidden rounded-lg border">
          <ul className="divide-y border-r">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setSelected(n.id);
                    markRead(n.id);
                  }}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-accent",
                    selected === n.id && "bg-accent",
                    !n.read && "border-l-4 border-l-blue-600 pl-3"
                  )}
                >
                  <span className="mt-0.5 text-muted-foreground">
                    {KIND[n.kind].icon}
                  </span>
                  <span className="flex-1">
                    <span
                      className={cn(
                        "block",
                        n.read ? "text-muted-foreground" : "font-medium"
                      )}
                    >
                      {KIND[n.kind].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(n.minutesAgo)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="p-6">
            {current ? (
              <>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  {KIND[current.kind].icon}
                  {KIND[current.kind].label} · {timeAgo(current.minutesAgo)}
                </div>
                <p className="mb-6 text-base text-muted-foreground">
                  <RichText text={current.text} />
                </p>
                <Link
                  to={current.href}
                  className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Open
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a Notification on the left to read it.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Variant C: top bar + slide-over drawer ───

function dayGroup(minutesAgo: number) {
  return minutesAgo < 60 * 24 ? "Today" : "Earlier";
}

export function VariantCTopBar() {
  const { notifications, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const shown = useMemo(
    () => (tab === "all" ? notifications : notifications.filter((n) => !n.read)),
    [tab, notifications]
  );
  const groups = ["Today", "Earlier"].map((label) => ({
    label,
    items: shown.filter((n) => dayGroup(n.minutesAgo) === label),
  }));

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-end border-b bg-background/80 px-6 backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Bell className="size-4" />
          {unread > 0 ? `${unread} new` : "Notifications"}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-[26rem] flex-col border-l bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Notifications</h2>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex items-center justify-between border-b px-5 py-2">
              <div className="flex gap-1 text-sm">
                {(["all", "unread"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium",
                      tab === key ? "bg-accent" : "text-muted-foreground"
                    )}
                  >
                    {key === "all" ? "All" : `Unread (${unread})`}
                  </button>
                ))}
              </div>
              <button
                onClick={markAllRead}
                disabled={unread === 0}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
              >
                Mark all as read
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {shown.length === 0 ? (
                <EmptyState />
              ) : (
                groups
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <section key={group.label}>
                      <h3 className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </h3>
                      {group.items.map((n) => (
                        <div
                          key={n.id}
                          className={cn(
                            "mx-3 mb-2 rounded-lg border p-3 text-sm",
                            !n.read && "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30"
                          )}
                        >
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            {KIND[n.kind].icon}
                            {KIND[n.kind].label}
                            <span className="ml-auto">{timeAgo(n.minutesAgo)}</span>
                          </div>
                          <p className="text-muted-foreground">
                            <RichText text={n.text} />
                          </p>
                          <div className="mt-2 flex gap-3 text-xs font-medium">
                            <Link
                              to={n.href}
                              onClick={() => {
                                markRead(n.id);
                                setOpen(false);
                              }}
                              className="text-primary hover:underline"
                            >
                              Open
                            </Link>
                            {!n.read && (
                              <button
                                onClick={() => markRead(n.id)}
                                className="text-muted-foreground hover:underline"
                              >
                                Mark as read
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  ))
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
