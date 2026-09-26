# Wedding deployment maintenance

The dependency update on 26 September 2026 uses application source `6c52b74` with the patched dependency manifests and lockfiles from `fix/dependabot-2026-09`.

The last deployed maintenance commit is `f973a8b` (Worker version `49985c33-227a-4512-8912-b6285beb9049`). Subsequent lint configuration and React effect cleanup changes are validated in this branch but have not been redeployed.

The old live Worker's application sections were compared with this build: all matched, apart from a compiler-renamed local loop variable in validation. The later guest-access-policy migration is not installed in this instance. Do not deploy newer application code that requires that migration without planning the schema upgrade first.

Deploy this maintenance branch from the `daisy-wedding-dependency-fixes` checkout using the local `wrangler.prod.toml`. It binds only Worker `daisy-api`, database `daisy`, and bucket `daisy-photos`. The separate `daisy-chris` deployment has its own code and configuration.

```powershell
npm ci
npm run test:all
npm run build
npx wrangler deploy -c wrangler.prod.toml
```

The wedding album `thomas-and-caseys-wedding-634e33` is read-only (`is_open=0`, `is_viewable=1`) at the user's request. All 587 upload records were preserved: 581 completed photos and six unfinished uploads dating from July. No database migration or photo modification is part of this dependency deployment.
