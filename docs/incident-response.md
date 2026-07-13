# SellerCtrl — Security Incident Response Plan (IRP)

> **ملخّص عربي:** هذه خطة الاستجابة للحوادث الأمنية في SellerCtrl. تحدّد الأدوار،
> وخطوات الاكتشاف والاحتواء والمعالجة والتعافي، وتُلزم بإخطار أمازون خلال **٢٤ ساعة**
> على `security@amazon.com` عند أي حادث يمسّ بيانات أمازون، وتُراجَع **كل ٦ أشهر**.

**Organization:** SellerCtrl · **Owner:** Security Lead · **Version:** 1.0 ·
**Last reviewed:** 2026-07-13 · **Next review due:** 2027-01-13 (reviewed at
least every 6 months)

This plan governs how SellerCtrl detects, responds to, and reports security
incidents — with specific procedures for incidents involving **Amazon
Information** received via the Selling Partner API (SP-API), as required by the
Amazon Services API Data Protection Policy (DPP).

---

## 1. Purpose & scope
- **Purpose:** ensure security incidents are detected, contained, eradicated,
  recovered, reported, and reviewed in a consistent, timely way.
- **Scope:** all SellerCtrl systems, data, and personnel — production application
  (Vercel), database (Supabase Postgres), object storage, source control, CI/CD,
  and any environment that processes tenant or Amazon Information.
- **Amazon Information** = any data obtained from Amazon's APIs (orders,
  inventory, financial settlements, catalog). SellerCtrl uses **non-restricted
  SP-API roles only and does not request or store Amazon buyer PII.**

## 2. What is a security incident?
Any actual or suspected event that compromises the **confidentiality, integrity,
or availability** of SellerCtrl systems or data. Examples: unauthorized access
to the database or an account, credential/token leak (SP-API refresh token, API
key, DB URL), malware, data exfiltration, a vulnerability actively exploited, a
misconfiguration exposing data, or loss/theft of a device with production access.

**Severity levels**
| Level | Definition | Examples |
|---|---|---|
| **SEV-1 (Critical)** | Confirmed exposure/loss of Amazon Information or large-scale tenant data; production down | DB breach, SP-API token compromise |
| **SEV-2 (High)** | Likely/limited exposure, or a control failure that could lead to exposure | single-account takeover, leaked secret |
| **SEV-3 (Low)** | Contained, no data exposure | blocked intrusion attempt, minor misconfig fixed before exposure |

## 3. Roles & responsibilities
| Role | Responsibility |
|---|---|
| **Security Lead (Incident Commander)** | Owns the response, declares severity, coordinates, decides on Amazon/customer notification. |
| **Engineering On-call** | Detection, containment, eradication, recovery; preserves evidence/logs. |
| **Communications Owner** | Drafts and sends notifications (Amazon, affected customers, internal). |
| **Executive Sponsor** | Legal/regulatory decisions, external counsel, final sign-off on SEV-1. |

> **Named contacts (SellerCtrl):**
> - Security Lead / Incident Commander: **Ahmed** — `ahmed@sellerctrl.com`
> - Engineering On-call: **Mostafa** — `mostafa@sellerctrl.com`
> - Communications Owner: **Security team** — `security@sellerctrl.com`
> - Executive Sponsor: **Ali Hassan Mostafa** — `ali@sellerctrl.com`, +20 155 825 3938

## 4. Detection & reporting (how incidents are found)
- **Automated:** application error/runtime logs (Vercel), database logs
  (Supabase), append-only **audit log** of privileged mutations (`audit_logs`),
  failed-auth patterns, dependency/security alerts (GitHub/Dependabot).
- **Manual:** any employee who suspects an incident reports it **immediately** to
  the Security Lead via `security@sellerctrl.com` (or the on-call channel).
- **External:** reports from Amazon, customers, or researchers.

**Anyone who observes a suspected incident must report it without delay — do not
attempt to fix it silently.**

