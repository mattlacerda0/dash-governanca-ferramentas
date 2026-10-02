-- Governança de ferramentas: aplicar no projeto Business Data
-- Schema: _dashboard_ferramentas

create schema if not exists _dashboard_ferramentas;
create extension if not exists btree_gist;

create table if not exists _dashboard_ferramentas.categorias_funcionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.areas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.ferramentas (
  id uuid primary key default gen_random_uuid(),
  nome_normalizado text not null unique,
  nome text not null,
  categoria_funcional_id uuid references _dashboard_ferramentas.categorias_funcionais(id),
  tipo_ferramenta text not null default 'opcional' check (tipo_ferramenta in ('estruturante', 'opcional')),
  origem_categoria text not null default 'importacao' check (origem_categoria in ('importacao', 'manual')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.periodos_uso_ferramenta_area (
  id uuid primary key default gen_random_uuid(),
  ferramenta_id uuid not null references _dashboard_ferramentas.ferramentas(id) on delete cascade,
  area_id uuid not null references _dashboard_ferramentas.areas(id) on delete restrict,
  quantidade_usuarios integer not null check (quantidade_usuarios > 0),
  data_inicio date not null,
  data_fim date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (data_fim is null or data_fim >= data_inicio),
  exclude using gist (
    ferramenta_id with =,
    area_id with =,
    daterange(data_inicio, coalesce(data_fim + 1, 'infinity'::date), '[)') with &&
  )
);

create table if not exists _dashboard_ferramentas.perfis_acesso (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  perfil text not null check (perfil in ('administrador', 'membro')),
  criado_em timestamptz not null default now()
);

insert into _dashboard_ferramentas.areas(nome) values ('Product & Experience') on conflict (nome) do nothing;
insert into _dashboard_ferramentas.perfis_acesso(email, perfil)
values ('matheuslacerda@quartavia.com.br', 'administrador')
on conflict (email) do update set perfil = excluded.perfil;

create table if not exists _dashboard_ferramentas.arquivos_drive (
  id uuid primary key default gen_random_uuid(),
  arquivo_drive_id text not null unique,
  nome text not null,
  modificado_em timestamptz,
  importado_em timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.lancamentos_financeiros (
  id uuid primary key default gen_random_uuid(),
  chave_deduplicacao text not null unique,
  ferramenta_id uuid not null references _dashboard_ferramentas.ferramentas(id),
  arquivo_drive_id text references _dashboard_ferramentas.arquivos_drive(arquivo_drive_id),
  fornecedor text not null,
  valor numeric(14,2) not null check (valor >= 0),
  data_lancamento date not null,
  situacao text,
  observacao text,
  incluido_em text,
  incluido_por text,
  criado_em timestamptz not null default now()
);

create table if not exists _dashboard_ferramentas.solicitacoes_reembolso (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid not null,
  solicitante_email text not null,
  ferramenta_id uuid references _dashboard_ferramentas.ferramentas(id),
  ferramenta_nome text not null,
  valor numeric(14,2) not null check (valor > 0),
  data_despesa date not null,
  justificativa text not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'aprovado', 'recusado')),
  comentario_decisao text,
  decidido_por uuid,
  decisor_email text,
  decidido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists lancamentos_financeiros_ferramenta_data_idx on _dashboard_ferramentas.lancamentos_financeiros(ferramenta_id, data_lancamento);
create index if not exists periodos_uso_ferramenta_area_idx on _dashboard_ferramentas.periodos_uso_ferramenta_area(ferramenta_id, area_id, data_inicio);
create index if not exists solicitacoes_reembolso_situacao_criado_idx on _dashboard_ferramentas.solicitacoes_reembolso(situacao, criado_em desc);

create or replace function _dashboard_ferramentas.atualizar_data_modificacao()
returns trigger
as $atualizar_data_modificacao$
begin
  new.atualizado_em := now();
  return new;
end;
$atualizar_data_modificacao$
language plpgsql
set search_path = '';

drop trigger if exists ferramentas_atualizar_modificacao on _dashboard_ferramentas.ferramentas;
create trigger ferramentas_atualizar_modificacao before update on _dashboard_ferramentas.ferramentas for each row execute function _dashboard_ferramentas.atualizar_data_modificacao();
drop trigger if exists periodos_uso_atualizar_modificacao on _dashboard_ferramentas.periodos_uso_ferramenta_area;
create trigger periodos_uso_atualizar_modificacao before update on _dashboard_ferramentas.periodos_uso_ferramenta_area for each row execute function _dashboard_ferramentas.atualizar_data_modificacao();
drop trigger if exists solicitacoes_reembolso_atualizar_modificacao on _dashboard_ferramentas.solicitacoes_reembolso;
create trigger solicitacoes_reembolso_atualizar_modificacao before update on _dashboard_ferramentas.solicitacoes_reembolso for each row execute function _dashboard_ferramentas.atualizar_data_modificacao();

revoke all on schema _dashboard_ferramentas from public, anon, authenticated;
grant usage on schema _dashboard_ferramentas to service_role;
grant all on all tables in schema _dashboard_ferramentas to service_role;
grant usage, select on all sequences in schema _dashboard_ferramentas to service_role;

alter table _dashboard_ferramentas.categorias_funcionais enable row level security;
alter table _dashboard_ferramentas.areas enable row level security;
alter table _dashboard_ferramentas.ferramentas enable row level security;
alter table _dashboard_ferramentas.periodos_uso_ferramenta_area enable row level security;
alter table _dashboard_ferramentas.perfis_acesso enable row level security;
alter table _dashboard_ferramentas.arquivos_drive enable row level security;
alter table _dashboard_ferramentas.lancamentos_financeiros enable row level security;
alter table _dashboard_ferramentas.solicitacoes_reembolso enable row level security;
