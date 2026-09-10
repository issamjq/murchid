-- Murchid v2 schema — applied directly to the live project
-- (beftrmuhplksbsfsfunc) via the Supabase MCP connector; this file is the
-- git-tracked record of that state, kept idempotent so `npm run db:tune`
-- can re-apply it safely. The v1 schema (users/faculty/library_* etc.)
-- was dropped entirely — see docs/00-concept.md for what replaced it.

-- ── profiles: one row per Supabase Auth user, auto-created on signup ──
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'teacher' check (role in ('teacher','sub_admin','super_admin','organisation')),
  -- 'student' was added after this table already existed live, so the
  -- inline check above is superseded by the re-added constraint below.
  -- Students never reach this table by signing up — handle_new_user()
  -- makes every signup a pending teacher, and claim_student_invite()
  -- corrects the row once a real invite code is redeemed.
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  name text,
  email text,
  institution text,
  staff_id text,
  syllabus text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Widen the role vocabulary to include 'student'. Dropped and re-added
-- rather than edited in place, since the table already exists live; the
-- name is the one Postgres generated for the inline check (verified
-- against the live catalog, not assumed).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('teacher','sub_admin','super_admin','organisation','student'));

-- Single-device enforcement: a second sign-in supersedes the first.
-- claim_session() is called by the frontend right after a genuine
-- sign-in (SIGNED_IN, not a token refresh or page reload of an
-- already-open session) and unconditionally sets active_session_id to
-- the new session's id — it must bypass RLS to overwrite a row that may
-- belong to a session about to be superseded. session_ok() is what
-- every owner-scoped policy below ANDs in: true if the profile has
-- never claimed a session (NULL — so accounts predating this migration
-- aren't instantly locked out) or the caller's own JWT session_id still
-- matches what's on record.
alter table public.profiles add column if not exists active_session_id text;

create or replace function public.claim_session()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set active_session_id = auth.jwt()->>'session_id'
  where id = auth.uid();
$$;
revoke all on function public.claim_session() from public, anon;
grant execute on function public.claim_session() to authenticated;

create or replace function public.session_ok()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select active_session_id is null
        or active_session_id = (auth.jwt()->>'session_id')
        -- A claimed session whose auth.sessions row is gone (signed out,
        -- expired, revoked) is not evidence of another device — there is
        -- no other device holding it. Without this, a dead pointer left
        -- over from the 2026-09-06 incident (see below) permanently
        -- locks an account out instead of letting it recover on its own.
        or not exists (
             select 1 from auth.sessions s
             where s.id::text = p.active_session_id
           )
       from public.profiles p where p.id = auth.uid()),
    true
  );
$$;
revoke all on function public.session_ok() from public, anon;
grant execute on function public.session_ok() to authenticated;
-- Also to anon: without EXECUTE, any request that reaches a
-- session_ok()-gated policy without a valid session (an anon-context
-- call, or a request made in a brief window before a session is fully
-- attached) throws "permission denied for function" — a raw error —
-- instead of denying cleanly. Safe to grant: with auth.uid() null the
-- inner select finds no row and this coalesces to true, which is
-- harmless on its own because every policy ANDs it with an owner_id/
-- role check that still correctly evaluates to false for anon. Found
-- live in production (repeated "permission denied for function
-- session_ok" in postgres_logs) the same day this function shipped.
grant execute on function public.session_ok() to anon;

-- Reading your own profile is NEVER gated on session_ok() — 2026-09-06
-- incident: the window between a fresh sign-in landing (new session_id)
-- and claim_session() overwriting active_session_id is a legitimate
-- moment where this would otherwise return zero rows. The frontend
-- (session-context.tsx) took an empty read as proof of a real supersede
-- and called a *global* signOut(), destroying every session and refresh
-- token the account owned, on every device, on its own fresh login.
-- Writes still gate on session_ok() below — a superseded session can
-- read its own stale row (harmless) but can't act on it.
drop policy if exists "select own profile" on public.profiles;
create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);

