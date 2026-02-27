#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_province_pages.py
生成 web/provinces/<省份>/index.html 静态 SEO 页面
用法: python scripts/gen_province_pages.py
"""

import json
import os
import sys
import io
import re
import unicodedata
from collections import defaultdict
from datetime import datetime

# Force UTF-8 stdout on Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import os

from datetime import datetime

# ─── 配置 ─────────────────────────────────────────────
BASE_URL    = "https://arcademap.top"
DATA_PATH   = "web/data/locations.json"
OUT_DIR     = "web/provinces"
TODAY       = datetime.now().strftime("%Y-%m-%d")

GAME_LABELS = {
    "maimai":   "maimai DX",
    "chunithm": "CHUNITHM",
    "both":     "两种都有",
}

GAME_COLORS = {
    "maimai":   "#f472b6",
    "chunithm": "#38bdf8",
    "both":     "#a78bfa",
}

# 省份 → 拼音（URL slug），保证稳定
PROVINCE_SLUG = {
    "北京":   "beijing",
    "上海":   "shanghai",
    "广东":   "guangdong",
    "浙江":   "zhejiang",
    "江苏":   "jiangsu",
    "四川":   "sichuan",
    "山东":   "shandong",
    "湖北":   "hubei",
    "湖南":   "hunan",
    "河北":   "hebei",
    "河南":   "henan",
    "安徽":   "anhui",
    "福建":   "fujian",
    "辽宁":   "liaoning",
    "陕西":   "shaanxi",
    "重庆":   "chongqing",
    "天津":   "tianjin",
    "云南":   "yunnan",
    "贵州":   "guizhou",
    "山西":   "shanxi",
    "江西":   "jiangxi",
    "广西":   "guangxi",
    "黑龙江": "heilongjiang",
    "吉林":   "jilin",
    "内蒙古": "neimenggu",
    "甘肃":   "gansu",
    "海南":   "hainan",
    "新疆":   "xinjiang",
    "宁夏":   "ningxia",
    "青海":   "qinghai",
    "西藏":   "xizang",
}


def slug(province: str) -> str:
    """中文省名 → 英文 slug"""
    return PROVINCE_SLUG.get(province, province.lower().replace(" ", "-"))


def rating_str(loc: dict) -> str:
    r = loc.get("ratings", {}).get("amap", {}).get("rating")
    if r is not None:
        return f"{float(r):.1f}"
    return "暂无"


def tel_html(loc: dict) -> str:
    tel_raw = loc.get("ratings", {}).get("amap", {}).get("tel", "")
    if not tel_raw:
        return ""
    tels = [t.strip() for t in tel_raw.split(";") if t.strip()]
    links = " / ".join(f'<a href="tel:{t}">{t}</a>' for t in tels)
    return f'<span class="tel">📞 {links}</span>'


def amap_nav_url(loc: dict) -> str:
    if loc.get("lat") and loc.get("lng"):
        return (
            f"https://uri.amap.com/navigation?to={loc['lng']},{loc['lat']},"
            f"{loc['name']}&mode=car&callnative=1"
        )
    return ""


def render_shop_row(loc: dict) -> str:
    game_color = GAME_COLORS.get(loc.get("game", ""), "#aaa")
    game_label = GAME_LABELS.get(loc.get("game", ""), loc.get("game", ""))
    r = rating_str(loc)
    rating_cls = "" if r == "暂无" else "has-rating"
    tel = tel_html(loc)
    nav = amap_nav_url(loc)
    nav_btn = (
        f'<a class="nav-btn" href="{nav}" target="_blank" rel="noopener">🗺️ 导航</a>'
        if nav else ""
    )

    return f"""
  <div class="shop-card">
    <div class="shop-top">
      <span class="game-dot" style="background:{game_color}" title="{game_label}"></span>
      <strong class="shop-name">{loc['name']}</strong>
      <span class="game-tag">{game_label}</span>
    </div>
    <div class="shop-address">📍 {loc.get('address','')}</div>
    <div class="shop-meta">
      <span class="rating {rating_cls}">⭐ {r}</span>
      {tel}
      {nav_btn}
    </div>
  </div>"""


def schema_local_business(loc: dict) -> str:
    nav = amap_nav_url(loc)
    lat = loc.get("lat", "")
    lng = loc.get("lng", "")
    rating = loc.get("ratings", {}).get("amap", {}).get("rating")
    rating_block = ""
    if rating:
        rating_block = f"""
    "aggregateRating": {{
      "@type": "AggregateRating",
      "ratingValue": "{float(rating):.1f}",
      "bestRating": "5"
    }},"""
    geo_block = ""
    if lat and lng:
        geo_block = f"""
    "geo": {{
      "@type": "GeoCoordinates",
      "latitude": {lat},
      "longitude": {lng}
    }},"""
    return f"""{{
    "@type": "AmusementPark",
    "name": "{loc['name']}",
    "address": "{loc.get('address','')}",{geo_block}{rating_block}
    "description": "{GAME_LABELS.get(loc.get('game',''),'音游')} 机厅"
  }}"""


def build_page(province: str, locations: list) -> str:
    sl = slug(province)
    page_url = f"{BASE_URL}/provinces/{sl}/"
    total = len(locations)
    maimai_cnt  = sum(1 for l in locations if l.get("game") == "maimai")
    chunithm_cnt = sum(1 for l in locations if l.get("game") == "chunithm")
    both_cnt    = sum(1 for l in locations if l.get("game") == "both")

    title = f"{province} maimai DX / CHUNITHM 机厅地图 — 共 {total} 家"
    desc  = (
        f"{province}共有 {total} 家音游机厅，其中 maimai DX {maimai_cnt} 家、"
        f"CHUNITHM {chunithm_cnt} 家、双机厅 {both_cnt} 家。"
        f"查看地址、评分、电话，一键导航，快速找到{province}的机厅。"
    )

    # 只取有坐标的店做地图 markers（JSON 嵌入页面）
    map_locs = [l for l in locations if l.get("lat") and l.get("lng")]
    map_json = json.dumps(
        [{"name": l["name"], "lat": l["lat"], "lng": l["lng"],
          "game": l.get("game",""), "address": l.get("address","")}
         for l in map_locs],
        ensure_ascii=False, separators=(",",":")
    )

    # Schema.org: 最多嵌入 20 家（避免 HTML 过大）
    schema_items = [schema_local_business(l) for l in locations[:20]]
    schema_list  = ",\n  ".join(schema_items)

    shop_cards = "\n".join(render_shop_row(l) for l in locations)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>{title}</title>
  <meta name="description" content="{desc}" />
  <meta name="keywords" content="{province}maimai DX机厅,{province}CHUNITHM机厅,{province}音游机厅,{province}机厅地图" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="{page_url}" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="{page_url}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:image" content="{BASE_URL}/og-cover.png" />
  <meta property="og:locale" content="zh_CN" />

  <!-- Schema.org ItemList -->
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "{province}音游机厅列表",
    "description": "{desc}",
    "url": "{page_url}",
    "numberOfItems": {total},
    "itemListElement": [
  {schema_list}
    ]
  }}
  </script>

  <!-- Leaflet -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" crossorigin="" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Inter', sans-serif; background: #0b0f1a; color: #e8eaf1; line-height: 1.5; }}
    a {{ color: #60a5fa; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}

    /* ── Header ── */
    .site-header {{
      background: #111827;
      border-bottom: 1px solid #1e293b;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }}
    .site-header .logo {{ font-size: 1.1rem; font-weight: 700; color: #a78bfa; }}
    .breadcrumb {{ font-size: 0.85rem; color: #94a3b8; }}
    .breadcrumb a {{ color: #94a3b8; }}

    /* ── Hero stats ── */
    .hero {{
      background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
      padding: 36px 24px 28px;
      text-align: center;
    }}
    .hero h1 {{ font-size: clamp(1.4rem, 4vw, 2rem); font-weight: 700; margin-bottom: 8px; }}
    .hero .sub {{ color: #94a3b8; font-size: 0.95rem; margin-bottom: 20px; }}
    .stats-row {{
      display: flex;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
    }}
    .stat-chip {{
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 0.9rem;
    }}
    .stat-chip strong {{ color: #c4b5fd; }}

    /* ── Map ── */
    #map {{
      width: 100%;
      height: 380px;
      border-bottom: 1px solid #1e293b;
    }}

    /* ── Shop list ── */
    .container {{ max-width: 900px; margin: 0 auto; padding: 24px 16px 48px; }}
    .section-title {{
      font-size: 1.05rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #1e293b;
    }}
    .shop-card {{
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 10px;
      transition: border-color 0.2s;
    }}
    .shop-card:hover {{ border-color: #4f46e5; }}
    .shop-top {{
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }}
    .game-dot {{
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }}
    .shop-name {{ font-weight: 600; flex: 1; font-size: 0.97rem; }}
    .game-tag {{
      font-size: 0.72rem;
      background: #1e293b;
      border-radius: 4px;
      padding: 2px 6px;
      color: #94a3b8;
      white-space: nowrap;
    }}
    .shop-address {{
      font-size: 0.82rem;
      color: #64748b;
      margin-bottom: 6px;
    }}
    .shop-meta {{
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.82rem;
    }}
    .rating {{ color: #94a3b8; }}
    .rating.has-rating {{ color: #fbbf24; }}
    .tel a {{ color: #60a5fa; }}
    .nav-btn {{
      display: inline-block;
      background: #1e3a5f;
      border: 1px solid #2563eb;
      color: #93c5fd;
      border-radius: 5px;
      padding: 2px 10px;
      font-size: 0.78rem;
      cursor: pointer;
    }}
    .nav-btn:hover {{ background: #1d4ed8; color: #fff; text-decoration: none; }}

    /* ── Back link ── */
    .back-link {{
      display: inline-block;
      margin-top: 32px;
      color: #64748b;
      font-size: 0.85rem;
    }}
    .back-link:hover {{ color: #94a3b8; }}

    /* ── Responsive ── */
    @media (max-width: 600px) {{
      .hero {{ padding: 24px 16px 20px; }}
      #map {{ height: 260px; }}
      .stats-row {{ gap: 8px; }}
      .stat-chip {{ padding: 6px 12px; font-size: 0.82rem; }}
    }}
  </style>
</head>
<body>

  <header class="site-header">
    <span class="logo">Arcade Map</span>
    <nav class="breadcrumb">
      <a href="../../">全国地图</a> › {province}
    </nav>
  </header>

  <section class="hero">
    <h1>{province} 音游机厅地图</h1>
    <p class="sub">maimai DX · CHUNITHM · 共 {total} 家机厅</p>
    <div class="stats-row">
      <div class="stat-chip">总计 <strong>{total}</strong> 家</div>
      <div class="stat-chip">maimai DX <strong>{maimai_cnt}</strong> 家</div>
      <div class="stat-chip">CHUNITHM <strong>{chunithm_cnt}</strong> 家</div>
      <div class="stat-chip">双机厅 <strong>{both_cnt}</strong> 家</div>
    </div>
  </section>

  <!-- 交互地图 -->
  <div id="map"></div>

  <!-- 静态店铺列表（可被爬虫完整抓取） -->
  <div class="container">
    <p class="section-title">全部 {total} 家门店</p>
    {shop_cards}
    <a class="back-link" href="../../">← 返回全国地图</a>
  </div>

  <!-- Leaflet scripts -->
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" crossorigin=""></script>
  <script>
  (function() {{
    var locs = {map_json};

    var colors = {{ maimai:"#f472b6", chunithm:"#38bdf8", both:"#a78bfa" }};

    // Compute center
    var lats = locs.map(function(l){{return l.lat;}});
    var lngs = locs.map(function(l){{return l.lng;}});
    var centerLat = (Math.min.apply(null,lats)+Math.max.apply(null,lats))/2;
    var centerLng = (Math.min.apply(null,lngs)+Math.max.apply(null,lngs))/2;

    var map = L.map('map').setView([centerLat, centerLng], 8);
    L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }}).addTo(map);

    var cluster = L.markerClusterGroup({{
      chunkedLoading: true, maxClusterRadius: 50, showCoverageOnHover: false
    }});

    locs.forEach(function(l) {{
      var color = colors[l.game] || '#aaa';
      var icon = L.divIcon({{
        className: '',
        html: '<div style="width:12px;height:12px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6]
      }});
      var m = L.marker([l.lat, l.lng], {{icon: icon}});
      m.bindPopup('<strong>' + l.name + '</strong><br/><small>' + l.address + '</small>');
      cluster.addLayer(m);
    }});
    map.addLayer(cluster);
  }})();
  </script>

</body>
</html>
"""


