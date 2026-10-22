const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dino4vn_steam_auth_secret_key_2026';

function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    return ${data}.;
}

function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const idx = token.lastIndexOf('.');
    if (idx === -1) return null;
    const data = token.substring(0, idx);
    const sig = token.substring(idx + 1);
    const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig.length !== expectedSig.length) return null;
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
        return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function parseCookies(req) {
    const list = {};
    const rc = req.headers?.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
        });
    }
    return list;
}

function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:3000';
    return ${proto}://System.Management.Automation.Internal.Host.InternalHost;
}

function getSteamIdFromRequest(req) {
    if (!req) return null;
    
    // 1. Check signed cookie
    const cookies = parseCookies(req);
    const token = cookies['dino4vn_steam_session'] || cookies['rongviet_session'] || cookies['session'];
    const user = verify(token);
    if (user && user.logged_in && user.steamid) {
        return user.steamid;
    }

    // 2. Check query params (used by Desktop Launcher)
    let qId = req.query?.steamid || req.query?.steamid64;
    if (!qId && req.url && req.url.includes('?')) {
        try {
            const parsed = new URL(req.url, 'http://localhost');
            qId = parsed.searchParams.get('steamid') || parsed.searchParams.get('steamid64');
        } catch {}
    }
    if (qId && typeof qId === 'string' && /^\d{17}$/.test(qId.trim())) {
        return qId.trim();
    }

    // 3. Check request headers (used by Desktop Launcher)
    const hId = req.headers?.['x-steam-id'] || req.headers?.['x-steamid64'];
    if (hId && typeof hId === 'string' && /^\d{17}$/.test(hId.trim())) {
        return hId.trim();
    }

    return null;
}

module.exports = {
    sign,
    verify,
    parseCookies,
    getBaseUrl,
    getSteamIdFromRequest
};