-- A policy on `profiles` cannot query `profiles` inline (via EXISTS) to
-- check the caller's own role — Postgres detects that as infinite
-- recursion (42P17) and 500s every request, admin or not. Route the
-- self-lookup through a SECURITY DEFINER function instead, which runs
-- outside the calling role's RLS context.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('super_admin','sub_admin')
  );
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
-- Also to anon, for the same reason as session_ok() above: with
-- auth.uid() null the inner select finds no row, exists() is false,
-- which correctly denies admin-only reads for anon instead of throwing.
grant execute on function public.is_admin() to anon;

-- The super-admin accounts console needs to see every teacher, not just
-- the signed-in one.
drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles" on public.profiles
  for select using (public.is_admin() and public.session_ok());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id and public.session_ok());

-- Lets a super_admin/sub_admin approve other teachers.
drop policy if exists "admins manage other profiles" on public.profiles;
create policy "admins manage other profiles" on public.profiles
  for update using (public.is_admin() and public.session_ok());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Class hierarchy: batch -> grade -> division -> class (one subject) ──
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  start_year int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  level int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grades(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

-- One subject taught to one division — the app's single classId concept.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  created_at timestamptz not null default now()
);

-- ── Students: invite-only, never self-registered ──
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  roll_no text,
  email text,
  status text not null default 'invited' check (status in ('invited','active','removed')),
  created_at timestamptz not null default now()
);

-- Invite-only, per docs/00-concept.md: nobody self-registers as a student.
-- The teacher hands this code over however they already talk to the class
-- (there is no email transport in this product), the student redeems it at
-- /student/join, and claim_student_invite() nulls it — single use. The
-- default is generated in the database so a code is never client-chosen.
alter table public.students add column if not exists invite_code text
  default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
create unique index if not exists students_invite_code_key
  on public.students (invite_code) where invite_code is not null;

create table if not exists public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

-- ── Materials: shared notes/lessons — no "templates" concept ──
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'note' check (kind in ('note','lesson','ppt','other')),
  body_md text,
  storage_path text,
  subject text,
  syllabus text,
  grade_level int,
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.class_materials (
  class_id uuid not null references public.classes(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, material_id)
);
-- "My students in THIS class can read this note." Deliberately on the join
-- rather than on materials: one note can be attached to several classes,
-- and sharing it with Grade 9 Physics shouldn't publish it to every other
-- class it happens to be attached to. Not to be confused with
-- materials.is_shared, which means the platform-wide admin library.
alter table public.class_materials
  add column if not exists visible_to_students boolean not null default false;

-- Doubts anchored to a position in a material; an approved answer becomes
-- visible to the whole class, not just the asking student.
create table if not exists public.doubts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  anchor jsonb,
  question text not null,
  answer text,
  answered_by text check (answered_by in ('ai','faculty')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Goal Planner pipeline ──
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  prompt text,
  source text not null default 'prompt' check (source in ('prompt','upload','library')),
  status text not null default 'draft' check (status in ('drafting','draft','approved','failed')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
-- Added once the real backend's streaming /studio/plan endpoint shipped:
-- 'drafting' while the SSE stream is in flight, 'failed' if it dies
-- mid-stream, title/error for the UI, term_start/term_end from
-- /schedule, updated_at touched on every status transition.
alter table public.goals add column if not exists title text;
alter table public.goals add column if not exists error text;
alter table public.goals add column if not exists updated_at timestamptz not null default now();
alter table public.goals add column if not exists term_start date;
alter table public.goals add column if not exists term_end date;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'goals_term_order_check'
  ) then
    alter table public.goals add constraint goals_term_order_check
      check (term_start is null or term_end is null or term_start <= term_end) not valid;
    alter table public.goals validate constraint goals_term_order_check;
  end if;
end $$;

create table if not exists public.goal_items (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- 'note' is singular — matches the backend's generation response and
  -- materials.kind, not the old plural 'notes'.
  kind text not null check (kind in ('lesson_plan','slide_deck','note','quiz','exam','activity','homework')),
  title text not null,
  detail text,
  content jsonb,
  scheduled_for date,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft','approved','scheduled')),
  updated_at timestamptz not null default now()
);
-- Differentiated worksheets: a support/extend row is a sibling of the
-- standard (tier = null) item under the same goal_id, not a new table.
alter table public.goal_items add column if not exists tier text check (tier in ('support','extend'));

-- Which library/uploaded materials actually fed a generated plan — the
-- record class_materials can't carry, since it's what a plan is
-- grounded in, not what's merely attached to the class.
create table if not exists public.goal_sources (
  goal_id uuid not null references public.goals(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goal_id, material_id)
);
alter table public.goal_sources enable row level security;
drop policy if exists "owner full access" on public.goal_sources;
create policy "owner full access" on public.goal_sources for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  goal_item_id uuid references public.goal_items(id) on delete set null,
  kind text not null check (kind in ('quiz','exam')),
  title text not null,
  status text not null default 'draft' check (status in ('draft','scheduled')),
  content jsonb,
  scheduled_for date,
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  score numeric,
  created_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present','absent','late')),
  created_at timestamptz not null default now(),
  unique (class_id, student_id, date)
);

