# Daylog + Money

Two apps in one repo: **Daylog** (time log) and **Money** (spending log). Revise is a separate project in its own repo.

## Deploy
1. Create a new GitHub repo (e.g. `daylog`), upload everything in this folder to the repo root (including `data/`).
2. Settings -> Pages -> Deploy from branch -> `main` / root.
3. Open `https://<user>.github.io/<repo>/`.
4. On each device, tap **Set up sync** once, or open `https://<user>.github.io/<repo>/#token=YOUR_TOKEN` once.
   Token: fine-grained, **only this repo**, Permissions -> Contents: Read and write.

`data/daylog.json` and `data/money.json` hold your existing logs. Delete the `data/` folder before uploading if you want a fresh start.
