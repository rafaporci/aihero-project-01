# Which open-source notification framework fits Cadence?

Research for [issue #2](https://github.com/rafaporci/aihero-project-01/issues/2). Facts were gathered on 2026-11-16 from primary sources: GitHub repos and source, npm metadata, and official docs. Star counts and release dates are as of that day.

**Constraints.** React Router 8 in framework mode, Drizzle on better-sqlite3, one Node process, Tailwind with shadcn-style components (radix-ui, lucide, sonner). It must run in-process, so `npm run dev` stays the only command. The in-app channel is in scope now. Email and per-person preferences come later.

## Recommendation

**Own Drizzle table plus a shadcn-style UI (Origin UI's `notification-menu`) and polling, with an optional SSE resource route.** It is the only option that adds no service and no second schema system. It uses the existing Drizzle migrations and matches the existing component style. Cadence needs four operations: list, unread count, mark one read, mark all read. That is roughly one table and a few loaders/actions.

**Runner-up: easy-ping.** It is MIT, runs in-process, supports SQLite, has a headless React hook with SSE and a polling fallback, and comes with channels and preferences ready. It falls short today on maturity (pre-1.0, 11 stars, first published Sept 2026). Its Drizzle adapter is Postgres-only, so on SQLite its tables would sit outside our Drizzle schema. If email or preferences become a priority, look at it again.

**Rejected: Novu.** `@novu/react` cannot work without a Novu backend. Self-hosting Novu means MongoDB, Redis, and four services, which breaks the hard constraint.

## Comparison

| Option | Licence | Activity / adoption | Infra needed | UI shipped | Real-time | Channels / prefs later |
| --- | --- | --- | --- | --- | --- | --- |
| Novu (`@novu/react` + Cloud or self-host) | MIT core, proprietary `enterprise/` | 40.3k stars, v3.20.0 on 2026-11-16 | Novu Cloud, or self-hosted MongoDB + Redis + api/worker/ws/dashboard | Full Inbox (bell, tabs, counts, prefs) plus headless hooks | WebSocket (socket.io / partysocket) | Excellent (dozens of providers, prefs UI) |
| Knock / Courier / MagicBell React SDKs | SDKs MIT, backend proprietary SaaS | Active | Vendor cloud + API key | Full feed UI | Vendor sockets | Excellent, but SaaS |
| easy-ping | MIT (all of it) | 11 stars, v0.10.3, created Aug 2026, pre-1.0 | None (library on your DB) | Headless hook only | SSE + polling fallback, BroadcastChannel across tabs | Email, web push, Telegram, prefs, digests built in |
| Emito | MIT | 12 stars | Postgres + Redis | React hooks/components | WS / SSE / polling | Many channels, prefs engine |
| notifme-sdk | MIT | ~2k stars, last npm publish 2025-03 | None | None (sending only, no inbox) | n/a | Email/SMS/push sending |
| **Own Drizzle table + Origin UI + polling/SSE** | Ours + MIT UI | Origin UI (cosscom/ui) 10.9k stars, pushed 2026-11-14 | None | Copy-in shadcn component (bell, badge, mark one / all read) | `useRevalidator` polling, or SSE via resource route / `remix-utils` | We build them; schema can grow a `channel` column and a prefs table |

## Option details

### 1. Novu

- **Licence.** The repo has `LICENSE-MIT` and `LICENSE-ENTERPRISE`. Code under `enterprise/packages` uses a proprietary licence. Everything else is MIT. Sources: [LICENSE-ENTERPRISE](https://github.com/novuhq/novu/blob/next/LICENSE-ENTERPRISE), [LICENSE-MIT](https://github.com/novuhq/novu/blob/next/LICENSE-MIT). The npm packages `@novu/react` and `@novu/js` are ISC ([npm @novu/react](https://www.npmjs.com/package/@novu/react)).
- **Activity.** 40.3k stars. `v3.20.0` and `@novu/react@v3.20.0` were released on 2026-11-16 ([releases](https://github.com/novuhq/novu/releases)).
- **Can the Inbox run without the Novu backend? No.**
  - `@novu/js` (which `@novu/react` wraps) has a default backend URL of `https://api.novu.co`. It calls `/v1/inbox/session`, `/v1/inbox/notifications`, `/v1/inbox/preferences` and other routes ([http-client.ts](https://github.com/novuhq/novu/blob/next/packages/js/src/api/http-client.ts), [inbox-service.ts](https://github.com/novuhq/novu/blob/next/packages/js/src/api/inbox-service.ts)).
  - Its dependencies include `socket.io-client` and `partysocket` for the ws service ([npm @novu/js](https://www.npmjs.com/package/@novu/js)).
  - Headless mode also needs `applicationIdentifier` and `subscriber` and talks to the Novu API ([headless docs](https://docs.novu.co/platform/inbox/headless-mode)).
  - In theory we could re-implement Novu's private `/inbox/*` HTTP API and its socket protocol in our app. That surface is undocumented and changes with every release, so it is not a realistic option.
- **Self-hosted infra.**
  - The community docker-compose runs `redis`, `mongodb`, `api`, `worker`, `ws` and `dashboard` ([docker-compose.yml](https://github.com/novuhq/novu/blob/next/docker/community/docker-compose.yml)).
  - The docs say a single-VM deploy needs 4 vCPU / 8 GB plus MongoDB and Redis with AOF ([self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview)).
  - The docs also say some Inbox features, SSO and RBAC are missing from self-hosted Novu (same page).
- **UI fit.** The `appearance` prop accepts Tailwind classes per element, CSS variables, and icon overrides ([styling docs](https://docs.novu.co/platform/inbox/configuration/styling)). However, the UI is a Solid.js bundle (`solid-js` and `@kobalte/core` deps) mounted inside React, not radix/shadcn ([npm @novu/js](https://www.npmjs.com/package/@novu/js)).
- **Verdict.** It has the best features, but it breaks the "no extra services" constraint.

### 2. Hosted-vendor SDKs (Knock, Courier, MagicBell)

- The React SDKs are MIT, for example `@knocklabs/react` ([npm](https://www.npmjs.com/package/@knocklabs/react), [knocklabs/javascript](https://github.com/knocklabs/javascript)) and `@trycourier/courier-react` ([trycourier/courier-react](https://github.com/trycourier/courier-react)).
- They all need the vendor's cloud. For example, Knock's feed "requires an account on Knock … a public API key" ([Knock React feed docs](https://docs.knock.app/in-app-ui/react/feed)).
- **Verdict.** They are not open-source end to end and not in-process, so they are out.

### 3. easy-ping (DB-backed library)

- **Licence and maturity.** MIT. 11 stars. Repo created 2026-08-04. npm `easy-ping@0.10.3`, first published 2026-09-22, last updated 2026-10-28 ([repo](https://github.com/teklumt/easy-ping), [npm](https://www.npmjs.com/package/easy-ping)). The README says "Status: published, pre-1.0 … Minor versions may still move APIs before 1.0" ([README](https://github.com/teklumt/easy-ping#readme)).
- **Infra.** It claims "No queue, no worker service, no vendor". It is a dependency that stores data in your own Postgres, MySQL, SQLite or MongoDB ([README](https://github.com/teklumt/easy-ping#readme)).
- **SQLite and Drizzle.**
  - There is a SQLite adapter that takes a raw query function. The README says "better-sqlite3 works the same way" ([README](https://github.com/teklumt/easy-ping#readme)).
  - The Drizzle adapter's `createSchema()` is built with `drizzle-orm/pg-core` (`pgTable`, `jsonb`), so it is Postgres-only ([adapters/drizzle/schema.ts](https://github.com/teklumt/easy-ping/blob/main/packages/easy-ping/src/adapters/drizzle/schema.ts)).
  - On SQLite, its tables would be created by `createSqliteTables()` and would sit outside our Drizzle migrations and seed.
- **UI.** Only a headless hook, `useNotifications()` from `easy-ping/react`, which returns `notifications`, `unseenCount`, `markAsRead` and `markSeen`. We would still build the bell and list ourselves ([README](https://github.com/teklumt/easy-ping#readme)).
- **Integration.** You mount `notify.handler` (Fetch-style `GET`/`POST`). The README shows a Next.js route. In React Router it would be a resource route. Auth is plugged in through `session.getUserId(request)` ([README](https://github.com/teklumt/easy-ping#readme)).
- **Real-time.** One tab per browser holds a `GET /events` SSE stream and shares it with other tabs over `BroadcastChannel`. If the stream fails it falls back to polling ([README](https://github.com/teklumt/easy-ping#readme)).
- **Future.** Email (Resend), web push, Telegram, preferences and digests are built in ([README](https://github.com/teklumt/easy-ping#readme)).

### 4. Emito

- MIT, 12 stars ([emito-pro/emito](https://github.com/emito-pro/emito)).
- It backs onto PostgreSQL (via Drizzle) and Redis (via ioredis) ([README](https://github.com/emito-pro/emito#readme)). That means two extra services and no SQLite, so it is out.

### 5. notifme-sdk

- MIT, about 2k stars ([repo](https://github.com/notifme/notifme-sdk)). Last npm publish was 2025-03 ([npm](https://www.npmjs.com/package/notifme-sdk)).
- It is a multi-channel sending SDK (email, SMS, push) with no inbox storage or UI. It might help later with email, but it does not solve the Inbox.

### 6. Own Drizzle table + open-source shadcn UI (recommended)

- **Data.**
  - Add one `notifications` table to `app/db/schema.ts`, which already uses `sqliteTable`.
  - Columns: `id`, `recipientUserId`, `type`, `title`/`body` or a JSON payload, `link`, `createdAt`, `readAt`.
  - Add an index on `(recipientUserId, readAt)`.
  - Migrations and seed follow the existing Drizzle workflow, so there is no second schema system.
- **Server.** The work is a few loader/action calls:
  - the unread count in the root/layout loader, so the bell renders during SSR;
  - a resource route or loader for the list;
  - actions for mark one read (`UPDATE … SET readAt`) and mark all read.
  - React Router resource routes can return raw `Response` objects ([resource routes docs](https://reactrouter.com/how-to/resource-routes)).
- **UI.**
  - Origin UI's `notification-menu.tsx` is a shadcn Popover + Button with a lucide `BellIcon`, an unread-count badge, "Mark all as read", and click-to-mark-read ([source](https://github.com/cosscom/ui/blob/main/apps/origin/registry/default/components/navbar-components/notification-menu.tsx)).
  - It is MIT ([cosscom/ui](https://github.com/cosscom/ui), 10.9k stars, pushed 2026-11-14).
  - It comes as copy-in source in the same shadcn style Cadence already uses. We replace its local `useState` with loader data and `useFetcher` actions.
  - Similar shadcn notification blocks exist (for example [shadcn.io notification-center](https://www.shadcn.io/blocks/notification-center)), but Origin UI has the clearest licence and is the most maintained.
- **Real-time, in steps.**
  1. To start, revalidate on navigation and on focus or an interval (React Router `useRevalidator`). This needs no new infra.
  2. Later, add an SSE resource route. `remix-utils` v10 (MIT, 2.4k stars) ships `eventStream` (server) and `useEventSource` (client) and lists `react-router ^8.0.0` as a peer ([README](https://github.com/sergiodxa/remix-utils#readme), [npm](https://www.npmjs.com/package/remix-utils)). With one Node process, an in-memory event emitter can fan out to open streams with no Redis.
- **Future channels and preferences.** These are not free. We would add a `notificationPreferences` table and a channel dispatcher ourselves. notifme-sdk or easy-ping could be brought in at that point.

## Why the recommendation over easy-ping

1. **Fit with the schema.** The Inbox needs only a small table and four operations. Owning it keeps one Drizzle schema, one migration flow, and one seed. On SQLite, easy-ping would add tables that Drizzle does not manage (its Drizzle adapter is Postgres-only).
2. **Risk.** easy-ping is weeks old, pre-1.0, and maintained by one person with 11 stars. Building on it couples a core UI to an unproven API.
3. **UI.** Neither option ships styled UI that fits shadcn. easy-ping is headless and Origin UI is shadcn, so the UI work is the same either way.
4. **Real-time.** Polling and SSE are cheap in a single-process React Router app (`remix-utils` SSE), so easy-ping's main advantage is small at our scale.

## Uncertainties

- I did not install easy-ping or run it against React Router 8 and better-sqlite3. Its claims come only from its README and source.
- Novu might add an official "local/in-process" mode later. Nothing in the current docs or `@novu/js` source suggests one.
- The shadcn.io and 21st.dev notification blocks were not checked for licence. Prefer Origin UI (MIT) or write our own.
- How SSE behaves through whatever proxy runs in production was not checked. Polling remains the safe default.
