# Elec

CRM and delivery platform for a software company. Employees run the pipeline, projects, requirements, and approvals. Customers use a separate portal that can only see their own organization.

## Decisions

- One organization is the software company. Every business record is scoped to it, so a second company cannot read the first. Customers are accounts inside that company, not tenants.
- Workflow statuses are stored as lookup options. Administrators can rename them. Statuses the workflow depends on cannot be disabled, so old records stay valid.
- Money is stored in integer cents. Deadlines that are dates are stored as `YYYY-MM-DD` and compared in the organization timezone, not the browser clock.
- Emails go through an outbox. If Resend is down or unconfigured, the business transaction still commits and the message stays retryable.
- Archived projects are read-only. Scope added after baseline becomes a change request and does not rewrite the approved scope text.
- Comments default to internal. A customer-visible comment has to be chosen explicitly, and the API rejects the other direction for customer users.

## Setup

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Copy `.env.example` to `.env` if needed. `RESEND_API_KEY`, `EMAIL_FROM`, and `RESEND_WEBHOOK_SECRET` are optional until you send mail. The webhook endpoint is `POST /api/webhooks/resend`.

Development password for every seeded account: `Harbor!2026`

- Owner: `ada@elec.test`
- Project manager: `mira@elec.test`
- Account manager: `leo@elec.test`
- Developer: `noah@elec.test`
- Customer portal: `priya@northwind.test`
- Second organization, used to check isolation: `other@northline.test`

## Checks

```bash
npm run typecheck
npm test
npm run lint
```
