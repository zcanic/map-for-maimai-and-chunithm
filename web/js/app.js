/* ──────────────────────────────────────────────
   Arcade Map — app.js
   ────────────────────────────────────────────── */

let map;
let markerCluster;
let markerMap = new Map();   // idx → L.marker
let allLocations = [];
let filteredLocations = [];
let userMarker = null;       // 用户位置标记
let userLat = null;
let userLng = null;
let nearbyMode = false;      // 是否处于“附近”模式

// 列表渐进加载状态
let listBatch = [];          // 当前要渲染的全量列表
let listRendered = 0;        // 已渲染条数
const LIST_PAGE = 60;        // 每批渲染数量
let listObserver = null;     // IntersectionObserver

// 性能缓存
let allLocationsWithCoordsLen = 0; // 预计算，避免 fitToFiltered 重复 O(n)
let $searchInput = null;           // 缓存 DOM 引用
let lastActiveId = null;           // 记录最后激活的店铺 id

// Province slug map (used in popup + nav links)
const SLUG_MAP = {
  '北京':'beijing','上海':'shanghai','广东':'guangdong','浙江':'zhejiang','江苏':'jiangsu',
  '四川':'sichuan','山东':'shandong','湖北':'hubei','湖南':'hunan','河北':'hebei',
  '河南':'henan','安徽':'anhui','福建':'fujian','辽宁':'liaoning','陕西':'shaanxi',
  '重庆':'chongqing','天津':'tianjin','云南':'yunnan','贵州':'guizhou','山西':'shanxi',
  '江西':'jiangxi','广西':'guangxi','黑龙江':'heilongjiang','吉林':'jilin','内蒙古':'neimenggu',
  '甘肃':'gansu','海南':'hainan','新疆':'xinjiang','宁夏':'ningxia','青海':'qinghai','西藏':'xizang'
};

// 标记渲染防抖（搜索时只刷列表，延迟刷地图）
let markerRenderTimer = null;

// 最近浏览
const RECENT_MAX = 10;
let recentHistory = (() => { try { return JSON.parse(localStorage.getItem('arcmap_recent') || '[]'); } catch(e) { return []; } })();

function saveRecent() {
  localStorage.setItem('arcmap_recent', JSON.stringify(recentHistory));
}

function addToRecent(loc) {
  // Remove existing entry for same id, then prepend
  recentHistory = recentHistory.filter(r => r.id !== loc.id);
  recentHistory.unshift({ id: loc.id, name: loc.name, game: loc.game, lat: loc.lat, lng: loc.lng });
  if (recentHistory.length > RECENT_MAX) recentHistory = recentHistory.slice(0, RECENT_MAX);
  saveRecent();
  renderRecentSection();
}

function renderRecentSection() {
  const section = document.getElementById('recentSection');
  if (!section) return;
  const list = section.querySelector('.recent-list');
  if (!list) return;
  if (recentHistory.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  list.innerHTML = '';
  recentHistory.forEach(r => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `<span class="shop-game-dot" style="background:${getMarkerColor(r.game)}" title="${r.game}"></span><span class="recent-name">${r.name}</span>`;
    div.addEventListener('click', () => {
      const found = allLocations.find(l => l.id === r.id);
      if (found) { flyToMarker(found); closeSidebar(); }
    });
    list.appendChild(div);
  });
}
// 收藏功能
let favorites = new Set((() => { try { return JSON.parse(localStorage.getItem('arcmap_favs') || '[]'); } catch(e) { return []; } })());

function saveFavorites() {
  localStorage.setItem('arcmap_favs', JSON.stringify([...favorites]));
}

function toggleFavorite(id, itemEl) {
  if (favorites.has(id)) {
    favorites.delete(id);
    itemEl.classList.remove('fav');
    const btn = itemEl.querySelector('.fav-btn');
    if (btn) btn.classList.remove('active');
    showToast('已移出收藏');
  } else {
    favorites.add(id);
    itemEl.classList.add('fav');
    const btn = itemEl.querySelector('.fav-btn');
    if (btn) btn.classList.add('active');
    showToast('已收藏 ♥');
  }
  saveFavorites();
}

