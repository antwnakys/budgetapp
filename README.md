# ⚡ QuickBudget

A budget tracker with **real email + password accounts** and **cloud sync**.
Log what you spend **on any day** from a calendar, add details to each expense,
and see your monthly spending split into a circle (doughnut chart).

**Features**
- 📅 **Calendar view** — tap a day to see or add what you spent, with a per-day
  spending heatmap.
- 📝 **Details per expense** — category, amount, and an optional note.
- 🍩 **Spending circle** — monthly breakdown by category.
- 🔁 **Month navigation** — browse any month; summary + chart follow.
- ☁️ **Cloud sync** across devices, secured by Row Level Security.

- **Frontend:** static HTML/CSS/JS (no build step) — hosted on **Vercel**
- **Auth + database:** **Supabase** (Postgres + Auth), secured with Row Level Security

Your data lives in your own Supabase project and syncs across devices.

## Setup (one-time)

### 1. Create a Supabase project
1. Go to <https://supabase.com> → sign in → **New project** (free tier is fine).
2. Once it's ready, open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates
   the `budgets` and `expenses` tables with per-user security.
3. Open **Project Settings → API** and copy:
   - **Project URL**
   - **anon / public** key

### 2. Add your keys
Edit [`config.js`](config.js) and paste the two values:
```js
export const SUPABASE_URL = "https://xxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGci...";
```
The anon key is **safe to commit** — it's a public key, and Row Level Security
keeps each user's data private.

### 3. (Optional) Instant signups
By default Supabase requires email confirmation. For testing you can turn it off:
**Authentication → Providers → Email → uncheck "Confirm email"**. Leave it on for
real use.

## Run locally
Because the app uses ES module imports, open it through a local server (not
`file://`):
```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

## Deploy to Vercel
1. Go to <https://vercel.com> → sign in with GitHub.
2. **Add New → Project** → import the `budgetapp` repo.
3. Framework preset: **Other**. No build command, no output dir (it's static).
4. **Deploy.** You'll get a `https://budgetapp-xxxx.vercel.app` URL.

After deploying, add your Vercel URL to Supabase under
**Authentication → URL Configuration → Site URL / Redirect URLs** so auth links
resolve correctly.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Markup for the sign-in screen and dashboard |
| `styles.css` | Styling |
| `app.js` | Auth, data layer, and the spending circle |
| `config.js` | Your Supabase URL + anon key |
| `supabase/schema.sql` | Database tables + Row Level Security |
| `vercel.json` | Vercel static-hosting config |
