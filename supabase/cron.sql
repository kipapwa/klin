-- =====================================================================
-- Klin — agendador dos lembretes de dose (Supabase Cron = pg_cron + pg_net)
--
-- Chama a Edge Function disparar-lembretes a cada minuto.
-- Rode DEPOIS do schema.sql e DEPOIS de publicar a função.
--
-- PASSO 1 (uma vez, no SQL Editor, substituindo os valores — NÃO salve este
-- passo com os valores em nenhum arquivo do repositório):
--
--   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'klin_project_url');
--   select vault.create_secret('O-MESMO-VALOR-DO-SECRET-CRON_SECRET', 'klin_cron_secret');
--
--   Para trocar depois: select vault.update_secret(
--     (select id from vault.secrets where name = 'klin_cron_secret'), 'NOVO-VALOR');
--
-- PASSO 2: rode o restante deste arquivo (pode rodar de novo sem duplicar).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove o agendamento anterior com o mesmo nome, se existir.
select cron.unschedule(jobid) from cron.job where jobname = 'klin-lembretes';

select cron.schedule(
  'klin-lembretes',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'klin_project_url')
           || '/functions/v1/disparar-lembretes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'klin_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Conferir:
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, created from net._http_response order by created desc limit 5;
