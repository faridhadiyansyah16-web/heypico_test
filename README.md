# Local LLM + Google Maps Backend

A secure Node.js backend and simple UI that lets users ask for places to go/eat/etc., parses the prompt via a local or OpenAI‑compatible LLM, searches Google Places, and returns viewable map directions via the Google Maps Embed API.

## Features
- LLM parsing (local Ollama or any OpenAI‑compatible API)
- Place search with Google Places Web Service (server key only)
- Embedded maps for place or directions (browser key only)
- Security: key separation, CORS, Helmet, per‑IP rate limiting, response caching
- Simple UI served from `public/` that calls the backend and renders embeds

## Requirements
- Node.js 18+ (tested on Node 22)
- Google Cloud project with billing enabled
- APIs enabled:
  - Browser key: Maps Embed API (and Maps JavaScript API only if you add JS maps later)
  - Server key: Places API (and Directions API if you later use web service directions)
- Optional LLM:
  - Ollama (local) or an OpenAI‑compatible endpoint (Open WebUI, LM Studio, Groq, Mistral, OpenRouter)

## Security Best Practices
- Create two keys:
  - `GOOGLE_MAPS_BROWSER_KEY`: restrict by HTTP referrer to your domains (`http://localhost/*`, `http://localhost:3001/*`, etc.); restrict allowed APIs to “Maps Embed API”.
  - `GOOGLE_MAPS_SERVER_KEY`: restrict by IP (server public IPs or temporarily none for local dev); restrict allowed APIs to “Places API” (and “Directions API” if needed).
- Never commit keys to source control. Set keys via environment variables.
- Apply quotas and budgets in Google Cloud to control usage.

## Setup (Windows PowerShell examples)
```powershell
# Install dependencies
npm install

# Start (port 3001)
$env:GOOGLE_MAPS_BROWSER_KEY="<browser_key>"
$env:GOOGLE_MAPS_SERVER_KEY="<server_key>"
$env:PORT=3001; npm run start

# Alternate: disable LLM to avoid local memory issues
$env:GOOGLE_MAPS_BROWSER_KEY="<browser_key>"
$env:GOOGLE_MAPS_SERVER_KEY="<server_key>"
$env:LLM_DISABLED=1
$env:PORT=3002; npm run start
```

## LLM Options
- Local Ollama:
  - Install Ollama and pull a small model (e.g., `llama3.2:3b-instruct` or `phi3:mini`), preferably quantized.
  - Env:
    ```powershell
    $env:LLM_PROVIDER="ollama"
    $env:OLLAMA_HOST="http://localhost:11434"
    $env:OLLAMA_MODEL="llama3.2:3b-instruct-q4_K_M"
    ```
- OpenAI‑compatible endpoint (including Open WebUI):
  ```powershell
  $env:LLM_PROVIDER="openai"
  $env:OPENAI_BASE_URL="<openai_compat_url>"
  $env:OPENAI_API_KEY="<key>"
  $env:OPENAI_MODEL="gpt-4o-mini"  # or any supported model
  ```
- Disable entirely:
  ```powershell
  $env:LLM_DISABLED=1
  ```

## UI
- Open `http://localhost:<PORT>/` to use the simple UI.
- Enter a prompt, optionally click “Use my location” to populate both search and origin coordinates, then “Search”.
- Each result provides:
  - `Open in Google Maps` link
  - `View Map` button that embeds directions or place map via the Embed API iframe

## API
- Health: `GET /health`
- Search: `POST /api/llm/search`
  - Request body:
    ```json
    {
      "prompt": "best ramen near Shibuya station",
      "location": { "lat": 35.6595, "lng": 139.7005 },
      "origin": { "lat": 35.6595, "lng": 139.7005 },
      "radiusMeters": 2000
    }
    ```
  - Response shape:
    ```json
    {
      "query": "best ramen near Shibuya station",
      "results": [
        {
          "name": "<place or query>",
          "address": "<address>",
          "location": { "lat": <num>, "lng": <num> },
          "rating": <num>,
          "user_ratings_total": <num>,
          "place_id": "<placeId>",
          "maps_link": "https://www.google.com/maps/...",
          "embed_url": "https://www.google.com/maps/embed/v1/..."
        }
      ]
    }
    ```
- Map page (server-rendered iframe):
  - `GET /map?place_id=PLACE_ID`
  - `GET /map?place_id=PLACE_ID&origin_lat=...&origin_lng=...` (directions)

## Troubleshooting
- Embed shows “This content is blocked”:
  - Ensure the browser key has “Maps Embed API” enabled and referrer restrictions include `http://localhost/*` (and your port, e.g., `http://localhost:3001/*`).
- Places returns `REQUEST_DENIED`:
  - Verify billing is enabled and the server key is authorized for “Places API”. Check IP restrictions.
- LLM memory error:
  - Use smaller models or set `LLM_DISABLED=1`.
- Port already in use:
  - Change `PORT` (e.g., `3002`).

## Project Structure
```
package.json
src/
  server.js        # Express server, security, LLM extraction, Places calls, embed helpers, routes
public/
  index.html       # Simple UI
  app.js           # Calls /api/llm/search, renders results and embed iframe
```

## Notes
- This app enforces iframe usage for the Google Maps Embed API.
- Secrets are read via env vars and never logged.
- Rate limiting (`60 req/min`) and 5‑minute response caching are enabled by default.

