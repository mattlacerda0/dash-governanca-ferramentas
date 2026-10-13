# Conexão com Google Drive

Este documento descreve a conexão usada pelo dashboard para ler as planilhas
financeiras de uma pasta do Google Drive. A configuração atual usa OAuth da
conta pessoal, com acesso somente de leitura.

## Visão geral

1. Uma pessoa inclui uma nova planilha `.xlsx` na pasta do Drive.
2. O servidor lista todos os arquivos `.xlsx` da pasta e lê suas planilhas.
3. Os lançamentos válidos são padronizados e as duplicidades são removidas.
4. O resultado é gravado no Supabase, sem sobrescrever lançamentos já
   importados.
5. O dashboard usa o Supabase como fonte principal e mantém o Drive como
   origem de sincronização.

O acesso ao Google Drive acontece somente no servidor. Nenhuma chave, token ou
segredo é disponibilizado no navegador.

## 1. Preparar a pasta no Google Drive

1. Crie ou escolha a pasta que receberá as planilhas diárias.
2. Copie o identificador da pasta, presente na URL após `/folders/`.
3. Garanta que a conta Google que será autorizada tenha acesso de leitura a
   essa pasta.
4. Mantenha na pasta apenas arquivos `.xlsx` que devam fazer parte da base.

Exemplo de URL:

```text
https://drive.google.com/drive/folders/IDENTIFICADOR_DA_PASTA
```

## 2. Criar as credenciais OAuth no Google Cloud

1. Acesse o Google Cloud Console com a conta que administrará a integração.
2. Crie ou selecione um projeto.
3. Em **APIs e serviços > Biblioteca**, habilite a **Google Drive API**.
4. Em **Tela de consentimento OAuth**, configure o aplicativo. Enquanto ele
   estiver em modo de teste, inclua a conta que autorizará o Drive como usuária
   de teste.
5. Em **Credenciais**, crie um cliente OAuth 2.0.
6. Guarde o `client_id` e o `client_secret` do cliente criado. Eles vêm no
   arquivo JSON baixado pelo Google Cloud.

## 3. Gerar o refresh token da conta pessoal

O refresh token permite que o servidor continue lendo a pasta sem pedir login
todos os dias.

1. Abra o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Nas configurações do Playground, habilite **Use your own OAuth credentials**.
3. Informe o `client_id` e o `client_secret` criados no Google Cloud.
4. Em **Step 1**, use somente o escopo:

   ```text
   https://www.googleapis.com/auth/drive.readonly
   ```

5. Clique em **Authorize APIs** e entre com a conta que possui acesso à pasta.
6. Em **Step 2**, clique em **Exchange authorization code for tokens**.
7. Copie somente o valor de **Refresh token**.

O token deve ser tratado como senha: não o envie por e-mail, não o salve em
planilhas e não o publique no GitHub.

## 4. Configurar as variáveis no projeto local

No arquivo `.env`, preencha:

```dotenv
GOOGLE_DRIVE_FOLDER_ID=identificador-da-pasta
GOOGLE_OAUTH_CLIENT_ID=seu-client-id
GOOGLE_OAUTH_CLIENT_SECRET=seu-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=seu-refresh-token
GOOGLE_DRIVE_CACHE_TTL_MS=900000
```

O cache é de 15 minutos (`900000` milissegundos). Durante esse intervalo, o
dashboard reutiliza a última leitura da pasta para evitar chamadas repetidas ao
Google Drive.

> Não é necessário preencher `GOOGLE_SERVICE_ACCOUNT_EMAIL` e
> `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` quando as três variáveis `GOOGLE_OAUTH_*`
> estiverem configuradas. A aplicação prioriza o OAuth da conta pessoal.

## 5. Configurar as variáveis na Vercel

Em **Vercel > Projeto > Settings > Environment Variables**, cadastre as mesmas
cinco variáveis acima para o ambiente **Production**. Os valores do `.env`
local não são enviados automaticamente para a Vercel.

Para a sincronização com o banco, confirme também que as variáveis do Supabase
já estão presentes:

```dotenv
TOOLS_SUPABASE_URL=
TOOLS_SUPABASE_SERVICE_ROLE_KEY=
TOOLS_SUPABASE_SCHEMA=_dashboard_ferramentas
TOOLS_CRON_SECRET=
```

Após incluir ou alterar uma variável, execute um novo deploy na Vercel.

## 6. Formato esperado da planilha

O importador procura uma aba que contenha, no mínimo, as colunas abaixo:

| Coluna | Uso no dashboard |
| --- | --- |
| `Fornecedor (Razão Social)` | Nome do fornecedor e identificação da ferramenta |
| `Valor da Conta` | Valor financeiro do lançamento |
| `Data de Registro` | Ano e mês dos filtros do dashboard |
| `Observação` | Campo complementar para categorização |
| `Situação` | Situação do lançamento |
| `Inclusão` e `Incluído por` | Usados na identificação de duplicidade quando disponíveis |

Linhas sem fornecedor, data válida ou valor são ignoradas. A categorização
inicial é feita por regras de fornecedor e observação; ajustes manuais feitos
no catálogo de ferramentas são preservados.

## 7. Consolidação e deduplicação

Cada lançamento recebe uma chave calculada a partir de situação, valor, data,
fornecedor, observação, inclusão e responsável pela inclusão. Se o mesmo
lançamento aparecer em mais de uma planilha, ele é mantido apenas uma vez na
base `lancamentos_financeiros` do Supabase.

Assim, quando uma nova planilha diária é adicionada à pasta, a sincronização
inclui somente os registros novos. Arquivos já existentes podem continuar na
pasta sem duplicar os valores do dashboard.

## 8. Sincronizar e validar

1. Como administradora ou administrador, abra **Cadastro de ferramentas**.
2. Clique em **Sincronizar Drive**.
3. Aguarde o aviso de conclusão e atualize o dashboard.
4. Verifique o aviso de fonte no topo, que deve indicar `Supabase + Drive`.
5. Confirme se a nova planilha e os novos lançamentos aparecem nos filtros de
   ano e mês corretos.

Além da sincronização manual, a Vercel está configurada para chamar
`/api/cron-sync` diariamente às `05:00 UTC`. O endpoint protegido usa
`TOOLS_CRON_SECRET` e atualiza o Supabase com os arquivos disponíveis na pasta.

## Diagnóstico rápido

| Sintoma | Verificação |
| --- | --- |
| Dashboard mostra inventário seed | Confira as variáveis do Drive e faça novo deploy após alterá-las. |
| Erro HTTP do Google Drive | Verifique se o refresh token ainda é válido e se a Drive API está habilitada. |
| Pasta não retorna arquivos | Confirme o `GOOGLE_DRIVE_FOLDER_ID`, o acesso da conta autorizada e se os arquivos são `.xlsx`. |
| Planilha não gera lançamentos | Confira os cabeçalhos obrigatórios e se fornecedor, valor e data estão preenchidos. |
| Valores duplicados | Revise se os campos usados na chave de deduplicação estão consistentes entre as planilhas. |
