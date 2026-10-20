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
let S = {date: isoToday(), period: null, floor: "", type: "", kind: "class", name: "", room: store.get("rasp.room", "")};
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
const NN_DEFAULT = ["большой спорт зал", "малый спортзал", "11", "логопед"];
const isNN = name => (CFG.notNeededRooms || NN_DEFAULT).includes(name);
function currentPeriod(){ const s = store.get("rasp.per", null); return (s && s.date === S.date && P[s.p]) ? s.p : PER[0].id; }
const savePer = p => store.set("rasp.per", {date: S.date, p});
/* латиница, похожая на кириллицу (5A → 5А): класс находится и при английской раскладке */
const LAT = {A:"А",B:"В",E:"Е",K:"К",M:"М",H:"Н",O:"О",P:"Р",C:"С",T:"Т",X:"Х",Y:"У"};
const normCls = s => String(s || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[ABEKMHOPCTXY]/g, ch => LAT[ch]);
const legend = items => `<div class="legend">${items.map(([c, t]) => `<span><i class="sw ${c}"></i>${t}</span>`).join("")}</div>`;
/* отсутствующие классы на дату (из файла и из этого браузера) */
function absClasses(date){
  const out = [], seen = new Set();
  (FABS[date] || []).map(x => Object.assign({src:"file"}, x)).concat((LABS[date] || []).map(x => Object.assign({src:"local"}, x)))
    .forEach(x => { if(x.class && !seen.has(x.class)){ seen.add(x.class); out.push(x); } });
  return out;
}
let ABSC = new Set();

/* классный час: кабинет формально закреплён, но учитель вправе его перенести, и кабинет можно занять */
const isHR = e => /^\s*классный\s+час/i.test(e.subject || "");
/* ---------- состояние кабинета в уроке ---------- */
function roomState(room, pid, evs, abs){
  const hit = evs.filter(e => e.room === room && overlap(e.period, pid));
  if(!hit.length) return {s:"free", evs:[]};
  const act = hit.filter(e => !cancelled(e, S.date) && !ABSC.has(e.class));
  if(!act.length) return {s:"free", evs:hit, byCancel:true, byAbsent:hit.some(e => ABSC.has(e.class))};
  if(act.every(e => abs.has(e.teacher))) return {s:"cond", evs:act};
  if(act.every(isHR)) return {s:"hr", evs:act};
  return {s:"busy", evs:act};
}

