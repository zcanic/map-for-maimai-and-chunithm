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
let nearbyMode = false;      // 是否处于"附近"模式

// 列表渐进加载状态
let listBatch = [];          // 当前要渲染的全量列表
let listRendered = 0;        // 已渲染条数
const LIST_PAGE = 60;        // 每批渲染数量
let listObserver = null;     // IntersectionObserver

// 收藏功能
let favorites = new Set(JSON.parse(localStorage.getItem('arcmap_favs') || '[]'));

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
  map = L.map('map', { zoomControl: false }).setView([36.5, 105], 4);

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

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      map.closePopup();
      closeSidebar();
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

/* ── 高德导航链接 ──────────────────────────── */
function buildNavUrl(loc) {
  // 高德地图导航（移动端自动唤起 App）
  return `https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}&callnative=1`;
}

/* ── Popup HTML ───────────────────────────── */
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

  const navUrl = buildNavUrl(loc);

  return `
    <div class="popup-inner">
      <div class="popup-name">${loc.name}</div>
      <div class="popup-tags">${getGameLabel(loc.game)}</div>
      <div class="popup-row">📍 ${loc.address}</div>
      <div class="popup-row popup-rating">${ratingStr}</div>
      ${costRow}
      ${telRow}
      ${distRow}
      <div class="popup-actions">
        <a class="popup-btn popup-btn-nav" href="${navUrl}" target="_blank" rel="noopener">
          🗺️ 导航
        </a>
        <button class="popup-btn popup-btn-share" onclick="shareShop('${loc.id}', '${loc.name.replace(/'/g, "\\'")}')">
          🔗 分享
        </button>
      </div>
    </div>
  `;
}

/* ── Create single marker ─────────────────── */
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
    .bindPopup(buildPopupHTML(loc), { maxWidth: 300, className: 'custom-popup' });

  markerMap.set(idx, marker);
  return marker;
}

/* ── Render markers (cluster) ─────────────── */
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

  let distHtml = '';
  if (userLat != null && loc.lat && loc.lng) {
    const d = haversine(userLat, userLng, loc.lat, loc.lng);
    distHtml = `<div class="shop-distance">📸 ${formatDistance(d)}</div>`;
  }

  const div = document.createElement('div');
  div.className = 'shop-item' + (fav ? ' fav' : '');
  div.setAttribute('data-idx', i);
  div.setAttribute('data-id', loc.id);
  div.innerHTML = `
    <div class="shop-header">
      <div class="shop-name">${loc.name}</div>
      <div class="shop-header-right">
        <button class="fav-btn${fav ? ' active' : ''}" data-id="${loc.id}" title="收藏">♥</button>
        <div class="shop-game-dot" style="background:${getMarkerColor(loc.game)}" title="${loc.game}"></div>
      </div>
    </div>
    <div class="shop-address">${loc.address}</div>
    <div class="shop-rating ${ratingClass}">⭐ ${ratingStr}</div>
    ${distHtml}
  `;
  div.addEventListener('click', (e) => {
    if (e.target.closest('.fav-btn')) return; // 收藏按鈕单独处理
    flyToMarker(loc, i);
    closeSidebar();
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

  renderListBatch();
}

/* ── Fly to marker & open popup ───────────── */
function flyToMarker(loc, idx) {
  if (!loc.lat || !loc.lng) return;

  document.querySelectorAll('.shop-item.active').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`.shop-item[data-idx="${idx}"]`);
  if (el) el.classList.add('active');

  map.flyTo([loc.lat, loc.lng], 16, { animate: true, duration: 0.8 });

  setTimeout(() => {
    const marker = markerMap.get(idx);
    if (marker) {
      markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    }
  }, 900);
}

/* ── FitBounds to filtered results ─────────── */
function fitToFiltered(locations) {
  const withCoords = locations.filter(l => l.lat && l.lng);
  if (withCoords.length === 0) return;
  if (withCoords.length === allLocations.filter(l => l.lat && l.lng).length) return;

  const bounds = L.latLngBounds(withCoords.map(l => [l.lat, l.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
}

/* ── Filters ──────────────────────────────── */
function applyFilters() {
  const game     = document.getElementById('gameFilter').value;
  const province = document.getElementById('provinceFilter').value;
  const rating   = document.getElementById('ratingFilter').value;
  const search   = document.getElementById('searchInput').value.trim().toLowerCase();

  // 收藏模式过滤
  const favMode = document.getElementById('favFilterBtn').classList.contains('active');

  filteredLocations = allLocations.filter(l => {
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

  // 附近模式：按距离排序
  if (nearbyMode && userLat != null) {
    filteredLocations = filteredLocations
      .map(l => ({
        ...l,
        _dist: (l.lat && l.lng) ? haversine(userLat, userLng, l.lat, l.lng) : Infinity
      }))
      .sort((a, b) => a._dist - b._dist);
  }

  renderMarkers(filteredLocations);
  updateStats(filteredLocations);
  updateList(filteredLocations);
  if (!nearbyMode) fitToFiltered(filteredLocations);
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
    navigator.clipboard.writeText(url).then(() => showToast('链接已复制到剪贴板'));
  } else {
    showToast('复制链接：' + url);
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

    // Populate province nav links
    const SLUG_MAP = {
      '北京':'beijing','上海':'shanghai','广东':'guangdong','浙江':'zhejiang','江苏':'jiangsu',
      '四川':'sichuan','山东':'shandong','湖北':'hubei','湖南':'hunan','河北':'hebei',
      '河南':'henan','安徽':'anhui','福建':'fujian','辽宁':'liaoning','陕西':'shaanxi',
      '重庆':'chongqing','天津':'tianjin','云南':'yunnan','贵州':'guizhou','山西':'shanxi',
      '江西':'jiangxi','广西':'guangxi','黑龙江':'heilongjiang','吉林':'jilin','内蒙古':'neimenggu',
      '甘肃':'gansu','海南':'hainan','新疆':'xinjiang','宁夏':'ningxia','青海':'qinghai','西藏':'xizang'
    };
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
    renderMarkers(allLocations);
    updateStats(allLocations);
    updateList(allLocations);

    // 处理 URL hash 直接跳转（分享链接支持）
    handleHashNavigation();
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
    const marker = markerMap.get(idx);
    if (marker) {
      markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    }
  }, 800);
}

/* ── Events ───────────────────────────────── */
function registerEvents() {
  ['gameFilter', 'provinceFilter', 'ratingFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 250);
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
    document.getElementById('favFilterBtn').classList.remove('active');
    applyFilters();
    map.setView([36.5, 105], 4);
  });

  // 收藏筛选按鈕
  document.getElementById('favFilterBtn').addEventListener('click', () => {
    const btn = document.getElementById('favFilterBtn');
    btn.classList.toggle('active');
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
}

/* ── Boot ─────────────────────────────────── */
initMap();
loadData();
registerEvents();
