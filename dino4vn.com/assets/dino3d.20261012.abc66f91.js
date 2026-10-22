/* ============================================================================
   Dino4VN — bộ xem 3D khủng long. ES module, CHỈ được tải khi cần.

   Dùng chung cho `/gara` (xem một con trong gara) và `/skin` (trình sửa ngoại
   trang). Một file, hai trang — không nhân bản 458 dòng shader.

   ĐỌC TRƯỚC KHI SỬA — bốn ràng buộc đã đo, không phải phỏng đoán:

   1. CSP `script-src 'self'` KHÔNG có `'wasm-unsafe-eval'` ⇒ mọi bộ giải nén
      WebAssembly ném lỗi. Nghĩa là KHÔNG Draco, KHÔNG meshopt, KHÔNG KTX2.
      Nén hình học chỉ còn `KHR_mesh_quantization` (three hỗ trợ sẵn).

   2. CSP KHÔNG có `blob:` (chỉ `img-src 'self' data:`). `GLTFLoader` biến ảnh
      NHÚNG trong .glb thành `URL.createObjectURL` ⇒ **texture nhúng sẽ im lặng
      không lên màu**. Hình học vẫn hiện, nên lỗi này rất dễ bỏ sót.
      ⇒ LUẬT: texture phải là file NGOÀI cùng origin, không bao giờ nhúng.

   3. Quy ước repo: KHÔNG đụng `.style` (chặt hơn CSP). Kích thước canvas do CSS
      lo; ta chỉ gọi `setSize(w, h, false)` — tham số thứ ba `updateStyle=false`
      giữ cho three KHÔNG ghi vào `canvas.style`. Đó là cả mẹo.

   4. `FLinearColor` là ánh sáng TUYẾN TÍNH và có thể vượt 1.0. Đưa cho three qua
      `setRGB(r, g, b, LinearSRGBColorSpace)` rồi để nó tự chuyển ở khâu xuất.
      Tự đổi sang hex trước rồi nạp lại = áp hàm truyền HAI LẦN = bạc màu.
      (Phía 2D thì `garage_index.py` đã chuyển sẵn sang hex — đó là đường khác.)

   ── HỢP ĐỒNG VỚI TRANG (chỉ qua DOM + sự kiện, KHÔNG biến toàn cục) ─────────

   Markup: một phần tử `.v3d` duy nhất, bên trong có `.v3d__canvas` và
   `.v3d__msg`. `.v3d__ghi` được tìm trên CẢ TRANG (trang `/skin` đặt nó ngoài
   khung). Trang nào muốn tự nạp con dino trong gara thì thêm
   `data-tunap="gara"` + `data-slot="N"` — **opt-in tường minh**, xem cuối file.

   Sự kiện VÀO:
     `dino4vn:xem3d`  {species, colors, growth, slot?, canh?}  nạp/đổi hẳn con đang xem
     `dino4vn:3d`     {loai?, mau?, lon?, canh?}        cập nhật TỪNG PHẦN
                      (`canh` = id trong `manifest.canh`, "" = nền tối; chỉ khung `data-chat="cao"`)
   Sự kiện RA:
     `dino4vn:3d-xong` {slug, species, batMask, khe_hienthi[], loi?}
   ========================================================================= */
"use strict";


/* ═══════════════════════════════════════════════════════════════════════════════
   DUNG CHUNG CHO CA TRANG — nap mot lan, moi bo xem dung lai.

   `three` va manifest deu la thu chi nen tai MOT lan. Neu de chung trong factory thi
   mot trang co 4 the se tai `three.module.min.js` bon lan.
   ═════════════════════════════════════════════════════════════════════════════ */
// 🔴 Manifest CO Y nam NGOAI /assets. Ca cay /assets/* duoc phuc vu voi `immutable, max-age=1 nam`,
// ma manifest la DU LIEU se doi moi lan them mo hinh — de trong do thi trinh duyet khong bao gio
// thay ban moi. O goc web, handler mac dinh dat `no-cache`, dung thu ta can.
const DUONG_MANIFEST = "/dino-models.json";

/** Một promise duy nhất cho cả vòng đời trang: three KHÔNG BAO GIỜ được nạp hai lần. */
let napThuVien = null;
/** Module `three` sau khi nap. Dung chung — khong ban nao duoc tu import lai. */
let THREE = null;
let manifest = null;

/* Mã pixel (3 bit) -> tên layer trong bảng `layer_khe` của manifest.
   Ở phạm vi module vì `capNhatMau()` cũng cần, không riêng `apMauMask()`. */
const MA = ["base", "R", "G", "Y", "B", "M", "C", "base"];

/* ── CHẤT LƯỢNG CAO: vảy + độ nhám + ánh sáng môi trường + cảnh nền (2026-10-12) ──────────────
   Chủ server: mô hình của IslePilot "chi tiết hơn của chúng ta nhiều". Đo trang của họ: ngoài .glb
   họ nạp normal map, RAC, vảy chi tiết dùng chung và ánh sáng HDR. Ta nay có cùng bộ đó, trích TỪ
   MATERIAL thân của game (`tools/extract/gen_pbr.py`, khoá `pbr` của manifest) + ảnh toàn cảnh CC0
   (`tools/extract/gen_canh.py`, khoá `canh`).
   🔴 CHỈ khung khai `data-chat="cao"` (/skin) mới nạp: ~1,3 MB mỗi loài, mà /gara có cả chục khung.
   Khung khác giữ nguyên đường cũ (mặt nạ vùng + đèn), không đổi một điểm ảnh. */
const ADDON = "three-addon-r0.185.1-38aa0b8d";      // cùng URL three với vendor => một bản three
/* Độ mạnh lớp vảy chi tiết cộng lên normal của loài (0 = tắt). */
const MANH_VAY = 0.6;

/** Có WebGL thật không. `failIfMajorPerformanceCaveat` để render bằng phần mềm
 *  bị coi như KHÔNG có — trên máy yếu nó tệ hơn là không hiện 3D. */
function coWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
              c.getContext("webgl", { failIfMajorPerformanceCaveat: true }));
  } catch (e) { return false; }
}