-- ── RLS: owner-scoped everywhere, denormalized owner_id avoids joins ──
alter table public.batches enable row level security;
alter table public.grades enable row level security;
alter table public.divisions enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.class_members enable row level security;
alter table public.materials enable row level security;
alter table public.class_materials enable row level security;
alter table public.doubts enable row level security;
alter table public.goals enable row level security;
alter table public.goal_items enable row level security;
-- Added after the table already existed live — explicit for re-runs.
alter table public.assessments add column if not exists content jsonb;

alter table public.assessments enable row level security;
alter table public.results enable row level security;
alter table public.attendance enable row level security;

-- Batch/grade/division/class used to be `for all` (select+insert+update+
-- delete in one policy). Split per-command with delete deliberately
-- omitted: once created, a batch/grade/division/class can't be removed —
-- the UI dropped its delete buttons, and RLS is the real authorization
-- boundary here (see CLAUDE.md), so the policy has to say the same thing
-- or a direct Supabase call would still get through.
drop policy if exists "owner full access" on public.batches;
drop policy if exists "select own batches" on public.batches;
create policy "select own batches" on public.batches for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "insert own batches" on public.batches;
create policy "insert own batches" on public.batches for insert
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "update own batches" on public.batches;
create policy "update own batches" on public.batches for update
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

drop policy if exists "owner full access" on public.grades;
drop policy if exists "select own grades" on public.grades;
create policy "select own grades" on public.grades for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "insert own grades" on public.grades;
create policy "insert own grades" on public.grades for insert
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "update own grades" on public.grades;
create policy "update own grades" on public.grades for update
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

drop policy if exists "owner full access" on public.divisions;
drop policy if exists "select own divisions" on public.divisions;
create policy "select own divisions" on public.divisions for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "insert own divisions" on public.divisions;
create policy "insert own divisions" on public.divisions for insert
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "update own divisions" on public.divisions;
create policy "update own divisions" on public.divisions for update
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

drop policy if exists "owner full access" on public.classes;
drop policy if exists "select own classes" on public.classes;
create policy "select own classes" on public.classes for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "insert own classes" on public.classes;
create policy "insert own classes" on public.classes for insert
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "update own classes" on public.classes;
create policy "update own classes" on public.classes for update
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

drop policy if exists "owner full access" on public.class_materials;
create policy "owner full access" on public.class_materials for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
-- Any signed-in teacher can read the shared library ("choose from deck"),
-- but only super_admin/sub_admin can add to it — a teacher still fully
-- manages their own private materials.
drop policy if exists "owner full access" on public.materials;
drop policy if exists "read own or shared materials" on public.materials;
create policy "read own or shared materials" on public.materials
  for select using ((owner_id = auth.uid() and public.session_ok()) or is_shared = true);
drop policy if exists "insert own materials, shared requires admin role" on public.materials;
create policy "insert own materials, shared requires admin role" on public.materials
  for insert with check (
    owner_id = auth.uid()
    and public.session_ok()
    and (
      is_shared = false
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin'))
    )
  );
