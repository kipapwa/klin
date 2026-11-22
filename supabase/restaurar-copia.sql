-- Klin: restaurar a cópia de segurança semanal (usado por scripts/restaurar-copia.mjs).
-- Rode UMA VEZ no SQL Editor do Supabase (pode rodar de novo). Não faz parte do schema.sql
-- porque só a restauração usa.
--   • Só a chave secreta (service_role) chama esta função; o app não consegue.
--   • Grava as linhas com o mesmo id da cópia (os vínculos entre registro, remédio e doses continuam).
--   • Modo 'faltando' (padrão): só recria o que sumiu; nada que já existe é alterado. Linha que
--     bateria com outra (valor único repetido, restrição de exclusão…) fica de fora.
--   • Modo 'sobrescrever': as linhas que já existem voltam a ser iguais às da cópia.
--   • Linha ligada a uma conta ou registro que não existe mais: se a ligação é obrigatória (perfil,
--     dose sem remédio…) a linha fica de fora; se não (remédio cujo registro sumiu), a ligação fica
--     vazia. Vale também para as ligações de duas colunas do Klin (record_id + user_id).
--   • Durante a gravação os gatilhos da tabela ficam desligados (só nesta transação): próxima dose,
--     fim do tratamento etc. já estão na cópia, e nada é recalculado nem duplicado.
--   • Exige chave primária de uma coluna só em cada tabela restaurada.
--   • p_simular = true só conta o que aconteceria, sem gravar nada.
-- Pode rodar de novo sem problema.

create or replace function public.restaurar_copia(
  p_tabela text, p_linhas jsonb, p_modo text default 'faltando', p_simular boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rel regclass;
  v_pk text;
  v_cols text[];
  v_lista text;
  v_set text;
  v_identidade boolean;
  v_seq text;
  fk record;
  v_tem text;
  v_igual text;
  v_anula text;
  n int;
  v_recebidas int := jsonb_array_length(p_linhas);
  v_descartadas int := 0;
  v_desligadas int := 0;
  v_novas int := 0;
  v_gravadas int := 0;
begin
  -- Mesmas tabelas da cópia (scripts/copia-seguranca.mjs).
  if p_tabela not in ('profiles', 'medical_records', 'medications', 'medication_logs',
                      'ai_saved_questions', 'ai_analyses', 'bp_readings') then
    raise exception 'Tabela % não pode ser restaurada.', p_tabela;
  end if;
  if p_modo not in ('faltando', 'sobrescrever') then raise exception 'Modo inválido: %', p_modo; end if;
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'p_linhas precisa ser uma lista.'; end if;
  if v_recebidas = 0 then
    return jsonb_build_object('recebidas', 0, 'descartadas', 0, 'sem_vinculo', 0, 'novas', 0, 'gravadas', 0);
  end if;
  v_rel := ('public.' || quote_ident(p_tabela))::regclass;

  -- Chave primária (todas as tabelas daqui têm uma coluna só).
  select a.attname into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
   where i.indrelid = v_rel and i.indisprimary;

  -- Colunas que existem na cópia e na tabela, menos as calculadas pelo banco (ex.: medical_records.search).
  select array_agg(a.attname order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and p_linhas->0 ? a.attname;
  if v_cols is null or not (v_pk = any (v_cols)) then
    raise exception 'A cópia de % não tem a coluna %.', p_tabela, v_pk;
  end if;
  select string_agg(quote_ident(c), ', ') into v_lista from unnest(v_cols) c;
  select exists (select 1 from pg_attribute where attrelid = v_rel and attidentity = 'a') into v_identidade;

  drop table if exists pg_temp._restaurar;
  execute format('create temp table _restaurar on commit drop as select * from jsonb_populate_recordset(null::%s, $1)', v_rel)
    using p_linhas;

  -- Ligações com outras tabelas (contas, registro, remédio), inclusive as de duas colunas
  -- (ex.: medications (record_id, user_id) -> medical_records (id, user_id)). Na simulação só as
  -- contas contam: as outras tabelas ainda podem ser restauradas antes desta.
  for fk in
    select c.confrelid::regclass as ref,
           array_agg(a.attname order by k.ord) as cols,
           array_agg(fa.attname order by k.ord) as refcols,
           bool_and(a.attnotnull) as obrigatoria,
           array_agg(a.attname order by k.ord) filter (where not a.attnotnull) as anulaveis
      from pg_constraint c
      cross join lateral unnest(c.conkey, c.confkey) with ordinality as k(col, refcol, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.col
      join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.refcol
     where c.contype = 'f' and c.conrelid = v_rel
       and (not p_simular or c.confrelid = 'auth.users'::regclass)
     group by c.oid, c.confrelid
  loop
    -- MATCH SIMPLE: com alguma coluna vazia, a ligação não é conferida.
    select string_agg(format('r.%I is not null', col), ' and ') into v_tem from unnest(fk.cols) col;
    select string_agg(format('x.%I = r.%I', rc, col), ' and ') into v_igual from unnest(fk.cols, fk.refcols) as u(col, rc);
    if fk.obrigatoria or fk.anulaveis is null then
      execute format('delete from pg_temp._restaurar r where %s and not exists (select 1 from %s x where %s)',
                     v_tem, fk.ref, v_igual);
      get diagnostics n = row_count;
      v_descartadas := v_descartadas + n;
    else
      select string_agg(format('%I = null', col), ', ') into v_anula from unnest(fk.anulaveis) col;
      execute format('update pg_temp._restaurar r set %s where %s and not exists (select 1 from %s x where %s)',
                     v_anula, v_tem, fk.ref, v_igual);
      get diagnostics n = row_count;
      v_desligadas := v_desligadas + n;
    end if;
  end loop;

  execute format('select count(*) from pg_temp._restaurar r where not exists (select 1 from %1$s t where t.%2$I = r.%2$I)',
                 v_rel, v_pk) into v_novas;

  if not p_simular then
    execute format('alter table %s disable trigger user', v_rel);
    if p_modo = 'faltando' then
      execute format('insert into %s (%s) %s select %s from pg_temp._restaurar on conflict do nothing',
                     v_rel, v_lista, case when v_identidade then 'overriding system value' else '' end, v_lista);
    else
      select string_agg(format('%1$I = excluded.%1$I', c), ', ') into v_set from unnest(v_cols) c where c <> v_pk;
      execute format('insert into %s (%s) %s select %s from pg_temp._restaurar on conflict (%I) %s',
                     v_rel, v_lista, case when v_identidade then 'overriding system value' else '' end, v_lista, v_pk,
                     case when v_set is null then 'do nothing' else 'do update set ' || v_set end);
    end if;
    get diagnostics v_gravadas = row_count;
    execute format('alter table %s enable trigger user', v_rel);

    -- Números automáticos (se alguma tabela tiver) continuam depois do maior que existe.
    if v_identidade then
      v_seq := pg_get_serial_sequence(v_rel::text, v_pk);
      execute format('select setval(%L, greatest((select coalesce(max(%I), 1) from %s), (select last_value from %s)))',
                     v_seq, v_pk, v_rel, v_seq);
    end if;
  end if;

  return jsonb_build_object('recebidas', v_recebidas, 'descartadas', v_descartadas, 'sem_vinculo', v_desligadas,
                            'novas', v_novas, 'gravadas', v_gravadas);
end $$;

revoke execute on function public.restaurar_copia(text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.restaurar_copia(text, jsonb, text, boolean) to service_role;
