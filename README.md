# KS-Agent

Keystone AI assistant service: the chat assistant behind the Keystone website widget, client app and staff portal.
Each licensee runs its own agent next to its own KS-server.

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

## Develop

```
npm ci
npm run typecheck && npm run lint && npm run check:brand && npm test
npm run build && npm start
```

## Deploy

`.github/workflows/deploy.yml` deploys to an Azure Web App after CI passes on `main`. It needs the
`AZURE_CREDENTIALS` secret and the `AZURE_WEBAPP_NAME` repository variable.
