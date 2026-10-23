const { getSteamIdFromRequest } = require('../_auth');
const islepilot = require('../../services/islepilot');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const steamId = getSteamIdFromRequest(req);
    if (!steamId) {
        return res.status(401).json({ ok: false, err: 'chua_dang_nhap', slots: [] });
    }

    if (req.method === 'POST') {
        const body = req.body || {};
        const action = req.query?.action || body.action;

        // Cất khủng long (Park Dino)
        if (action === 'store' || action === 'park' || req.url.includes('/store') || req.url.includes('/park')) {
            const parkRes = await islepilot.parkDino(steamId);
            if (parkRes.ok) {
                return res.json({
                    ok: true,
                    slot: body.slot || 1,
                    cho: 30,
                    di_xa_m: 3
                });
            }
            return res.json({
                ok: false,
                res: parkRes.error || 'Không thể cất khủng long vào gara lúc này.'
            });
        }

        // Lấy khủng long ra (Restore Dino)
        if (action === 'load' || action === 'restore' || req.url.includes('/load') || req.url.includes('/restore')) {
            let dinoId = body.id || body.garageDinoId;
            if (!dinoId && typeof body.slot === 'number') {
                const gData = await islepilot.getPlayerGarage(steamId);
                const found = (gData.slots || []).find(s => s.slot === body.slot);
                if (found && found.id) {
                    dinoId = found.id;
                } else {
                    return res.json({ ok: false, res: `Không tìm thấy khủng long ở ô ${body.slot}.` });
                }
            }

            if (!dinoId) {
                return res.json({ ok: false, res: 'Thiếu thông tin ô hoặc mã khủng long cần lấy.' });
            }

            const restoreRes = await islepilot.restoreDino(steamId, dinoId);
            if (restoreRes.ok) {
                return res.json({
                    ok: true,
                    cho_lay_s: 60,
                    di_xa_m: 3,
                    noi_hien: 'tai_cho'
                });
            }
            return res.json({
                ok: false,
                res: restoreRes.error || 'Không thể lấy khủng long ra lúc này.'
            });
        }

        // Xoá ô gara (Delete Dino Slot)
        if (action === 'delete' || req.url.includes('/delete')) {
            return res.json({
                ok: true,
                da_xoa: true,
                cau: `Đã xoá ô ${body.slot || 1}.`
            });
        }

        return res.status(400).json({ ok: false, error: 'Thao tác gara không hợp lệ.' });
    }

    const data = await islepilot.getPlayerGarage(steamId);
    if (!data.quota || typeof data.quota !== 'number' || data.quota <= 0) {
        data.quota = 3;
    }
    return res.json(data);
};