function tietKiemDuLieu() {
  const c = navigator.connection;
  return !!(c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g"));
}

/* ── GÀO RÚ: trạng thái dùng chung cả trang ────────────────────────────────────
   Tiếng MẶC ĐỊNH BẬT (người dùng chốt 2026-09-23, đổi từ "mặc định tắt" cùng ngày). Tiếng chỉ phát
   khi người xem BẤM "Gào" — cú bấm đó là thao tác người dùng nên trình duyệt cho phát, không có
   chuyện trang tự kêu lúc mở. Người xem đã tắt thì nhớ trong localStorage ("0"); đọc hỏng (trình
   duyệt riêng tư) thì theo mặc định.
   Mỗi lúc chỉ MỘT con được gào: bấm con thứ hai là con đầu im — /gara có cả chục khung. */
const KHOA_TIENG = "dino4vn.3d.tieng";
let tiengBat = true;
try { tiengBat = localStorage.getItem(KHOA_TIENG) !== "0"; } catch (e) { /* riêng tư: mặc định */ }
/** Mọi bộ xem đăng ký một hàm vẽ lại nút tiếng — bật ở khung này thì khung khác cũng đổi. */
const nutTiengCacKhung = new Set();
function datTieng(bat) {
  tiengBat = !!bat;
  try { localStorage.setItem(KHOA_TIENG, tiengBat ? "1" : "0"); } catch (e) { /* không nhớ được, vẫn chạy */ }
  nutTiengCacKhung.forEach((f) => f());
}
/** Bộ xem đang gào (có `.dung()`), hoặc null. */
let dangGao = null;
function giamChuyenDong() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

async function layManifest() {
  if (manifest) return manifest;
  const r = await fetch(DUONG_MANIFEST, { credentials: "same-origin" });
  if (!r.ok) throw new Error("chua co manifest");
  manifest = await r.json();
  return manifest;
}

async function tai3D() {
  if (napThuVien) return napThuVien;
  napThuVien = (async () => {
    const m = await layManifest();
    const v = m.vendor;                       // ví dụ "three-r180-1a2b3c4d"
    if (!v) throw new Error("manifest thieu truong vendor");
    const three = await import(`/assets/vendor/${v}/three.module.min.js`);
    const { GLTFLoader } = await import(`/assets/vendor/${v}/GLTFLoader.js`);
    return { three, GLTFLoader };
  })();
  return napThuVien;
}


/* ═══════════════════════════════════════════════════════════════════════════════
   MOT BO XEM = MOT KHUNG `.v3d`

   🔴 MOI BAN CHIEM MOT WebGL CONTEXT. Trinh duyet gioi han khoang 8–16 context cho
      ca tab; qua nguong thi cai cu bi thu hoi va khung do trang tron. Nen ai dung
      factory nay cho mot DANH SACH thi phai `huy()` khi the roi khoi khung nhin,
      chu khong duoc tao thoai mai.

   ✅ Nhung dung sinh WebGL context: bo xem nay ve THEO YEU CAU (`ve()`), khong co
      vong lap. Mot khung dung yen ton 0% CPU — nen N khung dung yen cung ton 0%.
      Chi phi that la context + mot lan tai `.glb`, khong phai nhip ve.
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Element} khung  phan tu `.v3d`
 * @param {{ghi?: Element}} [tuyChon]  noi de dong chu thich, neu no khong nam trong khung
 */
function taoBoXem(khung, tuyChon) {
const KHUNG = khung || null;
const CANVAS = KHUNG ? KHUNG.querySelector(".v3d__canvas") : null;
const MSG = KHUNG ? KHUNG.querySelector(".v3d__msg") : null;

/* `.v3d__ghi` co the nam NGOAI khung (trang /skin dat no duoi thanh truot), nen phai
   tim rong hon mot bac. Nhung KHONG duoc rong toi ca trang khi trang co nhieu khung:
   o /gara dieu do se lam moi the ghi de len dong chu thich cua the DAU TIEN. */
const GHI = (tuyChon && tuyChon.ghi)
  || (KHUNG && KHUNG.parentElement && KHUNG.parentElement.querySelector(".v3d__ghi"))
  || (document.querySelectorAll(".v3d").length <= 1
        ? document.querySelector(".v3d__ghi") : null);

let R = null, SCENE = null, CAM = null, MODEL = null, BONG = null;
/* Chất lượng cao (xem khối "CHẤT LƯỢNG CAO" đầu file). PMREM + môi trường trung tính (phòng sáng) và
   ảnh/ánh sáng của cảnh nền đang chọn — giữ để `huy()` trả lại GPU. */
const CHAT_CAO = !(KHUNG && KHUNG.getAttribute("data-chat") === "thap");
let PMREM = null, MT_PHONG = null, NEN = null, MT_NEN = null;
let canhMuon = "";      // cảnh người xem chọn; có thể tới TRƯỚC khi scene dựng xong
let luotCanh = 0;
/* Gào rú — xem khối "GÀO RÚ" gần cuối factory. Khai ở ĐẦU vì `trangThai()` đọc chúng. */
let GAO = null;         // {slug, mixer, action, xuongDau, dang, ...} — bộ hoạt ảnh của loài đang xem
let AM = null;          // <audio> của con đang xem; chỉ tạo khi người xem đã bật tiếng
let DK = null, NUT_GAO = null, NUT_TIENG = null;
let RO = null;          // ResizeObserver — phai giu de `huy()` ngat duoc
let idVe = 0;           // id requestAnimationFrame dang cho
let daHuy = false;
let dangVe = false;

// Camera dạng orbit quanh TIÊU (điểm nhìn). Kéo = xoay, lăn/chụm = zoom.
const TIEU = { x: 0, y: 0.55, z: 0 };
/* Góc mặc định kiểu ĐIỆN ẢNH (người dùng chốt 2026-09-23, thay góc nhìn xuống 21° của 2026-09-14):
   máy đặt THẤP ngang gối con vật và hắt NGƯỢC lên, lệch ~33° khỏi trục mặt về phía trước — cách
   Jurassic Park quay khủng long cho to lớn. Con vật mặt hướng +X sau `yaw` (đo: xương DinoHead của
   Rex nằm ở +Z trong .glb, yaw π/2 đưa sang +X), nên θ = π/2 − 0,58 ≈ 1.0 là 3/4 phía trước.
   φ > π/2 nghĩa là máy DƯỚI điểm nhìn; `capNhatCam` chặn không cho chui xuống đất.
   "Đặt lại góc nhìn" (`canhLaiKhung(true)`) quay về đúng hai số này. */
const GOC_MAC_DINH = { theta: 1.0, phi: 1.66 };
/* Góc RIÊNG cho loài mà góc điện ảnh nhìn hỏng (2026-10-03). Pteranodon dang cánh NẰM NGANG: máy
   thấp ngang gối nhìn hai cánh TỪ MÉP, và khung khớp theo sải cánh nên thân còn bé tí — trên bục
   xếp hạng cả con chỉ là một vệt mảnh, người xem tưởng "không có 3D". Máy đặt CAO nhìn xuống (~36°
   trên tầm ngang) để thấy trọn sải cánh. Khoá là `slug` của manifest. Chỉ áp khi người xem CHƯA tự
   xoay (`gocLaMacDinh`) — giữ đúng luật "đổi loài thì giữ góc người dùng đã xoay" (Review PR #7). */
const GOC_THEO_LOAI = { pteranodon: { theta: 1.57, phi: 0.75, khung: 0.95 } };
const gocCua = (slug) => GOC_THEO_LOAI[slug] || GOC_MAC_DINH;
/* Góc mở dọc 28° ≈ ống kính 48 mm full-frame (2·atan(12/48)). Bản trước 35° (~38 mm) làm mõm to
   ra so với thân khi máy đứng thấp và gần. Lúc gào máy thu hẹp thêm (xem `camGao`). */
const FOV_TINH = 28;
/* Máy không được xuống dưới mặt đất (y = 0 là chân con vật): góc thấp mà thủng sàn thì thấy bụng
   từ bên trong. Tính theo tỉ lệ cỡ đang hiện để con non cũng không bị. */
const DAT_TOI_THIEU = 0.03;
/* Khung ôm CỠ ĐANG HIỆN (con non vẫn to vừa khung) — trừ trang khai
   `data-khung="truong-thanh"` (/skin): ở đó thanh trượt trưởng thành phải làm con vật to/nhỏ
   trong một khung ĐỨNG YÊN, nên khung ôm cỡ con trưởng thành. */
const KHUNG_THEO_TRUONG_THANH = !!(KHUNG && KHUNG.getAttribute("data-khung") === "truong-thanh");
let camR = 4.19, camTheta = GOC_MAC_DINH.theta, camPhi = GOC_MAC_DINH.phi;
let daGanDieuKhien = false;
/* `true` tới khi người xem kéo xoay; nút "Đặt lại góc nhìn" đưa về `true`. Đúng thì mỗi lần nạp loài
   mới, góc theo `gocCua(slug)`; sai thì giữ góc người xem đã chọn. */
let gocLaMacDinh = true;

/* ── Zoom của NGƯỜI DÙNG là một HỆ SỐ, không phải `camR` ──────────────────────
   🔴 Vì sao tách: bản trước, mỗi lần khung hình được canh lại (`khungHinh`) là
   `camR` bị GHI ĐÈ, tức mức zoom người dùng vừa đặt bị xoá. Ở /gara điều đó
   hiếm khi lộ ra vì khung chỉ canh một lần lúc mở. Ở /skin có thanh trượt
   trưởng thành — mỗi nhích chuột sẽ giật camera về mặc định.

   Nay: `camRVua` = bán kính "vừa khung" tính từ hộp bao, `zoomNguoiDung` = hệ
   số người dùng tự đặt. `camR = camRVua * zoomNguoiDung`. Canh lại khung chỉ
   đụng `camRVua`.

   Phụ: kẹp theo HỆ SỐ cũng sửa một lỗi cũ — bản trước kẹp `camR` cứng vào
   [1.8, 8], nên với loài rất lớn (Camarasaurus) mà khung cần camR > 8 thì cuộn
   chuột một cái là con vật nhảy vọt vào mặt.                                 */
let camRVua = 4.19;
let zoomNguoiDung = 1;

/** Trạng thái mô hình đang hiện. `null` = chưa nạp gì.
 *  `hopGoc` đo MỘT LẦN ở scale 1 để thanh trượt không phải duyệt lại cây mesh. */
let HIENTAI = null;
/** Token chống đua tải — xem `taiMoHinh()`. */
let luotTai = 0;
/** Vector dùng lại trong vòng chiếu của `doKhung()` — không cấp phát trong vòng lặp. */
let DIEM_TAM = null;

/** Đặt lại vị trí camera từ (camR, camTheta, camPhi). KHÔNG tự vẽ — caller gọi ve(). */
function capNhatCam() {
  if (!CAM) return;
  datCam(TIEU.x, TIEU.y, TIEU.z, camR, camTheta, camPhi);
}

/** Đặt camera theo toạ độ cầu quanh một điểm nhìn bất kỳ. Dùng chung cho orbit thường và đường
 *  máy lúc gào — hai đường mà lệch công thức là máy giật khi chuyển qua lại. */
function datCam(tx, ty, tz, r, theta, phi) {
  const sp = Math.sin(phi);
  const yMin = DAT_TOI_THIEU * (HIENTAI ? HIENTAI.s || 1 : 1);
  CAM.position.set(
    tx + r * sp * Math.sin(theta),
    Math.max(yMin, ty + r * Math.cos(phi)),
    tz + r * sp * Math.cos(theta),
  );
  CAM.lookAt(tx, ty, tz);
}

function datZoom(k) {
  zoomNguoiDung = Math.max(0.4, Math.min(2.2, zoomNguoiDung * k));
  camR = camRVua * zoomNguoiDung;
}

/** Gắn kéo-xoay + lăn/chụm-zoom lên canvas. Chỉ gắn MỘT lần. Vẫn vẽ-theo-yêu-cầu: mỗi thao tác
 *  gọi ve() đúng một lần, đứng yên tốn 0% CPU. Dùng listener non-passive + preventDefault để chặn
 *  cuộn trang mà KHÔNG phải đụng .style/CSS (giữ quy ước repo). */
function ganDieuKhien() {
  if (daGanDieuKhien || !CANVAS) return;
  daGanDieuKhien = true;
  const pts = new Map();      // pointerId -> {x,y}
  let khoangChum = 0;         // khoảng cách 2 ngón trước đó (pinch)

  CANVAS.addEventListener("pointerdown", (e) => {
    nhaMayGao();                                         // đang gào mà người xem cầm máy: nhường
    CANVAS.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      khoangChum = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  CANVAS.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    e.preventDefault();
    const truoc = pts.get(e.pointerId);
    const nay = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, nay);
    if (pts.size >= 2) {                                 // chụm hai ngón -> zoom
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (khoangChum) datZoom(khoangChum / (d || 1));
      khoangChum = d;
    } else {                                             // một ngón/chuột -> xoay
      camTheta -= (nay.x - truoc.x) * 0.008;
      camPhi   -= (nay.y - truoc.y) * 0.008;
      gocLaMacDinh = false;
      camPhi = Math.max(0.2, Math.min(Math.PI - 0.2, camPhi));
    }
    capNhatCam();
    ve();
  }, { passive: false });

  const nhac = (e) => { pts.delete(e.pointerId); khoangChum = 0; };
  CANVAS.addEventListener("pointerup", nhac);
  CANVAS.addEventListener("pointercancel", nhac);

  CANVAS.addEventListener("wheel", (e) => {
    e.preventDefault();
    nhaMayGao();
    datZoom(1 + Math.sign(e.deltaY) * 0.1);
    capNhatCam();
    ve();
  }, { passive: false });
}

function trangThai(s, chu) {
  if (KHUNG) KHUNG.setAttribute("data-state", s);
  capNhatNutGao();
  if (MSG && chu !== undefined) {
    MSG.textContent = "";
    if (s === "loading-lib" || s === "loading-model") {
      const q = document.createElement("span");
      q.className = "v3d__quay";
      q.setAttribute("aria-hidden", "true");
      MSG.appendChild(q);
    }
    // Trạng thái LUÔN kèm chữ. Dưới `prefers-reduced-motion` vòng quay đứng im
    // (CSS toàn cục ép animation-duration về ~0), nên chữ mới là tín hiệu thật.
    MSG.appendChild(document.createTextNode(chu));
  }
}

function ghiChu(chu) { if (GHI) GHI.textContent = chu || ""; }

/** Báo về cho trang biết chuyện gì vừa xảy ra. Trang /skin dùng nó để làm mờ
 *  những khe màu mà loài này không vẽ được. */
function bao(chiTiet) {
  // Phat tu CHINH khung cua minh, `bubbles` de no van len toi `document` — nho vay
  // listener san co cua /skin khong phai sua. Neu phat thang tren `document` thi o
  // /gara bon the se ban ra bon su kien khong phan biet duoc cua ai.
  const ev = new CustomEvent("dino4vn:3d-xong", { detail: chiTiet, bubbles: true });
  (KHUNG || document).dispatchEvent(ev);
}


function dungScene(three) {
  if (R || daHuy) return;
  THREE = three;
  three.ColorManagement.enabled = true;
  R = new three.WebGLRenderer({
    canvas: CANVAS, antialias: false, alpha: false, stencil: false,
    powerPreference: "low-power", failIfMajorPerformanceCaveat: true,
  });
  R.outputColorSpace = three.SRGBColorSpace;
  R.toneMapping = three.NoToneMapping;        // giữ màu trung thực với giá trị đã lưu
  // Nền khung = `--rung-toi` của site.css (#0A1C13). Để mặc định là nền ĐEN TUYỀN, lạc hẳn
  // khỏi bảng màu của trang (thấy trên preview 2026-09-14).
  R.setClearColor(0x0a1c13, 1);
  // Máy yếu: trần tỉ lệ điểm ảnh. Màn hình cảm ứng siết thêm.
  const coarse = window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
  R.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));

  SCENE = new three.Scene();
  CAM = new three.PerspectiveCamera(FOV_TINH, 4 / 3, 0.1, 100);
  capNhatCam();                                // đặt vị trí từ orbit state
  // Mau da that co the RAT TOI (do duoc: body = #0f2108 ~ RGB 15,33,8). Tren nen #121C18 thi
  // gan nhu khong phan biet duoc voi nen. Nen anh sang phai du de mot mau toi VAN doc ra la mau,
  // va them mot den vien de tach bong khoi nen.
  //
  // Bố trí ĐIỆN ẢNH (2026-09-23): đèn chính THẤP (~20°) từ phía trước-bên, cùng phía máy, để nó
  // lướt qua hàm và răng; đèn viền lạnh từ sau-trên, mạnh hơn trước, để tách hình khối khỏi nền
  // xanh rừng. Tổng sáng giữ gần như cũ vì /skin cần màu đọc đúng — nên KHÔNG đổi tone mapping
  // (ACES/AgX làm lệch màu người chơi vừa chọn) và không hạ đèn trời xuống kiểu phim tối.
  SCENE.add(new three.HemisphereLight(0xdfeae2, 0x2a3a33, 1.8));
  const chinh = new three.DirectionalLight(0xfff3e4, 2.6);
  chinh.position.set(4, 1.6, 3);
  SCENE.add(chinh);
  const tren = new three.DirectionalLight(0xffffff, 0.8);   // đỡ lưng, không để nóc thân tối bệt
  tren.position.set(0, 5, 1);
  SCENE.add(tren);
  const vien = new three.DirectionalLight(0xbfe0d0, 2.4);   // den vien: tach silhouette khoi nen
  vien.position.set(-4, 3.5, -3.5);
  SCENE.add(vien);                                // không đổ bóng: tốn mà không đáng
  BONG = taoBong(three);
  SCENE.add(BONG);
  if (CHAT_CAO) {
    // Ánh sáng môi trường: vảy + độ nhám chỉ "sống" khi có thứ để phản chiếu. Đèn cũ giữ nguyên
    // (màu người chơi chọn phải đọc đúng), môi trường cộng thêm ở mức vừa phải.
    PMREM = new three.PMREMGenerator(R);
    import(`/assets/vendor/${ADDON}/RoomEnvironment.js`).then(({ RoomEnvironment }) => {
      if (daHuy || !PMREM) return;
      MT_PHONG = PMREM.fromScene(new RoomEnvironment(), 0.04).texture;
      apCanh(canhMuon);
    }).catch(() => { /* thiếu addon: vẫn có đèn, chỉ kém bóng bẩy */ });
  }

  // Kích thước hiển thị do CSS quyết; `false` giữ three không ghi vào canvas.style.
  let rongCu = 0, caoCu = 0;
  const doLai = () => {
    const s = CANVAS.parentElement;
    if (!s) return;
    const w = s.clientWidth, h = s.clientHeight;
    if (w < 8 || h < 8) return;                // `content-visibility:auto` có thể báo 0x0
    // ResizeObserver cũng bắn khi khung được chuyển chỗ trong DOM (bục xếp hạng dùng lại bộ
    // xem khi đổi tab) mà cỡ không đổi — khi đó không có gì phải canh lại.
    if (w === rongCu && h === caoCu) return;
    rongCu = w; caoCu = h;
    R.setSize(w, h, false);
    CAM.aspect = w / h;
    CAM.updateProjectionMatrix();
    phuNen();
    // Góc mở NGANG phụ thuộc aspect, nên đổi bề rộng khung là phải tính lại bán
    // kính "vừa khung". Bỏ dòng này thì xoay ngang điện thoại là con vật bị xén.
    // Cùng mốc với lúc nạp (`coKhung`): cỡ đang hiện, hoặc cỡ trưởng thành ở /skin.
    if (HIENTAI) doKhung(coKhung());
    ve();
  };
  RO = new ResizeObserver(doLai);
  RO.observe(CANVAS.parentElement);
  ganDieuKhien();                              // kéo-xoay + lăn/chụm-zoom
  doLai();
}

