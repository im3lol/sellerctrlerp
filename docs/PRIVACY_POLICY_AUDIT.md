# Privacy notice implementation — 20 October 2026

## Scope and verified owner facts

Requested change: publish a truthful public privacy notice for SellerCtrl and an LwA Consent Privacy Notice URL. No Ads integration, ERP workflow, database schema, retention job, consent banner, or provider configuration was changed.

The owner confirmed **SellerCtrl** and **info@sellerctrl.com** as the operator name and monitored privacy/deletion contact. No registered entity suffix, registration number, physical address, jurisdiction, certifications, API approval, partnership or data residency promise was supplied or invented.

## Architecture and existing public pages

- Next.js 16 App Router; existing shared design tokens, approved `Logo`, Tailwind and React server rendering. Docker standalone deployment, existing apex marketing canonical (`lib/marketing-url.ts`), Auth.js proxy.
- The existing `/privacy` page was public but dated 29 July 2026, omitted optional processing and did not describe deletion limits. It is now a permanent redirect to the canonical notice, preserving `lang=ar`.
- No dedicated public terms, cookie, security, account deletion or contact pages were found. Contact previously existed in the landing footer and old notice. No nonexistent legal URLs were added. Rights, cookies, security and deletion are sections of the notice; contact is the owner-confirmed email.
- New canonical: `https://sellerctrl.com/privacy-policy`; English default; Arabic: `?lang=ar`. The notice owns its `lang`/`dir` so the reviewable language is independent of account preferences. Server-rendered ordinary language links work without cookies or JS.
- Shared authentication shell and signup page gain a notice link only. Marketing footer and sitemap point to the canonical route. Existing public `/privacy*` auth allowance is unchanged; marketing-host canonicalization also recognizes the new exact path.

## Data and integration inventory

| Processing | Evidence | Implemented vs planned |
| --- | --- | --- |
| Account, contact, roles, password hashes, optional MFA | `db/schema.ts`, `auth.ts`, `lib/auth/verify-credentials.ts`, `auth.config.ts` | Implemented; SellerCtrl credentials, not Amazon profile login |
| Company, customer, supplier, financial, inventory, HR/attendance/payroll records | `db/erp.ts`, `db/schema.ts`, `lib/erp/**` | Implemented; content depends on modules and business input |
| Amazon SP-API, LwA code exchange/refresh, encrypted credentials | `lib/saas/amazon-config.ts`, `lib/erp/marketplace/amazon/lwa.ts`, `client.ts`, `lib/crypto.ts` | Implemented; access depends on provider authorization/configuration |
| Orders, inventory, catalog, offers, fees, finance, returns and reimbursements | `lib/erp/marketplace/amazon/{orders,inventory,catalog,offers,fees,finances,reports}.ts` and related import code | Implemented; do not claim buyer PII can never occur in supplied/imported reports |
| Amazon Ads campaign reporting, advertising profiles, spend and performance | No Ads API implementation/endpoints found in inspected code; owner explicitly says awaiting API approval | Planned only, separately labeled. No Ads access, audience tracking or campaign modification added |
| Other marketplaces and stores | `lib/erp/marketplace/{noon,shopify,woo,jumia}`, registry and platform connector settings | Connector implementations exist; availability/configuration is conditional, not a claim every provider is live |
| Subscription checkout and transfer evidence | `lib/saas/xpay.ts`, `xpay-elements.ts`, subscription tables/actions | Implemented conditional checkout; provider handles card input; ERP subscription records retain transaction references |
| Transactional email | `lib/saas/email.ts`, `lib/erp/email.ts` | SMTP with Resend fallback when configured; no claim that both always receive data |
| Notifications, approval messages, operational alerts, custom automation destinations | `lib/erp/telegram.ts`, `lib/saas/telegram.ts`, `lib/log.ts`, `lib/erp/automation/engine.ts` | Optional/configured. User-selected exports, WhatsApp/email and document links also disclose selected content |
| AI invoice extraction | `lib/erp/ai-reader.ts`, `ai-bill.ts` | Optional/configured Anthropic API: chosen file sent for extraction; existing record matching local; drafts and usage retained |
| External assistants | `lib/mcp/*`, `db/mcp.ts`, MCP settings | Personal user/company read-only OAuth grants; permitted results go to chosen assistant provider; activity audited |
| Session, company and language cookies, UI local storage | `auth.config.ts`, `app/actions/{org,locale}.ts`, `app/providers.tsx`, `lib/sound.ts` | Implemented essential/preferences; language cookie up to one year |
| Acquisition/referral attribution | `components/brand/source-tracker.tsx`, signup flow | First-party `sc_src`, 30 days, stores source/referring host. No third-party pixel/general analytics SDK found; infrastructure/CDN processing still disclosed |
| External videos | `lib/erp/youtube.ts`, academy components | Optional YouTube privacy-enhanced embedding; no claim it sends no data |
| Hosting/storage/security | Docker compose, `lib/storage.ts`, `lib/crypto.ts`, scope/RLS, rate limit, audit | HTTPS, tenant/role controls and selected secret encryption; no blanket encryption/certification claims. Display images public; document/backup storage private |

