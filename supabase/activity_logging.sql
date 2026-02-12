-- Activity logging + active session tracking setup
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  event_type text not null check (
    event_type in (
      'auth.login',
      'auth.signup',
      'auth.signout',
      'bank.export',
      'bank.import'
    )
  ),
  status text not null check (status in ('success', 'failed')),
  user_id uuid null references auth.users(id) on delete set null,
  email text null,
  session_key uuid null,
  device_fingerprint text null,
  device_name text null,
  device_model text null,
  platform text null,
  browser text null,
  os text null,
  bank_id text null,
  bank_name text null,
  pad_count int null,
  error_message text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_activity_logs_created_at on public.activity_logs (created_at desc);
create index if not exists idx_activity_logs_event_type_created on public.activity_logs (event_type, created_at desc);
create index if not exists idx_activity_logs_user_created on public.activity_logs (user_id, created_at desc);
create index if not exists idx_activity_logs_status_created on public.activity_logs (status, created_at desc);

create table if not exists public.active_sessions (
  session_key uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text null,
  device_fingerprint text not null,
  device_name text null,
  device_model text null,
  platform text null,
  browser text null,
  os text null,
  ip inet null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_online boolean not null default true,
  last_event text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_active_sessions_last_seen on public.active_sessions (last_seen_at desc);
create index if not exists idx_active_sessions_user_last_seen on public.active_sessions (user_id, last_seen_at desc);

create or replace view public.v_active_sessions_now
with (security_invoker = true) as
select
  session_key,
  user_id,
  email,
  device_fingerprint,
  device_name,
  device_model,
  platform,
  browser,
  os,
  ip,
  first_seen_at,
  last_seen_at,
  is_online,
  last_event,
  meta
from public.active_sessions
where is_online = true
  and last_seen_at >= (now() - interval '2 minutes');

create or replace view public.v_active_counts_now
with (security_invoker = true) as
select
  count(*)::int as active_sessions,
  count(distinct user_id)::int as active_users
from public.v_active_sessions_now;

create or replace function public.upsert_active_session(
  p_session_key uuid,
  p_user_id uuid,
  p_email text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_model text,
  p_platform text,
  p_browser text,
  p_os text,
  p_ip inet,
  p_last_event text,
  p_meta jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.active_sessions (
    session_key, user_id, email, device_fingerprint, device_name, device_model,
    platform, browser, os, ip, first_seen_at, last_seen_at, is_online, last_event, meta
  )
  values (
    p_session_key, p_user_id, p_email, p_device_fingerprint, p_device_name, p_device_model,
    p_platform, p_browser, p_os, p_ip, now(), now(), true, p_last_event, coalesce(p_meta, '{}'::jsonb)
  )
  on conflict (session_key) do update
  set
    user_id = excluded.user_id,
    email = excluded.email,
    device_fingerprint = excluded.device_fingerprint,
    device_name = excluded.device_name,
    device_model = excluded.device_model,
    platform = excluded.platform,
    browser = excluded.browser,
    os = excluded.os,
    ip = excluded.ip,
    last_seen_at = now(),
    is_online = true,
    last_event = excluded.last_event,
    meta = coalesce(excluded.meta, '{}'::jsonb);
end;
$$;

create or replace function public.mark_session_offline(
  p_session_key uuid,
  p_last_event text default 'auth.signout'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.active_sessions
  set is_online = false,
      last_seen_at = now(),
      last_event = p_last_event
  where session_key = p_session_key;
end;
$$;

create or replace function public.cleanup_activity_data() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.activity_logs
  where created_at < (now() - interval '90 days');

  update public.active_sessions
  set is_online = false
  where is_online = true
    and last_seen_at < (now() - interval '10 minutes');
end;
$$;

alter table public.activity_logs enable row level security;
alter table public.active_sessions enable row level security;

drop policy if exists activity_logs_deny_all on public.activity_logs;
create policy activity_logs_deny_all on public.activity_logs
for all using (false) with check (false);

drop policy if exists active_sessions_deny_all on public.active_sessions;
create policy active_sessions_deny_all on public.active_sessions
for all using (false) with check (false);
