# Dashboard de governança de ferramentas

Dashboard standalone da QuartaVia para acompanhar inventário de SaaS, custos,
verticais de Product & Experience, redundâncias e reembolsos.

## Executar

Requer Node.js 18 ou superior.

```bash
copy .env.example .env
npm start
```

Abra `http://localhost:3012`. Sem variáveis Clara, o dashboard funciona com o
inventário seed e exibe um aviso metodológico.

## Integração Clara

A API Clara é acessada exclusivamente pelo servidor usando mTLS e OAuth 2.0.
Configure em `.env`:

- `CLARA_BASE_URL` (`https://public-api.br.clara.com`)
- `CLARA_CLIENT_ID`
- `CLARA_CLIENT_SECRET`
- `CLARA_CERT_PATH`
- `CLARA_KEY_PATH`
- `CLARA_CACHE_TTL_MS` (padrão: `900000`, ou 15 minutos)
- `CLARA_TAX_IDENTIFIER` (opcional, somente para contas multiempresa)

Guarde certificado e chave privada em `secrets/`, diretório ignorado pelo git.
Não coloque credenciais em `public/`.

## Dados editáveis

- `data/inventory.json`: inventário P&E e agregados corporativos
- `data/redundancies.json`: oportunidades de consolidação
- `data/headcount.json`: tamanho mensal do time P&E

O seed contém as 23 ferramentas detalhadas no material de referência. Os totais
das demais áreas são agregados até a importação da planilha completa de 85
ferramentas.

## Google Drive (base consolidada)

Quando configurado, o Google Drive substitui a fonte do dashboard. A cada
sincronização o servidor lê todos os arquivos `.xlsx` da pasta, localiza a
tabela financeira, consolida seus lançamentos e remove duplicidades exatas. Um
arquivo diário novo, portanto, acrescenta apenas registros ainda não presentes.

Configure estas variáveis na Vercel (nunca em `public/`):

- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_DRIVE_CACHE_TTL_MS` (opcional; padrão: 15 minutos)

Compartilhe a pasta do Drive com a conta de serviço como **Leitor**. A
categorização de ferramentas é automática, a partir de fornecedor e observação.
Campos não presentes nas planilhas são apresentados como "Sem dado informado".

### Usar conta pessoal

Como alternativa, não é necessário criar uma conta de serviço. Crie credenciais
OAuth no seu próprio projeto Google Cloud e configure:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REFRESH_TOKEN`

O refresh token deve ter somente o escopo `drive.readonly`. Quando essas três
variáveis estão preenchidas, o dashboard prioriza sua conta pessoal e não usa
as variáveis de conta de serviço.

## Testes

```bash
npm test
```

Para validar a conexão sem exibir dados financeiros, pessoais ou credenciais:

```bash
npm run verify:clara
```
