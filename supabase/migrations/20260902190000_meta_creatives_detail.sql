-- =============================================================================
-- CRIATIVOS REAIS V1 — detalhamento de meta_creatives
-- =============================================================================
-- Aditivo. NÃO cria/dropa tabela. NÃO toca meta_ad_creatives nem meta_ads.
-- 0 linhas afetadas (as colunas nascem NULL; o meta-sync as preenche no próximo
-- sync).
--
-- meta_ad_creatives permanece INALTERADA: `first_seen`/`last_seen` já bastam
-- como LOG DE OBSERVAÇÃO (datas de sincronização). "criativo atual" =
-- (creative_id = meta_ads.creative_id); "houve troca observada" =
-- count(linhas do ad_id) > 1. Sem colunas redundantes (is_current /
-- observed_from / observed_until).
--
-- FIELDS (AdCreative, Marketing API v26.0 — todos confirmados):
--   image_hash                identidade estável da imagem (thumbnail_url expira)
--   object_story_id           post da página que embasa o creative
--   effective_object_story_id post efetivamente renderizado (shadow post)
--   object_story_spec (jsonb) headline/body/cta/carousel + variantes — cru
--
-- `status` (do AdCreative) NÃO é adicionado: é field real mas quase sempre
-- ACTIVE e sem uso na V1. `asset_feed_spec` e `raw` (jsonb) já existem na META 1.
-- =============================================================================

alter table public.meta_creatives
  add column if not exists image_hash                text,
  add column if not exists object_story_id           text,
  add column if not exists effective_object_story_id text,
  add column if not exists object_story_spec         jsonb;

create index if not exists meta_creatives_image_hash_idx
  on public.meta_creatives (image_hash)
  where image_hash is not null;

create index if not exists meta_creatives_video_id_idx
  on public.meta_creatives (video_id)
  where video_id is not null;

-- =============================================================================
-- ROLLBACK (manual):
--   drop index if exists public.meta_creatives_image_hash_idx;
--   drop index if exists public.meta_creatives_video_id_idx;
--   alter table public.meta_creatives
--     drop column if exists image_hash,
--     drop column if exists object_story_id,
--     drop column if exists effective_object_story_id,
--     drop column if exists object_story_spec;
-- =============================================================================
