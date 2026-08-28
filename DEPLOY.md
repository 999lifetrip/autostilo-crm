# AutoStilo CRM — Deploy via Coolify

## Variáveis de Ambiente necessárias no Coolify

Quando criar o projeto no Coolify, adicione essas variáveis em **Environment Variables**:

```
PORT=3100
NODE_ENV=production
JWT_SECRET=coloque_uma_senha_aleatoria_aqui_2026

# POSTGRES — copie do serviço do n8n no Coolify
DB_HOST=postgres          # ou o nome do container do Postgres
DB_PORT=5432
DB_NAME=n8n               # mesmo banco do n8n
DB_USER=n8n
DB_PASSWORD=SENHA_DO_POSTGRES_AQUI
DB_SSL=false

# EVOLUTION API
EVOLUTION_API_URL=https://evolution.omelhorvendedoronline.com.br
EVOLUTION_API_KEY=SUA_GLOBAL_APIKEY_AQUI
EVOLUTION_INSTANCE=NOME_DA_INSTANCIA
```

## Como achar as credenciais do Postgres no Coolify

1. Abra o **Coolify** no seu servidor
2. Vá em **Services** (ou **Projects**)
3. Clique no serviço do **n8n**
4. Clique em **Environment Variables**
5. Copie os valores de:
   - `DB_POSTGRESDB_HOST` → use no `DB_HOST`
   - `DB_POSTGRESDB_DATABASE` → use no `DB_NAME`
   - `DB_POSTGRESDB_USER` → use no `DB_USER`
   - `DB_POSTGRESDB_PASSWORD` → use no `DB_PASSWORD`

## Como adicionar o projeto no Coolify

1. No Coolify → **New Project** (ou New Application)
2. Escolha **"From a Git Repository"** ou **"From a local Dockerfile"**
3. **Dockerfile Path**: `Dockerfile` (está na raiz do projeto)
4. **Port**: `3100`
5. **Domain**: `crm.omelhorvendedoronline.com.br`
6. Adicione todas as variáveis de ambiente acima
7. Deploy!

## Estrutura do projeto para upload

```
autostilo-crm/
├── Dockerfile          ← Coolify usa esse
├── backend/
│   ├── server.js
│   └── package.json
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```