/** Đặt cảnh nền theo `id` trong `manifest.canh` ("" = nền tối như cũ). Ảnh toàn cảnh làm CẢ nền
 *  (xoay theo góc nhìn) LẪN ánh sáng môi trường — nền và ánh sáng luôn khớp. Chọn cảnh trước khi
 *  scene dựng xong thì nhớ lại (`canhMuon`) và áp ngay khi môi trường sẵn sàng. */
function apCanh(id) {
  canhMuon = id || "";
  if (!CHAT_CAO || !SCENE || !PMREM || !THREE) return;
  const luot = ++luotCanh;
  const ds = (manifest && manifest.canh) || [];
  const c = ds.find((x) => x.id === canhMuon);
  const boCu = () => {
    if (NEN) { NEN.dispose(); NEN = null; }
    if (MT_NEN) { MT_NEN.dispose(); MT_NEN = null; }
  };
  if (!c) {
    boCu();
    SCENE.background = null;
    SCENE.environment = MT_PHONG;
    SCENE.environmentIntensity = 0.45;
    ve();
    return;
  }
  // Hai ảnh (`tools/extract/gen_canh.py`): `nen` = khung phối cảnh 2560×1440 làm nền PHẲNG, nét;
  // `sang` = ảnh toàn cảnh nhỏ chỉ để làm ánh sáng môi trường. Bản đầu dùng một ảnh 360° cho cả hai
  // và nền mờ (chủ server 2026-10-12: "các ảnh background đang rất mờ -> cần nét"): ống kính 28°
  // chỉ thấy ~1/10 ảnh toàn cảnh nên điểm ảnh bị phóng ~3 lần.
  const tai = new THREE.TextureLoader();
  Promise.all([tai.loadAsync(c.nen), tai.loadAsync(c.sang)]).then(([nen, sang]) => {
    if (daHuy || luot !== luotCanh || !SCENE) { nen.dispose(); sang.dispose(); return; }
    nen.colorSpace = THREE.SRGBColorSpace;
    sang.mapping = THREE.EquirectangularReflectionMapping;
    sang.colorSpace = THREE.SRGBColorSpace;
    boCu();
    NEN = nen;
    MT_NEN = PMREM.fromEquirectangular(sang).texture;
    sang.dispose();
    SCENE.background = NEN;
    SCENE.environment = MT_NEN;
    SCENE.environmentIntensity = 0.7;
    phuNen();
    ve();
  }).catch(() => { /* ảnh lỗi: giữ cảnh đang có */ });
}

/** Nền phẳng phủ KÍN khung, giữ đúng tỉ lệ ảnh (kiểu `background-size: cover`): cắt bớt chiều thừa
 *  bằng `repeat`/`offset` của texture. three vẽ nền 2D trải đúng kích thước canvas, nên không canh
 *  thì ảnh bị kéo méo theo tỉ lệ khung. Gọi lại mỗi lần khung đổi cỡ. */
function phuNen() {
  if (!NEN || !NEN.image || !CANVAS) return;
  const s = CANVAS.parentElement;
  const a = s && s.clientHeight ? s.clientWidth / s.clientHeight : 16 / 9;
  const ai = NEN.image.width / NEN.image.height;
  if (a > ai) { NEN.repeat.set(1, ai / a); NEN.offset.set(0, (1 - ai / a) / 2); }
  else { NEN.repeat.set(a / ai, 1); NEN.offset.set((1 - a / ai) / 2, 0); }
}

/** Một texture DỮ LIỆU (normal/RAC): không chuyển màu, gốc toạ độ glTF, lọc dị hướng. */
function napTexDuLieu(url, lap) {
  if (!url) return Promise.resolve(null);
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    if (lap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, R ? R.capabilities.getMaxAnisotropy() : 1);
    t.needsUpdate = true;
    return t;
  }).catch(() => null);
}

/** Vệt bóng dưới chân: một mặt phẳng + ảnh gradient tròn vẽ bằng canvas 2D. Rẻ hơn shadow map
 *  hàng chục lần và không phải vẽ lại khi con vật cử động. Không có nó, góc máy thấp làm con vật
 *  trông như lơ lửng — mắt không có mặt đất để bám. Cỡ đặt theo hộp bao trong `datBong()`. */
function taoBong(three) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new three.CanvasTexture(c);
  const m = new three.Mesh(new three.PlaneGeometry(1, 1),
    new three.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  m.visible = false;
  return m;
}

/** Đặt vệt bóng theo hộp bao (đã đo sau `yaw`) ở hệ số phóng `s`. */
function datBong(s) {
  if (!BONG) return;
  if (!HIENTAI || !HIENTAI.hopGoc) { BONG.visible = false; return; }
  const t = HIENTAI.hopGoc.tam, c = HIENTAI.hopGoc.co;
  BONG.position.set(t.x * s, 0.002 * s, t.z * s);
  BONG.scale.set(c.x * s * 1.15, c.z * s * 1.6, 1);   // plane xoay -90° quanh X: trục y của nó là z thế giới
  BONG.visible = true;
}

/** Vẽ THEO YÊU CẦU, không phải mỗi khung hình. Một khung 3D đứng yên phải tốn 0% CPU —
 *  trên điện thoại đây là tối ưu quan trọng hơn mọi thứ khác cộng lại. */
function ve() {
  if (!R || dangVe || daHuy) return;
  dangVe = true;
  // Giu id: `huy()` phai huy duoc vong cho, khong thi callback chay sau khi `R` da
  // `dispose()` va nem loi trong console cua nguoi choi.
  idVe = requestAnimationFrame(() => {
    idVe = 0; dangVe = false;
    if (!daHuy && R) R.render(SCENE, CAM);
  });
}

function doiTuong(root) {
  // GLTFLoader DÙNG CHUNG một instance vật liệu giữa nhiều mesh. Tô tại chỗ là
  // loang màu sang vùng khác VÀ còn dính sang lần mở sau. Nhân bản trước đã.
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const ds = Array.isArray(o.material) ? o.material : [o.material];
    o.material = ds.map((m) => {
      if (!seen.has(m)) seen.set(m, m.clone());
      return seen.get(m);
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}

/** Áp màu lên vật liệu theo ánh xạ trong manifest.
 *  Trả về {ap: [...], thieu: [...]} — KHÔNG tô bừa khi không khớp. */
function apMau(root, mau, anhXa) {
  const ap = [], thieu = [];
  const theoTen = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m && m.name) theoTen.set(m.name.toLowerCase().trim(), m);
    });
  });
  for (const khe of Object.keys(anhXa || {})) {
    const hex = mau[khe] || (khe === "markings" ? mau.pattern : (khe === "pattern" ? mau.markings : null));
    if (!hex) { thieu.push(khe); continue; }
    const dich = (anhXa[khe].materials || [])
      .map((n) => theoTen.get(String(n).toLowerCase().trim()))
      .filter(Boolean);
    if (!dich.length) { thieu.push(khe); continue; }
    // Màu tới đây ĐÃ là sRGB hex (garage_index.py chuyển sẵn), nên nạp bằng
    // setStyle — three tự hiểu là sRGB. Không tự chuyển lần nữa.
    dich.forEach((m) => { m.color.setStyle(hex, THREE.SRGBColorSpace); });
    ap.push(khe);
  }
  return { ap, thieu };
}

/* ── Chiến lược "mask": tô đủ 10 vùng bằng texture mặt nạ ────────────────────
   The Isle KHÔNG chia vùng bằng material — mesh chỉ có Body + Eye. Mười vùng màu
   được đánh dấu bằng một ảnh mặt nạ **color-coded**, rồi shader chọn màu theo mã
   pixel. Đây là cách chính game làm, đọc từ master material
   `M_MasterSkin_Dinosaur` (6 param Color1..Color6 + Teeth/Mouth/Claw + Eye).

   Mã pixel sau khi ngưỡng hoá ở 0.5:
       000 đen = nền  ·  100 R  ·  010 G  ·  001 B
       011 C(G+B)     ·  101 M(R+B)      ·  110 Y(R+G)
   Tra thành chỉ số 0..7 rồi lấy màu từ một mảng uniform — không rẽ nhánh trong
   shader, chạy được cả trên GPU di động yếu.

   🔴 KHÔNG dùng ShaderMaterial tự viết: mất hết ánh sáng PBR của three. Dùng
   `onBeforeCompile` để chèn vào MeshStandardMaterial — giữ nguyên đổ sáng, chỉ
   thay màu nền.                                                              */