-- The with-check mirrors the insert policy above on purpose. Without it a
-- teacher could `update materials set is_shared = true` on their own row
-- and publish into the library every signed-in teacher reads — the insert
-- rule says admins-only, and RLS is the whole authorization boundary here,
-- so the update path has to say the same thing. No UI ever flipped this
-- flag; shared rows belong to the admin who created them, so admins can
-- still edit and unpublish their own.
drop policy if exists "update own materials" on public.materials;
create policy "update own materials" on public.materials
  for update using (owner_id = auth.uid() and public.session_ok())
  with check (
    owner_id = auth.uid()
    and public.session_ok()
    and (
      is_shared = false
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin'))
    )
  );
-- No delete policy for materials: once created — including a document
-- added to the shared library — it can't be removed, by the same
-- teacher, an admin, or a direct Supabase call. The UI dropped its
-- delete/remove buttons; this is what actually enforces it.
drop policy if exists "delete own materials" on public.materials;
drop policy if exists "owner full access" on public.doubts;
create policy "owner full access" on public.doubts for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner full access" on public.goal_items;
create policy "owner full access" on public.goal_items for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner full access" on public.assessments;
create policy "owner full access" on public.assessments for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner full access" on public.results;
create policy "owner full access" on public.results for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner full access" on public.attendance;
create policy "owner full access" on public.attendance for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

-- ── Needs-attention digest: read-only aggregate views ──
-- Plain views (no `security definer`) over RLS-protected tables inherit
-- RLS from the querying role, so `owner_id = auth.uid()` filters applied
-- by the caller still narrow these to that teacher's own rows.
create or replace view public.assessment_progress as
select
  a.id as assessment_id,
  a.owner_id,
  a.class_id,
  a.kind,
  a.title,
  a.scheduled_for,
  c.subject,
  (select count(*) from public.class_members cm where cm.class_id = a.class_id) as roster_count,
  (select count(*) from public.results r where r.assessment_id = a.id) as graded_count
from public.assessments a
join public.classes c on c.id = a.class_id;

create or replace view public.class_attendance_freshness as
select
  c.id as class_id,
  c.owner_id,
  c.subject,
  max(a.date) as last_marked
from public.classes c
left join public.attendance a on a.class_id = c.id
group by c.id, c.owner_id, c.subject;

-- goal_items has no class_id of its own — it hangs off goals.class_id.
create or replace view public.goal_item_details as
select
  gi.id, gi.owner_id, gi.kind, gi.title, gi.scheduled_for, gi.updated_at,
  g.class_id, c.subject
from public.goal_items gi
join public.goals g on g.id = gi.goal_id
join public.classes c on c.id = g.class_id;

-- Preparation (drafting) is open to pending teachers; only actions that
-- reach real students require an approved profile.
drop policy if exists "owner reads own students" on public.students;
create policy "owner reads own students" on public.students for select
  using (owner_id = auth.uid() and public.session_ok());
-- The super-admin students console reads across every teacher's roster.
drop policy if exists "admins read all students" on public.students;
create policy "admins read all students" on public.students
  for select using (public.is_admin() and public.session_ok());
drop policy if exists "owner updates own students" on public.students;
create policy "owner updates own students" on public.students for update
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner deletes own students" on public.students;
create policy "owner deletes own students" on public.students for delete
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "active teachers add students" on public.students;
create policy "active teachers add students" on public.students
  for insert
  with check (
    owner_id = auth.uid()
    and public.session_ok()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
  );

drop policy if exists "owner reads own enrollments" on public.class_members;
create policy "owner reads own enrollments" on public.class_members for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner removes own enrollments" on public.class_members;
create policy "owner removes own enrollments" on public.class_members for delete
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "active teachers enroll students" on public.class_members;
create policy "active teachers enroll students" on public.class_members
  for insert
  with check (
    owner_id = auth.uid()
    and public.session_ok()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
  );

