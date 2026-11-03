# KS-Agent

Keystone AI assistant service: the chat assistant behind the Keystone website widget, client app and staff portal.
One shared agent serves every brokerage (see "Shared hosting" below); the development copy still runs on its own.

- **Names and contacts come from the licensee.** At startup and every 5 minutes the agent loads
  `GET {SERVER_URL}/api/licensee` (company name, assistant name, support email and phone, mailing address, app URLs)
  and uses those values in every prompt and reply. Until the first load succeeds it uses `KS_COMPANY_NAME` /
  `KS_ASSISTANT_NAME` (then "Assistant").
- **Lending only.** No insurance or other product lines. Products, ranges and lenders are the licensee's own, read
  from its KS-server (`/api/maya/catalog-summary`, `/api/maya/staff/lender-products`) and its trained knowledge.
- **Called only through KS-server.** KS-server proxies the widgets to this service (`MAYA_URL` / `MAYA_SERVICE_URL`
  on KS-server) with a signed `X-Maya-Context`; the agent calls back with service tokens signed with `JWT_SECRET`.

## Settings

| Setting | |
| --- | --- |
| `SERVER_URL` | the licensee's KS-server, e.g. `https://server.example.com` |
| `JWT_SECRET` | the same value as KS-server's `JWT_SECRET` |
| `OPENAI_API_KEY` | OpenAI key |
| `PORT` | set by App Service (defaults to 8080) |

Optional settings are listed in `.env.example`.

## Shared hosting (KS_SHARED_HOSTING_v1)

With `KS_CONTROL_DATABASE_URL` **unset** the agent is single-brokerage, exactly as before (`SERVER_URL`, `JWT_SECRET`
and the rest of its own settings). The development copy, CI and every test run this way.

With `KS_CONTROL_DATABASE_URL` **set** (the shared app `ks-shared-agent`) it serves many brokerages:

- **Which brokerage.** Each request names its brokerage by `X-KS-Tenant: <code>`, otherwise by its `Host` (lowercased,
  port removed) against `ks_tenants.api_hosts` in the `ks_control` database (read-only role `ks_control_reader`,
  cached 60 seconds). Unknown → `404 {"error":"unknown_brokerage"}`, cancelled → `410 {"error":"brokerage_closed"}`.
  `/`, `/health`, `/api/health`, `/healthz` and `/ready` answer without one.
- **Its settings.** The brokerage's `env_enc` (AES-256-GCM, key `SHA-256(KS_TENANT_KEY)`, `v1:<iv>:<tag>:<ct>`) is
  decrypted and overlaid on `process.env` for that request. Per-brokerage keys (`JWT_SECRET`, `KS_*` names, `TWILIO_*`,
  ...) come only from there, never from the shared app's own settings; `OPENAI_API_KEY` and other Keystone-wide
  values are the shared app's.
- **Calls to KS-server** go to `SERVER_URL` (the shared server) with `X-KS-Tenant: <code>` and a service JWT signed with
  that brokerage's `JWT_SECRET`. Incoming `X-Maya-Context` is checked against the same secret, so a context signed for
  one brokerage is refused for another. Outside a brokerage a call throws `no_brokerage_context`.
- **State.** The agent has no database. Its in-memory stores (conversation history, pending confirmations, handoff
  limits, visitor contacts, resolved application ids, token budgets, rate limits, the licensee's names from
  `/api/licensee`) are kept per brokerage code.

Shared app settings: `SERVER_URL`, `OPENAI_API_KEY`, `KS_CONTROL_DATABASE_URL`, `KS_TENANT_KEY`
(no `JWT_SECRET`). Code: `src/tenancy/`.

## Develop

```
npm ci
npm run typecheck && npm run lint && npm run check:brand && npm test
npm run build && npm start
```

## Deploy

`.github/workflows/deploy.yml` runs after CI passes on `main` and deploys:

- the development copy: `AZURE_CREDENTIALS` secret and `AZURE_WEBAPP_NAME` variable (skipped while that is empty);
- the one shared app: `AZURE_WEBAPP_NAME_SHARED` variable (default `ks-shared-agent`), signed in with
  `AZURE_SHARED_CLIENT_ID` + `AZURE_SHARED_TENANT_ID` + `AZURE_SHARED_SUBSCRIPTION_ID` (federated identity) or the
  `AZURE_CREDENTIALS_SHARED` secret (skipped with a warning while neither is set).

There is no per-brokerage deploy any more; `deploy/licensees.json` is kept (and checked in CI) as the list of
brokerages whose web builds are published.
