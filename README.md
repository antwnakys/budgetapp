# 💰 Budget Circle

A simple, no-backend budget tracker. Sign in with your email, enter your income,
savings and expenses by category, and see your spending split into a circle
(doughnut chart).

Everything runs in the browser and saves to `localStorage`, so it works perfectly
on **GitHub Pages** with zero server setup.

## Features

- **Email sign-in** — your data is saved per-email in your browser.
- **Income, savings & remaining** — live summary cards.
- **Expenses by category** — preset categories or your own custom ones.
- **Spending circle** — a doughnut chart showing how your money splits, with
  percentages and a legend.
- **Fully offline** — no CDNs, no tracking, no accounts on a server.

## Run it locally

Just open `index.html` in a browser. (Or serve the folder, e.g.
`python3 -m http.server`, then visit http://localhost:8000.)

## Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `budgetapp`).
2. Push these files to it:
   ```bash
   git init
   git add .
   git commit -m "Budget Circle"
   git branch -M main
   git remote add origin https://github.com/<your-username>/budgetapp.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment**.
   Set **Source = Deploy from a branch**, **Branch = main**, folder **/ (root)**.
4. Wait ~1 minute. Your site will be live at:
   `https://<your-username>.github.io/budgetapp/`

## About the "sign in with email"

This version stores data **locally in the browser** under the email you enter —
it is not real authentication, and there's no password or cloud sync. That's the
only option that works on plain GitHub Pages (which has no server).

To get **real accounts with email login + cloud sync**, you'd add a free service
like [Firebase Authentication](https://firebase.google.com/docs/auth) or
[Supabase](https://supabase.com/). Ask and this can be wired up.
