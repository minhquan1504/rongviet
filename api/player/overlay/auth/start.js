const { getBaseUrl } = require('../../../_auth');
const overlayAuth = require('../../../../services/overlayAuth');

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const baseUrl = getBaseUrl(req);
    const sessionData = overlayAuth.startSession(baseUrl);
    return res.status(200).json(sessionData);
};
