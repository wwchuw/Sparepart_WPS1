(() => {
  "use strict";
  const CFG = window.APP_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("sp-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("sp-" + k, JSON.stringify(v)); } catch { /* เต็มก็ข้าม */ } },
    del(k) { try { localStorage.removeItem("sp-" + k); } catch { /* */ } }
  };

  const fiscalYear = (d = new Date()) => (d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear()) + 543;
  const FY = fiscalYear();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDate = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
    if (!m) return ymd || "";
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  };
  const fmtStamp = (iso) => { const d = new Date(iso); return !iso || isNaN(d) ? "" : d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }); };
  const thumb = (id, w) => id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}` : "";
  const statusLabel = (s) => CFG.statusLabel[s] || s;
  const fmtQty = (n) => Number(n).toLocaleString("th-TH");

  const state = {
    session: store.get("session", null),
    data: store.get("data", null),
    view: store.get("view", "parts"),
    q: "", partFilter: "all", docFilter: "all", loc: null
  };
  const D = () => state.data || { parts: [], locs: [], docs: [], items: [] };
  const findPart = (id) => D().parts.find((p) => p.id === String(id).trim());
  const findDoc = (id) => D().docs.find((d) => d.id === id);
  const docItems = (id) => D().items.filter((x) => x.doc === id);

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(text, err) {
    const t = $("#toast"); t.textContent = text; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), err ? 4500 : 2600);
  }

  /* ---------- API ---------- */
  class ApiError extends Error {}
  async function api(action, payload = {}, key = state.session?.key) {
    if (!CFG.apiUrl || CFG.apiUrl.includes("PASTE_")) throw new Error("ยังไม่ได้ใส่ apiUrl ใน config.js");
    let r;
    try {
      r = await fetch(CFG.apiUrl, {
        method: "POST", redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // ไม่ให้เกิด preflight ที่ Apps Script ไม่รองรับ
        body: JSON.stringify({ action, key, by: state.session?.name || "", ...payload })
      });
    } catch { throw new Error("เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"); }
    if (!r.ok) throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดปกติ (รหัส ${r.status})`);
    let j;
    try { j = await r.json(); } catch { throw new Error("อ่านคำตอบจากเซิร์ฟเวอร์ไม่ได้ ตรวจสอบ apiUrl และการ Deploy"); }
    if (!j.ok) throw new ApiError(j.error || "เกิดข้อผิดพลาด");
    return j;
  }
  // ปุ่มที่กดแล้วเรียก API: ปิดปุ่มระหว่างรอ แสดงข้อผิดพลาดเป็น toast
  async function busy(btn, label, fn) {
    const old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try { return await fn(); }
    catch (e) { toast(e.message, true); if (/รหัสทีม/.test(e.message)) logout(); return null; }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  }

  /* ---------- ข้อมูล ---------- */
  function saveData() { store.set("data", state.data); }
  function upsertPart(p) {
    const ps = D().parts, i = ps.findIndex((x) => x.id === p.id);
    if (i >= 0) ps[i] = p; else ps.push(p);
  }
  async function refresh(silent) {
    $("#sync").textContent = "กำลังโหลด…";
    try {
      const j = await api("load");
      state.data = { parts: j.parts, locs: j.locs, docs: j.docs, items: j.items, sheetUrl: j.sheetUrl, at: new Date().toISOString() };
      saveData();
      showApp();
      render();
      if (!silent) toast("โหลดข้อมูลแล้ว");
    } catch (e) {
      if (e instanceof ApiError && /รหัสทีม|TEAM_KEY/.test(e.message)) { logout(e.message); return; }
      if (!state.data) { showMessage("โหลดข้อมูลไม่ได้", e.message, "ลองอีกครั้ง", () => refresh()); return; }
      toast(e.message, true);
    }
    syncLabel();
  }
  function syncLabel() {
    const at = state.data?.at;
    $("#sync").textContent = at ? "อัปเดต " + new Date(at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
  }

  /* ---------- หน้าจอหลัก ---------- */
  function showMessage(title, text, btnLabel, onClick) {
    $$(".view").forEach((v) => (v.hidden = true));
    $("#tabs").hidden = true; $("#menuBtn").hidden = true;
    $("#v-msg").hidden = false; $("#login").hidden = true;
    $("#msgTitle").textContent = title; $("#msgText").textContent = text || "";
    const b = $("#msgBtn"); b.hidden = !btnLabel; b.textContent = btnLabel || ""; b.onclick = onClick || null;
  }
  function showLogin(err) {
    showMessage("เข้าใช้งาน", err || "ใส่รหัสทีมที่ได้รับจากผู้ดูแล และชื่อของคุณ");
    $("#login").hidden = false;
    if (!$("#loginName").value) $("#loginName").value = store.get("lastName", "");
  }
  function showApp() {
    $("#v-msg").hidden = true; $("#tabs").hidden = false; $("#menuBtn").hidden = false;
    $("#who").textContent = "ผู้ใช้: " + (state.session?.name || "");
    if (state.data?.sheetUrl) $("#sheetLink").href = state.data.sheetUrl;
    setView(state.view);
    document.documentElement.style.setProperty("--top-h", $(".top").offsetHeight + "px");
  }
  function setView(v) {
    state.view = v; store.set("view", v);
    $$(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
    $$("#tabs [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    window.scrollTo(0, 0);
  }
  function logout(msg) {
    state.session = null; store.del("session"); store.del("data"); state.data = null;
    closeAllPanels();
    showLogin(msg);
  }

  /* ---------- ชิ้นส่วน UI ---------- */
  const bin = (loc, big) => loc
    ? `<span class="bin${big ? " big" : ""}"><span>${esc(loc)}</span></span>`
    : `<span class="bin none${big ? " big" : ""}"><span>ไม่ระบุตำแหน่ง</span></span>`;
  const thumbImg = (id, cls = "thumb") => id
    ? `<img class="${cls}" src="${thumb(id, 160)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="${cls} empty">ไม่มีรูป</span>`;
  const partRow = (p) => `
    <li><button class="row" data-part="${esc(p.id)}">
      ${thumbImg(p.imageId)}
      <span class="row-main">
        <span class="row-name">${esc(p.name || "(ไม่มีชื่อ)")}</span>
        <span class="row-sub"><span class="num">${esc(p.id)}</span>${bin(p.loc)}</span>
      </span>
      <span class="qty${p.qty <= 0 ? " zero" : ""}"><b>${p.qty <= 0 ? "หมด" : fmtQty(p.qty)}</b><small>${esc(p.unit)}</small></span>
    </button></li>`;
  const bindRows = (root) => {
    $$("[data-part]", root).forEach((b) => (b.onclick = () => showPart(b.dataset.part)));
    $$("[data-doc]", root).forEach((b) => (b.onclick = () => showDoc(b.dataset.doc)));
    $$("[data-loc]", root).forEach((b) => (b.onclick = () => showLoc(b.dataset.loc)));
  };

  /* ---------- อะไหล่ ---------- */
  function matchPart(p, q) {
    if (!q) return true;
    const hay = [p.id, p.name, p.loc, p.remark, p.desc, p.contact].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }
  function renderParts() {
    const f = state.partFilter;
    let list = D().parts.filter((p) => matchPart(p, state.q));
    if (f === "out") list = list.filter((p) => p.qty <= 0);
    if (f === "unchecked") list = list.filter((p) => p.checkFY !== FY);
    if (state.loc != null) list = list.filter((p) => (p.loc || "") === state.loc);
    list.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    $("#partCount").textContent = `${list.length} จาก ${D().parts.length} รายการ`;
    $("#partList").innerHTML = list.length ? list.map(partRow).join("")
      : `<li class="empty-state">ไม่พบอะไหล่ที่ตรงกับเงื่อนไข ลองล้างคำค้นหรือเลือก "ทั้งหมด"</li>`;
    bindRows($("#partList"));
    const lf = $("#locFilter");
    lf.hidden = state.loc == null;
    if (state.loc != null) {
      lf.innerHTML = `เฉพาะตำแหน่ง ${bin(state.loc)} <button>ดูทุกตำแหน่ง</button>`;
      $("button", lf).onclick = () => { state.loc = null; renderParts(); };
    }
  }

  function showPart(id) {
    if (!findPart(id)) { toast("ไม่พบอะไหล่รหัส " + id, true); return; }
    openPanel({
      title: id,
      refresh: true,
      render: () => {
        const p = findPart(id);
        if (!p) return `<p class="empty-state">อะไหล่นี้ไม่อยู่ในข้อมูลแล้ว</p>`;
        const hist = D().items.filter((x) => x.part === p.id)
          .map((x) => ({ x, d: findDoc(x.doc) || { id: x.doc, date: "", status: "" } }))
          .sort((a, b) => (b.d.date || "").localeCompare(a.d.date || ""));
        const field = (k, v) => v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : "";
        return `
          <div class="hero">
            ${p.imageId ? `<img src="${thumb(p.imageId, 1000)}" alt="รูป ${esc(p.name)}" referrerpolicy="no-referrer">` : `<div class="noimg">ยังไม่มีรูป</div>`}
            <button class="btn photo-btn" data-act="photo">${p.imageId ? "ถ่ายรูปใหม่" : "ถ่ายรูป"}</button>
          </div>
          <div class="title-block">
            <h3>${esc(p.name)}</h3>
            <span class="pid">${esc(p.id)}</span>
            <div class="stock">
              <span class="big-qty${p.qty <= 0 ? " zero" : ""}">${fmtQty(p.qty)}<small>${esc(p.unit)}</small></span>
              <button class="btn" data-loc="${esc(p.loc || "")}" style="border:0;padding:0;background:none">${bin(p.loc, true)}</button>
            </div>
          </div>
          <div class="actions">
            <button class="btn" data-act="edit">แก้ไข</button>
            <button class="btn" data-act="withdraw">เบิก</button>
            ${p.checkFY === FY
              ? `<span class="btn check-done" aria-disabled="true">ตรวจปีงบ ${FY} แล้ว</span>`
              : `<button class="btn primary" data-act="check">ตรวจแล้ว ปีงบ ${FY}</button>`}
          </div>
          <dl class="fields">
            ${field("คลัง", p.place)}${field("หน่วยงาน", p.org)}${field("Type", p.type)}
            ${field("สัญญา", p.contact)}${field("รายละเอียด", p.desc)}${field("หมายเหตุ", p.remark)}
            ${field("ตรวจล่าสุด", p.checkFY ? "ปีงบ " + p.checkFY : "ยังไม่เคยตรวจ")}
            ${field("แก้ไขล่าสุด", fmtStamp(p.updated))}
          </dl>
          <h4 class="sec-title">ประวัติการเบิก (${hist.length})</h4>
          ${hist.length ? `<ul class="list" style="padding:0">${hist.map(({ x, d }) => `
            <li><button class="row doc-row" data-doc="${esc(d.id)}">
              <span class="row-main"><span class="row-name">${esc(d.id)}</span>
                <span class="row-sub">${esc(fmtDate(d.date))}${x.remark ? " " + esc(x.remark) : ""}</span></span>
              <span class="qty"><b>${fmtQty(x.qty)}</b><small>${esc(x.unit)} <span class="badge ${esc(d.status)}">${esc(statusLabel(d.status))}</span></small></span>
            </button></li>`).join("")}</ul>` : `<p class="empty-state" style="padding:8px 16px;text-align:left">ยังไม่มีการเบิก</p>`}
          <h4 class="sec-title">QR code</h4>
          <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(p.id)}" alt="QR ของ ${esc(p.id)}"></div>`;
      },
      mount: (el) => {
        bindRows(el);
        const act = (a, fn) => { const b = $(`[data-act="${a}"]`, el); if (b) b.onclick = () => fn(b); };
        act("edit", () => partForm(id));
        act("withdraw", () => docForm(null, [{ part: id, qty: 1, remark: "" }]));
        act("photo", () => takePhoto(id));
        act("check", (b) => busy(b, "กำลังบันทึก…", async () => {
          const j = await api("part.check", { id, fy: FY });
          upsertPart(j.part); saveData(); render(); toast(`บันทึกว่าตรวจแล้ว ปีงบ ${FY}`);
        }));
      }
    });
  }

  function partForm(id) {
    const p = id ? findPart(id) : { id: "", name: "", unit: "EA", qty: 0, loc: state.loc || "", contact: "", desc: "", remark: "" };
    const locs = D().locs.map((l) => l.name);
    if (p.loc && !locs.includes(p.loc)) locs.unshift(p.loc);
    const opts = (arr) => [...new Set(arr.filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join("");
    const el = openPanel({
      title: id ? "แก้ไข " + id : "เพิ่มอะไหล่",
      headAct: { label: "บันทึก", fn: () => $("form", el).requestSubmit() },
      render: () => `
        <form class="form" novalidate>
          <label>รหัสอะไหล่<input name="id" value="${esc(p.id)}" ${id ? "readonly" : "required autofocus"} inputmode="text" autocomplete="off"></label>
          <label>ชื่ออะไหล่<input name="name" value="${esc(p.name)}" required></label>
          <div class="two">
            <label>จำนวน<input name="qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(p.qty)}" required></label>
            <label>หน่วย<input name="unit" list="dl-unit" value="${esc(p.unit)}"></label>
          </div>
          ${id ? `<label>เหตุผลที่แก้จำนวน<input name="note" placeholder="ถ้าแก้จำนวน เช่น ตรวจนับแล้วไม่ตรง"></label>` : ""}
          <label>ตำแหน่ง<select name="loc"><option value="">ไม่ระบุ</option>${locs.map((l) => `<option ${l === p.loc ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label>สัญญา<input name="contact" list="dl-contact" value="${esc(p.contact)}"></label>
          <label>รายละเอียด<textarea name="desc">${esc(p.desc)}</textarea></label>
          <label>หมายเหตุ<textarea name="remark">${esc(p.remark)}</textarea></label>
          <button class="btn primary" type="submit">บันทึก</button>
          <datalist id="dl-unit">${opts(["EA", "SET", ...D().parts.map((x) => x.unit)])}</datalist>
          <datalist id="dl-contact">${opts(D().parts.map((x) => x.contact))}</datalist>
        </form>`,
      mount: (el) => {
        const form = $("form", el);
        form.onsubmit = (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(form));
          f.id = f.id.trim(); f.name = f.name.trim();
          if (!f.id || !f.name) { toast("ใส่รหัสและชื่ออะไหล่ก่อนบันทึก", true); return; }
          if (!id && findPart(f.id)) { toast("มีรหัส " + f.id + " อยู่แล้ว", true); return; }
          if (f.qty === "" || Number(f.qty) < 0) { toast("จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป", true); return; }
          busy($('button[type="submit"]', form), "กำลังบันทึก…", async () => {
            const j = await api("part.save", { part: { ...f, qty: Number(f.qty) }, isNew: !id });
            upsertPart(j.part); saveData(); render();
            toast(id ? "บันทึกการแก้ไขแล้ว" : "เพิ่ม " + j.part.id + " แล้ว");
            back(() => { if (!id) showPart(j.part.id); });
          });
        };
      }
    });
  }

  function takePhoto(id) {
    const input = $("#photoInput");
    input.value = "";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      toast("กำลังอัปโหลดรูป…");
      try {
        const data = await resizeImage(file, 1280, 0.8);
        const j = await api("part.photo", { id, data });
        upsertPart(j.part); saveData(); render(); toast("บันทึกรูปแล้ว");
      } catch (e) { toast(e.message, true); }
    };
    input.click();
  }
  function resizeImage(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL("image/jpeg", q).split(",")[1]);
      };
      img.onerror = () => rej(new Error("เปิดไฟล์รูปไม่ได้"));
      img.src = URL.createObjectURL(file);
    });
  }

  /* ---------- ตำแหน่ง ---------- */
  function locGroups() {
    const groups = new Map();
    for (const l of D().locs) {
      const key = l.rack || "อื่น ๆ";
      if (!groups.has(key)) groups.set(key, { key, label: /^\d+$/.test(key) ? CFG.rackPrefix + key : key, locs: [], imageId: null });
      const g = groups.get(key);
      g.locs.push(l);
      if (!g.imageId && l.imageId) g.imageId = l.imageId;
    }
    const known = new Set(D().locs.map((l) => l.name));
    const extra = [...new Set(D().parts.map((p) => p.loc || ""))].filter((n) => !known.has(n));
    if (extra.length) groups.set("__other", { key: "__other", label: "ไม่อยู่ในชีท Location", locs: extra.map((n) => ({ name: n })), imageId: null });
    return [...groups.values()];
  }
  function renderLocs() {
    const count = {};
    D().parts.forEach((p) => { const k = p.loc || ""; count[k] = (count[k] || 0) + 1; });
    const gs = locGroups();
    $("#locGroups").innerHTML = gs.length ? gs.map((g) => {
      const total = g.locs.reduce((s, l) => s + (count[l.name] || 0), 0);
      const shared = g.locs.every((l) => !l.imageId || l.imageId === g.imageId);
      return `<section class="loc-group">
        <h2>${esc(g.label)} <small>${total} รายการ</small></h2>
        ${g.imageId && shared ? `<img class="loc-photo" src="${thumb(g.imageId, 900)}" alt="รูป ${esc(g.label)}" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div class="loc-grid">${g.locs.map((l) => `
          <button class="loc-tile${count[l.name] ? "" : " empty-loc"}" data-loc="${esc(l.name)}">
            ${bin(l.name)}<small>${count[l.name] || 0} รายการ</small>
          </button>`).join("")}</div>
      </section>`;
    }).join("") : `<p class="empty-state">ยังไม่มีข้อมูลตำแหน่งในชีท Location</p>`;
    bindRows($("#locGroups"));
  }
  function showLoc(name) {
    openPanel({
      title: name || "ไม่ระบุตำแหน่ง",
      refresh: true,
      render: () => {
        const l = D().locs.find((x) => x.name === name);
        const list = D().parts.filter((p) => (p.loc || "") === name).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
        return `
          ${l?.imageId ? `<div class="hero"><img src="${thumb(l.imageId, 1000)}" alt="รูปตำแหน่ง ${esc(name)}" referrerpolicy="no-referrer"></div>` : ""}
          <div class="title-block">${bin(name, true)}
            ${l ? `<p class="pid" style="margin:8px 0 0">${esc(l.id)}${l.rack ? "  ชั้นวาง/โซน " + esc(l.rack) : ""}${l.level ? "  ระดับ " + esc(l.level) : ""}</p>` : ""}
          </div>
          <h4 class="sec-title">อะไหล่ในตำแหน่งนี้ (${list.length})</h4>
          <ul class="list">${list.length ? list.map(partRow).join("") : `<li class="empty-state">ยังไม่มีอะไหล่ในตำแหน่งนี้</li>`}</ul>`;
      },
      mount: bindRows
    });
  }

  /* ---------- ใบเบิก ---------- */
  const sortDocs = (a, b) => (b.date || "").localeCompare(a.date || "") || b.id.localeCompare(a.id, "en", { numeric: true });
  function renderDocs() {
    let list = D().docs.slice().sort(sortDocs);
    if (state.docFilter !== "all") list = list.filter((d) => d.status === state.docFilter);
    $("#docList").innerHTML = list.length ? list.map((d) => {
      const its = docItems(d.id);
      return `<li><button class="row doc-row" data-doc="${esc(d.id)}">
        <span class="row-main">
          <span class="row-name">${esc(d.id)}</span>
          <span class="row-sub">${esc(fmtDate(d.date))}  ${its.length} รายการ${d.remark ? "  " + esc(d.remark) : ""}</span>
        </span>
        <span class="badge ${esc(d.status)}">${esc(statusLabel(d.status))}</span>
      </button></li>`;
    }).join("") : `<li class="empty-state">ยังไม่มีใบเบิก กด "สร้างใบเบิก" เพื่อเริ่ม</li>`;
    bindRows($("#docList"));
  }

  function nextDocId() {
    const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
    let max = 0;
    for (const d of D().docs) { const m = /(\d+)$/.exec(d.id); if (m && +m[1] > max) max = +m[1]; }
    return `${CFG.docPrefix}${yy}-${String(max + 1).padStart(6, "0")}`;
  }

  function showDoc(id) {
    if (!findDoc(id)) { toast("ไม่พบใบเบิก " + id, true); return; }
    openPanel({
      title: id,
      refresh: true,
      render: () => {
        const d = findDoc(id);
        if (!d) return `<p class="empty-state">ใบเบิกนี้ถูกลบแล้ว</p>`;
        const its = docItems(id), draft = d.status !== "Approved";
        return `
          <div class="title-block">
            <h3>${esc(d.id)}</h3>
            <div class="stock"><span>${esc(fmtDate(d.date))}</span><span class="badge ${esc(d.status)}">${esc(statusLabel(d.status))}</span></div>
          </div>
          ${d.remark || d.by ? `<dl class="fields">${d.by ? `<div><dt>ผู้บันทึก</dt><dd>${esc(d.by)}</dd></div>` : ""}${d.remark ? `<div><dt>หมายเหตุ</dt><dd>${esc(d.remark)}</dd></div>` : ""}</dl>` : ""}
          <h4 class="sec-title">รายการเบิก (${its.length})</h4>
          <ul class="items">${its.map((x) => {
            const p = findPart(x.part);
            const short = draft && p && p.qty < x.qty;
            return `<li class="item">
              <button class="row-main" data-part="${esc(x.part)}" style="background:none;border:0;padding:0;text-align:left">
                <span class="item-name">${esc(p?.name || x.name)}</span>
                <span class="item-sub"><span class="num">${esc(x.part)}</span>${bin(p?.loc)}${x.remark ? esc(x.remark) : ""}</span>
                ${draft && p ? `<span class="${short ? "warn" : "item-sub"}">คงคลัง ${fmtQty(p.qty)} ${esc(p.unit)}${short ? " ไม่พอเบิก" : ""}</span>` : ""}
              </button>
              <span class="qty"><b>${fmtQty(x.qty)}</b><small>${esc(x.unit)}</small></span>
            </li>`;
          }).join("") || `<li class="empty-state">ยังไม่มีรายการ</li>`}</ul>
          ${draft ? `<div class="actions">
            <button class="btn" data-act="edit">แก้ไข</button>
            <button class="btn primary" data-act="approve">อนุมัติและตัดคลัง</button>
            <button class="btn danger" data-act="delete">ลบใบเบิก</button>
          </div>` : ""}`;
      },
      mount: (el) => {
        bindRows(el);
        const act = (a, fn) => { const b = $(`[data-act="${a}"]`, el); if (b) b.onclick = () => fn(b); };
        act("edit", () => docForm(id));
        act("approve", (b) => {
          const its = docItems(id);
          if (!confirm(`อนุมัติ ${id} และหักจำนวนในคลัง ${its.length} รายการ?\nอนุมัติแล้วแก้ไขใบเบิกนี้ไม่ได้`)) return;
          busy(b, "กำลังอนุมัติ…", async () => {
            const j = await api("doc.approve", { id });
            const ds = D().docs; ds[ds.findIndex((x) => x.id === id)] = j.doc;
            j.parts.forEach(upsertPart); saveData(); render(); toast(`อนุมัติ ${id} แล้ว`);
          });
        });
        act("delete", (b) => {
          if (!confirm(`ลบใบเบิก ${id} และรายการทั้งหมดในใบนี้?`)) return;
          busy(b, "กำลังลบ…", async () => {
            await api("doc.delete", { id });
            state.data.docs = D().docs.filter((x) => x.id !== id);
            state.data.items = D().items.filter((x) => x.doc !== id);
            saveData(); render(); toast(`ลบ ${id} แล้ว`); back();
          });
        });
      }
    });
  }

  function docForm(id, preset) {
    const d = id ? findDoc(id) : { id: nextDocId(), date: today(), remark: "" };
    const items = (id ? docItems(id) : preset || []).map((x) => ({ part: x.part, qty: x.qty, remark: x.remark || "" }));
    const el = openPanel({
      title: id ? "แก้ไข " + id : "ใบเบิกใหม่",
      headAct: { label: "บันทึก", fn: () => $("form", el).requestSubmit() },
      render: () => `
        <form class="form" novalidate>
          <label>เลขที่ใบเบิก<input name="id" value="${esc(d.id)}" ${id ? "readonly" : "required"} autocomplete="off"></label>
          <label>วันที่เบิก<input name="date" type="date" value="${esc(d.date)}" required></label>
          <label>หมายเหตุ<input name="remark" value="${esc(d.remark)}"></label>
          <button class="btn primary" type="submit" hidden></button>
        </form>
        <h4 class="sec-title">รายการเบิก</h4>
        <ul class="items" id="formItems"></ul>
        <div class="actions">
          <button class="btn" data-act="pick">+ เลือกอะไหล่</button>
          <button class="btn" data-act="scan">สแกน QR</button>
        </div>
        <div class="actions"><button class="btn primary" data-act="save">บันทึกใบเบิก</button></div>
        <p class="form hint" style="padding-top:0">บันทึกแล้วสถานะเป็น "ร่าง" จำนวนในคลังยังไม่ลด จนกว่าจะกดอนุมัติ</p>`,
      mount: (el) => {
        const list = $("#formItems", el);
        const add = (pid) => {
          const p = findPart(pid);
          if (!p) { toast("ไม่พบอะไหล่รหัส " + pid, true); return; }
          const ex = items.find((x) => x.part === p.id);
          if (ex) { ex.qty += 1; toast(`${p.id} มีในใบนี้แล้ว เพิ่มจำนวนเป็น ${ex.qty}`); }
          else items.push({ part: p.id, qty: 1, remark: "" });
          draw();
        };
        const draw = () => {
          list.innerHTML = items.length ? items.map((x, i) => {
            const p = findPart(x.part) || { name: "(ไม่พบในข้อมูล)", unit: "", qty: 0 };
            return `<li class="item">
              <span class="row-main"><span class="item-name">${esc(p.name)}</span>
                <span class="item-sub"><span class="num">${esc(x.part)}</span>${bin(p.loc)}<span>คงคลัง ${fmtQty(p.qty)} ${esc(p.unit)}</span></span></span>
              <span></span>
              <span class="item-edit">
                <input type="number" min="0" step="any" inputmode="decimal" value="${esc(x.qty)}" data-i="${i}" data-k="qty" aria-label="จำนวนเบิก">
                <input value="${esc(x.remark)}" data-i="${i}" data-k="remark" placeholder="หมายเหตุ เช่น เลขที่ BK" aria-label="หมายเหตุรายการ">
                <button class="btn danger" data-del="${i}" aria-label="เอาออก">เอาออก</button>
              </span>
            </li>`;
          }).join("") : `<li class="empty-state">ยังไม่มีรายการ กด "เลือกอะไหล่" หรือ "สแกน QR"</li>`;
          $$("input[data-i]", list).forEach((inp) => (inp.oninput = () => {
            const x = items[inp.dataset.i];
            x[inp.dataset.k] = inp.dataset.k === "qty" ? Number(inp.value) : inp.value;
          }));
          $$("[data-del]", list).forEach((b) => (b.onclick = () => { items.splice(+b.dataset.del, 1); draw(); }));
        };
        draw();
        $('[data-act="pick"]', el).onclick = () => pickPart(add);
        $('[data-act="scan"]', el).onclick = () => openScanner(add);
        $('[data-act="save"]', el).onclick = () => $("form", el).requestSubmit();
        const form = $("form", el);
        form.onsubmit = (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(form));
          f.id = f.id.trim();
          if (!f.id || !f.date) { toast("ใส่เลขที่และวันที่ก่อนบันทึก", true); return; }
          if (!id && findDoc(f.id)) { toast("มีใบเบิกเลขที่ " + f.id + " อยู่แล้ว", true); return; }
          if (!items.length) { toast("เพิ่มอะไหล่อย่างน้อย 1 รายการ", true); return; }
          const bad = items.find((x) => !(x.qty > 0));
          if (bad) { toast("จำนวนเบิกของ " + bad.part + " ต้องมากกว่า 0", true); return; }
          busy($('[data-act="save"]', el), "กำลังบันทึก…", async () => {
            const j = await api("doc.save", { doc: f, items, isNew: !id });
            const ds = D().docs, i = ds.findIndex((x) => x.id === j.doc.id);
            if (i >= 0) ds[i] = j.doc; else ds.push(j.doc);
            state.data.items = D().items.filter((x) => x.doc !== j.doc.id).concat(j.items);
            saveData(); render(); toast("บันทึก " + j.doc.id + " แล้ว");
            back(() => { if (!id) showDoc(j.doc.id); });
          });
        };
      }
    });
  }

  function pickPart(onPick) {
    let q = "";
    openPanel({
      title: "เลือกอะไหล่",
      render: () => `
        <div class="toolbar" style="top:0;position:relative"><input type="search" placeholder="ค้นหารหัส ชื่อ ตำแหน่ง" aria-label="ค้นหาอะไหล่" autofocus></div>
        <ul class="list"></ul>`,
      mount: (el) => {
        const ul = $(".list", el), inp = $("input", el);
        const draw = () => {
          const list = D().parts.filter((p) => matchPart(p, q)).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })).slice(0, 80);
          ul.innerHTML = list.map(partRow).join("") || `<li class="empty-state">ไม่พบอะไหล่</li>`;
          $$("[data-part]", ul).forEach((b) => (b.onclick = () => { const id = b.dataset.part; back(() => onPick(id)); }));
        };
        inp.oninput = () => { q = inp.value.trim(); draw(); };
        draw();
      }
    });
  }

  /* ---------- หน้าซ้อน + ปุ่มย้อนกลับ ---------- */
  const panels = [];
  const afterPop = [];
  function openPanel({ title, render: r, mount, headAct, refresh: canRefresh }) {
    const el = document.createElement("div");
    el.className = "panel";
    el.innerHTML = `<div class="panel-head">
        <button class="back" aria-label="กลับ"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <h2>${esc(title)}</h2>${headAct ? `<button class="head-act">${esc(headAct.label)}</button>` : ""}
      </div><div class="panel-body"></div>`;
    const body = $(".panel-body", el);
    el.refresh = () => { body.innerHTML = r(); mount && mount(el); };
    el.canRefresh = !!canRefresh;
    el.refresh();
    $(".back", el).onclick = () => back();
    if (headAct) $(".head-act", el).onclick = headAct.fn;
    $("#panels").append(el);
    panels.push(el);
    document.body.style.overflow = "hidden";
    history.pushState({ depth: panels.length }, "");
    return el;
  }
  function back(then) { if (then) afterPop.push(then); history.back(); }
  window.addEventListener("popstate", () => {
    if (scanning) closeScanner();
    else if (panels.length) panels.pop().remove();
    if (!panels.length) document.body.style.overflow = "";
    const fn = afterPop.shift();
    if (fn) setTimeout(fn, 0);
  });
  function closeAllPanels() { while (panels.length) panels.pop().remove(); document.body.style.overflow = ""; }

  /* ---------- สแกน QR ---------- */
  let scanning = false, stream = null, raf = 0, onScan = null, detector = null;
  function partFromCode(raw) {
    const s = String(raw || "").trim();
    if (findPart(s)) return s;
    // QR เก่าบางอันอาจเป็น URL หรือมีข้อความต่อท้าย ลองตัดเอาส่วนท้าย
    const tail = s.split(/[\/=?&#\s]/).filter(Boolean).pop();
    return tail && findPart(tail) ? tail : null;
  }
  async function openScanner(cb) {
    onScan = cb || ((id) => showPart(id));
    scanning = true;
    $("#scanner").hidden = false;
    $("#scanInput").value = "";
    $("#scanHint").textContent = "เล็ง QR บนอะไหล่ให้อยู่ในกรอบ";
    history.pushState({ scan: 1 }, "");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (!scanning) { stopStream(); return; }
      const v = $("#video"); v.srcObject = stream; await v.play();
      if ("BarcodeDetector" in window) {
        try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { detector = null; }
      }
      tick();
    } catch {
      $("#scanHint").textContent = "เปิดกล้องไม่ได้ อนุญาตการใช้กล้องในเบราว์เซอร์ หรือพิมพ์รหัสด้านล่าง";
    }
  }
  const canvas = document.createElement("canvas");
  async function tick() {
    if (!scanning) return;
    const v = $("#video");
    let code = null;
    if (v.readyState >= 2) {
      try {
        if (detector) {
          const r = await detector.detect(v);
          code = r[0]?.rawValue || null;
        } else if (window.jsQR) {
          const w = 480, h = Math.round(v.videoHeight * (w / v.videoWidth)) || 360;
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, w, h);
          code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data || null;
        }
      } catch { /* เฟรมเสีย ข้ามไป */ }
    }
    if (code) {
      const id = partFromCode(code);
      if (id) { if (navigator.vibrate) navigator.vibrate(60); finishScan(id); return; }
      $("#scanHint").textContent = "QR นี้ไม่ตรงกับรหัสอะไหล่ในระบบ: " + code.slice(0, 40);
    }
    raf = setTimeout(tick, detector ? 120 : 180);
  }
  function finishScan(id) { const cb = onScan; back(() => cb(id)); }
  function stopStream() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
  function closeScanner() {
    scanning = false; clearTimeout(raf); stopStream();
    $("#video").srcObject = null; $("#scanner").hidden = true;
  }
  $("#scanClose").onclick = () => back();
  $("#scanManual").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#scanInput").value.trim();
    const id = partFromCode(v);
    if (id) finishScan(id); else toast("ไม่พบอะไหล่รหัส " + v, true);
  };

  /* ---------- render ทั้งหมด ---------- */
  function render() {
    if (!state.data) return;
    renderParts(); renderLocs(); renderDocs();
    panels.forEach((p) => p.canRefresh && p.refresh());
  }

  /* ---------- เหตุการณ์ ---------- */
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const key = $("#loginKey").value.trim(), name = $("#loginName").value.trim();
    if (!key || !name) return;
    const b = $('#login button[type="submit"]');
    b.disabled = true; b.textContent = "กำลังตรวจสอบ…";
    try {
      await api("ping", {}, key);
      state.session = { key, name }; store.set("session", state.session); store.set("lastName", name);
      $("#loginKey").value = "";
      showMessage("กำลังโหลดข้อมูล", "ครั้งแรกอาจใช้เวลาสักครู่");
      await refresh(true);
    } catch (err) {
      showLogin(err.message);
    } finally { b.disabled = false; b.textContent = "เข้าใช้งาน"; }
  };
  $$("#tabs [data-v]").forEach((b) => (b.onclick = () => setView(b.dataset.v)));
  $("#scanBtn").onclick = () => openScanner();
  let qTimer;
  $("#q").oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderParts(); }, 120); };
  $$("#partFilters button").forEach((b) => (b.onclick = () => {
    state.partFilter = b.dataset.f;
    $$("#partFilters button").forEach((x) => x.classList.toggle("on", x === b));
    renderParts();
  }));
  $$("#docFilters button").forEach((b) => (b.onclick = () => {
    state.docFilter = b.dataset.f;
    $$("#docFilters button").forEach((x) => x.classList.toggle("on", x === b));
    renderDocs();
  }));
  $("#addPart").onclick = () => partForm(null);
  $("#addDoc").onclick = () => docForm(null);
  $("#menuBtn").onclick = (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
  document.addEventListener("click", (e) => { if (!$("#menu").contains(e.target)) $("#menu").hidden = true; });
  $('#menu [data-act="reload"]').onclick = () => { $("#menu").hidden = true; refresh(); };
  $('#menu [data-act="logout"]').onclick = () => { $("#menu").hidden = true; if (confirm("ออกจากระบบ?")) logout(); };

  /* ---------- เริ่ม ---------- */
  document.title = CFG.appName; $("#appName").textContent = CFG.appName;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!state.session) showLogin();
  else if (state.data) { showApp(); render(); syncLabel(); refresh(true); }
  else { showMessage("กำลังโหลดข้อมูล", ""); refresh(true); }
})();
