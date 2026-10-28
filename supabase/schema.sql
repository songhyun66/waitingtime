-- 보건실 대기열 테이블, 권한(RLS), Realtime 설정
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다. 테이블이 이미 있으면 생성은 건너뛰고 권한과 Realtime 설정만 적용됩니다.

-- 1. 테이블 ----------------------------------------------------------------
create table if not exists public.health_queue (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  student_id    text        not null,
  student_name  text        not null,
  reason_id     text        not null,
  reason_label  text        not null,
  wait_minutes  integer     not null check (wait_minutes between 0 and 60),
  status        text        not null default 'waiting' check (status in ('waiting', 'done')),
  completed_at  timestamptz
);

create index if not exists health_queue_created_at_idx on public.health_queue (created_at);

-- 2. 권한 ------------------------------------------------------------------
-- Publishable 키로 들어온 요청은 Postgres의 anon 역할로 처리됩니다.
alter table public.health_queue enable row level security;

grant select, insert, update on public.health_queue to anon;

drop policy if exists "anon can read queue"   on public.health_queue;
drop policy if exists "anon can add to queue" on public.health_queue;
drop policy if exists "anon can mark done"    on public.health_queue;

-- 학생 화면(대기 합계)과 교사 화면(목록) 모두 읽기가 필요합니다.
create policy "anon can read queue"
  on public.health_queue for select to anon
  using (true);

-- 학생 화면: 새 접수는 waiting 상태로만 넣을 수 있습니다.
create policy "anon can add to queue"
  on public.health_queue for insert to anon
  with check (status = 'waiting');

-- 교사 화면: 진료 완료 처리.
create policy "anon can mark done"
  on public.health_queue for update to anon
  using (true)
  with check (status in ('waiting', 'done'));

-- 삭제 정책은 일부러 만들지 않았습니다 (anon은 지울 수 없음).

-- 3. Realtime --------------------------------------------------------------
-- 이게 빠지면 실시간 구독이 CHANNEL_ERROR로 실패하고, 화면은 15초 폴링으로만 갱신됩니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'health_queue'
  ) then
    alter publication supabase_realtime add table public.health_queue;
  end if;
end $$;
