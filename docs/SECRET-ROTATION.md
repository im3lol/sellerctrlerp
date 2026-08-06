# Secret rotation (owner runbook)

The DD found live secrets in the working-tree `.env` (a real Amazon SP-API client
secret + a Supabase DB password) alongside a weak dev `AUTH_SECRET`. Treat all of them
as **compromised** and rotate. The app code already supports a dedicated `ENCRYPTION_KEY`
and reads every secret from the env — nothing in the repo blocks this; the actions below
are **console/env changes only the account owner can make**.

## 1. Generate the app-level secrets
```bash
npm run gen:secrets
```
Copy the output into the **platform secret store** (Vercel env vars / VPS `.env` injected
at deploy) — never a committed file.

## 2. Rotate `AUTH_SECRET` + introduce `ENCRYPTION_KEY` WITHOUT bricking stored tokens
Marketplace refresh tokens + MFA secrets are AES-GCM encrypted. The key is
`ENCRYPTION_KEY` (falling back to `AUTH_SECRET`). To rotate the session secret while
keeping stored tokens decryptable:

1. Set `ENCRYPTION_KEY = <the CURRENT AUTH_SECRET value>`; deploy. (Now decryption is
   pinned to a dedicated key, independent of the session secret.)
2. Set `AUTH_SECRET = <new value>`; deploy. Sessions re-issue on next login; stored
   tokens still decrypt under `ENCRYPTION_KEY`. ✅
3. (Optional, later) rotate `ENCRYPTION_KEY` too by re-encrypting stored rows — the
   ciphertext is versioned (`v1:…`) so a v2 key can be added for reads first.

## 3. Rotate the provider secrets (console actions)
- **Amazon SP-API**: in Seller Central / the developer console, rotate the LWA client
  secret, then update it in **/admin/integrations → Amazon** (or `SPAPI_LWA_CLIENT_SECRET`).
- **Supabase**: rotate the database password; update the pooler `DATABASE_URL` in the
  platform env.
- **Noon**: rotate `client_secret` if issued; update in **/admin/integrations → Noon**.

## 4. Remove secrets from the working tree
Ensure `.env` on any dev machine holds only local/dev values; production secrets live in
the platform store. `.env` is gitignored (verified) — keep it that way.

## Also: enforce RLS in production
Separately, flip the prod app's `DATABASE_URL` to the `appuser` role (NOBYPASSRLS) so
tenant isolation is enforced — see `db/rls/CUTOVER.md`. Proven locally; it's a one-line
env change on prod.
