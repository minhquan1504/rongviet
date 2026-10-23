/* ============================================================================
   Dino4VN — trang gara khủng long.

   RÀNG BUỘC, KHÔNG PHẢI SỞ THÍCH:
   ·  CSP `style-src 'self'`  -> KHÔNG inline style. Quy ước repo còn chặt hơn:
      KHÔNG đụng `.style` gì cả. Bề rộng thanh chỉ số vì thế là thuộc tính
      `width` của một <rect> SVG, không phải CSS.
   ·  CSP `script-src 'self'` -> không inline script, không onclick=.
   ·  CSP `form-action 'none'`-> KHÔNG thẻ <form>. Đăng nhập bằng <a>, dữ liệu
      bằng fetch().
   ·  CSP `img-src 'self' data:` -> đây là ĐƯỜNG DUY NHẤT vẽ được 10 ô màu tuỳ ý
      mà không đụng style: một ảnh SVG dạng data: URI.
   ·  `deploy.sh` chặn tiền tố SteamID xuất hiện trong file tĩnh -> SteamID chỉ được JS đổ
      vào lúc chạy.
   ·  ES5 thuần cho cú pháp (var, function). Promise/fetch thì dùng — chúng là API,
      không phải cú pháp, và `fetch` vốn đã dùng từ đầu.

   ═══════════════════════════════════════════════════════════════════════════
   BỐ CỤC (người dùng chốt 2026-08-30)
   ═══════════════════════════════════════════════════════════════════════════
   Bản trước bắt người chơi chọn ô rồi bấm "Cất vào gara" mà KHÔNG hề hiện con
   đang cưỡi là con gì — quyết định trong mù. Nay:

       [ĐANG CƯỠI]   hình 3D + chỉ số + chọn ô + nút cất + luật thanh chờ
       [TRONG GARA]  mỗi ô một thẻ CÓ khung 3D xoay được ngay
       (hai khối hướng dẫn cũ đã chuyển sang /huong-dan#gara)

   ═══════════════════════════════════════════════════════════════════════════
   🔴 BA SỰ THẬT VỀ CƠ CHẾ CẤT — bỏ qua là nói dối người chơi
   ═══════════════════════════════════════════════════════════════════════════
   (nguồn: phiên `fix-garage-storage-deadlock`, người viết plugin gara)

   1. `POST /store` TRẢ VỀ SAU PHA 1 THÔI. Plugin mới đọc dữ liệu và ghi blob
      xuống đĩa; con dino VẪN ĐANG SỐNG và người chơi vẫn đang cưỡi. Sau đó là
      thanh chờ, và chỉ khi hết thanh chờ mà máu không tụt quá dung sai thì con
      đó mới bị giết + cho respawn. Máu tụt trong lúc chờ = HUỶ, blob bị xoá.

      🔴 SỐ GIÂY DO MÁY CHỦ NÓI (`cho` trong phản hồi), đừng chép một hằng số
      vào đây. Từ 2026-09-13 nó là 60 và đổi được LÚC ĐANG CHẠY (`garage_thamso`),
      nên bất cứ con số nào viết cứng ở tầng này đều sẽ lệch, và lệch im lặng.

      -> `ok: true` KHÔNG PHẢI "đã cất xong". Vẽ như đã xong là nói dối.

   2. MỘT Ô XUẤT HIỆN TRONG DANH SÁCH KHÔNG PHẢI BẰNG CHỨNG ĐÃ CẤT XONG. Blob
      nằm trên đĩa suốt thanh chờ, mà bộ lập chỉ mục chạy ngay sau thao tác.
      Nên ô có thể hiện ra rồi BIẾN MẤT khi hết chờ nếu bị huỷ — và người chơi
      sẽ tưởng mất dino.

      -> Trong lúc đếm ngược, KHÔNG vẽ lại danh sách.
      -> Hết đếm ngược mới hỏi lại, và lấy `/live` làm TRỌNG TÀI: hết cưỡi =
         cất xong thật; còn cưỡi = chưa xong hoặc đã bị huỷ.

   3. MÁY CHỦ CHỈ CHẠY MỘT VIỆC GARA TẠI MỘT THỜI ĐIỂM, CHO CẢ SERVER. Người
      khác đang trong thanh chờ thì lệnh của mình trả `"dang ban, thu lai sau"`.
      Đây là trạng thái BÌNH THƯỜNG, không phải sự cố -> không tô đỏ.
   ========================================================================= */
