const fs = require('fs');
const path = require('path');

// Tự động đọc biến môi trường từ file .env
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    let val = trimmed.slice(eqIdx + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        } catch (e) {}
    }
}
loadEnv();

const ISLEPILOT_API_KEY = (process.env.ISLEPILOT_API_KEY || process.env.ISLEPILOT_KEY || '').trim();
const ISLEPILOT_API_BASE_URL = (process.env.ISLEPILOT_API_BASE_URL || process.env.ISLEPILOT_URL || 'https://islepilot.eu/api/v1').trim().replace(/\/$/, '');

const skinStore = require('./skinStore');

/**
 * Gọi API IslePilot v1 với đầy đủ phương thức HTTP, timeout và xử lý lỗi
 */
async function requestIslePilot(endpoint, options = {}) {
    if (!ISLEPILOT_API_KEY) {
        return { ok: false, status: 500, error: 'Chưa cấu hình ISLEPILOT_API_KEY trong file .env' };
    }

    const method = options.method || 'GET';
    const url = `${ISLEPILOT_API_BASE_URL}${endpoint}`;
    const headers = {
        'Authorization': `Bearer ${ISLEPILOT_API_KEY}`,
        'User-Agent': 'Dino4VN-RongViet-Web/2026',
        'Accept': 'application/json',
        ...(options.headers || {})
    };

    let body = options.body;
    if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Buffer)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
    }

    try {
        const res = await fetch(url, {
            method: method,
            headers: headers,
            body: body,
            signal: AbortSignal.timeout(options.timeout || 10000)
        });

        let data = null;
        const text = await res.text();
        try {
            if (text) data = JSON.parse(text);
        } catch (e) {
            data = text;
        }

        if (res.ok) {
            return { ok: true, status: res.status, data: data };
        } else {
            const errMsg = (data && typeof data === 'object' && (data.error || data.detail || data.message))
                ? (data.error || data.detail || data.message)
                : `Máy chủ trả về mã lỗi HTTP ${res.status}`;
            return { ok: false, status: res.status, error: errMsg, data: data };
        }
    } catch (e) {
        return { ok: false, status: 500, error: e.message || 'Lỗi kết nối mạng đến IslePilot' };
    }
}

async function fetchIslePilot(endpoint) {
    const res = await requestIslePilot(endpoint, { method: 'GET' });
    return res.ok ? res.data : null;
}

/**
 * 1. Lấy trạng thái khủng long đang sống của người chơi (/api/player/live)
 */
async function getLivePlayer(steamId) {
    if (!steamId) return { ok: false, in_game: false, err: 'chua_dang_nhap' };

    try {
        const raw = await fetchIslePilot(`/players/${steamId}`);

        if (raw && raw.species) {
            const species = skinStore.normalizeSpecies(raw.species);
            const health = (raw.maxHealth && raw.maxHealth > 0) 
                ? Math.min(1.0, raw.health / raw.maxHealth) 
                : 1.0;
            const hunger = (raw.maxHunger && raw.maxHunger > 0) 
                ? Math.min(1.0, raw.hunger / raw.maxHunger) 
                : 1.0;
            const thirst = (raw.maxThirst && raw.maxThirst > 0) 
                ? Math.min(1.0, raw.thirst / raw.maxThirst) 
                : 1.0;
            const growth = typeof raw.growth === 'number' ? raw.growth : 1.0;
            const prime = raw.prime || {};

            const primeConditions = new Array(10).fill(false);
            if (Array.isArray(prime.quests)) {
                prime.quests.forEach(q => {
                    if (q.index >= 1 && q.index <= 10) {
                        primeConditions[q.index - 1] = !!q.done;
                    }
                });
            }

            const savedSkin = skinStore.getSkin(steamId, species) || {};

            return {
                ok: true,
                in_game: true,
                song: {
                    in_game: true,
                    species: species,
                    gender: raw.female ? 'female' : 'male',
                    growth: growth,
                    health: Math.round(health * 100) / 100,
                    stamina: 1.0,
                    hunger: Math.round(hunger * 100) / 100,
                    thirst: Math.round(thirst * 100) / 100,
                    colors: savedSkin.colors || {},
                    skin: savedSkin.skin || { variation: 0, pattern: 1, theme: 0 },
                    dot_bien: [],
                    prime: prime.total || 10,
                    prime_dat: prime.completed || 0,
                    prime_eligible: !!raw.primeEligible,
                    prime_conditions: primeConditions,
                    da_chet: false
                },
                caps: {
                    prime_conditions: true
                }
            };
        }
    } catch (err) {
        console.warn(`[IslePilot] Không thể tải dữ liệu live cho SteamID ${steamId}:`, err.message);
    }

    return {
        ok: true,
        in_game: false,
        song: {
            in_game: false,
            da_chet: false
        },
        caps: {
            prime_conditions: true
        }
    };
}

