const { getSteamIdFromRequest } = require('../_auth');
const islepilot = require('../../services/islepilot');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const steamId = getSteamIdFromRequest(req);
    if (!steamId) {
        return res.status(401).json({ ok: false, in_game: false, err: 'chua_dang_nhap' });
    }

    const data = await islepilot.getPlayerMap(steamId);
    return res.json(data);
};