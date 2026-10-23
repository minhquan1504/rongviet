/**
 * Web Server Dino4VN & Steam Login (Pure Node.js - Zero External Dependencies)
 * Chạy trực tiếp trên mọi phiên bản Node.js mà không cần cài đặt node_modules/express.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Tự động đọc biến môi trường từ file .env
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
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

const islepilot = require('./services/islepilot');
const skinStore = require('./services/skinStore');

const PORT = parseInt(process.env.PORT || '3000', 10);
const webDir = path.join(__dirname, 'dino4vn.com');

// Simple Session Storage in memory
const sessions = new Map();

function parseCookies(req) {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
        });
    }
    return list;
}

function getSession(req, res) {
    const cookies = parseCookies(req);
    let sid = cookies['connect.sid'];
    if (!sid || !sessions.has(sid)) {
        sid = crypto.randomBytes(16).toString('hex');
        sessions.set(sid, {});
    }
    res.setHeader('Set-Cookie', `connect.sid=${sid}; Path=/; HttpOnly; Max-Age=${30 * 24 * 3600}`);
    return sessions.get(sid);
}

function getAuthSteamId(req, session) {
    if (session && session.user && session.user.logged_in && session.user.steamid) {
        return session.user.steamid;
    }
    // Hỗ trợ launcher desktop qua HTTP header hoặc query (yêu cầu đúng định dạng SteamID64 17 chữ số)
    const hId = req.headers['x-steam-id'] || req.headers['x-steamid64'];
    if (hId && typeof hId === 'string' && /^\d{17}$/.test(hId.trim())) {
        return hId.trim();
    }
    const parsed = url.parse(req.url, true);
    const qId = parsed.query?.steamid || parsed.query?.steamid64;
    if (qId && typeof qId === 'string' && /^\d{17}$/.test(qId.trim())) {
        return qId.trim();
    }
    return null;
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.mp3': 'audio/mpeg',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json'
};

function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
}

function sendFile(res, filePath) {
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('File Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
    });
    fs.createReadStream(filePath).pipe(res);
}

function getBaseUrl(req, port) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
    return `${proto}://${host}`;
}

async function handleRequest(req, res, currentPort) {
    const parsed = url.parse(req.url, true);
    let pathname = decodeURIComponent(parsed.pathname || '/');
    const session = getSession(req, res);

    // Đọc body nếu là POST / PUT
    let bodyText = '';
    if (req.method === 'POST' || req.method === 'PUT') {
        bodyText = await new Promise(resolve => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => resolve(data));
        });
    }
    let bodyJson = {};
    try {
        if (bodyText) bodyJson = JSON.parse(bodyText);
    } catch (e) {}

    // ── 1. Đăng nhập Steam ───────────────────────────────────────────────────
    if (pathname === '/api/auth/steam' || pathname === '/dang-nhap') {
        const returnTo = parsed.query.return || parsed.query.ve || '/';
        session.returnTo = returnTo;
        const baseUrl = getBaseUrl(req, currentPort);
        const returnUrl = `${baseUrl}/api/auth/steam/return`;
        const realm = `${baseUrl}/`;

        const openidParams = new URLSearchParams({
            'openid.ns': 'http://specs.openid.net/auth/2.0',
            'openid.mode': 'checkid_setup',
            'openid.return_to': returnUrl,
            'openid.realm': realm,
            'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
        });
        res.writeHead(302, { 'Location': `https://steamcommunity.com/openid/login?${openidParams.toString()}` });
        return res.end();
    }

    // ── 2. Xử lý phản hồi từ Steam (Callback) ────────────────────────────────
    if (pathname === '/api/auth/steam/return') {
        try {
            const query = parsed.query;
            if (!query || !query['openid.mode']) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Phản hồi không hợp lệ từ Steam.');
            }
            if (query['openid.mode'] === 'cancel') {
                const returnTo = session.returnTo || '/';
                delete session.returnTo;
                res.writeHead(302, { 'Location': returnTo });
                return res.end();
            }

            const claimedId = query['openid.claimed_id'] || query['openid.identity'] || '';
            const match = claimedId.match(/\/id\/(\d+)/);
            if (!match) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Không tìm thấy SteamID hợp lệ.');
            }
            const steamId = match[1];

            let name = `Steam ...${steamId.slice(-4)}`;
            let avatar = '';
            let profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
            let country = '';

            try {
                const xmlRes = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                if (xmlRes.ok) {
                    const xmlText = await xmlRes.text();
                    const nameM = xmlText.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
                    const avM = xmlText.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
                    const locM = xmlText.match(/<location><!\[CDATA\[(.*?)\]\]><\/location>/);
                    if (nameM && nameM[1]) name = nameM[1];
                    if (avM && avM[1]) avatar = avM[1];
                    if (locM && locM[1]) country = locM[1];
                }
            } catch (err) {}

            session.user = {
                logged_in: true,
                steamid: steamId,
                name: name,
                avatar: avatar,
                profileurl: profileUrl,
                country: country
            };

            const returnTo = session.returnTo || '/me.html';
            delete session.returnTo;
            res.writeHead(302, { 'Location': returnTo });
            return res.end();
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Lỗi xác thực Steam: ' + err.message);
        }
    }

    // ── 3. API Player Info ───────────────────────────────────────────────────
    if (pathname === '/api/player/me') {
        if (session && session.user && session.user.logged_in) {
            return sendJson(res, 200, session.user);
        }
        return sendJson(res, 200, { logged_in: false });
    }

    if (pathname === '/api/player/logout') {
        if (session) {
            session.user = null;
        }
        return sendJson(res, 200, { ok: true });
    }

    // ── 4. API Skin & Khủng long ─────────────────────────────────────────────
    if (pathname === '/api/player/skin') {
        const steamId = getAuthSteamId(req, session);
        if (!steamId) {
            return sendJson(res, 401, { ok: false, err: 'chua_dang_nhap' });
        }

        const live = await islepilot.getLivePlayer(steamId);
        const species = live?.song?.species || 'Spinosaurus';

        if (req.method === 'POST') {
            // 1. Luôn lưu vào kho skin cục bộ để bảo toàn tùy chỉnh người chơi
            skinStore.saveSkin(steamId, bodyJson.species || species, {
                colors: bodyJson.colors || bodyJson,
                skin: bodyJson.skin || { variation: bodyJson.variation, pattern: bodyJson.pattern, theme: bodyJson.theme }
            });

            // 2. Tích hợp gửi sang IslePilot API
            let pilotResult = null;
            if (bodyJson.presetId) {
                // Áp dụng skin preset đã sở hữu
                pilotResult = await islepilot.applyPlayerSkinPreset(steamId, bodyJson.presetId);
            } else {
                // Áp dụng skin tùy chỉnh trực tiếp
                pilotResult = await islepilot.applyPlayerSkin(steamId, bodyJson);
            }

            if (pilotResult && pilotResult.ok) {
                return sendJson(res, 200, {
                    ok: true,
                    message: 'Đã áp dụng màu skin vào game thành công!'
                });
            } else {
                // Trả về chính xác thông báo lỗi từ IslePilot để giao diện thông báo thật cho người chơi
                const errMsg = pilotResult?.error || 'Chưa thể áp màu vào game.';
                return sendJson(res, 200, {
                    ok: false,
                    res: errMsg,
                    localSaved: true
                });
            }
        }

        const [savedSkin, skinsData] = await Promise.all([
            Promise.resolve(skinStore.getSkin(steamId, species) || {}),
            islepilot.getPlayerSkins(steamId)
        ]);

        return sendJson(res, 200, {
            ok: true,
            species: species,
            female: live?.song?.gender === 'female',
            growth: live?.song?.growth || 1.0,
            colors: savedSkin.colors || {},
            skin: savedSkin.skin || { variation: 0, pattern: 1, theme: 0 },
            presets: skinsData.skins || []
        });
    }

    if (pathname === '/api/player/skins') {
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 401, { ok: false, err: 'chua_dang_nhap' });
        const data = await islepilot.getPlayerSkins(steamId);
        return sendJson(res, 200, data);
    }

    if (pathname === '/api/shop/skins') {
        const data = await islepilot.getShopSkins();
        return sendJson(res, 200, data);
    }

    // ── 4.1. Gara Khủng long ─────────────────────────────────────────────────
    if (pathname === '/api/player/garage') {
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 401, { ok: false, err: 'chua_dang_nhap', slots: [] });
        const data = await islepilot.getPlayerGarage(steamId);
        return sendJson(res, 200, data);
    }

    if (pathname === '/api/player/garage/store' || pathname === '/api/player/garage/park') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, err: 'method_not_allowed' });
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 401, { ok: false, err: 'chua_dang_nhap' });

        const parkRes = await islepilot.parkDino(steamId);
        if (parkRes.ok) {
            return sendJson(res, 200, {
                ok: true,
                slot: bodyJson.slot || 1,
                cho: 30,
                di_xa_m: 3
            });
        }
        return sendJson(res, 200, {
            ok: false,
            res: parkRes.error || 'Không thể cất khủng long vào gara lúc này.'
        });
    }

    if (pathname === '/api/player/garage/load' || pathname === '/api/player/garage/restore') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, err: 'method_not_allowed' });
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 401, { ok: false, err: 'chua_dang_nhap' });

        let dinoId = bodyJson.id || bodyJson.garageDinoId;
        if (!dinoId && typeof bodyJson.slot === 'number') {
            const gData = await islepilot.getPlayerGarage(steamId);
            const found = (gData.slots || []).find(s => s.slot === bodyJson.slot);
            if (found && found.id) {
                dinoId = found.id;
            } else {
                return sendJson(res, 200, { ok: false, res: `Không tìm thấy khủng long ở ô ${bodyJson.slot}.` });
            }
        }

        if (!dinoId) {
            return sendJson(res, 200, { ok: false, res: 'Thiếu thông tin ô hoặc mã khủng long cần lấy.' });
        }

        const restoreRes = await islepilot.restoreDino(steamId, dinoId);
        if (restoreRes.ok) {
            return sendJson(res, 200, {
                ok: true,
                cho_lay_s: 60,
                di_xa_m: 3,
                noi_hien: 'tai_cho'
            });
        }
        return sendJson(res, 200, {
            ok: false,
            res: restoreRes.error || 'Không thể lấy khủng long ra lúc này.'
        });
    }

    if (pathname === '/api/player/live') {
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 200, { ok: true, in_game: false, song: { in_game: false } });
        const data = await islepilot.getLivePlayer(steamId);
        return sendJson(res, 200, data);
    }

    if (pathname === '/api/player/map') {
        const steamId = getAuthSteamId(req, session);
        if (!steamId) return sendJson(res, 200, { ok: true, in_game: false });
        const data = await islepilot.getPlayerMap(steamId);
        return sendJson(res, 200, data);
    }

    if (pathname === '/api/player/skin/quyen') {
        return sendJson(res, 200, { ok: true, mo: true, gioi_han_mau: false, tuap: true });
    }
    if (pathname === '/api/player/skin/bang-mau') return sendJson(res, 200, { ok: true, mau: [] });
    if (pathname === '/api/player/bo-mau') return sendJson(res, 200, { ok: true, bo: [] });
    if (pathname === '/api/player/skin/kho') return sendJson(res, 200, { ok: true, bo: [], ca_kho: false });
    if (pathname === '/api/player/skin/gradient') return sendJson(res, 200, { ok: true, bat: false, duoc: true, bo: [] });

    // ── 5. Status & Leaderboard ──────────────────────────────────────────────
    if (pathname === '/api/status' || pathname === '/api/status.json') {
        const data = await islepilot.getRealStatus();
        return sendJson(res, 200, data);
    }

    if (pathname === '/api/bxh' || pathname === '/api/bang-xep-hang.json') {
        const data = await islepilot.getRealLeaderboard();
        return sendJson(res, 200, data);
    }

    // ── 6. Phục vụ file tĩnh ─────────────────────────────────────────────────
    let filePath = path.join(webDir, pathname);

    // Nếu vào trang chủ /
    if (pathname === '/') {
        filePath = path.join(webDir, 'index.html');
    }

    // Nếu đường dẫn không có đuôi .html
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
        filePath = filePath + '.html';
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return sendFile(res, filePath);
    }

    // Proxy asset 3D nếu thiếu
    if (pathname.startsWith('/assets/vendor/three') || pathname.startsWith('/assets/dino/')) {
        try {
            const remoteUrl = `https://dino4vn.com${pathname}`;
            const remoteRes = await fetch(remoteUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (remoteRes.ok) {
                const buffer = Buffer.from(await remoteRes.arrayBuffer());
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, buffer);
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
                return res.end(buffer);
            }
        } catch (e) {}
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
}

// Đồng bộ IslePilot định kỳ
async function syncIslePilotData() {
    try {
        const [status_payload, bxh_data] = await Promise.all([
            islepilot.getRealStatus(),
            islepilot.getRealLeaderboard()
        ]);
        const destApi = path.join(webDir, 'api');
        fs.mkdirSync(destApi, { recursive: true });
        fs.writeFileSync(path.join(destApi, 'status.json'), JSON.stringify(status_payload, null, 2));
        fs.writeFileSync(path.join(destApi, 'bang-xep-hang.json'), JSON.stringify(bxh_data, null, 2));
    } catch (err) {}
}
syncIslePilotData();
setInterval(syncIslePilotData, 15000);

function startServer(port) {
    const server = http.createServer((req, res) => handleRequest(req, res, port));

    server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[Cảnh báo] Cổng ${port} đang bận, tự động chuyển sang cổng ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('[Lỗi Server]:', err.message);
        }
    });

    server.listen(port, () => {
        console.log(`=======================================================`);
        console.log(` Web Server Dino4VN & Steam Login đang chạy tại:`);
        console.log(` http://localhost:${port}`);
        console.log(`=======================================================`);
    });
}

startServer(PORT);
