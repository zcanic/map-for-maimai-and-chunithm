/* ──────────────────────────────────────────────
   Arcade Map — app.js
   ────────────────────────────────────────────── */

let map;
let markerCluster;
let markerMap = new Map();   // loc.id (or index) → L.marker
let allLocations = [];
let filteredLocations = [];

/* ── Map init ─────────────────────────────────── */
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([36.5, 105], 4);

  // Custom zoom control (top-right)
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Marker cluster group
  markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 100,
    maxClusterRadius: 60,
    iconCreateFunction: createClusterIcon,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    animate: true
  });
  map.addLayer(markerCluster);

  // Close popup on ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') map.closePopup();
  });
}

/* ── Cluster icon ─────────────────────────────── */
function createClusterIcon(cluster) {
  const count = cluster.getChildCount();
  let size = 'sm';
  if (count > 100) size = 'lg';
  else if (count > 30) size = 'md';
  return L.divIcon({
    html: `<div class="cluster-icon cluster-${size}"><span>${count}</span></div>`,
    className: '',
    iconSize: L.point(40, 40)
  });
}

/* ── Marker color ─────────────────────────────── */
function getMarkerColor(game) {
  if (game === 'maimai') return '#38bdf8';
  if (game === 'chunithm') return '#f43f5e';
  return '#a855f7';
}

/* ── Game label ───────────────────────────────── */
function getGameLabel(game) {
  if (game === 'maimai') return '<span class="tag tag-maimai">maimai DX</span>';
  if (game === 'chunithm') return '<span class="tag tag-chunithm">CHUNITHM</span>';
  return '<span class="tag tag-maimai">maimai DX</span><span class="tag tag-chunithm">CHUNITHM</span>';
}

/* ── Popup HTML ───────────────────────────────── */
function buildPopupHTML(loc) {
  const rating = loc.ratings?.amap?.rating;
  const ratingStr = rating != null ? `⭐ ${Number(rating).toFixed(1)}` : '暂无评分';
  const cost = loc.ratings?.amap?.cost;
  const tel = loc.ratings?.amap?.tel;

  const costRow = cost ? `<div class="popup-row">💰 人均 ¥${cost}</div>` : '';
  const telRow  = tel  ? `<div class="popup-row">📞 <a href="tel:${tel}" style="color:#38bdf8">${tel}</a></div>` : '';

  return `
    <div class="popup-inner">
      <div class="popup-name">${loc.name}</div>
      <div class="popup-tags">${getGameLabel(loc.game)}</div>
      <div class="popup-row">📍 ${loc.address}</div>
      <div class="popup-row popup-rating">${ratingStr}</div>
      ${costRow}
      ${telRow}
    </div>
  `;
}

