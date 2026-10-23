const overlayAuth = require('../../../../services/overlayAuth');

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const body = req.body || {};
    const deviceCode = body.ma_thiet_bi || req.query.ma_thiet_bi;
    const secret = body.bi_mat || req.query.bi_mat;

    if (!deviceCode || !secret) {
        return res.status(400).json({ trang_thai: 'thieu_tham_so' });
    }

    const pollResult = overlayAuth.pollSession(deviceCode, secret);
    return res.status(200).json(pollResult);
};
