create table if not exists public.speaking_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  mode text not null,
  domain text not null,
  topic_label text,
  band_score numeric(3,1) not null,
  cefr text,
  answers_count integer not null default 0,
  score_detail jsonb not null default '{}'::jsonb,
  qa_transcripts jsonb not null default '[]'::jsonb,
  notes text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.speaking_sessions
  add column if not exists qa_transcripts jsonb not null default '[]'::jsonb;

create index if not exists idx_speaking_sessions_user_created_at
  on public.speaking_sessions (user_id, created_at desc);

create table if not exists public.user_coach_memory (
  user_id text primary key,
  preferred_model text,
  fine_tuned_model text,
  profile_summary text,
  weakness_tags text[] not null default '{}',
  argument_style text,
  session_count integer not null default 0,
  avg_band numeric(4,2) not null default 0,
  updated_at timestamptz not null default now()
);