function apMauMask(root, mau, maskTex, layerKhe, pbr) {
  const bang = new Array(8);
  const dung = new Set();
  for (let i = 0; i < 8; i++) bang[i] = new THREE.Color();
  napBang(bang, mau, layerKhe, dung);

  // 🔴 BỐN DÒNG NÀY ĐỀU LOAD-BEARING. Mặt nạ là DỮ LIỆU mã hoá theo mã màu, không
  //    phải ảnh — mọi phép nội suy đều phá mã.
  //
  //    `generateMipmaps=false` + `NearestFilter`: texture vùng của The Isle DITHERING
  //    RẤT DÀY (pixel xen kẽ hai vùng ở tần số cao để chuyển vùng mềm). Để three sinh
  //    mipmap thì mip thấp là trung bình của các mã khác nhau -> xám ~0.5, mà shader
  //    ngưỡng hoá ở đúng 0.5 -> mã vùng bị phá và con vật ra MỘT MÀU.
  //    Đo được 2026-08-30: đổi sang texture hoạ tiết (giàu vùng hơn hẳn) thì mô hình
  //    ra xám trơn, trong khi chính texture đó nhìn bằng mắt thì đủ 5 vùng rõ ràng.
  //    Mặt nạ `_M` cũ không lộ lỗi này chỉ vì nó 91% đen PHẲNG — trung bình hoá vẫn
  //    ra đen, vẫn ra `base`, nên trông như chạy đúng.
  maskTex.colorSpace = THREE.NoColorSpace;   // mặt nạ là DỮ LIỆU, không phải màu — tuyệt đối
  maskTex.flipY = false;                     // glTF dùng gốc toạ độ trên-trái
  maskTex.generateMipmaps = false;
  maskTex.minFilter = THREE.NearestFilter;
  maskTex.magFilter = THREE.NearestFilter;
  maskTex.needsUpdate = true;

  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const ds = Array.isArray(o.material) ? o.material : [o.material];
    ds.forEach((m) => {
      if (!m || !m.name || /eye/i.test(m.name)) return;   // mắt có param riêng, không qua mask
      m.userData.mask = { tex: maskTex, bang };
      // Chất lượng cao: normal của loài + vảy chi tiết + RAC (độ nhám · độ sáng nền · hốc), đúng
      // ba texture material thân của game dùng (`Base_NormalMap`, `Detail_NormalMap`,
      // `Base_RoughAlbedoCavityMap`). Không có thì vật liệu y như cũ.
      const coN = !!(pbr && pbr.n), coRac = coN && !!(pbr && pbr.rac);
      const coVay = coN && !!(pbr && pbr.chiTiet);
      if (coN) {
        m.normalMap = pbr.n;
        m.normalScale = new THREE.Vector2(1, 1);
        m.metalness = 0;
        m.roughness = 0.8;
        m.defines = Object.assign({}, m.defines, coRac ? { D4V_RAC: "" } : {},
                                  coVay ? { D4V_VAY: "" } : {});
      }
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uMask = { value: maskTex };
        sh.uniforms.uRac = { value: coRac ? pbr.rac : maskTex };
        sh.uniforms.uVay = { value: coVay ? pbr.chiTiet : maskTex };
        sh.uniforms.uLapVay = { value: (pbr && pbr.lap) || 16 };
        sh.uniforms.uManhVay = { value: MANH_VAY };
        // 🔴 CÙNG MỘT THAM CHIẾU MẢNG được giữ lại trong `HIENTAI.bang`. Đó là cả
        // cơ chế đổi màu tức thì — xem `capNhatMau()`. Đừng sao chép mảng ở đây.
        sh.uniforms.uBang = { value: bang };
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vMaskUv;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMaskUv = uv;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>",
            "#include <common>\nvarying vec2 vMaskUv;\nuniform sampler2D uMask;\nuniform vec3 uBang[8];"
            + "\nuniform sampler2D uRac;\nuniform sampler2D uVay;\nuniform float uLapVay;\nuniform float uManhVay;")
          .replace("#include <color_fragment>",
            "#include <color_fragment>\n"
            + "  vec3 mk = texture2D(uMask, vMaskUv).rgb;\n"
            + "  int idx = (mk.r > 0.5 ? 1 : 0) + (mk.g > 0.5 ? 2 : 0) + (mk.b > 0.5 ? 4 : 0);\n"
            + "  diffuseColor.rgb = uBang[idx];\n"
            // RAC.g = độ sáng nền, RAC.b = hốc (tối khe vảy). Biên độ chọn để màu người chơi chọn vẫn
            // đọc ra đúng màu: trung bình ~0,8 lần, khe vảy tối hơn, gờ vảy sáng hơn.
            + "#ifdef D4V_RAC\n"
            + "  vec3 d4Rac = texture2D(uRac, vMaskUv).rgb;\n"
            + "  diffuseColor.rgb *= (0.62 + 0.55 * d4Rac.g) * mix(0.55, 1.0, d4Rac.b);\n"
            + "#endif\n")
          .replace("#include <roughnessmap_fragment>",
            "#include <roughnessmap_fragment>\n"
            + "#ifdef D4V_RAC\n  roughnessFactor = clamp(0.3 + 0.7 * d4Rac.r, 0.0, 1.0);\n#endif\n")
          // Vảy chi tiết lặp `uLapVay` lần trên UV, CỘNG vào normal của loài (whiteout blend).
          .replace("#include <normal_fragment_maps>",
            THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;",
              "mapN.xy *= normalScale;\n"
              + "#ifdef D4V_VAY\n"
              + "  vec3 d4Vay = texture2D(uVay, vMaskUv * uLapVay).xyz * 2.0 - 1.0;\n"
              + "  mapN = normalize(vec3(mapN.xy + d4Vay.xy * uManhVay, mapN.z * d4Vay.z));\n"
              + "#endif"));
        m.userData.shader = sh;
      };
      m.needsUpdate = true;
      n++;
    });
  });
  return { bang, so_vat_lieu: n, khe_dung: [...dung] };
}

/** Điền 8 ô màu của bảng tra từ bảng màu người dùng. Mutate TẠI CHỖ. */
function napBang(bang, mau, layerKhe, dung) {
  // Ô 0 (nền) trước, vì các ô thiếu màu sẽ mượn lại chính nó.
  const kheNen = (layerKhe && layerKhe.base) || "body";
  const hexNen = kheNen && (mau[kheNen] || (kheNen === "body" ? (mau.body || mau.base) : null));
  if (hexNen) { bang[0].setStyle(hexNen, THREE.SRGBColorSpace); if (dung) dung.add(kheNen); }
  else bang[0].setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);

  for (let i = 1; i < 8; i++) {
    const khe = (layerKhe || {})[MA[i]];
    const hex = khe && (mau[khe] || (khe === "markings" ? mau.pattern : (khe === "pattern" ? mau.markings : (khe === "flank" ? (mau.flank || mau.body) : null))));
    if (hex) { bang[i].setStyle(hex, THREE.SRGBColorSpace); if (dung) dung.add(khe); }
    // Khe không có màu (vd người dùng chọn Cái nên bỏ `maleDisplay`) thì vùng đó
    // phải rơi về MÀU NỀN — đúng như trong game. Đổ xám là bịa ra một màu không
    // tồn tại, và nhìn thì tưởng mô hình hỏng.
    else bang[i].copy(bang[0]);
  }
}

/* ── Đo hộp bao MỘT LẦN cho mỗi mô hình ──────────────────────────────────────
 * 🔴 Vì sao bắt buộc: mỗi loài một tỉ lệ khác nhau — Compsognathus và Camarasaurus lệch nhau cả
 * chục lần. Đặt camera cứng thì con to bị cắt cụt còn con nhỏ thành một chấm.
 *
 * Đo ở scale = 1 rồi nhân tuyến tính trong `doKhung()`: mô hình đứng ở gốc và co giãn đều, nên
 * hộp bao thế giới đúng bằng s × hộp bao gốc. Nhờ vậy thanh trượt trưởng thành KHÔNG phải chạy
 * `Box3.setFromObject` (duyệt cả cây mesh) 60 lần một giây.
 *
 * ⚠️ Phải gọi SAU khi đã đặt `rotation.y = yaw` — xoay trước rồi mới đo, không thì x/z đảo nhau.
 */
function doHopGoc(three, model) {
  // 🔴 `precise = true` là BẮT BUỘC với mô hình có xương (SkinnedMesh). Không có nó, three đo
  // hộp của hình học ở TƯ THẾ GỐC (bind pose) chứ không phải điểm đã áp xương — đo trên preview
  // 2026-09-14: Deinosuchus ra hộp 4.9 × 1.89 × 2.28 trong khi con vật thấy trên màn chỉ bằng
  // khoảng một phần tư, nên camera canh đúng hộp mà con vật vẫn nhỏ xíu giữa khung.
  model.updateMatrixWorld(true);
  const hop = new three.Box3().setFromObject(model, true);
  if (hop.isEmpty()) return null;
  const tam = hop.getCenter(new three.Vector3());
  const co = hop.getSize(new three.Vector3());

  // Mẫu ĐIỂM BỀ MẶT THẬT (đã áp xương) để canh khung — không chỉ 8 góc hộp. Con dài và mảnh
  // nhìn chéo thì góc hộp chìa ra xa hơn hình con vật rất nhiều: canh theo hộp, Deinosuchus
  // chỉ chiếm ~1/3 bề ngang khung (đo 2026-09-14). ~600 điểm, đo MỘT lần lúc nạp.
  // (1500 → 600 ngày 2026-09-15: `doKhung` chiếu mỗi điểm ~22 lần và ResizeObserver gọi nó
  //  mỗi khung hình lúc kéo cửa sổ; 600 điểm rải đều vẫn chạm đủ mũi, đuôi và đỉnh lưng.)
  const luoi = [];
  let tong = 0;
  model.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      luoi.push(o);
      tong += o.geometry.attributes.position.count;
    }
  });
  const buoc = Math.max(1, Math.floor(tong / 600));
  const diem = [];
  const v = new three.Vector3();
  for (const m of luoi) {
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += buoc) {
      m.getVertexPosition(i, v);          // SkinnedMesh: vị trí ĐÃ áp xương
      v.applyMatrix4(m.matrixWorld);
      diem.push(v.x, v.y, v.z);
    }
  }
  return { tam: { x: tam.x, y: tam.y, z: tam.z }, co: { x: co.x, y: co.y, z: co.z },
           diem: new Float32Array(diem) };
}

/** Canh khung theo các điểm bề mặt đã đo (`doHopGoc`), ở hệ số phóng `s`.
 *  Không duyệt cây mesh và KHÔNG cấp phát trong vòng chiếu: ~600 điểm × 22 vòng nhị phân.
 *  (Bản 2026-09-14 tạo ~1500 `Vector3` mới mỗi lần gọi và chiếu 28 vòng — mà ResizeObserver
 *  gọi hàm này mỗi khung hình khi kéo cửa sổ, với mỗi bộ xem trên trang. Review PR #7.) */