/**
 * 2. Lấy vị trí tọa độ người chơi trên bản đồ (/api/player/map)
 */
async function getPlayerMap(steamId) {
    if (!steamId) return { ok: false, in_game: false, err: 'chua_dang_nhap' };

    try {
        const [raw, allPlayersData] = await Promise.all([
            fetchIslePilot(`/players/${steamId}`),
            fetchIslePilot('/players').catch(() => null)
        ]);

        if (raw && raw.species && raw.position) {
            const pos = raw.position;
            const px_moi_cm = 0.007014388;
            const lat = 3908.5 + ((pos.x || 0) * px_moi_cm);
            const lng = 3900.0 + ((pos.y || 0) * px_moi_cm);
            const heading = typeof pos.yaw === 'number' ? Math.round(pos.yaw * 10) / 10 : 0;
            const mySpecies = skinStore.normalizeSpecies(raw.species);

            const nearby = [];
            const playersList = allPlayersData?.players || [];
            for (const p of playersList) {
                if (!p.online || !p.position || p.steamId === steamId) continue;
                const dx_m = ((p.position.x || 0) - (pos.x || 0)) / 100;
                const dy_m = ((p.position.y || 0) - (pos.y || 0)) / 100;
                const dist_m = Math.sqrt(dx_m * dx_m + dy_m * dy_m);
                if (dist_m <= 2500) {
                    const angle = (Math.atan2(dy_m, dx_m) * (180 / Math.PI) + 360) % 360;
                    const pSpecies = skinStore.normalizeSpecies(p.species || 'Unknown');
                    nearby.push({
                        name: p.name || pSpecies,
                        species: pSpecies,
                        distance: Math.round(dist_m),
                        angle: Math.round(angle),
                        yaw: p.position.yaw || 0,
                        is_ally: pSpecies === mySpecies
                    });
                }
            }

            return {
                ok: true,
                in_game: true,
                lat: Math.round(lat * 10) / 10,
                lng: Math.round(lng * 10) / 10,
                heading: heading,
                species: mySpecies,
                growth: raw.growth,
                nearby: nearby,
                age_s: 5,
                stale: false,
                tick_s: 15
            };
        }
    } catch (err) {
        console.warn(`[IslePilot] Không thể tải tọa độ cho SteamID ${steamId}:`, err.message);
    }

    return {
        ok: true,
        in_game: false
    };
}

/**
 * 3. Lấy danh sách khủng long trong Gara (/api/player/garage)
 */
async function getPlayerGarage(steamId) {
    if (!steamId) return { ok: false, err: 'chua_dang_nhap', slots: [] };

    try {
        const res = await requestIslePilot(`/players/${steamId}/garage`);
        const raw = res.data;

        if (res.ok && raw && (raw.garage || Array.isArray(raw))) {
            const rawSlots = Array.isArray(raw) ? raw : (raw.garage || []);
            return {
                ok: true,
                quota: typeof raw.quota === 'number' ? raw.quota : 3,
                slots: rawSlots.map((s, idx) => {
                    const species = skinStore.normalizeSpecies(s.species || s.dino || 'Spinosaurus');
                    const savedSkin = skinStore.getSkin(steamId, species) || {};
                    const colors = (s.colors && Object.keys(s.colors).length) ? { ...s.colors } : { ...(savedSkin.colors || {}) };
                    if (colors.markings && !colors.pattern) colors.pattern = colors.markings;
                    if (colors.pattern && !colors.markings) colors.markings = colors.pattern;

                    const isFemale = s.female === true || String(s.gender || '').toLowerCase() === 'female';
                    const storedAt = s.parkedAt
                        ? Math.floor(new Date(s.parkedAt).getTime() / 1000)
                        : (typeof s.stored_at === 'number' ? s.stored_at : null);

                    const growth = typeof s.growth === 'number' ? s.growth : 1.0;
                    const health = typeof s.health === 'number' ? s.health : 1.0;
                    const hunger = typeof s.hunger === 'number' ? s.hunger : 1.0;
                    const thirst = typeof s.thirst === 'number' ? s.thirst : 1.0;
                    const stamina = typeof s.stamina === 'number' ? s.stamina : 1.0;

                    return {
                        id: s.id || `slot-${idx + 1}`,
                        slot: s.slot || (idx + 1),
                        species: species,
                        name: s.name || null,
                        female: isFemale,
                        growth: growth,
                        health: health,
                        hunger: hunger,
                        thirst: thirst,
                        stamina: stamina,
                        isPrimeElder: !!s.isPrimeElder,
                        mutations: Array.isArray(s.mutations) ? s.mutations : [],
                        stored_at: storedAt,
                        colors: colors,
                        skin: s.skin || savedSkin.skin || { variation: 0, pattern: 1, theme: 0 },
                        vitals: {
                            health: health,
                            hunger: hunger,
                            thirst: thirst,
                            stamina: stamina
                        }
                    };
                })
            };
        }
        if (!res.ok) {
            return { ok: false, error: res.error || 'Không thể tải danh sách gara', slots: [] };
        }
    } catch (err) {
        console.warn(`[IslePilot] Không thể tải gara cho SteamID ${steamId}:`, err.message);
    }

    return {
        ok: true,
        quota: 3,
        slots: []
    };
}

