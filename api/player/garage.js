const { getSteamIdFromRequest } = require('../_auth');
const islepilot = require('../../services/islepilot');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const steamId = getSteamIdFromRequest(req);
    if (!steamId) {
        return res.status(401).json({ ok: false, err: 'chua_dang_nhap' });
    }

    const data = await islepilot.getPlayerGarage(steamId);
    return res.json(data);
};