/* ── Haversine 距离（km） ─────────────────── */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/* ── Map init ─────────────────────────────── */
function initMap() {
  if (map) return; // prevent double-init (Leaflet throws if container already used)
  // Restore saved map view or use default
  const savedView = (() => { try { return JSON.parse(localStorage.getItem('arcmap_view')); } catch(e) { return null; } })();
  const initCenter = savedView ? [savedView.lat, savedView.lng] : [36.5, 105];
  const initZoom = savedView ? savedView.zoom : 4;
  map = L.map('map', { zoomControl: false }).setView(initCenter, initZoom);

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
  }).addTo(map);

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

  // Persist map view on move
  map.on('moveend', () => {
    const c = map.getCenter();
    try { localStorage.setItem('arcmap_view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })); } catch(e) {}
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      map.closePopup();
      closeSidebar();
    }
    // '/' key focuses search box
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      openSidebar();
      document.getElementById('searchInput').focus();
    }
  });
}

/* ── Cluster icon ─────────────────────────── */
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

/* ── Marker color ─────────────────────────── */
function getMarkerColor(game) {
  if (game === 'maimai') return '#38bdf8';
  if (game === 'chunithm') return '#f43f5e';
  return '#a855f7';
}

/* ── Game label ───────────────────────────── */
function getGameLabel(game) {
  if (game === 'maimai') return '<span class="tag tag-maimai">maimai DX</span>';
  if (game === 'chunithm') return '<span class="tag tag-chunithm">CHUNITHM</span>';
  return '<span class="tag tag-maimai">maimai DX</span><span class="tag tag-chunithm">CHUNITHM</span>';
}

/* ── 高德导航链接 ──────────────────── */
function buildNavUrls(loc) {
  const name = encodeURIComponent(loc.name);
  const lat = loc.lat, lng = loc.lng;
  return {
    amap:   `https://uri.amap.com/marker?position=${lng},${lat}&name=${name}&callnative=1`,
    baidu:  `https://api.map.baidu.com/marker?location=${lat},${lng}&title=${name}&content=${name}&output=html`,
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    apple:  `https://maps.apple.com/?q=${name}&ll=${lat},${lng}`
  };
}

/* ── Popup HTML ───────────────────── */
function buildPopupHTML(loc) {
  const rating = loc.ratings?.amap?.rating;
  const ratingStr = rating != null ? `⭐ ${Number(rating).toFixed(1)}` : '暂无评分';
  const cost = loc.ratings?.amap?.cost;
  const tel = loc.ratings?.amap?.tel;

  const costRow = cost ? `<div class="popup-row">💰 人均 ¥${cost}</div>` : '';
  const telRow = tel
    ? `<div class="popup-row">📞 <a href="tel:${tel}">${tel}</a></div>`
    : '';

  const distRow = (userLat != null && loc.lat && loc.lng)
    ? `<div class="popup-row">📏 距您 ${formatDistance(haversine(userLat, userLng, loc.lat, loc.lng))}</div>`
    : '';

  const navUrls = buildNavUrls(loc);
  const safeId = loc.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const provSlug = loc.province ? (SLUG_MAP[loc.province] || loc.province) : null;
  const provRow = provSlug
    ? `<div class="popup-row"><a class="popup-prov-link" href="provinces/${provSlug}/" target="_blank">🏦 查看${loc.province}所有机厅</a></div>`
    : '';

  return `
    <div class="popup-inner">
      <div class="popup-name">${loc.name}</div>
      <div class="popup-tags">${getGameLabel(loc.game)}</div>
      <div class="popup-row">📍 ${loc.address}</div>
      <div class="popup-row popup-rating">${ratingStr}</div>
      ${costRow}
      ${telRow}
      ${distRow}
      ${provRow}
      <div class="popup-actions">
        <div class="nav-picker" id="navpicker_${safeId}">
          <button class="popup-btn popup-btn-nav" onclick="toggleNavPicker('navpicker_${safeId}')" aria-haspopup="true" aria-expanded="false">
            🗺️ 导航 ▾
          </button>
          <div class="nav-picker-menu" role="menu">
            <a class="nav-picker-item" href="${navUrls.amap}" target="_blank" rel="noopener" role="menuitem">🗺️ 高德地图</a>
            <a class="nav-picker-item" href="${navUrls.baidu}" target="_blank" rel="noopener" role="menuitem">🗺️ 百度地图</a>
            <a class="nav-picker-item" href="${navUrls.google}" target="_blank" rel="noopener" role="menuitem">🌐 Google Maps</a>
            <a class="nav-picker-item" href="${navUrls.apple}" target="_blank" rel="noopener" role="menuitem">🌏 Apple Maps</a>
          </div>
        </div>
        <button class="popup-btn popup-btn-share" onclick="shareShop('${loc.id}', '${loc.name.replace(/'/g, "\\'")}')">
          🔗 分享
        </button>
      </div>
    </div>
  `;
}

