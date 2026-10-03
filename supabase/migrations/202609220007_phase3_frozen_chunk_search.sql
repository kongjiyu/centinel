-- Similarity lookup is deliberately limited to the Review's immutable
-- artifact versions. SECURITY INVOKER retains artifact_chunks RLS.
create or replace function public.match_frozen_artifact_chunks(
  p_project_id uuid,
  p_version_ids uuid[],
  p_embedding vector(1536),
  p_embedding_model text,
  p_limit integer default 16
)
returns table (
  artifact_version_id uuid,
  ordinal integer,
  content text,
  metadata jsonb,
  distance double precision
)
language sql
stable
security invoker
-- pgvector's <=> operator is installed with the vector extension. Keep both
-- supported extension locations visible; application relations/functions
-- below remain schema-qualified.
set search_path = public, extensions
as $$
  select c.artifact_version_id, c.ordinal, c.content, c.metadata,
    (c.embedding <=> p_embedding)::double precision as distance
  from public.artifact_chunks c
  where c.project_id = p_project_id
    and c.artifact_version_id = any(p_version_ids)
    and c.embedding is not null
    and c.embedding_model = p_embedding_model
    and auth.uid() is not null
    and public.is_project_member(p_project_id)
  order by c.embedding <=> p_embedding
  limit least(greatest(coalesce(p_limit, 16), 1), 32);
$$;

revoke all on function public.match_frozen_artifact_chunks(uuid, uuid[], vector, text, integer) from public, anon;
grant execute on function public.match_frozen_artifact_chunks(uuid, uuid[], vector, text, integer) to authenticated;