drop policy if exists "owner drafts goals" on public.goals;
create policy "owner drafts goals" on public.goals for insert
  with check (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner reads own goals" on public.goals;
create policy "owner reads own goals" on public.goals for select
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner deletes own goals" on public.goals;
create policy "owner deletes own goals" on public.goals for delete
  using (owner_id = auth.uid() and public.session_ok());
drop policy if exists "owner updates goals, approval needs active status" on public.goals;
create policy "owner updates goals, approval needs active status" on public.goals
  for update using (owner_id = auth.uid() and public.session_ok())
  with check (
    owner_id = auth.uid()
    and public.session_ok()
    and (
      status in ('drafting', 'draft', 'failed')
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
    )
  );

-- ── Storage: shared curriculum library ──
-- Public-read bucket so any signed-in teacher can open a document a
-- super_admin/sub_admin curated into the shared library; writes are
-- admin-only. (The other buckets — avatars, class-documents, etc. —
-- predate this file and aren't yet captured here.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-library', 'shared-library', true, 26214400,
  array['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain']
)
on conflict (id) do nothing;

drop policy if exists "shared_library_public_read" on storage.objects;
create policy "shared_library_public_read" on storage.objects for select
  using (bucket_id = 'shared-library');

drop policy if exists "shared_library_admin_insert" on storage.objects;
create policy "shared_library_admin_insert" on storage.objects for insert
  with check (
    bucket_id = 'shared-library'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin'))
  );

drop policy if exists "shared_library_admin_update" on storage.objects;
create policy "shared_library_admin_update" on storage.objects for update
  using (bucket_id = 'shared-library' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin')))
  with check (bucket_id = 'shared-library' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin')));

drop policy if exists "shared_library_admin_delete" on storage.objects;
create policy "shared_library_admin_delete" on storage.objects for delete
  using (bucket_id = 'shared-library' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin','sub_admin')));

-- ── Analytics: real, minimal event logging ──
-- Not full product telemetry (no rage-click/dead-click/session tracking)
-- — just three honest signals the app can actually emit today: a page
-- was viewed, a generation was requested, a client error was thrown.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('page_view','generation','client_error')),
  path text,
  feature text,
  class_id uuid references public.classes(id) on delete set null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_kind_created_at_idx
  on public.analytics_events (kind, created_at desc);
create index if not exists analytics_events_owner_id_idx
  on public.analytics_events (owner_id);

alter table public.analytics_events enable row level security;

drop policy if exists "owner logs own events" on public.analytics_events;
create policy "owner logs own events" on public.analytics_events
  for insert with check (owner_id = auth.uid() and public.session_ok());

drop policy if exists "admins read all events" on public.analytics_events;
create policy "admins read all events" on public.analytics_events
  for select using (public.is_admin());

-- ── Feature costs: real editable config, not yet enforced ──
-- There's no live credits/billing system to deduct against, so this is
-- pricing policy the super-admin can set now, ready for when generation
-- and credits are both real.
create table if not exists public.feature_costs (
  feature text primary key check (feature in ('lesson_plan','slide_deck','activity','homework','note','quiz','exam')),
  credit_cost numeric not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.feature_costs enable row level security;

drop policy if exists "anyone signed in reads feature costs" on public.feature_costs;
create policy "anyone signed in reads feature costs" on public.feature_costs
  for select using (auth.uid() is not null);

drop policy if exists "admins write feature costs" on public.feature_costs;
create policy "admins write feature costs" on public.feature_costs
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.feature_costs (feature, credit_cost) values
  ('lesson_plan', 1),
  ('slide_deck', 2),
  ('activity', 1),
  ('homework', 1),
  ('note', 1),
  ('quiz', 1),
  ('exam', 2)
on conflict (feature) do nothing;

-- ── Owned by the backend, mirrored here defensively ──
-- audit_log and the OpenRouter key pool belong to murchid-backend
-- (final/backend, db/2026-09-04-audit-and-key-pool.sql), not this repo —
-- nothing in the frontend reads or writes them. They're copied here only
-- so a future "clean slate" migration doesn't silently drop them again,
-- which is exactly what clean_slate_v2 did on 2026-09-04: it took out
-- these tables without anyone noticing until the Keys console broke.
-- If this file and the backend's copy ever disagree, the backend's is
-- authoritative — update this block to match, not the other way round.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_recent_idx on public.audit_log (created_at desc);

create table if not exists public.llm_keys (
  id bigint generated always as identity primary key,
  provider text not null default 'openrouter',
  label text not null unique,
  key_value text not null unique,
  status text not null default 'active' check (status in ('active', 'probation', 'disabled')),
  cooldown_until timestamptz,
  last_ok_at timestamptz,
  last_err_at timestamptz,
  note text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists llm_keys_active_idx on public.llm_keys (provider, id) where status = 'active';

create table if not exists public.llm_key_events (
  id bigint generated always as identity primary key,
  label text not null,
  event text not null check (event in ('added', 'seeded', 'probed_ok', 'probe_failed',
    'rate_limited', 'refused', 'transient', 'cooled', 'probation', 'disabled', 'reenabled', 'removed')),
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists llm_key_events_label_idx on public.llm_key_events (label, created_at desc);
create index if not exists llm_key_events_recent_idx on public.llm_key_events (created_at desc);

create table if not exists public.key_pool_settings (
  id boolean primary key default true check (id),
  min_active_keys int not null default 1,
  cooldown_minutes int not null default 90,
  min_keys_alert int not null default 3,
  alert_email text,
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.key_pool_settings (id) values (true) on conflict (id) do nothing;

-- RLS on with NO policy: unreachable from any browser role. Only the
-- backend's own pooler connection (which bypasses RLS) can read these.
alter table public.audit_log         enable row level security;
alter table public.llm_keys          enable row level security;
alter table public.llm_key_events    enable row level security;
alter table public.key_pool_settings enable row level security;

revoke all on public.audit_log         from public, anon, authenticated;
revoke all on public.llm_keys          from public, anon, authenticated;
revoke all on public.llm_key_events    from public, anon, authenticated;
revoke all on public.key_pool_settings from public, anon, authenticated;

create or replace function public.set_key_pool_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists llm_keys_touch on public.llm_keys;
create trigger llm_keys_touch before update on public.llm_keys
  for each row execute function public.set_key_pool_updated_at();

-- ── Subscriptions: flat monthly/annual per teacher ──
-- Written only by the backend's Stripe webhook handler, over its own
-- pooler connection (bypasses RLS) — no insert/update/delete policy
-- exists for any browser role on purpose, matching the same principle
-- as credits/usage_logs/audit_log: a teacher cannot extend their own
-- plan, and a frontend bug can't fabricate a subscription either.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  billing_period text check (billing_period in ('monthly', 'annual')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_owner_idx on public.subscriptions (owner_id);

alter table public.subscriptions enable row level security;

drop policy if exists "owner reads own subscription" on public.subscriptions;
create policy "owner reads own subscription" on public.subscriptions
  for select using (owner_id = auth.uid() and public.session_ok());

drop policy if exists "admins read all subscriptions" on public.subscriptions;
create policy "admins read all subscriptions" on public.subscriptions
  for select using (public.is_admin() and public.session_ok());

-- ── Report-card comments: one live comment per student per class ──
-- No term/semester concept exists anywhere else in the schema (only
-- goals.term_start/term_end, scoped to the Goal Planner) — this doesn't
-- invent one either.
create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  comment_text text,
  status text not null default 'draft' check (status in ('draft','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id)
);

alter table public.report_comments enable row level security;

drop policy if exists "owner full access" on public.report_comments;
create policy "owner full access" on public.report_comments for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

-- ── Curriculum coverage: foundation only — no UI reads this yet ──
-- `source` distinguishes a teacher-typed unit from one
-- POST /api/curriculum/derive produced (now live) — both are rows
-- in the same table, and coverage math doesn't care which.
create table if not exists public.syllabus_units (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  seq int not null,
  title text not null,
  outcomes text[] not null default '{}',
  typical_weeks numeric,
  source text not null default 'manual' check (source in ('manual','derived')),
  created_at timestamptz not null default now(),
  unique (class_id, seq)
);

alter table public.syllabus_units enable row level security;

drop policy if exists "owner full access" on public.syllabus_units;
create policy "owner full access" on public.syllabus_units for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

-- Tags a lesson/homework/etc. as covering a unit — nullable, so untagged
-- items (all of them, until the coverage UI ships) are unaffected.
alter table public.goal_items add column if not exists unit_id uuid references public.syllabus_units(id) on delete set null;

-- ── Parent updates: drafted for the teacher to copy, never sent ──
-- Separate from report_comments (which is unique per class+student and
-- written for the school record) because this is the same student in a
-- different register, for a different reader. Nothing in this product
-- can email anyone, so there is deliberately no guardian contact column
-- and no send log — both arrive with a transport, not before it.
create table if not exists public.parent_updates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  update_text text,
  status text not null default 'draft' check (status in ('draft','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id)
);

alter table public.parent_updates enable row level security;

drop policy if exists "owner full access" on public.parent_updates;
create policy "owner full access" on public.parent_updates for all
  using (owner_id = auth.uid() and public.session_ok())
  with check (owner_id = auth.uid() and public.session_ok());

-- ══ Students: redeeming an invite, and the first non-owner read path ══
--
-- Everything above this line is `owner_id = auth.uid()` or `is_admin()`.
-- What follows is the only way a non-owner reads a teacher's rows, so it
-- is deliberately narrow: a student sees a note only when their own
-- claimed account is a member of a class the teacher has explicitly
-- flagged that note visible in.

-- Redeeming a code does two writes a student cannot do themselves — the
-- students row belongs to the teacher, and role is not self-assignable —
-- so it bypasses RLS, exactly like claim_session() above. It validates
-- the code rather than trusting the caller, and nulls it on success so a
-- code cannot be redeemed twice.
create or replace function public.claim_student_invite(code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select id into target_id
  from public.students
  where invite_code = upper(trim(code))
    and auth_user_id is null
    and status = 'invited'
  for update;

  if target_id is null then
    raise exception 'that invite code is not valid, or has already been used'
      using errcode = 'P0001';
  end if;

  update public.students
  set auth_user_id = auth.uid(),
      status = 'active',
      invite_code = null
  where id = target_id;

  -- handle_new_user() made this a pending teacher on signup; correct it.
  update public.profiles
  set role = 'student', status = 'active', updated_at = now()
  where id = auth.uid();
end;
$$;
revoke all on function public.claim_student_invite(text) from public, anon;
grant execute on function public.claim_student_invite(text) to authenticated;

-- Resolves the caller to their own students row. Its own SELECT policy
-- would otherwise be circular, and every policy below needs the answer.
create or replace function public.current_student_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.students
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
$$;
revoke all on function public.current_student_id() from public, anon;
grant execute on function public.current_student_id() to authenticated;

-- A student reads their own row (name, to greet them by) and nothing else.
drop policy if exists "student reads own record" on public.students;
create policy "student reads own record" on public.students
  for select using (
    auth_user_id = auth.uid() and public.session_ok()
  );

-- …their own enrolment rows. Not cosmetic: RLS applies to tables named
-- inside a policy's own subqueries too, so without this every EXISTS on
-- class_members below silently matches nothing and a student sees an
-- empty portal. Found by testing the policies rather than reading them.
drop policy if exists "student reads own membership" on public.class_members;
create policy "student reads own membership" on public.class_members
  for select using (
    class_members.student_id = public.current_student_id()
    and public.session_ok()
  );

-- …the classes they're enrolled in, so notes can be grouped by subject.
drop policy if exists "student reads own classes" on public.classes;
create policy "student reads own classes" on public.classes
  for select using (
    public.session_ok()
    and exists (
      select 1 from public.class_members mem
      where mem.class_id = classes.id
        and mem.student_id = public.current_student_id()
    )
  );

-- …the attachments their teacher has flagged visible in those classes…
drop policy if exists "student reads visible class materials" on public.class_materials;
create policy "student reads visible class materials" on public.class_materials
  for select using (
    class_materials.visible_to_students = true
    and public.session_ok()
    and exists (
      select 1 from public.class_members mem
      where mem.class_id = class_materials.class_id
        and mem.student_id = public.current_student_id()
    )
  );

-- …and the note behind each one. With auth_user_id unset everywhere,
-- current_student_id() is NULL and every EXISTS above is false, so these
-- policies grant nothing until a real invite is actually redeemed.
drop policy if exists "student reads visible materials" on public.materials;
create policy "student reads visible materials" on public.materials
  for select using (
    public.session_ok()
    and exists (
      select 1
      from public.class_materials cm
      join public.class_members mem on mem.class_id = cm.class_id
      where cm.material_id = materials.id
        and cm.visible_to_students = true
        and mem.student_id = public.current_student_id()
    )
  );