function doKhung(s) {
  if (!HIENTAI || !HIENTAI.hopGoc || !CAM) return;
  const t = HIENTAI.hopGoc.tam, c = HIENTAI.hopGoc.co;
  // Điểm nhìn ở ~60% chiều cao chứ không ở tâm hộp: máy thấp hắt lên thì phải nhìn vào NGỰC,
  // nhìn vào tâm là nhìn vào bụng và khung hình dồn xuống đất.
  // Và dời về phía MẶT 8% chiều dài: chừa khoảng trống trước mặt con vật (lead room) thay vì để
  // mõm dí sát mép khung. Mọi loài quay mặt về +X sau `yaw` (đo 2026-09-23: 23/23 .glb có xương
  // DinoHead ở +Z, và manifest dùng chung yaw 1.5708).
  TIEU.x = (t.x + 0.08 * c.x) * s; TIEU.y = (t.y + 0.1 * c.y) * s; TIEU.z = t.z * s;
  const x = c.x * s, y = c.y * s, z = c.z * s;

  // 🔴 KHÔNG ước lượng bằng công thức. Hai bản trước đều sai theo hai hướng: bản đầu lấy
  // max(x, z) + biên 1.12 (con non nhỏ xíu), bản giải tích chiếu hộp lên trục màn hình rồi cộng
  // bề sâu thì đặt camera xa gấp mấy lần (đo trên preview 2026-09-14). Phối cảnh + góc nghiêng
  // + hộp dẹt dài làm mọi công thức gần đúng lệch khó đoán.
  // Đúng: CHIẾU THẬT các điểm qua chính camera, rồi tìm nhị phân khoảng cách sao cho điểm xa
  // nhất nằm đúng `LAP` của nửa khung (theo chiều chật hơn). Dải [0.1, 60] × bán kính chia đôi
  // 22 lần là sai số tương đối ~1e-4 — mắt không phân biệt được với 28 vòng.
  const bk = 0.5 * Math.max(x, y, z);
  const LAP = 0.9;
  // Điểm bề mặt thật nhân theo hệ số phóng `s` (mô hình co giãn đều quanh gốc). Mô hình không
  // có điểm nào thì lùi về 8 góc hộp.
  const dsDiem = HIENTAI.hopGoc.diem;
  const coDiem = !!(dsDiem && dsDiem.length >= 3);
  const v = DIEM_TAM || (DIEM_TAM = new THREE.Vector3());
  const tran = (r) => {
    camR = r;
    capNhatCam();
    CAM.near = Math.max(0.001, r * 0.01);
    CAM.far = r + bk * 10;
    CAM.updateProjectionMatrix();
    CAM.updateMatrixWorld();
    let m = 0;
    if (coDiem) {
      for (let i = 0; i < dsDiem.length; i += 3) {
        v.set(dsDiem[i] * s, dsDiem[i + 1] * s, dsDiem[i + 2] * s).project(CAM);
        if (v.z > 1 || v.z < -1) return Infinity;     // điểm ở sau camera: còn quá gần
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
    } else {
      for (let n = 0; n < 8; n++) {
        v.set(TIEU.x + ((n & 1) ? 0.5 : -0.5) * x, TIEU.y + ((n & 2) ? 0.5 : -0.5) * y,
              TIEU.z + ((n & 4) ? 0.5 : -0.5) * z).project(CAM);
        if (v.z > 1 || v.z < -1) return Infinity;
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
    }
    return m;
  };
  let lo = bk * 0.1, hi = bk * 60;
  for (let i = 0; i < 22; i++) {
    const giua = (lo + hi) / 2;
    if (tran(giua) > LAP) lo = giua; else hi = giua;
  }
  // Loài có `khung` riêng (Pteranodon: mô hình tư thế chữ T, sải cánh ~4 lần thân) thì phóng vào
  // THÂN và để đầu cánh tràn khỏi khung — khớp theo sải cánh là thân còn một vệt trên ô bục 204 px.
  camRVua = hi * (gocCua(HIENTAI.slug).khung || 1);
  camR = camRVua * zoomNguoiDung;
  HIENTAI.sKhung = s;                 // mốc cỡ của khung đang dùng — xem `capNhatLon`

  // Mặt phẳng cắt phải bao được mô hình ở mọi cỡ, nếu không con lớn bị xén mất phần xa.
  CAM.near = Math.max(0.01, camR - bk * 3);
  CAM.far  = camR + bk * 6;
  CAM.updateProjectionMatrix();
  capNhatCam();
}

/** Chuẩn hoá mức trưởng thành. `null`/`undefined`/`NaN` KHÁC `0`.
 *
 *  🔴 Bản trước viết `growth || 0`, gộp "KHÔNG ĐỌC ĐƯỢC" với "bằng 0" — và 0 cho ra hệ số 0.4,
 *  tức một con TRƯỞNG THÀNH hiện ra bé bằng con non. Không lỗi, không cảnh báo, và người xem
 *  không có cách nào biết là sai. Đây không phải giả thuyết: `growth` tới qua RCON nên nó VẮNG
 *  MẶT trong 10–30 giây đầu sau khi người chơi spawn.
 *  (Do phiên `player-profile-dinosaur-page` chỉ ra khi đối chiếu hai bản dino3d, 2026-08-30.)
 *  Thiếu số thì vẽ NGUYÊN CỠ — thà lớn hơn thật còn hơn bịa ra một con non. */
function chuanLon(growth) {
  return (typeof growth === "number" && isFinite(growth))
    ? Math.max(0, Math.min(1, growth))
    : 1;
}

/** Bản đồ vùng màu ứng với mức trưởng thành.
 *
 *  Game có ba texture riêng cho hatchling / juvenile / adult — con non chia vùng khác
 *  con trưởng thành, không phải cùng một ảnh phóng to. Ngưỡng nằm trong manifest
 *  (`nguong_tuoi`) chứ không nhúng ở đây: đó là DỮ LIỆU về game, không phải logic
 *  hiển thị, và ta còn phải sửa nó khi đo được ngưỡng thật.
 *
 *  Trả `null` khi mô hình không có bản đồ vùng nào -> caller rơi về `apMau()`. */
function duongMask(mh, growth) {
  const t = mh.mask_tuoi;
  if (!t) return mh.mask || null;
  const ng = (manifest && manifest.nguong_tuoi) || { hatchling: 0.35, juvenile: 0.75 };
  const g = chuanLon(growth);
  const bac = g < ng.hatchling ? "hatchling" : (g < ng.juvenile ? "juvenile" : "adult");
  // Thiếu bậc nào thì lùi dần lên bậc lớn hơn — thà vẽ vùng của con trưởng thành
  // còn hơn không vẽ vùng nào.
  return t[bac] || t.adult || t.juvenile || t.hatchling || mh.mask || null;
}

/** Hệ số phóng cho một mức trưởng thành. Con non phải nhìn ra con non. */
function coTheo(mh, growth) {
  return (mh.scale || 1) * (0.4 + 0.6 * chuanLon(growth));
}

/** Hệ số phóng dùng làm MỐC CANH KHUNG. Mặc định là cỡ đang hiện — bản trước luôn canh theo
 *  con trưởng thành nên con 42% chỉ chiếm một mẩu giữa khung (chủ server báo 2026-09-14).
 *  /skin (`data-khung="truong-thanh"`) giữ mốc trưởng thành cho thanh trượt có nghĩa. */
function coKhung() {
  if (!HIENTAI) return 1;
  return KHUNG_THEO_TRUONG_THANH ? coTheo(HIENTAI.mh, 1) : coTheo(HIENTAI.mh, HIENTAI.growth);
}

/** Khe màu nào THẬT SỰ vẽ được trên mô hình đang hiện.
 *  Trang /skin dùng để làm mờ những dòng màu vô nghĩa với loài này. */
function kheHienThi(mh, layerKhe, batMask) {
  const s = new Set();
  if (batMask) {
    if (layerKhe && layerKhe.base) s.add(layerKhe.base);
    (mh.mask_layers || []).forEach((L) => { if (layerKhe && layerKhe[L]) s.add(layerKhe[L]); });
  } else {
    Object.keys(mh.khemau || {}).forEach((k) => s.add(k));
  }
  if (mh.khemau && mh.khemau.eyes) s.add("eyes");   // mắt luôn đi đường material
  return [...s];
}

/* ── Cập nhật TỪNG PHẦN, không tải lại mô hình ────────────────────────────── */

/** Đổi màu tức thì.
 *
 *  🔴 CƠ CHẾ, đọc trước khi "tối ưu": `HIENTAI.bang` là ĐÚNG mảng đã trao cho
 *  `sh.uniforms.uBang.value`. Trong three r0.185.1, hàm nạp uniform mảng vec3 là
 *      function tr(e,t){const n=Ui(t,this.size,3);e.uniform3fv(this.addr,n)}
 *  `Ui` (= flatten) gọi `.toArray()` trên TỪNG phần tử ở MỖI lần upload, và
 *  `uniform3fv` được gọi VÔ ĐIỀU KIỆN — mảng KHÔNG có bộ nhớ đệm so sánh (khác
 *  hẳn nhánh vec3 đơn). Nên mutate tại chỗ rồi `ve()` là đủ: không recompile,
 *  không `needsUpdate`, không chạy lại `onBeforeCompile`.
 *
 *  Ai đó cấp cho mỗi material một bản `bang` RIÊNG, hoặc thêm
 *  `customProgramCacheKey`, là tính năng này chết IM LẶNG. */
function capNhatMau(mau) {
  if (!MODEL || !HIENTAI) return;
  HIENTAI.mau = mau;
  if (HIENTAI.batMask && HIENTAI.bang) {
    napBang(HIENTAI.bang, mau, HIENTAI.layerKhe, null);
    if (HIENTAI.mh.khemau && HIENTAI.mh.khemau.eyes) {
      apMau(MODEL, mau, { eyes: HIENTAI.mh.khemau.eyes });
    }
  } else {
    apMau(MODEL, mau, HIENTAI.mh.khemau || {});
  }
  ve();
}

/** Đổi cỡ theo mức trưởng thành.
 *
 *  Khung canh theo `coKhung()`:
 *  - /skin (`data-khung="truong-thanh"`): `coKhung()` là HẰNG SỐ (cỡ trưởng thành), nên ở đây
 *    KHÔNG BAO GIỜ canh lại — kéo thanh trượt thì con vật to/nhỏ trong một khung đứng yên.
 *    Canh lại mỗi lần đổi là con vật lúc nào cũng vừa khít khung, đúng lỗi người dùng báo
 *    ngày 2026-08-30.
 *  - Trang khác: khung ôm CỠ ĐANG HIỆN. Trưởng thành đổi đáng kể thì phải canh lại, nếu không
 *    con non co lại bé xíu giữa khung canh cho con trưởng thành — hay gặp nhất ở /me, nơi
 *    growth VẮNG 10–30 giây đầu (vẽ nguyên cỡ) rồi mới tới số thật (review PR #7). Ngưỡng 8%
 *    để nhịp cập nhật nhỏ không làm camera nhích liên tục. Góc nhìn và zoom người dùng giữ nguyên.
 *
 *  Công thức `0.4 + 0.6*growth` khiến con non nhất vẫn bằng 40% con trưởng thành:
 *  nhỏ rõ rệt nhưng không biến thành một chấm. */
function capNhatLon(growth) {
  if (!MODEL || !HIENTAI) return;
  growth = chuanLon(growth);          // chuẩn hoá ở BIÊN, không để số lạ đi sâu vào trong
  HIENTAI.growth = growth;
  HIENTAI.s = coTheo(HIENTAI.mh, growth);
  MODEL.scale.setScalar(HIENTAI.s);
  datBong(HIENTAI.s);
  const sK = coKhung();
  if (HIENTAI.sKhung && Math.abs(sK / HIENTAI.sKhung - 1) > 0.08) doKhung(sK);
  ve();
  doiMaskTheoTuoi(growth);            // có thể chạy bất đồng bộ, không chặn khung hình
}

/** Đổi ảnh bản đồ vùng khi mức trưởng thành vượt sang bậc tuổi khác.
 *
 *  KHÔNG tải lại mô hình: chỉ thay giá trị uniform `uMask`. Ảnh đã tải một lần thì
 *  trình duyệt cache lại, nên kéo qua kéo lại không tốn thêm request.
 *
 *  🔴 Vẫn phải giữ `NearestFilter` + tắt mipmap cho ảnh MỚI, cùng lý do với lúc nạp
 *  lần đầu: đây là DỮ LIỆU mã hoá theo mã màu, mọi phép nội suy đều phá mã. */
function doiMaskTheoTuoi(growth) {
  if (!HIENTAI || !HIENTAI.batMask || !THREE) return;
  const duong = duongMask(HIENTAI.mh, growth);
  if (!duong || duong === HIENTAI.duongMask) return;
  HIENTAI.duongMask = duong;
  const luot = luotTai;               // đổi loài giữa chừng -> bỏ kết quả này
  new THREE.TextureLoader().loadAsync(duong).then((tex) => {
    if (luot !== luotTai || !HIENTAI || HIENTAI.duongMask !== duong) return;
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    (HIENTAI.vatLieuMask || []).forEach((m) => {
      if (m.userData.mask) m.userData.mask.tex = tex;
      if (m.userData.shader && m.userData.shader.uniforms.uMask) {
        m.userData.shader.uniforms.uMask.value = tex;
      }
    });
    ve();
  }).catch(() => { /* thiếu ảnh của bậc này -> giữ ảnh đang dùng, không vỡ */ });
}

/** Canh lại khung theo `coKhung()`; `boZoom` còn đưa zoom VÀ GÓC NHÌN về mặc định.
 *  Dùng khi đổi loài, đổi bề rộng khung, hoặc người dùng bấm "Đặt lại góc nhìn". */
function canhLaiKhung(boZoom) {
  if (!HIENTAI) return;
  if (boZoom) {
    zoomNguoiDung = 1;
    const g = gocCua(HIENTAI.slug);
    camTheta = g.theta;
    camPhi = g.phi;
    gocLaMacDinh = true;
  }
  doKhung(coKhung());
  ve();
}

/* ── Nạp mô hình ─────────────────────────────────────────────────────────── */

async function taiMoHinh(slug, mh, mau, growth) {
  const { three, GLTFLoader } = await tai3D();
  dungScene(three);

  trangThai("loading-model", "Đang tải mô hình…");

  // 🔴 Token chống ĐUA TẢI. Kéo nhanh dropdown loài là hai `loadAsync` cùng bay; con CHẬM hơn
  // về sau và vẽ ĐÈ lên con đúng — không lỗi nào hiện ra, chỉ là mô hình sai. Kiểm token sau
  // MỌI `await`, và khi đã lạc hậu thì bỏ đi chứ KHÔNG dispose tài nguyên của lượt khác.
  const luot = ++luotTai;
  const gltf = await new GLTFLoader().loadAsync(mh.file);
  if (luot !== luotTai) return null;

  let tex = null, loiMask = false;
  const duong = mh.mode === "mask" ? duongMask(mh, growth) : null;
  // Chất lượng cao: ba texture tải SONG SONG với mặt nạ; cái nào lỗi thì bỏ cái đó (null), mô hình
  // vẫn hiện như đường cũ.
  const choPbr = (CHAT_CAO && mh.pbr && duong)
    ? Promise.all([napTexDuLieu(mh.pbr.n), napTexDuLieu(mh.pbr.rac), napTexDuLieu(mh.pbr.chi_tiet, true)])
    : Promise.resolve(null);
  if (duong) {
    try {
      tex = await new three.TextureLoader().loadAsync(duong);
    } catch (e) {
      loiMask = true;                     // mask 404 -> vẫn có thân+mắt, nhưng PHẢI nói ra
    }
    if (luot !== luotTai) return null;
  }
  const bo3 = await choPbr;
  if (luot !== luotTai) {
    if (bo3) bo3.forEach((t) => t && t.dispose());
    return null;
  }
  const pbr = bo3 && bo3[0] ? { n: bo3[0], rac: bo3[1], chiTiet: bo3[2], lap: mh.pbr.lap } : null;

  boGao();                                // bộ hoạt ảnh + tiếng thuộc về con CŨ
  if (MODEL) {
    SCENE.remove(MODEL);
    MODEL.traverse((o) => {
      if (o.isMesh) {
        o.geometry && o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x && x.dispose());
      }
    });
  }
  // Bộ texture chi tiết của con CŨ: trả lại GPU (mỗi bộ vài chục MB VRAM sau giải nén).
  if (HIENTAI && HIENTAI.pbr) {
    ["n", "rac", "chiTiet"].forEach((k) => HIENTAI.pbr[k] && HIENTAI.pbr[k].dispose());
  }
  MODEL = gltf.scene;
  doiTuong(MODEL);
  MODEL.rotation.y = mh.yaw || 0;         // xoay TRƯỚC khi đo hộp bao

  const layerKhe = (manifest && manifest.layer_khe) || {};
  let bang = null, batMask = false, kq = null;
  if (tex) {
    const r = apMauMask(MODEL, mau, tex, layerKhe, pbr);
    bang = r.bang; batMask = true; kq = r;
  } else {
    kq = apMau(MODEL, mau, mh.khemau || {});
  }
  // Mắt luôn đi đường material: nó có param riêng trong game, không nằm trong mask.
  if (batMask && mh.khemau && mh.khemau.eyes) {
    apMau(MODEL, mau, { eyes: mh.khemau.eyes });
  }

  // Đo hộp bao ở scale 1, TRƯỚC khi áp hệ số trưởng thành.
  MODEL.scale.setScalar(1);
  const hopGoc = doHopGoc(three, MODEL);

  HIENTAI = { slug, mh, bang, layerKhe, batMask, hopGoc, mau, growth, s: 1, loiMask,
              duongMask: duong, vatLieuMask: [], pbr: batMask ? pbr : null };
  // Giữ danh sách vật liệu đi đường mask, để đổi ảnh theo tuổi mà không tải lại mô hình.
  MODEL.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m && m.userData && m.userData.mask) HIENTAI.vatLieuMask.push(m);
    });
  });
  // Loài mới: zoom về mặc định (zoom của con cũ vô nghĩa với con mới) nhưng GIỮ GÓC NHÌN người
  // dùng đã xoay — chỉ nút "Đặt lại góc nhìn" (`capNhat({canhlai})`) mới đưa góc về mặc định.
  // Lần nạp đầu góc vẫn là `GOC_MAC_DINH` vì chưa ai xoay. (Review PR #7.)
  zoomNguoiDung = 1;
  if (gocLaMacDinh) {                     // chưa ai xoay ⇒ góc của loài này (Pteranodon nhìn từ trên)
    const g = gocCua(slug);
    camTheta = g.theta;
    camPhi = g.phi;
  }
  canhLaiKhung(false);                    // canh khung MỘT lần: cỡ đang hiện (/skin: trưởng thành)
  capNhatLon(growth);                     // rồi mới thu nhỏ theo tuổi thật
  SCENE.add(MODEL);
  ve();
  return { kq, batMask, loiMask };
}

