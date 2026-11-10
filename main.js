// Автозаполнение ваучера из фото паспортов и скриншотов рейсов/отеля.
(function () {
  const LS_URL = "leaf_ocr_url";
  const LS_CODE = "leaf_ocr_code";
  const DEFAULT_URL = ""; // после деплоя можно вписать сюда адрес воркера
  const MAX_SIDE = 2000;

  let files = []; // { name, media_type, data, preview }

  const $ = (sel, root = document) => root.querySelector(sel);
  const field = (name) => $(`[data-field="${name}"]`);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

  // ---------- UI ----------
  const style = document.createElement("style");
  style.textContent = `
    .btn-ai { background: var(--gold); }
    .btn-ai:hover { background: #a88f52; }
    .af-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; z-index: 1000; font-family: Inter, "Segoe UI", Arial, sans-serif; }
    .af-overlay.open { display: flex; }
    .af-modal { background: #fff; width: min(640px, 94vw); max-height: 92vh; overflow: auto; border-radius: 18px; padding: 24px 26px; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
    .af-modal h3 { margin: 0 0 4px; color: var(--green); }
    .af-hint { color: #666; font-size: 13px; margin: 0 0 14px; }
    .af-drop { border: 2px dashed var(--gold); border-radius: 14px; padding: 26px 16px; text-align: center; color: #555; cursor: pointer; background: #fffdf6; transition: background .2s; }
    .af-drop.drag { background: #fff3cc; }
    .af-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; margin-top: 14px; }
    .af-thumb { position: relative; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; height: 92px; background: #f4f4f4; display: flex; align-items: center; justify-content: center; font-size: 12px; text-align: center; }
    .af-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .af-thumb button { position: absolute; top: 4px; right: 4px; border: none; background: rgba(0,0,0,.6); color: #fff; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; line-height: 22px; padding: 0; }
    .af-note { width: 100%; box-sizing: border-box; margin-top: 14px; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: vertical; }
    .af-row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; align-items: center; }
    .af-status { flex: 1; font-size: 13px; color: #444; min-width: 160px; }
    .af-status.err { color: #b72d2d; }
    .af-settings { margin-top: 14px; font-size: 13px; }
    .af-settings summary { cursor: pointer; color: var(--green); }
    .af-settings label { display: block; margin-top: 8px; }
    .af-settings input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; margin-top: 3px; font: inherit; }
    .af-mode { font-size: 13px; margin-top: 10px; color: #333; }
    .af-filled { animation: afFlash 2s ease; }
    @keyframes afFlash { 0%, 40% { background: #d8f3e3; } 100% { background: transparent; } }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "af-overlay";
  overlay.innerHTML = `
    <div class="af-modal" role="dialog" aria-label="Заполнить из фото">
      <h3>📷 Заполнить из фото</h3>
      <p class="af-hint">Перетащите сюда фото паспортов, скриншоты рейсов и отеля (или вставьте Ctrl/⌘+V). Можно PDF.</p>
      <div class="af-drop" id="afDrop">Нажмите, чтобы выбрать файлы, или перетащите их сюда
        <input type="file" id="afInput" accept="image/*,application/pdf" multiple hidden>
      </div>
      <div class="af-thumbs" id="afThumbs"></div>
      <textarea class="af-note" id="afNote" rows="2" placeholder="Комментарий (необязательно): например «трансфер индивидуальный» или «второй рейс — обратно»"></textarea>
      <div class="af-mode">
        <label><input type="checkbox" id="afReplace"> Заменить уже добавленных туристов (иначе — добавить к списку)</label>
      </div>
      <details class="af-settings" id="afSettings">
        <summary>⚙️ Настройки подключения</summary>
        <label>Адрес сервера (Cloudflare Worker)
          <input id="afUrl" placeholder="https://leaf-voucher-ocr.ИМЯ.workers.dev">
        </label>
        <label>Код доступа
          <input id="afCode" type="password" autocomplete="off">
        </label>
      </details>
      <div class="af-row">
        <div class="af-status" id="afStatus"></div>
        <button class="btn btn-danger" id="afClose" type="button">Закрыть</button>
        <button class="btn" id="afGo" type="button">✨ Распознать и заполнить</button>
      </div>
    </div>`;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => document.body.appendChild(overlay));
  else document.body.appendChild(overlay);

  const el = (id) => overlay.querySelector("#" + id);

  function setStatus(text, isErr) {
    const s = el("afStatus");
    s.textContent = text;
    s.classList.toggle("err", !!isErr);
  }

  function renderThumbs() {
    el("afThumbs").innerHTML = files
      .map((f, i) => `<div class="af-thumb">${f.preview ? `<img src="${f.preview}" alt="">` : `📄<br>${esc(f.name)}`}<button type="button" data-i="${i}" title="Убрать">×</button></div>`)
      .join("");
  }

  window.openAutofill = function () {
    el("afUrl").value = localStorage.getItem(LS_URL) || DEFAULT_URL;
    el("afCode").value = localStorage.getItem(LS_CODE) || "";
    if (!el("afUrl").value || !el("afCode").value) el("afSettings").open = true;
    setStatus("");
    overlay.classList.add("open");
  };
  function close() { overlay.classList.remove("open"); }

  // ---------- файлы ----------
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    const url = await readAsDataURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", 0.88);
    return { media_type: "image/jpeg", data: out.split(",")[1], preview: out };
  }

  async function addFiles(list) {
    for (const file of list) {
      try {
        if (file.type === "application/pdf") {
          const url = await readAsDataURL(file);
          files.push({ name: file.name, media_type: "application/pdf", data: url.split(",")[1], preview: null });
        } else if (file.type.startsWith("image/")) {
          const img = await compressImage(file);
          files.push({ name: file.name || "screenshot", ...img });
        }
      } catch (e) {
        setStatus("Не удалось прочитать файл " + (file.name || ""), true);
      }
    }
    renderThumbs();
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
    const rm = e.target.closest(".af-thumb button");
    if (rm) { files.splice(+rm.dataset.i, 1); renderThumbs(); }
  });
  document.addEventListener("click", (e) => {
    if (!overlay.contains(e.target)) return;
    if (e.target.id === "afClose") close();
    if (e.target.id === "afGo") run();
    if (e.target.closest("#afDrop") && e.target.id !== "afInput") el("afInput").click();
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "afInput") { addFiles([...e.target.files]); e.target.value = ""; }
  });
  ["dragover", "dragenter"].forEach((t) => overlay.addEventListener(t, (e) => { e.preventDefault(); el("afDrop").classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => overlay.addEventListener(t, (e) => { e.preventDefault(); el("afDrop").classList.remove("drag"); }));
  overlay.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
  document.addEventListener("paste", (e) => {
    if (!overlay.classList.contains("open")) return;
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });

  // ---------- запрос ----------
  async function run() {
    const url = el("afUrl").value.trim();
    const code = el("afCode").value.trim();
    if (!url || !code) { el("afSettings").open = true; return setStatus("Укажите адрес сервера и код доступа", true); }
    if (!files.length) return setStatus("Добавьте хотя бы один файл", true);
    localStorage.setItem(LS_URL, url);
    localStorage.setItem(LS_CODE, code);

    const go = el("afGo");
    go.disabled = true;
    setStatus("⏳ Распознаю… обычно 10–40 секунд");
    try {
      const res = await fetch(url.replace(/\/$/, "") + "/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Access-Code": code },
        body: JSON.stringify({
          images: files.map(({ name, media_type, data }) => ({ name, media_type, data })),
          note: el("afNote").value.trim(),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Ошибка сервера " + res.status);
      const summary = applyData(out.data, el("afReplace").checked);
      files = [];
      renderThumbs();
      el("afNote").value = "";
      setStatus("✅ Готово: " + summary + ". Проверьте данные перед скачиванием PDF.");
      setTimeout(close, 1800);
    } catch (e) {
      setStatus("❌ " + (e.message || e), true);
    } finally {
      go.disabled = false;
    }
  }

  // ---------- заполнение ----------
  function set(name, value, asHtml) {
    if (value == null || value === "") return false;
    const node = field(name);
    if (!node) return false;
    if (asHtml) node.innerHTML = value; else node.textContent = value;
    node.classList.remove("af-filled");
    void node.offsetWidth;
    node.classList.add("af-filled");
    return true;
  }

  const range = (a, b) => (a && b ? `${a} / ${b}` : a || b || null);
  const point = (code, time) => [code, time].filter(Boolean).join(" ") || null;

  function touristRow(t) {
    const tr = document.createElement("tr");
    tr.dataset.first = t.first_name || "";
    tr.dataset.last = t.last_name || "";
    tr.dataset.cat = t.category || "ADULT";
    tr.dataset.doc = (t.document_number || "").toUpperCase();
    const name = [t.title, t.first_name, t.last_name].filter(Boolean).join(" ").toUpperCase();
    tr.innerHTML = [
      "/E/E",
      name,
      t.gender || "",
      t.birth_date || "",
      (t.citizenship || "").toUpperCase(),
      (t.document_number || "").toUpperCase(),
    ].map((v) => `<td class="editable af-filled" contenteditable="true">${esc(v)}</td>`).join("");
    return tr;
  }

  function applyData(d, replace) {
    if (!d) throw new Error("Пустой ответ");
    const done = [];
    const tbody = $("#touristTable tbody");

    // Туристы
    const tourists = Array.isArray(d.tourists) ? d.tourists : [];
    if (tourists.length) {
      if (replace) tbody.innerHTML = "";
      const existing = new Set([...tbody.rows].map((r) => r.dataset.doc).filter(Boolean));
      let added = 0;
      tourists.forEach((t) => {
        const doc = (t.document_number || "").toUpperCase();
        if (doc && existing.has(doc)) return;
        existing.add(doc);
        tbody.appendChild(touristRow(t));
        added++;
      });
      done.push(`туристов: ${added}`);
    }

    // Имена и количество по всем туристам в таблице
    const rows = [...tbody.rows];
    const named = rows.filter((r) => r.dataset.first || r.dataset.last);
    if (named.length) set("names", named.map((r) => `${esc(cap(r.dataset.first))} / ${esc(cap(r.dataset.last))}`).join("<br>"), true);
    if (rows.length) {
      const cnt = { ADULT: 0, CHILD: 0, INFANT: 0 };
      rows.forEach((r) => { cnt[r.dataset.cat || "ADULT"]++; });
      set("pax", `👤${cnt.ADULT} 👩‍👦${cnt.CHILD} 👶${cnt.INFANT}`);
    }

    // Рейсы
    const out = d.flights?.outbound;
    const ret = d.flights?.return;
    if (out) {
      set("out_date", out.date);
      set("out_flight", out.flight_number);
      set("out_dep", point(out.dep_airport, out.dep_time));
      set("out_arr", point(out.arr_airport, out.arr_time));
      done.push("рейс туда");
    }
    if (ret) {
      set("ret_date", ret.date);
      set("ret_flight", ret.flight_number);
      set("ret_dep", point(ret.dep_airport, ret.dep_time));
      set("ret_arr", point(ret.arr_airport, ret.arr_time));
      done.push("рейс обратно");
    }

    // Отель
    const h = d.hotel;
    if (h && (h.name || h.room || h.meal)) {
      set("hotel", [h.name, h.meal, h.room].filter(Boolean).map(esc).join("<br>"), true);
      done.push("отель");
    }

    // Даты: из отеля, иначе из рейсов
    const dates = range(h?.check_in || out?.date, h?.check_out || ret?.date);
    set("stay", dates);
    set("dates_top", dates);

    set("operator", d.operator);

    return done.length ? done.join(", ") : "новых данных не найдено";
  }

  // для отладки / ручной вставки JSON
  window.__applyVoucherData = applyData;
})();
