"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DN = {1:"Пн",2:"Вт",3:"Ср",4:"Чт",5:"Пт",6:"Сб"};
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const isoToday = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
let DATA, CFG = {}, FABS = {}, P = {}, PER = [], SUBJ = {};
let S = {date: isoToday(), period: null, floor: "", type: "", kind: "room", name: ""};
let LABS = store.get("rasp.abs", {}), PLAN = store.get("rasp.plan", {});
const cache = {};

const mins = h => { if(!h) return 0; const a = h.split(":"); return +a[0]*60 + +a[1]; };
const hasT = p => p && p.start && p.end;
const overlap = (a, b) => (hasT(P[a]) && hasT(P[b])) ? (mins(P[a].start) < mins(P[b].end) && mins(P[b].start) < mins(P[a].end)) : String(a) === String(b);
const dayOf = iso => { const d = new Date(iso+"T12:00:00").getDay(); return d === 0 ? 7 : d; };
const fmtD = iso => { const a = iso.split("-"); return a[2]+"."+a[1]; };
const plabel = p => p.label+" урок";
const pord = id => PER.findIndex(p => p.id === id);
const evKey = (e, date) => [date, e.period, e.class, e.teacher, e.subject].join("|");
const cancelled = (e, date) => PLAN[evKey(e, date)] === "__cancel";

function dayEvents(date){ const d = dayOf(date); return DATA.events.filter(e => e.day === d); }
function absList(date){
  const seen = new Set(), out = [];
  (FABS[date] || []).map(x => Object.assign({src:"file"}, x)).concat((LABS[date] || []).map(x => Object.assign({src:"local"}, x)))
    .forEach(x => { if(x.teacher && !seen.has(x.teacher)){ seen.add(x.teacher); out.push(x); } });
  return out;
}
function currentPeriod(){ return PER[0].id; }
/* отсутствующие классы на дату (из файла и из этого браузера) */
function absClasses(date){
  const out = [], seen = new Set();
  (FABS[date] || []).map(x => Object.assign({src:"file"}, x)).concat((LABS[date] || []).map(x => Object.assign({src:"local"}, x)))
    .forEach(x => { if(x.class && !seen.has(x.class)){ seen.add(x.class); out.push(x); } });
  return out;
}
let ABSC = new Set();

/* ---------- состояние кабинета в уроке ---------- */
function roomState(room, pid, evs, abs){
  const hit = evs.filter(e => e.room === room && overlap(e.period, pid));
  if(!hit.length) return {s:"free", evs:[]};
  const act = hit.filter(e => !cancelled(e, S.date) && !ABSC.has(e.class));
  if(!act.length) return {s:"free", evs:hit, byCancel:true, byAbsent:hit.some(e => ABSC.has(e.class))};
  if(act.every(e => abs.has(e.teacher))) return {s:"cond", evs:act};
  return {s:"busy", evs:act};
}