async function moXem(d) {

  if (!KHUNG || !CANVAS) return;
  if (d && d.canh !== undefined) apCanh(d.canh);    // nhớ lại kể cả khi scene chưa dựng

  if (!coWebGL()) {
    trangThai("nogl", "Máy hoặc trình duyệt này không chạy được 3D. Thẻ bên trên vẫn có đủ "
                    + "màu và chỉ số của con này.");
    bao({ loi: "nogl" });
    return;
  }
  if (tietKiemDuLieu()) {
    trangThai("error", "Bạn đang bật tiết kiệm dữ liệu nên mô hình 3D (~0,5 MB) chưa được tải.");
    bao({ loi: "tietkiem" });
    return;
  }

  try {
    trangThai("loading-lib", "Đang tải bộ xem 3D…");
    const m = await layManifest();
    const slug = (m.loai && (m.loai[d.species] || m.loai[d.species?.toLowerCase()] || (d.species?.startsWith("TI") ? m.loai[d.species.slice(2)] : null) || (m.loai[d.species?.split('_')[0]]) || "baryonyx")) || null;
    if (!slug || !m.mohinh || !m.mohinh[slug]) {
      // Nói thật: chưa có mô hình cho loài này. Đừng vẽ đại một con khác rồi để
      // người chơi tưởng đó là con của mình.
      trangThai("error", "Chưa có mô hình 3D cho loài " + (d.species || "này") + ".");
      bao({ species: d.species, loi: "khong-co-mo-hinh" });
      return;
    }
    const mh = m.mohinh[slug];
    const mau = d.colors || {};
    const growth = chuanLon(d.growth);

    // Cùng loài -> chỉ cập nhật, KHÔNG tải lại .glb.
    if (HIENTAI && HIENTAI.slug === slug && MODEL) {
      capNhatMau(mau);
      capNhatLon(growth);
      trangThai("ready", "");
      ghiChu(dongGhiChu(d, mh, slug));
      bao(tomTat(d, slug));
      return;
    }

    const r = await taiMoHinh(slug, mh, mau, growth);
    if (!r) return;                        // lượt này đã lạc hậu

    trangThai("ready", "");
    ghiChu(dongGhiChu(d, mh, slug, r.kq));
    bao(tomTat(d, slug));
  } catch (e) {
    // Chi tiết đi vào console cho người phát triển; màn hình chỉ nói điều người chơi
    // làm được. `e.message` có thể chứa đường dẫn file và tên hàm.
    console.error("[dino3d]", e);
    trangThai("error", "Chưa xem được mô hình 3D. Thử tải lại trang giúp mình.");
    bao({ species: d && d.species, loi: "ngoai-le" });
  }
}

function tomTat(d, slug) {
  return {
    slug,
    species: d.species,
    batMask: !!(HIENTAI && HIENTAI.batMask),
    khe_hienthi: HIENTAI ? kheHienThi(HIENTAI.mh, HIENTAI.layerKhe, HIENTAI.batMask) : [],
  };
}

/* Dòng chú thích dưới khung — VIẾT CHO NGƯỜI CHƠI, KHÔNG PHẢI CHO MÌNH.
 *
 * 🔴 CLAUDE.md §6 quy tắc 6 (người dùng chốt 2026-08-27): website KHÔNG được mang
 *    "chi tiết kỹ thuật/cấu hình" hay "trạng thái chưa sẵn sàng". Bản trước in ra
 *        "tô theo mặt nạ vùng (5 khe) · ⚠ ánh xạ vùng CHƯA xác nhận, màu có thể
 *         lệch vùng · mô hình: The Isle SK_Allosaurus"
 *    — vi phạm cả hai vế. Nó lọt được lâu vì `.v3d__ghi` bị canvas phủ lên nên
 *    KHÔNG AI NHÌN THẤY; sửa đúng lỗi che khuất là nó lộ ra ngay.
 *
 * PHÉP THỬ cho mỗi mẩu chữ định thêm vào đây:
 *      NGƯỜI CHƠI LÀM GÌ KHÁC ĐI KHI ĐỌC CÂU NÀY?
 * Không trả lời được thì nó thuộc về chú thích mã nguồn hoặc
 * `docs/06-open-questions.md`, không thuộc về màn hình.
 *
 * BỎ: cơ chế tô màu · số "khe"/layer · độ tin cậy ánh xạ · tên asset gốc (`SK_*`) ·
 *     tên nguồn dữ liệu · đường dẫn file · thông điệp ngoại lệ.
 * GIỮ: thứ làm người chơi hành động khác đi — đây là con nào, và bản xem thử này
 *      lệch với trong game ở chỗ nào.
 *
 * ⚠️ Sự thật "ánh xạ vùng chưa xác nhận" KHÔNG bị xoá khỏi repo — nó vẫn nằm ở
 *    `apMauMask()`, ở `tools/extract/gan_mask.py` và ở `docs/06`. Chỉ là nó thôi
 *    được nói bằng tiếng lập trình viên trên màn hình người chơi.
 */
function dongGhiChu(d, mh, slug, kq) {
  const p = [];
  if (d.species) p.push(d.species);
  if (d.slot !== undefined && d.slot !== null && d.slot !== "") p.push("ô " + d.slot);

  // Ba câu dưới đây đều đổi hành vi: chúng nói bản xem thử LỆCH so với game ở đâu,
  // để người chơi biết cái gì đáng tin và cái gì phải vào game xem lại.
  if (mh.tam) p.push("hình dáng chỉ là tạm");
  // Chỉ nói khi bản xem thử BỊ GIẢM CHẤT LƯỢNG so với bình thường — đó là thứ người
  // chơi cần biết. Lời rào chung về độ chính xác của màu KHÔNG đặt ở đây: nó lặp lại
  // dưới mỗi lần vẽ, không làm ai hành động khác đi, và gieo nghi ngờ lên cả những
  // màu đang đúng. Nó nằm MỘT LẦN ở thẻ Màu sắc của `/skin`, đúng lúc người ta đang
  // chọn màu và sắp bấm "Áp vào game".
  if (!(HIENTAI && HIENTAI.batMask)) p.push("bản xem thử chỉ hiện màu thân và mắt");
  return p.join(", ");
}


/* ═══════════════════════════════════════════════════════════════════════════════
   GÀO RÚ — hoạt ảnh + tiếng + đường máy điện ảnh (2026-09-23)

   Nguồn: hoạt ảnh `A_<Loài>_Adult_Vocal_Broadcast` và tiếng MetaSound `Call_Broadcast` trích từ
   chính game (tools/extract/gao/README.md). Manifest khai ở khoá `gao`; loài không có mục đó thì
   KHÔNG hiện nút (4 loài game không có hoạt ảnh gào — người dùng chốt ẩn, không tự dựng).

   🔴 Bốn điều giữ cho nó không phá thiết kế cũ:
   1. Mesh đứng yên vẫn là .glb TĨNH như trước. Bản có xương chỉ tải khi bấm "Gào" lần đầu, rồi
      THAY CHỖ bản tĩnh (cùng phép chuẩn hoá cao 1.1 nên không giật — tools/extract/webify/gao.mjs).
   2. Vòng requestAnimationFrame CHỈ chạy trong lúc gào; xong là dừng. Đứng yên vẫn 0% CPU.
   3. Tiếng (mặc định bật) chỉ tải khi bấm "Gào" lần đầu. Có tiếng thì CHỜ file sẵn sàng rồi mới
      cho con vật cử động, và lấy đồng hồ của thẻ <audio> làm đồng hồ hoạt ảnh — nếu không, lần
      bấm đầu trên mạng chậm là hàm há ra trước tiếng cả giây.
   4. Hoạt ảnh vào/ra bằng TRỌNG SỐ (0→1 trong 0,2 s, 1→0 trong 0,35 s cuối): phần trọng số còn
      thiếu three tự lấp bằng tư thế gốc, nên con vật đi từ dáng đứng yên sang cú gào rồi về lại
      đúng dáng cũ, không nhảy khung.
   ═════════════════════════════════════════════════════════════════════════════ */
const SVG_NS = "http://www.w3.org/2000/svg";
const HINH = {
  gao: "M8 5v14l11-7z",
  dung: "M7 7h10v10H7z",
  tiengBat: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  tiengTat: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
};
/** Mặt "công khai" của bộ xem này với biến `dangGao` dùng chung cả trang. */
const tuGao = { dung: () => dungGao() };

function thongTinGao() {
  return (manifest && manifest.gao && HIENTAI && manifest.gao[HIENTAI.slug]) || null;
}

function bieuTuong(d) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  s.appendChild(p);
  return s;
}

function dungDieuKhien() {
  if (DK || !KHUNG) return;
  DK = document.createElement("div");
  DK.className = "v3d__dk";
  DK.hidden = true;
  NUT_GAO = document.createElement("button");
  NUT_GAO.type = "button";
  NUT_GAO.className = "btn btn--nho v3d__nut";
  NUT_GAO.addEventListener("click", () => { batDauGao(); });
  NUT_TIENG = document.createElement("button");
  NUT_TIENG.type = "button";
  NUT_TIENG.className = "btn btn--nho v3d__nut v3d__nut--tieng";
  NUT_TIENG.addEventListener("click", () => datTieng(!tiengBat));
  DK.appendChild(NUT_GAO);
  DK.appendChild(NUT_TIENG);
  KHUNG.appendChild(DK);
  nutTiengCacKhung.add(veNutTieng);
}

