let map;
let markers = [];
let allLocations = [];

function initMap() {
  map = L.map('map').setView([35.8617, 104.1954], 4.5); // China center

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function getMarkerColor(game) {
  if (game === 'maimai') return '#38bdf8';
  if (game === 'chunithm') return '#f43f5e';
  return '#a855f7';
}

function createMarker(loc) {
  const color = getMarkerColor(loc.game);
  const markerIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid #fff;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const marker = L.marker([loc.lat, loc.lng], { icon: markerIcon })
    .bindPopup(`
      <b>${loc.name}</b><br/>
      ${loc.address}<br/>
      评分: ${loc.ratings?.amap?.rating ?? '暂无'}
    `);

  return marker;
}

function renderMarkers(locations) {
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  locations.forEach(loc => {
    if (!loc.lat || !loc.lng) return;
    const marker = createMarker(loc);
    marker.addTo(map);
    markers.push(marker);
  });
}

function updateStats(locations) {
  document.getElementById('statTotal').textContent = locations.length;
  document.getElementById('statMaimai').textContent = locations.filter(l => l.game === 'maimai').length;
  document.getElementById('statChunithm').textContent = locations.filter(l => l.game === 'chunithm').length;
  document.getElementById('statBoth').textContent = locations.filter(l => l.game === 'both').length;
}

function updateList(locations) {
  const list = document.getElementById('shopList');
  list.innerHTML = '';
  locations.slice(0, 200).forEach(loc => {
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `
      <div class="shop-name">${loc.name}</div>
      <div class="shop-address">${loc.address}</div>
      <div class="shop-rating">评分：${loc.ratings?.amap?.rating ?? '暂无'}</div>
    `;
    div.onclick = () => {
      if (loc.lat && loc.lng) {
        map.setView([loc.lat, loc.lng], 15);
      }
    };
    list.appendChild(div);
  });
}

function applyFilters() {
  const gameFilter = document.getElementById('gameFilter').value;
  const provinceFilter = document.getElementById('provinceFilter').value;
  const ratingFilter = document.getElementById('ratingFilter').value;

  let filtered = allLocations;

  if (gameFilter !== 'all') {
    filtered = filtered.filter(l => l.game === gameFilter);
  }

  if (provinceFilter !== 'all') {
    filtered = filtered.filter(l => l.province === provinceFilter);
  }

  if (ratingFilter !== 'all') {
    const minRating = parseFloat(ratingFilter);
    filtered = filtered.filter(l => (l.ratings?.amap?.rating ?? 0) >= minRating);
  }

  renderMarkers(filtered);
  updateStats(filtered);
  updateList(filtered);
}

async function loadData() {
  const res = await fetch('data/locations.json');
  const data = await res.json();

  // Convert rating field to nested ratings if needed
  allLocations = data.map(loc => {
    if (!loc.ratings && loc.rating) {
      loc.ratings = { amap: { rating: loc.rating, source: loc.ratingSource } };
    }
    return loc;
  });

  const provinces = Array.from(new Set(allLocations.map(l => l.province))).filter(Boolean).sort();
  const provinceSelect = document.getElementById('provinceFilter');
  provinces.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    provinceSelect.appendChild(opt);
  });

  renderMarkers(allLocations);
  updateStats(allLocations);
  updateList(allLocations);
}

function registerEvents() {
  document.getElementById('gameFilter').addEventListener('change', applyFilters);
  document.getElementById('provinceFilter').addEventListener('change', applyFilters);
  document.getElementById('ratingFilter').addEventListener('change', applyFilters);
}

initMap();
loadData();
registerEvents();
