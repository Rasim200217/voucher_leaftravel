// Авиабилеты (маршрутные квитанции): по одному на каждого туриста из ваучера.
// Строятся автоматически из данных ваучера и обновляются при любом его изменении.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const txt = (name) => ($(`[data-field="${name}"]`)?.innerText || "").trim();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  function parseDate(s) {
    const m = String(s || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }
  const addDays = (s, n) => { const d = parseDate(s); if (!d) return s; d.setDate(d.getDate() + n); return fmt(d); };

  // Общие поля билетов (не из ваучера)
  const settings = {
    booking: "",
    airline: "",
    outAircraft: "",
    retAircraft: "",
    cls: "Эконом",
    bag: "Багаж до 20 кг",
    printDate: fmt(new Date()),
  };
  const arrOffset = { out: null, ret: null }; // сдвиг даты прилёта в днях, если известен

  const FIELDS = [
    ["booking", "№ брони", "по умолчанию = № ваучера"],
    ["airline", "Авиакомпания", "например UZBEKISTAN AIRWAYS"],
    ["outAircraft", "Самолёт туда", "например Airbus A321neo"],
    ["retAircraft", "Самолёт обратно", "например Airbus A321neo"],
    ["cls", "Класс", "Эконом"],
    ["bag", "Багаж", "Багаж до 20 кг"],
    ["printDate", "Дата печати", ""],
  ];

  // ---------- разметка ----------
  const section = document.createElement("div");
  section.className = "tk-section";
  section.innerHTML = `
    <div class="tk-panel">
      <div class="tk-head">
        <h2>🎫 Авиабилеты</h2>
        <span class="tk-sub">Создаются автоматически из ваучера — по одному на каждого туриста</span>
      </div>
      <div class="tk-grid">
        ${FIELDS.map(([k, label, ph]) => `<label>${label}<input data-set="${k}" placeholder="${esc(ph)}"></label>`).join("")}
      </div>
      <div class="tk-actions">
        <button class="btn" type="button" id="tkAll">🎫 Скачать все билеты PDF</button>
        <button class="btn" type="button" id="tkBoth">📦 Ваучер + билеты одним PDF</button>
      </div>
    </div>
    <div id="tkList"></div>`;

  function mount() {
    $("#voucher").insertAdjacentElement("afterend", section);
    syncInputs();
    observe();
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  function syncInputs() {
    section.querySelectorAll("[data-set]").forEach((i) => { i.value = settings[i.dataset.set] || ""; });
  }

  section.addEventListener("input", (e) => {
    const k = e.target.dataset?.set;
    if (k) { settings[k] = e.target.value; render(); return; }
    // правка срока паспорта прямо в билете — запоминаем у туриста
    const exp = e.target.closest?.("[data-expiry-row]");
    if (exp) {
      const row = $("#touristTable tbody").rows[+exp.dataset.expiryRow];
      if (row) row.dataset.expiry = exp.innerText.trim();
    }
  });

  // ---------- данные из ваучера ----------
  function splitPoint(s) {
    const time = (s.match(/\d{1,2}:\d{2}/) || [""])[0];
    const code = s.replace(time, "").replace(/[\/|,]/g, " ").trim().split(/\s+/)[0] || "";
    return { code: code.toUpperCase(), time };
  }

  function flight(prefix, aircraft) {
    const date = txt(prefix + "_date");
    const number = txt(prefix + "_flight");
    if (!date && !number) return null;
    const dep = splitPoint(txt(prefix + "_dep"));
    const arr = splitPoint(txt(prefix + "_arr"));
    let arrDate = date;
    if (arrOffset[prefix] != null) arrDate = addDays(date, arrOffset[prefix]);
    else if (dep.time && arr.time && arr.time < dep.time) arrDate = addDays(date, 1); // ночной рейс
    return { date, number, dep, arr, arrDate, aircraft };
  }

  const TITLE_RE = /^(MR|MRS|MS|MISS|MSTR|CHD|INF)\.?\s+/i;

  function passengers() {
    const rows = [...($("#touristTable tbody")?.rows || [])];
    return rows.map((r, i) => {
      const c = r.cells;
      const nameCell = (c[1]?.innerText || "").trim();
      const name = r.dataset.first || r.dataset.last
        ? `${r.dataset.first} ${r.dataset.last}`.trim()
        : nameCell.replace(TITLE_RE, "");
      return {
        idx: i,
        name: name.toUpperCase(),
        doc: (c[5]?.innerText || "").trim().toUpperCase(),
        expiry: r.dataset.expiry || "",
      };
    }).filter((p) => p.name);
  }

  // ---------- отрисовка ----------
  function flightRow(f) {
    return `<tr>
      <td contenteditable="true"><b>${esc(f.number)}</b>${f.aircraft ? `<br><small>${esc(f.aircraft)}</small>` : ""}</td>
      <td contenteditable="true">${esc(f.dep.time)}${f.dep.time && f.dep.code ? " / " : ""}<b>${esc(f.dep.code)}</b><br>${esc(f.date)}</td>
      <td contenteditable="true">${esc(f.arr.time)}${f.arr.time && f.arr.code ? " / " : ""}<b>${esc(f.arr.code)}</b><br>${esc(f.arrDate)}</td>
      <td contenteditable="true"><b>${esc(settings.cls)}</b><br>${esc(settings.bag)}</td>
    </tr>`;
  }

  function ticketHtml(p, flights, booking) {
    return `
      <div class="tk-bar">
        <span>Билет: <b>${esc(p.name)}</b></span>
        <button class="btn" type="button" data-dl="${p.idx}">📄 Скачать этот билет</button>
      </div>
      <div class="tk-page">
        <div class="tk-header">
          <div class="logo"><img src="Logodark.png" alt="Leaf Travel Logo"></div>
          <div class="tk-header-right">
            <div>Маршрутная квитанция электронного билета</div>
            <div>Дата печати билета: <span contenteditable="true">${esc(settings.printDate)}</span></div>
          </div>
        </div>
        <div class="tk-block">
          <div>
            <div><strong>№ брони:</strong> <span contenteditable="true" class="tk-big">${esc(booking)}</span></div>
            <div><strong>Авиакомпания:</strong> <span contenteditable="true" class="tk-big">${esc(settings.airline)}</span></div>
          </div>
          <div class="tk-col2">
            <div><strong>Пассажир:</strong> <span contenteditable="true" class="tk-big">${esc(p.name)}</span></div>
            <div><strong>Паспорт</strong> <span contenteditable="true" class="tk-big">${esc(p.doc)}</span><br>
              <span contenteditable="true" class="tk-big" data-expiry-row="${p.idx}">${esc(p.expiry)}</span>
            </div>
          </div>
        </div>
        <div class="tk-title">Информация о рейсе</div>
        <table class="tk-flight">
          <thead><tr><th>Авиакомпания</th><th>Отправление</th><th>Прибытие</th><th>Класс / Багаж</th></tr></thead>
          <tbody>${flights.map(flightRow).join("")}</tbody>
        </table>
        <div class="tk-important">
          <h3>ВАЖНАЯ ИНФОРМАЦИЯ!</h3>
          <ul>
            <li>Указано местное время прибытия / убытия</li>
            <li>Регистрация на рейс открывается за 3 часа до вылета</li>
            <li>Регистрация на рейс закрывается за 1 час до вылета</li>
          </ul>
          <div class="tk-note">
            *Авиабилеты нельзя будет отменить или перебронировать после оплаты.<br>
            Отмену или перебронирование можно осуществить без штрафа в течение 1-их суток после бронирования.
          </div>
        </div>
        <div class="tk-footer">© Leaf Travel Uzbekistan | leaf_travel@mail.ru | t.me/leaf_traveltour</div>
      </div>`;
  }

  function render() {
    const list = $("#tkList", section);
    if (!list) return;
    const flights = [flight("out", settings.outAircraft), flight("ret", settings.retAircraft)].filter(Boolean);
    const pax = passengers();
    const booking = settings.booking || txt("number");
    if (!pax.length) {
      list.innerHTML = `<div class="tk-empty">Добавьте туристов в ваучер — билеты появятся здесь автоматически.</div>`;
      return;
    }
    list.innerHTML = pax.map((p) => `<div class="tk-wrap" data-idx="${p.idx}">${ticketHtml(p, flights, booking)}</div>`).join("");
  }

  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 250); };

  function observe() {
    const voucher = $("#voucher");
    voucher.addEventListener("input", schedule);
    new MutationObserver(schedule).observe(voucher, { childList: true, subtree: true, characterData: true });
  }

  // ---------- данные из распознавания ----------
  function applyExtracted(d) {
    const out = d?.flights?.outbound;
    const ret = d?.flights?.return;
    if (d?.booking_number) settings.booking = d.booking_number;
    if (d?.cabin_class) settings.cls = d.cabin_class;
    if (d?.baggage) settings.bag = d.baggage;
    const airline = out?.airline || ret?.airline;
    if (airline) settings.airline = airline;
    if (out?.aircraft) settings.outAircraft = out.aircraft;
    if (ret?.aircraft) settings.retAircraft = ret.aircraft;
    [["out", out], ["ret", ret]].forEach(([k, f]) => {
      if (!f || !f.date) return;
      const a = parseDate(f.date), b = parseDate(f.arr_date);
      arrOffset[k] = a && b ? Math.round((b - a) / 86400000) : null;
    });
    syncInputs();
  }

  // ---------- PDF ----------
  async function snap(el) {
    document.activeElement?.blur();
    await new Promise((r) => setTimeout(r, 150));
    return html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
  }

  function addPage(pdf, canvas, first) {
    if (!first) pdf.addPage();
    const w = pdf.internal.pageSize.getWidth();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, w, (canvas.height * w) / canvas.width);
  }

  const safe = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "") || "x";

  async function download(pages, filename, withVoucher) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    let first = true;
    if (withVoucher) {
      const buttons = $("#buttons");
      buttons.style.display = "none";
      window.scrollTo(0, 0);
      try { addPage(pdf, await snap($("#voucher")), true); } finally { buttons.style.display = "block"; }
      first = false;
    }
    for (const p of pages) { addPage(pdf, await snap(p), first); first = false; }
    pdf.save(filename);
  }

  async function busy(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Готовлю PDF…";
    try { await fn(); } catch (e) { alert("Ошибка при создании PDF: " + e.message); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  section.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const booking = safe(settings.booking || txt("number"));
    const pages = [...section.querySelectorAll(".tk-page")];
    if (btn.id === "tkAll") {
      if (!pages.length) return alert("Сначала добавьте туристов в ваучер");
      busy(btn, () => download(pages, `LeafTravel_Bilety_${booking}.pdf`));
    } else if (btn.id === "tkBoth") {
      busy(btn, () => download(pages, `LeafTravel_${booking}_voucher_bilety.pdf`, true));
    } else if (btn.dataset.dl != null) {
      const wrap = btn.closest(".tk-wrap");
      const name = wrap.querySelector(".tk-bar b")?.textContent;
      busy(btn, () => download([wrap.querySelector(".tk-page")], `LeafTravel_Bilet_${booking}_${safe(name)}.pdf`));
    }
  });

  window.LeafTickets = { render, applyExtracted, settings };
})();