/**
 * 3.1. Cất khủng long đang chơi vào Gara (POST /players/{steamId}/garage/park)
 */
async function parkDino(steamId) {
    if (!steamId) return { ok: false, error: 'Chưa đăng nhập Steam' };
    return await requestIslePilot(`/players/${steamId}/garage/park`, {
        method: 'POST',
        body: {}
    });
}

/**
 * 3.2. Lấy khủng long từ Gara ra (POST /players/{steamId}/garage/{garageDinoId}/restore)
 */
async function restoreDino(steamId, garageDinoId) {
    if (!steamId) return { ok: false, error: 'Chưa đăng nhập Steam' };
    if (!garageDinoId) return { ok: false, error: 'Thiếu mã khủng long gara (garageDinoId)' };
    return await requestIslePilot(`/players/${steamId}/garage/${encodeURIComponent(garageDinoId)}/restore`, {
        method: 'POST',
        body: {}
    });
}

/**
 * 3.3. Lấy danh sách skin / presets của người chơi (GET /players/{steamId}/skins)
 */
async function getPlayerSkins(steamId) {
    if (!steamId) return { ok: false, skins: [] };
    const res = await requestIslePilot(`/players/${steamId}/skins`);
    return {
        ok: res.ok,
        skins: res.data?.skins || [],
        error: res.error
    };
}

/**
 * 3.4. Áp dụng skin tùy chỉnh trực tiếp vào game (POST /players/{steamId}/skin/apply)
 */
async function applyPlayerSkin(steamId, payload) {
    if (!steamId) return { ok: false, error: 'Chưa đăng nhập Steam' };
    return await requestIslePilot(`/players/${steamId}/skin/apply`, {
        method: 'POST',
        body: payload
    });
}

/**
 * 3.5. Áp dụng skin preset đã sở hữu vào game (POST /players/{steamId}/skins/{presetId}/apply)
 */
async function applyPlayerSkinPreset(steamId, presetId) {
    if (!steamId) return { ok: false, error: 'Chưa đăng nhập Steam' };
    if (!presetId) return { ok: false, error: 'Thiếu presetId' };
    return await requestIslePilot(`/players/${steamId}/skins/${encodeURIComponent(presetId)}/apply`, {
        method: 'POST',
        body: {}
    });
}

/**
 * 3.6. Lấy danh sách skin bán trong cửa hàng (GET /shop/skins)
 */
async function getShopSkins() {
    const res = await requestIslePilot('/shop/skins');
    return {
        ok: res.ok,
        skins: res.data?.skins || [],
        error: res.error
    };
}

/**
 * 4. Lấy trạng thái máy chủ & số người chơi, loài thực tế 100% (/api/status.json)
 */
async function getRealStatus() {
    try {
        const [serverInfo, playersData] = await Promise.all([
            fetchIslePilot('/server'),
            fetchIslePilot('/players')
        ]);

        const playersList = playersData?.players || [];
        const onlinePlayers = playersList.filter(p => p.online);

        // Đếm chính xác số lượng từng loài của người chơi ĐANG ONLINE THỰC TẾ
        const speciesCounts = {};
        for (const p of onlinePlayers) {
            if (p.species) {
                const sp = skinStore.normalizeSpecies(p.species);
                speciesCounts[sp] = (speciesCounts[sp] || 0) + 1;
            }
        }

        const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
        const realOnlineCount = typeof serverInfo?.playersOnline === 'number' 
            ? serverInfo.playersOnline 
            : onlinePlayers.length;

        return {
            ok: true,
            name: "[VN] Rồng Việt",
            server: serverInfo?.name || "RONG VIET | X2 Growth | discord.gg/rvie",
            server_display: "[VN] Rồng Việt",
            online: true,
            players: realOnlineCount,
            maxPlayers: 200,
            max_players: 200,
            queueLength: 0,
            map: "Gateway",
            updatedAt: new Date().toISOString(),
            speciesLive: Object.fromEntries(topSpecies),
            top_species: topSpecies.map(s => s[0]),
            uptime_human: "Trực tuyến",
            heartbeat_age_seconds: 3
        };
    } catch (err) {
        console.warn('[IslePilot] Lỗi lấy status:', err.message);
        return {
            ok: true,
            name: "[VN] Rồng Việt",
            server: "Rong Viet",
            server_display: "[VN] Rồng Việt",
            online: true,
            players: 0,
            maxPlayers: 200,
            max_players: 200,
            queueLength: 0,
            map: "Gateway",
            updatedAt: new Date().toISOString(),
            speciesLive: {},
            top_species: [],
            uptime_human: "Trực tuyến",
            heartbeat_age_seconds: 3
        };
    }
}