## Deletion/retention findings kept separate from this page change

- `app/actions/erp/org-deletion.ts` authorizes an owner/admin request; `lib/erp/org-deletion.ts` provides a 14-day cancellation interval and cron database deletion. This is **company deletion**, not removal of a multi-company user identity.
- Expired sandbox organizations have a separate purge path. An ordinary subscription expiry does not establish immediate deletion of all production data.
- Company database deletion does **not** prove all S3 objects, off-site backups, logs, external copies or exports are erased. `lib/erp/backup.ts` retains the latest 14 org backups for active maintenance; Docker local DB dumps rotate after 14 days, while off-site lifecycles are separately configured. Deleted-company metadata can no longer drive ordinary object pruning. Policy therefore does not promise all copies disappear after 14 days.
- Disconnect action removes stored platform credentials; imported documents remain. In-flight/cached access and provider authorization are separate, so the notice also explains provider-side revocation. No disconnect behavior was changed.
- Personal-account erasure, residual objects/backups and rights exceptions require support handling. The owner's confirmed mailbox is the request channel; automated immediate deletion was not invented.

## Operational follow-up, not implied by publishing a notice

The operator should maintain a rights-request process (identity verification, business coordination and response tracking), a retention inventory including off-site/object cleanup, and applicable transfer arrangements. Assess whether first-party referral attribution needs consent in the jurisdictions served; no new cookie banner was authorized or added. Registered operator/address and territorial obligations remain to be established if legally required. Do not claim GDPR certification, Amazon approval or blanket compliance merely because this page exists.

Before any Ads release, revisit approved scopes, actual endpoints/fields, recipient/subprocessor list, consent/revocation controls and retention; update the public notice before new processing starts. Competitive offer snapshots already in SP-API are distinct from future campaign analytics.

## Amazon sources reviewed

- [LwA website registration](https://developer.amazon.com/docs/login-with-amazon/register-web.html): the Consent Privacy Notice URL is shown on the consent screen.
- [Amazon Ads LwA application onboarding](https://advertising.amazon.com/API/docs/en-us/onboarding/create-lwa-app).
- [Amazon Ads API policies](https://advertising.amazon.com/resources/ad-policy/api).

These are preparation references, not evidence of API approval. No production seller/business records or provider settings were modified for this task.

## Validation and publication

Published 20 October 2026, build `vwWCf9SMuGmsoVkreb08T` on both app and worker. Both internal health endpoints returned `ok: true` (database/Redis up; worker up).

- Production build and TypeScript passed; targeted ESLint passed; existing i18n coverage: 8 tests passed.
- `scripts/checks/chk-privacy-public.mjs`: 19 browser checks passed on an isolated candidate. Checks include anonymous and synthetic authenticated access, JavaScript-disabled rendering and language switch, mobile overflow, working anchors, English default, Arabic RTL, canonical/hreflang, old-URL 308, contact, planned-Ads disclosure, sitemap, landing footer and login link. No database writes.
- Screenshots visually reviewed: `.next/privacy-preview/privacy-en-desktop.png` and `privacy-ar-mobile.png` (additional English mobile and Arabic desktop previews also saved).
- External anonymous fetch: apex English and Arabic URLs return 200 with the full notice; `/privacy` returns 308 to `/privacy-policy`; sitemap contains the new URL. App/www also return the same public notice with its apex canonical in this deployed tunnel setup; a host redirect is not required to read the notice and is not assumed from source configuration alone.
- No migrations, Amazon credentials/scopes, Ads activation, synchronization settings, retention engines or ERP posting logic were changed. A rollback image was retained for app and worker under the `before-privacy-policy-20261020` tags.

Use `https://sellerctrl.com/privacy-policy` as the LwA Consent Privacy Notice URL. This is the published notice, not evidence that Amazon Ads API access has been approved.
