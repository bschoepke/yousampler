# yousampler

Static, client-only sampler UI that embeds YouTube IFrames. No build step is required.

## Deploying to Cloudflare Pages
- **Build command:** none
- **Build output directory:** `/` (repo root)
- **Uploads:** only static assets (`index.html`, `app.js`, `style.css`, `logo.svg`, `suggested-videos.json`)
- `.cfignore` excludes `tools/` so dev utilities don’t ship.

## Local development
- Quick static serve: `node tools/server.js` (serves from repo root on port 3000).
- Video validator: open `tools/video-validator.html` in a browser while the server is running; it reads `suggested-videos.json` and checks embeddability.

## Notes
- Running from `file://` will trigger YouTube embed errors; always use a local server.
- Suggested videos are fetched with `?cb=v1` and `cache: 'no-store'`; bump the version when you change the list to avoid CDN caching.