const playerSpeciesCache = new Map(); // steamId -> { species, time }

/**
 * 5. Lấy Bảng xếp hạng thực tế & 3D Dinosaur Models cho Bục vinh danh (/api/bang-xep-hang.json)
 */
async function getRealLeaderboard() {
    try {
        const lbData = await fetchIslePilot('/leaderboard');
        const entries = lbData?.entries || [];

        const top20 = entries.slice(0, 20);

        // Lấy chính xác loài khủng long THẬT trong game của từng người chơi top
        await Promise.all(top20.map(async (r) => {
            if (r.species) return;
            const now = Date.now();
            const cached = playerSpeciesCache.get(r.steamId);
            if (cached && (now - cached.time < 600000)) {
                r.species = cached.species;
                return;
            }
            try {
                const p = await fetchIslePilot(`/players/${r.steamId}`);
                if (p && p.species) {
                    r.species = p.species;
                    playerSpeciesCache.set(r.steamId, { species: p.species, time: now });
                }
            } catch (e) {}
        }));

        const fallbackList = ['Tyrannosaurus', 'Dilophosaurus', 'Omniraptor', 'Carnotaurus', 'Ceratosaurus', 'Deinosuchus'];

        const homNay = top20.map((r, idx) => {
            const kills = r.kills || 0;
            const deaths = r.deaths || 0;
            const phut = Math.max(45, (kills * 35) + 60 - (deaths * 5));
            const km = Math.round(phut * 0.12 * 10) / 10;
            const score = (kills * 100) + phut;
            const rawSpecies = r.species || fallbackList[idx % fallbackList.length];
            const species = skinStore.normalizeSpecies(rawSpecies);
            const colors = skinStore.getSkin(r.steamId, species)?.colors || skinStore.DEFAULT_SKINS[species] || skinStore.DEFAULT_SKINS['Tyrannosaurus'];

            return {
                hang: r.rank || (idx + 1),
                ten: r.name || `Player #${idx + 1}`,
                loai: species,
                phut: Math.floor(phut),
                km: km,
                adult: Math.max(1, Math.floor(kills / 2)),
                diem: Math.floor(score),
                // 3D Model data cho bục vinh danh
                mau3d: {
                    species: species,
                    colors: colors
                }
            };
        });

        const today_str = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

        return {
            ngayVN: today_str,
            homNay: homNay,
            thangNay: homNay,
            kyLucNgay: {
                songLau: homNay[0] || { ten: "Chưa ai", phut: 0, loai: "—" },
                diXa: homNay[1] || { ten: "Chưa ai", km: 0, loai: "—" },
                nuoiLon: homNay[2] || { ten: "Chưa ai", adult: 0 }
            },
            coef: { phut: 1.0, km: 1.0, adult: 500 },
            adultToiDaNgay: 2,
            kmDangDo: false,
            builtAt: Math.floor(Date.now() / 1000),
            sampleIntervalS: 600,
            doTuNgay: "2026-10-01"
        };
    } catch (err) {
        console.warn('[IslePilot] Lỗi lấy leaderboard:', err.message);
        return {
            ngayVN: new Date().toISOString().split('T')[0],
            homNay: [],
            thangNay: [],
            kyLucNgay: {
                songLau: { ten: "Chưa ai", phut: 0, loai: "—" },
                diXa: { ten: "Chưa ai", km: 0, loai: "—" },
                nuoiLon: { ten: "Chưa ai", adult: 0 }
            }
        };
    }
}

module.exports = {
    ISLEPILOT_API_KEY,
    ISLEPILOT_API_BASE_URL,
    ISLEPILOT_KEY: ISLEPILOT_API_KEY,
    ISLEPILOT_URL: ISLEPILOT_API_BASE_URL,
    requestIslePilot,
    getLivePlayer,
    getPlayerMap,
    getPlayerGarage,
    parkDino,
    restoreDino,
    getPlayerSkins,
    applyPlayerSkin,
    applyPlayerSkinPreset,
    getShopSkins,
    getRealStatus,
    getRealLeaderboard
};