/* ── Highlight search keyword in text ──────── */
function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return text.replace(re, '<mark class="hl">$1</mark>');
}

/* ── Create single marker ─────────────────── */
function createMarker(loc) {
  const color = getMarkerColor(loc.game);
  const icon = L.divIcon({
    className: '',
    html: `<div class="dot-marker" style="background:${color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10]
  });

  const marker = L.marker([loc.lat, loc.lng], { icon })
    .bindPopup(buildPopupHTML(loc), { maxWidth: 300, className: 'custom-popup' });

  markerMap.set(loc.id, marker);
  return marker;
}

/* ── Render markers (cluster) ─────────────── */
function renderMarkers(locations) {
  markerCluster.clearLayers();
  markerMap.clear();

  const batch = [];
  locations.forEach((loc, i) => {
    if (!loc.lat || !loc.lng) return;
    batch.push(createMarker(loc));
  });
  markerCluster.addLayers(batch);
}

/* ── Stats ────────────────────────────────── */
function updateStats(locations) {
  document.getElementById('statTotal').textContent = locations.length;
  document.getElementById('statMaimai').textContent = locations.filter(l => l.game === 'maimai').length;
  document.getElementById('statChunithm').textContent = locations.filter(l => l.game === 'chunithm').length;
  document.getElementById('statBoth').textContent = locations.filter(l => l.game === 'both').length;
}

/* ── Build a single shop-item DOM node ─────────── */
function buildShopItem(loc, i) {
  const rating = loc.ratings?.amap?.rating;
  const ratingStr = rating != null ? Number(rating).toFixed(1) : '暂无';
  const ratingClass = rating != null ? 'has-rating' : '';
  const fav = favorites.has(loc.id);

  const searchQuery = ($searchInput || document.getElementById('searchInput')).value.trim().toLowerCase();

  let distHtml = '';
  if (userLat != null && loc.lat && loc.lng) {
    const d = haversine(userLat, userLng, loc.lat, loc.lng);
    distHtml = `<div class="shop-distance">📏 ${formatDistance(d)}</div>`;
  }

  const div = document.createElement('div');
  div.className = 'shop-item' + (fav ? ' fav' : '');
  div.setAttribute('data-idx', i);
  div.setAttribute('data-id', loc.id);
  div.innerHTML = `
    <div class="shop-header">
      <div class="shop-name">${highlight(loc.name, searchQuery)}</div>
      <div class="shop-header-right">
        <button class="fav-btn${fav ? ' active' : ''}" data-id="${loc.id}" title="收藏">♥</button>
        <div class="shop-game-dot" style="background:${getMarkerColor(loc.game)}" title="${loc.game}"></div>
      </div>
    </div>
    <div class="shop-address">${highlight(loc.address, searchQuery)}</div>
    <div class="shop-rating ${ratingClass}">⭐ ${ratingStr}</div>
    ${distHtml}
  `;
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.addEventListener('click', (e) => {
    if (e.target.closest('.fav-btn')) return; // 收藏按鈕单独处理
    flyToMarker(loc);
    addToRecent(loc);
    closeSidebar();
  });
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flyToMarker(loc);
      addToRecent(loc);
      closeSidebar();
    }
  });
  div.querySelector('.fav-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(loc.id, div);
  });
  return div;
}

/* ── Render next batch of list items ─────────── */
function renderListBatch() {
  const list = document.getElementById('shopList');
  const end = Math.min(listRendered + LIST_PAGE, listBatch.length);
  for (let i = listRendered; i < end; i++) {
    list.appendChild(buildShopItem(listBatch[i], i));
  }
  listRendered = end;

  // Re-apply active highlight after render
  if (lastActiveId != null) {
    const activeEl = list.querySelector(`.shop-item[data-id="${lastActiveId}"]`);
    if (activeEl) activeEl.classList.add('active');
  }

  // Update / remove sentinel
  let sentinel = document.getElementById('listSentinel');
  if (listRendered >= listBatch.length) {
    if (sentinel) sentinel.remove();
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
  } else {
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'listSentinel';
      sentinel.style.height = '1px';
      list.appendChild(sentinel);
      if (!listObserver) {
        listObserver = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) renderListBatch();
        }, { rootMargin: '200px' });
      }
      listObserver.observe(sentinel);
    }
  }
}

/* ── Shop list (entry point) ─────────────── */
function updateList(locations) {
  const list = document.getElementById('shopList');
  const counter = document.getElementById('listCounter');
  list.innerHTML = '';
  if (listObserver) { listObserver.disconnect(); listObserver = null; }

  listBatch = locations;
  listRendered = 0;
  counter.textContent = `共 ${locations.length} 条`;

  if (locations.length === 0) {
    list.innerHTML = `<div class="empty-state">😢 没有找到符合条件的机厅<br><small>试试放宽筛选条件</small><br><button class="empty-reset-btn" onclick="document.getElementById('resetFilters').click()">重置所有筛选</button></div>`;
    return;
  }

  renderListBatch();
}

/* ── Fly to marker & open popup ───────────── */
function flyToMarker(loc) {
  if (!loc.lat || !loc.lng) return;

  document.querySelectorAll('.shop-item.active').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`.shop-item[data-id="${loc.id}"]`);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  lastActiveId = loc.id;

  map.flyTo([loc.lat, loc.lng], 16, { animate: true, duration: 0.8 });

  setTimeout(() => {
    const marker = markerMap.get(loc.id);
    if (marker) {
      markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    }
  }, 900);
}

/* ── FitBounds to filtered results ─────────── */
function fitToFiltered(locations) {
  const withCoords = locations.filter(l => l.lat && l.lng);
  if (withCoords.length === 0) return;
  if (withCoords.length === allLocationsWithCoordsLen) return;

  const bounds = L.latLngBounds(withCoords.map(l => [l.lat, l.lng]));
  if (!bounds.isValid()) return;
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
}

/* ── Filters ─────────────────────────────── */
function computeFiltered() {
  const game     = document.getElementById('gameFilter').value;
  const province = document.getElementById('provinceFilter').value;
  const rating   = document.getElementById('ratingFilter').value;
  const search   = ($searchInput || document.getElementById('searchInput')).value.trim().toLowerCase();
  const favMode  = document.getElementById('favFilterBtn').classList.contains('active');

  let result = allLocations.filter(l => {
    if (favMode && !favorites.has(l.id)) return false;
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

  // 附近模式：按距离排序（覆盖其他排序）
  if (nearbyMode && userLat != null) {
    result = result
      .map(l => ({
        ...l,
        _dist: (l.lat && l.lng) ? haversine(userLat, userLng, l.lat, l.lng) : Infinity
      }))
      .sort((a, b) => a._dist - b._dist);
  } else {
    const sort = document.getElementById('sortFilter')?.value || 'default';
    if (sort === 'rating_desc') {
      result = result.sort((a, b) => (b.ratings?.amap?.rating ?? -1) - (a.ratings?.amap?.rating ?? -1));
    } else if (sort === 'rating_asc') {
      result = result.sort((a, b) => (a.ratings?.amap?.rating ?? 999) - (b.ratings?.amap?.rating ?? 999));
    } else if (sort === 'name_asc') {
      result = result.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    }
  }
  return result;
}

/* ── Active filter badge ──────────────────── */
function updateFilterBadge() {
  const game     = document.getElementById('gameFilter').value;
  const province = document.getElementById('provinceFilter').value;
  const rating   = document.getElementById('ratingFilter').value;
  const search   = ($searchInput || document.getElementById('searchInput')).value.trim();
  const favMode  = document.getElementById('favFilterBtn').classList.contains('active');
  const sort     = document.getElementById('sortFilter')?.value || 'default';
  let count = 0;
  if (game !== 'all') count++;
  if (province !== 'all') count++;
  if (rating !== 'all') count++;
  if (search) count++;
  if (favMode) count++;
  if (nearbyMode) count++;
  if (sort !== 'default') count++;
  let badge = document.getElementById('filterBadge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'filterBadge';
    badge.className = 'filter-badge';
    const hdr = document.querySelector('.card:nth-of-type(2) .card-header-row h3');
    if (hdr) hdr.appendChild(badge);
  }
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Full update: markers + stats + list + fitBounds
function applyFilters() {
  clearTimeout(markerRenderTimer);
  filteredLocations = computeFiltered();
  updateFilterBadge();
  requestAnimationFrame(() => {
    renderMarkers(filteredLocations);
    updateStats(filteredLocations);
    updateList(filteredLocations);
    if (!nearbyMode) fitToFiltered(filteredLocations);
  });
}

// Fast path for search input: update list immediately, defer marker re-render
function applyFiltersSearch() {
  filteredLocations = computeFiltered();
  updateFilterBadge();
  updateStats(filteredLocations);
  updateList(filteredLocations);
  clearTimeout(markerRenderTimer);
  markerRenderTimer = setTimeout(() => {
    renderMarkers(filteredLocations);
    if (!nearbyMode) fitToFiltered(filteredLocations);
  }, 500);
}

/* ── 附近机厅 ─────────────────────────────── */
function locateUser() {
  const btn = document.getElementById('locateBtn');

  if (!navigator.geolocation) {
    showToast('您的浏览器不支持定位功能');
    return;
  }

  // 如果已在附近模式，点击则取消
  if (nearbyMode) {
    nearbyMode = false;
    userLat = null;
    userLng = null;
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    applyFilters();
    map.setView([36.5, 105], 4);
    showToast('已退出附近模式');
    return;
  }

  btn.classList.add('loading');
  showToast('正在获取位置…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      nearbyMode = true;

      btn.classList.remove('loading');
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('active');

      // 用户位置标记
      if (userMarker) map.removeLayer(userMarker);
      const userIcon = L.divIcon({
        className: '',
        html: `<div style="
          width:16px;height:16px;border-radius:50%;
          background:#3b82f6;border:3px solid #fff;
          box-shadow:0 0 0 4px #3b82f640,0 2px 8px rgba(0,0,0,0.5);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      userMarker = L.marker([userLat, userLng], { icon: userIcon, zIndexOffset: 1000 })
        .bindPopup('<div class="popup-inner"><div class="popup-name">📍 您的位置</div></div>', { className: 'custom-popup' })
        .addTo(map);

      applyFilters();
      map.setView([userLat, userLng], 12, { animate: true });
      showToast('已找到附近机厅，按距离排序');
    },
    (err) => {
      btn.classList.remove('loading');
      let msg = '定位失败';
      if (err.code === 1) msg = '请允许浏览器获取位置权限';
      else if (err.code === 2) msg = '无法获取位置，请检查网络';
      else if (err.code === 3) msg = '定位超时，请重试';
      showToast(msg);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* ── 分享店铺 ─────────────────────────────── */
function shareShop(id, name) {
  const url = `${location.origin}${location.pathname}#shop=${id}`;
  if (navigator.share) {
    navigator.share({ title: name, text: `快来 ${name} 打机！`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('链接已复制到剪贴板')).catch(() => showToast('复制失败，请手动复制：' + url));
  } else {
    showToast('复制链接：' + url);
  }
}

/* ── Nav picker toggle ──────────────────── */
function toggleNavPicker(id) {
  const picker = document.getElementById(id);
  if (!picker) return;
  const isOpen = picker.classList.toggle('open');
  picker.querySelector('button').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    // Close when clicking outside
    const closeHandler = (e) => {
      if (!picker.contains(e.target)) {
        picker.classList.remove('open');
        picker.querySelector('button').setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
  }
}

/* ── Toast ────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  let toast = document.getElementById('_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ── 移动端侧边栏抽屉 ──────────────────────── */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
}

/* ── Loading UI ───────────────────────────── */
function showLoading(visible) {
  document.getElementById('loadingOverlay').style.display = visible ? 'flex' : 'none';
}

/* ── Load data ────────────────────────────── */
function loadData() {
  showLoading(true);
  try {
    const data = window.LOCATIONS;
    if (!data || !Array.isArray(data)) throw new Error('locations.js 未加载');

    allLocations = data.map(loc => {
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

    // Populate province nav links (uses module-level SLUG_MAP)
    const prov_counts = {};
    allLocations.forEach(l => { if (l.province) prov_counts[l.province] = (prov_counts[l.province]||0)+1; });
    const provNav = document.getElementById('provinceLinks');
    if (provNav) {
      provinces
        .sort((a, b) => (prov_counts[b]||0) - (prov_counts[a]||0))
        .forEach(p => {
          const sl = SLUG_MAP[p] || p;
          const a = document.createElement('a');
          a.href = `provinces/${sl}/`;
          a.className = 'prov-link';
          a.innerHTML = `${p} <em>${prov_counts[p]||0}</em>`;
          provNav.appendChild(a);
        });
    }

    filteredLocations = allLocations;
    allLocationsWithCoordsLen = allLocations.filter(l => l.lat && l.lng).length; // cache once
    renderMarkers(allLocations);
    updateStats(allLocations);
    updateList(allLocations);

    // 处理 URL hash 直接跳转（分享链接支持）
    handleHashNavigation();
    renderRecentSection();
  } catch (err) {
    console.error('loadData error:', err);
    const list = document.getElementById('shopList');
    if (list) list.innerHTML = '<div class="empty-state">⚠️ 数据加载失败<br><small>请刷新页面重试</small></div>';
    showToast('数据加载失败，请刷新页面');
  } finally {
    showLoading(false);
  }
}

/* ── URL hash 导航（分享链接） ─────────────── */
function handleHashNavigation() {
  const hash = location.hash;
  if (!hash.startsWith('#shop=')) return;
  const shopId = hash.slice(6);
  const idx = allLocations.findIndex(l => l.id === shopId);
  if (idx === -1) return;
  const loc = allLocations[idx];
  if (!loc.lat || !loc.lng) return;
  setTimeout(() => {
    map.setView([loc.lat, loc.lng], 16);
    const marker = markerMap.get(shopId);
    if (marker) {
      markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    }
  }, 800);
}

/* ── Events ───────────────────────────────── */
function registerEvents() {
  ['gameFilter', 'provinceFilter', 'ratingFilter', 'sortFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  $searchInput = document.getElementById('searchInput');

  let searchTimer;
  $searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFiltersSearch, 200);
  });

  document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    applyFilters();
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('gameFilter').value = 'all';
    document.getElementById('provinceFilter').value = 'all';
    document.getElementById('ratingFilter').value = 'all';
    document.getElementById('searchInput').value = '';
    document.getElementById('sortFilter').value = 'default';
    const favBtn = document.getElementById('favFilterBtn');
    favBtn.classList.remove('active');
    favBtn.setAttribute('aria-pressed', 'false');
    // Exit nearby mode if active
    if (nearbyMode) {
      nearbyMode = false; userLat = null; userLng = null;
      const lb = document.getElementById('locateBtn');
      lb.classList.remove('active', 'loading');
      lb.setAttribute('aria-pressed', 'false');
      if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    }
    lastActiveId = null;
    applyFilters();
    map.setView([36.5, 105], 4);
  });

  // 收藏筛选按鈕
  document.getElementById('favFilterBtn').addEventListener('click', () => {
    const btn = document.getElementById('favFilterBtn');
    btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    applyFilters();
  });

  // 附近机厅按钮
  document.getElementById('locateBtn').addEventListener('click', locateUser);

  // 移动端 FAB 展开侧边栏
  document.getElementById('fabSidebar').addEventListener('click', openSidebar);

  // 遮罩点击关闭
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // 拖拽把手点击切换（简化版：点击展开/收起）
  document.getElementById('drawerHandle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  // 清除最近浏览
  document.getElementById('clearRecentBtn').addEventListener('click', () => {
    recentHistory = [];
    saveRecent();
    renderRecentSection();
  });

  // 列表滑到顶部按鈕
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('scroll', () => {
    scrollTopBtn.style.display = sidebar.scrollTop > 200 ? '' : 'none';
  }, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    sidebar.scrollTo({ top: 0, behavior: 'smooth' });
  });


  // 移动端抑屉手势：向上滑展开，向下滑收起
  (function initSwipe() {
    const sidebar = document.getElementById('sidebar');
    let touchStartY = 0;
    let touchStartX = 0;
    sidebar.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    sidebar.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dy) < Math.abs(dx) * 1.5) return; // mostly horizontal, ignore
      if (dy < -40) openSidebar();   // swipe up
      if (dy > 60 && sidebar.scrollTop === 0) closeSidebar(); // swipe down from top
    }, { passive: true });
  })();
}

/* ── Boot ─────────────────────────────────── */
// --vh fix: correct 100vh on mobile when browser chrome appears/disappears
(function setVh() {
  const set = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  set();
  window.addEventListener('resize', set);
})();
initMap();
loadData();
registerEvents();
initMap();
loadData();
registerEvents();
