create table if not exists public.geographic_validation_cache (
  normalized_name text not null,
  requested_category public.answer_category not null,
  result jsonb not null,
  osm_type text,
  osm_id bigint,
  canonical_name text not null,
  country_code text,
  raw_metadata jsonb,
  validated_at timestamptz not null default now(),
  primary key (normalized_name, requested_category)
);

create index if not exists geographic_validation_cache_validated_at_idx
  on public.geographic_validation_cache (validated_at desc);

alter table public.geographic_validation_cache enable row level security;

create policy geographic_validation_cache_service_role_policy
  on public.geographic_validation_cache
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.geographic_validation_cache is 'Persistent cache for geographic validation results used by the country/city/village validators.';
