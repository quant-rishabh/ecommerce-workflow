# OpsPilot

OpsPilot is a customer operations agent for ecommerce workflows. Customers use a chat interface to ask about orders, shipments, returns, refunds, approvals, and pickup scheduling.

The chat is only the interface. The backend validates policies, reads and writes workflow state, creates Google Calendar events, and sends Gmail confirmations.

## What It Demonstrates

- Gemini tool calling through the OpenAI-compatible API.
- Typed operations for order lookup, shipment lookup, policy checks, returns, refunds, approvals, and pickup scheduling.
- Supabase persistence for orders and workflow state.
- Google Calendar pickup event creation and availability checks.
- Gmail OAuth and real pickup confirmation emails.
- Duplicate-return protection and backend validation before claiming success.

## Architecture

```mermaid
flowchart LR
		Customer --> Chat[Next.js Chat UI]
		Chat --> Agent[Gemini Agent]
		Agent --> Tools[Backend Tools]
		Tools --> DB[(Supabase)]
		Tools --> Calendar[Google Calendar]
		Tools --> Gmail[Gmail]
```

The important reliability rule is: the backend performs and verifies an action before the assistant tells the customer it succeeded.

## Requirements

- Node.js 20 or newer
- A Supabase project
- A Gemini API key
- Google service-account access to the target Calendar
- A Google OAuth client for Gmail, if real email delivery is required

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` in the project root. Start from `.env.example` and fill in the values:

```env
GEMINI_API_KEY=your_gemini_api_key

NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key

GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=C:\path\to\service-account.json
GOOGLE_CALENDAR_ID=your_calendar_id
GOOGLE_CALENDAR_TIME_ZONE=Asia/Kolkata

GOOGLE_GMAIL_OAUTH_CLIENT_FILE=C:\path\to\client_secret.json
GOOGLE_GMAIL_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
```

Never commit `.env.local`, service-account JSON files, Gmail tokens, or private keys.

## Supabase Setup

Create the application tables in the Supabase SQL Editor:

```sql
create table if not exists public.orders (
	id text primary key,
	customer_id text,
	customer_name text not null,
	email text,
	status text not null,
	delivered_at timestamptz,
	expected_delivery text,
	items jsonb not null default '[]'::jsonb,
	total_amount numeric not null,
	currency text not null
);

create table if not exists public.shipments (
	order_id text primary key references public.orders(id),
	carrier text,
	tracking_status text,
	current_location text,
	estimated_arrival text,
	delay_minutes integer default 0
);

create table if not exists public.returns (
	id text primary key,
	order_id text not null references public.orders(id),
	customer_name text not null,
	status text not null,
	created_at timestamptz not null default now()
);

create table if not exists public.refunds (
	id text primary key,
	order_id text not null references public.orders(id),
	amount numeric not null,
	currency text not null,
	reason text,
	status text not null,
	created_at timestamptz not null default now()
);

create table if not exists public.approval_requests (
	id text primary key,
	type text not null,
	order_id text not null references public.orders(id),
	customer_name text not null,
	amount numeric not null,
	currency text not null,
	reason text,
	status text not null,
	created_at timestamptz not null default now(),
	decided_at timestamptz
);

create table if not exists public.compensation_requests (
	id text primary key,
	order_id text not null references public.orders(id),
	amount numeric not null,
	currency text not null,
	reason text,
	status text not null,
	created_at timestamptz not null default now()
);

create table if not exists public.email_outbox (
	id text primary key,
	to_email text not null,
	subject text not null,
	body text not null,
	order_id text references public.orders(id),
	status text not null,
	sent_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
	id text primary key,
	order_id text not null references public.orders(id),
	customer_name text not null,
	slot_id text not null,
	slot_label text not null,
	type text not null,
	status text not null,
	created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.shipments enable row level security;
alter table public.returns enable row level security;
alter table public.refunds enable row level security;
alter table public.approval_requests enable row level security;
alter table public.compensation_requests enable row level security;
alter table public.email_outbox enable row level security;
alter table public.calendar_events enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
```

The application uses the server-only `SUPABASE_SERVICE_ROLE_KEY`, so it can work with RLS enabled. Do not expose this key in browser code.

## Migrate Seed Data

The JSON files in `data/` are seed and backup data. The application repositories use Supabase for operational data. To import the current JSON records:

```bash
node scripts/migrate-returns.mjs
```

The script migrates orders, shipments, returns, refunds, approvals, compensation requests, email history, and local calendar events. It is safe to rerun because it uses upserts.

To clear all return requests from Supabase during a demo reset:

```bash
node scripts/reset-returns.mjs
```

## Run the App

Development server:

```bash
npm run dev -- --port 3001
```

Open:

```text
http://localhost:3001/?gmail=connected
```

Other commands:

```bash
npm run build
npm start
```

## Demo Flow

1. Ask: `Where is my order #10492?`
2. Ask: `I want to return order #10802.`
3. Confirm: `Yes, return it.`
4. Choose: `Tomorrow around 10am.`
5. Verify the `returns` row in Supabase.
6. Verify the pickup event in Google Calendar.
7. Verify the confirmation email in Gmail.
8. Repeat the return request and show that duplicate requests are rejected.

## Agent Tools

- `getOrder`: reads order details.
- `getShipment`: reads tracking and delivery details.
- `checkPolicy`: checks eligibility without performing an action.
- `requestReturn`: creates a return only after confirmation.
- `checkCalendarAvailability`: finds open pickup slots.
- `schedulePickup`: creates a calendar event and sends confirmation.
- `requestRefundApproval`: creates a pending approval instead of processing money.
- `getApprovalStatus`: reads the latest approval state.
- `getPickupStatus`: reads the scheduled pickup.

## Reliability Guardrail

During testing, the model sometimes replied that a return was submitted without actually saving a record. The backend now handles an explicit return confirmation directly, validates the order, inserts the Supabase row, and only then reports success. A return with `RETURN_REQUESTED` or `PICKUP_SCHEDULED` status cannot be submitted again.

## Project Structure

```text
app/                 Next.js pages and API routes
lib/                 Server repositories, policies, and integrations
data/                Seed and backup JSON data
scripts/             Supabase migration and reset scripts
.env.example         Environment variable template
```

## Known Limitations

- This is a focused workflow prototype, not a production ecommerce backend.
- Google Calendar and Gmail require external account permissions.
- A scheduled pickup is not the same as a completed return; there is no warehouse-received state yet.
- Policy data remains local and should eventually move to a versioned database or policy service.