/* ── Create single marker ─────────────────────── */
function createMarker(loc, idx) {
  const color = getMarkerColor(loc.game);
  const icon = L.divIcon({
    className: '',
    html: `<div class="dot-marker" style="background:${color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10]
  });

  const marker = L.marker([loc.lat, loc.lng], { icon })
    .bindPopup(buildPopupHTML(loc), { maxWidth: 280, className: 'custom-popup' });

  markerMap.set(idx, marker);
  return marker;
}

/* ── Render markers (cluster) ─────────────────── */
function renderMarkers(locations) {
  markerCluster.clearLayers();
  markerMap.clear();

  const batch = [];
  locations.forEach((loc, i) => {
    if (!loc.lat || !loc.lng) return;
    batch.push(createMarker(loc, i));
  });
  markerCluster.addLayers(batch);
}

/* ── Stats ────────────────────────────────────── */
function updateStats(locations) {
  document.getElementById('statTotal').textContent = locations.length;
  document.getElementById('statMaimai').textContent = locations.filter(l => l.game === 'maimai').length;
  document.getElementById('statChunithm').textContent = locations.filter(l => l.game === 'chunithm').length;
  document.getElementById('statBoth').textContent = locations.filter(l => l.game === 'both').length;
}

/* ── Shop list ────────────────────────────────── */
function updateList(locations) {
  const list = document.getElementById('shopList');
  const counter = document.getElementById('listCounter');
  list.innerHTML = '';

  const MAX = 200;
  const shown = Math.min(locations.length, MAX);
  counter.textContent = locations.length > MAX
    ? `显示前 ${MAX} 条 / 共 ${locations.length} 条（缩放地图筛选更多）`
    : `共 ${locations.length} 条`;

  locations.slice(0, MAX).forEach((loc, i) => {
    const rating = loc.ratings?.amap?.rating;
    const ratingStr = rating != null ? Number(rating).toFixed(1) : '暂无';
    const ratingClass = rating != null ? 'has-rating' : '';

    const div = document.createElement('div');
    div.className = 'shop-item';
    div.setAttribute('data-idx', i);
    div.innerHTML = `
      <div class="shop-header">
        <div class="shop-name">${loc.name}</div>
        <div class="shop-game-dot" style="background:${getMarkerColor(loc.game)}" title="${loc.game}"></div>
      </div>
      <div class="shop-address">${loc.address}</div>
      <div class="shop-rating ${ratingClass}">⭐ ${ratingStr}</div>
    `;
    div.addEventListener('click', () => flyToMarker(loc, i));
    list.appendChild(div);
  });
}

/* ── Fly to marker & open popup ───────────────── */
function flyToMarker(loc, idx) {
  if (!loc.lat || !loc.lng) return;

  // Remove highlight from all items
  document.querySelectorAll('.shop-item.active').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`.shop-item[data-idx="${idx}"]`);
  if (el) el.classList.add('active');

  map.flyTo([loc.lat, loc.lng], 16, { animate: true, duration: 0.8 });

  // After fly, open popup (cluster needs to be zoomed in enough)
  setTimeout(() => {
    const marker = markerMap.get(idx);
    if (marker) {
      markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    }
  }, 900);
}

/* ── FitBounds to filtered results ───────────────── */
function fitToFiltered(locations) {
  const withCoords = locations.filter(l => l.lat && l.lng);
  if (withCoords.length === 0) return;
  if (withCoords.length === allLocations.filter(l => l.lat && l.lng).length) return; // Skip when showing all

  const bounds = L.latLngBounds(withCoords.map(l => [l.lat, l.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
}

/* ── Filters ──────────────────────────────────── */
function applyFilters() {
  const game     = document.getElementById('gameFilter').value;
  const province = document.getElementById('provinceFilter').value;
  const rating   = document.getElementById('ratingFilter').value;
  const search   = document.getElementById('searchInput').value.trim().toLowerCase();

  filteredLocations = allLocations.filter(l => {
    if (game !== 'all' && l.game !== game) return false;
    if (province !== 'all' && l.province !== province) return false;
    if (rating !== 'all') {
      const min = parseFloat(rating);
      if ((l.ratings?.amap?.rating ?? 0) < min) return false;
    }
    if (search) {
      const haystack = `${l.name} ${l.address} ${l.province || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  renderMarkers(filteredLocations);
  updateStats(filteredLocations);
  updateList(filteredLocations);
  fitToFiltered(filteredLocations);
}

/* ── Loading UI ───────────────────────────────── */
function showLoading(visible) {
  document.getElementById('loadingOverlay').style.display = visible ? 'flex' : 'none';
}

/* ── Load data ────────────────────────────────── */
async function loadData() {
  showLoading(true);
  try {
    const res = await fetch('data/locations.json');
    const data = await res.json();

    allLocations = data.map(loc => {
      // Normalise legacy rating field
      if (!loc.ratings && loc.rating) {
        loc.ratings = { amap: { rating: loc.rating, source: loc.ratingSource } };
      }
      return loc;
    });

    // Populate province dropdown
    const provinces = Array.from(new Set(allLocations.map(l => l.province))).filter(Boolean).sort();
    const sel = document.getElementById('provinceFilter');
    provinces.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });

    filteredLocations = allLocations;
    renderMarkers(allLocations);
    updateStats(allLocations);
    updateList(allLocations);
  } finally {
    showLoading(false);
  }
}

/* ── Events ───────────────────────────────────── */
function registerEvents() {
  ['gameFilter', 'provinceFilter', 'ratingFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  // Search with debounce
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 250);
  });

  // Clear search button
  document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    applyFilters();
  });

  // Reset all filters button
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('gameFilter').value = 'all';
    document.getElementById('provinceFilter').value = 'all';
    document.getElementById('ratingFilter').value = 'all';
    document.getElementById('searchInput').value = '';
    applyFilters();
    map.setView([36.5, 105], 4);
  });
}

/* ── Boot ─────────────────────────────────────── */
initMap();
loadData();
registerEvents();