## 5. Response procedure
Target: begin triage **within 1 hour** of detection for SEV-1/2.

1. **Triage & declare** — Security Lead confirms it's an incident, assigns
   severity, opens an incident record (timeline, actions, evidence), starts the
   **24-hour Amazon-notification clock** if any Amazon Information may be involved.
2. **Contain** — stop the bleeding: revoke/rotate compromised credentials
   (SP-API refresh tokens, API keys, DB URL, `AUTH_SECRET`), disable affected
   accounts, block source IPs, isolate the affected component, take the service to
   maintenance if needed. Preserve logs/evidence before changes.
3. **Eradicate** — remove the root cause: patch the vulnerability, remove malware,
   close the misconfiguration, invalidate sessions/tokens.
4. **Recover** — restore from known-good state (Supabase point-in-time backups),
   verify integrity, re-enable access, monitor for recurrence.
5. **Notify** — see §6.
6. **Close** — Security Lead confirms containment/eradication and closes the
   incident once monitoring is clean.

## 6. Notification — **including the 24-hour Amazon requirement**
- **Amazon (required):** For any security incident **involving Amazon
  Information**, notify Amazon **within 24 hours of detection** by emailing
  **`security@amazon.com`**. Include: date/time of detection, description, data
  potentially affected, containment actions taken, and a point of contact. Send an
  initial notice within 24 hours even if the investigation is ongoing, then follow
  up with updates.
  - **SellerCtrl point of contact for Amazon:** **Ali Hassan Mostafa** —
    `ali@sellerctrl.com`, +20 155 825 3938.
- **Affected customers/tenants:** notify without undue delay per applicable law
  and contractual terms once impact is understood.
- **Internal:** Security Lead → Executive Sponsor immediately for SEV-1/2.
- **Regulators/authorities:** as required by applicable law (Executive Sponsor +
  counsel decide).

## 7. Post-incident review
Within **5 business days** of closing a SEV-1/2 incident, hold a blameless
post-mortem: root cause, timeline, what worked, what didn't, and **action items**
with owners and due dates. Track action items to completion. Feed lessons back
into controls and this plan.

## 8. Plan maintenance
- This plan is **reviewed and updated at least every 6 months** (see the review
  dates in the header) and after any SEV-1 incident or material change to the
  architecture.
- Roles, contacts, and procedures are kept current. Team members are made aware
  of the plan and their reporting duty.

## 9. Supporting security controls (evidence of preventive posture)
The controls that reduce incident likelihood and support this plan:
- **Access control (least privilege):** two-layer RBAC — platform OS roles
  (`lib/rbac.ts`) + org-scoped ERP permissions (`lib/erp/permissions.ts`,
  `lib/erp/auth-guard.ts`); every tenant query is scoped by `organizationId`.
- **Authentication:** bcrypt-hashed passwords (cost 12), a **12-character +
  complexity** policy (`lib/auth/password-policy.ts`), **TOTP MFA** with
  encrypted secrets and one-time backup codes, and **365-day rotation** with
  reuse prevention (`password_history`).
- **Encryption in transit:** TLS everywhere (Vercel HTTPS; Supabase with a pinned
  CA and certificate verification).
- **Encryption at rest:** provider disk encryption (Supabase) plus
  application-level **AES-256-GCM** for stored secrets (`lib/crypto.ts`).
- **Secrets management:** all secrets in environment variables; `.env` is
  git-ignored; API keys stored only as SHA-256 hashes; no hardcoded credentials.
- **Auditability:** append-only audit log of privileged actions (`audit_logs`).
- **Data minimization:** non-restricted SP-API roles only — no Amazon buyer PII
  is requested or stored.

---

*Internal document — SellerCtrl. Contacts filled. This copy is the source of
truth for the Amazon SP-API security questionnaire answers on incident response
and 24-hour notification. Keep contacts current and re-review at least every 6
months.*