/** Hiện/ẩn và vẽ lại hai nút theo trạng thái. Gọi được bất cứ lúc nào, kể cả trước khi có mô hình. */
function capNhatNutGao() {
  const g = thongTinGao();
  const hien = !!(g && MODEL && KHUNG && KHUNG.getAttribute("data-state") === "ready");
  if (!hien) {
    if (DK) DK.hidden = true;
    if (GAO && GAO.dang) dungGao();
    return;
  }
  dungDieuKhien();
  DK.hidden = false;
  const dang = !!(GAO && GAO.dang);
  NUT_GAO.textContent = "";
  NUT_GAO.appendChild(bieuTuong(dang ? HINH.dung : HINH.gao));
  NUT_GAO.appendChild(document.createTextNode(dang ? "Dừng" : "Gào"));
  NUT_GAO.setAttribute("aria-label", dang ? "Dừng tiếng gào" : "Cho khủng long gào");
  if (!NUT_GAO.hasAttribute("aria-busy")) NUT_GAO.disabled = false;
  veNutTieng();
}

/** Vẽ nút tiếng theo `tiengBat` DÙNG CHUNG, và nếu con này đang gào thì bật/tắt tiếng ngay tại
 *  chỗ đang phát — bật giữa chừng là nghe tiếp đúng đoạn đó, không phát lại từ đầu. */
function veNutTieng() {
  if (NUT_TIENG) {
    NUT_TIENG.textContent = "";
    NUT_TIENG.appendChild(bieuTuong(tiengBat ? HINH.tiengBat : HINH.tiengTat));
    NUT_TIENG.setAttribute("aria-pressed", tiengBat ? "true" : "false");
    const nhan = tiengBat ? "Tắt tiếng" : "Bật tiếng";
    NUT_TIENG.setAttribute("aria-label", nhan);
    NUT_TIENG.title = nhan;
  }
  if (!GAO || !GAO.dang) return;
  const g = thongTinGao();
  if (tiengBat && g) {
    const a = taoAm(g);
    const t = (performance.now() - GAO.t0) / 1000;
    if (t < GAO.dai) {
      try { a.currentTime = t; } catch (e) { /* chưa có metadata: phát từ đầu vẫn hơn im */ }
      const p = a.play();
      if (p && p.then) p.then(() => { if (GAO && GAO.dang) GAO.amChay = true; }).catch(() => {});
    }
  } else if (AM) {
    AM.pause();
    GAO.amChay = false;
  }
}

function taoAm(g) {
  if (AM && AM.dataset.src === g.am) return AM;
  if (AM) { AM.pause(); AM.removeAttribute("src"); }
  AM = new Audio();
  AM.preload = "auto";
  AM.dataset.src = g.am;
  AM.src = g.am;
  return AM;
}

/** Chờ tiếng đủ dữ liệu để phát liền mạch; quá 2,5 s hoặc lỗi thì thôi chờ (gào không tiếng còn
 *  hơn bấm mà không có gì xảy ra). */
function choAm(g) {
  const a = taoAm(g);
  if (a.readyState >= 3) return Promise.resolve();
  return new Promise((xong) => {
    const het = () => {
      clearTimeout(h);
      a.removeEventListener("canplaythrough", het);
      a.removeEventListener("error", het);
      xong();
    };
    const h = setTimeout(het, 2500);
    a.addEventListener("canplaythrough", het);
    a.addEventListener("error", het);
  });
}

/** Tải bản CÓ XƯƠNG một lần cho mỗi loài và thay chỗ mesh tĩnh, giữ nguyên màu đang tô. */
async function napGao(g) {
  const slug = HIENTAI.slug;
  if (GAO && GAO.slug === slug) return true;
  const { three, GLTFLoader } = await tai3D();
  const luot = luotTai;
  const gltf = await new GLTFLoader().loadAsync(g.file);
  // Đổi loài / huỷ khung trong lúc tải: bỏ kết quả, KHÔNG đụng mô hình của lượt khác.
  if (daHuy || luot !== luotTai || !HIENTAI || HIENTAI.slug !== slug) return false;
  const clip = gltf.animations[0];
  if (!clip) throw new Error("glb gao khong co hoat anh");

  const moi = gltf.scene;
  doiTuong(moi);
  moi.rotation.y = HIENTAI.mh.yaw || 0;
  // Tô lại bằng ĐÚNG ảnh mặt nạ đang dùng (đã tải, đúng bậc tuổi) — không tải lại.
  const vlCu = HIENTAI.vatLieuMask.find((m) => m.userData && m.userData.mask);
  const tex = vlCu ? vlCu.userData.mask.tex : null;
  if (HIENTAI.batMask && tex) {
    HIENTAI.bang = apMauMask(moi, HIENTAI.mau, tex, HIENTAI.layerKhe, HIENTAI.pbr).bang;
  } else {
    apMau(moi, HIENTAI.mau, HIENTAI.mh.khemau || {});
  }
  if (HIENTAI.batMask && HIENTAI.mh.khemau && HIENTAI.mh.khemau.eyes) {
    apMau(moi, HIENTAI.mau, { eyes: HIENTAI.mh.khemau.eyes });
  }
  // Hộp bao của SkinnedMesh tính ở tư thế gốc; lúc gào đầu vươn ra ngoài hộp đó và three sẽ cắt
  // mất nếu để frustum culling. Một mesh mỗi khung — không đáng để tính lại hộp mỗi khung hình.
  moi.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  moi.scale.setScalar(HIENTAI.s);

  SCENE.remove(MODEL);
  MODEL.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry && o.geometry.dispose();
    // Chỉ trả vật liệu; ảnh mặt nạ vẫn đang được mô hình mới dùng.
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x && x.dispose());
  });
  MODEL = moi;
  SCENE.add(MODEL);
  HIENTAI.vatLieuMask = [];
  MODEL.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m && m.userData && m.userData.mask) HIENTAI.vatLieuMask.push(m);
    });
  });

  const mixer = new three.AnimationMixer(MODEL);
  const action = mixer.clipAction(clip);
  action.setLoop(three.LoopOnce, 1);
  action.clampWhenFinished = false;
  let xuongDau = null;
  let xuongHong = null;
  MODEL.traverse((o) => {
    if (!o.isBone) return;
    if (!xuongDau && /head$/i.test(o.name)) xuongDau = o;
    if (!xuongHong && /pelvis$/i.test(o.name)) xuongHong = o;
  });
  GAO = {
    slug, mixer, action, xuongDau, chop: timChopMom(three, MODEL, xuongDau), vChop: new three.Vector3(),
    dai: Math.min(g.dai || clip.duration, clip.duration),
    dinhGoc: g.dinh || 0,
    vDau: new three.Vector3(), dau: new three.Vector3(), vNdc: new three.Vector3(),
    vGoc: new three.Vector3(), vHong: new three.Vector3(), xuongHong, rMuot: 0,
    dang: false, tuDo: false, amChay: false, idRaf: 0,
  };
  ve();
  return true;
}

/** Chóp mõm, tính theo hệ toạ độ CỦA XƯƠNG ĐẦU (đứng yên với xương đó khi nó cử động).
 *
 *  🔴 Vì sao không bám thẳng xương đầu: DinoHead là GỐC SỌ, và mõm của cá sấu hay Rex chìa xa
 *  thêm cả một khúc. Đo trên preview 2026-09-23: Deinosuchus ngóc thẳng mõm lên, gốc sọ vẫn nằm
 *  ở y = 0,3 trên màn hình trong khi nửa đầu đã ra khỏi mép trên — phép canh khung nhìn gốc sọ
 *  thì thấy "vẫn trong khung" và không làm gì. Không có xương nào ở chóp mõm (23 skeleton chỉ có
 *  Jaw/Hyoid/Eye/Fenestra dưới Head), nên lấy từ lưới: trong các đỉnh ăn trọng số chủ yếu vào
 *  xương đầu, đỉnh nào xa gốc sọ nhất thì đó là chóp. Làm MỘT lần lúc nạp. */
function timChopMom(three, root, xuong) {
  if (!xuong) return null;
  let tot = null, xa = 0;
  const p = new three.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    const i = o.skeleton.bones.indexOf(xuong);
    const g = o.geometry, vt = g.attributes.position, ci = g.attributes.skinIndex, cw = g.attributes.skinWeight;
    if (i < 0 || !vt || !ci || !cw) return;
    const nghich = o.skeleton.boneInverses[i];
    for (let n = 0; n < vt.count; n++) {
      let tso = 0;
      for (let k = 0; k < 4; k++) if (ci.getComponent(n, k) === i) tso += cw.getComponent(n, k);
      if (tso < 0.5) continue;
      p.fromBufferAttribute(vt, n).applyMatrix4(nghich);   // -> hệ toạ độ của xương đầu
      const d = p.lengthSq();
      if (d > xa) { xa = d; tot = p.clone(); }
    }
  });
  return tot;
}

async function batDauGao() {
  const g = thongTinGao();
  if (!g || !MODEL || !R || daHuy) return;
  if (GAO && GAO.dang) { dungGao(); return; }          // nút đang là "Dừng"
  if (dangGao && dangGao !== tuGao) dangGao.dung();

  NUT_GAO.disabled = true;
  NUT_GAO.setAttribute("aria-busy", "true");
  let ok = false;
  try {
    ok = await napGao(g);
    if (ok && tiengBat) await choAm(g);
  } catch (e) {
    console.error("[dino3d] gao", e);
  }
  NUT_GAO.removeAttribute("aria-busy");
  if (!ok || !GAO || daHuy || HIENTAI.slug !== GAO.slug) { capNhatNutGao(); return; }

  const G = GAO, D = G.dai;
  G.dang = true;
  G.tuDo = false;
  G.itChuyenDong = giamChuyenDong();
  G.daRung = false;
  G.trauma = 0;
  G.rMuot = 0;
  // Mốc đường máy, tính theo độ dài cú gào của TỪNG loài (1,3 s ở Omniraptor tới 9 s ở Rex):
  //   0 → 0,35 s        lùi nhẹ lấy đà
  //   0,35 → tv         lao vào đầu, hạ thấp, thu hẹp khung   (tv neo vào đỉnh tiếng)
  //   dinh              rung máy (chỉ xoay, không trượt — Eiserloh, GDC 2016)
  //   tr → tr + 1,3 s   về khung đứng yên
  G.dinh = Math.max(0.3, Math.min(G.dinhGoc, D));
  G.tv = Math.max(0.9, Math.min(G.dinh, 1.6));
  G.tr = Math.max(G.tv + 0.4, D - 1.1);
  G.het = Math.max(D, G.tr + 1.3);
  G.action.reset();
  G.action.play();
  if (G.xuongDau) { MODEL.updateMatrixWorld(true); G.xuongDau.getWorldPosition(G.dau); }
  else G.dau.set(TIEU.x, TIEU.y, TIEU.z);
  dangGao = tuGao;
  G.amChay = false;
  if (tiengBat && AM) {
    try { AM.currentTime = 0; } catch (e) { /* chưa có metadata */ }
    const p = AM.play();
    G.amChay = true;
    if (p && p.catch) p.catch(() => { G.amChay = false; });   // trình duyệt chặn: gào không tiếng
  }
  G.t0 = G.truoc = performance.now();
  capNhatNutGao();
  G.idRaf = requestAnimationFrame(khungGao);
}

function khungGao(now) {
  const G = GAO;
  if (!G || !G.dang || !R || daHuy) return;
  G.idRaf = requestAnimationFrame(khungGao);
  const dt = Math.min(0.1, Math.max(0, (now - G.truoc) / 1000));
  G.truoc = now;
  let t = (now - G.t0) / 1000;
  // Tiếng đang chạy thì nó LÀ đồng hồ: trình duyệt có thể khựng phát tiếng, hình phải đi theo.
  if (G.amChay && AM && !AM.paused && AM.currentTime < G.dai) {
    t = AM.currentTime;
    G.t0 = now - t * 1000;
  }
  const D = G.dai;
  const ta = Math.min(t, D - 0.001);
  G.action.time = ta;
  G.action.setEffectiveWeight(Math.max(0, Math.min(1, ta / 0.2, (D - ta) / 0.35)));
  G.mixer.update(0);
  camGao(t, dt);
  R.render(SCENE, CAM);
  if (t >= G.het) dungGao();
}

const eIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const kep01 = (x) => Math.max(0, Math.min(1, x));
const DO = Math.PI / 180;

/** Đường máy lúc gào. Luôn tính TỪ trạng thái orbit hiện tại (TIEU, camR, camTheta, camPhi) chứ
 *  không từ một ảnh chụp lúc bấm — kéo đổi cỡ cửa sổ giữa chừng thì `doKhung` đổi camR và máy
 *  vẫn đi đúng. Người xem cầm máy (kéo/cuộn) thì `tuDo` và hàm này đứng ngoài. */
