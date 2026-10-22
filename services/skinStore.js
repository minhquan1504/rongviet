/**
 * Skin Persistence Store
 * Lưu trữ vĩnh viễn màu sắc và ngoại trang tùy chỉnh của từng người chơi theo SteamID
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SKINS_FILE = path.join(DATA_DIR, 'player_skins.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Bảng màu mặc định tự nhiên chuẩn 10 vùng cho từng loài The Isle
const DEFAULT_SKINS = {
    'Spinosaurus': { body: '#38393b', flank: '#4a4b4e', underbelly: '#75787b', markings: '#6e3b32', pattern: '#6e3b32', eyes: '#16a34a' },
    'Tyrannosaurus': { body: '#4a4039', flank: '#5c5047', underbelly: '#827364', markings: '#2d251e', pattern: '#2d251e', eyes: '#b87333' },
    'Triceratops': { body: '#595046', flank: '#6c6256', underbelly: '#8a7e6f', markings: '#3d342a', pattern: '#3d342a', eyes: '#a3702c' },
    'Carnotaurus': { body: '#613d30', flank: '#7a4d3d', underbelly: '#946c5a', markings: '#3b2219', pattern: '#3b2219', eyes: '#c2410c' },
    'Ceratosaurus': { body: '#475569', flank: '#5b6b80', underbelly: '#94a3b8', markings: '#1e293b', pattern: '#1e293b', eyes: '#eab308' },
    'Deinosuchus': { body: '#2d3748', flank: '#3d4b61', underbelly: '#4a5568', markings: '#1a202c', pattern: '#1a202c', eyes: '#d69e2e' },
    'Allosaurus': { body: '#3f3f46', flank: '#52525b', underbelly: '#71717a', markings: '#18181b', pattern: '#18181b', eyes: '#f59e0b' },
    'Giga': { body: '#3b4252', flank: '#4c566a', underbelly: '#65738c', markings: '#2e3440', pattern: '#2e3440', eyes: '#ebcb8b' },
    'Giganotosaurus': { body: '#3b4252', flank: '#4c566a', underbelly: '#65738c', markings: '#2e3440', pattern: '#2e3440', eyes: '#ebcb8b' },
    'Stegosaurus': { body: '#365314', flank: '#446618', underbelly: '#4d7c0f', markings: '#1a2e05', pattern: '#1a2e05', eyes: '#ca8a04' },
    'Anky': { body: '#451a03', flank: '#5c2304', underbelly: '#78350f', markings: '#290e02', pattern: '#290e02', eyes: '#f59e0b' },
    'Ankylosaurus': { body: '#451a03', flank: '#5c2304', underbelly: '#78350f', markings: '#290e02', pattern: '#290e02', eyes: '#f59e0b' },
    'Dilophosaurus': { body: '#14532d', flank: '#156b37', underbelly: '#16a34a', markings: '#052e16', pattern: '#052e16', eyes: '#ef4444' },
    'Omniraptor': { body: '#1c1917', flank: '#292524', underbelly: '#44403c', markings: '#0c0a09', pattern: '#0c0a09', eyes: '#dc2626' },
    'Pteranodon': { body: '#475569', flank: '#5b6b80', underbelly: '#94a3b8', markings: '#1e293b', pattern: '#1e293b', eyes: '#3b82f6' },
    'Gallimimus': { body: '#854d0e', flank: '#a15d12', underbelly: '#ca8a04', markings: '#422006', pattern: '#422006', eyes: '#10b981' },
    'Pachycephalosaurus': { body: '#713f12', flank: '#8a4d16', underbelly: '#a16207', markings: '#3f1d07', pattern: '#3f1d07', eyes: '#f97316' },
    'Tenontosaurus': { body: '#3f3f46', flank: '#52525b', underbelly: '#71717a', markings: '#27272a', pattern: '#27272a', eyes: '#84cc16' },
    'Troodon': { body: '#312e81', flank: '#3730a3', underbelly: '#4338ca', markings: '#1e1b4b', pattern: '#1e1b4b', eyes: '#e11d48' },
    'Dryosaurus': { body: '#78350f', flank: '#92400e', underbelly: '#b45309', markings: '#451a03', pattern: '#451a03', eyes: '#eab308' },
    'Hypsilophodon': { body: '#15803d', flank: '#16a34a', underbelly: '#22c55e', markings: '#14532d', pattern: '#14532d', eyes: '#f59e0b' },
    'Beipiaosaurus': { body: '#0f172a', flank: '#1e293b', underbelly: '#334155', markings: '#020617', pattern: '#020617', eyes: '#06b6d4' },
    'Herrerasaurus': { body: '#374151', flank: '#4b5563', underbelly: '#6b7280', markings: '#1f2937', pattern: '#1f2937', eyes: '#e11d48' },
    'Diabloceratops': { body: '#581c87', flank: '#6b21a8', underbelly: '#7e22ce', markings: '#3b0764', pattern: '#3b0764', eyes: '#eab308' },
    'Avaceratops': { body: '#4d4637', flank: '#5e5644', underbelly: '#7c735d', markings: '#2d291f', pattern: '#2d291f', eyes: '#d97706' },
    'Austroraptor': { body: '#1e293b', flank: '#334155', underbelly: '#475569', markings: '#0f172a', pattern: '#0f172a', eyes: '#06b6d4' },
    'Baryonyx': { body: '#334155', flank: '#475569', underbelly: '#64748b', markings: '#1e293b', pattern: '#1e293b', eyes: '#f59e0b' },
    'Suchomimus': { body: '#3f3f46', flank: '#52525b', underbelly: '#71717a', markings: '#27272a', pattern: '#27272a', eyes: '#f59e0b' },
    'Camarasaurus': { body: '#451a03', flank: '#5c2304', underbelly: '#78350f', markings: '#290e02', pattern: '#290e02', eyes: '#ca8a04' },
    'Compsognathus': { body: '#166534', flank: '#15803d', underbelly: '#22c55e', markings: '#14532d', pattern: '#14532d', eyes: '#eab308' },
    'Maiasaura': { body: '#57534e', flank: '#6b6661', underbelly: '#8a857e', markings: '#292524', pattern: '#292524', eyes: '#d97706' },
    'Kentrosaurus': { body: '#365314', flank: '#446618', underbelly: '#4d7c0f', markings: '#1a2e05', pattern: '#1a2e05', eyes: '#eab308' },
    'Oviraptor': { body: '#701a75', flank: '#86198f', underbelly: '#a21caf', markings: '#4a044e', pattern: '#4a044e', eyes: '#38bdf8' },
    'Psittacosaurus': { body: '#78350f', flank: '#92400e', underbelly: '#b45309', markings: '#451a03', pattern: '#451a03', eyes: '#eab308' },
    'Quetzalcoatlus': { body: '#1e1b4b', flank: '#2e2870', underbelly: '#4338ca', markings: '#0f0e26', pattern: '#0f0e26', eyes: '#f43f5e' }
};

function normalizeSpecies(name) {
    if (!name) return 'Spinosaurus';
    let s = String(name).trim();
    if (s.startsWith('TI') && s.length > 2 && /[A-Z]/.test(s[2])) {
        s = s.substring(2);
    }
    const map = {
        'spino': 'Spinosaurus',
        'spinosaurus': 'Spinosaurus',
        'giga': 'Giganotosaurus',
        'giganotosaurus': 'Giganotosaurus',
        'rex': 'Tyrannosaurus',
        'trex': 'Tyrannosaurus',
        't-rex': 'Tyrannosaurus',
        'tyrannosaurus': 'Tyrannosaurus',
        'carno': 'Carnotaurus',
        'carnotaurus': 'Carnotaurus',
        'cera': 'Ceratosaurus',
        'ceratosaurus': 'Ceratosaurus',
        'deino': 'Deinosuchus',
        'deinosuchus': 'Deinosuchus',
        'diablo': 'Diabloceratops',
        'diabloceratops': 'Diabloceratops',
        'dilo': 'Dilophosaurus',
        'dilophosaurus': 'Dilophosaurus',
        'dryo': 'Dryosaurus',
        'dryosaurus': 'Dryosaurus',
        'galli': 'Gallimimus',
        'gallimimus': 'Gallimimus',
        'herrera': 'Herrerasaurus',
        'herrerasaurus': 'Herrerasaurus',
        'hypsi': 'Hypsilophodon',
        'hypsilophodon': 'Hypsilophodon',
        'kentro': 'Kentrosaurus',
        'kentrosaurus': 'Kentrosaurus',
        'maia': 'Maiasaura',
        'maiasaura': 'Maiasaura',
        'omni': 'Omniraptor',
        'raptor': 'Omniraptor',
        'utah': 'Omniraptor',
        'utahraptor': 'Omniraptor',
        'omniraptor': 'Omniraptor',
        'ovi': 'Oviraptor',
        'oviraptor': 'Oviraptor',
        'pachy': 'Pachycephalosaurus',
        'pachycephalosaurus': 'Pachycephalosaurus',
        'ptera': 'Pteranodon',
        'ptero': 'Pteranodon',
        'pteranodon': 'Pteranodon',
        'stego': 'Stegosaurus',
        'stegosaurus': 'Stegosaurus',
        'teno': 'Tenontosaurus',
        'tenon': 'Tenontosaurus',
        'tenonto': 'Tenontosaurus',
        'tenontosaurus': 'Tenontosaurus',
        'trike': 'Triceratops',
        'triceratops': 'Triceratops',
        'troodon': 'Troodon',
        'allo': 'Allosaurus',
        'allosaurus': 'Allosaurus',
        'austro': 'Austroraptor',
        'austroraptor': 'Austroraptor',
        'avac': 'Avaceratops',
        'avaceratops': 'Avaceratops',
        'bary': 'Baryonyx',
        'baryonyx': 'Baryonyx',
        'sucho': 'Suchomimus',
        'suchomimus': 'Suchomimus',
        'beipi': 'Beipiaosaurus',
        'beipiaosaurus': 'Beipiaosaurus',
        'camara': 'Camarasaurus',
        'camarasaurus': 'Camarasaurus',
        'compy': 'Compsognathus',
        'compsognathus': 'Compsognathus',
        'anky': 'Ankylosaurus',
        'ankylosaurus': 'Ankylosaurus',
        'taco': 'Psittacosaurus',
        'psittacosaurus': 'Psittacosaurus',
        'psittacosaurus_base': 'Psittacosaurus',
        'psittacosaurus_highlands': 'Psittacosaurus',
        'psittacosaurus_plains': 'Psittacosaurus',
        'psittacosaurus_coastal': 'Psittacosaurus',
        'quetz': 'Quetzalcoatlus',
        'quetzalcoatlus': 'Quetzalcoatlus'
    };
    const lower = s.toLowerCase();
    if (map[lower]) return map[lower];
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function readAllSkins() {
    try {
        if (fs.existsSync(SKINS_FILE)) {
            return JSON.parse(fs.readFileSync(SKINS_FILE, 'utf8'));
        }
    } catch (e) {
        console.warn('Lỗi đọc player_skins.json:', e.message);
    }
    return {};
}

function writeAllSkins(data) {
    try {
        fs.writeFileSync(SKINS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Lỗi ghi player_skins.json:', e.message);
    }
}

function getSkin(steamId, species) {
    if (!steamId) return null;
    const all = readAllSkins();
    const playerSkins = all[steamId] || {};
    const key = (species || 'default').toLowerCase();

    if (playerSkins[key]) {
        const pSkin = playerSkins[key];
        const colors = { ...(pSkin.colors || {}) };
        if (colors.markings && !colors.pattern) colors.pattern = colors.markings;
        if (colors.pattern && !colors.markings) colors.markings = colors.pattern;
        return {
            species: pSkin.species || normalizeSpecies(species),
            colors: colors,
            skin: pSkin.skin || { variation: 0, pattern: 1, theme: 0 }
        };
    }

    // Trả về màu mặc định theo loài nếu người chơi chưa tùy chỉnh
    const norm = normalizeSpecies(species);
    const def = DEFAULT_SKINS[species] || DEFAULT_SKINS[norm] || DEFAULT_SKINS['Spinosaurus'];
    return {
        species: norm,
        colors: { ...def },
        skin: { variation: 0, pattern: 1, theme: 0 }
    };
}

function saveSkin(steamId, species, skinData) {
    if (!steamId) return false;
    const all = readAllSkins();
    if (!all[steamId]) all[steamId] = {};

    const norm = normalizeSpecies(species);
    const key = (norm || 'default').toLowerCase();
    const current = all[steamId][key] || { colors: {}, skin: {} };

    // Lọc sạch các thuộc tính màu sắc hợp lệ của 10 vùng
    const rawColors = skinData.colors || {};
    const cleanColors = {};
    const validColorKeys = ['body', 'flank', 'underbelly', 'markings', 'pattern', 'maleDisplay', 'detail1', 'teeth', 'mouth', 'claws', 'eyes'];
    for (const k of validColorKeys) {
        if (rawColors[k]) cleanColors[k] = rawColors[k];
    }
    // Đồng bộ hai chiều markings <-> pattern
    if (cleanColors.markings && !cleanColors.pattern) cleanColors.pattern = cleanColors.markings;
    if (cleanColors.pattern && !cleanColors.markings) cleanColors.markings = cleanColors.pattern;

    all[steamId][key] = {
        species: norm,
        colors: { ...(current.colors || {}), ...cleanColors },
        skin: { ...(current.skin || {}), ...(skinData.skin || {}) },
        updatedAt: new Date().toISOString()
    };

    writeAllSkins(all);
    return true;
}

module.exports = {
    getSkin,
    saveSkin,
    normalizeSpecies,
    DEFAULT_SKINS
};
