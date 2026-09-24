# PSI-88L deployment

The application is committed and pushed to https://github.com/ericfowler-dev/PSI-88L. GitHub's clean Linux install, type checking, lint, tests, and build passed after repairing the npm lockfile.

The user approved the self-contained Render pilot on September 24, 2026. Provisioning and live verification are in progress.

## Pilot configuration

- One Render web service, 1 CPU / 2 GB RAM, Oregon.
- A 5 GB persistent disk mounted at `/var/data`.
- PGlite database, private originals, and OCR cache under `/var/data/psi-88l`.
- Embedded ingestion worker; no separate database, worker service, or S3 account required.
- Server-generated encryption and initial-setup secrets; no secrets in Git.
- Startup refuses to run if the persistent disk is missing.
- Approximate service/disk base charge: $26.25/month, excluding model usage and workspace/usage charges. [Render pricing](https://render.com/pricing).

This is a single-instance pilot with brief downtime on deploys. Before scaling to multiple app instances, migrate the database to PostgreSQL and originals to private S3-compatible storage using the saved `deploy/render-scalable.yaml` design. Do not point an empty managed database at the app and expect local data to move automatically.

Backups must include a consistent database export and original files. Disk snapshots alone are not a database recovery plan. Before substantial real usage, schedule exports and test restoration.

Earlier build/checkpoint reports describe the pre-deployment state; this document tracks hosting status.