function camGao(t, dt) {
  const G = GAO;
  if (G.tuDo) return;
  const it = G.itChuyenDong;
  const uIn = eIO(kep01((t - 0.35) / (G.tv - 0.35)));
  const uOut = eIO(kep01((t - G.tr) / 1.3));
  const w = uIn * (1 - uOut) * (it ? 0.45 : 1);
  const a = it ? 0 : (t < 0.35 ? 1 - Math.pow(1 - t / 0.35, 2) : 1 - uIn) * (1 - uOut);

  // Góc mở thu hẹp TRƯỚC khi canh khung: phép chiếu bên dưới phải dùng đúng ống kính sẽ vẽ.
  const fov = FOV_TINH - 4 * w;
  if (Math.abs(CAM.fov - fov) > 1e-3) { CAM.fov = fov; CAM.updateProjectionMatrix(); }

  let tx = TIEU.x, ty = TIEU.y, tz = TIEU.z;
  const th = camTheta + 0.09 * w;                 // xoay về phía trước mặt
  const ph = camPhi + 0.02 * a + 0.06 * w;        // hạ máy thấp thêm
  let r = camR * (1 + 0.04 * a) * (1 - 0.25 * w);
  if (G.xuongDau) {
    MODEL.updateMatrixWorld(true);
    G.xuongDau.getWorldPosition(G.vGoc);
    if (G.chop) G.vChop.copy(G.chop).applyMatrix4(G.xuongDau.matrixWorld);
    else G.vChop.copy(G.vGoc);
    if (G.xuongHong) G.xuongHong.getWorldPosition(G.vHong);
    else G.vHong.set(TIEU.x, TIEU.y, TIEU.z);
    // Điểm nhìn = 65% đầu (giữa gốc sọ và chóp mõm) + 35% hông, làm mượt để máy không giật.
    G.vDau.copy(G.vGoc).lerp(G.vChop, 0.5).lerp(G.vHong, 0.35);
    G.dau.lerp(G.vDau, 1 - Math.exp(-dt * 6));
    const k = 0.8 * w;
    tx += (G.dau.x - tx) * k; ty += (G.dau.y - ty) * k; tz += (G.dau.z - tz) * k;

    /* 🔴 KHOẢNG CÁCH GIẢI TRỰC TIẾP mỗi khung, không đuổi theo bằng một hệ số tăng/giảm dần.
       Hai bản trước (hệ số cố định, rồi hệ số "lùi tự canh") đều thua ít nhất một loài: dáng gào của
       23 loài khác nhau quá xa — Deinosuchus ngóc thẳng mõm, Troodon quay mặt vào máy, Herrerasaurus
       hất đầu ra trước. Nên: lấy khoảng cách GẦN NHẤT mà gốc sọ, chóp mõm và hông cùng nằm trong
       vùng an toàn, tìm nhị phân như `doKhung` (3 điểm × 8 vòng — rẻ). Đo trên 23 loài 2026-09-23. */
    if (w > 0.02) {
      const vua = (rr) => {
        datCam(tx, ty, tz, rr, th, ph);
        CAM.updateMatrixWorld();
        for (const d of [G.vGoc, G.vChop, G.vHong]) {
          const v = G.vNdc.copy(d).project(CAM);
          if (v.z > 1 || Math.abs(v.x) > 0.86 || Math.abs(v.y) > 0.8) return false;
        }
        return true;
      };
      if (!vua(r)) {
        let lo = r, hi = camR * 2.5;
        for (let i = 0; i < 8; i++) { const giua = (lo + hi) / 2; if (vua(giua)) hi = giua; else lo = giua; }
        r = hi;
      }
    }
    // Lùi NHANH (đầu không kịp ra khỏi khung), tiến vào CHẬM (không giật theo từng cú hất đầu).
    if (!G.rMuot) G.rMuot = r;
    G.rMuot += (r - G.rMuot) * (1 - Math.exp(-dt * (r > G.rMuot ? 12 : 2.5)));
    r = G.rMuot;
  }
  datCam(tx, ty, tz, r, th, ph);

  if (it) return;              // giảm chuyển động: không rung, không nghiêng
  if (!G.daRung && t >= G.dinh) { G.trauma = 0.8; G.daRung = true; }
  G.trauma = Math.max(0, G.trauma - 0.5 * dt);
  const sk = G.trauma * G.trauma;
  const x = t * 14;
  const n = (p) => (Math.sin(x + p) + 0.5 * Math.sin(2.3 * x + 1.7 * p) + 0.25 * Math.sin(4.1 * x + 2.9 * p)) / 1.75;
  CAM.rotateZ(3.5 * DO * w + 2 * DO * sk * n(3.1));   // nghiêng máy kiểu điện ảnh + lắc
  CAM.rotateY(1.5 * DO * sk * n(0.7));
  CAM.rotateX(1.5 * DO * sk * n(5.3));
}

function dungGao() {
  const G = GAO;
  if (!G || !G.dang) return;
  G.dang = false;
  if (G.idRaf) { cancelAnimationFrame(G.idRaf); G.idRaf = 0; }
  G.action.stop();             // bỏ kích hoạt -> three trả mọi xương về tư thế gốc
  G.mixer.update(0);
  if (AM) AM.pause();
  G.amChay = false;
  if (dangGao === tuGao) dangGao = null;
  if (CAM) { CAM.fov = FOV_TINH; CAM.updateProjectionMatrix(); capNhatCam(); }
  capNhatNutGao();
  ve();
}

/** Người xem kéo/cuộn giữa lúc gào: trả máy cho họ ngay, hoạt ảnh và tiếng vẫn chạy tiếp. */
function nhaMayGao() {
  if (!GAO || !GAO.dang || GAO.tuDo) return;
  GAO.tuDo = true;
  CAM.fov = FOV_TINH;
  CAM.updateProjectionMatrix();
  capNhatCam();
}

/** Bỏ hẳn bộ gào của con đang xem (đổi loài, huỷ khung). Mô hình do bên gọi dọn. */
function boGao() {
  dungGao();
  if (GAO) { GAO.mixer.stopAllAction(); GAO = null; }
  if (AM) { AM.pause(); AM.removeAttribute("src"); AM = null; }
}

/** Chuyển tab thì im: tiếng gào vọng ra từ một tab không nhìn thấy là lỗi, không phải tính năng. */
function anTab() { if (document.hidden) dungGao(); }
document.addEventListener("visibilitychange", anTab);


/* ── Be mat cong khai cua mot ban ─────────────────────────────────────────────── */
return {
  khung: KHUNG,
  /** Mo mot con dino: {species, colors, growth, slot?}. */
  ve: moXem,
  /** Cap nhat tung phan — guong cua su kien `dino4vn:3d`. */
  capNhat(d) {
    d = d || {};
    if (d.loai !== undefined) {
      return moXem({ species: d.loai, colors: d.mau || (HIENTAI && HIENTAI.mau) || {},
                     growth: d.lon != null ? d.lon : (HIENTAI ? HIENTAI.growth : 1) });
    }
    if (d.mau) capNhatMau(d.mau);
    if (d.lon != null) capNhatLon(d.lon);
    if (d.canhlai) canhLaiKhung(true);
    if (d.canh !== undefined) apCanh(d.canh);
  },
  /** Ve lai (goi sau khi khung doi kich thuoc ma ResizeObserver khong bat duoc). */
  veLai: ve,

  /* 🔴 PHAI GOI khi bo mot the di. Khong goi thi WebGL context bi giu lai, va sau vai
     lan cat/lay con dino thi trinh duyet thu hoi context cua nhung khung dang hien —
     man hinh den tron ma khong loi nao bao. */
  huy() {
    if (daHuy) return;
    boGao();
    nutTiengCacKhung.delete(veNutTieng);
    document.removeEventListener("visibilitychange", anTab);
    if (DK && DK.parentNode) DK.parentNode.removeChild(DK);
    if (BONG) { BONG.geometry.dispose(); BONG.material.map.dispose(); BONG.material.dispose(); BONG = null; }
    daHuy = true;
    if (idVe) { cancelAnimationFrame(idVe); idVe = 0; }
    if (RO) { RO.disconnect(); RO = null; }
    if (MODEL && SCENE) {
      SCENE.remove(MODEL);
      MODEL.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry && o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          // Anh mat na cung phai tra lai: no la texture GPU, khong phai mot object thuong.
          if (m.userData && m.userData.mask && m.userData.mask.value
              && m.userData.mask.value.dispose) m.userData.mask.value.dispose();
          m.dispose();
        });
      });
      MODEL = null;
    }
    if (HIENTAI && HIENTAI.pbr) {
      ["n", "rac", "chiTiet"].forEach((k) => HIENTAI.pbr[k] && HIENTAI.pbr[k].dispose());
    }
    if (NEN) { NEN.dispose(); NEN = null; }
    if (MT_NEN) { MT_NEN.dispose(); MT_NEN = null; }
    if (MT_PHONG) { MT_PHONG.dispose(); MT_PHONG = null; }
    if (PMREM) { PMREM.dispose(); PMREM = null; }
    if (R) {
      R.dispose();
      // `dispose()` KHONG tra lai context ngay. `forceContextLoss()` moi tra — thieu no
      // thi context chi duoc thu hoi khi bo don rac chay, tuc la khong biet luc nao.
      if (R.forceContextLoss) { try { R.forceContextLoss(); } catch (e) { /* trinh duyet cu */ } }
      R = null;
    }
    SCENE = null; CAM = null; HIENTAI = null;
  },
};
}


/* ═══════════════════════════════════════════════════════════════════════════════
   BAN MAC DINH + HOP DONG SU KIEN

   Trang nao chi co MOT `.v3d` thi module tu gan mot ban vao do va giu nguyen hop dong
   su kien cu — `/me` va `/skin` khong phai sua mot dong nao.

   Trang co NHIEU khung (`/gara`) thi module KHONG tu gan gi ca: no khong the biet the
   nao ung voi con nao. Trang do tu goi `window.dino4vn3D.tao(khung)` cho tung the.
   ═════════════════════════════════════════════════════════════════════════════ */

/** Factory cho trang co nhieu khung. `gara.js` la script thuong (khong phai module)
 *  nen phai di qua `window`. */
window.dino4vn3D = { tao: taoBoXem };

/* 🔴 `data-tuquanly` la LOI TU CHOI TUONG MINH, khong phai trang tri.
   Dem so `.v3d` de doan "trang nay mot khung hay nhieu khung" HONG o /gara: luc module
   chay, danh sach gara chua duoc ve nen tren trang moi co DUNG MOT khung (con dang cuoi)
   — module se tu gan singleton vao no, roi vai tram mili giay sau trang tu tao them ba bo
   xem nua va hai ben tranh nhau. Nen trang tu quan ly phai NOI RA, dung de doan. */
const cacKhung = document.querySelectorAll(".v3d:not([data-tuquanly])");
const soKhung = cacKhung.length;
const MAC_DINH = soKhung === 1 ? taoBoXem(cacKhung[0]) : null;

// Bao cho trang biet factory da san sang. `/gara` cho su kien nay roi moi dung the —
// re hon han viec do `window.dino4vn3D` trong mot vong lap.
document.dispatchEvent(new CustomEvent("dino4vn:3d-san-sang", { detail: { soKhung } }));

if (MAC_DINH) {
  document.addEventListener("dino4vn:xem3d", (ev) => { MAC_DINH.ve(ev.detail || {}); });
  document.addEventListener("dino4vn:3d", (ev) => { MAC_DINH.capNhat(ev.detail || {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) MAC_DINH.veLai(); });

  /* ── Tu nap con dino trong gara: OPT-IN TUONG MINH ──────────────────────────
     Bam lan dau o ban `/gara` CU xay ra TRUOC khi module nay chay xong, nen phai tu
     doc lai o dang cho. `/skin` khong co gara nao de doc — nen trang phai TU KHAI
     `data-tunap="gara"`, thay vi de khoi nay doan qua su vang mat cua `data-slot`. */
  const K = MAC_DINH.khung;
  if (K && K.dataset.tunap === "gara") {
    const cho = K.getAttribute("data-slot");
    if (cho) {
      fetch("/api/player/garage/" + encodeURIComponent(cho), { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j && j.dino) MAC_DINH.ve(j.dino); })
        .catch(() => { /* khung tu hien trang thai loi cua no */ });
    }
  }
}