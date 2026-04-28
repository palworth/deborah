# Obsidian Vault Backup

Deborah can back up a local Obsidian vault to Cloudflare.

The backup path is deliberately conservative:

- The local script scans the vault.
- Changed files are sent to the Worker at `POST /vault/sync`.
- The Worker writes raw file bodies to R2.
- The Worker writes a file manifest and sync batches to D1.
- Deleted files are tombstoned in D1 and removed from R2.

This does not index notes into Vectorize yet and does not rewrite the local
vault.

## What Gets Uploaded

Included:

- Markdown notes
- Attachments such as images and PDFs
- Other ordinary files under the vault path

Ignored:

- `.obsidian/`
- `.git/`
- `.trash/`
- `.deborah/`
- `.DS_Store`

The script keeps local backup state under `~/.deborah/vault-backup-state/`, not
inside the vault.

## Cloudflare Resources

Required bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `VAULT_R2` | R2 bucket | Raw vault file backups |
| `DB` | D1 | Backup manifest and sync batch history |

Required Worker secret:

```bash
npx wrangler secret put VAULT_SYNC_SECRET
```

Use the same value locally as either:

- `VAULT_SYNC_TOKEN`
- `~/.deborah/vault-sync-token`

## Run A Backup

```bash
export DEBORAH_WORKER_URL="https://aftercall.pierce-9df.workers.dev"

npm run vault:backup
```

The script auto-detects the currently open Obsidian vault on macOS. You can also
pass it explicitly:

```bash
npm run vault:backup -- --vault "/Users/pierce/Documents/Pierce's workspace"
```

Preview without uploading:

```bash
npm run vault:backup -- --dry-run
```

## Limits

By default, the script skips individual files over 5 MB to keep Worker requests
small and predictable. Override when needed:

```bash
npm run vault:backup -- --max-file-bytes 25000000
```

## Restore

Restore is not implemented yet. The data model is ready for it: R2 contains the
latest raw object for each active file, and D1 tracks the latest path/hash/mtime
plus tombstones. A restore command should be added before relying on this as the
only backup.