def generate_all():
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    by_province = defaultdict(list)
    for loc in data:
        p = loc.get("province", "").strip()
        if p:
            by_province[p].append(loc)

    generated = []
    for province, locations in sorted(by_province.items(), key=lambda x: -len(x[1])):
        sl = slug(province)
        out_dir = os.path.join(OUT_DIR, sl)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "index.html")

        html = build_page(province, locations)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)

        print(f"✓ {province:8s} ({len(locations):4d} 家) → {out_path}")
        generated.append((province, sl, len(locations)))

    print(f"\n✅ 共生成 {len(generated)} 个省份页面")
    return generated


if __name__ == "__main__":
    generated = generate_all()

    # 同时生成 sitemap.xml
    sitemap_lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    sitemap_lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    sitemap_lines.append(f'  <url><loc>{BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>')
    for province, sl, cnt in generated:
        sitemap_lines.append(
            f'  <url><loc>{BASE_URL}/provinces/{sl}/</loc>'
            f'<changefreq>monthly</changefreq><priority>0.8</priority></url>'
        )
    sitemap_lines.append('</urlset>')

    sitemap_path = "web/sitemap.xml"
    with open(sitemap_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sitemap_lines) + "\n")
    print(f"✅ sitemap.xml → {sitemap_path} ({len(generated)+1} URLs)")
