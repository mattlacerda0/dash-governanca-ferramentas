-- Governança de ferramentas: aplicar no projeto Business Data
-- Schema: _dashboard_ferramentas

create schema if not exists _dashboard_ferramentas;
create extension if not exists btree_gist;

create table if not exists _dashboard_ferramentas.tool_functional_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.tools (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique,
  name text not null,
  functional_category_id uuid references _dashboard_ferramentas.tool_functional_categories(id),
  tool_type text not null default 'optional' check (tool_type in ('structural', 'optional')),
  category_source text not null default 'import' check (category_source in ('import', 'manual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.tool_area_usage_periods (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references _dashboard_ferramentas.tools(id) on delete cascade,
  area_id uuid not null references _dashboard_ferramentas.areas(id) on delete restrict,
  users_count integer not null check (users_count > 0),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  exclude using gist (
    tool_id with =,
    area_id with =,
    daterange(starts_on, coalesce(ends_on + 1, 'infinity'::date), '[)') with &&
  )
);

create table if not exists _dashboard_ferramentas.user_roles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

insert into _dashboard_ferramentas.areas(name) values ('Product & Experience') on conflict (name) do nothing;
insert into _dashboard_ferramentas.user_roles(email, role)
values ('matheuslacerda@quartavia.com.br', 'admin')
on conflict (email) do update set role = excluded.role;

create table if not exists _dashboard_ferramentas.drive_files (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  name text not null,
  modified_at timestamptz,
  imported_at timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.financial_entries (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  tool_id uuid not null references _dashboard_ferramentas.tools(id),
  drive_file_id text references _dashboard_ferramentas.drive_files(drive_file_id),
  supplier text not null,
  amount numeric(14,2) not null check (amount >= 0),
  occurred_on date not null,
  status text,
  note text,
  included_at text,
  included_by text,
  created_at timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null,
  requester_email text not null,
  tool_id uuid references _dashboard_ferramentas.tools(id),
  tool_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null,
  justification text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_comment text,
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_entries_tool_date_idx on _dashboard_ferramentas.financial_entries(tool_id, occurred_on);
create index if not exists usage_periods_tool_area_idx on _dashboard_ferramentas.tool_area_usage_periods(tool_id, area_id, starts_on);
create index if not exists reimbursements_status_created_idx on _dashboard_ferramentas.reimbursement_requests(status, created_at desc);

create or replace function _dashboard_ferramentas.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists tools_touch_updated_at on _dashboard_ferramentas.tools;
create trigger tools_touch_updated_at before update on _dashboard_ferramentas.tools for each row execute function _dashboard_ferramentas.touch_updated_at();
drop trigger if exists usage_periods_touch_updated_at on _dashboard_ferramentas.tool_area_usage_periods;
create trigger usage_periods_touch_updated_at before update on _dashboard_ferramentas.tool_area_usage_periods for each row execute function _dashboard_ferramentas.touch_updated_at();
drop trigger if exists reimbursement_touch_updated_at on _dashboard_ferramentas.reimbursement_requests;
create trigger reimbursement_touch_updated_at before update on _dashboard_ferramentas.reimbursement_requests for each row execute function _dashboard_ferramentas.touch_updated_at();

revoke all on schema _dashboard_ferramentas from public, anon, authenticated;
grant usage on schema _dashboard_ferramentas to service_role;
grant all on all tables in schema _dashboard_ferramentas to service_role;
grant usage, select on all sequences in schema _dashboard_ferramentas to service_role;

alter table _dashboard_ferramentas.tool_functional_categories enable row level security;
alter table _dashboard_ferramentas.areas enable row level security;
alter table _dashboard_ferramentas.tools enable row level security;
alter table _dashboard_ferramentas.tool_area_usage_periods enable row level security;
alter table _dashboard_ferramentas.user_roles enable row level security;
alter table _dashboard_ferramentas.drive_files enable row level security;
alter table _dashboard_ferramentas.financial_entries enable row level security;
alter table _dashboard_ferramentas.reimbursement_requests enable row level security;
