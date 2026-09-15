-- Jardim Menu, Storage das fotos de produto (JM-002, §18.4).
--
-- Só roda onde existe o schema storage, isto é, no Supabase. Em Postgres puro, como no
-- teste com PGlite, o bloco avisa e não faz nada.
--
-- - Bucket público: foto de cardápio é conteúdo público, não é segredo (NF-006 não se
--   aplica a ela).
-- - Só WebP entra: a conversão e o corte acontecem no servidor, antes do upload.
-- - Escrita só por dono ou gestor, e só dentro da pasta da própria loja: o primeiro nível
--   do caminho é o id da loja.

begin;

do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'sem schema storage neste banco: bucket de fotos nao criado';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('produtos', 'produtos', true, 204800, array['image/webp'])
  on conflict (id) do nothing;

  execute $pol$
    create policy produtos_fotos_escrita on storage.objects for insert to authenticated
    with check (
      bucket_id = 'produtos'
      and public.jm_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager')
    )
  $pol$;

  execute $pol$
    create policy produtos_fotos_troca on storage.objects for update to authenticated
    using (
      bucket_id = 'produtos'
      and public.jm_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager')
    )
  $pol$;

  execute $pol$
    create policy produtos_fotos_remocao on storage.objects for delete to authenticated
    using (
      bucket_id = 'produtos'
      and public.jm_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager')
    )
  $pol$;
end;
$do$;

commit;
