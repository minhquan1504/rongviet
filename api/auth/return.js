const { sign, parseCookies } = require('../_auth');

module.exports = async function handler(req, res) {
    try {
        const query = req.query || {};

        if (!query['openid.mode']) {
            return res.status(400).send('Phản hồi không hợp lệ từ Steam.');
        }

        if (query['openid.mode'] === 'cancel') {
            return res.writeHead(302, { Location: '/' }).end();
        }

        // Verify OpenID 2.0 signature directly with Steam
        const verificationParams = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            verificationParams.append(key, value);
        }
        verificationParams.set('openid.mode', 'check_authentication');

        const verifyResponse = await fetch('https://steamcommunity.com/openid/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: verificationParams.toString()
        });

        const verifyText = await verifyResponse.text();
        const isValid = verifyText.split('\n').some(line => line.trim() === 'is_valid:true');

        if (!isValid) {
            console.error('Steam OpenID verification failed:', verifyText);
            return res.status(401).send('Xác thực chữ ký Steam thất bại.');
        }

        const claimedId = query['openid.claimed_id'] || query['openid.identity'] || '';
        const match = claimedId.match(/\/id\/(\d+)/);
        if (!match) {
            return res.status(400).send('Không tìm thấy SteamID hợp lệ trong phản hồi từ Steam.');
        }

        const steamId = match[1];

        let name = `Steam ...${steamId.slice(-4)}`;
        let avatar = '';
        let profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
        let country = '';
        let fetched = false;

        const apiKey = (process.env.STEAM_API_KEY || '').trim();
        if (apiKey) {
            try {
                const summaryRes = await fetch(
                    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
                );
                if (summaryRes.ok) {
                    const data = await summaryRes.json();
                    const player = data?.response?.players?.[0];
                    if (player) {
                        name = player.personaname || name;
                        avatar = player.avatarfull || player.avatarmedium || player.avatar || '';
                        profileUrl = player.profileurl || profileUrl;
                        country = player.loccountrycode || '';
                        fetched = true;
                    }
                }
            } catch (err) {
                console.warn('Steam API key fetch error:', err.message);
            }
        }

        if (!fetched) {
            try {
                const xmlRes = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                if (xmlRes.ok) {
                    const xmlText = await xmlRes.text();
                    const nameMatch = xmlText.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
                    const avatarMatch = xmlText.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
                    const locationMatch = xmlText.match(/<location><!\[CDATA\[(.*?)\]\]><\/location>/);
                    if (nameMatch && nameMatch[1]) name = nameMatch[1];
                    if (avatarMatch && avatarMatch[1]) avatar = avatarMatch[1];
                    if (locationMatch && locationMatch[1]) country = locationMatch[1];
                }
            } catch (xmlErr) {
                console.warn('XML profile fetch error:', xmlErr.message);
            }
        }

        const userPayload = {
            logged_in: true,
            steamid: steamId,
            name: name,
            avatar: avatar,
            profileurl: profileUrl,
            country: country
        };

        const sessionToken = sign(userPayload);

        const cookies = parseCookies(req);
        const deviceCode = cookies['dino4vn_device_code'] ? decodeURIComponent(cookies['dino4vn_device_code']) : null;
        if (deviceCode) {
            try {
                const overlayAuth = require('../../services/overlayAuth');
                overlayAuth.completeSession(deviceCode, steamId, sessionToken);
            } catch (e) {}
        }

        const returnTo = cookies['dino4vn_return_to'] ? decodeURIComponent(cookies['dino4vn_return_to']) : '/me';
        const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/me';

        const cookieSession = `dino4vn_steam_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`;
        const cookieClear = `dino4vn_return_to=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
        const cookieClearDev = `dino4vn_device_code=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;

        res.setHeader('Set-Cookie', [cookieSession, cookieClear, cookieClearDev]);
        res.writeHead(302, { Location: safeReturn });
        res.end();
    } catch (err) {
        console.error('Lỗi xử lý phản hồi từ Steam:', err);
        return res.status(500).send('Có lỗi xảy ra khi xác thực với Steam.');
    }
};
