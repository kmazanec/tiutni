# DEPLOY.md

The app is a single Dockerized Node service. It needs **no secrets** to run
(the LLM is optional warmth), exposes `/health`, and listens on `$PORT`
(default 3000).

## Render (free tier) — the named path

A `render.yaml` blueprint is committed. To deploy:

1. Push this repo to GitHub (done — see the repo URL in the submission).
2. In the [Render dashboard](https://dashboard.render.com) → **New → Blueprint**,
   connect this GitHub repo. Render reads `render.yaml` and provisions a free
   Docker web service `tiutni-tax-assistant` with a `/health` check.
3. First build takes a few minutes. The public URL appears in the dashboard,
   e.g. `https://tiutni-tax-assistant.onrender.com`.

> Free-tier services sleep after inactivity and cold-start on the next request —
> the first hit after idle takes ~30s, then it's fast.

Optional: set `OPENROUTER_API_KEY` in the Render dashboard to enable LLM-phrased
conversational warmth. Not required for full functionality.

## Local Docker (equivalent to production)

```bash
docker build -t tiutni .
docker run -p 3000:3000 tiutni
# open http://localhost:3000
```

## Plain Node (no Docker)

```bash
npm install
npm run build
npm start          # serves dist/ on $PORT (default 3000)
```

## Verify a deployment

```bash
curl https://<your-url>/health           # → {"ok":true}
# then open the URL, click Send, say "use the sample", answer 2 questions,
# and download the 1040.
```
