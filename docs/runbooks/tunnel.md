# Legacy workstation tunnel

The production deployment uses a VPS and the HTTPS reverse proxy described in [SAAS-DEPLOYMENT.md](../SAAS-DEPLOYMENT.md). Workstation Cloudflared services, tunnel supervisors, and scheduled watchdog tasks must remain disabled after migration to avoid resurrecting the retired local stack.

The legacy scripts are retained for review and recovery of explicitly configured development environments. Their paths resolve from the operator's user profile. A `production-moved-to-vps.disabled` marker in the legacy supervisor directory prevents the repository watchdog from restarting that stack.

Do not re-enable the old tunnel or automatic local startup to troubleshoot the VPS. Inspect the deployed application, worker, proxy, database, and backup health instead. Do not copy live credentials or organization data into a development environment.
