const { getBaseUrl } = require('../_auth');

module.exports = function handler(req, res) {
    const returnTo = req.query.return || req.query.ve || '/me';
    const baseUrl = getBaseUrl(req);
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

    const steamLoginUrl = `https://steamcommunity.com/openid/login?${openidParams.toString()}`;

    const cookiesToSet = [
        `dino4vn_return_to=${encodeURIComponent(returnTo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`
    ];
    if (req.query.device_code) {
        cookiesToSet.push(`dino4vn_device_code=${encodeURIComponent(req.query.device_code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    }

    res.setHeader('Set-Cookie', cookiesToSet);
    res.writeHead(302, { Location: steamLoginUrl });
    res.end();
};
