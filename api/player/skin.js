const { getSteamIdFromRequest } = require('../_auth');
const islepilot = require('../../services/islepilot');
const skinStore = require('../../services/skinStore');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const steamId = getSteamIdFromRequest(req);
    if (!steamId) {
        return res.status(401).json({ ok: false, err: 'chua_dang_nhap' });
    }

    const live = await islepilot.getLivePlayer(steamId);
    const species = live?.song?.species || 'Spinosaurus';

    if (req.method === 'POST') {
        const body = req.body || {};
        // 1. Luôn lưu vào kho skin cục bộ để bảo toàn tùy chỉnh người chơi
        skinStore.saveSkin(steamId, body.species || species, {
            colors: body.colors || body,
            skin: body.skin || {
                variation: body.variation,
                pattern: body.pattern,
                theme: body.theme
            }
        });

        // 2. Tích hợp gửi sang IslePilot API
        let pilotResult = null;
        if (body.presetId) {
            pilotResult = await islepilot.applyPlayerSkinPreset(steamId, body.presetId);
        } else {
            pilotResult = await islepilot.applyPlayerSkin(steamId, body);
        }

        if (pilotResult && pilotResult.ok) {
            return res.json({
                ok: true,
                message: 'Đã áp dụng màu skin vào game thành công!'
            });
        } else {
            return res.json({
                ok: false,
                res: pilotResult?.error || 'Chưa thể áp màu vào game.',
                localSaved: true
            });
        }
    }

    const [savedSkin, skinsData] = await Promise.all([
        Promise.resolve(skinStore.getSkin(steamId, species) || {}),
        islepilot.getPlayerSkins(steamId)
    ]);

    res.json({
        ok: true,
        species: species,
        female: live?.song?.gender === 'female',
        growth: live?.song?.growth || 1.0,
        colors: savedSkin.colors || {},
        skin: savedSkin.skin || { variation: 0, pattern: 1, theme: 0 },
        presets: skinsData.skins || []
    });
};
