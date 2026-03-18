-- Add per-service buffer support.
-- Run this once in Supabase SQL editor.

alter table if exists public.servicios
  add column if not exists buffer_min int;

update public.servicios
set buffer_min = 0
where buffer_min is null;

alter table if exists public.servicios
  alter column buffer_min set default 0;

alter table if exists public.servicios
  alter column buffer_min set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ck_servicios_buffer_nonneg'
  ) then
    alter table public.servicios
      add constraint ck_servicios_buffer_nonneg check (buffer_min >= 0);
  end if;
end $$;

