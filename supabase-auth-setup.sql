-- Run this in Supabase SQL Editor before testing the auth version of bevcrew.
-- It adds real profiles, logged-in user ownership, and crew/friend feed filtering.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  avatar_url text,
  created_at timestamp with time zone default now()
);

alter table public.posts
  add column if not exists user_id uuid references public.profiles(id) on delete set null;

alter table public.reactions
  add column if not exists user_id uuid references public.profiles(id) on delete set null;

alter table public.comments
  add column if not exists user_id uuid references public.profiles(id) on delete set null;

create table if not exists public.crew_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  unique (owner_id, member_id),
  check (owner_id <> member_id)
);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;
alter table public.crew_memberships enable row level security;

-- Remove the early prototype anonymous policies.
drop policy if exists "public read posts" on public.posts;
drop policy if exists "public insert posts" on public.posts;
drop policy if exists "public read reactions" on public.reactions;
drop policy if exists "public insert reactions" on public.reactions;
drop policy if exists "public read comments" on public.comments;
drop policy if exists "public insert comments" on public.comments;

-- Profiles
drop policy if exists "profiles read authenticated" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

create policy "profiles read authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "profiles insert own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles update own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Posts
drop policy if exists "posts read authenticated" on public.posts;
drop policy if exists "posts insert own" on public.posts;
drop policy if exists "posts update own" on public.posts;
drop policy if exists "posts delete own" on public.posts;

create policy "posts read authenticated"
on public.posts for select
to authenticated
using (true);

create policy "posts insert own"
on public.posts for insert
to authenticated
with check (auth.uid() = user_id);

create policy "posts update own"
on public.posts for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "posts delete own"
on public.posts for delete
to authenticated
using (auth.uid() = user_id);

-- Reactions
drop policy if exists "reactions read authenticated" on public.reactions;
drop policy if exists "reactions insert own" on public.reactions;
drop policy if exists "reactions delete own" on public.reactions;

create policy "reactions read authenticated"
on public.reactions for select
to authenticated
using (true);

create policy "reactions insert own"
on public.reactions for insert
to authenticated
with check (auth.uid() = user_id);

create policy "reactions delete own"
on public.reactions for delete
to authenticated
using (auth.uid() = user_id);

-- Comments
drop policy if exists "comments read authenticated" on public.comments;
drop policy if exists "comments insert own" on public.comments;
drop policy if exists "comments update own" on public.comments;
drop policy if exists "comments delete own" on public.comments;

create policy "comments read authenticated"
on public.comments for select
to authenticated
using (true);

create policy "comments insert own"
on public.comments for insert
to authenticated
with check (auth.uid() = user_id);

create policy "comments update own"
on public.comments for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "comments delete own"
on public.comments for delete
to authenticated
using (auth.uid() = user_id);

-- Crew memberships. Each user owns their own crew list.
drop policy if exists "crew read own" on public.crew_memberships;
drop policy if exists "crew insert own" on public.crew_memberships;
drop policy if exists "crew delete own" on public.crew_memberships;

create policy "crew read own"
on public.crew_memberships for select
to authenticated
using (auth.uid() = owner_id);

create policy "crew insert own"
on public.crew_memberships for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "crew delete own"
on public.crew_memberships for delete
to authenticated
using (auth.uid() = owner_id);

-- Storage: public read, authenticated upload.
drop policy if exists "public upload bev photos" on storage.objects;
drop policy if exists "authenticated upload bev photos" on storage.objects;

create policy "authenticated upload bev photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'bev-photos');
