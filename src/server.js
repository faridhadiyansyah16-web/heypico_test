import express from 'express'
import axios from 'axios'
import dotenv from 'dotenv'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'

dotenv.config()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

const GOOGLE_MAPS_BROWSER_KEY = process.env.GOOGLE_MAPS_BROWSER_KEY || ''
const GOOGLE_MAPS_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY || ''

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama'
const LLM_DISABLED = (process.env.LLM_DISABLED === '1') || (LLM_PROVIDER === 'none')
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest'

if (!GOOGLE_MAPS_SERVER_KEY) {
  console.warn('WARNING: GOOGLE_MAPS_SERVER_KEY not set. Places/Directions web service calls will fail.')
}
if (!GOOGLE_MAPS_BROWSER_KEY) {
  console.warn('WARNING: GOOGLE_MAPS_BROWSER_KEY not set. Map embed will not work.')
}

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(cors({
  origin: [/^http:\/\/localhost(?::\d+)?$/],
  methods: ['GET', 'POST'],
  credentials: false
}))
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
}))
app.use(express.static('public'))

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

const cache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 })

const SearchBodySchema = z.object({
  prompt: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  origin: z.object({ lat: z.number(), lng: z.number() }).optional(),
  radiusMeters: z.number().min(1).max(50000).optional(),
})

async function extractQueryWithLLM(prompt) {
  const system = 'You help translate user requests into concise place search queries. Output ONLY a short query like "best ramen near Shibuya" or a category like "coffee shop in Boston". No extra text.'
  const defaultQuery = prompt.trim().slice(0, 128)
  try {
    if (LLM_DISABLED) return defaultQuery
    if (LLM_PROVIDER === 'openai' && OPENAI_API_KEY) {
      const resp = await axios.post(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 30,
        },
        {
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
          timeout: 10000,
        },
      )
      const text = resp.data?.choices?.[0]?.message?.content?.trim()
      return text || defaultQuery
    } else {
      const resp = await axios.post(
        `${OLLAMA_HOST}/api/chat`,
        {
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          options: { temperature: 0.2 },
        },
        { timeout: 10000 },
      )
      const msg = resp.data?.message?.content || resp.data?.messages?.slice(-1)?.[0]?.content
      return (msg || defaultQuery).trim()
    }
  } catch (err) {
    console.error('LLM error', err?.response?.data || err?.message)
    return defaultQuery
  }
}

function embedPlaceUrl(placeId) {
  return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&q=place_id:${encodeURIComponent(placeId)}`
}
function embedDirectionsUrl(origin, destinationPlaceId) {
  const originStr = `${origin.lat},${origin.lng}`
  return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&origin=${encodeURIComponent(originStr)}&destination=place_id:${encodeURIComponent(destinationPlaceId)}`
}
function mapsLink(placeId, name) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`
}

async function placesTextSearch({ query, location, radiusMeters }) {
  const key = `textsearch:${query}:${location?.lat}:${location?.lng}:${radiusMeters}`
  if (cache.has(key)) return cache.get(key)
  const params = new URLSearchParams()
  params.set('query', query)
  params.set('key', GOOGLE_MAPS_SERVER_KEY)
  if (location && radiusMeters) {
    params.set('location', `${location.lat},${location.lng}`)
    params.set('radius', String(radiusMeters))
  }
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`
  const resp = await axios.get(url, { timeout: 10000 })
  if (resp.data?.status !== 'OK' && resp.data?.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places error: ${resp.data?.status}`)
  }
  cache.set(key, resp.data)
  return resp.data
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.post('/api/llm/search', async (req, res) => {
  const parsed = SearchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.format() })
  }
  const { prompt, location, radiusMeters = 5000, origin } = parsed.data
  try {
    const query = await extractQueryWithLLM(prompt)
    let data
    try {
      data = await placesTextSearch({ query, location, radiusMeters })
    } catch (e) {
      data = null
    }
    let results
    if (data && Array.isArray(data.results)) {
      results = data.results.map((r) => {
        const placeId = r.place_id
        const link = mapsLink(placeId, r.name)
        const embed = origin ? embedDirectionsUrl(origin, placeId) : embedPlaceUrl(placeId)
        return {
          name: r.name,
          address: r.formatted_address,
          location: r.geometry?.location,
          rating: r.rating,
          user_ratings_total: r.user_ratings_total,
          place_id: placeId,
          maps_link: link,
          embed_url: embed,
        }
      })
    } else {
      const link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
      const embed = origin
        ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}&destination=${encodeURIComponent(query)}`
        : `https://www.google.com/maps/embed/v1/search?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&q=${encodeURIComponent(query)}`
      results = [{
        name: query,
        address: undefined,
        location: undefined,
        rating: undefined,
        user_ratings_total: undefined,
        place_id: undefined,
        maps_link: link,
        embed_url: embed,
      }]
    }
    res.json({ query, results })
  } catch (err) {
    console.error('Search failed', err?.response?.data || err?.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

app.get('/map', (req, res) => {
  const placeId = String(req.query.place_id || '')
  const originLat = req.query.origin_lat ? Number(req.query.origin_lat) : undefined
  const originLng = req.query.origin_lng ? Number(req.query.origin_lng) : undefined
  let src = ''
  if (placeId && originLat != null && originLng != null) {
    src = embedDirectionsUrl({ lat: originLat, lng: originLng }, placeId)
  } else if (placeId) {
    src = embedPlaceUrl(placeId)
  }
  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return res.status(500).send('Google Maps browser key not configured')
  }
  if (!src) return res.status(400).send('Missing place_id')
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Map</title>
      <style>html,body{height:100%} body{margin:0} .wrap{height:100vh;display:flex} iframe{flex:1;border:0}</style>
    </head>
    <body>
      <div class="wrap">
        <iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="origin"></iframe>
      </div>
    </body>
  </html>`
  res.type('html').send(html)
})

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`)
})
