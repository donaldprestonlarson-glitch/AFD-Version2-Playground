# Actually Free Dating - Always Will Be (AFD)
Node.js + SQLite + Express - 100% free model

## Run locally (on your IIS box you can run Node alongside IIS)
1. Install Node.js 20 LTS from nodejs.org
2. Open PowerShell in this folder:
   npm install
   npm start
3. Open http://localhost:3000

IIS reverse proxy (optional):
- Install URL Rewrite + Application Request Routing in IIS
- Add site ActuallyFreeDating pointing to localhost:3000 via reverse proxy rule

## Deploy free in cloud (recommended for real site)
### Option A - Render.com (best for SQLite persistence)
1. Push this folder to GitHub
2. Go to render.com -> New Web Service -> Connect repo
3. Build: npm install
   Start: npm start
4. Add Disk: Mount path /opt/render/project/src/data (1GB free) to persist SQLite
5. Deploy -> you get https://actuallyfree.onrender.com free

### Option B - Fly.io (also persists)
fly launch
fly volumes create afd_data --size 1
fly deploy

### Option C - Vercel (frontend only) + database elsewhere
Not ideal for SQLite - use Render for this project.

## Features built
- Signup/login with bcrypt
- Edmonton/Calgary city filter (launch cities)
- Free unlimited messaging - no paywall code anywhere
- Photo upload ready (/uploads)
- Ad placeholders where revenue comes from
- Dark theme responsive mobile + PC

## Next steps
- Add email verification
- Add photo moderation (NSFW filter)
- Add report/block
- Add AdSense IDs to ad boxes
