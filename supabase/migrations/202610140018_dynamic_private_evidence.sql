-- Immutable, bounded private copies of recorded independent check evidence.
create table if not exists public.dynamic_evidence_copies(
 id uuid primary key,project_id uuid not null references public.projects(id) on delete cascade,
 run_id uuid not null references public.dynamic_runs(id) on delete cascade,evidence_id text not null,
 object_path text not null unique,state text not null check(state in ('pending','available','failed','deleting','deleted')),
 expires_at timestamptz not null,payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(run_id,evidence_id),unique(id,project_id)
);
create table if not exists public.dynamic_evidence_copy_leases(
 copy_id uuid primary key references public.dynamic_evidence_copies(id) on delete cascade,
 owner_id uuid not null,token uuid not null,expires_at timestamptz not null
);
alter table public.dynamic_evidence_copies enable row level security;
alter table public.dynamic_evidence_copy_leases enable row level security;
drop policy if exists dynamic_evidence_copies_read on public.dynamic_evidence_copies;
create policy dynamic_evidence_copies_read on public.dynamic_evidence_copies for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_evidence_copies,public.dynamic_evidence_copy_leases from public,anon,authenticated;
grant select on public.dynamic_evidence_copies to authenticated;

create or replace function public._dynamic_evidence_copy_json(c public.dynamic_evidence_copies)
returns jsonb language sql stable set search_path=public as $$select c.payload||jsonb_build_object('availability',case when c.state='deleted' then 'deleted' when c.expires_at<=now() then 'expired' else c.state end,'expiresAt',c.expires_at,'updatedAt',c.updated_at)$$;
revoke all on function public._dynamic_evidence_copy_json(public.dynamic_evidence_copies) from public,anon,authenticated;

