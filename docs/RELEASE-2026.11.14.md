# Release 2026.11.14

This source snapshot includes the current web application deployed to the VPS, its background workers, migrations through `0156_backup_reliability`, and the current native-client localization work.

- Separate marketing/sign-in, dashboard, and authenticated storage hosts with shared secure sessions.
- Light-only appearance, optimized logos and mascot assets, responsive filters, and mobile administration navigation.
- Organization-scoped files, image-code search, table downloads, and saved backups.
- Consistent database snapshots, daily backup status/alerts/retries, and background Google Drive uploads with progress, resume, optional scheduling, and managed retention.
- Independent readable Sheets files plus JSON in dated Drive snapshot folders.
- Native browser batch-label printing, browser-specific paper/alignment calibration, and a test-label workflow.
- Professional Arabic/English landing copy and status notices that do not pollute navigation URLs.
- Continued English/native-client parity and safeguards for organization access, exports, and personal MCP connections.

Deployment and recovery instructions: [SAAS-DEPLOYMENT.md](SAAS-DEPLOYMENT.md). Customer exports, live configuration, migration artifacts, and internal operational reports are intentionally outside version control.
