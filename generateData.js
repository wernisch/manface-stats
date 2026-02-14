import fs from "fs";
import fetch from "node-fetch";

const gameIds = [
    7133320099,
    8129382678,
    6903750207,
    8120277194,
    7277414074,
    6946284723,
    6918643678,
    8099904322,
    8266341619,
    7091169002,
    7512276786,
    7253578148,
    7107426422,
    7200210851,
    7209470598,
    7923536197,
    8152203996,
    8177567602,
    6734217025,
    6902695116,
    6666683069,
    6836866514,
    6270047231,
    8065007541,
    8467040326,
    8295881282,
    8755437841,
    8682469719,
    8617745696,
    8633603548,
    8750900425,
    8818258566,
    8868196650,
    8683739287,
    9079769327,
    7669571394,
    8723763273,
    9003825222,
    9139547461,
    7448058813,
    7376489811,
    9259685974,
    9344488538,
    9191224337,
    9332732468,
    9275861887,
    9323921130,
    9398381856,
    9639089587,
    8976177098,
    8984777863,
    9525333656,
    9275861887
];


const proxyUrl = "https://manface.bloxyhdd.workers.dev/?url=";
const BATCH_SIZE = 75;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 4;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function backoffMs(attempt) {
  const base = Math.min(4000, 250 * Math.pow(2, attempt - 1));
  return base / 2 + Math.random() * base / 2;
}

function parseRetryAfter(v) {
  if (!v) return null;
  const s = Number(v);
  if (!Number.isNaN(s)) return Math.max(0, s * 1000);
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  return null;
}

function wrap(url) {
  return proxyUrl ? proxyUrl + encodeURIComponent(url) : url;
}

async function fetchWithRetry(url, init = {}) {
  let lastErr, res;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      res = await fetch(url, { ...init, signal: controller.signal, headers: { ...(init.headers || {}), Origin: "null" } });
      clearTimeout(timer);

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const ra = parseRetryAfter(res.headers.get("Retry-After"));
        await wait(ra ?? backoffMs(attempt));
        continue;
      }
      if (res.status >= 500 && res.status < 600 && attempt < MAX_ATTEMPTS) {
        await wait(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_ATTEMPTS) break;
      await wait(backoffMs(attempt));
    }
  }
  throw lastErr || new Error(`Failed to fetch ${url}`);
}

async function fetchGamesBatch(ids) {
  const url = wrap(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`games ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const g of data?.data || []) map.set(g.id, g);
  return map;
}

async function fetchVotesBatch(ids) {
  const url = wrap(`https://games.roblox.com/v1/games/votes?universeIds=${ids.join(",")}`);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`votes ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const v of data?.data || []) {
    const up = v.upVotes || 0;
    const down = v.downVotes || 0;
    const total = up + down;
    const likeRatio = total > 0 ? Math.round((up / total) * 100) : 0;
    map.set(v.id, likeRatio);
  }
  return map;
}

async function fetchIconsBatch(ids) {
  const url = wrap(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids.join(",")}&size=768x432&format=Png&isCircular=false`);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`thumbs ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const row of data?.data || []) {
    const uni = row.universeId ?? row.targetId;
    const img = row?.thumbnails?.[0]?.imageUrl ?? "";
    map.set(uni, img);
  }
  return map;
}

(async () => {
  const allGames = [];
  const batches = chunk(gameIds, BATCH_SIZE);

  for (const ids of batches) {
    try {
      const [gamesMap, votesMap, iconsMap] = await Promise.all([
        fetchGamesBatch(ids),
        fetchVotesBatch(ids),
        fetchIconsBatch(ids)
      ]);

      for (const id of ids) {
        const game = gamesMap.get(id);
        if (!game) continue;

        allGames.push({
          id: game.id,
          rootPlaceId: game.rootPlaceId,
          name: game.name,
          playing: game.playing || 0,
          visits: game.visits || 0,
          likeRatio: votesMap.get(id) ?? 0,
          icon: iconsMap.get(id) ?? ""
        });
      }

      await wait(300);
    } catch (err) {
      console.error(`Batch failed for ids [${ids.join(",")}]:`, err);
    }
  }

  allGames.sort((a, b) => b.playing - a.playing);

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync("public/games.json", JSON.stringify({ games: allGames }, null, 2));
})();
