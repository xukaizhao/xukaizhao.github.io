(function () {
  const config = window.APP_CONFIG || {};
  const tencentWebServicesEnabled = Boolean(config.TENCENT_MAP_KEY && config.ENABLE_TENCENT_WEB_SERVICES === true);
  const dataset = window.SEASONAL_DEMO_DATA || {};
  const COMMUNITY_STORAGE_KEY = "seasonal-map-community-v1";
  const COLOR_SPECIES_MAP = {
    pink: ["樱花", "垂丝海棠", "山桃", "桃花", "玉兰"],
    white: ["玉兰", "梨花"],
    yellow: ["连翘"],
  };
  const BLOOM_STAGE_SCORE = { 含苞: 72, 初开: 80, 最佳观赏期: 92, 开始飘落: 76 };
  const ROUTE_NODE_PRESETS = {
    "core-4": { aliases: ["情人坡"], tags: ["rest", "pink"] },
    "core-8": { aliases: ["万人食堂", "食堂", "午饭", "吃饭"], tags: ["lunch", "supply"] },
    "core-1": { tags: ["pink"] },
    "core-2": { tags: ["pink"] },
    "core-3": { tags: ["pink"] },
    "core-5": { tags: ["pink"] },
    "core-9": { tags: ["white"] },
  };
  const STATIC_COORDINATE_SYSTEM = String(config.STATIC_POINT_COORD_SYSTEM || "wgs84").toLowerCase();
  const GENERIC_ALIAS_BLACKLIST = new Set(["午饭", "吃饭", "食堂", "午餐", "咖啡"]);
  const GENERIC_PLACE_SUFFIXES = ["清华大学", "清华", "校园", "校内", "附近", "这里", "那边", "那儿"];
  const GENERIC_PLACE_TAILS = ["食堂", "公寓", "图书馆", "教学楼", "学院", "中心", "大楼", "楼", "馆", "门", "系"];

  function svgDataUri(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function transformLat(lng, lat) {
    let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
    ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
    ret += (20 * Math.sin(lat * Math.PI) + 40 * Math.sin(lat / 3 * Math.PI)) * 2 / 3;
    ret += (160 * Math.sin(lat / 12 * Math.PI) + 320 * Math.sin(lat * Math.PI / 30)) * 2 / 3;
    return ret;
  }

  function transformLng(lng, lat) {
    let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
    ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
    ret += (20 * Math.sin(lng * Math.PI) + 40 * Math.sin(lng / 3 * Math.PI)) * 2 / 3;
    ret += (150 * Math.sin(lng / 12 * Math.PI) + 300 * Math.sin(lng / 30 * Math.PI)) * 2 / 3;
    return ret;
  }

  function wgs84ToGcj02(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || outOfChina(lat, lng)) return { lat, lng };
    const a = 6378245;
    const ee = 0.00669342162296594323;
    const dLat = transformLat(lng - 105, lat - 35);
    const dLng = transformLng(lng - 105, lat - 35);
    const radLat = lat / 180 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    return {
      lat: lat + (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI),
      lng: lng + (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI),
    };
  }

  function normalizeStaticPoint(point) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat, lng };
    if (STATIC_COORDINATE_SYSTEM !== "wgs84") return { lat, lng };
    return wgs84ToGcj02(lat, lng);
  }

  const sceneCenter = {
    ...(dataset.meta?.center || { lat: 40.0032, lng: 116.3269, name: "清华大学中心区域" }),
    ...normalizeStaticPoint(dataset.meta?.center || { lat: 40.0032, lng: 116.3269 }),
  };

  const routeNodes = cloneData(dataset.databases?.routeNodes || []).map((node) => {
    const coord = normalizeStaticPoint(node);
    return {
      ...node,
      rawLat: Number(node.lat),
      rawLng: Number(node.lng),
      lat: coord.lat,
      lng: coord.lng,
      aliases: ROUTE_NODE_PRESETS[node.id]?.aliases || [],
      tags: ROUTE_NODE_PRESETS[node.id]?.tags || [],
    };
  });
  const flowerDisplayPoints = cloneData(dataset.databases?.flowerDisplayPoints || []).map((point) => ({
    ...point,
    ...normalizeStaticPoint(point),
  }));
  const flowerSummary = cloneData(dataset.databases?.flowerSummary || []);
  const userContributions = cloneData(dataset.databases?.userContributions || []);
  const routeModes = dataset.routeModes || {
    flowers: { scorer: { seasonal: 0.42, landmark: 0.12, photo: 0.16, shade: 0.14, rest: 0.16 } },
    landmarks: { scorer: { seasonal: 0.18, landmark: 0.34, photo: 0.18, shade: 0.12, rest: 0.18 } },
    photo: { scorer: { seasonal: 0.18, landmark: 0.18, photo: 0.4, shade: 0.08, rest: 0.16 } },
  };
  const ROUTE_MODE_LABELS = { flowers: "春花盛开", landmarks: "地标串联", photo: "拍照优先" };
  const FLOWER_KEYWORDS = ["樱花", "玉兰", "紫玉兰", "望春玉兰", "桃花", "山桃", "垂丝海棠", "海棠", "紫叶李", "连翘"];
  const LANDMARK_PATTERN = /楼|馆|堂|门|图书馆|学堂/;

  const els = {
    plannerForm: document.getElementById("planner-form"),
    intentInput: document.getElementById("intent-input"),
    plannerStartInput: document.getElementById("planner-start-input"),
    pickStartOnMapBtn: document.getElementById("pick-start-on-map-btn"),
    clearStartBtn: document.getElementById("clear-start-btn"),
    plannerStartDisplay: document.getElementById("planner-start-display"),
    plannerStartSuggestions: document.getElementById("planner-start-suggestions"),
    routeSummary: document.getElementById("route-summary"),
    routeDistance: document.getElementById("route-distance"),
    routeDuration: document.getElementById("route-duration"),
    mapStatus: document.getElementById("map-status"),
    mapContainer: document.getElementById("map"),
    previewKicker: document.getElementById("preview-kicker"),
    previewTitle: document.getElementById("preview-title"),
    previewContent: document.getElementById("preview-content"),
    locateBtn: document.getElementById("locate-btn"),
    focusRouteBtn: document.getElementById("focus-route-btn"),
    dockKicker: document.getElementById("dock-kicker"),
    dockTitle: document.getElementById("dock-title"),
    dockTip: document.getElementById("dock-tip"),
    panelKicker: document.getElementById("panel-kicker"),
    panelTitle: document.getElementById("panel-title"),
    panelContent: document.getElementById("panel-content"),
    mapPanel: document.querySelector(".map-panel"),
    recommendScroller: document.getElementById("recommend-scroller"),
    viewSwitcher: document.getElementById("view-switcher"),
    heroPoiCount: document.getElementById("hero-poi-count"),
    heroFlowerCount: document.getElementById("hero-flower-count"),
    heroUpdateCount: document.getElementById("hero-update-count"),
    intentChips: document.getElementById("intent-chips"),
    agentPlan: document.getElementById("agent-plan"),
    agentConnection: document.getElementById("agent-connection"),
    contributionForm: document.getElementById("contribution-form"),
    pickOnMapBtn: document.getElementById("pick-on-map-btn"),
    pickedPointDisplay: document.getElementById("picked-point-display"),
    contributionLocationName: document.getElementById("contribution-location-name"),
    contributionLinkedSpot: document.getElementById("contribution-linked-spot"),
    contributionSpecies: document.getElementById("contribution-species"),
    contributionSpeciesList: document.getElementById("contribution-species-list"),
    contributionBloom: document.getElementById("contribution-bloom"),
    contributionImage: document.getElementById("contribution-image"),
    contributionNote: document.getElementById("contribution-note"),
    communityMapContainer: document.getElementById("community-map"),
    communityMapStatus: document.getElementById("community-map-status"),
  };

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizePlaceName(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[（）()·,，\-—_.]/g, "")
      .trim();
  }

  function stripGenericPlaceWords(value) {
    let next = normalizePlaceName(value);
    GENERIC_PLACE_SUFFIXES.forEach((word) => {
      if (next.startsWith(word)) next = next.slice(word.length);
      if (next.endsWith(word)) next = next.slice(0, Math.max(0, next.length - word.length));
    });
    GENERIC_PLACE_TAILS.forEach((word) => {
      if (next.endsWith(word) && next.length > word.length) next = next.slice(0, next.length - word.length);
    });
    return next.trim();
  }

  function getMeaningfulPlaceTokens(value) {
    const cleaned = stripGenericPlaceWords(value);
    if (!cleaned) return [];
    return Array.from(new Set(
      cleaned
        .split(/[、,，/\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ));
  }

  function scorePlaceNameMatch(query, candidate) {
    const q = normalizePlaceName(query);
    const c = normalizePlaceName(candidate);
    if (!q || !c) return 0;
    if (q === c) return 120;
    if (c.includes(q) || q.includes(c)) return 92;
    const qCore = stripGenericPlaceWords(q);
    const cCore = stripGenericPlaceWords(c);
    if (qCore && cCore && qCore === cCore) return 86;
    if (qCore && cCore && (cCore.includes(qCore) || qCore.includes(cCore))) return 70;
    const tokens = getMeaningfulPlaceTokens(q);
    const tokenHits = tokens.filter((token) => token && c.includes(token));
    if (!tokenHits.length) return 0;
    return tokenHits.reduce((score, token) => score + (token.length >= 2 ? 28 : 10), 0);
  }

  function splitPlants(value) {
    return String(value || "")
      .split(/[、,，/\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeSpecies(species) {
    const text = String(species || "");
    if (text.includes("海棠")) return "垂丝海棠";
    if (text.includes("玉兰")) return "玉兰";
    if (text.includes("樱花")) return "樱花";
    if (text.includes("早樱")) return "樱花";
    if (text.includes("山桃")) return "山桃";
    if (text.includes("桃花")) return "桃花";
    if (text.includes("紫叶李")) return "紫叶李";
    if (text.includes("连翘")) return "连翘";
    if (text.includes("梨花")) return "梨花";
    return text;
  }

  function buildSemanticCover(kind, title) {
    const palette = {
      lunch: { token: "餐", kicker: "Lunch POI", start: "#f28d6e", end: "#e1518b" },
      tool: { token: "Tool", kicker: "Toolchain", start: "#bf5ce2", end: "#e1518b" },
      reason: { token: "AI", kicker: "Reasoning", start: "#d96ea8", end: "#e1518b" },
      need: { token: "AI", kicker: "Needs", start: "#cb6bb0", end: "#f17dad" },
      route: { token: "路", kicker: "Route", start: "#d16ca9", end: "#e1518b" },
      rest: { token: "休", kicker: "Rest", start: "#7b82ea", end: "#d16ca9" },
      poi: { token: "点", kicker: "Campus POI", start: "#7f8de8", end: "#d16ca9" },
    };
    const meta = palette[kind] || palette.poi;
    const label = String(title || "校园地点").slice(0, 20);
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="720" height="460" viewBox="0 0 720 460">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${meta.start}"/>
            <stop offset="100%" stop-color="${meta.end}"/>
          </linearGradient>
        </defs>
        <rect width="720" height="460" rx="36" fill="url(#g)"/>
        <circle cx="580" cy="92" r="94" fill="rgba(255,255,255,0.12)"/>
        <rect x="48" y="56" width="126" height="126" rx="34" fill="rgba(255,255,255,0.18)"/>
        <text x="111" y="132" text-anchor="middle" fill="#fff7fb" font-size="44" font-family="Avenir Next, PingFang SC, Microsoft YaHei, sans-serif" font-weight="800">${meta.token}</text>
        <text x="52" y="238" fill="rgba(255,247,251,0.78)" font-size="20" font-family="Avenir Next, PingFang SC, Microsoft YaHei, sans-serif" font-weight="700" letter-spacing="4">${meta.kicker}</text>
        <text x="52" y="302" fill="#fff7fb" font-size="38" font-family="Avenir Next, PingFang SC, Microsoft YaHei, sans-serif" font-weight="800">${escapeHtml(label)}</text>
      </svg>
    `);
  }

  function nodeHasSpecies(node, species) {
    return splitPlants(node?.plants).some((item) => normalizeSpecies(item) === normalizeSpecies(species));
  }

  function getNodeImage(node) {
    if (node?.images?.[0]) return node.images[0];
    const species = Array.isArray(node?.species) && node.species[0]
      ? node.species[0]
      : splitPlants(node?.plants)[0];
    if (species) return getSpeciesCover(species);
    if ((node?.tags || []).includes("lunch") || /麦当劳|食堂|餐厅|咖啡|午餐|补给/.test(node?.name || "")) return buildSemanticCover("lunch", node?.name || "午餐补给");
    if ((node?.tags || []).includes("rest")) return buildSemanticCover("rest", node?.name || "休息收尾");
    if ((node?.tags || []).includes("target-poi") || (node?.tags || []).includes("search-result")) return buildSemanticCover("poi", node?.name || "目标地点");
    return buildSemanticCover("route", node?.name || "校园地点");
  }

  function getNodeStatus(node) {
    if ((node?.bloomScore || 0) >= 88) return "今日最佳观赏期";
    if ((node?.bloomScore || 0) >= 80) return "适合现在顺路停留";
    return "适合轻量漫游打卡";
  }

  function getNodeDescription(node) {
    const plants = splitPlants(node?.plants).slice(0, 2).join(" · ") || "春季景观点";
    return `${plants}，${getNodeStatus(node)}。`;
  }

  function getFlowerSummary(species) {
    return flowerSummary.find((item) => normalizeSpecies(item.species) === normalizeSpecies(species)) || null;
  }

  function findNode(id) {
    return routeNodes.find((item) => item.id === id) || null;
  }

  function normalizeRouteStop(stop, index) {
    return {
      id: stop?.id || `agent-stop-${index + 1}`,
      name: stop?.name || `推荐停留点 ${index + 1}`,
      reason: stop?.reason || "",
      lat: Number(stop?.lat),
      lng: Number(stop?.lng),
      tags: Array.isArray(stop?.tags) ? [...stop.tags] : [],
      images: Array.isArray(stop?.images) ? [...stop.images] : [],
      stayMinutes: Number(stop?.stayMinutes) || 10,
      species: Array.isArray(stop?.species) ? [...stop.species] : [],
      plants: stop?.plants || "",
      photoScore: Number(stop?.photoScore) || 76,
      bloomScore: Number(stop?.bloomScore) || 80,
      shadeScore: Number(stop?.shadeScore) || 68,
      restScore: Number(stop?.restScore) || 66,
    };
  }

  function findCurrentPoint(id) {
    return state.plannedRoute.find((item) => item.id === id) || findNode(id) || null;
  }

  function getDailyFeedPoint(item) {
    const node = findNode(item?.relatedId);
    if (node) return node;
    if (Number.isFinite(item?.lat) && Number.isFinite(item?.lng)) {
      return {
        id: item.id,
        name: item.locationName || item.title || "用户标注点",
        lat: item.lat,
        lng: item.lng,
      };
    }
    return null;
  }

  function formatPointText(point) {
    if (!point) return "当前未选地图点位，将使用下方关联点位坐标。";
    const label = point.name ? `${point.name}` : "自定义标注点";
    return `${label} · ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  }

  function hasValidPoint(point) {
    return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
  }

  function getCurrentStartPoint() {
    return hasValidPoint(state.customStartPoint) ? state.customStartPoint : sceneCenter;
  }

  function getCurrentStartLabel() {
    return state.customStartPoint?.name || state.customStartQuery || sceneCenter.name || "清华大学中心区域";
  }

  function getSubmittedStartPoint() {
    if (hasValidPoint(state.customStartPoint)) {
      return {
        name: state.customStartPoint.name || state.customStartSelectionQuery || state.customStartQuery || "自定义起点",
        lat: state.customStartPoint.lat,
        lng: state.customStartPoint.lng,
      };
    }
    if (state.customStartQuery) {
      return {
        name: state.customStartQuery,
      };
    }
    return undefined;
  }

  function formatStartPointText() {
    if (hasValidPoint(state.customStartPoint)) {
      if (state.customStartQuery && normalizePlaceName(state.customStartQuery) !== normalizePlaceName(state.customStartPoint.name)) {
        return `当前输入“${state.customStartQuery}”，已选候选起点：${state.customStartPoint.name || "自定义起点"} · ${state.customStartPoint.lat.toFixed(6)}, ${state.customStartPoint.lng.toFixed(6)}`;
      }
      return `当前从 ${state.customStartPoint.name || "自定义起点"} 出发 · ${state.customStartPoint.lat.toFixed(6)}, ${state.customStartPoint.lng.toFixed(6)}`;
    }
    if (state.customStartQuery) {
      return `当前想从“${state.customStartQuery}”出发；请点选下方候选，或在地图上选择起点。`;
    }
    return `当前从 ${sceneCenter.name || "清华大学中心区域"} 出发。`;
  }

  function toRad(value) {
    return (value * Math.PI) / 180;
  }

  function getDistanceKm(a, b) {
    const earth = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * earth * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
  }

  function findNearestNode(point) {
    if (!point) return routeNodes[0] || null;
    return [...routeNodes].sort((a, b) => getDistanceKm(point, a) - getDistanceKm(point, b))[0] || null;
  }

  function styleText(styleKey) {
    if (styleKey === "shade") return "尽量避晒";
    if (styleKey === "rest") return "中途易休息";
    return "观赏与拍照兼顾";
  }

  function themeFromText(raw) {
    const text = String(raw || "");
    if (/拍照|出片|摄影|机位/.test(text)) return "photo";
    if (/地标|建筑|礼堂|学堂|馆/.test(text)) return "landmarks";
    if (/赏花|花|春季/.test(text)) return "flowers";
    return null;
  }

  function styleFromText(raw) {
    const text = String(raw || "");
    if (/避晒|不想晒|树荫|阴凉|凉快/.test(text)) return "shade";
    if (/休息|轻松|慢慢逛|不累|坐一坐/.test(text)) return "rest";
    if (/拍照|观赏|均衡/.test(text)) return "balanced";
    return null;
  }

  function durationFromText(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const minutesMatch = text.match(/(\d+)\s*分钟/);
    if (minutesMatch) return nearestDuration(Number(minutesMatch[1]));
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*小时/);
    if (hourMatch) return nearestDuration(Math.round(Number(hourMatch[1]) * 60));
    if (/慢慢逛|走一会|逛一会/.test(text)) return 45;
    return null;
  }

  function nearestDuration(value) {
    return [30, 45, 60].reduce((best, current) => (Math.abs(current - value) < Math.abs(best - value) ? current : best), 45);
  }

  function uniqueById(list) {
    const seen = new Set();
    return list.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  function extractTargetQuery(raw) {
    const patterns = [
      /(?:最后去|再去|然后去|顺路去|前往|到达|去到|去)([^，。,；;]+)/,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      const value = String(match?.[1] || "")
        .replace(/(休息一会|休息|坐一坐|吃个饭|吃饭|午饭|午餐|拍照|赏花|看看).*$/, "")
        .trim();
      if (value && value.length >= 2 && !FLOWER_KEYWORDS.includes(value)) return value;
    }
    return "";
  }

  function findNodeByKeyword(raw) {
    const query = String(raw || "").trim();
    if (!query) return null;
    let best = null;
    let bestScore = 0;
    routeNodes.forEach((node) => {
      const score = Math.max(
        scorePlaceNameMatch(query, node.name),
        ...(node.aliases || [])
          .filter((alias) => !GENERIC_ALIAS_BLACKLIST.has(alias))
          .map((alias) => scorePlaceNameMatch(query, alias)),
      );
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return bestScore >= 28 ? best : null;
  }

  function resolveColorIntent(raw) {
    if (/粉色|粉粉|少女|浪漫/.test(raw)) return "pink";
    if (/白色|白花|纯白/.test(raw)) return "white";
    if (/黄色|黄花/.test(raw)) return "yellow";
    return null;
  }

  function parseIntent(text) {
    const raw = String(text || "").trim();
    const result = {
      raw,
      theme: null,
      style: null,
      duration: null,
      species: null,
      color: null,
      preferredSpecies: [],
      wantsPhoto: false,
      wantsLandmark: false,
      wantsShade: false,
      wantsRest: false,
      wantsLunch: false,
      targetNodeId: null,
      targetNodeName: null,
      targetNodeQuery: "",
      planMode: "single",
    };
    if (!raw) return result;
    if (/拍照|出片|摄影|机位/.test(raw)) { result.theme = "photo"; result.wantsPhoto = true; }
    if (/地标|礼堂|建筑|二校门|学堂/.test(raw)) { result.theme = result.theme || "landmarks"; result.wantsLandmark = true; }
    if (/赏花|春花|花卉|玉兰|樱花|海棠|桃花|山桃|连翘|紫叶李/.test(raw) && !result.theme) result.theme = "flowers";
    if (/避晒|不想晒|阴凉|树荫|凉快/.test(raw)) { result.style = "shade"; result.wantsShade = true; }
    if (/休息|轻松|慢慢逛|不累|坐一坐|补给/.test(raw)) { result.style = result.style || "rest"; result.wantsRest = true; }
    if (/午饭|吃饭|食堂|午餐|咖啡|补给/.test(raw)) result.wantsLunch = true;
    if (/然后|再去|最后去|先.+再/.test(raw)) result.planMode = "multi";
    const durationMatch = raw.match(/(\d+)\s*分钟/);
    if (durationMatch) result.duration = nearestDuration(Number(durationMatch[1]));
    else if (/走一段时间|逛一会|慢慢逛/.test(raw)) result.duration = 45;
    const species = FLOWER_KEYWORDS.find((keyword) => raw.includes(keyword));
    if (species) result.species = normalizeSpecies(species);
    result.color = resolveColorIntent(raw);
    if (result.color) result.preferredSpecies = [...(COLOR_SPECIES_MAP[result.color] || [])];
    if (result.species && !result.preferredSpecies.includes(result.species)) result.preferredSpecies.unshift(result.species);
    const targetQuery = extractTargetQuery(raw);
    result.targetNodeQuery = targetQuery;
    const targetNode = findNodeByKeyword(targetQuery || raw);
    if (targetNode) {
      result.targetNodeId = targetNode.id;
      result.targetNodeName = targetNode.name;
      result.wantsLandmark = true;
    }
    return result;
  }

  const speciesCoverMap = new Map();

  function rebuildSpeciesCoverMap() {
    speciesCoverMap.clear();
    routeNodes.forEach((node) => {
      splitPlants(node.plants).forEach((species) => {
        const key = normalizeSpecies(species);
        if (!speciesCoverMap.has(key) && getNodeImage(node)) speciesCoverMap.set(key, getNodeImage(node));
      });
    });
    userContributions.forEach((item) => {
      const key = normalizeSpecies(item.species);
      if (key && item.imageUrl && !speciesCoverMap.has(key)) speciesCoverMap.set(key, item.imageUrl);
    });
  }

  function getSpeciesCover(species) {
    return speciesCoverMap.get(normalizeSpecies(species)) || getNodeImage(routeNodes[0]);
  }

  function rebuildFlowerSummary() {
    const stats = new Map();
    flowerDisplayPoints.forEach((point) => {
      const key = normalizeSpecies(point.species);
      if (!key) return;
      const current = stats.get(key) || { species: key, count: 0, samples: [] };
      current.count += 1;
      if (current.samples.length < 3) current.samples.push({ lat: point.lat, lng: point.lng });
      stats.set(key, current);
    });
    const next = [...stats.values()].sort((a, b) => b.count - a.count || a.species.localeCompare(b.species, "zh-CN"));
    flowerSummary.splice(0, flowerSummary.length, ...next);
  }

  function buildDailyFeed() {
    const fallbackTimes = ["今天 08:20", "今天 10:40", "今天 14:10", "今天 16:30"];
    return userContributions.map((item, index) => {
      const node = findNode(item.relatedId) || routeNodes[index % Math.max(routeNodes.length, 1)] || null;
      const species = normalizeSpecies(item.species || splitPlants(node?.plants)[0] || "春花");
      const title = item.title || (item.type === "route" ? "新增一条更适合傍晚散步的路线" : item.type === "phenology" ? `${species} 观测进度已更新` : `${species} 的今日实拍已同步`);
      return {
        id: item.id || `update-${index + 1}`,
        title,
        description: item.note || (node ? `${node.name} 附近当前更适合停留、拍照和顺路打卡。` : "最新内容已同步到地图。"),
        timestamp: item.timestamp || fallbackTimes[index] || "今天",
        tag: item.type === "route" ? "路线更新" : item.type === "phenology" ? "花况观测" : "实拍更新",
        relatedId: node?.id || null,
        image: item.imageUrl || getNodeImage(node),
        mediaCount: item.mediaCount || 1,
        sortKey: item.createdAt || `${index}`,
        lat: Number.isFinite(item.lat) ? item.lat : node?.lat,
        lng: Number.isFinite(item.lng) ? item.lng : node?.lng,
        locationName: item.locationName || node?.name || "",
      };
    }).sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey), "zh-CN"));
  }

  rebuildSpeciesCoverMap();
  rebuildFlowerSummary();
  let dailyFeed = buildDailyFeed();

  const state = {
    selectedTheme: "flowers",
    selectedDuration: 45,
    selectedStyle: "balanced",
    selectedIntent: "",
    intentSignals: parseIntent(""),
    activeView: "spots",
    plannedRoute: [],
    recommendations: [],
    activeRouteId: null,
    routeMetrics: null,
    realRoutePath: [],
    selectedCoreId: routeNodes[0]?.id || null,
    selectedFlowerSpecies: flowerSummary[0]?.species || null,
    selectedUpdateId: dailyFeed[0]?.id || null,
    map: null,
    contributionMap: null,
    coreMarkerLayer: null,
    flowerMarkerLayer: null,
    polylineLayer: null,
    startMarkerLayer: null,
    userMarker: null,
    reportMarkerLayer: null,
    contributionCoreLayer: null,
    contributionDraftLayer: null,
    mapResizeObserver: null,
    contributionMapResizeObserver: null,
    mapFitFrame: 0,
    agentPlanSteps: [],
    agentPlanPayload: null,
    agentVisibleStepCount: null,
    agentPlanTimer: null,
    agentThinkingTimer: null,
    agentThinkingStartedAt: 0,
    agentAvailable: null,
    agentModel: "",
    agentStrategy: "",
    agentMapProviderLabel: "",
    activeAgentBaseUrl: "",
    agentLastError: "",
    agentTriedUrls: [],
    intentChips: [],
    contributionDraftPoint: null,
    isPickingContributionPoint: false,
    customStartPoint: null,
    customStartQuery: "",
    customStartSelectionQuery: "",
    customStartCandidates: [],
    startSearchTimer: 0,
    startSearchRequestId: 0,
    isPickingStartPoint: false,
    recommendAutoTimer: null,
    recommendAutoIndex: 0,
    recommendAutoRaf: 0,
    recommendAutoDirection: 1,
    suppressNextFit: false,
  };

  function scoreNode(node, modeKey, styleKey, signals) {
    const weights = routeModes[modeKey]?.scorer || routeModes.flowers.scorer;
    let score = (node.bloomScore || 0) * (weights.seasonal || 0) + (node.photoScore || 0) * (weights.photo || 0) + (node.shadeScore || 0) * (weights.shade || 0) + (node.restScore || 0) * (weights.rest || 0) + 100 * (weights.landmark || 0);
    if (styleKey === "shade") score += (node.shadeScore || 0) * 0.24;
    else if (styleKey === "rest") score += (node.restScore || 0) * 0.26;
    else score += (node.photoScore || 0) * 0.06;
    if (signals?.species && nodeHasSpecies(node, signals.species)) score += 18;
    if (signals?.preferredSpecies?.length && signals.preferredSpecies.some((species) => nodeHasSpecies(node, species))) score += 14;
    if (signals?.color && (node.tags || []).includes(signals.color)) score += 10;
    if (signals?.wantsLandmark && LANDMARK_PATTERN.test(node.name || "")) score += 12;
    if (signals?.wantsPhoto) score += (node.photoScore || 0) * 0.12;
    if (signals?.wantsShade) score += (node.shadeScore || 0) * 0.14;
    if (signals?.wantsRest) score += (node.restScore || 0) * 0.14;
    if (signals?.wantsLunch && (node.tags || []).includes("lunch")) score += 22;
    if (signals?.targetNodeId === node.id) score += 32;
    return score;
  }

  function optimizeSequence(stops) {
    const ordered = [];
    let current = getCurrentStartPoint();
    const pool = [...stops];
    while (pool.length) {
      pool.sort((a, b) => getDistanceKm(current, a) - getDistanceKm(current, b));
      const next = pool.shift();
      ordered.push(next);
      current = next;
    }
    return ordered;
  }

  function selectAnchorNode(kind, signals, excludedIds) {
    const excluded = new Set(excludedIds || []);
    const pool = routeNodes.filter((node) => !excluded.has(node.id));
    if (kind === "lunch") {
      return pool
        .filter((node) => (node.tags || []).includes("lunch"))
        .sort((a, b) => scoreNode(b, "flowers", "balanced", signals) - scoreNode(a, "flowers", "balanced", signals))[0] || null;
    }
    if (kind === "rest") {
      return pool
        .filter((node) => node.id === signals?.targetNodeId || (node.tags || []).includes("rest") || (node.restScore || 0) >= 74)
        .sort((a, b) => scoreNode(b, "flowers", "rest", signals) - scoreNode(a, "flowers", "rest", signals))[0] || null;
    }
    return null;
  }

  function buildAgentPlan(route, themeKey, durationMinutes, styleKey, signals) {
    const scenicStops = route.filter((node) => !(node.tags || []).includes("lunch") && node.id !== signals.targetNodeId).slice(0, 2);
    const lunchStop = route.find((node) => (node.tags || []).includes("lunch")) || null;
    const finale = route.find((node) => node.id === signals.targetNodeId) || route[route.length - 1] || null;
    const chips = [
      signals.species ? `花种 ${signals.species}` : null,
      signals.color === "pink" ? "颜色 粉色系" : signals.color === "white" ? "颜色 白色系" : signals.color === "yellow" ? "颜色 黄色系" : null,
      `${ROUTE_MODE_LABELS[themeKey] || ROUTE_MODE_LABELS.flowers}`,
      `${styleText(styleKey)}`,
      `${durationMinutes} 分钟`,
      signals.planMode === "multi" ? "多阶段行程" : "单阶段行程",
    ].filter(Boolean);

    const steps = [
      {
        tool: "Prompt",
        title: "理解自然语言请求",
        description: signals.raw
          ? `识别到${chips.join("、")}，并把你的需求拆成可执行的路线偏好。`
          : `按默认偏好生成 ${ROUTE_MODE_LABELS[themeKey]} 的体验路线。`,
        meta: ["意图识别", "参数归一化"],
      },
      {
        tool: "Skill",
        title: "筛选季节花点与体验锚点",
        description: scenicStops.length
          ? `优先保留 ${scenicStops.map((node) => node.name).join("、")} 等更贴合你偏好的赏花或拍照节点。`
          : "先用本地花点数据挑出更值得优先停留的节点。",
        meta: [signals.preferredSpecies?.length ? signals.preferredSpecies.slice(0, 3).join(" / ") : "花点排序", signals.wantsPhoto ? "拍照打分" : "季节打分"],
      },
      {
        tool: "Tool",
        title: signals.wantsLunch || signals.targetNodeId ? "拼接补给与休息阶段" : "生成可步行串联顺序",
        description: signals.wantsLunch || signals.targetNodeId
          ? `把${lunchStop ? `${lunchStop.name} 午餐补给` : "中途补给"}和${finale ? `${finale.name} 收尾停留` : "终点体验"}一起纳入行程。`
          : `根据距离、花况和体验分重新排序，形成一条更自然的步行串联路线。`,
        meta: [signals.wantsLunch ? "午餐节点" : "步行顺序", signals.targetNodeId ? "终点锁定" : "体验节奏"],
      },
      {
        tool: "Map API",
        title: tencentWebServicesEnabled ? "回填腾讯真实步行路径" : "绘制点位连线示意",
        description: tencentWebServicesEnabled ? "调用腾讯步行路线与逆地址解析，生成步行路径。" : "连接推荐点位并估算距离；连线为游览顺序示意，不作为步行导航。",
        meta: tencentWebServicesEnabled ? ["walking", "reverseGeocoder"] : ["示意连线", "距离估算"],
      },
    ];

    return { chips, steps };
  }

  function buildRoute(themeKey, durationMinutes, styleKey, signals) {
    const maxStops = durationMinutes <= 30 ? 3 : durationMinutes <= 45 ? 4 : 5;
    const anchorNodes = [];
    if (signals?.wantsLunch) {
      const lunchNode = selectAnchorNode("lunch", signals, anchorNodes.map((node) => node.id));
      if (lunchNode) anchorNodes.push(lunchNode);
    }
    if (signals?.targetNodeId) {
      const targetNode = findNode(signals.targetNodeId);
      if (targetNode) anchorNodes.push(targetNode);
    } else if (signals?.wantsRest) {
      const restNode = selectAnchorNode("rest", signals, anchorNodes.map((node) => node.id));
      if (restNode) anchorNodes.push(restNode);
    }
    const scenicSlots = Math.max(1, maxStops - uniqueById(anchorNodes).length);
    const ranked = [...routeNodes]
      .filter((node) => !anchorNodes.some((anchor) => anchor.id === node.id))
      .map((node) => ({ node, score: scoreNode(node, themeKey, styleKey, signals) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, scenicSlots + 4)
      .map((item) => item.node);
    const scenicRoute = optimizeSequence(ranked.slice(0, scenicSlots));
    const route = uniqueById([...scenicRoute, ...anchorNodes]).slice(0, maxStops);
    const plan = buildAgentPlan(route, themeKey, durationMinutes, styleKey, signals || {});
    state.intentChips = plan.chips;
    state.agentPlanSteps = plan.steps;
    return route;
  }

  function approximateRouteDistance(route) {
    if (!route.length) return 0;
    let total = getDistanceKm(getCurrentStartPoint(), route[0]);
    for (let i = 0; i < route.length - 1; i += 1) total += getDistanceKm(route[i], route[i + 1]);
    return total;
  }

  function renderHero() {
    els.heroPoiCount.textContent = `${routeNodes.length} 个核心点位`;
    els.heroFlowerCount.textContent = `${flowerDisplayPoints.length} 个花点位`;
    els.heroUpdateCount.textContent = `${dailyFeed.length} 条花讯示例`;
  }

  function renderMedia(src, alt, className, fallbackLabel) {
    if (!src) {
      const label = String(fallbackLabel || alt || "校园地点");
      let token = "点";
      let kicker = "Campus POI";
      if (/工具|Tool|调用|Agent/.test(label)) { token = "Tool"; kicker = "Toolchain"; }
      else if (/理由|建议/.test(label)) { token = "AI"; kicker = "Reasoning"; }
      else if (/需求/.test(label)) { token = "AI"; kicker = "Needs"; }
      else if (/麦当劳|食堂|餐厅|咖啡|午餐|补给/.test(label)) { token = "餐"; kicker = "Lunch POI"; }
      else if (/休息|收尾/.test(label)) { token = "休"; kicker = "Rest"; }
      else if (/路线/.test(label)) { token = "路"; kicker = "Route"; }
      return `
        <div class="${className} ${className}--placeholder">
          <div class="media-placeholder">
            <span class="media-placeholder-token">${escapeHtml(token)}</span>
            <span class="media-placeholder-kicker">${escapeHtml(kicker)}</span>
            <span class="media-placeholder-label">${escapeHtml(label)}</span>
          </div>
        </div>
      `;
    }
    return `<div class="${className}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" /></div>`;
  }

  function buildRecommendations() {
    const configs = [
      { id: "rec-flowers", theme: "flowers", duration: 45, style: "balanced", title: "春花盛开线", tag: "适合第一次打开地图时体验" },
      { id: "rec-photo", theme: "photo", duration: 60, style: "balanced", title: "出片漫游线", tag: "建筑同框、停留拍照更友好" },
      { id: "rec-shade", theme: "flowers", duration: 30, style: "shade", title: "轻松避晒线", tag: "适合午后快速走一圈" },
      { id: "rec-landmark", theme: "landmarks", duration: 45, style: "rest", title: "地标慢逛线", tag: "边走边看经典建筑与校园春景" },
    ];
    const usedCoverIds = new Set();
    state.recommendations = configs.map((item) => {
      const points = buildRoute(item.theme, item.duration, item.style, parseIntent(""));
      const coverPoint = points.find((point) => getNodeImage(point) && !usedCoverIds.has(point.id)) || points[1] || points[0] || routeNodes[0];
      if (coverPoint?.id) usedCoverIds.add(coverPoint.id);
      return {
        ...item,
        points,
        distance: approximateRouteDistance(points),
        coverImage: getNodeImage(coverPoint),
        coverFallback: coverPoint?.name || item.title,
      };
    });
    state.activeRouteId = state.recommendations[0]?.id || null;
  }

  function getAgentNeeds(plan) {
    const needs = Array.isArray(plan?.insights?.needs) ? plan.insights.needs.filter(Boolean) : [];
    if (needs.length) return needs;
    const fallback = [];
    if (plan?.userIntent) fallback.push(`原始需求：${plan.userIntent}`);
    if (plan?.totalDurationMin) fallback.push(`步行约 ${Math.round(Number(plan.totalDurationMin))} 分钟`);
    return fallback;
  }

  function getAgentReasons(plan) {
    const reasons = Array.isArray(plan?.insights?.reasons) ? plan.insights.reasons.filter(Boolean) : [];
    if (reasons.length) return reasons;
    return Array.isArray(plan?.decisionTrace) ? plan.decisionTrace.slice(0, 3) : [];
  }

  function getAgentSuggestions(plan) {
    const suggestions = Array.isArray(plan?.insights?.suggestions) ? plan.insights.suggestions.filter(Boolean) : [];
    if (suggestions.length) return suggestions;
    const lastStop = state.plannedRoute[state.plannedRoute.length - 1];
    return lastStop ? [`路线会在 ${lastStop.name} 一带收尾，可继续按地图延伸。`] : [];
  }

  function getAgentLeadSpecies(plan) {
    const stop = state.plannedRoute.find((item) => Array.isArray(item.species) && item.species.length) || state.plannedRoute.find((item) => splitPlants(item.plants).length);
    return (Array.isArray(stop?.species) && stop.species[0]) || splitPlants(stop?.plants)[0] || state.selectedFlowerSpecies || "春花";
  }

  function truncateText(text, maxLength) {
    const safe = String(text || "").replace(/\s+/g, " ").trim();
    if (safe.length <= maxLength) return safe;
    return `${safe.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function taskLabel(task) {
    const map = {
      scene_profile: "场景语义",
      flower_filter: "花点筛选",
      poi_search: "POI 搜索",
      target_resolution: "目标解析",
      reverse_geocode: "起点语义",
      route_planning: "步行规划",
    };
    return map[task] || task;
  }

  function summarizeRouterSearch(search) {
    if (!search) return "";
    const purpose = search.purpose === "lunch" ? "午餐检索" : search.purpose === "target" ? "目标检索" : "POI 检索";
    const around = search.around === "scene_center" ? "校园中心" : search.around === "last_scenic_stop" ? "赏花段末点" : "当前最后停靠点";
    return `${purpose}：${(search.keywords || []).join(" / ")} · 锚点 ${around}`;
  }

  function getAgentInputSummary(plan) {
    const routerInput = plan?.debug?.taskRouter?.input || {};
    const bits = [];
    if (routerInput.query) bits.push(`输入：“${routerInput.query}”`);
    if (routerInput.startPoint) bits.push(`起点：${routerInput.startPoint}`);
    if (routerInput.sceneId) bits.push(`场景：${routerInput.sceneId}`);
    return bits.join("；");
  }

  function getAgentOutputSummary(plan) {
    const routerOutput = plan?.debug?.taskRouter?.output || {};
    const taskText = Array.isArray(routerOutput.tasks) && routerOutput.tasks.length
      ? `任务：${routerOutput.tasks.map(taskLabel).join(" -> ")}`
      : "";
    const searchText = Array.isArray(routerOutput.searches) && routerOutput.searches.length
      ? `检索：${routerOutput.searches.map(summarizeRouterSearch).filter(Boolean).join("；")}`
      : "";
    const reasonText = Array.isArray(routerOutput.reasoning) && routerOutput.reasoning.length
      ? `判断：${routerOutput.reasoning.join("；")}`
      : "";
    return [taskText, searchText, reasonText].filter(Boolean).join("。");
  }

  function summarizePoiSelection(selection) {
    const candidates = Array.isArray(selection?.candidates) ? selection.candidates : [];
    const candidateNames = candidates.slice(0, 5).map((item) => item.name).filter(Boolean).join("、");
    const recallText = candidates.length
      ? `围绕“${selection.query}”召回 ${candidates.length} 个候选：${candidateNames}`
      : `围绕“${selection.query}”暂未召回可用候选`;
    const chosenText = selection?.chosenName ? `；最终选择 ${selection.chosenName}` : "；当前没有选出稳定目标";
    const reasonText = selection?.chosenReason ? `。${selection.chosenReason}` : "";
    return `${recallText}${chosenText}${reasonText}`;
  }

  function getAgentModelBadge(plan) {
    const debug = plan?.debug;
    const model = debug?.agent?.llmModel || state.agentModel || "当前模型";
    const mode = debug?.taskRouter?.mode;
    const poiJudgeUsed = Array.isArray(debug?.poiSelections) && debug.poiSelections.some((item) => item.mode === "llm");
    if (debug?.taskRouter?.used && mode === "llm" && poiJudgeUsed) return `${model} 已参与任务路由与 POI 裁决`;
    if (debug?.taskRouter?.used && mode === "llm") return `${model} 已成功参与任务路由`;
    if (debug?.taskRouter?.used && mode === "heuristic") {
      if (poiJudgeUsed) return `${model} 当前使用规则路由，并由模型参与 POI 裁决`;
      return `${model} 当前使用规则路由`;
    }
    if (poiJudgeUsed) return `${model} 已参与 POI 候选裁决`;
    return state.agentStrategy || "规则解析 + 地图工具";
  }

  function buildAgentScrollerCards() {
    const plan = state.agentPlanPayload;
    if (!plan) return [];
    const leadSpecies = getAgentLeadSpecies(plan);
    const toolNames = Array.isArray(plan.toolCalls) ? plan.toolCalls.map((item) => item.tool) : [];
    const summaryCards = [
      {
        className: "recommend-card recommend-card--agent-summary",
        title: "用户需求",
        desc: getAgentNeeds(plan).join("；"),
        meta: [plan.userIntent || "自然语言请求", `${state.plannedRoute.length} 个停靠点`],
        image: buildSemanticCover("need", "用户需求"),
        fallback: "需求",
      },
      {
        className: "recommend-card recommend-card--agent-summary",
        title: "Agent 输入",
        desc: getAgentInputSummary(plan) || "当前没有拿到结构化输入摘要。",
        meta: [getAgentModelBadge(plan)],
        image: buildSemanticCover("reason", "Agent 输入"),
        fallback: "输入",
      },
      {
        className: "recommend-card recommend-card--agent-summary",
        title: "路由输出",
        desc: getAgentOutputSummary(plan) || "当前没有拿到结构化任务输出。",
        meta: [plan?.debug?.taskRouter?.mode === "llm" ? "LLM Router" : "Heuristic Fallback"],
        image: buildSemanticCover("tool", "路由输出"),
        fallback: "输出",
      },
      {
        className: "recommend-card recommend-card--agent-summary",
        title: "工具与建议",
        desc: getAgentSuggestions(plan).join("；"),
        meta: toolNames.length ? toolNames.slice(0, 4) : ["Agent", state.agentMapProviderLabel || "地图服务"],
        image: buildSemanticCover("tool", "工具与建议"),
        fallback: "工具",
      },
    ];
    const stopCards = state.plannedRoute.map((node, index) => {
      const segment = Array.isArray(plan.segments) ? plan.segments[index] : null;
      return {
        className: `recommend-card recommend-card--agent-stop ${node.id === state.selectedCoreId ? "is-active" : ""}`,
        stopId: node.id,
        title: `${index + 1}. ${node.name}`,
        desc: segment?.objective || node.reason || getNodeDescription(node),
        meta: [
          segment?.distanceText || `${node.stayMinutes || 10} 分钟停留`,
          segment?.durationText || `拍照 ${node.photoScore || 76}`,
        ],
        image: getNodeImage(node),
        fallback: node.name,
      };
    });
    return [...summaryCards, ...stopCards];
  }

  function renderRecommendationCard(item) {
    return `
      <article class="${escapeHtml(item.className || "recommend-card")}"${item.routeId ? ` data-route-id="${escapeHtml(item.routeId)}"` : ""}${item.stopId ? ` data-stop-id="${escapeHtml(item.stopId)}"` : ""}>
        ${renderMedia(item.image, item.title, "recommend-cover", item.fallback || item.title)}
        <div class="recommend-top">
          <div>
            <p class="section-kicker">${escapeHtml(item.kicker || "AI Route")}</p>
            <h3>${escapeHtml(item.title)}</h3>
          </div>
          ${item.tag ? `<span class="recommend-tag">${escapeHtml(item.tag)}</span>` : ""}
        </div>
        ${Array.isArray(item.meta) && item.meta.length ? `<div class="recommend-meta">${item.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>` : ""}
        <p class="recommend-points">${escapeHtml(item.desc || "")}</p>
        ${item.extra ? `<p class="recommend-points">${escapeHtml(item.extra)}</p>` : ""}
      </article>
    `;
  }

  function renderRecommendations() {
    if (state.agentPlanPayload) {
      if (els.dockKicker) els.dockKicker.textContent = "Agent Result";
      if (els.dockTitle) els.dockTitle.textContent = state.agentPlanPayload.routeTitle || "AI 为你整理的路线";
      if (els.dockTip) els.dockTip.textContent = "先看需求解析，再点具体停靠点";
      stopRecommendationAutoplay();
      els.recommendScroller.classList.remove("is-auto-rolling");
      els.recommendScroller.innerHTML = buildAgentScrollerCards().map(renderRecommendationCard).join("");
      return;
    }
    if (els.dockKicker) els.dockKicker.textContent = "Today Picks";
    if (els.dockTitle) els.dockTitle.textContent = "今日推荐";
    if (els.dockTip) els.dockTip.textContent = "横向滑动查看不同路线";
    state.recommendAutoDirection = 1;
    els.recommendScroller.innerHTML = state.recommendations.map((item) => renderRecommendationCard({
      className: `recommend-card ${item.id === state.activeRouteId ? "is-active" : ""}`,
      routeId: item.id,
      kicker: ROUTE_MODE_LABELS[item.theme],
      title: item.title,
      tag: `${item.duration} 分钟`,
      meta: [`${item.distance.toFixed(2)} km`, styleText(item.style)],
      desc: item.tag,
      extra: item.points.map((point) => point.name).join(" · "),
      image: item.coverImage,
      fallback: item.coverFallback || item.title,
    })).join("");
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(startRecommendationAutoplay);
  }

  function renderRouteSummary() {
    const distance = state.routeMetrics ? `${state.routeMetrics.distanceKm.toFixed(2)} km` : `${approximateRouteDistance(state.plannedRoute).toFixed(2)} km（连线估算）`;
    const duration = state.routeMetrics ? `${state.routeMetrics.durationMin} 分钟步行` : `约 ${Math.max(1, Math.round(approximateRouteDistance(state.plannedRoute) * 1000 / 75))} 分钟（示意）`;
    els.routeDistance.textContent = distance;
    els.routeDuration.textContent = duration;
    if (state.agentPlanPayload?.summary) {
      const toolText = Array.isArray(state.agentPlanPayload.toolCalls) ? state.agentPlanPayload.toolCalls.map((item) => item.tool).slice(0, 4).join(" · ") : "";
      els.routeSummary.textContent = `${state.agentPlanPayload.summary}${toolText ? ` 已调用 ${toolText}。` : ""}`;
      return;
    }
    const bits = [];
    if (state.intentSignals.species) bits.push(`${state.intentSignals.species}优先`);
    if (state.intentSignals.color === "pink") bits.push("粉色花系");
    if (state.intentSignals.wantsLunch) bits.push("中途午餐");
    if (state.intentSignals.targetNodeName) bits.push(`${state.intentSignals.targetNodeName}收尾`);
    bits.push(ROUTE_MODE_LABELS[state.selectedTheme]);
    bits.push(styleText(state.selectedStyle));
    bits.push(`${state.selectedDuration} 分钟`);
    const plannerName = config.AGENT_API_BASE_URL ? "AI 漫游助手" : "演示规划器";
    const prefix = state.selectedIntent ? `${plannerName}已识别“${state.selectedIntent}”` : `${plannerName}已按当前偏好重排路线`;
    els.routeSummary.textContent = `${prefix}，会从 ${getCurrentStartLabel()} 出发，并根据 ${bits.join(" · ")} 优先串联 ${state.plannedRoute.map((node) => node.name).join(" · ") || "清华春季点位"}。`;
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function buildAgentBaseUrls() {
    const configuredBase = String(config.AGENT_API_BASE_URL || "").trim().replace(/\/$/, "");
    const pageProtocol = window.location.protocol === "https:" ? "https:" : "http:";
    const pageHost = window.location.hostname || "localhost";
    const currentOriginPort = configuredBase.match(/:(\d+)$/)?.[1] || "9000";
    const candidates = [configuredBase];
    if (configuredBase.includes("127.0.0.1")) candidates.push(configuredBase.replace("127.0.0.1", "localhost"));
    if (configuredBase.includes("localhost")) candidates.push(configuredBase.replace("localhost", "127.0.0.1"));
    candidates.push(`${pageProtocol}//localhost:${currentOriginPort}`);
    candidates.push(`${pageProtocol}//127.0.0.1:${currentOriginPort}`);
    if (pageHost && pageHost !== "localhost" && pageHost !== "127.0.0.1") candidates.push(`${pageProtocol}//${pageHost}:${currentOriginPort}`);
    return uniqueStrings(candidates.map((item) => item.replace(/\/$/, "")));
  }

  async function fetchAgentJson(path, options) {
    const baseCandidates = [state.activeAgentBaseUrl, ...buildAgentBaseUrls()].filter(Boolean);
    let lastError = null;
    state.agentTriedUrls = uniqueStrings(baseCandidates);
    for (const baseUrl of uniqueStrings(baseCandidates)) {
      try {
        const response = await fetch(`${baseUrl}${path}`, options);
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `${path} ${response.status}`);
        state.activeAgentBaseUrl = baseUrl;
        state.agentLastError = "";
        return { baseUrl, payload, response };
      } catch (error) {
        lastError = error;
      }
    }
    state.agentLastError = lastError instanceof Error ? lastError.message : String(lastError || "agent unavailable");
    throw lastError || new Error("agent unavailable");
  }

  function renderAgentConnection() {
    if (!els.agentConnection) return;
    const configuredBase = String(config.AGENT_API_BASE_URL || "").trim();
    const baseUrl = state.activeAgentBaseUrl || configuredBase;
    els.agentConnection.classList.remove("is-online", "is-offline");
    if (!configuredBase) {
      els.agentConnection.textContent = "演示模式：按花卉、时长和休息偏好生成路线，展示点位连线与距离估算。";
      els.agentConnection.classList.add("is-offline");
      return;
    }
    if (state.agentAvailable === null) {
      const tried = state.agentTriedUrls.length ? `，准备尝试 ${state.agentTriedUrls.join(" / ")}` : "";
      els.agentConnection.textContent = `正在检测 Agent 服务：${baseUrl}${tried}`;
      return;
    }
    if (state.agentAvailable) {
      const mode = state.agentModel ? ` · ${state.agentModel}` : state.agentStrategy ? ` · ${state.agentStrategy}` : "";
      const provider = state.agentMapProviderLabel ? ` · ${state.agentMapProviderLabel}` : "";
      const detail = state.agentStrategy === "LLM + 地图工具" ? "当前会先进行任务路由，再在召回的 POI 候选中做二次判别。" : "当前会按规则解析需求，再决定调用哪些地图工具。";
      els.agentConnection.textContent = `Agent 服务在线：${baseUrl}${mode}${provider}。${detail}`;
      els.agentConnection.classList.add("is-online");
      return;
    }
    const tried = state.agentTriedUrls.length ? ` 已尝试：${state.agentTriedUrls.join(" / ")}。` : " ";
    const reason = state.agentLastError ? `最后一次错误：${state.agentLastError}。` : "";
    els.agentConnection.textContent = `Agent 服务暂不可达：${baseUrl}。${tried}${reason}。`;
    els.agentConnection.classList.add("is-offline");
  }

  function renderAgentPlan() {
    const chips = state.intentChips.length ? state.intentChips : ["春花盛开", "观赏与拍照兼顾", "45 分钟"];
    const visibleSteps = Number.isFinite(state.agentVisibleStepCount) ? state.agentPlanSteps.slice(0, state.agentVisibleStepCount) : state.agentPlanSteps;
    els.intentChips.innerHTML = chips.map((chip) => `<span class="intent-chip"><b>·</b>${escapeHtml(chip)}</span>`).join("");
    els.agentPlan.innerHTML = visibleSteps.map((step, index) => `
      <article class="plan-step" data-step="${index + 1}">
        <div class="plan-step-top">
          <h4>${escapeHtml(step.title)}</h4>
          <span class="plan-step-tool">${escapeHtml(step.tool)}</span>
        </div>
        <p class="plan-step-copy">${escapeHtml(step.description)}</p>
        <div class="plan-step-meta">${(step.meta || []).map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>
      </article>
    `).join("");
  }

  function stopAgentPlanPlayback() {
    if (state.agentPlanTimer) {
      clearInterval(state.agentPlanTimer);
      state.agentPlanTimer = null;
    }
  }

  function stopAgentThinking() {
    if (state.agentThinkingTimer) {
      clearInterval(state.agentThinkingTimer);
      state.agentThinkingTimer = null;
    }
    state.agentThinkingStartedAt = 0;
  }

  function formatThinkingElapsed(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${safe}s`;
  }

  function startAgentThinking() {
    stopAgentThinking();
    stopAgentPlanPlayback();
    state.agentThinkingStartedAt = Date.now();
    const tick = () => {
      const elapsedSeconds = Math.floor((Date.now() - state.agentThinkingStartedAt) / 1000);
      const elapsedText = formatThinkingElapsed(elapsedSeconds);
      state.intentChips = [state.agentModel || "模型", `已思考 ${elapsedText}`, "等待任务路由与 POI 裁决"];
      state.agentPlanSteps = [
        {
          tool: state.agentModel || "当前模型",
          title: "AI 正在思考中",
          description: `正在理解“${state.selectedIntent}”，并执行任务路由与 POI 候选判别，已耗时 ${elapsedText}。`,
          meta: [state.customStartQuery ? `起点：${getCurrentStartLabel()}` : "默认校园起点", "请稍候"],
        },
      ];
      state.agentVisibleStepCount = null;
      renderAgentPlan();
      updateMapStatus(`AI 正在思考中，已耗时 ${elapsedText}，正在等待任务路由与 POI 裁决结果。`);
      if (els.routeSummary) els.routeSummary.textContent = `AI 正在思考中，已耗时 ${elapsedText}，`;
      if (els.routeDistance) els.routeDistance.textContent = "等待中";
      if (els.routeDuration) els.routeDuration.textContent = `已等待 ${elapsedText}`;
    };
    tick();
    state.agentThinkingTimer = window.setInterval(tick, 1000);
  }

  function playAgentPlanSteps(steps) {
    stopAgentThinking();
    stopAgentPlanPlayback();
    state.agentPlanSteps = steps;
    state.agentVisibleStepCount = 0;
    renderAgentPlan();
    if (!steps.length) {
      state.agentVisibleStepCount = null;
      return;
    }
    state.agentPlanTimer = setInterval(() => {
      state.agentVisibleStepCount += 1;
      renderAgentPlan();
      if (state.agentVisibleStepCount >= state.agentPlanSteps.length) {
        stopAgentPlanPlayback();
        state.agentVisibleStepCount = null;
        renderAgentPlan();
      }
    }, 520);
  }

  function buildAgentChipsFromPayload(plan) {
    const chips = [];
    if (plan?.totalDistanceKm) chips.push(`${Number(plan.totalDistanceKm).toFixed(2)} km`);
    if (plan?.totalDurationMin) chips.push(`${Math.round(Number(plan.totalDurationMin))} 分钟`);
    if (plan?.debug?.taskRouter?.mode === "llm") chips.push("模型路由");
    else if (plan?.debug?.taskRouter?.used) chips.push("规则回退");
    if (Array.isArray(plan?.debug?.poiSelections) && plan.debug.poiSelections.some((item) => item.mode === "llm")) chips.push("POI 二次判别");
    if (Array.isArray(plan?.toolCalls)) chips.push(...plan.toolCalls.slice(0, 3).map((item) => item.tool));
    return uniqueById(chips.map((chip, index) => ({ id: `chip-${index}-${chip}`, label: chip }))).map((item) => item.label);
  }

  function buildAgentStepsFromPayload(plan) {
    const debug = plan?.debug || {};
    const routerInput = debug.taskRouter?.input;
    const routerOutput = debug.taskRouter?.output;
    const steps = [];
    if (routerInput?.query) {
      steps.push({
        tool: debug.agent?.llmModel || (debug.agent?.llmConfigured ? "LLM" : "Rules"),
        title: "接收用户输入",
        description: [routerInput.query ? `原始请求：${routerInput.query}` : "", routerInput.startPoint ? `起点：${routerInput.startPoint}` : ""].filter(Boolean).join("；"),
        meta: [debug.agent?.strategy === "llm+tools" ? "LLM + Tools" : "Rules + Tools", routerInput.sceneId].filter(Boolean),
      });
    }
    if (routerOutput?.tasks?.length || routerOutput?.searches?.length || routerOutput?.reasoning?.length) {
      const routerError = String(debug.taskRouter?.error || "");
      steps.push({
        tool: debug.taskRouter?.mode === "llm" ? (debug.agent?.llmModel || "LLM") : "Rules",
        title: debug.taskRouter?.mode === "llm" ? "输出任务路由" : "规则任务路由",
        description: getAgentOutputSummary(plan) || "当前没有拿到结构化任务路由输出。",
        meta: [
          ...(Array.isArray(routerOutput?.tasks) ? routerOutput.tasks.map(taskLabel).slice(0, 4) : []),
          debug.taskRouter?.error ? `error: ${truncateText(debug.taskRouter.error, 48)}` : "",
        ].filter(Boolean),
      });
    }
    if (debug.taskRouter?.rawResponse) {
      steps.push({
        tool: "Router JSON",
        title: "模型结构化输出",
        description: truncateText(debug.taskRouter.rawResponse, 240),
        meta: [debug.taskRouter?.mode === "llm" ? "raw llm output" : "rule note"].filter(Boolean),
      });
    }
    const resolutionBits = [];
    if (debug.resolutions?.start?.resolvedName) resolutionBits.push(`起点：${debug.resolutions.start.query || debug.resolutions.start.resolvedName} -> ${debug.resolutions.start.resolvedName}`);
    if (debug.resolutions?.target?.resolvedName) resolutionBits.push(`目标：${debug.resolutions.target.query || debug.resolutions.target.resolvedName} -> ${debug.resolutions.target.resolvedName}`);
    if (debug.resolutions?.lunch?.resolvedName && debug.resolutions?.lunch?.resolvedName !== debug.resolutions?.target?.resolvedName) resolutionBits.push(`午餐：${debug.resolutions.lunch.query || debug.resolutions.lunch.resolvedName} -> ${debug.resolutions.lunch.resolvedName}`);
    if (resolutionBits.length) {
      steps.push({
        tool: "Resolution",
        title: "解析起点与目标",
        description: resolutionBits.join("；"),
        meta: [
          debug.resolutions?.start?.resolvedBy,
          debug.resolutions?.target?.resolvedBy,
          debug.resolutions?.lunch?.resolvedBy,
        ].filter(Boolean),
      });
    }
    if (Array.isArray(debug?.poiSelections) && debug.poiSelections.length) {
      steps.push(...debug.poiSelections.map((selection) => ({
        tool: selection.mode === "llm" ? (debug.agent?.llmModel || "LLM") : "Heuristic",
        title: selection.phase === "lunch" ? "POI 候选判别：午餐补给" : selection.phase === "start" ? "POI 候选判别：起点解析" : "POI 候选判别：目标点位",
        description: summarizePoiSelection(selection),
        meta: [
          selection.anchorName ? `anchor: ${selection.anchorName}` : "",
          selection.mode === "llm" ? "llm rerank" : "heuristic rerank",
          selection.error ? `error: ${truncateText(selection.error, 42)}` : "",
        ].filter(Boolean),
      })));
    }
    const traces = Array.isArray(plan?.decisionTrace)
      ? plan.decisionTrace.filter((trace) => !/^按你指定的起点|^已把自定义起点命中|^暂未精确命中起点/.test(String(trace || "")))
      : [];
    const tools = Array.isArray(plan?.toolCalls)
      ? plan.toolCalls.filter((item) => item.tool !== "task_router")
      : [];
    if (traces.length) {
      steps.push(...traces.map((trace, index) => ({
        tool: tools[index]?.tool || `Tool ${index + 1}`,
        title: tools[index]?.purpose || `规划步骤 ${index + 1}`,
        description: trace,
        meta: [tools[index]?.purpose].filter(Boolean),
      })));
      return steps;
    }
    steps.push(...tools.map((item, index) => ({
      tool: item.tool,
      title: item.purpose || `工具调用 ${index + 1}`,
      description: item.purpose || `${item.tool} 已执行`,
      meta: [item.tool].filter(Boolean),
    })));
    return steps;
  }

  async function requestAgentPlan() {
    if (!String(config.AGENT_API_BASE_URL || "").trim()) throw new Error("agent api missing");
    const startPoint = getSubmittedStartPoint();
    const { payload } = await fetchAgentJson("/demo/route-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: state.selectedIntent,
        sceneId: "tsinghua-spring",
        durationMinutes: state.selectedDuration,
        style: state.selectedStyle,
        theme: state.selectedTheme,
        startPoint,
      }),
    });
    if (!payload?.ok || !payload?.plan) throw new Error(payload?.error || "agent planning failed");
    return payload.plan;
  }

  async function checkAgentAvailability() {
    const configuredBase = String(config.AGENT_API_BASE_URL || "").trim().replace(/\/$/, "");
    if (!configuredBase) {
      state.agentAvailable = false;
      state.agentModel = "";
      state.agentStrategy = "";
      state.agentMapProviderLabel = "";
      state.activeAgentBaseUrl = "";
      state.agentLastError = "";
      state.agentTriedUrls = [];
      renderAgentConnection();
      return;
    }
    state.agentAvailable = null;
    state.agentModel = "";
    state.agentStrategy = "";
    state.agentMapProviderLabel = "";
    renderAgentConnection();
    try {
      const { payload, baseUrl } = await fetchAgentJson("/healthz");
      state.agentAvailable = Boolean(payload?.ok);
      state.activeAgentBaseUrl = baseUrl;
      state.agentModel = payload?.model ? String(payload.model) : "";
      state.agentStrategy = payload?.strategy === "llm+tools" ? "LLM + 地图工具" : "规则解析 + 地图工具";
      state.agentMapProviderLabel = payload?.mapProvider === "baidu" ? "百度地图" : payload?.mapProvider === "tencent" ? "腾讯地图" : "";
    } catch (error) {
      console.warn("agent health check failed", error);
      state.agentAvailable = false;
      state.agentModel = "";
      state.agentStrategy = "";
      state.agentMapProviderLabel = "";
      state.activeAgentBaseUrl = "";
    }
    renderAgentConnection();
  }

  function applyAgentPlan(plan) {
    const stops = (Array.isArray(plan?.segments) ? plan.segments : [])
      .flatMap((segment) => Array.isArray(segment?.stops) ? segment.stops : [])
      .map((stop, index) => normalizeRouteStop(stop, index))
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
    if (!stops.length) throw new Error("agent plan missing stops");
    state.agentPlanPayload = plan;
    state.agentAvailable = true;
    state.intentChips = buildAgentChipsFromPayload(plan);
    playAgentPlanSteps(buildAgentStepsFromPayload(plan));
    state.plannedRoute = uniqueById(stops);
    state.activeRouteId = null;
    state.selectedCoreId = state.plannedRoute[0]?.id || state.selectedCoreId;
    const polyline = Array.isArray(plan?.mapOverlays?.polylines?.[0]?.coordinates) ? plan.mapOverlays.polylines[0].coordinates : [];
    state.realRoutePath = polyline
      .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (!state.realRoutePath.length) state.realRoutePath = [getCurrentStartPoint(), ...state.plannedRoute];
    const distanceKm = Number(plan?.totalDistanceKm);
    const durationMin = Number(plan?.totalDurationMin);
    state.routeMetrics = Number.isFinite(distanceKm) && Number.isFinite(durationMin)
      ? { distanceKm, durationMin }
      : null;
    renderAgentConnection();
    renderRouteSummary();
    renderAgentPlan();
    renderRecommendations();
    setActiveView("recommend");
    updateMapStatus(`${plan?.debug?.taskRouter?.mode === "llm" ? "模型已完成任务路由" : "当前按规则任务路由完成规划"}，路线已按 ${state.plannedRoute.map((node) => node.name).join(" · ")} 回填到地图。`);
  }

  function getPanelData() {
    if (state.activeView === "flowers") {
      const current = state.selectedFlowerSpecies || flowerSummary[0]?.species || "樱花";
      const summary = getFlowerSummary(current) || flowerSummary[0];
      return {
        previewKicker: "Selected Flower",
        previewTitle: current,
        feature: {
          kicker: "花卉预览",
          title: current,
          description: `当前已记录 ${summary?.count || 0} 个点位，地图中会用专属花卉图标高亮这类花。`,
          meta: [`${summary?.count || 0} 个点位`, "专属花标识", "点击继续筛选"],
          image: getSpeciesCover(current),
          fallback: current,
        },
        kicker: "Flower Library",
        title: "花卉地图列表",
        items: flowerSummary.map((item) => ({ kind: "flower", id: item.species, title: item.species, desc: `已记录 ${item.count} 个春季点位，点击后可在地图上高亮。`, meta: [`${item.count} 个点`, "花况地图"], image: getSpeciesCover(item.species), selected: normalizeSpecies(item.species) === normalizeSpecies(current) })),
      };
    }

    if (state.activeView === "recommend") {
      const selected = findCurrentPoint(state.selectedCoreId) || state.plannedRoute[0] || routeNodes[0];
      if (state.agentPlanPayload) {
        const plan = state.agentPlanPayload;
        return {
          previewKicker: "Selected Stop",
          previewTitle: selected?.name || "当前路线停靠点",
          feature: {
            kicker: "实景预览",
            title: selected?.name || "当前路线停靠点",
            description: selected ? `${selected.reason || getNodeDescription(selected)} ` : "点击路线点位后，这里会显示当前停靠点的实景图。",
            meta: [
              plan.routeTitle || "AI 路线",
              state.routeMetrics ? `${state.routeMetrics.distanceKm.toFixed(2)} km` : `${approximateRouteDistance(state.plannedRoute).toFixed(2)} km（连线估算）`,
              state.routeMetrics ? `${state.routeMetrics.durationMin} 分钟步行` : `${state.selectedDuration} 分钟建议时长`,
            ],
            image: getNodeImage(selected),
            fallback: selected?.name || "AI 路线",
          },
          kicker: "Agent Result",
          title: "路线停靠点",
          items: state.plannedRoute.map((node, index) => ({
            kind: "spot",
            id: node.id,
            title: `${index + 1}. ${node.name}`,
            desc: node.reason || getNodeDescription(node),
            meta: [
              (node.tags || []).includes("lunch") ? "午餐补给" : `停留 ${node.stayMinutes || 10} 分钟`,
              Array.isArray(node.species) && node.species[0] ? node.species[0] : (splitPlants(node.plants)[0] || "春日点位"),
            ],
            image: getNodeImage(node),
            selected: node.id === state.selectedCoreId,
          })),
        };
      }
      return {
        previewKicker: "Selected Stop",
        previewTitle: selected?.name || "当前路线停靠点",
        feature: {
          kicker: "实景预览",
          title: selected?.name || "当前路线停靠点",
          description: selected ? `${getNodeDescription(selected)} ` : "点击路线点位后，这里会显示当前停靠点的实景图。",
          meta: [
            state.routeMetrics ? `${state.routeMetrics.distanceKm.toFixed(2)} km` : `${approximateRouteDistance(state.plannedRoute).toFixed(2)} km（连线估算）`,
            state.routeMetrics ? `${state.routeMetrics.durationMin} 分钟步行` : `${state.selectedDuration} 分钟建议时长`,
            styleText(state.selectedStyle),
          ],
          image: getNodeImage(selected),
          fallback: selected?.name || "今日路线",
        },
        kicker: "Today Picks",
        title: "今日推荐路线",
        items: state.plannedRoute.map((node, index) => ({
          kind: "spot",
          id: node.id,
          title: `${index + 1}. ${node.name}`,
          desc: getNodeDescription(node),
          meta: [
            (node.tags || []).includes("lunch") ? "午餐补给" : `停留 ${node.stayMinutes || 10} 分钟`,
            node.id === state.intentSignals.targetNodeId ? "终点收尾" : `拍照 ${node.photoScore}`,
          ],
          image: getNodeImage(node),
          selected: node.id === state.selectedCoreId,
        })),
      };
    }
    if (state.activeView === "updates") {
      const selected = dailyFeed.find((item) => item.id === state.selectedUpdateId) || dailyFeed[0];
      return {
        previewKicker: selected?.tag || "Daily Feed",
        previewTitle: selected?.locationName || selected?.title || "最新更新",
        feature: {
          kicker: "最新实拍",
          title: selected?.title || "今天的校园春意更新",
          description: selected?.description || "最新的校园实拍和花况更新已同步到地图。",
          meta: [selected?.timestamp || "今天", `${selected?.mediaCount || 1} 张图片`, selected?.tag || "日更"],
          image: selected?.image,
          fallback: "日更",
        },
        kicker: "Daily Updates",
        title: "日更动态列表",
        items: dailyFeed.map((item) => ({ kind: "update", id: item.id, title: item.title, desc: item.description, meta: [item.timestamp, `${item.mediaCount} 张`, item.tag], image: item.image, selected: item.id === state.selectedUpdateId })),
      };
    }

    const selected = findNode(state.selectedCoreId) || routeNodes[0];
    return {
      previewKicker: "Selected Spot",
      previewTitle: selected?.name || "核心打卡点",
      feature: {
        kicker: "实景预览",
        title: selected?.name || "核心打卡点",
        description: selected ? `${getNodeDescription(selected)} ` : "浏览春季点位。",
        meta: selected ? [splitPlants(selected.plants).slice(0, 2).join(" · "), `${selected.images?.length || 0} 张图片`, `拍照 ${selected.photoScore}`] : [],
        image: getNodeImage(selected),
        fallback: selected?.name || "春季点位",
      },
      kicker: "Spring Spots",
      title: "春季点位列表",
      items: routeNodes.map((node) => ({ kind: "spot", id: node.id, title: node.name, desc: getNodeDescription(node), meta: [splitPlants(node.plants).slice(0, 2).join(" · "), `图片 ${node.images?.length || 0}`], image: getNodeImage(node), selected: node.id === state.selectedCoreId })),
    };
  }

  function renderPanel() {
    const data = getPanelData();
    els.previewKicker.textContent = data.previewKicker;
    els.previewTitle.textContent = data.previewTitle;
    els.panelKicker.textContent = data.kicker;
    els.panelTitle.textContent = data.title;
    const feature = data.feature;
    els.previewContent.innerHTML = `
      <section class="panel-feature">
        ${renderMedia(feature.image, feature.title, "panel-feature-media", feature.fallback)}
        <div class="panel-feature-body">
          <p class="section-kicker">${escapeHtml(feature.kicker)}</p>
          <h3>${escapeHtml(feature.title)}</h3>
          <p class="panel-feature-copy">${escapeHtml(feature.description)}</p>
          <div class="panel-inline">${feature.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>
        </div>
      </section>
    `;
    els.panelContent.innerHTML = `
      <div class="panel-grid">
        ${data.items.map((item) => `
          <article class="panel-item ${item.selected ? "is-selected" : ""}" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(item.id)}">
            ${renderMedia(item.image, item.title, "panel-thumb", item.title)}
            <div class="panel-copy">
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.desc)}</p>
              <div class="panel-meta">${item.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>
            </div>
          </article>
        `).join("")}
      </div>
    `;
    if (els.mapPanel) els.mapPanel.classList.toggle("is-hidden", Boolean(state.agentPlanPayload) && state.activeView === "recommend");
  }

  function formatTodayTime(date) {
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `今天 ${time}`;
  }

  function updateContributionDraftUi() {
    const hasPoint = Boolean(state.contributionDraftPoint);
    els.pickedPointDisplay.textContent = formatPointText(state.contributionDraftPoint);
    els.pickedPointDisplay.classList.toggle("is-ready", hasPoint);
    els.pickOnMapBtn.textContent = state.isPickingContributionPoint ? "点击右侧地图完成选点" : "在右侧地图选点";
  }

  function updatePlannerStartUi() {
    if (!els.plannerStartDisplay || !els.pickStartOnMapBtn) return;
    els.plannerStartDisplay.textContent = formatStartPointText();
    els.plannerStartDisplay.classList.toggle("is-ready", Boolean(state.customStartQuery || hasValidPoint(state.customStartPoint)));
    els.pickStartOnMapBtn.textContent = state.isPickingStartPoint ? "点击地图完成起点选择" : "在地图上选起点";
    renderPlannerStartSuggestions();
  }

  function renderPlannerStartSuggestions() {
    if (!els.plannerStartSuggestions) return;
    const query = String(state.customStartQuery || "").trim();
    const candidates = Array.isArray(state.customStartCandidates) ? state.customStartCandidates : [];
    if (!query || !candidates.length) {
      els.plannerStartSuggestions.classList.add("is-empty");
      els.plannerStartSuggestions.innerHTML = "";
      return;
    }
    els.plannerStartSuggestions.classList.remove("is-empty");
    els.plannerStartSuggestions.innerHTML = `
      <p class="planner-start-suggestion-note">请选择一个候选地点，或直接在地图上选择起点。</p>
      <div class="planner-start-suggestion-list">
        ${candidates.map((candidate, index) => `
          <button type="button" class="planner-start-suggestion ${hasValidPoint(state.customStartPoint) && normalizePlaceName(state.customStartPoint.name) === normalizePlaceName(candidate.name) ? "is-selected" : ""}" data-start-candidate="${index}">
            <span class="planner-start-suggestion-title">${escapeHtml(candidate.name)}</span>
            <span class="planner-start-suggestion-meta">${escapeHtml(candidate.address || "已解析到可用 POI 坐标")}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function clearCustomStartPoint(options) {
    state.customStartPoint = null;
    if (!options?.keepQuery) state.customStartQuery = "";
    state.customStartSelectionQuery = "";
    state.customStartCandidates = [];
    state.isPickingStartPoint = false;
    if (!options?.keepInput && els.plannerStartInput) els.plannerStartInput.value = "";
    updatePlannerStartUi();
    refreshMapLayers({ skipFit: true });
  }

  function setCustomStartPoint(point, options) {
    if (!point) {
      clearCustomStartPoint(options);
      return;
    }
    state.customStartPoint = {
      name: point.name || els.plannerStartInput?.value.trim() || "自定义起点",
      lat: Number(point.lat),
      lng: Number(point.lng),
    };
    if (!options?.preserveQuery) state.customStartQuery = state.customStartPoint.name || "";
    state.customStartSelectionQuery = options?.selectionQuery || state.customStartQuery || state.customStartPoint.name || "";
    state.customStartCandidates = [];
    state.isPickingStartPoint = false;
    if (els.plannerStartInput && options?.syncInput !== false) els.plannerStartInput.value = state.customStartPoint.name || "";
    updatePlannerStartUi();
    refreshMapLayers({ skipFit: true });
  }

  function pickFrontPlaceCandidate(candidates, query, anchor) {
    return [...(candidates || [])]
      .map((item) => {
        const textScore = Math.max(
          scorePlaceNameMatch(query, item.name),
          scorePlaceNameMatch(query, item.address || ""),
        );
        const distanceScore = anchor ? -(getDistanceKm(anchor, item) * 1000) / 28 : 0;
        const campusBonus = /清华/.test(item.name || "") || /清华/.test(item.address || "") ? 14 : 0;
        return { item, score: textScore + distanceScore + campusBonus };
      })
      .filter((entry) => entry.score >= 26)
      .sort((a, b) => b.score - a.score)[0]?.item || null;
  }

  function rankFrontPlaceCandidates(candidates, query, anchor) {
    return [...(candidates || [])]
      .map((item) => {
        const textScore = Math.max(
          scorePlaceNameMatch(query, item.name),
          scorePlaceNameMatch(query, item.address || ""),
        );
        const distanceScore = anchor ? -(getDistanceKm(anchor, item) * 1000) / 28 : 0;
        const campusBonus = /清华/.test(item.name || "") || /清华/.test(item.address || "") ? 14 : 0;
        return { ...item, _rank: textScore + distanceScore + campusBonus };
      })
      .filter((entry) => entry._rank >= 26)
      .sort((a, b) => b._rank - a._rank)
      .slice(0, 5)
      .map(({ _rank, ...item }) => item);
  }

  async function fetchPlaceCandidates(keyword, anchor, radiusMeters) {
    if (!tencentWebServicesEnabled || !keyword) return [];
    const url = `https://apis.map.qq.com/ws/place/v1/search/?keyword=${encodeURIComponent(keyword)}&boundary=${encodeURIComponent(`nearby(${anchor.lat},${anchor.lng},${radiusMeters || 3200},1)`)}&orderby=_distance&page_size=10&page_index=1&key=${config.TENCENT_MAP_KEY}`;
    const data = await jsonp(url);
    if (!data || data.status !== 0 || !Array.isArray(data.data)) return [];
    return data.data
      .filter((item) => item?.location)
      .map((item) => ({
        name: item.title || item.name || keyword,
        address: item.address || "",
        lat: Number(item.location.lat),
        lng: Number(item.location.lng),
      }))
      .filter((item) => hasValidPoint(item));
  }

  async function resolvePlannerStartPoint() {
    const query = els.plannerStartInput?.value.trim() || "";
    state.customStartQuery = query;
    if (!query || normalizePlaceName(query) === normalizePlaceName(sceneCenter.name)) {
      clearCustomStartPoint({ keepInput: true, keepQuery: true });
      updatePlannerStartUi();
      return null;
    }
    if (
      hasValidPoint(state.customStartPoint)
      && (
        normalizePlaceName(state.customStartPoint.name) === normalizePlaceName(query)
        || (state.customStartSelectionQuery && normalizePlaceName(state.customStartSelectionQuery) === normalizePlaceName(query))
      )
    ) {
      updatePlannerStartUi();
      return state.customStartPoint;
    }
    state.customStartPoint = null;
    const suggestions = [];
    const localMatch = findNodeByKeyword(query);
    if (localMatch) {
      suggestions.push({ name: localMatch.name, address: "校园内已知春季点位", lat: localMatch.lat, lng: localMatch.lng });
    }
    try {
      const candidates = await fetchPlaceCandidates(query, sceneCenter, 3600);
      const ranked = rankFrontPlaceCandidates(candidates, query, sceneCenter);
      ranked.forEach((item) => {
        if (suggestions.some((entry) => normalizePlaceName(entry.name) === normalizePlaceName(item.name))) return;
        suggestions.push(item);
      });
    } catch (error) {
      console.warn("resolve planner start point failed", error);
    }
    state.customStartCandidates = suggestions.slice(0, 5);
    updatePlannerStartUi();
    return pickFrontPlaceCandidate(state.customStartCandidates, query, sceneCenter);
  }

  function setContributionDraftPoint(point) {
    state.contributionDraftPoint = point;
    if (point && !els.contributionLocationName.value.trim()) els.contributionLocationName.value = point.name || "";
    const nearest = findNearestNode(point);
    if (nearest) {
      state.selectedCoreId = nearest.id;
      els.contributionLinkedSpot.value = nearest.id;
    }
    updateContributionDraftUi();
    if (point) updateCommunityMapStatus(`已选中 ${point.name || "自定义点位"}，现在可以继续填写花种和开花状态。`);
    refreshMapLayers({ skipFit: true });
  }

  function stopRecommendationAutoplay() {
    if (state.recommendAutoTimer) {
      clearInterval(state.recommendAutoTimer);
      state.recommendAutoTimer = null;
    }
    if (state.recommendAutoRaf && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(state.recommendAutoRaf);
      state.recommendAutoRaf = 0;
    }
  }

  function scrollRecommendationIntoView(index) {
    const cards = [...els.recommendScroller.querySelectorAll(".recommend-card")];
    if (!cards.length) return;
    const safeIndex = ((index % cards.length) + cards.length) % cards.length;
    const card = cards[safeIndex];
    if (!card) return;
    els.recommendScroller.scrollTo({
      left: card.offsetLeft - 8,
      behavior: "smooth",
    });
  }

  function startRecommendationAutoplay() {
    stopRecommendationAutoplay();
    const cards = els.recommendScroller.querySelectorAll(".recommend-card");
    if (!cards.length || cards.length < 2) return;
    const maxScroll = els.recommendScroller.scrollWidth - els.recommendScroller.clientWidth;
    if (maxScroll <= 8) return;
    els.recommendScroller.classList.add("is-auto-rolling");
    const drift = () => {
      const limit = Math.max(0, els.recommendScroller.scrollWidth - els.recommendScroller.clientWidth);
      if (limit <= 8) return;
      let next = els.recommendScroller.scrollLeft + state.recommendAutoDirection * 0.28;
      if (next >= limit) {
        next = limit;
        state.recommendAutoDirection = -1;
      } else if (next <= 0) {
        next = 0;
        state.recommendAutoDirection = 1;
      }
      els.recommendScroller.scrollLeft = next;
      state.recommendAutoRaf = window.requestAnimationFrame(drift);
    };
    state.recommendAutoRaf = window.requestAnimationFrame(drift);
  }

  function refreshDynamicCollections() {
    rebuildSpeciesCoverMap();
    rebuildFlowerSummary();
    dailyFeed = buildDailyFeed();
    if (!getFlowerSummary(state.selectedFlowerSpecies)) state.selectedFlowerSpecies = flowerSummary[0]?.species || null;
    if (!dailyFeed.some((item) => item.id === state.selectedUpdateId)) state.selectedUpdateId = dailyFeed[0]?.id || null;
    renderHero();
    renderPanel();
    renderRecommendations();
    renderAgentPlan();
    updateContributionDraftUi();
    refreshMapLayers();
  }

  function saveCommunityContributions() {
    try {
      const communityItems = userContributions.filter((item) => item.source === "community");
      window.localStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(communityItems));
    } catch (error) {
      console.warn("save community contributions failed", error);
    }
  }

  function mergeContribution(item, shouldPersist) {
    if (!item || userContributions.some((entry) => entry.id === item.id)) return;
    userContributions.unshift(item);
    if (item.lat && item.lng && item.species) {
      flowerDisplayPoints.unshift({ species: item.species, lat: item.lat, lng: item.lng });
    }
    if (shouldPersist) saveCommunityContributions();
  }

  function restoreCommunityContributions() {
    try {
      const raw = window.localStorage.getItem(COMMUNITY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      parsed.forEach((item) => mergeContribution(item, false));
    } catch (error) {
      console.warn("restore community contributions failed", error);
    }
  }

  function populateContributionForm() {
    els.contributionLinkedSpot.innerHTML = routeNodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)}</option>`).join("");
    els.contributionSpeciesList.innerHTML = flowerSummary.map((item) => `<option value="${escapeHtml(item.species)}"></option>`).join("");
    if (state.selectedCoreId) els.contributionLinkedSpot.value = state.selectedCoreId;
    if (!els.contributionSpecies.value && state.selectedFlowerSpecies) els.contributionSpecies.value = normalizeSpecies(state.selectedFlowerSpecies);
    updateContributionDraftUi();
    updatePlannerStartUi();
  }

  function submitContribution() {
    const linkedSpot = findNode(els.contributionLinkedSpot.value) || routeNodes[0];
    const basePoint = state.contributionDraftPoint || linkedSpot;
    const species = normalizeSpecies(els.contributionSpecies.value) || "春花";
    const bloomStage = els.contributionBloom.value;
    const imageUrl = els.contributionImage.value.trim();
    const locationName = els.contributionLocationName.value.trim() || state.contributionDraftPoint?.name || linkedSpot?.name || "自定义观测点";
    const note = els.contributionNote.value.trim() || `${locationName} 的 ${species} 已更新为 ${bloomStage}。`;
    const createdAt = new Date().toISOString();
    const contribution = {
      id: `community-${Date.now()}`,
      type: "phenology",
      source: "community",
      user: "校园观察员",
      relatedId: linkedSpot?.id || null,
      timestamp: formatTodayTime(new Date(createdAt)),
      title: `${locationName} 的 ${species} ${bloomStage}`,
      note,
      mediaCount: imageUrl ? 1 : 0,
      routeTag: "用户共建",
      species,
      bloomStage,
      bloomScore: BLOOM_STAGE_SCORE[bloomStage] || 80,
      imageUrl,
      lat: basePoint?.lat,
      lng: basePoint?.lng,
      locationName,
      createdAt,
    };
    mergeContribution(contribution, true);
    state.selectedUpdateId = contribution.id;
    state.selectedFlowerSpecies = species;
    state.selectedCoreId = linkedSpot?.id || state.selectedCoreId;
    refreshDynamicCollections();
    populateContributionForm();
    els.contributionImage.value = "";
    els.contributionNote.value = "";
    els.contributionLocationName.value = locationName;
    setActiveView("updates");
    updateMapStatus(`已收到一条来自用户共建的 ${species} 花况更新，并同步到地图与日更动态。`);
    updateCommunityMapStatus(`已提交 ${locationName} 的 ${species} 更新，地图和推荐内容已同步刷新。`);
  }

  const MARKERS = {
    core: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56"><path d="M22 52s14-14.2 14-26C36 15 29.7 8 22 8S8 15 8 26c0 11.8 14 26 14 26Z" fill="#fff7fb" stroke="#e1518b" stroke-width="3"/><circle cx="22" cy="26" r="7" fill="#e1518b"/></svg>'),
    selected: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="62" viewBox="0 0 50 62"><path d="M25 58s16-16 16-29C41 16.3 33.8 9 25 9S9 16.3 9 29c0 13 16 29 16 29Z" fill="#fff7fb" stroke="#9b1f52" stroke-width="3.2"/><circle cx="25" cy="29" r="8.6" fill="#9b1f52"/><circle cx="25" cy="29" r="3.5" fill="#fff7fb"/></svg>'),
    report: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58"><path d="M24 54s15-15.4 15-28.2C39 14.5 32.3 8 24 8S9 14.5 9 25.8C9 38.6 24 54 24 54Z" fill="#fffaf7" stroke="#c85d38" stroke-width="3"/><circle cx="24" cy="25.5" r="7.3" fill="#c85d38"/><circle cx="24" cy="25.5" r="2.5" fill="#fffaf7"/></svg>'),
    start: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="62" viewBox="0 0 50 62"><path d="M25 58s16-16 16-29C41 16.3 33.8 9 25 9S9 16.3 9 29c0 13 16 29 16 29Z" fill="#fffef8" stroke="#ff9b33" stroke-width="3.2"/><circle cx="25" cy="29" r="8.6" fill="#ff9b33"/><text x="25" y="33" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#fffef8">起</text></svg>'),
  };

  const FLOWER_MARKER_META = {
    樱花: { label: "樱", fill: "#f8b8d2", stroke: "#c43b78" },
    玉兰: { label: "玉", fill: "#f7e9c2", stroke: "#c89e39" },
    白玉兰: { label: "玉", fill: "#fff7ea", stroke: "#b89c74" },
    桃花: { label: "桃", fill: "#ffb1c5", stroke: "#c84f79" },
    山桃: { label: "桃", fill: "#ff9ec0", stroke: "#b93d6a" },
    垂丝海棠: { label: "棠", fill: "#f59bbb", stroke: "#b13f73" },
    紫叶李: { label: "李", fill: "#dba7e6", stroke: "#8c50a9" },
    连翘: { label: "翘", fill: "#ffe27b", stroke: "#c79300" },
    梨花: { label: "梨", fill: "#f1f4f8", stroke: "#7c91a3" },
  };

  function buildFlowerMarkerMeta(species) {
    const normalized = normalizeSpecies(species) || "花";
    if (FLOWER_MARKER_META[normalized]) return FLOWER_MARKER_META[normalized];
    const palette = [
      { fill: "#ffd0df", stroke: "#c34d7a" },
      { fill: "#ffe6a8", stroke: "#b8860b" },
      { fill: "#d7c6ff", stroke: "#7f55c7" },
      { fill: "#cdecd8", stroke: "#3d8b61" },
    ];
    const chars = Array.from(normalized);
    const index = chars.reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
    return {
      label: chars[0] || "花",
      ...palette[index],
    };
  }

  function getFlowerStyleKey(species, selected) {
    const key = Array.from(normalizeSpecies(species) || "default").map((char) => char.charCodeAt(0).toString(16)).join("-");
    return `${selected ? "flower-selected" : "flower"}-${key}`;
  }

  function buildFlowerMarkerSvg(species, selected) {
    const meta = buildFlowerMarkerMeta(species);
    const fill = selected ? meta.stroke : meta.fill;
    const stroke = selected ? "#6d1b3f" : meta.stroke;
    const textColor = selected ? "#fff8fb" : "#4f2337";
    return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54"><path d="M22 50s13-13.2 13-24.4C35 15.7 29.2 9 22 9S9 15.7 9 25.6C9 36.8 22 50 22 50Z" fill="${fill}" stroke="${stroke}" stroke-width="2.8"/><circle cx="22" cy="24.5" r="9.4" fill="#fff7fb" opacity="${selected ? "0.2" : "0.94"}"/><text x="22" y="28.6" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="${textColor}">${meta.label}</text></svg>`);
  }

  function buildFlowerMarkerStyles(TMap) {
    const styles = {};
    const speciesList = Array.from(new Set(flowerDisplayPoints.map((item) => normalizeSpecies(item.species) || item.species).filter(Boolean)));
    speciesList.forEach((species) => {
      styles[getFlowerStyleKey(species, false)] = new TMap.MarkerStyle({
        width: 24,
        height: 30,
        anchor: { x: 12, y: 27 },
        src: buildFlowerMarkerSvg(species, false),
      });
      styles[getFlowerStyleKey(species, true)] = new TMap.MarkerStyle({
        width: 30,
        height: 36,
        anchor: { x: 15, y: 32 },
        src: buildFlowerMarkerSvg(species, true),
      });
    });
    return styles;
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cbName = `txMapCb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const script = document.createElement("script");
      const timeout = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, 12000);
      function cleanup() { clearTimeout(timeout); delete window[cbName]; script.remove(); }
      window[cbName] = (data) => { cleanup(); resolve(data); };
      script.src = `${url}${url.includes("?") ? "&" : "?"}output=jsonp&callback=${cbName}`;
      script.onerror = () => { cleanup(); reject(new Error("JSONP load failed")); };
      document.body.appendChild(script);
    });
  }

  function decodeTencentPolyline(polyline) {
    if (!polyline || !Array.isArray(polyline)) return [];
    const coors = [...polyline];
    for (let i = 2; i < coors.length; i += 1) coors[i] = coors[i - 2] + coors[i] / 1000000;
    const points = [];
    for (let i = 0; i < coors.length; i += 2) points.push({ lat: coors[i], lng: coors[i + 1] });
    return points;
  }

  async function fetchWalkingSegment(from, to) {
    const url = `https://apis.map.qq.com/ws/direction/v1/walking/?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}&key=${config.TENCENT_MAP_KEY}`;
    const data = await jsonp(url);
    if (!data || data.status !== 0 || !data.result?.routes?.[0]) throw new Error("route api failed");
    const route = data.result.routes[0];
    return { distance: route.distance || 0, duration: route.duration || 0, polyline: decodeTencentPolyline(route.polyline) };
  }

  async function fetchReverseGeocoder(point) {
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${point.lat},${point.lng}&key=${config.TENCENT_MAP_KEY}`;
    const data = await jsonp(url);
    if (data && data.status === 0 && data.result) return data.result.address || data.result.formatted_addresses?.recommend || "";
    return "";
  }

  function updateMapStatus(text) {
    els.mapStatus.textContent = text;
  }

  function updateCommunityMapStatus(text) {
    if (els.communityMapStatus) els.communityMapStatus.textContent = text;
  }

  function renderMapPlaceholder(container, message) {
    if (!container) return;
    container.innerHTML = `<div style="height:100%;display:grid;place-items:center;color:#8b6072;text-align:center;padding:24px;line-height:1.8;">${escapeHtml(message)}</div>`;
  }

  function createPlaceholderMap() {
    renderMapPlaceholder(els.mapContainer, "腾讯底图暂未启用，可先浏览校园点位、照片和推荐路线。");
    renderMapPlaceholder(els.communityMapContainer, "腾讯底图暂未启用，可先使用已收录的校园地点。");
    updateCommunityMapStatus("共建选点地图暂未加载，可先填写文字信息。");
  }

  let tencentMapLoadPromise;
  function loadTencentMapScript(key) {
    if (window.TMap?.Map) return Promise.resolve(window.TMap);
    if (tencentMapLoadPromise) return tencentMapLoadPromise;
    tencentMapLoadPromise = new Promise((resolve, reject) => {
      const callbackName = `tencentMapReady_${Date.now()}`;
      const script = document.createElement("script");
      let timer;
      function finish(error) {
        clearTimeout(timer);
        delete window[callbackName];
        script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve(window.TMap);
      }
      window[callbackName] = () => finish(window.TMap?.Map ? null : new Error("Tencent SDK unavailable"));
      const url = new URL("https://map.qq.com/api/gljs");
      url.searchParams.set("v", "1.exp");
      url.searchParams.set("key", key);
      url.searchParams.set("callback", callbackName);
      script.src = url.href;
      script.async = true;
      script.onerror = () => finish(new Error("Tencent SDK could not load"));
      timer = setTimeout(() => finish(new Error("Tencent SDK timed out")), 15000);
      document.head.appendChild(script);
    }).catch(error => { tencentMapLoadPromise = null; throw error; });
    return tencentMapLoadPromise;
  }

  function ensureMap() {
    if (!window.TMap) return;
    if (!state.map) {
      state.map = new window.TMap.Map(els.mapContainer, {
        center: new window.TMap.LatLng(sceneCenter.lat, sceneCenter.lng),
        zoom: 16.4,
        rotation: 0,
        pitch: 0,
        viewMode: "2D",
      });
      if (typeof window.ResizeObserver === "function" && !state.mapResizeObserver) {
        state.mapResizeObserver = new window.ResizeObserver(() => scheduleFitCurrentBounds());
        state.mapResizeObserver.observe(els.mapContainer);
      }
      if (typeof state.map.on === "function") {
        state.map.on("click", (event) => {
          if (!event?.latLng) return;
          if (state.isPickingStartPoint) {
            setCustomStartPoint({
              lat: event.latLng.getLat(),
              lng: event.latLng.getLng(),
              name: event.poi?.name || "自定义起点",
            });
            updateMapStatus(`已把 ${getCurrentStartLabel()} 设为路线起点。`);
            return;
          }
          if (!state.isPickingContributionPoint) return;
          const point = {
            lat: event.latLng.getLat(),
            lng: event.latLng.getLng(),
            name: event.poi?.name || "",
          };
          state.isPickingContributionPoint = false;
          setContributionDraftPoint(point);
          updateMapStatus(`已选中地图点位${point.name ? `：${point.name}` : ""}，现在可以继续填写花况信息。`);
        });
      }
    }
  }

  function ensureContributionMap() {
    if (!window.TMap || !els.communityMapContainer) return;
    if (!state.contributionMap) {
      state.contributionMap = new window.TMap.Map(els.communityMapContainer, {
        center: new window.TMap.LatLng(sceneCenter.lat, sceneCenter.lng),
        zoom: 16,
        rotation: 0,
        pitch: 0,
        viewMode: "2D",
      });
      if (typeof window.ResizeObserver === "function" && !state.contributionMapResizeObserver) {
        state.contributionMapResizeObserver = new window.ResizeObserver(() => {
          if (state.contributionDraftPoint) focusContributionPoint(state.contributionDraftPoint, 16.8);
        });
        state.contributionMapResizeObserver.observe(els.communityMapContainer);
      }
      if (typeof state.contributionMap.on === "function") {
        state.contributionMap.on("click", (event) => {
          if (!state.isPickingContributionPoint || !event?.latLng) return;
          const point = {
            lat: event.latLng.getLat(),
            lng: event.latLng.getLng(),
            name: event.poi?.name || "",
          };
          state.isPickingContributionPoint = false;
          setContributionDraftPoint(point);
          updateCommunityMapStatus(`已在共建地图中选中${point.name ? `：${point.name}` : "一个自定义点位"}。`);
        });
      }
    }
  }

  function shouldShowRouteOverlay() {
    return Boolean(state.plannedRoute.length) && (state.activeView === "recommend" || state.activeView === "flowers" || state.activeView === "spots");
  }

  function getVisibleRoutePath() {
    return state.realRoutePath.length ? state.realRoutePath : [getCurrentStartPoint(), ...state.plannedRoute];
  }

  function coreNodesForView() {
    if (state.activeView === "recommend") return state.plannedRoute;
    if (state.activeView === "updates") return dailyFeed.map((item) => getDailyFeedPoint(item)).filter(Boolean);
    if (state.activeView === "spots") return shouldShowRouteOverlay() ? uniqueById([...routeNodes, ...state.plannedRoute]) : routeNodes;
    if (state.activeView === "flowers") return shouldShowRouteOverlay() ? uniqueById([...state.plannedRoute]) : [];
    return [];
  }

  function focusPoint(point, zoom) {
    if (!window.TMap || !state.map || !point) return;
    const mapStatus = {
      center: new window.TMap.LatLng(point.lat, point.lng),
      zoom: Number.isFinite(zoom) ? zoom : state.map.getZoom(),
    };
    if (typeof state.map.easeTo === "function") {
      state.map.easeTo(mapStatus, { duration: 280 });
      return;
    }
    state.map.setCenter(mapStatus.center);
    if (Number.isFinite(mapStatus.zoom)) state.map.setZoom(mapStatus.zoom);
  }

  function focusContributionPoint(point, zoom) {
    if (!window.TMap || !state.contributionMap || !point) return;
    const mapStatus = {
      center: new window.TMap.LatLng(point.lat, point.lng),
      zoom: Number.isFinite(zoom) ? zoom : state.contributionMap.getZoom(),
    };
    if (typeof state.contributionMap.easeTo === "function") {
      state.contributionMap.easeTo(mapStatus, { duration: 260 });
      return;
    }
    state.contributionMap.setCenter(mapStatus.center);
    if (Number.isFinite(mapStatus.zoom)) state.contributionMap.setZoom(mapStatus.zoom);
  }

  function fitCurrentBounds() {
    if (!window.TMap || !state.map) return;
    let points = [];
    if (state.activeView === "flowers") points = [...flowerDisplayPoints, ...(shouldShowRouteOverlay() ? getVisibleRoutePath() : [])];
    else if (state.activeView === "recommend") points = getVisibleRoutePath();
    else if (state.activeView === "updates") points = dailyFeed.map((item) => getDailyFeedPoint(item)).filter(Boolean);
    else points = [...routeNodes, ...(shouldShowRouteOverlay() ? getVisibleRoutePath() : [])];
    if (!points.length) return;
    const latitudes = points.map((item) => item.lat);
    const longitudes = points.map((item) => item.lng);
    const bounds = new window.TMap.LatLngBounds(new window.TMap.LatLng(Math.min(...latitudes), Math.min(...longitudes)), new window.TMap.LatLng(Math.max(...latitudes), Math.max(...longitudes)));
    state.map.fitBounds(bounds, { padding: 90 });
  }

  function scheduleFitCurrentBounds() {
    if (!window.TMap || !state.map) return;
    if (state.mapFitFrame && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(state.mapFitFrame);
    if (typeof window.requestAnimationFrame === "function") {
      state.mapFitFrame = window.requestAnimationFrame(() => {
        state.mapFitFrame = window.requestAnimationFrame(() => {
          state.mapFitFrame = 0;
          fitCurrentBounds();
        });
      });
      return;
    }
    fitCurrentBounds();
  }

  function refreshContributionMap() {
    if (!window.TMap || !els.communityMapContainer) return;
    ensureContributionMap();
    const TMap = window.TMap;
    const coreGeometries = routeNodes.map((node) => ({
      id: node.id,
      styleId: node.id === state.selectedCoreId ? "selected" : "core",
      position: new TMap.LatLng(node.lat, node.lng),
      properties: { id: node.id, name: node.name, lat: node.lat, lng: node.lng },
    }));
    if (state.contributionCoreLayer) {
      state.contributionCoreLayer.setGeometries(coreGeometries);
    } else {
      state.contributionCoreLayer = new TMap.MultiMarker({
        id: "community-core-markers",
        map: state.contributionMap,
        styles: {
          core: new TMap.MarkerStyle({ width: 22, height: 28, anchor: { x: 11, y: 25 }, src: MARKERS.core }),
          selected: new TMap.MarkerStyle({ width: 28, height: 34, anchor: { x: 14, y: 30 }, src: MARKERS.selected }),
        },
        geometries: coreGeometries,
      });
      if (typeof state.contributionCoreLayer.on === "function") {
        state.contributionCoreLayer.on("click", (event) => {
          if (!state.isPickingContributionPoint) return;
          const point = event?.geometry?.properties;
          if (!point) return;
          state.isPickingContributionPoint = false;
          setContributionDraftPoint({
            lat: Number(point.lat),
            lng: Number(point.lng),
            name: point.name || "",
          });
          updateCommunityMapStatus(`已选中参考点位：${point.name || "校园点位"}。`);
        });
      }
    }

    const draftGeometries = state.contributionDraftPoint
      ? [{
          id: "community-draft-point",
          styleId: "report",
          position: new TMap.LatLng(state.contributionDraftPoint.lat, state.contributionDraftPoint.lng),
          properties: { name: state.contributionDraftPoint.name || "用户标注点" },
        }]
      : [];
    if (state.contributionDraftLayer) {
      state.contributionDraftLayer.setGeometries(draftGeometries);
    } else {
      state.contributionDraftLayer = new TMap.MultiMarker({
        id: "community-draft-marker",
        map: state.contributionMap,
        styles: {
          report: new TMap.MarkerStyle({ width: 32, height: 40, anchor: { x: 14, y: 35 }, src: MARKERS.report }),
        },
        geometries: draftGeometries,
      });
    }

    if (state.contributionDraftPoint) focusContributionPoint(state.contributionDraftPoint, 16.8);
  }

  function refreshMapLayers(options) {
    if (!window.TMap) return;
    ensureMap();
    const TMap = window.TMap;
    const skipFit = Boolean(options?.skipFit || state.suppressNextFit);
    state.suppressNextFit = false;

    const coreGeometries = coreNodesForView().map((node) => ({
      id: node.id,
      styleId: node.id === state.selectedCoreId ? "selected" : "core",
      position: new TMap.LatLng(node.lat, node.lng),
      properties: { id: node.id, name: node.name },
    }));

    const flowerGeometries = flowerDisplayPoints.map((node, index) => ({
      id: `flower-${index}`,
      styleId: getFlowerStyleKey(node.species, Boolean(state.selectedFlowerSpecies && normalizeSpecies(node.species) === normalizeSpecies(state.selectedFlowerSpecies))),
      position: new TMap.LatLng(node.lat, node.lng),
      properties: { species: node.species, lat: node.lat, lng: node.lng },
    }));

    if (state.coreMarkerLayer) state.coreMarkerLayer.setGeometries(coreGeometries);
    else {
      state.coreMarkerLayer = new TMap.MultiMarker({
        id: "core-markers",
        map: state.map,
        styles: {
          core: new TMap.MarkerStyle({ width: 28, height: 36, anchor: { x: 12, y: 32 }, src: MARKERS.core }),
          selected: new TMap.MarkerStyle({ width: 34, height: 42, anchor: { x: 15, y: 38 }, src: MARKERS.selected }),
        },
        geometries: coreGeometries,
      });
      if (typeof state.coreMarkerLayer.on === "function") {
        state.coreMarkerLayer.on("click", (event) => {
          const id = event?.geometry?.id;
          if (!id) return;
          const node = findCurrentPoint(id);
          if (state.isPickingStartPoint && node) {
            setCustomStartPoint({ name: node.name, lat: node.lat, lng: node.lng });
            updateMapStatus(`已把 ${node.name} 设为路线起点。`);
            focusPoint(node, 17.2);
            return;
          }
          state.selectedCoreId = id;
          const linkedUpdate = dailyFeed.find((item) => item.relatedId === id || item.id === id);
          if (linkedUpdate) state.selectedUpdateId = linkedUpdate.id;
          if (!els.contributionLocationName.value.trim()) {
            if (node) els.contributionLocationName.value = node.name;
          }
          populateContributionForm();
          renderPanel();
          refreshMapLayers({ skipFit: true });
          if (node) focusPoint(node, 17.2);
        });
      }
    }

    if (state.flowerMarkerLayer) {
      state.flowerMarkerLayer.setStyles(buildFlowerMarkerStyles(TMap));
      state.flowerMarkerLayer.setGeometries(state.activeView === "flowers" ? flowerGeometries : []);
    }
    else {
      state.flowerMarkerLayer = new TMap.MultiMarker({
        id: "flower-markers",
        map: state.map,
        styles: buildFlowerMarkerStyles(TMap),
        geometries: state.activeView === "flowers" ? flowerGeometries : [],
      });
      if (typeof state.flowerMarkerLayer.on === "function") {
        state.flowerMarkerLayer.on("click", (event) => {
          const species = event?.geometry?.properties?.species;
          if (!species) return;
          state.selectedFlowerSpecies = species;
          if (!els.contributionSpecies.value) els.contributionSpecies.value = species;
          populateContributionForm();
          renderPanel();
          refreshMapLayers({ skipFit: true });
          focusPoint({ lat: event.geometry.properties.lat, lng: event.geometry.properties.lng }, 17.1);
        });
      }
    }

    const routePath = getVisibleRoutePath().map((point) => new TMap.LatLng(point.lat, point.lng));
    const routeGeometries = shouldShowRouteOverlay() && routePath.length > 1 ? [{ id: "route", styleId: "route", paths: routePath }] : [];
    if (state.polylineLayer) state.polylineLayer.setGeometries(routeGeometries);
    else {
      state.polylineLayer = new TMap.MultiPolyline({
        id: "route-layer",
        map: state.map,
        styles: { route: new TMap.PolylineStyle({ color: "#e1518b", width: 6, borderWidth: 2, borderColor: "#fff7fb" }) },
        geometries: routeGeometries,
      });
    }

    const reportGeometries = state.contributionDraftPoint
      ? [{
          id: "report-point",
          styleId: "report",
          position: new TMap.LatLng(state.contributionDraftPoint.lat, state.contributionDraftPoint.lng),
          properties: { name: state.contributionDraftPoint.name || "用户标注点" },
        }]
      : [];
    if (state.reportMarkerLayer) state.reportMarkerLayer.setGeometries(reportGeometries);
    else {
      state.reportMarkerLayer = new TMap.MultiMarker({
        id: "report-marker",
        map: state.map,
        styles: {
          report: new TMap.MarkerStyle({ width: 32, height: 40, anchor: { x: 14, y: 35 }, src: MARKERS.report }),
        },
        geometries: reportGeometries,
      });
    }

    const startGeometries = hasValidPoint(state.customStartPoint)
      ? [{
          id: "planner-start",
          styleId: "start",
          position: new TMap.LatLng(state.customStartPoint.lat, state.customStartPoint.lng),
          properties: { name: state.customStartPoint.name || "自定义起点" },
        }]
      : [];
    if (state.startMarkerLayer) state.startMarkerLayer.setGeometries(startGeometries);
    else {
      state.startMarkerLayer = new TMap.MultiMarker({
        id: "planner-start-marker",
        map: state.map,
        styles: {
          start: new TMap.MarkerStyle({ width: 34, height: 42, anchor: { x: 16, y: 38 }, src: MARKERS.start }),
        },
        geometries: startGeometries,
      });
    }

    refreshContributionMap();
    if (!skipFit) scheduleFitCurrentBounds();
  }

  async function hydrateRealRoute(route) {
    if (!tencentWebServicesEnabled || !route.length) {
      state.realRoutePath = [getCurrentStartPoint(), ...route];
      state.routeMetrics = null;
      if (state.map) updateMapStatus("腾讯地图底图 · 路线为点位连线，距离与时长为估算，非步行导航。");
      renderRouteSummary();
      refreshMapLayers();
      return;
    }
    try {
      const chain = [getCurrentStartPoint(), ...route];
      const segments = [];
      for (let i = 0; i < chain.length - 1; i += 1) segments.push(await fetchWalkingSegment(chain[i], chain[i + 1]));
      state.realRoutePath = segments.flatMap((segment, index) => (index === 0 ? segment.polyline : segment.polyline.slice(1)));
      state.routeMetrics = {
        distanceKm: segments.reduce((sum, item) => sum + item.distance, 0) / 1000,
        durationMin: Math.round(segments.reduce((sum, item) => sum + item.duration, 0)),
      };
      const address = await fetchReverseGeocoder(chain[0]);
      updateMapStatus(`腾讯步行路线已生成，约 ${state.routeMetrics.durationMin} 分钟，从 ${address || "清华大学中心区域"} 出发。`);
    } catch (error) {
      state.realRoutePath = [getCurrentStartPoint(), ...route];
      state.routeMetrics = null;
      updateMapStatus("腾讯路线规划调用失败，已先回退为核心点位连线展示。");
    }
    renderRouteSummary();
    refreshMapLayers();
  }

  function setActiveView(view, options) {
    state.activeView = view;
    [...els.viewSwitcher.querySelectorAll(".view-chip")].forEach((chip) => chip.classList.toggle("is-active", chip.dataset.view === view));
    renderPanel();
    refreshMapLayers(options);
  }

  function syncPlannerSelections() {
    state.selectedIntent = els.intentInput.value.trim();
    state.customStartQuery = els.plannerStartInput?.value.trim() || "";
    state.intentSignals = parseIntent(state.selectedIntent);
    state.selectedTheme = state.intentSignals.theme || themeFromText(state.selectedIntent) || "flowers";
    state.selectedDuration = state.intentSignals.duration || durationFromText(state.selectedIntent) || 45;
    state.selectedStyle = state.intentSignals.style || styleFromText(state.selectedIntent) || "balanced";
    state.selectedFlowerSpecies = state.intentSignals.species || state.selectedFlowerSpecies || flowerSummary[0]?.species || null;
    state.agentPlanPayload = null;
  }

  function runPlannerLocalFallback() {
    state.plannedRoute = buildRoute(state.selectedTheme, state.selectedDuration, state.selectedStyle, state.intentSignals);
    const plan = buildAgentPlan(state.plannedRoute, state.selectedTheme, state.selectedDuration, state.selectedStyle, state.intentSignals);
    state.intentChips = plan.chips;
    playAgentPlanSteps(plan.steps);
    state.selectedCoreId = state.plannedRoute[0]?.id || state.selectedCoreId;
    state.activeRouteId = null;
    state.realRoutePath = [getCurrentStartPoint(), ...state.plannedRoute];
    state.routeMetrics = null;
    renderRouteSummary();
    renderAgentPlan();
    renderRecommendations();
    setActiveView("recommend");
    if (tencentWebServicesEnabled) updateMapStatus("正在请求腾讯步行路线。");
    hydrateRealRoute(state.plannedRoute);
  }

  async function runPlanner() {
    if (state.startSearchTimer) {
      window.clearTimeout(state.startSearchTimer);
      state.startSearchTimer = 0;
    }
    syncPlannerSelections();
    await resolvePlannerStartPoint();
    if (state.customStartQuery && !hasValidPoint(state.customStartPoint)) {
      updateMapStatus(`前端暂未精确命中起点“${state.customStartQuery}”，请点选下方候选地点，或在地图上选择起点。`);
      if (!config.AGENT_API_BASE_URL) return;
    }
    if (config.AGENT_API_BASE_URL && state.selectedIntent) {
      if (state.agentAvailable === false) await checkAgentAvailability();
      if (state.agentAvailable === false) {
        stopAgentThinking();
        const offlineMessage = "Agent 服务当前不可用，请稍后重试。";
        updateMapStatus(offlineMessage);
        if (els.routeSummary) els.routeSummary.textContent = offlineMessage;
        playAgentPlanSteps([
          { tool: state.agentModel || "当前模型", title: "AI 暂未完成规划", description: offlineMessage, meta: ["服务不可用"] },
        ]);
        return;
      }
    }
    if (config.AGENT_API_BASE_URL && state.selectedIntent && state.agentAvailable !== false) {
      startAgentThinking();
      try {
        const plan = await requestAgentPlan();
        applyAgentPlan(plan);
        return;
      } catch (error) {
        console.warn("agent planner failed", error);
        stopAgentThinking();
        const message = error instanceof Error ? error.message : "Agent 规划失败";
        state.agentLastError = message;
        renderAgentConnection();
        updateMapStatus(`AI 思考未完成：${message}`);
        if (els.routeSummary) els.routeSummary.textContent = `AI 思考未完成：${message}。`;
        playAgentPlanSteps([
          {
            tool: state.agentModel || "当前模型",
            title: "AI 思考未完成",
            description: `${message}。请稍后重试，或换一个更明确的地点表达。`,
            meta: ["规划失败"],
          },
        ]);
        return;
      }
    }
    runPlannerLocalFallback();
  }

  function applyRecommendation(routeId) {
    const selected = state.recommendations.find((item) => item.id === routeId) || state.recommendations[0];
    if (!selected) return;
    state.agentPlanPayload = null;
    state.activeRouteId = selected.id;
    state.selectedTheme = selected.theme;
    state.selectedDuration = selected.duration;
    state.selectedStyle = selected.style;
    state.selectedIntent = "";
    state.intentSignals = parseIntent("");
    els.intentInput.value = "";
    state.plannedRoute = selected.points;
    const plan = buildAgentPlan(selected.points, selected.theme, selected.duration, selected.style, state.intentSignals);
    state.intentChips = plan.chips;
    playAgentPlanSteps(plan.steps);
    state.selectedCoreId = selected.points[0]?.id || state.selectedCoreId;
    state.realRoutePath = [getCurrentStartPoint(), ...state.plannedRoute];
    state.routeMetrics = null;
    renderRecommendations();
    renderRouteSummary();
    renderAgentPlan();
    setActiveView("recommend");
    if (tencentWebServicesEnabled) updateMapStatus("正在请求腾讯步行路线。");
    hydrateRealRoute(state.plannedRoute);
  }

  function bindEvents() {
    els.plannerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runPlanner();
    });

    els.plannerStartInput?.addEventListener("input", () => {
      const next = els.plannerStartInput.value.trim();
      state.customStartQuery = next;
      if (
        hasValidPoint(state.customStartPoint)
        && state.customStartSelectionQuery
        && normalizePlaceName(state.customStartSelectionQuery) !== normalizePlaceName(next)
      ) {
        state.customStartPoint = null;
        state.customStartSelectionQuery = "";
      }
      if (state.startSearchTimer) window.clearTimeout(state.startSearchTimer);
      state.startSearchTimer = window.setTimeout(() => {
        resolvePlannerStartPoint();
      }, 260);
      updatePlannerStartUi();
      refreshMapLayers({ skipFit: true });
    });

    els.plannerStartInput?.addEventListener("change", async () => {
      await resolvePlannerStartPoint();
      refreshMapLayers({ skipFit: true });
    });

    els.pickStartOnMapBtn?.addEventListener("click", () => {
      state.isPickingStartPoint = !state.isPickingStartPoint;
      if (state.isPickingStartPoint) state.isPickingContributionPoint = false;
      updateContributionDraftUi();
      updatePlannerStartUi();
      if (state.isPickingStartPoint && els.mapContainer?.scrollIntoView) {
        els.mapContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      updateMapStatus(state.isPickingStartPoint ? "起点选点模式已开启，请直接点击上方主地图或路线点位。" : "起点选点模式已取消。");
    });

    els.clearStartBtn?.addEventListener("click", () => {
      clearCustomStartPoint();
      updateMapStatus(`已恢复默认起点：${sceneCenter.name}。`);
    });

    els.contributionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitContribution();
    });

    els.pickOnMapBtn.addEventListener("click", () => {
      state.isPickingContributionPoint = !state.isPickingContributionPoint;
      updateContributionDraftUi();
      if (state.isPickingContributionPoint && els.communityMapContainer?.scrollIntoView) {
        els.communityMapContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      updateCommunityMapStatus(state.isPickingContributionPoint ? "选点模式已开启，请直接点击右侧共建地图，或点击上方主地图。" : "地图选点模式已取消。");
      updateMapStatus(state.isPickingContributionPoint ? "共建选点模式已开启，可直接点击右侧共建地图或上方主地图。" : "地图选点模式已取消。");
    });

    els.viewSwitcher.addEventListener("click", (event) => {
      const button = event.target.closest(".view-chip");
      if (!button) return;
      if (button.dataset.view === state.activeView && state.plannedRoute.length && (button.dataset.view === "flowers" || button.dataset.view === "spots")) {
        setActiveView("recommend", { skipFit: true });
        return;
      }
      setActiveView(button.dataset.view);
    });

    els.recommendScroller.addEventListener("click", (event) => {
      const stopCard = event.target.closest("[data-stop-id]");
      if (stopCard) {
        state.selectedCoreId = stopCard.dataset.stopId;
        renderRecommendations();
        renderPanel();
        refreshMapLayers({ skipFit: true });
        const node = findCurrentPoint(stopCard.dataset.stopId);
        if (node) focusPoint(node, 17.2);
        return;
      }
      const card = event.target.closest("[data-route-id]");
      if (!card) return;
      applyRecommendation(card.dataset.routeId);
    });
    els.recommendScroller.addEventListener("mouseenter", stopRecommendationAutoplay);
    els.recommendScroller.addEventListener("mouseleave", startRecommendationAutoplay);
    els.recommendScroller.addEventListener("touchstart", stopRecommendationAutoplay, { passive: true });
    els.recommendScroller.addEventListener("touchend", startRecommendationAutoplay, { passive: true });

    els.plannerStartSuggestions?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-start-candidate]");
      if (!button) return;
      if (state.startSearchTimer) {
        window.clearTimeout(state.startSearchTimer);
        state.startSearchTimer = 0;
      }
      const index = Number(button.dataset.startCandidate);
      const candidate = state.customStartCandidates[index];
      if (!candidate) return;
      setCustomStartPoint(candidate, { syncInput: false, preserveQuery: true, selectionQuery: state.customStartQuery });
      updateMapStatus(`已将 ${candidate.name} 设为起点候选，现在可以继续生成路线。`);
      focusPoint(candidate, 17.1);
    });

    els.panelContent.addEventListener("click", (event) => {
      const item = event.target.closest(".panel-item");
      if (!item) return;
      const kind = item.dataset.kind;
      const id = item.dataset.id;
      if (kind === "spot") {
        state.selectedCoreId = id;
        populateContributionForm();
        renderPanel();
        refreshMapLayers({ skipFit: true });
        const node = findCurrentPoint(id);
        if (node) focusPoint(node, 17.2);
        return;
      }
      if (kind === "flower") {
        state.selectedFlowerSpecies = id;
        populateContributionForm();
        renderPanel();
        refreshMapLayers({ skipFit: true });
        const sample = getFlowerSummary(id)?.samples?.[0];
        if (sample) focusPoint(sample, 17.1);
        return;
      }
      if (kind === "update") {
        state.selectedUpdateId = id;
        const update = dailyFeed.find((entry) => entry.id === id);
        state.selectedCoreId = update?.relatedId || update?.id || state.selectedCoreId;
        renderPanel();
        refreshMapLayers({ skipFit: true });
        const point = getDailyFeedPoint(update);
        if (point) focusPoint(point, 17.2);
      }
    });

    els.focusRouteBtn.addEventListener("click", () => setActiveView("recommend"));
    window.addEventListener("resize", scheduleFitCurrentBounds);
    window.addEventListener("focus", () => {
      if (config.AGENT_API_BASE_URL) checkAgentAvailability();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && config.AGENT_API_BASE_URL) checkAgentAvailability();
    });

    els.locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        updateMapStatus("当前浏览器不支持定位，仍可使用 demo 预设起点。");
        return;
      }
      navigator.geolocation.getCurrentPosition(async (position) => {
        const coords = wgs84ToGcj02(position.coords.latitude, position.coords.longitude);
        if (window.TMap && state.map) {
          const point = new window.TMap.LatLng(coords.lat, coords.lng);
          if (!state.userMarker) state.userMarker = new window.TMap.MultiMarker({ id: "user-marker", map: state.map, geometries: [{ id: "me", position: point }] });
          else state.userMarker.setGeometries([{ id: "me", position: point }]);
          state.map.setCenter(point);
        }
        if (tencentWebServicesEnabled) {
          try {
            const address = await fetchReverseGeocoder(coords);
            setCustomStartPoint({ ...coords, name: address || "我的位置" });
            updateMapStatus(`已定位到你的当前位置${address ? `，附近为 ${address}` : ""}。`);
          } catch {
            setCustomStartPoint({ ...coords, name: "我的位置" });
            updateMapStatus("已定位到你的当前位置，可据此继续浏览地图。");
          }
        } else {
          setCustomStartPoint({ ...coords, name: "我的位置" });
          updateMapStatus("已定位到当前位置，可继续生成示意路线。");
        }
      }, () => updateMapStatus("定位失败，已继续使用清华 demo 预设中心点。"));
    });
  }

  async function initMap() {
    if (!config.TENCENT_MAP_KEY) {
      createPlaceholderMap();
      updateMapStatus("腾讯地图 Key 待配置，校园点位与照片可继续浏览。");
      updateCommunityMapStatus("尚未配置腾讯地图 Key，共建选点地图暂不可用。");
      return;
    }
    if (window.location.protocol === "file:") {
      createPlaceholderMap();
      updateMapStatus("请通过本地预览服务或发布后的网址访问腾讯底图。");
      return;
    }
    try {
      await loadTencentMapScript(config.TENCENT_MAP_KEY);
      ensureMap();
      ensureContributionMap();
      refreshMapLayers();
      updateMapStatus("腾讯地图已就绪，现在可以切换点位、花卉和推荐路线视图。");
      updateCommunityMapStatus("共建选点地图已就绪，点击按钮后可直接在这里标注花况位置。");
    } catch (error) {
      createPlaceholderMap();
      updateMapStatus("腾讯地图脚本加载失败，请检查 Key 或网络环境。");
      updateCommunityMapStatus("共建选点地图加载失败，请检查 Key 或网络环境。");
    }
  }

  async function init() {
    restoreCommunityContributions();
    rebuildSpeciesCoverMap();
    rebuildFlowerSummary();
    dailyFeed = buildDailyFeed();
    state.selectedFlowerSpecies = state.selectedFlowerSpecies || flowerSummary[0]?.species || null;
    state.selectedUpdateId = state.selectedUpdateId || dailyFeed[0]?.id || null;
    renderHero();
    buildRecommendations();
    renderRecommendations();
    renderAgentPlan();
    renderAgentConnection();
    populateContributionForm();
    bindEvents();
    if (config.AGENT_API_BASE_URL) window.setInterval(() => {
      if (document.visibilityState !== "hidden") checkAgentAvailability();
    }, 12000);
    await Promise.all([initMap(), checkAgentAvailability()]);
    applyRecommendation(state.activeRouteId);
  }

  init();
})();
