# Data Download Script

This folder includes `download_github_zip.py`, a helper script to:

- Download one or more dataset links
- Convert GitHub `blob` URLs to direct download URLs
- Extract `.zip` files into this `data/` directory
- Delete the downloaded `.zip` file after successful extraction

## Prerequisite

- Python 3

## Usage

From the project root (`VASTKnowledgeGraphVisualization`), run:

```bash
python3 data/download_github_zip.py <url1> [url2 ...]
```

## Example (single link)

```bash
python3 data/download_github_zip.py \
  https://github.com/vast-challenge/2025-data/blob/main/MC1_release.zip
```

## Example (multiple links)

```bash
python3 data/download_github_zip.py \
  https://github.com/vast-challenge/2025-data/blob/main/MC1_release.zip \
  https://github.com/vast-challenge/2025-data/blob/main/DC_release.zip
```

## Optional flags

- `--dry-run`: show what will be downloaded without downloading
- `--output-dir <path>`: save and extract into another directory

Example:

```bash
python3 data/download_github_zip.py \
  --dry-run \
  https://github.com/vast-challenge/2025-data/blob/main/MC1_release.zip
```

## Team

Contributions to this folder, from the git history:

- **Salvo Rinzivillo** — the download script and this guide.

