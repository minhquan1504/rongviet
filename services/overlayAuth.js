const crypto = require('crypto');

const sessions = new Map();

function cleanExpired() {
    const now = Date.now();
    for (const [code, item] of sessions.entries()) {
        if (item.expiresAt < now) {
            sessions.delete(code);
        }
    }
}

function startSession(baseUrl) {
    cleanExpired();
    const deviceCode = crypto.randomBytes(6).toString('hex');
    const secret = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    
    sessions.set(deviceCode, {
        secret,
        status: 'cho',
        steamid64: null,
        token: null,
        createdAt: now,
        expiresAt: now + 300 * 1000 // 5 minutes
    });

    const loginUrl = `${baseUrl}/api/auth/steam?device_code=${deviceCode}`;
    return {
        ma_thiet_bi: deviceCode,
        bi_mat: secret,
        url: loginUrl,
        het_han_sau_s: 300,
        nhip_hoi_s: 3
    };
}

function pollSession(deviceCode, secret) {
    cleanExpired();
    const item = sessions.get(deviceCode);
    if (!item) {
        return { trang_thai: 'het_han' };
    }
    if (item.secret !== secret) {
        return { trang_thai: 'sai_bi_mat' };
    }
    if (item.status === 'xong') {
        return {
            trang_thai: 'xong',
            steamid64: item.steamid64,
            token: item.token,
            ten_cookie: 'dino4vn_session'
        };
    }
    return { trang_thai: 'cho' };
}

function completeSession(deviceCode, steamId, token) {
    const item = sessions.get(deviceCode);
    if (item) {
        item.status = 'xong';
        item.steamid64 = steamId;
        item.token = token;
        return true;
    }
    return false;
}

module.exports = {
    startSession,
    pollSession,
    completeSession
};
