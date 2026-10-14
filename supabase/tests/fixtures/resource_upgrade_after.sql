-- ISOLATED UPGRADE ASSERTION ONLY: run after the resource migration.
do $$
begin
 if (select count(*) from public.resource_upgrade_before)<>2 then raise exception 'Upgrade fixture incomplete';end if;
 if exists(select 1 from public.resource_upgrade_before old join public.dynamic_environment_data d on d.profile_id=old.profile_id where to_jsonb(d)-'resource_key'-'resource_reserved' is distinct from old.payload or not d.resource_reserved or d.resource_key is distinct from 'profile:'||d.profile_id::text or old.events is distinct from (select jsonb_agg(to_jsonb(e) order by e.id) from public.dynamic_environment_events e where e.profile_id=d.profile_id)) then raise exception 'Resource upgrade reset or changed existing data/ledger';end if;
 if (select payload->>'state' from public.dynamic_runs where idempotency_key='old-upgrade-run')<>'cancelled' then raise exception 'Upgrade changed old Run';end if;
 raise notice 'PASS: existing ready/dirty data, preparation snapshots, events and cancelled Run preserved by additive upgrade';
end $$;
