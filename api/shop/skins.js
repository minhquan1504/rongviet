const islepilot = require('../../services/islepilot');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const data = await islepilot.getShopSkins();
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