/* ---------- вкладка: свободные кабинеты ---------- */
function renderRooms(){
  const wd = dayOf(S.date), ok = DATA.meta.days.includes(wd);
  if(!S.period || !P[S.period]) S.period = currentPeriod();
  const evs = dayEvents(S.date), abs = new Set(absList(S.date).map(x => x.teacher));
  const ac = absClasses(S.date); ABSC = new Set(ac.map(x => x.class));
  const addC = (DATA.meta.classes || []).filter(c => !ABSC.has(c));
  const at = absList(S.date), hasTch = (DATA.meta.teachers || []).length > 0;
  const addT = (DATA.meta.teachers || []).filter(t => !abs.has(t));
  const rooms = DATA.meta.rooms.filter(r => !r.hidden && (!S.floor || String(r.floor) === S.floor) && (!S.type || r.type === S.type));
  const states = new Map(rooms.map(r => [r.name, roomState(r.name, S.period, evs, abs)]));
  const useful = rooms.filter(r => !isNN(r.name));
  const free = useful.filter(r => states.get(r.name).s === "free");
  const cond = useful.filter(r => states.get(r.name).s === "cond");
  const hrs = useful.filter(r => states.get(r.name).s === "hr");
  const tblRooms = useful.concat(rooms.filter(r => isNN(r.name)));
  const floors = [...new Set(DATA.meta.rooms.map(r => r.floor).filter(f => f != null))].sort();
  const types = [...new Set(DATA.meta.rooms.map(r => r.type).filter(Boolean))].sort();
  const usedP = PER.filter(p => evs.some(e => e.period === p.id));
  const cols = usedP.length ? usedP : PER;
  const p = P[S.period];
  $("#view").innerHTML = `
  <div class="card c-abs">
    <h2 style="margin-top:0">Кого нет · ${DN[wd]||""} ${fmtD(S.date)}</h2>
    <p class="sub">Класс, которого нет в школе, освобождает свои кабинеты. Учитель, которого нет, — кабинеты <b>могут освободиться</b> (жёлтые): урок отменят или заменят. Отметки — на дату, выбранную выше, и хранятся только в этом браузере.</p>
    <div class="row">
      <div><label class="l">Класс</label><input id="fCls" list="dlc" placeholder="5А" size="8" autocomplete="off"></div>
      ${hasTch ? `<div><label class="l">Учитель</label><input id="fTch" list="dlt" placeholder="начните фамилию" size="22" autocomplete="off"></div>` : ""}
      <div><label class="l">Причина</label><input id="fNote" placeholder="болеет" size="14"></div>
      <div><button data-act="addcls">Добавить</button></div>
    </div>
    <datalist id="dlt">${addT.map(t => `<option value="${esc(t)}">`).join("")}</datalist>
    <datalist id="dlc">${addC.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div>${at.map(x => `<span class="pill">${esc(x.teacher)}${x.note?" · "+esc(x.note):""}${x.src==="local"?` <span class="x" data-act="rmabs" data-v="${esc(x.teacher)}">×</span>`:""}</span>`).join("")}${ac.map(x => `<span class="pill">${esc(x.class)}${x.note?" · "+esc(x.note):""}${x.src==="local"?` <span class="x" data-act="rmcls" data-v="${esc(x.class)}">×</span>`:""}</span>`).join("") || (at.length ? "" : '<span class="muted">на эту дату никого не отмечено</span>')}
    ${(ac.concat(at)).some(x => x.src==="local") ? ' <button class="ghost" data-act="clrcls">Очистить все</button>' : ""}</div>
  </div>
  <div class="card c-free">
    <p class="sub">Кабинет свободен, если на выбранном уроке в нём нет занятий.</p>
    <div class="row">
      <div><label class="l">Дата</label><input type="date" id="fDate" value="${S.date}"></div>
      <div><label class="l">Урок</label><select id="fPer">${PER.map(x =>
        `<option value="${esc(x.id)}"${x.id===S.period?" selected":""}>${esc(plabel(x))}</option>`).join("")}</select></div>
      <div${floors.length ? "" : " hidden"}><label class="l">Этаж</label><select id="fFloor"><option value="">все</option>${floors.map(f =>
        `<option${String(f)===S.floor?" selected":""}>${f}</option>`).join("")}</select></div>
      <div><label class="l">Тип</label><select id="fType"><option value="">все</option>${types.map(t =>
        `<option${t===S.type?" selected":""}>${esc(t)}</option>`).join("")}</select></div>
    </div>
    ${ok ? "" : `<p class="banner">${DN[wd]||"Воскресенье"} — в расписании нет такого дня.</p>`}
    <h2>Свободно ${free.length} из ${useful.length} · ${DN[wd]||""} ${fmtD(S.date)}, ${esc(plabel(p))}</h2>
    <div class="chips">${free.map(r => {
      const st = states.get(r.name);
      return `<span class="chip free" title="${st.byAbsent?"класс отсутствует":st.byCancel?"освобождён отменой урока":""}">${esc(r.name)}${r.capacity?` <small>${r.capacity} мест</small>`:""}${st.byAbsent?" <small>"+esc(st.evs.map(e => e.class).filter((v,i,a) => a.indexOf(v)===i).join(", "))+" нет</small>":st.byCancel?" ✂":""}</span>`;
    }).join("") || '<span class="muted">нет свободных</span>'}</div>
    ${cond.length ? `<h2>Могут освободиться (учитель отсутствует)</h2>
    <div class="chips">${cond.map(r => { const e = states.get(r.name).evs[0];
      return `<span class="chip cond">${esc(r.name)} <small>${esc(e.class||"")} · ${esc(e.teacher||"")}</small></span>`; }).join("")}</div>` : ""}
    ${hrs.length ? `<h2>Классный час: можно занять, если учитель перенесёт</h2>
    <div class="chips">${hrs.map(r => { const e = states.get(r.name).evs[0];
      return `<span class="chip hr">${esc(r.name)} <small>кл. час ${esc(e.class||"")}${e.teacher ? " · "+esc(e.teacher) : ""}</small></span>`; }).join("")}</div>` : ""}
  </div>
  <div class="card c-day">
    <h2 style="margin-top:0">Весь день: кабинеты × уроки</h2>
    ${legend([["f","свободно («–» класса нет, ✂ отмена)"],["c","учитель отсутствует: может освободиться"],["h","кч: классный час, можно занять"],["b","занято"],["nn","не используется"]])}<p class="sub">Нажмите на ячейку — карточка урока, на номер урока — выбрать его, на кабинет — его неделя.</p>
    <div class="scroll"><table class="m"><thead><tr><th class="rh">Кабинет</th>${cols.map(c =>
      `<th class="${c.id===S.period?"sel":""}" data-act="setP" data-v="${esc(c.id)}" style="cursor:pointer">${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${tblRooms.map(r => `<tr><th class="rh${isNN(r.name)?" nn":""}" data-act="goroom" data-v="${esc(r.name)}" title="Неделя кабинета" style="cursor:pointer">${esc(r.name)}</th>${cols.map(c => {
      const st = roomState(r.name, c.id, evs, abs);
      const cls = isNN(r.name) ? "nn" : st.s === "free" ? "f" : st.s === "cond" ? "c" : st.s === "hr" ? "h" : "";
      const txt = isNN(r.name) && st.s === "free" ? "" : st.s === "free" ? (st.byAbsent ? "–" : st.byCancel ? "✂" : "✓") : esc(st.evs[0].class || "•") + (st.s === "hr" ? " <small>кч</small>" : "");
      const tip = st.evs.map(e => [e.class, e.subject, e.teacher].filter(Boolean).join(" · ")).join(" | ");
      return `<td class="${cls}${c.id===S.period?" sel":""}" title="${esc(tip)}" data-act="cell" data-v="${esc(r.name)}|${esc(c.id)}">${txt}</td>`;
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
  const sel = S.cf || "all", onlyHard = S.hrHide === "1";
  /* совпадение с классным часом не страшно: учитель может перенести его в другой кабинет */
  const mildR = x => x.evs.some(isHR), mildC = x => x.evs.some(isHR);
  const hardR = c.rooms.filter(x => !mildR(x)), hardC = c.classes.filter(x => !mildC(x));
  const rooms = c.rooms.filter(x => (sel === "all" || x.room === sel) && !(onlyHard && mildR(x)));
  const classes = c.classes.filter(x => !(onlyHard && mildC(x)));
  $("#view").innerHTML = `
  <div class="card">
    <h1>Двойные брони${esc(week)}</h1>
    <p class="sub">Автоматическая проверка расписания. <b>Это не обязательно ошибки:</b> общие кабинеты и деление класса на подгруппы выглядят так же. Что проверить: (1) где это сознательное совмещение двух классов в одном кабинете, (2) где подгруппа не отмечена в расписании, (3) где это реальная накладка.</p>
    <div class="chips"><span class="chip cond">Кабинеты с 2+ классами: <b>${c.rooms.length}</b>, без классного часа: <b>${hardR.length}</b></span><span class="chip cond">Классы на 2+ урока одновременно: <b>${c.classes.length}</b>, без классного часа: <b>${hardC.length}</b></span><span class="chip hr">Совпадения с классным часом (не страшно): <b>${c.rooms.length - hardR.length + c.classes.length - hardC.length}</b></span></div>
    <p class="sub" style="margin-top:12px">Чаще всего: ${top.map(r => "каб. "+esc(r)+" — "+cnt[r]).join(", ")}.</p>
  </div>
  <div class="card">
    <h2 style="margin-top:0">A. Один кабинет — несколько классов в одно время</h2>
    <p class="sub">Строки со штриховкой и пометкой «кч» — среди уроков есть классный час: учитель может перенести его в другой кабинет, это не страшно.</p>
    <div class="row"><div><label class="l">Показывать</label><select id="fHr"><option value="0"${onlyHard?"":" selected"}>все совпадения</option><option value="1"${onlyHard?" selected":""}>без классного часа</option></select></div><div><label class="l">Кабинет</label><select id="fCf"><option value="all">все</option>${Object.keys(cnt).sort((a, b) => a.localeCompare(b, "ru", {numeric:true})).map(r =>
      `<option value="${esc(r)}"${r===sel?" selected":""}>${esc(r)} (${cnt[r]})</option>`).join("")}</select></div></div>
    <div class="scroll"><table class="t"><thead><tr><th>День</th><th>Урок</th><th>Кабинет</th><th>Что записано</th></tr></thead><tbody>${rooms.map(x =>
      `<tr${mildR(x) ? ' class="mild"' : ""}><td>${DN[x.day]}</td><td>${esc(x.period)}</td><td>${esc(x.room)}</td><td>${x.evs.map(e => `<div>${evTxt(e).replace(/ · каб\. [^·]*$/, "")}${isHR(e) ? ' <i class="kch">кч</i>' : ""}</div>`).join("")}${mildR(x) ? '<div class="rs">есть классный час, не страшно</div>' : ""}</td></tr>`).join("")}</tbody></table></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">B. Класс записан на 2+ урока одновременно</h2>
    <p class="sub">Случаи, когда у уроков разные подгруппы (1 гр. / 2 гр.), не считаются.</p>
    <div class="scroll"><table class="t"><thead><tr><th>День</th><th>Урок</th><th>Класс</th><th>Что записано</th></tr></thead><tbody>${classes.map(x =>
      `<tr${mildC(x) ? ' class="mild"' : ""}><td>${DN[x.day]}</td><td>${esc(x.period)}</td><td>${esc(x.cls)}</td><td>${x.evs.map(e => `<div>${esc([e.subject, e.group, e.room ? "каб. "+e.room : null].filter(Boolean).join(" · "))}${isHR(e) ? ' <i class="kch">кч</i>' : ""}</div>`).join("")}${mildC(x) ? '<div class="rs">есть классный час, не страшно</div>' : ""}</td></tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#foot").textContent = "Учителя в этот отчёт не включены.";
}

/* ---------- вкладка: расписание сущности ---------- */
function renderView(){
  const kinds = {class:["Класс","classes"], teacher:["Учитель","teachers"]};
  if(!(DATA.meta.teachers||[]).length) delete kinds.teacher;
  if(!kinds[S.kind]) S.kind = "class";
  const list = DATA.meta[kinds[S.kind][1]];
  let grid = "";
  if(S.name && list.includes(S.name)){
    const mine = DATA.events.filter(e => (S.kind==="teacher" ? e.teacher : e.class) === S.name);
    const pers = PER.filter(p => mine.some(e => e.period === p.id));
    const days = DATA.meta.days;
    grid = `<div class="scroll"><table class="t"><thead><tr><th>Урок</th>${days.map(d => `<th>${DN[d]}</th>`).join("")}</tr></thead><tbody>${pers.map(p =>
      `<tr><td style="white-space:nowrap"><b>${esc(p.label)}</b></td>${days.map(d => {
        const c = mine.filter(e => e.day === d && e.period === p.id);
        return `<td>${c.map(e => `<div class="ev${isHR(e) ? " hr" : ""}"><b>${esc(e.subject||"")}</b>${isHR(e) ? ' <i class="kch">кч</i>' : ""}<br>${[S.kind!=="class"?e.class:null,S.kind!=="teacher"?e.teacher:null,e.room?"каб. "+e.room:null].filter(Boolean).map(esc).join(" · ")}</div>`).join("")}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  $("#view").innerHTML = `<div class="card"><h1>Расписание</h1><p class="sub">Неделя класса или учителя. Неделя кабинета — на вкладке «По кабинету». Штриховка «кч» — классный час: учитель может перенести его в другой кабинет.</p>
    <div class="row"><div><label class="l">Что</label><select id="fKind">${Object.keys(kinds).map(k =>
      `<option value="${k}"${k===S.kind?" selected":""}>${kinds[k][0]}</option>`).join("")}</select></div>
    <div><label class="l">Название</label><input id="fName" list="dl" value="${esc(S.name)}" placeholder="начните вводить"></div></div>
    <datalist id="dl">${list.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    ${grid || '<p class="muted">Выберите значение из списка.</p>'}</div>`;
  $("#foot").textContent = "";
}


/* ---------- вкладка: по кабинету ---------- */
const byNum = (a, b) => String(a).localeCompare(String(b), "ru", {numeric:true});
function weekDate(d){ // дата дня недели d в неделе выбранной даты (в воскресенье — следующая неделя)
  const wd = dayOf(S.date), base = new Date(S.date+"T12:00:00");
  base.setDate(base.getDate() + (wd === 7 ? 1 : 1 - wd) + (d - 1));
  return base.getFullYear()+"-"+String(base.getMonth()+1).padStart(2,"0")+"-"+String(base.getDate()).padStart(2,"0");
}
function runs(ps, order){ // ["1","2","3","5"] -> "1–3, 5"
  const out = []; let st = null, prev = null;
  ps.forEach(p => { const i = order.indexOf(p);
    if(st !== null && i === prev + 1){ prev = i; return; }
    if(st !== null) out.push(st === prev ? order[st] : order[st]+"–"+order[prev]);
    st = prev = i; });
  if(st !== null) out.push(st === prev ? order[st] : order[st]+"–"+order[prev]);
  return out.join(", ");
}
function renderRoom(){
  const all = DATA.meta.rooms.filter(r => !r.hidden).slice().sort((a, b) => (isNN(a.name) - isNN(b.name)) || byNum(a.name, b.name));
  if(!S.room || !all.some(r => r.name === S.room)) S.room = (all.find(r => !isNN(r.name)) || all[0]).name;
  const days = DATA.meta.days, wd = dayOf(S.date), okDay = days.includes(wd);
  const abs = new Set(absList(S.date).map(x => x.teacher));
  ABSC = new Set(absClasses(S.date).map(x => x.class));
  const pers = PER.filter(p => DATA.events.some(e => e.period === p.id));
  const order = pers.map(p => p.label);
  const mine = DATA.events.filter(e => e.room === S.room);
  const r = all.find(x => x.name === S.room);
  const todayEvs = dayEvents(S.date);
  const stT = okDay ? new Map(pers.map(p => [p.id, roomState(S.room, p.id, todayEvs, abs)])) : new Map();
  const freeT = pers.filter(p => stT.get(p.id) && stT.get(p.id).s === "free").map(p => p.label);
  const condT = pers.filter(p => stT.get(p.id) && stT.get(p.id).s === "cond").map(p => p.label);
  let busy = 0; days.forEach(d => pers.forEach(p => { if(mine.some(e => e.day === d && e.period === p.id)) busy++; }));
  const total = days.length * pers.length;
  const idx = all.findIndex(x => x.name === S.room);
  const prevR = all[(idx - 1 + all.length) % all.length].name, nextR = all[(idx + 1) % all.length].name;
  const meta = [r.type && r.type !== "общий" ? r.type : null, r.floor != null ? r.floor+" этаж" : null, r.capacity ? r.capacity+" мест" : null].filter(Boolean).join(" · ");
  $("#view").innerHTML = `
  <div class="card">
    <h1>Кабинет ${esc(S.room)}</h1>
    <p class="sub">${meta ? esc(meta)+". " : ""}${isNN(S.room) ? "Этот кабинет отмечен как неиспользуемый. " : ""}Неделя кабинета: зелёное — свободно, штриховка — классный час (можно занять, если учитель перенесёт). Нажмите на занятую ячейку — откроется карточка урока, на день — выбор даты.</p>
    <div class="row">
      <div><label class="l">Кабинет</label><select id="fRoom">${all.map(x =>
        `<option value="${esc(x.name)}"${x.name===S.room?" selected":""}>${esc(x.name)}${isNN(x.name)?" (не исп.)":""}</option>`).join("")}</select></div>
      <div class="rnav"><button class="ghost" data-act="goroom" data-v="${esc(prevR)}" title="Предыдущий">←</button><button class="ghost" data-act="goroom" data-v="${esc(nextR)}" title="Следующий">→</button></div>
      <div><label class="l">Дата</label><input type="date" id="fDate" value="${S.date}"></div>
    </div>
    <h2>${okDay ? `${DN[wd]} ${fmtD(S.date)}: ${freeT.length ? "свободен на уроках "+esc(runs(freeT, order)) : "свободных уроков нет"}` : `${DN[wd]||"Воскресенье"} ${fmtD(S.date)} — в расписании нет такого дня`}</h2>
    ${condT.length ? `<div class="chips"><span class="chip cond">Могут освободиться (учитель отсутствует): уроки ${esc(runs(condT, order))}</span></div>` : ""}
    <p class="sub" style="margin-top:10px">За неделю занят ${busy} из ${total} уроков, свободен ${total - busy}.</p>
  </div>
  <div class="card">
    <div class="scroll"><table class="m rw"><thead><tr><th class="rh" title="Урок">№</th>${days.map(d =>
      `<th class="${d===wd?"sel":""}" data-act="setD" data-v="${weekDate(d)}" style="cursor:pointer">${DN[d]} ${fmtD(weekDate(d))}</th>`).join("")}</tr></thead>
    <tbody>${pers.map(p => `<tr><th class="rh">${esc(p.label)}</th>${days.map(d => {
      const isT = d === wd;
      const st = isT ? stT.get(p.id) : null;
      const evs = isT ? st.evs : mine.filter(e => e.day === d && e.period === p.id);
      const free = isT ? st.s === "free" : !evs.length;
      const hrCell = !free && evs.length && evs.every(isHR) && !(isT && st.s === "cond");
      const cls = free ? "f" : (isT && st.s === "cond") ? "c" : hrCell ? "h" : "";
      const txt = free ? (evs.length ? (st.byAbsent ? "– класса нет" : "✂ отмена") : "свободно")
        : evs.map(e => `<div><b>${esc(e.class||"•")}${e.group?" <small>("+esc(e.group)+")</small>":""}</b> <span class="rs">${esc(e.subject||"")}</span></div>`).join("") + (hrCell ? '<div class="rs">можно занять</div>' : "");
      const tip = evs.map(e => [e.class, e.subject, e.teacher].filter(Boolean).join(" · ")).join(" | ");
      return `<td class="${cls}${isT?" sel":""}${evs.length>1&&!free?" dbl":""}" title="${esc(tip)}" data-act="rcell" data-v="${weekDate(d)}|${esc(p.id)}">${txt}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#foot").textContent = "Отметки отсутствующих учитываются только для выбранной даты (выделенный столбец).";
}

/* ---------- роутинг / действия ---------- */
function route(){
  const lc = document.getElementById("lcard"); if(lc) lc.remove();
  if(document.body.dataset.page === "zameny"){ renderSubs(); return afterRender(); }
  const t = (location.hash.replace(/^#\/?/, "") || "rooms");
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.v === t));
  ({rooms: renderRooms, room: renderRoom, view: renderView, conflicts: renderConflicts}[t] || renderRooms)();
  afterRender();
}
/* после отрисовки: доступ с клавиатуры и подсказка, что широкую таблицу можно прокрутить */
function afterRender(){
  document.querySelectorAll("[data-act]:not(button):not(td):not(.lc-ov)").forEach(el => { el.tabIndex = 0; if(!el.getAttribute("role")) el.setAttribute("role", "button"); });
  document.querySelectorAll("#view .scroll").forEach(el => {
    let h = el.nextElementSibling;
    if(!h || !h.classList.contains("scrollhint")){ h = document.createElement("div"); h.className = "scrollhint"; h.textContent = "Таблица шире экрана — прокрутите вбок →"; el.after(h); }
    const upd = () => { h.hidden = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4; };
    el.onscroll = upd; upd();
  });
}
window.addEventListener("resize", () => afterRender());
function showCard(room, per){
  const evs = dayEvents(S.date), abs = new Set(absList(S.date).map(x => x.teacher));
  const hit = evs.filter(e => e.room === room && overlap(e.period, per));
  const wd = dayOf(S.date);
  const rows = hit.map(e => {
    const flags = [];
    if(cancelled(e, S.date)) flags.push("урок отменён");
    if(ABSC.has(e.class)) flags.push("класса нет");
    if(e.teacher && abs.has(e.teacher)) flags.push("учителя нет");
    if(isHR(e)) flags.push("классный час: учитель может перенести в другой кабинет");
    return `<div class="lc">
      <div class="lc-subj">${esc(e.subject || "Урок")}</div>
      <div class="lc-row"><span>Класс</span><b>${esc(e.class || "—")}${e.group ? " ("+esc(e.group)+")" : ""}</b></div>
      <div class="lc-row"><span>Учитель</span><b>${esc(e.teacher || "не указан")}</b></div>
      ${flags.length ? `<div class="lc-flags">${flags.map(f => `<i>${esc(f)}</i>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  const old = $("#lcard"); if(old) old.remove();
  const el = document.createElement("div");
  el.id = "lcard"; el.className = "lc-ov"; el.dataset.act = "closecard";
  el.innerHTML = `<div class="lc-box" role="dialog" aria-modal="true">
    <button class="lc-x" data-act="closecard" aria-label="Закрыть">×</button>
    <div class="lc-head">Кабинет ${esc(room)} · ${esc(P[per] ? plabel(P[per]) : per+" урок")}</div>
    <div class="lc-sub">${DN[wd] || ""} ${fmtD(S.date)}</div>
    ${rows || '<div class="lc"><div class="lc-subj">Свободен</div><div class="lc-sub">В это время в кабинете нет занятий.</div></div>'}
  </div>`;
  document.body.appendChild(el);
  const x = el.querySelector(".lc-x"); if(x) x.focus();
}
const ACT = {
  cell: v => { const i = v.lastIndexOf("|"); S.period = v.slice(i+1); savePer(S.period); const room = v.slice(0, i); route(); showCard(room, S.period); },
  goroom: v => { S.room = v; store.set("rasp.room", v); if(location.hash === "#/room") route(); else location.hash = "#/room"; },
  setD: v => { S.date = v; S.period = null; route(); },
  rcell: v => { const i = v.indexOf("|"); S.date = v.slice(0, i); S.period = v.slice(i+1); route(); showCard(S.room, S.period); },
  closecard: () => { const el = $("#lcard"); if(el) el.remove(); },
  tab: v => { location.hash = "#/"+v; },
  setP: v => { S.period = v; savePer(v); route(); },
  addabs: () => {
    const t = $("#fAdd").value; if(!t || absList(S.date).some(x => x.teacher === t)) return;
    (LABS[S.date] = LABS[S.date] || []).push({teacher:t, note:$("#fNote").value.trim() || null});
    store.set("rasp.abs", LABS); route();
  },
  addcls: () => {
    const note = $("#fNote").value.trim() || null;
    const c = normCls($("#fCls").value);
    const tEl = $("#fTch"), tv = tEl ? tEl.value.trim().toLowerCase() : "";
    if(!c && !tv){ $("#fCls").focus(); return; }
    let added = false;
    if(c){
      const known = (DATA.meta.classes || []).find(x => normCls(x) === c);
      if(!known){ const f = $("#fCls"); f.style.outline = "2px solid #c00"; f.placeholder = "нет такого класса"; f.value = ""; f.focus(); return; }
      if(!absClasses(S.date).some(x => x.class === known)) (LABS[S.date] = LABS[S.date] || []).push({class:known, note});
      added = true;
    }
    if(tv){
      const all = DATA.meta.teachers || [];
      const hit = all.filter(x => x.toLowerCase() === tv);
      const part = hit.length ? hit : all.filter(x => x.toLowerCase().startsWith(tv));
      if(part.length !== 1){ tEl.style.outline = "2px solid #c00"; tEl.focus(); tEl.placeholder = part.length ? "уточните: "+part.length+" совпадения" : "нет такого учителя"; tEl.value = ""; if(!added) return; }
      else { if(!absList(S.date).some(x => x.teacher === part[0])) (LABS[S.date] = LABS[S.date] || []).push({teacher:part[0], note}); added = true; }
    }
    if(added){ store.set("rasp.abs", LABS); route(); }
  },
  rmcls: v => { LABS[S.date] = (LABS[S.date]||[]).filter(x => x.class !== v); store.set("rasp.abs", LABS); route(); },
  clrcls: () => { LABS[S.date] = []; store.set("rasp.abs", LABS); route(); },
  rmabs: v => { LABS[S.date] = (LABS[S.date]||[]).filter(x => x.class || x.teacher !== v); store.set("rasp.abs", LABS); route(); },
  copysum: () => copy(subsSummary()),
  copyabs: () => { const o = {}; o[S.date] = absList(S.date).map(x => ({teacher:x.teacher, note:x.note||null})); copy(JSON.stringify(o, null, 2)); }
};
function copy(txt){
  const done = ok => { const el = $("#copied"); if(el) el.textContent = ok ? "скопировано" : "не удалось скопировать"; };
  try{ navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); }catch(e){ done(false); }
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("[data-act]");
  if(t && t.dataset.act === "closecard" && t.classList.contains("lc-ov") && ev.target !== t) return; // клик внутри карточки не закрывает
  if(t && ACT[t.dataset.act]) ACT[t.dataset.act](t.dataset.v);
});
document.addEventListener("keydown", ev => {
  if(ev.key === "Escape" && $("#lcard")){ ACT.closecard(); return; }
  if((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches("[data-act][role=button]")){ ev.preventDefault(); ev.target.click(); }
});
document.addEventListener("change", ev => {
  const t = ev.target, id = t.id;
  if(id === "fDate" && t.value){ S.date = t.value; S.period = null; }
  else if(id === "fPer"){ S.period = t.value; savePer(t.value); }
  else if(id === "fFloor") S.floor = t.value;
  else if(id === "fType") S.type = t.value;
  else if(id === "fKind"){ S.kind = t.value; S.name = ""; }
  else if(id === "fName") S.name = t.value;
  else if(id === "fCf") S.cf = t.value;
  else if(id === "fHr") S.hrHide = t.value;
  else if(id === "fRoom"){ S.room = t.value; store.set("rasp.room", t.value); }
  else if(t.dataset.chg === "plan"){ if(t.value) PLAN[t.dataset.key] = t.value; else delete PLAN[t.dataset.key]; store.set("rasp.plan", PLAN); }
  else return;
  setTimeout(route, 0);
});

async function boot(){
  try{
    const j = (u, soft) => fetch(u, {cache: "no-cache"}).then(r => { if(!r.ok) throw new Error(u+": "+r.status); return r.json(); }).catch(e => { if(soft) return {}; throw e; });
    const r = await Promise.all([j("data/timetable.json"), j("data/absences.json", true), j("data/config.json", true)]);
    DATA = r[0]; FABS = r[1]; CFG = r[2];
    PER = DATA.meta.periods; PER.forEach(p => { P[p.id] = p; });
    DATA.events.forEach(e => { if(e.teacher){ (SUBJ[e.teacher] = SUBJ[e.teacher] || new Set()).add(e.subject); } });
    const d = new Date(DATA.fetched_at), age = (Date.now()-d)/864e5, lim = CFG.staleAfterDays || 45;
    const st = $("#stamp"); st.textContent = (DATA.school&&DATA.school.name ? DATA.school.name+" · " : "")+(DATA.source&&DATA.source.week ? "неделя "+DATA.source.week+" · " : "")+"выгрузка от "+d.toLocaleDateString("ru-RU")+(age>lim&&!DATA.demo ? " — "+Math.floor(age)+" дн. назад, проверьте, не сменилось ли расписание" : "");
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
   а чтобы случайный посетитель не открыл страницу. В данных есть ФИО учителей (решение 2026-10-19), данных об учениках нет. */
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
