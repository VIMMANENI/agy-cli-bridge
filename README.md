# Antigravity CLI Bridge

A minimal local Antigravity CLI bridge (`cli.js`) and static web app (`index.html`) that communicate over `http://127.0.0.1:4310`.

## Quick Start (Local)

```powershell
node cli.js
```

Open `http://127.0.0.1:4310` in your browser.

- If the official `agy` CLI is installed on your `PATH`, prompts run live through `agy -p`.
- Otherwise, it runs in `mock-echo` mode so you can verify the web ↔ CLI round-trip.

## Deploy the Web App (Option A: Static Site → Local CLI)

1. Push this repo to GitHub.
2. In your GitHub repo settings, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Pushing to `main` automatically deploys `index.html` to `https://<your-username>.github.io/<repo-name>/`.
4. Run `node cli.js` on your machine, then open your deployed GitHub Pages URL — it automatically connects to `http://127.0.0.1:4310` (with CORS + Chrome Private Network Access headers enabled).

## Tests

```powershell
npm test
```
