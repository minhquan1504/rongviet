const { verify, parseCookies, getSteamIdFromRequest } = require('../_auth');

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const cookies = parseCookies(req);
    const token = cookies['dino4vn_steam_session'] || cookies['rongviet_session'] || cookies['session'];
    const user = verify(token);

    if (user && user.logged_in) {
        return res.status(200).json(user);
    }

    const steamId = getSteamIdFromRequest(req);
    if (steamId) {
        return res.status(200).json({
            logged_in: true,
            steamid: steamId,
            name: `Steam ...${steamId.slice(-4)}`,
            avatar: '',
            profileurl: `https://steamcommunity.com/profiles/${steamId}`
        });
    }

    return res.status(200).json({ logged_in: false });
};
