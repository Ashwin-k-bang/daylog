# Daylog

Files (all go in the repo root, next to each other):
daylog.html, category.html, sync.js, sw.js, icon-180.png, icon-192.png, icon-512.png

Do NOT upload a data/ folder. The app creates data/daylog.json itself on first sync,
and uploading one later would overwrite your saved logs.

## One-time sync setup (per device)
1. https://github.com/settings/personal-access-tokens/new
2. Repository access: Only select repositories -> pick this repo
3. Permissions -> Repository -> Contents: Read and write
4. Open the site, tap "Set up sync" (top right), paste the token, Save & sync.
