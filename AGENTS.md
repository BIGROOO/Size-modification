# Project guide

## Purpose

This is a browser-local image tool for resizing JPG, PNG, and WebP files and checking OCR copy for exact or highly similar duplicates.

## Run and verify

- Install with `npm ci` using Node.js 22.13 or newer.
- Start locally with `npm run dev`.
- Run the full gate with `npm test` and `npm run lint`.
- Build the production static site with `npm run build:pages`.

## Stack

- React 19, TypeScript, Tailwind CSS, and Vite.
- Vinext / Cloudflare compatibility build for the retained Sites surface.
- Tesseract.js for browser-side Simplified Chinese and English OCR.

## Structure and conventions

- `app/` is the shared product UI and local image-processing logic.
- `github-pages/` is a thin static entry that reuses `app/`; do not duplicate the UI.
- `public/` contains the social preview and site icons.
- `tests/rendered-html.test.mjs` guards privacy, permissions, duplicate checks, metadata, and Pages paths.
- Keep image bytes and OCR text in the browser; do not add uploads, storage, or analytics without explicit approval.
- Preserve the `/Size-modification/` base path for GitHub Pages.
- Browser file write permission cannot be silently granted or bypassed.

## Current state

- Canonical production is `https://bigrooo.github.io/Size-modification/`; pushes to `main` deploy through GitHub Actions.
- `.openai/hosting.json` is retained for the compatibility build, but no live Sites project or backup URL is currently verified.
- Do not describe Sites as live until both the project lookup and canonical URL succeed.
- Changing or removing the inactive Sites metadata, optional D1 scaffold, or generated local artifacts requires an explicit cleanup decision.