/* ---------- вкладка: свободные кабинеты ---------- */
function renderRooms(){
  const wd = dayOf(S.date), ok = DATA.meta.days.includes(wd);
  if(!S.period || !P[S.period]) S.period = currentPeriod();
  const evs = dayEvents(S.date), abs = new Set(absList(S.date).map(x => x.teacher));
  const ac = absClasses(S.date); ABSC = new Set(ac.map(x => x.class));
  const addC = (DATA.meta.classes || []).filter(c => !ABSC.has(c));
  const rooms = DATA.meta.rooms.filter(r => !r.hidden && (!S.floor || String(r.floor) === S.floor) && (!S.type || r.type === S.type));
  const states = new Map(rooms.map(r => [r.name, roomState(r.name, S.period, evs, abs)]));
  const free = rooms.filter(r => states.get(r.name).s === "free");
  const cond = rooms.filter(r => states.get(r.name).s === "cond");
  const floors = [...new Set(DATA.meta.rooms.map(r => r.floor).filter(f => f != null))].sort();
  const types = [...new Set(DATA.meta.rooms.map(r => r.type).filter(Boolean))].sort();
  const usedP = PER.filter(p => evs.some(e => e.period === p.id));
  const cols = usedP.length ? usedP : PER;
  const p = P[S.period];
  $("#view").innerHTML = `
  <div class="card">
    <h2 style="margin-top:0">Кого сегодня нет</h2>
    <p class="sub">Введите класс, которого нет в школе (болезнь, поездка). Его кабинеты на этой дате считаются свободными. Отметки хранятся в этом браузере.</p>
    <div class="row">
      <div><label class="l">Дата</label><input type="date" id="fDate" value="${S.date}"></div>
      <div><label class="l">Класс</label><input id="fCls" list="dlc" placeholder="например 5А" size="8" autocomplete="off"></div>
      <div><label class="l">Причина</label><input id="fNote" placeholder="болеет" size="14"></div>
      <div><button data-act="addcls">Добавить</button></div>
    </div>
    <datalist id="dlc">${addC.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div>${ac.map(x => `<span class="pill">${esc(x.class)}${x.note?" · "+esc(x.note):""}${x.src==="local"?` <span class="x" data-act="rmcls" data-v="${esc(x.class)}">×</span>`:""}</span>`).join("") || '<span class="muted">на эту дату никого не отмечено</span>'}
    ${ac.some(x => x.src==="local") ? ' <button class="ghost" data-act="clrcls">Очистить все</button>' : ""}</div>
  </div>
  <div class="card">
    <p class="sub">Кабинет свободен, если на выбранном уроке в нём нет занятий. Нажмите на ячейку в таблице, чтобы выбрать урок.</p>
    <div class="row">
      <div><label class="l">Дата</label><input type="date" id="fDate" value="${S.date}"></div>
      <div><label class="l">Урок</label><select id="fPer">${PER.map(x =>
        `<option value="${esc(x.id)}"${x.id===S.period?" selected":""}>${esc(plabel(x))}</option>`).join("")}</select></div>
      <div><label class="l">Этаж</label><select id="fFloor"><option value="">все</option>${floors.map(f =>
        `<option${String(f)===S.floor?" selected":""}>${f}</option>`).join("")}</select></div>
      <div><label class="l">Тип</label><select id="fType"><option value="">все</option>${types.map(t =>
        `<option${t===S.type?" selected":""}>${esc(t)}</option>`).join("")}</select></div>
    </div>
    ${ok ? "" : `<p class="banner">${DN[wd]||"Воскресенье"} — в расписании нет такого дня.</p>`}
    <h2>Свободно ${free.length} из ${rooms.length} · ${DN[wd]||""} ${fmtD(S.date)}, ${esc(plabel(p))}</h2>
    <div class="chips">${free.map(r => {
      const st = states.get(r.name);
      return `<span class="chip free" title="${st.byAbsent?"класс отсутствует":st.byCancel?"освобождён отменой урока":""}">${esc(r.name)}${r.capacity?` <small>${r.capacity} мест</small>`:""}${st.byAbsent?" <small>"+esc(st.evs.map(e => e.class).filter((v,i,a) => a.indexOf(v)===i).join(", "))+" нет</small>":st.byCancel?" ✂":""}</span>`;
    }).join("") || '<span class="muted">нет свободных</span>'}</div>
    ${cond.length ? `<h2>Могут освободиться (учитель отсутствует, решение по уроку не принято)</h2>
    <div class="chips">${cond.map(r => { const e = states.get(r.name).evs[0];
      return `<span class="chip cond">${esc(r.name)} <small>${esc(e.class||"")} · ${esc(e.teacher||"")}</small></span>`; }).join("")}</div>` : ""}
  </div>
  <div class="card">
    <h2 style="margin-top:0">Весь день: кабинеты × уроки</h2>
    <p class="sub">Зелёное — свободно, жёлтое — учитель отсутствует.</p>
    <div class="scroll"><table class="m"><thead><tr><th class="rh">Кабинет</th>${cols.map(c =>
      `<th class="${c.id===S.period?"sel":""}" data-act="setP" data-v="${esc(c.id)}" style="cursor:pointer">${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${rooms.map(r => `<tr><th class="rh">${esc(r.name)}</th>${cols.map(c => {
      const st = roomState(r.name, c.id, evs, abs);
      const cls = st.s === "free" ? "f" : st.s === "cond" ? "c" : "";
      const txt = st.s === "free" ? (st.byAbsent ? "–" : st.byCancel ? "✂" : "✓") : esc(st.evs[0].class || "•");
      const tip = st.evs.map(e => [e.class, e.subject, e.teacher].filter(Boolean).join(" · ")).join(" | ");
      return `<td class="${cls}${c.id===S.period?" sel":""}" title="${esc(tip)}" data-act="setP" data-v="${esc(c.id)}">${txt}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#foot").textContent = "";
}

/* ---------- ОТДЕЛЬНЫЙ МОДУЛЬ: замены (страница zameny.html) ---------- */
function candidates(e, evs, abs){
  const busy = new Set();
  evs.forEach(x => {
    if(x === e || !overlap(x.period, e.period)) return;
    if(x.teacher && !cancelled(x, S.date)) busy.add(x.teacher);
    const v = PLAN[evKey(x, S.date)];
    if(v && v !== "__cancel") busy.add(v);
  });
  const cnt = {}; evs.forEach(x => { if(x.teacher) cnt[x.teacher] = (cnt[x.teacher]||0)+1; });
  return DATA.meta.teachers.filter(t => !busy.has(t) && !abs.has(t)).sort((a,b) =>
    ((SUBJ[b]&&SUBJ[b].has(e.subject))?1:0) - ((SUBJ[a]&&SUBJ[a].has(e.subject))?1:0) ||
    (cnt[a]||0) - (cnt[b]||0) || a.localeCompare(b, "ru"));
}
function subsSummary(){
  const evs = dayEvents(S.date), abs = absList(S.date), set = new Set(abs.map(x => x.teacher));
  const lines = ["Замены на "+DN[dayOf(S.date)]+" "+fmtD(S.date)+":"];
  evs.filter(e => set.has(e.teacher)).sort((a,b) => pord(a.period)-pord(b.period)).forEach(e => {
    const v = PLAN[evKey(e, S.date)];
    lines.push(e.period+" урок: "+(e.class||"?")+" "+(e.subject||"")+(e.room?" (каб. "+e.room+")":"")+" — "+
      (v === "__cancel" ? "урок отменён" : v ? e.teacher+" → "+v : e.teacher+" → замена не назначена"));
  });
  return lines.join("\n");
}
function renderSubs(){
  if(!(DATA.meta.teachers||[]).length){
    $("#view").innerHTML = '<div class="card"><h1>Замены</h1><p class="muted">В данных нет учителей — модуль замен недоступен.</p></div>'; return;
  }
  const evs = dayEvents(S.date), abs = absList(S.date), set = new Set(abs.map(x => x.teacher));
  const aff = evs.filter(e => set.has(e.teacher)).sort((a,b) =>
    pord(a.period)-pord(b.period) || String(a.class).localeCompare(String(b.class), "ru"));
  const addable = DATA.meta.teachers.filter(t => !set.has(t));
  $("#view").innerHTML = `
  <div class="card">
    <h1>Кто отсутствует</h1>
    <p class="sub">Отметьте больных учителей — ниже появятся их уроки и свободные коллеги для замены.</p>
    <div class="row">
      <div><label class="l">Дата</label><input type="date" id="fDate" value="${S.date}"></div>
      <div><label class="l">Учитель</label><select id="fAdd"><option value="">— выбрать —</option>${addable.map(t =>
        `<option>${esc(t)}</option>`).join("")}</select></div>
      <div><label class="l">Причина</label><input id="fNote" placeholder="болеет" size="14"></div>
      <div><button data-act="addabs">Добавить</button></div>
    </div>
    <div>${abs.map(x => `<span class="pill">${esc(x.teacher)}${x.note?" · "+esc(x.note):""}${x.src==="local"?` <span class="x" data-act="rmabs" data-v="${esc(x.teacher)}">×</span>`:""}</span>`).join("") || '<span class="muted">на эту дату никого не отмечено</span>'}</div>
  </div>
  <div class="card">
    <h1>Уроки без учителя: ${aff.length}</h1>
    <p class="sub">★ — коллега ведёт этот предмет. Показаны только те, у кого в это время нет урока. «Отмена» освобождает кабинет.</p>
    ${aff.length ? `<div class="scroll"><table class="t"><thead><tr><th>Урок</th><th>Класс</th><th>Предмет</th><th>Кабинет</th><th>Учитель</th><th>Решение</th></tr></thead><tbody>${aff.map(e => {
      const key = evKey(e, S.date), cur = PLAN[key] || "", cands = candidates(e, evs, set).slice(0, 8);
      if(cur && cur !== "__cancel" && !cands.includes(cur)) cands.unshift(cur);
      return `<tr><td>${esc(P[e.period].label)}</td><td>${esc(e.class||"")}</td><td>${esc(e.subject||"")}</td>
      <td>${esc(e.room||"—")}</td><td>${esc(e.teacher)}</td><td><select data-chg="plan" data-key="${esc(key)}">
        <option value=""${cur===""?" selected":""}>не решено</option>
        <option value="__cancel"${cur==="__cancel"?" selected":""}>отмена урока</option>
        ${cands.map(t => `<option value="${esc(t)}"${cur===t?" selected":""}>${(SUBJ[t]&&SUBJ[t].has(e.subject))?"★ ":""}${esc(t)}</option>`).join("")}
      </select></td></tr>`; }).join("")}</tbody></table></div>
    <div class="row" style="margin-top:12px"><button data-act="copysum">Скопировать сводку</button>
      <button class="ghost" data-act="copyabs">Копировать JSON отсутствий</button><span class="muted" id="copied"></span></div>` : '<p class="muted">Нет уроков у отмеченных учителей.</p>'}
  </div>`;
  $("#foot").textContent = "Отметки хранятся в этом браузере. Чтобы делиться ими между устройствами — см. PLAN.md, этап 4.";
}

/* ---------- вкладка: двойные брони (без учителей) ---------- */
function findConflicts(){
  const A = {}, B = {};
  DATA.events.forEach(e => {
    if(e.room) (A[e.day+"|"+e.period+"|"+e.room] = A[e.day+"|"+e.period+"|"+e.room] || []).push(e);
    (B[e.day+"|"+e.period+"|"+e.class] = B[e.day+"|"+e.period+"|"+e.class] || []).push(e);
  });
  const rooms = [], classes = [];
  Object.keys(A).forEach(k => { const v = A[k]; if(new Set(v.map(x => x.class)).size > 1) rooms.push({day:+k.split("|")[0], period:v[0].period, room:v[0].room, evs:v}); });
  Object.keys(B).forEach(k => { const v = B[k]; if(v.length < 2) return;
    const g = v.map(x => x.group); if(g.every(Boolean) && new Set(g).size === g.length) return;
    classes.push({day:v[0].day, period:v[0].period, cls:v[0].class, evs:v}); });
  const ord = (a, b) => a.day - b.day || pord(a.period) - pord(b.period);
  rooms.sort((a, b) => ord(a, b) || String(a.room).localeCompare(String(b.room), "ru", {numeric:true}));
  classes.sort((a, b) => ord(a, b) || String(a.cls).localeCompare(String(b.cls), "ru", {numeric:true}));
  return {rooms, classes};
}
const evTxt = e => esc([e.class + (e.group ? " ("+e.group+")" : ""), e.subject, e.room ? "каб. "+e.room : null].filter(Boolean).join(" · "));
function renderConflicts(){
  const c = findConflicts(), cnt = {};
  c.rooms.forEach(x => { cnt[x.room] = (cnt[x.room] || 0) + 1; });
  const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b, "ru", {numeric:true})).slice(0, 8);
  const week = DATA.source && DATA.source.week ? " (неделя "+DATA.source.week+")" : "";
  const sel = S.cf || "all";
  const rooms = c.rooms.filter(x => sel === "all" || x.room === sel);
  $("#view").innerHTML = `
  <div class="card">
    <h1>Двойные брони${esc(week)}</h1>
    <p class="sub">Автоматическая проверка расписания. <b>Это не обязательно ошибки:</b> общие кабинеты и деление класса на подгруппы выглядят так же. Что проверить: (1) где это сознательное совмещение двух классов в одном кабинете, (2) где подгруппа не отмечена в расписании, (3) где это реальная накладка.</p>
    <div class="chips"><span class="chip cond">Кабинеты с 2+ классами: <b>${c.rooms.length}</b></span><span class="chip cond">Классы на 2+ урока одновременно: <b>${c.classes.length}</b></span></div>
    <p class="sub" style="margin-top:12px">Чаще всего: ${top.map(r => "каб. "+esc(r)+" — "+cnt[r]).join(", ")}.</p>
  </div>
  <div class="card">
    <h2 style="margin-top:0">A. Один кабинет — несколько классов в одно время</h2>
    <div class="row"><div><label class="l">Кабинет</label><select id="fCf"><option value="all">все</option>${Object.keys(cnt).sort((a, b) => a.localeCompare(b, "ru", {numeric:true})).map(r =>
      `<option value="${esc(r)}"${r===sel?" selected":""}>${esc(r)} (${cnt[r]})</option>`).join("")}</select></div></div>
    <div class="scroll"><table class="t"><thead><tr><th>День</th><th>Урок</th><th>Кабинет</th><th>Что записано</th></tr></thead><tbody>${rooms.map(x =>
      `<tr><td>${DN[x.day]}</td><td>${esc(x.period)}</td><td>${esc(x.room)}</td><td>${x.evs.map(e => `<div>${evTxt(e).replace(/ · каб\. [^·]*$/, "")}</div>`).join("")}</td></tr>`).join("")}</tbody></table></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">B. Класс записан на 2+ урока одновременно</h2>
    <p class="sub">Случаи, когда у уроков разные подгруппы (1 гр. / 2 гр.), не считаются.</p>
    <div class="scroll"><table class="t"><thead><tr><th>День</th><th>Урок</th><th>Класс</th><th>Что записано</th></tr></thead><tbody>${c.classes.map(x =>
      `<tr><td>${DN[x.day]}</td><td>${esc(x.period)}</td><td>${esc(x.cls)}</td><td>${x.evs.map(e => `<div>${esc([e.subject, e.group, e.room ? "каб. "+e.room : null].filter(Boolean).join(" · "))}</div>`).join("")}</td></tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#foot").textContent = "Учителя в этот отчёт не включены.";
}

/* ---------- вкладка: расписание сущности ---------- */
function renderView(){
  const kinds = {room:["Кабинет","rooms"], teacher:["Учитель","teachers"], class:["Класс","classes"]};
  if(!(DATA.meta.teachers||[]).length) delete kinds.teacher;
  const list = kinds[S.kind][1] === "rooms" ? DATA.meta.rooms.map(r => r.name) : DATA.meta[kinds[S.kind][1]];
  let grid = "";
  if(S.name && list.includes(S.name)){
    const mine = DATA.events.filter(e => (S.kind==="room" ? e.room : S.kind==="teacher" ? e.teacher : e.class) === S.name);
    const pers = PER.filter(p => mine.some(e => e.period === p.id));
    const days = DATA.meta.days;
    grid = `<div class="scroll"><table class="t"><thead><tr><th>Урок</th>${days.map(d => `<th>${DN[d]}</th>`).join("")}</tr></thead><tbody>${pers.map(p =>
      `<tr><td style="white-space:nowrap"><b>${esc(p.label)}</b></td>${days.map(d => {
        const c = mine.filter(e => e.day === d && e.period === p.id);
        return `<td>${c.map(e => `<div class="ev"><b>${esc(e.subject||"")}</b><br>${[S.kind!=="class"?e.class:null,S.kind!=="teacher"?e.teacher:null,S.kind!=="room"?(e.room?"каб. "+e.room:null):null].filter(Boolean).map(esc).join(" · ")}</div>`).join("")}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  $("#view").innerHTML = `<div class="card"><h1>Расписание</h1><p class="sub">Неделя кабинета, учителя или класса.</p>
    <div class="row"><div><label class="l">Что</label><select id="fKind">${Object.keys(kinds).map(k =>
      `<option value="${k}"${k===S.kind?" selected":""}>${kinds[k][0]}</option>`).join("")}</select></div>
    <div><label class="l">Название</label><input id="fName" list="dl" value="${esc(S.name)}" placeholder="начните вводить"></div></div>
    <datalist id="dl">${list.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    ${grid || '<p class="muted">Выберите значение из списка.</p>'}</div>`;
  $("#foot").textContent = "";
}

/* ---------- роутинг / действия ---------- */
function route(){
  if(document.body.dataset.page === "zameny") return renderSubs();
  const t = (location.hash.replace(/^#\/?/, "") || "rooms");
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.v === t));
  ({rooms: renderRooms, view: renderView, conflicts: renderConflicts}[t] || renderRooms)();
}
const ACT = {
  tab: v => { location.hash = "#/"+v; },
  setP: v => { S.period = v; route(); },
  addabs: () => {
    const t = $("#fAdd").value; if(!t) return;
    (LABS[S.date] = LABS[S.date] || []).push({teacher:t, note:$("#fNote").value.trim() || null});
    store.set("rasp.abs", LABS); route();
  },
  addcls: () => {
    const c = $("#fCls").value.trim().toUpperCase().replace(/\s+/g, "");
    const known = (DATA.meta.classes || []).find(x => x.toUpperCase() === c);
    if(!known){ $("#fCls").style.outline = "2px solid #c00"; $("#fCls").focus(); return; }
    (LABS[S.date] = LABS[S.date] || []).push({class:known, note:$("#fNote").value.trim() || null});
    store.set("rasp.abs", LABS); route();
  },
  rmcls: v => { LABS[S.date] = (LABS[S.date]||[]).filter(x => x.class !== v); store.set("rasp.abs", LABS); route(); },
  clrcls: () => { LABS[S.date] = (LABS[S.date]||[]).filter(x => !x.class); store.set("rasp.abs", LABS); route(); },
  rmabs: v => { LABS[S.date] = (LABS[S.date]||[]).filter(x => x.class || x.teacher !== v); store.set("rasp.abs", LABS); route(); },
  copysum: () => copy(subsSummary()),
  copyabs: () => { const o = {}; o[S.date] = absList(S.date).map(x => ({teacher:x.teacher, note:x.note||null})); copy(JSON.stringify(o, null, 2)); }
};
function copy(txt){
  const done = ok => { const el = $("#copied"); if(el) el.textContent = ok ? "скопировано" : "не удалось скопировать"; };
  try{ navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); }catch(e){ done(false); }
}
document.addEventListener("click", ev => { const t = ev.target.closest("[data-act]"); if(t && ACT[t.dataset.act]) ACT[t.dataset.act](t.dataset.v); });
document.addEventListener("change", ev => {
  const t = ev.target, id = t.id;
  if(id === "fDate" && t.value){ S.date = t.value; S.period = null; }
  else if(id === "fPer") S.period = t.value;
  else if(id === "fFloor") S.floor = t.value;
  else if(id === "fType") S.type = t.value;
  else if(id === "fKind"){ S.kind = t.value; S.name = ""; }
  else if(id === "fName") S.name = t.value;
  else if(id === "fCf") S.cf = t.value;
  else if(t.dataset.chg === "plan"){ if(t.value) PLAN[t.dataset.key] = t.value; else delete PLAN[t.dataset.key]; store.set("rasp.plan", PLAN); }
  else return;
  setTimeout(route, 0);
});

async function boot(){
  try{
    const j = (u, soft) => fetch(u+"?_="+Date.now()).then(r => { if(!r.ok) throw new Error(u+": "+r.status); return r.json(); }).catch(e => { if(soft) return {}; throw e; });
    const r = await Promise.all([j("data/timetable.json"), j("data/absences.json", true), j("data/config.json", true)]);
    DATA = r[0]; FABS = r[1]; CFG = r[2];
    PER = DATA.meta.periods; PER.forEach(p => { P[p.id] = p; });
    DATA.events.forEach(e => { if(e.teacher){ (SUBJ[e.teacher] = SUBJ[e.teacher] || new Set()).add(e.subject); } });
    const d = new Date(DATA.fetched_at), age = (Date.now()-d)/864e5, lim = CFG.staleAfterDays || 7;
    const st = $("#stamp"); st.textContent = (DATA.school&&DATA.school.name ? DATA.school.name+" · " : "")+"данные от "+d.toLocaleDateString("ru-RU")+(age>lim&&!DATA.demo ? " — устарели ("+Math.floor(age)+" дн.)" : "");
    if(age > lim && !DATA.demo) st.classList.add("stale");
    let b = "";
    if(DATA.demo) b += '<div class="banner">ДЕМО-ДАННЫЕ: расписание вымышленное. Реальные данные появятся после подключения e-kunduluk.</div>';
    const rep = DATA.report || {};
    if(rep.without_room) b += '<div class="banner">У '+rep.without_room+' уроков в источнике не указан кабинет — они не занимают кабинеты на этой странице.</div>';
    $("#banner").innerHTML = b;
    const zl = $("#zlink"); if(zl && (DATA.meta.teachers||[]).length) zl.hidden = false;
    window.addEventListener("hashchange", route);
    route();
  }catch(e){
    showLoadError(e);
  }
}
const PW_HASH = "b0866135413d46ca366808eed12f77200e6e63108474aa6e133e308d6b982002";
function sha256(ascii){
  function rr(v,a){return(v>>>a)|(v<<(32-a))}
  var mp=Math.pow,mw=mp(2,32),i,j,result='',words=[],al=ascii.length*8;
  var h=sha256.h=sha256.h||[],k=sha256.k=sha256.k||[],pc=k.length,ic={};
  for(var c=2;pc<64;c++){if(!ic[c]){for(i=0;i<313;i+=c)ic[i]=c;h[pc]=(mp(c,.5)*mw)|0;k[pc++]=(mp(c,1/3)*mw)|0}}
  ascii+='\x80';while(ascii.length%64-56)ascii+='\x00';
  for(i=0;i<ascii.length;i++){j=ascii.charCodeAt(i);if(j>>8)return;words[i>>2]|=j<<((3-i)%4)*8}
  words[words.length]=((al/mw)|0);words[words.length]=(al);
  for(j=0;j<words.length;){var w=words.slice(j,j+=16),oh=h;h=h.slice(0,8);
    for(i=0;i<64;i++){var w15=w[i-15],w2=w[i-2],a=h[0],e=h[4];
      var t1=h[7]+(rr(e,6)^rr(e,11)^rr(e,25))+((e&h[5])^((~e)&h[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(rr(w15,7)^rr(w15,18)^(w15>>>3))+w[i-7]+(rr(w2,17)^rr(w2,19)^(w2>>>10)))|0);
      var t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&h[1])^(a&h[2])^(h[1]&h[2]));
      h=[(t1+t2)|0].concat(h);h[4]=(h[4]+t1)|0}
    for(i=0;i<8;i++)h[i]=(h[i]+oh[i])|0}
  for(i=0;i<8;i++)for(j=3;j+1;j--){var b=(h[i]>>(j*8))&255;result+=((b<16)?0:'')+b.toString(16)}
  return result;
}
const pwHash = pw => sha256("raspisanie:"+unescape(encodeURIComponent(pw)));
let started = false;
function unlock(){ document.body.classList.remove("locked"); const g = $("#gate"); if(g) g.remove(); if(!started){ started = true; boot(); } }
/* ---------- вход ----------
   Общий пароль-«замок»: в коде только SHA-256 хэш. Это не защита данных (JSON лежит рядом и открыт по ссылке),
   а чтобы случайный посетитель не открыл страницу. В расписании нет ФИО — только классы и кабинеты. */
function showLoadError(e){
  $("#view").innerHTML = '<div class="card"><h1>Нет данных</h1><p class="sub">'+esc(e.message)+'</p><p>Если открываете файл с компьютера, запустите в папке site: <code>python -m http.server 8099</code> и откройте <code>http://localhost:8099/</code></p></div>';
}
(function localGate(){
  let saved = null; try{ saved = localStorage.getItem("rasp.ok"); }catch(e){}
  if(saved === PW_HASH) return unlock();
  $("#gform").addEventListener("submit", ev => {
    ev.preventDefault();
    if(pwHash($("#gpw").value) === PW_HASH){ try{ localStorage.setItem("rasp.ok", PW_HASH); }catch(e){} unlock(); }
    else { $("#gerr").textContent = "Неверный пароль"; $("#gpw").select(); }
  });
})();