(function () {
  "use strict";

  var DUONG_3D = "/assets/dino3d.20261012.abc66f91.js";

  /* Số bộ xem 3D được sống cùng lúc. Mỗi bộ chiếm MỘT WebGL context và trình
     duyệt chỉ cho khoảng 8–16 context cho cả tab; quá ngưỡng thì context cũ bị
     thu hồi và khung đó đen trơn, KHÔNG có lỗi nào báo.
     Thực tế hôm nay `quota` mặc định là 3 nên trần này gần như không chạm tới —
     nó ở đây cho trường hợp VIP được đặt nhiều ô. */
  var TRAN_BO_XEM = 6;

  // 🔴 `health` = "Sinh lực" và `blood` = "Máu" — KHỚP với lớp phủ trong game và với
  //    panel admin. Bảng này từng gọi `health` là "Máu" và `blood` là "Huyết", nên chữ
  //    "Máu" chỉ hai chỉ số khác hẳn nhau tuỳ màn hình. Đừng đổi lại.
  var TEN_CHI_SO = { growth: "Trưởng thành", health: "Sinh lực", stamina: "Thể lực",
                     hunger: "No", thirst: "Nước", blood: "Máu", oxygen: "Oxy" };
  // Thứ tự cố định để thẻ nào cũng đọc giống nhau.
  var THU_TU = ["health", "stamina", "hunger", "thirst", "blood"];
  var TEN_MAU = { body: "Thân", flank: "Sườn", underbelly: "Bụng", markings: "Vằn",
                  maleDisplay: "Phô trương", teeth: "Răng", mouth: "Miệng",
                  claws: "Vuốt", detail1: "Chi tiết", eyes: "Mắt" };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function so(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  function hienKhoi(id) {
    ["gara-chuadangnhap", "gara-noidung"].forEach(function (k) {
      var n = $(k);
      if (n) n.hidden = (k !== id);
    });
  }

  function api(duong, o) {
    o = o || {};
    o.credentials = "same-origin";
    o.headers = o.headers || {};
    if (o.body) o.headers["Content-Type"] = "application/json";
    return fetch(duong, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        // `ly_do`: câu của phản hồi 429 có số (`main.nhip_429`) — nó không có `detail`.
        if (!r.ok) throw new Error(j.detail || j.ly_do || j.err || ("HTTP " + r.status));
        return j;
      });
    });
  }

  function thongBao(chu, loi) {
    var e = $("gara-ghichu");
    if (!e) return;
    e.textContent = chu;
    e.className = loi ? "dim nho canhbao" : "dim nho";
  }

  /* `dang ban` KHÔNG phải lỗi — máy chủ chỉ chạy một việc gara một lúc cho cả
     server, nên gặp nó là chuyện thường. Tô đỏ một trạng thái bình thường sẽ dạy
     người chơi rằng màu đỏ không có nghĩa gì. */
  function laBan(res) {
    return /dang ban|đang bận/i.test(String(res || ""));
  }

  /* ── Ô màu ────────────────────────────────────────────────────────────────
     Mười màu tuỳ ý cho mỗi con: không thể đặt sẵn trong CSS, và không được dùng
     `.style`. Một ảnh SVG 1x1 dạng data: URI giải quyết cả hai. Ảnh SVG không
     chạy được script nên đây vừa hợp lệ vừa an toàn.                          */
  function oMau(hex, ten) {
    var img = document.createElement("img");
    var h = String(hex || "").replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;   // màu lạ -> bỏ, không vẽ bừa
    img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E"
            + "%3Crect%20width='1'%20height='1'%20fill='%23" + h + "'/%3E%3C/svg%3E";
    // Màu KHÔNG BAO GIỜ là tín hiệu duy nhất — người mù màu vẫn phải đọc được.
    img.alt = (ten || "Màu") + ": #" + h;
    img.title = img.alt;
    img.width = 22; img.height = 22;
    return img;
  }

  function hangMau(mau) {
    var ds = el("div", "swatch");
    var co = false;
    for (var k in TEN_MAU) {
      if (!Object.prototype.hasOwnProperty.call(TEN_MAU, k)) continue;
      var img = (mau && mau[k]) ? oMau(mau[k], TEN_MAU[k]) : null;
      if (img) { ds.appendChild(img); co = true; }
    }
    return co ? ds : null;
  }

  /* ── Hàng chỉ số (bằng SỐ, không thanh) ───────────────────────────────────
     2026-09-25 chủ server chốt bỏ thanh %: thẻ nào có trần thì có thanh, thẻ nào
     thiếu (Sinh lực, Máu) thì một con số lạc giữa các thanh. Nay mọi hàng là
     nhãn ⟷ số, cùng cấu trúc DOM với năm hàng tĩnh ở `me.njk`.
     ⚠️ Bản sao của `me.js::noiDungChiSo` (hai file không chia module) — sửa một
        chỗ thì sửa cả hai.                                                     */

  // Số kiểu Việt ("7.620"). Trần dưới 100 (đói của con non chỉ 16,5) thì giữ 1 chữ
  // số lẻ, không thì cả hai vế làm tròn về 17 và cặp số mất nghĩa.
  function soVN(v, co) {
    return v.toLocaleString("vi-VN", { maximumFractionDigits: co < 100 ? 1 : 0 });
  }

  // `[chinh, phu]` — `phu` là phần " / trần" (có thể rỗng).
  // `ti` là tỉ lệ 0..1, `abs`/`tran` là số tuyệt đối; cái nào không có thì null.
  // 🔴 Cặp vô lý (`abs > tran`, kiểu "Hunger 195 / 4") KHÔNG BAO GIỜ được hiện —
  //    đó là bẫy lệch đơn vị §2.33. Không hợp lệ thì lùi về %, rồi về số thô.
  //    Thiếu trần thì chỉ hiện số thô: bịa ra một mẫu số là nói dối người chơi.
  function noiDungChiSo(khoa, ti, abs, tran) {
    if (khoa === "growth") {
      return ti === null ? ["—", ""] : [Math.round(Math.max(0, Math.min(1, ti)) * 100) + "%", ""];
    }
    var coAbs = abs !== null && abs >= 0;
    if (coAbs && tran !== null && tran > 0 && abs <= tran) {
      return [soVN(abs, tran), " / " + soVN(tran, tran)];
    }
    if (ti !== null) return [Math.round(Math.max(0, Math.min(1, ti)) * 100) + "%", ""];
    if (coAbs) return [soVN(abs, abs), ""];
    return ["—", ""];
  }

  function veChiSo(khoa, ti, abs, tran) {
    var nd = noiDungChiSo(khoa, so(ti), so(abs), so(tran));
    var hang = el("div", "stat");
    var dong = el("div", "chiso__hang");
    dong.appendChild(el("span", "stat__ten", TEN_CHI_SO[khoa] || khoa));
    var oSo = el("span", "stat__so", nd[0]);
    if (nd[1]) oSo.appendChild(el("span", "stat__tran", nd[1]));
    dong.appendChild(oSo);
    hang.appendChild(dong);
    return hang;
  }

  // 🔴 API trả `mutations` dạng OBJECT (16 khe tên + ô số adder), không phải mảng — bản cũ gặp
  //    object thì trả 0 nên badge "N đột biến" không bao giờ hiện (vá 2026-09-15). Chỉ đếm khoá
  //    tên khe (có "Slot"), bỏ "None"/rỗng; ô số adder không phải một đột biến.
  function demDotBien(mu) {
    if (!mu) return 0;
    var n = 0;
    if (Object.prototype.toString.call(mu) === "[object Array]") {
      for (var i = 0; i < mu.length; i++) {
        var v = mu[i];
        if (v && v !== "None" && v !== 0 && v !== "0") n++;
      }
      return n;
    }
    if (typeof mu === "object") {
      for (var k in mu) {
        if (!Object.prototype.hasOwnProperty.call(mu, k) || k.indexOf("Slot") < 0) continue;
        var t = mu[k];
        if (typeof t === "string" && t !== "" && t !== "None") n++;
      }
    }
    return n;
  }

  // Danh sách đột biến theo nhóm, từ trường `dot_bien` mà API đã chia sẵn
  // (`player/app/dot_bien.py`): [{nhan, ten: [{ten, vi}]}], nhóm trống đã bị bỏ.
  // Tên giữ tiếng Anh cho khớp màn hình trong game; mô tả tiếng Việt nằm ở `title`,
  // rê chuột mới hiện. Không có nhóm nào thì trả null: con không đột biến thì không có khối.
  function veDotBien(ds) {
    if (!ds || !ds.length) return null;
    var khoi = el("div", "dotbien");
    khoi.appendChild(el("p", "dotbien__td", "Đột biến"));
    var dl = el("dl", "dotbien__ds");
    for (var i = 0; i < ds.length; i++) {
      var nhom = ds[i], ten = nhom.ten || [];
      if (!ten.length) continue;
      dl.appendChild(el("dt", null, nhom.nhan));
      var dd = el("dd");
      for (var j = 0; j < ten.length; j++) {
        if (j) dd.appendChild(document.createTextNode(", "));
        var s = el("span", null, ten[j].ten);
        if (ten[j].vi) { s.className = "dotbien__ten"; s.title = ten[j].vi; }
        dd.appendChild(s);
      }
      dl.appendChild(dd);
    }
    khoi.appendChild(dl);
    return khoi;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BỘ XEM 3D — nhiều bản trên một trang
     ═══════════════════════════════════════════════════════════════════════
     `dino3d.js` là module ES; file này là script thường, nên cầu nối là
     `window.dino4vn3D` + sự kiện `dino4vn:3d-san-sang`.

     Module chỉ được nạp MỘT lần cho cả vòng đời trang, và chỉ khi ta ĐÃ BIẾT
     có con nào để vẽ — nạp three.js cho một gara rỗng là tiêu gần một MB của
     người dùng để hiện mấy khung trống. */
  var choBoXem = null;
  function napBoXem() {
    if (choBoXem) return choBoXem;
    choBoXem = new Promise(function (xong, hong) {
      if (window.dino4vn3D) { xong(window.dino4vn3D); return; }
      document.addEventListener("dino4vn:3d-san-sang", function () {
        xong(window.dino4vn3D);
      }, { once: true });
      var s = document.createElement("script");
      s.type = "module";
      s.src = DUONG_3D;
      s.onerror = function () { hong(new Error("khong tai duoc bo xem 3D")); };
      document.head.appendChild(s);
    });
    return choBoXem;
  }

  /** Khung 3D rỗng, đúng cấu trúc mà `dino3d.js` mong đợi. */
  function khung3D(themClass) {
    var k = el("section", "v3d " + themClass);
    k.setAttribute("data-tuquanly", "1");     // trang tự quản lý, module đừng tự gắn
    k.setAttribute("data-state", "idle");
    var san = el("div", "v3d__san");
    var c = document.createElement("canvas");
    c.className = "v3d__canvas";
    c.width = 1; c.height = 1;
    san.appendChild(c);
    san.appendChild(el("p", "v3d__msg", "Đang tải mô hình…"));
    k.appendChild(san);
    return k;
  }

  /* 🔴 CANVAS ĐÃ MẤT CONTEXT THÌ KHÔNG DÙNG LẠI ĐƯỢC — PHẢI THAY PHẦN TỬ.
     `huy()` gọi `forceContextLoss()` để trả context ngay thay vì đợi bộ dọn rác.
     Nhưng đo được trên chính Chrome đang chạy: sau đó `canvas.getContext("webgl2")`
     trên CÙNG phần tử vẫn trả về một context có `isContextLost() === true`; chỉ một
     phần tử canvas MỚI mới lấy được context sống.

     Hậu quả nếu bỏ qua: người chơi thôi cưỡi (khung bị huỷ) rồi cưỡi lại -> bộ xem mới
     dựng trên canvas chết -> khung đen trơn VĨNH VIỄN, không lỗi nào báo. Đúng kiểu
     hỏng im lặng mà repo này đã trả giá nhiều lần. */
  function lamMoiCanvas(khung) {
    var cu = khung && khung.querySelector(".v3d__canvas");
    if (!cu) return;
    var moi = document.createElement("canvas");
    moi.className = cu.className;
    if (cu.id) moi.id = cu.id;
    moi.width = 1; moi.height = 1;
    cu.parentNode.replaceChild(moi, cu);
  }

  /* Sổ các bộ xem đang sống. Danh sách gara được vẽ lại sau mỗi thao tác, nên
     KHÔNG dọn là rò một WebGL context mỗi lần — vài lần cất/lấy là trình duyệt
     thu hồi context của những khung đang hiện, màn hình đen mà không lỗi nào báo. */
  var dangSong = [];

  /* `lamLai` = cách dựng lại chính bộ xem này. Bắt buộc phải giữ, vì khi thu hồi theo
     trần thì THẺ VẪN NẰM TRONG DOM — khác hẳn lúc vẽ lại cả danh sách. Chỉ `huy()` rồi
     thôi là để lại một khung chết mà người chơi cuộn về cũng không bao giờ sống lại
     (IntersectionObserver đã `disconnect()` sau lần bắn đầu tiên). */
  function themBoXem(bx, khung, lamLai) {
    dangSong.push({ bx: bx, khung: khung, lamLai: lamLai });
    while (dangSong.length > TRAN_BO_XEM) {
      var cu = dangSong.shift();
      if (cu.bx && cu.bx.huy) cu.bx.huy();
      if (cu.khung) {
        lamMoiCanvas(cu.khung);
        cu.khung.setAttribute("data-state", "idle");
        var m = cu.khung.querySelector(".v3d__msg");
        if (m) m.textContent = "Đang tải mô hình…";
        if (cu.lamLai) ganKhiThay(cu.khung, cu.lamLai);   // cuộn về thì dựng lại
      }
    }
  }
  /* Dọn sạch khi vẽ lại CẢ danh sách. Không cần thay canvas ở đây: toàn bộ thẻ bị
     ném khỏi DOM ngay sau đó, canvas chết cùng chúng. */
  function donBoXem() {
    for (var i = 0; i < dangSong.length; i++) {
      if (dangSong[i].bx && dangSong[i].bx.huy) dangSong[i].bx.huy();
    }
    dangSong = [];
  }

  /* Chỉ dựng bộ xem khi thẻ đã vào tầm nhìn.
     Không phải để "tối ưu cho VIP 20 ô" — với 3 ô nó vẫn có lợi thật trên điện
     thoại: thẻ dưới màn hình không tải `.glb` (62–760 KB mỗi con) cho tới khi
     người ta cuộn tới. */
  function ganKhiThay(phanTu, lam) {
    if (typeof IntersectionObserver !== "function") { lam(); return; }
    var ob = new IntersectionObserver(function (muc) {
      for (var i = 0; i < muc.length; i++) {
        if (muc[i].isIntersecting) { ob.disconnect(); lam(); return; }
      }
    }, { rootMargin: "200px" });
    ob.observe(phanTu);
  }

  /** Gắn một bộ xem vào `khung` và vẽ `d`. Nuốt lỗi: khung tự hiện trạng thái của nó. */
  function veVao(khung, d) {
    return napBoXem().then(function (bo) {
      var bx = bo.tao(khung);
      themBoXem(bx, khung, function () { veVao(khung, d); });
      return bx.ve(d);
    }).catch(function () {
      khung.setAttribute("data-state", "error");
      var m = khung.querySelector(".v3d__msg");
      if (m) m.textContent = "Không tải được bộ xem 3D.";
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     KHỐI "ĐANG CƯỠI"
     ═══════════════════════════════════════════════════════════════════════ */

  var boXemGC = null;      // bộ xem của khối này, sống suốt vòng đời trang
  var conDangCuoi = null;  // {species, growth, female, colors} hoặc null

  function veDangCuoi(live, skin) {
    var song = (live && live.song) || {};
    var loai = song.species || null;
    conDangCuoi = null;

    var eLoai = $("gc-loai"), eTT = $("gc-tt"), eGT = $("gc-gt"), eCS = $("gc-chiso");
    if (eCS) eCS.textContent = "";

    if (!loai) {
      // Ba lý do khác nhau, ba câu khác nhau. Gộp làm một là bắt người chơi đoán.
      var vi_sao;
      if (song.nguon_hong) vi_sao = "Chưa xem được bạn có đang chơi không.";
      /* 🔴 "Đã chết" phải đứng TRƯỚC "không ở trong game". Người vừa chết vẫn đang kết
         nối — họ đứng ở màn chọn loài — nên câu "bạn không ở trong game" là sai về đúng
         thứ họ đang nhìn. Cờ này do dịch vụ người chơi phát (2026-09-23), sau khi
         snapshot RCON bị bắt quả tang vẫn khoe con đã chết trong ô này cả phút. */
      else if (song.da_chet === true) vi_sao = "Con của bạn đã chết.";
      else if (song.in_game === true) vi_sao = "Bạn đang ở màn chọn loài.";
      else vi_sao = "Bạn không ở trong game.";
      /* Người dùng chốt 2026-09-23: ô này nói thẳng "Không có dữ liệu" thay vì một câu
         đoán về trạng thái. Lý do CỤ THỂ nằm ngay dưới, ở `eTT`. */
      if (eLoai) eLoai.textContent = "Không có dữ liệu";
      if (eTT) { eTT.textContent = vi_sao; eTT.className = "pill"; }
      if (eGT) eGT.hidden = true;
      dat3DTrong("Vào game và cưỡi một con thì hình của nó hiện ở đây.");
      return;
    }

    conDangCuoi = {
      species: loai,
      growth: so(song.growth),
      female: song.gender === "female",
      colors: (skin && skin.ok && skin.species === loai && skin.colors) || null
    };

    if (eLoai) eLoai.textContent = loai;
    if (eTT) { eTT.textContent = "Đang cưỡi"; eTT.className = "pill pill--luc"; }
    if (eGT) {
      eGT.hidden = false;
      eGT.textContent = conDangCuoi.female ? "Cái" : "Đực";
    }

    if (eCS) {
      var g = so(song.growth);
      if (g !== null) eCS.appendChild(veChiSo("growth", g, null, null));
      for (var i = 0; i < THU_TU.length; i++) {
        var k = THU_TU[i];
        // `/live` trả `song[k]` là TỈ LỆ 0..1, còn `k_abs`/`k_max` là số tuyệt đối —
        // CHỈ có khi nguồn là plugin. Hai đơn vị đi hai tham số riêng, không bao giờ
        // trộn (CLAUDE.md §2.33: đọc là tỉ lệ, ghi là số tuyệt đối).
        if (so(song[k]) !== null || so(song[k + "_abs"]) !== null) {
          eCS.appendChild(veChiSo(k, song[k], song[k + "_abs"], song[k + "_max"]));
        }
      }
      var mh = hangMau(conDangCuoi.colors);
      if (mh) eCS.appendChild(mh);
    }

    var khung = $("gc-3d");
    if (khung) {
      napBoXem().then(function (bo) {
        if (!boXemGC) boXemGC = bo.tao(khung, { ghi: $("gc-3d-ghi") });
        return boXemGC.ve({
          species: conDangCuoi.species,
          colors: conDangCuoi.colors || {},
          growth: conDangCuoi.growth == null ? 1 : conDangCuoi.growth
        });
      }).catch(function () {
        khung.setAttribute("data-state", "error");
        var m = $("gc-3d-msg");
        if (m) m.textContent = "Không tải được bộ xem 3D.";
      });
    }
  }

  function dat3DTrong(chu) {
    var khung = $("gc-3d"), m = $("gc-3d-msg"), g = $("gc-3d-ghi");
    if (boXemGC) {
      boXemGC.huy();
      boXemGC = null;
      lamMoiCanvas(khung);      // không thay là lần cưỡi sau khung đen vĩnh viễn
    }
    if (khung) khung.setAttribute("data-state", "trong");
    if (m) m.textContent = chu;
    if (g) g.textContent = "";
  }

  /* ── Chọn ô + nút cất ─────────────────────────────────────────────────────
     `quota` = SỐ Ô TỐI ĐA của người này (mặc định 3; VIP do admin đặt riêng).
     Nó có thể `undefined` khi dịch vụ không đọc được hạn mức — lúc đó KHÔNG
     được đoán một con số. Ô 99 dành cho bảo hiểm, người chơi không đụng tới. */
  function veThaoTac(slots, quota) {
    var boc = $("gc-thaotac"), nhac = $("gc-nhac");
    if (!boc) return;
    boc.textContent = "";
    if (nhac) nhac.textContent = "";

    if (!conDangCuoi) return;               // không cưỡi gì thì không có gì để cất

    if (typeof quota !== "number" || quota < 1) {
      // 98 là TRẦN CỨNG của plugin, chưa bao giờ là số ô người chơi thật sự có.
      // Vẽ 98 ô rồi để người ta bấm vào ô không tồn tại là hứa một thứ máy chủ
      // sẽ từ chối.
      boc.appendChild(el("p", "canhbao",
        "Chưa xem được số ô của bạn lúc này. Thử tải lại trang sau."));
      return;
    }

    var dung = {};
    (slots || []).forEach(function (s) { dung[s.slot] = true; });
    var trong = [];
    for (var i = 1; i <= quota; i++) if (!dung[i]) trong.push(i);

    if (!trong.length) {
      boc.appendChild(el("p", "canhbao",
        "Gara đã đầy " + quota + "/" + quota + " ô. Lấy một con ra rồi mới cất con mới được."));
      return;
    }

    var hang = el("div", "row");
    var nhan = el("label", null, "Cất vào ô ");
    nhan.setAttribute("for", "gara-chon-o");
    hang.appendChild(nhan);

    var chon = document.createElement("select");
    chon.id = "gara-chon-o";
    chon.className = "act";
    for (var j = 1; j <= quota; j++) {
      var o = document.createElement("option");
      o.value = String(j);
      if (dung[j]) {
        // 🔴 KHÔNG còn ghi đè (người dùng chốt 2026-08-30). Ô đang có dino thì
        //    làm mờ hẳn: máy chủ cũng từ chối, nên cho bấm được là hứa hão rồi
        //    báo lỗi.
        o.textContent = "Ô " + j + " — đang có dino (lấy ra trước)";
        o.disabled = true;
      } else {
        o.textContent = "Ô " + j + " — trống";
      }
      chon.appendChild(o);
    }
    chon.value = String(trong[0]);           // mặc định: ô trống đầu tiên
    hang.appendChild(chon);

    var nut = el("button", "act act--primary", "Cất vào gara");
    nut.addEventListener("click", function () { catVao(parseInt(chon.value, 10), nut); });
    hang.appendChild(nut);
    boc.appendChild(hang);

    if (nhac) {
      // Chưa gọi máy chủ nên CHƯA BIẾT thanh chờ dài bao nhiêu. Nói một con số ở đây là
      // đoán, và đoán sai thì người chơi bỏ đi sớm. Số thật hiện ngay sau khi bấm.
      nhac.textContent = "Bấm xong hãy ĐỨNG YÊN cho hết thanh chờ (số giây và số mét hiện "
        + "ngay sau khi bấm). Máu tụt, hoặc đi quá xa chỗ bấm, đều là huỷ — kể cả tụt vì "
        + "đói/khát. Dino vẫn an toàn, không mất gì. Bạn có " + quota + " ô, còn trống "
        + trong.length + ".";
    }
  }

  /* ── Cất ──────────────────────────────────────────────────────────────────
     Xem khối "BA SỰ THẬT" ở đầu file trước khi sửa hàm này. */
  function catVao(slot, nut) {
    nut.disabled = true;
    thongBao("Đang gửi yêu cầu…", false);
    api("/api/player/garage/store", { method: "POST", body: JSON.stringify({ slot: slot }) })
      .then(function (j) {
        if (!j.ok) {
          nut.disabled = false;
          var ban = laBan(j.res);
          thongBao(ban
            ? "Máy chủ đang xử lý việc gara của người khác. Chờ một chút rồi bấm lại."
            : "Không cất được: " + (j.res || j.detail || "không rõ lý do"), !ban);
          return;
        }
        // Máy chủ trả về ô THẬT SỰ được dùng — có thể khác số đã gửi (`slot: 0`
        // nghĩa là để máy chủ tự chọn). Nói lại đúng số đó, không lặp lại số mình gửi.
        var o = (typeof j.slot === "number" && j.slot > 0) ? j.slot : slot;
        // 🔴 Số giây lấy TỪ MÁY CHỦ (`cho`, plugin trả từ 2026-09-13). Trước đó chỗ này
        //    đếm ngược một hằng số 30 của riêng nó, không liên quan gì tới thanh chờ thật
        //    trong `.so`. Hai đồng hồ độc lập: khi một bên đổi, trang này đếm hết giờ, thấy
        //    người chơi VẪN đang cưỡi (vì server còn đang chờ) rồi kết luận "có lẽ bị huỷ
        //    do mất máu" — sai cho 100% lượt cất, không lỗi, không dấu hiệu nào.
        // ⚠️ Thiếu `cho` = `.so` cũ hơn 2026-09-13, và nó chờ 30 giây thật.
        var giay = (typeof j.cho === "number" && j.cho > 0) ? j.cho : 30;
        // 🔴 KHÁC `cho`: ở đây KHÔNG có giá trị lùi. `0` và "thiếu trường" đều nghĩa là
        //    trang này KHÔNG được nói số mét nào cả — `0` là một giá trị THẬT nghĩa là cổng
        //    đang TẮT (`garage_thamso {"dixa":"0"}`), còn "thiếu" nghĩa là `.so` cũ hơn
        //    2026-09-16 và chưa hề có cổng. Tự điền `3` vào đây là dựng lại đúng bệnh
        //    "hai đồng hồ độc lập" mà khối chú thích ngay trên vừa mô tả.
        var dx = (typeof j.di_xa_m === "number" && j.di_xa_m > 0) ? j.di_xa_m : 0;
        demNguoc(o, giay, dx);
      })
      .catch(function (e) {
        nut.disabled = false;
        thongBao("Không cất được: " + e.message, true);
      });
  }

  /* Thanh chờ, `giay` giây — con số do MÁY CHỦ nói, xem `catVao`. Trong lúc này KHÔNG vẽ
     lại danh sách: blob đã nằm trên đĩa nên ô mới có thể hiện ra, rồi biến mất nếu bị huỷ —
     và người chơi sẽ tưởng mất dino. */
  function demNguoc(o, giay, dx) {
    var boc = $("gc-thaotac");
    if (!boc) return;
    boc.textContent = "";
    var d = el("p", "dem");
    boc.appendChild(d);
    /* 🔴 BÙ LỆCH ĐIỂM BẮT ĐẦU, không phải lệch độ dài. Máy chủ trả lời NGAY sau pha 1
       (ghi blob xuống đĩa); đồng hồ thanh chờ của nó chỉ chạy từ lúc `cho_nhan()` đặt
       `t_armed`, tức sau pha ghi đĩa cộng ít nhất một nhịp quét 10 Hz. Đếm đủ `giay` rồi
       hỏi ngay thì trang này về đích TRƯỚC máy chủ, thấy người chơi vẫn đang cưỡi, và in
       "có lẽ bị huỷ do máu tụt" cho một lượt cất giây sau đó thành công.
       Khớp ĐỘ DÀI hai đồng hồ là chưa đủ — phải khớp cả ĐIỂM BẮT ĐẦU, và ta không đo được
       điểm bắt đầu của máy chủ, nên cộng biên. 3 giây: đủ phủ pha ghi đĩa + một nhịp quét,
       và đủ ngắn để không ai thấy trang bị treo. */
    var BU_GIAY = 3;
    var conLai = giay;
    function nhip() {
      d.textContent = "Đang cất vào ô " + o + " — ĐỨNG YÊN"
        + (dx ? " (đừng đi quá " + dx + " m)" : "") + ", đừng để máu tụt. Còn "
        + conLai + " giây.";
      if (conLai <= 0) {
        d.textContent = "Đang cất vào ô " + o + " — sắp xong, đứng yên thêm chút.";
        setTimeout(function () { xongDemNguoc(o, giay); }, BU_GIAY * 1000);
        return;
      }
      conLai--;
      setTimeout(nhip, 1000);
    }
    nhip();
    thongBao("", false);
  }

  /* `/live` là TRỌNG TÀI. Danh sách gara không trả lời được câu "đã cất xong
     chưa" (xem sự thật số 2 ở đầu file), nhưng "còn đang cưỡi không" thì có. */
  function xongDemNguoc(o, giay) {
    thongBao("Đang kiểm tra kết quả…", false);
    return Promise.all([
      api("/api/player/live").catch(function () { return null; }),
      api("/api/player/garage").catch(function () { return null; })
    ]).then(function (r) {
      var live = r[0], gara = r[1];
      var conCuoi = !!(live && live.song && live.song.species);
      if (live && !conCuoi) {
        thongBao("Đã cất xong vào ô " + o + ". Bạn quay về màn chọn loài.", false);
      } else if (live) {
        // 🔴 TRANG NÀY KHÔNG ĐO ĐƯỢC NGUYÊN NHÂN. Bản trước khẳng định "nhiều khả năng do
        //    máu tụt" — đã sai sẵn (còn `gate_check`, `G_QUOTA`… ở cuối thanh chờ), và từ
        //    2026-09-16 có thêm "đi quá xa" nên nó sai thêm ~10–15% số lượt. Đổi một lời
        //    đoán sai thành một lời đoán sai khác thì không tốt hơn: chỉ tay về nguồn CÓ
        //    THẨM QUYỀN (khung chat trong game, nơi máy chủ nói đúng lý do) thì trung thực,
        //    và đúng cả với những nguyên nhân chưa ai nghĩ tới.
        thongBao("Chưa cất được — bạn vẫn đang cưỡi con này. Máy chủ đã nhắn LÝ DO CHÍNH XÁC "
               + "vào khung chat trong game (máu tụt, hoặc đi quá xa chỗ bấm). Dino vẫn an "
               + "toàn, không mất gì.", true);
      } else {
        thongBao("Đã hết " + giay + " giây nhưng chưa xem được kết quả. Bấm Tải lại.", true);
      }
      return veTatCa(live, gara, true);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     KHO
     ═══════════════════════════════════════════════════════════════════════ */

  /* `quota` = số ô người này ĐƯỢC dùng. Ô mang số lớn hơn thế bị KHOÁ ở đường LẤY —
     `ops/chatbot/dino4vn1-chatbot.py::o_bi_khoa` (`o > tran`) gác CẢ `!lay` trong game lẫn
     nút dưới đây (nút web đi qua `/noibo/lay` của chính bot đó). Nên cho bấm được là hứa
     hão rồi báo lỗi — đúng cái luật mà `veThaoTac` đã viết ra cho ô đã có dino. */
  function veThe(d, quota) {
    var the = el("article", "dino dino--3d");

    var khung = khung3D("v3d--o");
    the.appendChild(khung);
    ganKhiThay(khung, function () {
      veVao(khung, { species: d.species, colors: d.colors || {},
                     growth: d.growth == null ? 1 : d.growth, slot: d.slot });
    });

    var than = el("div", "dino__than");

    var top = el("div", "dino__top");
    top.appendChild(el("h3", "dino__ten", d.species || "Không rõ loài"));
    top.appendChild(el("span", "dino__o", "Ô " + d.slot));
    than.appendChild(top);

    var gt = (d.female ? "Cái" : "Đực");
    var lon = Math.round((d.growth || 0) * 100) + "% trưởng thành";
    than.appendChild(el("p", "dino__meta", gt + ", " + lon));

    // Chỗ cất (2026-10-06): chỉ TÊN địa danh gần nhất do dịch vụ người chơi tính, không toạ độ.
    // Vắng = ô không có chỗ cất (đời cũ, hoàn tay) hoặc không gần địa danh nào — không nói gì cả.
    var cc = d.cho_cat;
    if (cc && typeof cc.ten === "string" && cc.ten) {
      var xa = (typeof cc.km === "number" && cc.km >= 0.5)
        ? " (" + String(cc.km).replace(".", ",") + " km)" : "";
      than.appendChild(el("p", "dino__meta", "Cất gần " + cc.ten + xa));
    }

    if (!d.ok) {
      // Blob có nhưng đọc không ra. Ô vẫn phải hiện — làm nó biến mất là cách
      // nhanh nhất khiến người chơi tưởng mất dino.
      than.appendChild(el("p", "dim canhbao", "Chưa đọc được chi tiết con này."));
    }

    var mh = hangMau(d.colors);
    if (mh) than.appendChild(mh);

    // Gom vào một `.chiso` để nhịp dòng giống hệt /me và con đang cưỡi — để rời thì mỗi
    // hàng ăn thêm khoảng cách 10px của `.dino__than`.
    var v = d.vitals || {}, vm = d.vitals_max || {};
    var cs = el("div", "chiso");
    for (var i = 0; i < THU_TU.length; i++) {
      var key = THU_TU[i];
      if (typeof v[key] === "number") cs.appendChild(veChiSo(key, null, v[key], vm[key]));
    }
    if (cs.firstChild) than.appendChild(cs);

    // API chưa có `dot_bien` (web lên trước dịch vụ người chơi) thì lùi về nhãn đếm cũ.
    var coDs = Object.prototype.toString.call(d.dot_bien) === "[object Array]";
    var dotBien = coDs ? veDotBien(d.dot_bien) : null;
    if (dotBien) than.appendChild(dotBien);

    var huy = el("div", "row");
    var nDot = coDs ? 0 : demDotBien(d.mutations);
    if (nDot > 0) huy.appendChild(el("span", "pill", nDot + " đột biến"));
    if (d.elder_stacks > 0) huy.appendChild(el("span", "pill pill--gold",
      "Trùng sinh " + d.elder_stacks));
    if (d.stored_at) {
      var t = new Date(d.stored_at * 1000);
      huy.appendChild(el("span", "pill", "Gửi " + t.toLocaleDateString("vi-VN")));
    }
    if (huy.childNodes.length) than.appendChild(huy);

    // 🔴 `quota` chưa đọc được (`undefined`/NaN) thì KHÔNG khoá gì — đoán theo hướng khoá
    //    là tố cáo người đã trả tiền dựa trên một con số ta còn chưa đọc được.
    //    ⚠️ NHƯNG `0` KHÔNG phải "chưa đọc được": `garage_quota.doc_quota` trả `MAC_DINH`
    //    cho mọi lần đọc hỏng và trả `0` **chỉ khi** file ghi đúng `"0"` = bị chặn hẳn.
    //    Nên phải `>= 0`, không phải `> 0` — nếu không người bị chặn hoàn toàn lại là
    //    người DUY NHẤT thấy mọi nút còn sáng, rồi bấm cái nào cũng bị `o_bi_khoa` từ chối.
    var biet = typeof quota === "number" && quota >= 0;
    // 🔴 Ô 99 là ảnh chụp BẢO HIỂM do hệ thống giữ, không phải ô của người chơi — và
    //    `POST /api/player/garage/load` từ chối thẳng `slot 99` (400). Nó luôn `> quota`
    //    nhưng KHÔNG được mang câu "hết hạn mức": lý do không lấy được của nó khác hẳn.
    //    `list_dinos` không lọc slot nên ô này CÓ tới đây thật.
    if (d.slot === 99) {
      than.appendChild(el("p", "dim nho mb-0",
        "Ảnh chụp bảo hiểm do hệ thống giữ — không lấy ra từ đây. Mất dino thì báo admin."));
    } else if (biet && d.slot > quota) {
      // Không dựng nút rồi `disabled`: `.act:disabled` chỉ làm mờ 50%, trên nền hổ phách
      // đọc vẫn như một nút bấm được. Bỏ hẳn nút + nói lý do, đúng khuôn `skin-tu.js`.
      than.appendChild(el("p", "dim nho canhbao mb-0",
        "Đang khoá — bạn chỉ còn " + quota + " ô. Con này VẪN NẰM NGUYÊN trong gara, "
        + "không mất đi đâu. Ủng hộ lại là mở khoá."));
    } else {
      var nut = el("div", "dino__nut");
      var bLay = el("button", "act act--primary", "Lấy ra");
      bLay.addEventListener("click", function () { layRa(d.slot, bLay); });
      nut.appendChild(bLay);
      // Nút Xoá (2026-09-28). CHỈ khi có loài + growth + mốc cất: máy chủ đối chiếu đúng ba thứ
      // đó với ô trên đĩa (`ky_vong`). KHÔNG đòi `d.ok`: `parse_ok = 0` cả khi blob chỉ thiếu MÀU,
      // mà màu không liên quan gì tới việc xoá (review PR #138).
      // Ô 99 và ô vượt hạn mức đã rẽ sang hai nhánh trên — không bao giờ tới đây.
      var canhXoa = null;
      if (d.species && typeof d.growth === "number" && typeof d.stored_at === "number") {
        var bXoa = el("button", "act", "Xoá");
        canhXoa = el("p", "dim nho canhbao mb-0",
          "Xoá " + d.species + " " + Math.round(d.growth * 100)
          + "% là mất vĩnh viễn, không lấy lại được.");
        canhXoa.hidden = true;
        bXoa.addEventListener("click", function () { xoaO(d, bXoa, bLay, canhXoa); });
        nut.appendChild(bXoa);
      }
      than.appendChild(nut);
      if (canhXoa) than.appendChild(canhXoa);
    }

    the.appendChild(than);
    return the;
  }

  function veTheTrong(slotNum) {
    var the = el("article", "dino dino--3d dino--trong");

    var khung = el("div", "v3d v3d--o v3d--trong");
    var san = el("div", "v3d__san");
    var msg = el("div", "v3d__msg--trong");
    msg.appendChild(el("span", "v3d__icon--trong", "🏕️"));
    msg.appendChild(el("p", "dim", "Ô số " + slotNum + " đang trống"));
    san.appendChild(msg);
    khung.appendChild(san);
    the.appendChild(khung);

    var than = el("div", "dino__than");
    var top = el("div", "dino__top");
    top.appendChild(el("h3", "dino__ten", "Ô " + slotNum + " — Trống"));
    top.appendChild(el("span", "dino__o", "Ô " + slotNum));
    than.appendChild(top);

    than.appendChild(el("p", "dino__meta", "Chưa có khủng long nào. Sẵn sàng để cất."));

    var nut = el("div", "dino__nut");
    var bCat = el("button", "act", "Cất vào ô " + slotNum);
    bCat.addEventListener("click", function () {
      catVao(slotNum, bCat);
    });
    nut.appendChild(bCat);
    than.appendChild(nut);

    the.appendChild(than);
    return the;
  }

  function veDanhSach(slots, quota) {
    var boc = $("gara-danhsach"), dem = $("gara-dem");
    if (!boc) return;
    donBoXem();                       // trả lại WebGL context của lần vẽ trước
    boc.textContent = "";

    var q = (typeof quota === "number" && quota > 0) ? quota : 3;
    var n = (slots || []).length;
    if (dem) {
      dem.textContent = "· Đã dùng " + n + "/" + q + " ô (Còn trống " + Math.max(0, q - n) + " ô)";
    }

    var luoi = el("div", "kho__luoi");

    var slotMap = {};
    (slots || []).forEach(function (d) {
      var sNum = (typeof d.slot === "number" && d.slot > 0) ? d.slot : null;
      if (sNum) slotMap[sNum] = d;
    });

    for (var j = 1; j <= q; j++) {
      if (slotMap[j]) {
        luoi.appendChild(veThe(slotMap[j], q));
      } else {
        luoi.appendChild(veTheTrong(j));
      }
    }

    (slots || []).forEach(function (d) {
      if (d.slot > q) {
        luoi.appendChild(veThe(d, q));
      }
    });

    boc.appendChild(luoi);
  }

  function layRa(slot, nut) {
    nut.disabled = true;
    thongBao("Đang gửi yêu cầu lấy ô " + slot + "…", false);
    api("/api/player/garage/load", { method: "POST", body: JSON.stringify({ slot: slot }) })
      .then(function (j) {
        // "ok" nghĩa là máy chủ ĐÃ NHẬN VIỆC, không phải con dino đã đứng trong game.
        // Nói đúng sự thật — đây là chỗ dễ làm người chơi hiểu nhầm nhất.
        //
        // 🔴 SỬA 2026-09-04. Câu cũ nói "bạn phải đang ở màn chọn loài, HOẶC đang cưỡi một
        //    con cùng loài". Vế đầu nay SAI: lấy dino khi chưa cưỡi con nào đã bị từ chối
        //    hẳn. Để nguyên là một lời hứa chết — cùng họ với link Discord hỏng trong
        //    `Game.ini` (CLAUDE.md §2.19): vẫn hiển thị, vẫn không báo lỗi, vẫn dẫn sai.
        //
        // Số giây lấy từ máy chủ (`cho_lay_s`) chứ không chép lại ở đây: hai con số rồi sẽ
        // lệch nhau, và cái lệch đó không có gì báo.
        if (j.ok) {
          // `noi_hien` (2026-10-06): dịch vụ chờ nói con sẽ hiện ở CHỖ ĐÃ CẤT hay TẠI CHỖ — câu cuối phải theo
          // đúng nó, vì người được báo trước là người quanh chỗ con dino HIỆN RA. Vắng (dịch vụ cũ) = câu cũ.
          var oDau = j.noi_hien === "cho_cat"
            ? "Con sẽ hiện ra ở CHỖ BẠN ĐÃ CẤT, người chơi quanh chỗ đó đã được báo trước."
            : "Người chơi quanh bạn đã được báo trước.";
          thongBao("Đã nhận. Bạn phải ĐANG CƯỠI một con cùng loài và ĐỨNG YÊN "
                 + (j.cho_lay_s || 60) + " giây — bị đánh, hoặc xê dịch quá "
                 + (j.di_xa_m || 3) + " mét khỏi chỗ đang đứng, là huỷ (kiểm mỗi giây). "
                 + "Huỷ thì dino vẫn còn nguyên trong gara. " + oDau, false);
        } else {
          var ban = laBan(j.res);
          // ⚠️ `j.res` KHÔNG CÓ DẤU tiếng Việt, và đó là cố ý chứ không phải lỗi font:
          //    cùng một câu này còn được gửi vào trong game qua RCON, mà kênh đó chưa
          //    chứng minh hiển thị được dấu.
          thongBao(ban
            ? "Máy chủ đang xử lý việc gara của người khác. Chờ một chút rồi bấm lại."
            : (j.res || "Không lấy được: không rõ lý do"), !ban);
        }
        return taiLai();
      })
      .catch(function (e) { thongBao("Không lấy được: " + e.message, true); })
      .then(function () { nut.disabled = false; });
  }

  /* ── Xoá một ô (2026-09-28, người dùng chốt) ─────────────────────────────
     Không `confirm()` (chặn luồng sự kiện của cả trang) — bấm hai lần trong 5 giây, khuôn
     `skin-tu.js`. Câu cảnh báo nói thẳng "mất vĩnh viễn": giao diện KHÔNG hứa hoàn tác.
     🔴 `ky_vong` lấy từ CHÍNH con đang vẽ trên thẻ. Máy chủ đọc lại ô trên đĩa và từ chối nếu
        loài/growth đã khác — danh sách này có thể cũ tới một phút (ô vừa được lấy ra, hoặc có
        con khác vừa cất vào đúng ô đó). Gửi thiếu nó là xoá mù.
     `da_xoa` có BA giá trị: true · false (lệnh đã nhận mà ô vẫn còn) · null (chưa đo được).
     Chỉ true mới được nói "đã xoá"; hai cái kia đọc nguyên câu máy chủ trả.               */
  function xoaO(d, bXoa, bLay, canh) {
    if (bXoa.getAttribute("data-cho") !== "1") {
      bXoa.setAttribute("data-cho", "1");
      bXoa.textContent = "Bấm lần nữa để xoá";
      canh.hidden = false;
      // Hẹn giờ gắn vào CHÍNH nút này và bị huỷ ở lần bấm thứ hai: không huỷ thì hẹn giờ của một
      // lượt cũ (bấm → lỗi → bấm lại) bắn giữa lượt mới và biến lần bấm thứ hai thành lần đầu.
      bXoa._hen = setTimeout(function () {
        bXoa.removeAttribute("data-cho");
        bXoa.textContent = "Xoá";
        canh.hidden = true;
      }, 5000);
      return;
    }
    clearTimeout(bXoa._hen);
    bXoa.removeAttribute("data-cho");
    bXoa.disabled = true; bLay.disabled = true;
    thongBao("Đang xoá ô " + d.slot + "…", false);
    api("/api/player/garage/delete", { method: "POST", body: JSON.stringify({
      slot: d.slot, ky_vong: { loai: d.species, growth: d.growth, stored_at: d.stored_at } }) })
      .then(function (j) {
        thongBao(j.cau || (j.da_xoa ? "Đã xoá ô " + d.slot + "." : "Chưa xác nhận được."),
                 j.da_xoa !== true);
        return taiLai();
      })
      .catch(function (e) {
        thongBao("Không xoá được: " + e.message, !laBan(e.message));
        // Vẽ lại từ máy chủ, không để nguyên thẻ cũ: lỗi thường gặp nhất là "ô đã đổi / đã trống",
        // và bấm lại trên một thẻ cũ chỉ ăn thêm một lượt trong hạn mức 5 lần / 5 phút.
        // `thongBao` giữ nguyên qua lần vẽ lại (nó nằm ngoài danh sách).
        return taiLai();
      });
  }

  /* ── Cứu hộ: ĐÃ GỠ 2026-09-10 ─────────────────────────────────────────────
     `veCuuHo()` + `goiCuu()` bị bỏ cùng endpoint `POST /api/player/rescue`.
     Chủ server chốt: mọi thao tác hoàn dino do ADMIN tự quyết thủ công.
     Người chơi mất dino nay đọc hướng dẫn ở /noi-quy rồi báo admin.
     ⚠️ Dựng lại nút ở đây là dựng một nút gọi vào 404.                       */

  function veThanhTrangThai(steamid) {
    var boc = $("gara-thanhtrangthai");
    if (!boc) return;
    boc.textContent = "";
    // Chỉ hiện 4 số cuối: đủ để người dùng nhận ra mình, không đủ để người khác dùng lại.
    boc.appendChild(el("span", "pill", "Steam …" + String(steamid).slice(-4)));

    /* Nút tải lại THỦ CÔNG, cố ý thay cho việc tự hỏi lại liên tục: mỗi lượt
       `/live` là một lần đọc dữ liệu sống trên game thread đơn luồng. */
    var bTai = el("button", "act", "Tải lại");
    bTai.addEventListener("click", function () {
      bTai.disabled = true;
      taiLai().then(function () { bTai.disabled = false; });
    });
    boc.appendChild(bTai);

    var nut = el("button", "act", "Đăng xuất");
    nut.addEventListener("click", function () {
      api("/api/player/logout", { method: "POST" }).then(function () { location.reload(); });
    });
    boc.appendChild(nut);
  }

  function baoLoi(chu) {
    var e = $("gara-loi");
    if (!e) return;
    e.hidden = !chu;
    if (chu) e.textContent = chu;
  }

  /* ── Vẽ tất cả từ hai nguồn ───────────────────────────────────────────────
     `live` hoặc `gara` có thể là `null` khi lượt gọi đó hỏng. Một nguồn chết
     KHÔNG được xoá phần của nguồn kia — mất mạng một nhịp mà cả trang trắng ra
     thì người chơi tưởng mất dino. */
  function veTatCa(live, gara, giuThongBao) {
    if (!giuThongBao) baoLoi("");
    if (live) {
      // Màu đến từ plugin và chỉ đọc được khi đang cưỡi một con sống.
      var loai = live.song && live.song.species;
      var choMau = loai
        ? api("/api/player/skin").catch(function () { return null; })
        : Promise.resolve(null);
      return choMau.then(function (skin) {
        veDangCuoi(live, skin);
        if (gara) { veDanhSach(gara.slots || [], gara.quota); veThaoTac(gara.slots || [], gara.quota); }
      });
    }
    if (gara) { veDanhSach(gara.slots || [], gara.quota); veThaoTac(gara.slots || [], gara.quota); }
    if (!live && !gara) baoLoi("Chưa lấy được dữ liệu của bạn lúc này. Bấm Tải lại.");
    return Promise.resolve();
  }

  function taiLai() {
    return Promise.all([
      api("/api/player/live").catch(function () { return null; }),
      api("/api/player/garage").catch(function () { return null; })
    ]).then(function (r) { return veTatCa(r[0], r[1]); });
  }

  /* ── Con dino VÍ DỤ cho người chưa đăng nhập (2026-09-14) ──────────────────
     Bản trước người lạ chỉ thấy một nút đăng nhập, không biết gara trông ra sao. Màu ở
     đây là màu MINH HOẠ đặt tay, không phải của người chơi nào — trang ghi rõ "ví dụ".
     three.js chỉ tải khi khối này thật sự hiện ra. */
  var MAU_VI_DU = { body: "#6b5a3e", flank: "#8a7550", underbelly: "#c9b48a",
                    markings: "#3d3226", maleDisplay: "#a8432f", detail1: "#d8c7a0",
                    eyes: "#e0b040" };
  var daMoViDu = false;
  function moViDu() {
    var k = $("gara-mau-3d");
    if (daMoViDu || !k) return;
    daMoViDu = true;
    // Chỉ tải three.js + .glb (~1 MB) khi khung ví dụ THẬT SỰ vào tầm nhìn: người vào từ
    // link Facebook trên điện thoại không phải trả chỗ dữ liệu đó nếu không cuộn tới.
    ganKhiThay(k, function () {
      napBoXem().then(function (bo) {
        if (!bo || !k.isConnected) return;
        bo.tao(k).ve({ species: "Triceratops", colors: MAU_VI_DU, growth: 1 });
      }).catch(function () {
        var m = k.querySelector(".v3d__msg");
        if (m) m.textContent = "Chưa xem được mô hình 3D lúc này.";
      });
    });
  }

  function batDau() {
    api("/api/player/me").then(function (j) {
      if (!j.logged_in) { hienKhoi("gara-chuadangnhap"); moViDu(); return; }
      hienKhoi("gara-noidung");
      veThanhTrangThai(j.steamid);
      // Lỗi khi tải gara của người ĐÃ đăng nhập là lỗi của gara, không phải "chưa đăng
      // nhập". Bản trước để nó rơi xuống `.catch` bên dưới: người đã đăng nhập thấy nút
      // đăng nhập kèm một con dino ví dụ (review PR #7).
      return taiLai().catch(function () {
        baoLoi("Chưa lấy được dữ liệu của bạn lúc này. Bấm Tải lại.");
      });
    }).catch(function () {
      // `/api/player/me` hỏng: chưa biết người này là ai. Vẫn cho thấy nút đăng nhập để
      // trang không treo ở trạng thái rỗng — nhưng KHÔNG mở dino ví dụ: có thể họ đã đăng
      // nhập, và dịch vụ đang chết thì tải thêm ~1 MB 3D chỉ làm trang lỗi nặng thêm.
      hienKhoi("gara-chuadangnhap");
      var m = $("gara-mau-3d") && $("gara-mau-3d").querySelector(".v3d__msg");
      if (m) m.textContent = "Chưa xem được mô hình ví dụ lúc này.";
    });
  }

  /* ── Đổi ngoại trang: ĐÃ CHUYỂN SANG TRANG RIÊNG `/skin` (2026-08-30) ──────
     `TEN_MAU` ở đầu file VẪN CÒN DÙNG — nó vẽ hàng ô màu trên mỗi thẻ dino và
     trên khối "đang cưỡi", đừng xoá nhầm.                                     */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", batDau);
  } else {
    batDau();
  }
})();