create or replace function public.list_dynamic_evidence_copies(p_project_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if not exists(select 1 from public.dynamic_runs where id=p_run_id and project_id=p_project_id) then raise exception 'Run not found';end if;
 return (select coalesce(jsonb_agg(public._dynamic_evidence_copy_json(c) order by c.created_at,c.id),'[]') from public.dynamic_evidence_copies c where project_id=p_project_id and run_id=p_run_id);
end $$;
create or replace function public.prepare_dynamic_evidence_copy(p_project_id uuid,p_run_id uuid,p_evidence_id text,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;ref jsonb;c public.dynamic_evidence_copies%rowtype;l public.dynamic_evidence_copy_leases%rowtype;stamp timestamptz:=clock_timestamp();expiry timestamptz;mime text;oid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_bytes is null or p_bytes not between 1 and 4194304 or p_evidence_id is null or length(p_evidence_id) not between 1 and 200 then raise exception 'Bounded recorded evidence required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'state' is distinct from 'completed' or jsonb_typeof(r->'evidence') is distinct from 'array' then raise exception 'Completed independent evidence required';end if;
 if (select count(*) from jsonb_array_elements(r->'evidence') e where e->>'id'=p_evidence_id)<>1 then raise exception 'Unique recorded evidence required';end if;
 select e into ref from jsonb_array_elements(r->'evidence') e where e->>'id'=p_evidence_id;
 if ref->>'sha256' is null or ref->>'sha256' !~ '^[a-f0-9]{64}$' or ref->>'kind' is null or ref->>'kind' not in ('screenshot','checks','file_manifest') then raise exception 'Recorded checksum and evidence kind required';end if;
 mime:=case when ref->>'kind'='screenshot' then 'image/png' else 'application/json' end;
 begin expiry:=coalesce((ref->>'capturedAt')::timestamptz,(r->>'createdAt')::timestamptz)+interval '7 days';exception when others then raise exception 'Recorded capture date required';end;
 if expiry is null then raise exception 'Recorded capture date required';end if;
 select * into c from public.dynamic_evidence_copies where run_id=p_run_id and evidence_id=p_evidence_id for update;
 if c.id is null then
  c.id:=oid;c.project_id:=p_project_id;c.run_id:=p_run_id;c.evidence_id:=p_evidence_id;c.expires_at:=expiry;c.state:='pending';c.created_at:=stamp;c.updated_at:=stamp;
  c.object_path:=p_project_id::text||'/dynamic-v1/'||p_run_id::text||'/'||oid::text||'/'||(ref->>'sha256')||case when mime='image/png' then '.png' else '.json' end;
  c.payload:=jsonb_build_object('id',oid,'projectId',p_project_id,'runId',p_run_id,'evidenceId',p_evidence_id,'kind',ref->>'kind','sha256',ref->>'sha256','bytes',p_bytes,'mimeType',mime,'executorId',r->>'createdBy','syncedBy',null,'deletedBy',null,'createdAt',stamp);
  insert into public.dynamic_evidence_copies(id,project_id,run_id,evidence_id,object_path,state,expires_at,payload,created_at,updated_at) values(c.id,p_project_id,p_run_id,p_evidence_id,c.object_path,c.state,c.expires_at,c.payload,stamp,stamp);
 end if;
 if c.project_id<>p_project_id or c.payload->>'sha256'<>ref->>'sha256' or (c.payload->>'bytes')::integer<>p_bytes then raise exception 'Immutable evidence descriptor changed';end if;
 if c.state='deleted' or c.expires_at<=stamp then return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',null);end if;
 if c.state='available' then return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',null);end if;
 if c.state='deleting' then raise exception 'Finish recorded deletion first';end if;
 select * into l from public.dynamic_evidence_copy_leases where copy_id=c.id for update;
 if l.copy_id is not null and l.expires_at>stamp and l.owner_id<>auth.uid() then raise exception 'Evidence transfer still owned by another account';end if;
 if l.copy_id is null or l.expires_at<=stamp then l.token:=gen_random_uuid();end if;
 insert into public.dynamic_evidence_copy_leases(copy_id,owner_id,token,expires_at) values(c.id,auth.uid(),l.token,stamp+interval '2 minutes') on conflict(copy_id) do update set owner_id=excluded.owner_id,token=excluded.token,expires_at=excluded.expires_at;
 update public.dynamic_evidence_copies set state='pending',updated_at=stamp where id=c.id returning * into c;
 return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',l.token);
end $$;

create or replace function public.finish_dynamic_evidence_copy(p_project_id uuid,p_copy_id uuid,p_token uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.dynamic_evidence_copies%rowtype;l public.dynamic_evidence_copy_leases%rowtype;stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_outcome is null or p_outcome not in ('available','failed','deleted') then raise exception 'Transfer outcome required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into c from public.dynamic_evidence_copies where id=p_copy_id and project_id=p_project_id for update;
 select * into l from public.dynamic_evidence_copy_leases where copy_id=p_copy_id for update;
 if c.id is null or l.copy_id is null or l.owner_id<>auth.uid() or l.token is distinct from p_token or l.expires_at<=stamp then raise exception 'Evidence transfer fenced';end if;
 if p_outcome='deleted' and c.state<>'deleting' or p_outcome in ('available','failed') and (c.state<>'pending' or c.expires_at<=stamp) then raise exception 'Transfer state changed';end if;
 update public.dynamic_evidence_copies set state=p_outcome,payload=payload||jsonb_build_object('syncedBy',case when p_outcome='available' then auth.uid() else (payload->>'syncedBy')::uuid end,'deletedBy',case when p_outcome='deleted' then auth.uid() else (payload->>'deletedBy')::uuid end),updated_at=stamp where id=c.id returning * into c;
 delete from public.dynamic_evidence_copy_leases where copy_id=c.id;
 return public._dynamic_evidence_copy_json(c);
end $$;
create or replace function public.delete_dynamic_evidence_copy(p_project_id uuid,p_run_id uuid,p_copy_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.dynamic_evidence_copies%rowtype;l public.dynamic_evidence_copy_leases%rowtype;stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into c from public.dynamic_evidence_copies where id=p_copy_id and run_id=p_run_id and project_id=p_project_id for update;
 if c.id is null then raise exception 'Evidence copy not found';end if;
 if c.state='deleted' then return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',null);end if;
 select * into l from public.dynamic_evidence_copy_leases where copy_id=c.id for update;
 if l.copy_id is not null and l.expires_at>stamp and l.owner_id<>auth.uid() then raise exception 'Evidence operation still owned';end if;
 if l.copy_id is null or l.expires_at<=stamp or c.state<>'deleting' then l.token:=gen_random_uuid();end if;
 insert into public.dynamic_evidence_copy_leases(copy_id,owner_id,token,expires_at) values(c.id,auth.uid(),l.token,stamp+interval '2 minutes') on conflict(copy_id) do update set owner_id=excluded.owner_id,token=excluded.token,expires_at=excluded.expires_at;
 update public.dynamic_evidence_copies set state='deleting',updated_at=stamp where id=c.id returning * into c;
 return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',l.token);
end $$;

-- Restrictive policies apply only to the new versioned namespace; legacy objects
-- preserve their existing policies. No signed download URLs are issued.
create or replace function public.dynamic_evidence_object_allowed(p_path text,p_operation text)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.dynamic_evidence_copies c left join public.dynamic_evidence_copy_leases l on l.copy_id=c.id where c.object_path=p_path and public.is_project_member(c.project_id) and (
  p_operation='read' and c.expires_at>now() and (c.state='available' or c.state='pending' and l.owner_id=auth.uid() and l.expires_at>now())
  or p_operation='write' and c.state='pending' and c.expires_at>now() and l.owner_id=auth.uid() and l.expires_at>now()
  or p_operation='delete' and c.state='deleting' and l.owner_id=auth.uid() and l.expires_at>now()))
$$;
revoke all on function public.dynamic_evidence_object_allowed(text,text) from public,anon;
grant execute on function public.dynamic_evidence_object_allowed(text,text) to authenticated;
-- Local SQL fixtures without Storage still validate metadata/lease behavior.
do $$begin if to_regclass('storage.objects') is not null then
 if to_regprocedure('storage.allow_any_operation(text[])') is null then raise exception 'Storage operation-aware RLS helpers required';end if;
 execute 'drop policy if exists dynamic_v1_evidence_read on storage.objects';
 execute 'create policy dynamic_v1_evidence_read on storage.objects as restrictive for select to authenticated using (bucket_id<>''dynamic-evidence'' or name !~ ''^[0-9a-f-]{36}/dynamic-v1/'' or (storage.allow_any_operation(array[''object.get_authenticated'',''object.list'',''object.list_v2'',''object.info_authenticated'',''object.get_authenticated_info'',''object.head_authenticated_info'']) and public.dynamic_evidence_object_allowed(name,''read'')) or (storage.allow_any_operation(array[''object.upload'']) and public.dynamic_evidence_object_allowed(name,''write'')) or (storage.allow_any_operation(array[''object.delete'',''object.delete_many'']) and public.dynamic_evidence_object_allowed(name,''delete'')))';
 execute 'drop policy if exists dynamic_v1_evidence_insert on storage.objects';
 execute 'create policy dynamic_v1_evidence_insert on storage.objects as restrictive for insert to authenticated with check (bucket_id<>''dynamic-evidence'' or name !~ ''^[0-9a-f-]{36}/dynamic-v1/'' or public.dynamic_evidence_object_allowed(name,''write''))';
 execute 'drop policy if exists dynamic_v1_evidence_update on storage.objects';
 execute 'create policy dynamic_v1_evidence_update on storage.objects as restrictive for update to authenticated using (bucket_id<>''dynamic-evidence'' or name !~ ''^[0-9a-f-]{36}/dynamic-v1/'') with check (bucket_id<>''dynamic-evidence'' or name !~ ''^[0-9a-f-]{36}/dynamic-v1/'')';
 execute 'drop policy if exists dynamic_v1_evidence_delete on storage.objects';
 execute 'create policy dynamic_v1_evidence_delete on storage.objects as restrictive for delete to authenticated using (bucket_id<>''dynamic-evidence'' or name !~ ''^[0-9a-f-]{36}/dynamic-v1/'' or public.dynamic_evidence_object_allowed(name,''delete''))';
 end if;end $$;
revoke all on function public.list_dynamic_evidence_copies(uuid,uuid),public.prepare_dynamic_evidence_copy(uuid,uuid,text,integer),public.finish_dynamic_evidence_copy(uuid,uuid,uuid,text),public.delete_dynamic_evidence_copy(uuid,uuid,uuid) from public,anon;
grant execute on function public.list_dynamic_evidence_copies(uuid,uuid),public.prepare_dynamic_evidence_copy(uuid,uuid,text,integer),public.finish_dynamic_evidence_copy(uuid,uuid,uuid,text),public.delete_dynamic_evidence_copy(uuid,uuid,uuid) to authenticated;
