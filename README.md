# Metro Parcel Query

Natural language search tool for the MetroGIS Twin Cities 7-County parcel dataset, powered by Claude.

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → import your GitHub repo
3. Add environment variable: `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Deploy

That's it. Share the URL Vercel gives you.

## How it works

- User types a plain English query
- `/api/translate` (serverless function) sends it to Claude, gets back an ArcGIS SQL WHERE clause
- Frontend queries the live MetroGIS ArcGIS REST API directly
- Results display in a sortable table
- KML export drops parcel polygons into Google Earth
