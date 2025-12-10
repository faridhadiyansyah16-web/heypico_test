const promptEl = document.getElementById('prompt')
const searchBtn = document.getElementById('search')
const geoBothBtn = document.getElementById('geoBoth')
const resultsEl = document.getElementById('results')
const errorEl = document.getElementById('error')
const locLatEl = document.getElementById('locLat')
const locLngEl = document.getElementById('locLng')
const originLatEl = document.getElementById('originLat')
const originLngEl = document.getElementById('originLng')
const radiusEl = document.getElementById('radius')

function setError(t){ errorEl.textContent = t || '' }
function htmlToNode(html){ const div=document.createElement('div'); div.innerHTML=html; return div.firstElementChild }

async function useGeo(){
  setError('')
  if(!navigator.geolocation){ setError('Geolocation not available'); return }
  return new Promise((resolve)=>{
    navigator.geolocation.getCurrentPosition((pos)=>{
      const { latitude, longitude } = pos.coords
      locLatEl.value = latitude.toFixed(6)
      locLngEl.value = longitude.toFixed(6)
      originLatEl.value = latitude.toFixed(6)
      originLngEl.value = longitude.toFixed(6)
      resolve()
    },()=>{ setError('Failed to get location') })
  })
}

async function doSearch(){
  setError('')
  const prompt = (promptEl.value||'').trim()
  if(!prompt){ setError('Enter a prompt'); return }
  const locLat = Number(locLatEl.value)
  const locLng = Number(locLngEl.value)
  const originLat = Number(originLatEl.value)
  const originLng = Number(originLngEl.value)
  const radius = Number(radiusEl.value||'2000')
  const body = { prompt, radiusMeters: radius }
  if(!Number.isNaN(locLat) && !Number.isNaN(locLng)) body.location = { lat: locLat, lng: locLng }
  if(!Number.isNaN(originLat) && !Number.isNaN(originLng)) body.origin = { lat: originLat, lng: originLng }

  searchBtn.disabled = true
  resultsEl.innerHTML = ''
  try{
    const resp = await fetch('/api/llm/search',{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    })
    if(!resp.ok){ setError('Search failed'); return }
    const data = await resp.json()
    const items = data.results||[]
    if(items.length===0){ resultsEl.textContent = 'No results' ; return }
    for(const r of items){
      const node = htmlToNode(`
        <div class="item">
          <h3>${r.name}</h3>
          <div class="muted">${r.address||''}</div>
          <div class="muted">Rating: ${r.rating||'-'} (${r.user_ratings_total||0})</div>
          <div class="actions">
            <a href="${r.maps_link}" target="_blank" rel="noopener">Open in Google Maps</a>
            <button data-embed="${r.embed_url}">View Map</button>
          </div>
        </div>
      `)
      const btn = node.querySelector('button[data-embed]')
      btn.addEventListener('click',()=>{
        const src = btn.getAttribute('data-embed')
        const iframe = document.createElement('iframe')
        iframe.src = src
        iframe.referrerPolicy = 'origin'
        node.appendChild(iframe)
      })
      resultsEl.appendChild(node)
    }
  }catch(e){
    setError('Network error')
  }finally{
    searchBtn.disabled = false
  }
}

geoBothBtn.addEventListener('click', useGeo)
searchBtn.addEventListener('click', doSearch)
