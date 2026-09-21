/* Past Paper Lab — client app. Content (questions, images) loads only after sign-in.
   Storage back ends: Supabase (production) or localStorage (demo mode, when config has no SUPABASE_URL). */
(() => {
const CFG = window.QB_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL;
const sb = DEMO ? null : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COURSES = [
  { id: "PHYSL", label: "Physics SL", sub: "Physics" }, { id: "PHYHL", label: "Physics HL", sub: "Physics" },
  { id: "AASL", label: "Maths AA SL", sub: "Analysis & Approaches" }, { id: "AAHL", label: "Maths AA HL", sub: "Analysis & Approaches" },
  { id: "AISL", label: "Maths AI SL", sub: "Applications & Interpretation" }, { id: "AIHL", label: "Maths AI HL", sub: "Applications & Interpretation" }];
const S = { user: null, course: null, view: "home", data: null, attempts: [], filters: {}, sessionId: Math.random().toString(36).slice(2) + Date.now().toString(36) };
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const sessOrder = s => { const m = /^([MN])(\d\d)$/.exec(s || ""); return m ? +m[2] * 10 + (m[1] === "N" ? 5 : 0) : 0 };
const sessLabel = s => (s[0] === "M" ? "May" : "Nov") + " 20" + s.slice(1);
const fmtTime = s => { const a = Math.abs(Math.round(s)); return (s < 0 ? "−" : "") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0") };
const fmtDur = s => s >= 3600 ? (s / 3600).toFixed(1) + " h" : Math.round(s / 60) + " min";
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200) }

/* ---------------- analytics (own events table, batched) ---------------- */
const evq = [];
function track(name, props = {}) { evq.push({ session_id: S.sessionId, name, props: { course: S.course, view: S.view, ...props }, ts: new Date().toISOString() }); if (evq.length >= 20) flush() }
async function flush() {
  if (!evq.length || !S.user) return; const batch = evq.splice(0, evq.length);
  if (DEMO) { const all = ls.get("qb_events", []); ls.set("qb_events", all.concat(batch).slice(-2000)); return }
  try { const { error } = await sb.from("events").insert(batch.map(e => ({ ...e, user_id: S.user.id }))); if (error) throw error } catch (e) { console.warn("events", e.message) }
}
setInterval(flush, 15000); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush() });

/* ---------------- data + storage ---------------- */
const urlCache = new Map();
async function imageUrls(paths) {
  paths = [...new Set(paths.filter(Boolean))]; const need = paths.filter(p => !urlCache.has(p));
  if (need.length) {
    if (DEMO) need.forEach(p => urlCache.set(p, CFG.DEMO_BASE + p.split("/").map(encodeURIComponent).join("/")));
    else for (let i = 0; i < need.length; i += 80) {
      const { data, error } = await sb.storage.from(CFG.BUCKET).createSignedUrls(need.slice(i, i + 80), 7200);
      if (error) { console.warn(error.message); break } data.forEach(d => d.signedUrl && urlCache.set(d.path, d.signedUrl));
    }
  }
  return paths.map(p => urlCache.get(p));
}
async function loadCourse(id) {
  if (DEMO) { const r = await fetch(CFG.DEMO_BASE + "app_data/" + id + ".json"); if (!r.ok) throw new Error("Course data not found"); return r.json() }
  const { data, error } = await sb.storage.from(CFG.BUCKET).download("data/" + id + ".json"); if (error) throw error; return JSON.parse(await data.text());
}
async function loadAttempts() {
  if (DEMO) return ls.get("qb_attempts", []);
  const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from("attempts").select("*").order("created_at").range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break } return out;
}
async function saveAttempt(a) {
  const row = { question_id: a.question_id, course: S.course, status: a.status || "completed", chosen: a.chosen ?? null, correct: a.correct ?? null, self_marks: a.self_marks ?? null, max_marks: a.max_marks, seconds: Math.max(0, Math.min(7200, Math.round(a.seconds || 0))), created_at: new Date().toISOString() };
  S.attempts.push(row);
  if (DEMO) ls.set("qb_attempts", S.attempts); else { const { error } = await sb.from("attempts").insert({ ...row, user_id: S.user.id }); if (error) { toast("Could not save: " + error.message) } }
  track("attempt", { q: row.question_id, correct: row.correct, self_marks: row.self_marks, seconds: row.seconds });
}
function progress() { // latest state per question
  const m = new Map(); for (const a of S.attempts) if (a.status === "completed") m.set(a.question_id, a); return m;
}

/* ---------------- auth ---------------- */
let signup = false;
function showAuth() { $("auth").hidden = false; $("shell").hidden = true }
$("au-toggle").onclick = e => { e.preventDefault(); signup = !signup; $("au-name-l").hidden = !signup; $("au-submit").textContent = signup ? "Create account" : "Sign in"; $("au-toggle").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account"; $("au-pass").autocomplete = signup ? "new-password" : "current-password" };
$("au-privacy").onclick = e => { e.preventDefault(); info(`<h3>What we store</h3><p>Your email and display name (to sign you in), the questions you complete with your answers, self-awarded marks and time, and usage events such as which screens and filters you use. We use this only to show your progress and to improve the app. No advertising, no third-party trackers. You can delete your progress or ask for your account to be removed at any time from the Account screen.</p>`) };
$("authform").onsubmit = async e => {
  e.preventDefault(); $("au-err").textContent = ""; const email = $("au-email").value.trim(), password = $("au-pass").value, name = $("au-name").value.trim();
  if (DEMO) { S.user = { id: "demo", email, name: name || email.split("@")[0] }; ls.set("qb_demo_user", S.user); return boot() }
  $("au-submit").disabled = true;
  try {
    const res = signup ? await sb.auth.signUp({ email, password, options: { data: { display_name: name } } }) : await sb.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error; if (!res.data.session) throw new Error("Check your inbox to confirm your email, then sign in.");
  } catch (err) { $("au-err").textContent = err.message } finally { $("au-submit").disabled = false }
};
async function boot() {
  if (DEMO) { S.user = S.user || ls.get("qb_demo_user", null) } else { const { data } = await sb.auth.getSession(); const u = data.session?.user; S.user = u ? { id: u.id, email: u.email, name: u.user_metadata?.display_name || u.email.split("@")[0] } : null }
  if (!S.user) return showAuth();
  $("auth").hidden = true; $("shell").hidden = false;
  S.course = ls.get("qb_course", null); track("session_start", { ua: navigator.userAgent.slice(0, 120), w: innerWidth, h: innerHeight, demo: DEMO });
  try { S.attempts = await loadAttempts() } catch (e) { toast("Could not load your progress") }
  if (!S.course) openCourses(); else await setCourse(S.course);
}
if (!DEMO) sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" && !S.user) boot(); if (ev === "SIGNED_OUT") { S.user = null; showAuth() } });

/* ---------------- course + navigation ---------------- */
function openCourses() {
  $("tiles").innerHTML = COURSES.map(c => `<button class="tile${c.id === S.course ? " on" : ""}" data-c="${c.id}"><b>${c.label}</b><span class="muted small">${c.sub}</span></button>`).join("");
  $("coursedlg").showModal();
}
$("coursebtn").onclick = openCourses; $("courseclose").onclick = () => $("coursedlg").close();
$("tiles").onclick = async e => { const t = e.target.closest(".tile"); if (!t) return; $("coursedlg").close(); await setCourse(t.dataset.c) };
async function setCourse(id) {
  S.course = id; ls.set("qb_course", id); $("courselbl").textContent = COURSES.find(c => c.id === id).label; $("view").innerHTML = `<div class="empty">Loading ${esc($("courselbl").textContent)}…</div>`;
  try { S.data = await loadCourse(id) } catch (e) { $("view").innerHTML = `<div class="panel empty">This course is not available yet. <button class="btn" onclick="document.getElementById('coursebtn').click()">Choose another</button></div>`; return }
  const D = S.data; D.byId = new Map(D.questions.map(q => [q.id, q])); D.subName = new Map(D.syllabus.map(s => [s.code, s.name]));
  D.questions.forEach(q => { q._p = norm([q.codes[0], D.subName.get(q.codes[0])].join(" ")); q._k = norm([q.codes.join(" "), q.codes.map(c => D.subName.get(c)).join(" "), (q.kw || []).join(" ")].join(" ")); q._t = norm(q.txt) });
  S.filters = {}; track("course_open"); go(S.view === "account" ? "home" : S.view);
}
$("nav").onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.v) };
function go(v) { S.view = v; document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); track("view"); ({ home: vHome, practice: vPractice, syllabus: vSyllabus, insights: vInsights, account: vAccount }[v])(); scrollTo(0, 0) }
const norm = s => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
function info(html) { $("infobody").innerHTML = html; $("infodlg").showModal() } $("infoclose").onclick = () => $("infodlg").close();

/* ---------------- timer ---------------- */
const T = { target: 0, left: 0, run: false, h: null };
function drawT() { $("tval").textContent = fmtTime(T.left); $("timer").classList.toggle("over", T.left < 0); $("tgo").textContent = T.run ? "❚❚" : "▶" }
function toggleT() { if (T.run) { clearInterval(T.h); T.run = false } else { T.run = true; T.h = setInterval(() => { T.left -= 1; drawT() }, 1000) } drawT() }
function startT(min, lbl) { T.target = Math.round(min * 60); T.left = T.target; $("tlbl").textContent = lbl; if (!T.run) toggleT(); drawT(); track("timer_start", { lbl, min }) }
$("tgo").onclick = toggleT; $("trs").onclick = () => { if (T.run) toggleT(); T.left = T.target; drawT() };

/* ---------------- shared helpers ---------------- */
function mine() { const P = progress(), ids = new Set(S.data.questions.map(q => q.id)); return [...P.values()].filter(a => ids.has(a.question_id)) }
function subStats() { // per subtopic: total questions (main topic), done
  const P = progress(), m = new Map();
  for (const q of S.data.questions) { const c = q.codes[0]; if (!c) continue; const o = m.get(c) || { n: 0, done: 0, marks: 0, sec: 0 }; o.n++; o.marks += q.m; if (P.has(q.id)) o.done++; m.set(c, o) } return m;
}
function streak() { const days = new Set(S.attempts.map(a => (a.created_at || "").slice(0, 10))); let n = 0; const d = new Date(); if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1) } return n }
function isHL(code) { const s = S.data.syllabus.find(x => x.code === code); return s && /^AHL/.test(s.level || s.code) }

/* ---------------- HOME ---------------- */
function vHome() {
  const D = S.data, a = mine(), mcq = a.filter(x => x.correct !== null), ok = mcq.filter(x => x.correct).length, sec = a.reduce((t, x) => t + (x.seconds || 0), 0), st = subStats();
  const structured = a.filter(x => x.self_marks !== null), sm = structured.reduce((t, x) => t + x.self_marks, 0), mm = structured.reduce((t, x) => t + (x.max_marks || 0), 0);
  const missed = a.filter(x => x.correct === false || (x.self_marks !== null && x.max_marks && x.self_marks / x.max_marks < .5)).length;
  $("view").innerHTML = `
  <section class="panel hero"><div><p class="muted small" style="margin:0">${esc(D.label)} · ${D.questions.length} questions from ${new Set(D.questions.map(q => q.pid)).size} papers</p>
    <h1>${a.length ? `Welcome back, ${esc(S.user.name)}.` : `Hi ${esc(S.user.name)}, ready for your first question?`}</h1>
    <p class="muted" style="margin:0 0 14px">Pick a topic from the map below, or jump straight in. Multiple-choice answers are checked instantly; for written questions you reveal the markscheme and award yourself marks.</p>
    <div class="cta"><button class="btn primary" id="h-go">${a.length ? "Continue practising" : "Start practising"}</button>${missed ? `<button class="btn" id="h-missed">Redo what I missed (${missed})</button>` : ""}<button class="btn ghost" id="h-rand">Surprise me</button></div></div>
    <div class="kpis"><div class="kpi"><div class="big-num">${a.length}</div><div class="lbl">Questions done</div></div><div class="kpi"><div class="big-num">${fmtDur(sec)}</div><div class="lbl">Time practised</div></div>
    <div class="kpi"><div class="big-num">${mcq.length ? Math.round(100 * ok / mcq.length) + "%" : "—"}</div><div class="lbl">Multiple choice</div></div><div class="kpi"><div class="big-num">${mm ? Math.round(100 * sm / mm) + "%" : "—"}</div><div class="lbl">Written (self-marked)</div></div>
    <div class="kpi"><div class="big-num">${streak()}</div><div class="lbl">Day streak</div></div></div></section>
  <section class="panel"><h2>Your mastery map</h2><p class="muted small">Share of questions completed in each part of the syllabus. Tap a row to practise it.</p><div class="units">${unitsHtml(st)}</div></section>`;
  $("h-go").onclick = () => { S.filters = { hideDone: true }; go("practice") }; $("h-rand").onclick = () => { S.filters = { hideDone: true }; go("practice"); setTimeout(() => $("p-focus").click(), 50) };
  if ($("h-missed")) $("h-missed").onclick = () => { S.filters = { missed: true }; go("practice") };
  bindRows();
}
function unitsHtml(st, showCounts) {
  const D = S.data; return D.topics.map(t => { const rows = D.syllabus.filter(s => s.topic === t.id && (st.get(s.code) || showCounts)); if (!rows.length) return ""; const n = rows.reduce((x, s) => x + (st.get(s.code)?.n || 0), 0), d = rows.reduce((x, s) => x + (st.get(s.code)?.done || 0), 0);
    return `<div class="unit"><h3>${esc(t.id)} · ${esc(t.name)} <span>${d}/${n} done</span></h3>${rows.map(s => { const o = st.get(s.code) || { n: 0, done: 0 }; const pct = o.n ? 100 * o.done / o.n : 0; return `<button class="subrow${/AHL/.test(s.level || s.code) && !/SL/.test(s.level || "") ? " hl" : ""}${t.id === "X" ? " x" : ""}" data-code="${esc(s.code)}"><span class="code">${esc(s.code)}</span><span>${esc(s.name)}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="n">${o.done}/${o.n}</span></button>` }).join("")}</div>` }).join("");
}
function bindRows() { document.querySelectorAll(".subrow").forEach(r => r.onclick = () => { S.filters = { sub: r.dataset.code }; go("practice") }) }

/* ---------------- PRACTICE ---------------- */
let results = [], firstSeen = new Map(), io = null;
function vPractice() {
  const D = S.data, f = S.filters, sess = [...new Set(D.questions.map(q => q.s))].sort((a, b) => sessOrder(a) - sessOrder(b)), papers = [...new Set(D.questions.map(q => q.p))].sort();
  const opt = (arr, sel, all) => `<option value="">${all}</option>` + arr.map(([v, l]) => `<option value="${esc(v)}"${String(sel ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("");
  $("view").innerHTML = `<div class="layout" id="lay"><aside class="panel filters">
    <label for="f-q">Search<input id="f-q" type="search" placeholder="topic, phrase, code…" value="${esc(f.q || "")}"></label>
    <label for="f-topic">Unit<select id="f-topic">${opt(D.topics.map(t => [t.id, t.id + " · " + t.name]), f.topic, "All units")}</select></label>
    <label for="f-sub">Subtopic<select id="f-sub"></select></label>
    <div class="row2"><label for="f-type">Type<select id="f-type">${opt([["mcq", "Multiple choice"], ["structured", "Written"]], f.type, "Any")}</select></label><label for="f-paper">Paper<select id="f-paper">${opt(papers.map(p => [p, "Paper " + p]), f.paper, "Any")}</select></label></div>
    <div class="row2"><label for="f-from">From<select id="f-from">${opt(sess.map(s => [s, sessLabel(s)]), f.from, "Earliest")}</select></label><label for="f-to">To<select id="f-to">${opt(sess.map(s => [s, sessLabel(s)]), f.to, "Latest")}</select></label></div>
    <div class="row2"><label for="f-diff">Difficulty<select id="f-diff">${opt([[1, "1 · routine"], [2, "2 · standard"], [3, "3 · demanding"]], f.diff, "Any")}</select></label><label for="f-sort">Sort<select id="f-sort">${opt([["new", "Newest"], ["old", "Oldest"], ["marks", "Most marks"], ["easy", "Easiest first"]], f.sort, "Best match")}</select></label></div>
    <label class="chk"><input type="checkbox" id="f-main" ${f.main ? "checked" : ""}> Main topic only</label>
    <label class="chk"><input type="checkbox" id="f-hide" ${f.hideDone ? "checked" : ""}> Hide completed</label>
    <label class="chk"><input type="checkbox" id="f-missed" ${f.missed ? "checked" : ""}> Only ones I missed</label>
    ${D.hasLegacy ? `<label class="chk"><input type="checkbox" id="f-cur" ${f.cur !== false ? "checked" : ""}> Hide content not in the current syllabus</label>` : ""}
    <button class="btn" id="f-reset">Reset filters</button></aside>
    <section style="display:grid;gap:12px"><div class="resultbar"><span id="p-count"></span><span class="sp"><button class="btn primary" id="p-focus">Focus mode</button><button class="btn" id="p-hide">Hide filters</button></span></div><div id="p-list" style="display:grid;gap:12px"></div><button class="btn" id="p-more" hidden>Show more</button></section></div>`;
  fillSub(); const ids = ["f-q", "f-topic", "f-sub", "f-type", "f-paper", "f-from", "f-to", "f-diff", "f-sort", "f-main", "f-hide", "f-missed", "f-cur"];
  ids.forEach(id => $(id) && $(id).addEventListener("input", () => { readFilters(); if (id === "f-topic") fillSub(); runSearch(true) }));
  $("f-reset").onclick = () => { S.filters = {}; vPractice() }; $("p-hide").onclick = () => { const on = $("lay").classList.toggle("nofilters"); $("p-hide").textContent = on ? "Show filters" : "Hide filters" };
  $("p-focus").onclick = () => openFocus(0); $("p-more").onclick = () => { shown += 20; renderList() };
  runSearch(false);
}
function fillSub() { const D = S.data, t = $("f-topic").value; $("f-sub").innerHTML = `<option value="">All subtopics</option>` + D.syllabus.filter(s => !t || s.topic == t).map(s => `<option value="${esc(s.code)}"${S.filters.sub === s.code ? " selected" : ""}>${esc(s.code + " · " + s.name)}</option>`).join("") }
function readFilters() { const v = id => $(id)?.value || "", c = id => !!$(id)?.checked; S.filters = { q: v("f-q"), topic: v("f-topic"), sub: v("f-sub"), type: v("f-type"), paper: v("f-paper"), from: v("f-from"), to: v("f-to"), diff: v("f-diff"), sort: v("f-sort"), main: c("f-main"), hideDone: c("f-hide"), missed: c("f-missed"), cur: $("f-cur") ? c("f-cur") : undefined } }
const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "and", "for", "with", "by", "is"]);
let shown = 20, searchT = null;
function runSearch(log) {
  const D = S.data, f = S.filters, P = progress(), terms = norm(f.q).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
  const codesOf = q => f.main ? q.codes.slice(0, 1) : q.codes, topicOf = c => (D.syllabus.find(s => s.code === c) || {}).topic;
  let r = D.questions.filter(q => (!f.topic || codesOf(q).some(c => topicOf(c) == f.topic)) && (!f.sub || codesOf(q).includes(f.sub)) && (!f.type || q.t === f.type) && (!f.paper || q.p == f.paper)
    && (!f.from || sessOrder(q.s) >= sessOrder(f.from)) && (!f.to || sessOrder(q.s) <= sessOrder(f.to)) && (!f.diff || q.d == f.diff) && (!f.hideDone || !P.has(q.id))
    && (!(D.hasLegacy && f.cur !== false) || f.sub || !(q.codes[0] || "").startsWith("X"))
    && (!f.missed || (P.has(q.id) && (P.get(q.id).correct === false || (P.get(q.id).self_marks !== null && P.get(q.id).self_marks / (P.get(q.id).max_marks || 1) < .5)))));
  if (terms.length) { r = r.map(q => { let s = 0; for (const t of terms) { if (q._p.includes(t)) s += 6; else if (q._k.includes(t)) s += 3; else if (q._t.includes(t) || q.id.toLowerCase().includes(t)) s += 1; else return null } return [q, s] }).filter(Boolean).sort((a, b) => b[1] - a[1] || sessOrder(b[0].s) - sessOrder(a[0].s)).map(x => x[0]) }
  const by = (a, b) => sessOrder(b.s) - sessOrder(a.s) || String(a.p).localeCompare(String(b.p)) || a.q - b.q;
  if (f.sort === "new" || (!f.sort && !terms.length)) r.sort(by); else if (f.sort === "old") r.sort((a, b) => -by(a, b)); else if (f.sort === "marks") r.sort((a, b) => b.m - a.m); else if (f.sort === "easy") r.sort((a, b) => (a.d || 2) - (b.d || 2) || a.m - b.m);
  results = r; shown = 20; renderList();
  if (log) { clearTimeout(searchT); searchT = setTimeout(() => track("search", { ...f, n: r.length }), 1200) }
}
async function renderList() {
  const P = progress(), page = results.slice(0, shown);
  $("p-count").textContent = `${results.length} question${results.length === 1 ? "" : "s"} · ${results.reduce((t, q) => t + q.m, 0)} marks · about ${fmtDur(results.reduce((t, q) => t + q.min * 60, 0))}`;
  $("p-list").innerHTML = page.length ? page.map(q => cardHtml(q, P.get(q.id))).join("") : `<div class="panel empty">Nothing matches these filters.</div>`; $("p-more").hidden = results.length <= shown;
  const urls = await imageUrls(page.map(q => q.img)); page.forEach((q, i) => { const im = document.querySelector(`[data-qimg="${CSS.escape(q.id)}"]`); if (im && urls[i]) im.src = urls[i] });
  if (io) io.disconnect(); io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !firstSeen.has(e.target.dataset.id)) firstSeen.set(e.target.dataset.id, Date.now()) }), { threshold: .5 }); document.querySelectorAll(".q").forEach(el => io.observe(el));
}
function chips(q) { const D = S.data; return q.codes.map((c, i) => `<span class="badge${i === 0 ? " t" : ""}${isHL(c) ? " hl" : ""}" title="${esc(c)}">${esc((D.subName.get(c) || c).split(/[:;(]/)[0].slice(0, i ? 28 : 46))} <span class="mono">${esc(c)}</span></span>`).join("") + (q.kw || []).map(k => `<span class="badge">${esc(k)}</span>`).join("") }
function cardHtml(q, att) {
  const dots = q.d ? `<span class="dots" title="difficulty ${q.d} of 3">${[1, 2, 3].map(i => `<i class="${i <= q.d ? "on" : ""}"></i>`).join("")}</span>` : "";
  const state = att ? (att.correct === true ? `<span class="badge ok">✓ correct</span>` : att.correct === false ? `<span class="badge no">✗ answered ${esc(att.chosen)}</span>` : `<span class="badge ok">✓ done · ${att.self_marks ?? "–"}/${q.m}</span>`) : "";
  return `<article class="q${att ? " done" : ""}" data-id="${esc(q.id)}"><div class="qhead"><span class="qtitle">${esc(sessLabel(q.s))} · Paper ${esc(q.p)}${q.tz && q.tz !== "0" ? " TZ" + esc(q.tz) : ""} · Q${q.q}</span><span class="badge marks">${q.m} mark${q.m === 1 ? "" : "s"}</span><span class="badge">≈ ${Math.max(1, Math.round(q.min))} min</span>${dots}${state}</div>
  <div class="qhead">${chips(q)}</div><div class="qimg"><img data-qimg="${esc(q.id)}" alt="Question ${q.q}" loading="lazy"></div>
  <div class="qact">${q.t === "mcq" ? `<div class="mcq" role="group" aria-label="Your answer">${["A", "B", "C", "D"].map(l => `<button data-l="${l}" class="${att && q.ans === l ? "right" : att && att.chosen === l ? "wrong" : ""}">${l}</button>`).join("")}</div>` : `<button class="btn" data-act="ms">${q.ms ? "Show markscheme" : "No markscheme"}</button>`}
  <button class="btn ghost" data-act="timer">⏱ ${Math.max(1, Math.round(q.min))} min</button><button class="btn ghost" data-act="focus">Open in focus</button></div><div class="msbox"></div></article>`;
}
document.addEventListener("click", async e => {
  const card = e.target.closest(".q"); if (!card || e.target.closest("dialog.focus")) return; const q = S.data.byId.get(card.dataset.id); if (!q) return;
  if (e.target.dataset.l) return answerMcq(q, e.target.dataset.l, card, (Date.now() - (firstSeen.get(q.id) || Date.now())) / 1000);
  const act = e.target.dataset.act; if (act === "timer") startT(q.min, `${sessLabel(q.s)} P${q.p} Q${q.q}`); if (act === "focus") openFocus(results.indexOf(q)); if (act === "ms") showMs(q, card.querySelector(".msbox"), (Date.now() - (firstSeen.get(q.id) || Date.now())) / 1000);
});
async function answerMcq(q, l, scope, seconds) {
  if (progress().has(q.id) && scope.dataset.locked) return; scope.dataset.locked = 1; const correct = q.ans ? l === q.ans : null;
  scope.querySelectorAll(".mcq button").forEach(b => { b.classList.toggle("right", b.dataset.l === q.ans); b.classList.toggle("wrong", b.dataset.l === l && l !== q.ans) });
  await saveAttempt({ question_id: q.id, chosen: l, correct, max_marks: 1, seconds: Math.min(seconds, 1200) }); toast(correct ? "Correct" : q.ans ? `Not quite. The answer is ${q.ans}` : "Saved"); scope.classList.add("done");
}
async function showMs(q, box, seconds) {
  if (!q.ms) return; if (box.innerHTML) { box.innerHTML = ""; return } track("ms_reveal", { q: q.id });
  const [u] = await imageUrls([q.ms]); box.innerHTML = `<div class="qimg ms"><img src="${u}" alt="Markscheme"></div><div class="selfmark" style="margin-top:10px"><label for="sm-${esc(q.id)}" style="display:contents"><span>Marks you would award yourself</span><input id="sm-${esc(q.id)}" type="range" min="0" max="${q.m}" value="${Math.round(q.m / 2)}" step="1"></label><b class="mono"><span class="smv">${Math.round(q.m / 2)}</span>/${q.m}</b><button class="btn good" data-done="1">Mark as complete</button></div>`;
  const rng = box.querySelector("input"); rng.oninput = () => box.querySelector(".smv").textContent = rng.value;
  box.querySelector("[data-done]").onclick = async () => { await saveAttempt({ question_id: q.id, self_marks: +rng.value, max_marks: q.m, seconds: box._sec ? box._sec() : Math.min(seconds, 3600) }); toast("Saved to your progress"); box.closest(".q,.fbody")?.classList.add("done"); if (box._after) box._after() };
}

/* ---------------- FOCUS MODE ---------------- */
let fi = 0, ft = null, fstart = 0;
async function openFocus(i) {
  if (!results.length) return toast("No questions to show"); fi = Math.max(0, i); const dlg = $("focus"); if (!dlg.open) dlg.showModal(); track("focus_open"); drawFocus();
}
async function drawFocus() {
  const q = results[fi], dlg = $("focus"), att = progress().get(q.id); fstart = Date.now(); clearInterval(ft);
  dlg.innerHTML = `<div class="fbar"><b>${esc(sessLabel(q.s))} · P${esc(q.p)}${q.tz && q.tz !== "0" ? " TZ" + esc(q.tz) : ""} · Q${q.q}</b><span class="badge marks">${q.m} marks</span><span class="muted small">${fi + 1} / ${results.length}</span><span class="ftime" id="ftime">00:00</span><span class="muted small">of ${Math.max(1, Math.round(q.min))} min</span></div>
  <div class="fbody q${att ? " done" : ""}" data-id="${esc(q.id)}"><div class="qhead">${chips(q)}</div><div class="qimg"><img id="fimg" alt="Question"></div>
  <div class="qact">${q.t === "mcq" ? `<div class="mcq">${["A", "B", "C", "D"].map(l => `<button data-l="${l}">${l}</button>`).join("")}</div>` : `<button class="btn primary" id="fms">${q.ms ? "I'm done — show markscheme" : "No markscheme"}</button>`}<span style="margin-left:auto;display:flex;gap:8px"><button class="btn" id="fprev">← Previous</button><button class="btn" id="fnext">Skip →</button><button class="btn ghost" id="fclose">Close</button></span></div><div class="msbox" id="fbox"></div></div>`;
  const [u] = await imageUrls([q.img]); $("fimg").src = u; imageUrls(results.slice(fi + 1, fi + 3).flatMap(x => [x.img]));
  const secs = () => (Date.now() - fstart) / 1000; ft = setInterval(() => { const el = $("ftime"); if (!el) return clearInterval(ft); const s = secs(); el.textContent = fmtTime(s); el.classList.toggle("over", s > q.min * 60) }, 1000);
  const next = () => { if (fi < results.length - 1) { fi++; drawFocus() } else { toast("End of this set"); closeFocus() } };
  dlg.querySelectorAll(".mcq button").forEach(b => b.onclick = async () => { clearInterval(ft); await answerMcq(q, b.dataset.l, dlg.querySelector(".fbody"), secs()); $("fnext").textContent = "Next →" });
  if ($("fms")) $("fms").onclick = () => { clearInterval(ft); const box = $("fbox"); const frozen = secs(); box._sec = () => frozen; box._after = () => { $("fnext").textContent = "Next →" }; showMs(q, box, frozen) };
  $("fnext").onclick = () => { if (!progress().has(q.id)) track("skip", { q: q.id, seconds: Math.round(secs()) }); next() }; $("fprev").onclick = () => { if (fi > 0) { fi--; drawFocus() } }; $("fclose").onclick = closeFocus;
}
function closeFocus() { clearInterval(ft); $("focus").close(); if (S.view === "practice") runSearch(false); else go(S.view) }
$("focus").addEventListener("cancel", () => { clearInterval(ft); setTimeout(() => S.view === "practice" && runSearch(false), 0) });

/* ---------------- SYLLABUS ---------------- */
function vSyllabus() {
  const st = subStats(), D = S.data; const sec = new Map(); for (const q of D.questions) q.codes.slice(1).forEach(c => sec.set(c, (sec.get(c) || 0) + 1));
  $("view").innerHTML = `<section class="panel"><h2>Full syllabus · ${esc(D.label)}</h2><p class="muted small">Every subtopic with the number of past-paper questions where it is the main topic, and how many you have completed. Amber codes are HL-only content.${D.hasLegacy ? " Group X collects old-syllabus content that is no longer examined." : ""}</p><div class="units">${unitsHtml(st, true)}</div></section>`; bindRows();
}

/* ---------------- INSIGHTS ---------------- */
function vInsights() {
  const D = S.data, main = new Map(), sec = new Map(), marks = new Map(); let tot = 0;
  for (const q of D.questions) { q.codes.forEach((c, i) => (i ? sec : main).set(c, ((i ? sec : main).get(c) || 0) + 1)); const t = (D.syllabus.find(s => s.code === q.codes[0]) || {}).topic; if (t && t !== "X") { marks.set(t, (marks.get(t) || 0) + q.m); tot += q.m } }
  const rows = D.syllabus.map(s => ({ s, a: main.get(s.code) || 0, b: sec.get(s.code) || 0 })).filter(r => r.a + r.b > 0).sort((x, y) => (y.a + y.b) - (x.a + x.b)), mx = Math.max(1, ...rows.map(r => r.a + r.b));
  const a = mine(), byTopic = new Map(); for (const x of a) { const q = D.byId.get(x.question_id), t = q && (D.syllabus.find(s => s.code === q.codes[0]) || {}).topic; if (!t) continue; const o = byTopic.get(t) || { n: 0, got: 0, max: 0, sec: 0 }; o.n++; o.sec += x.seconds || 0; if (x.correct !== null) { o.got += x.correct ? 1 : 0; o.max += 1 } else if (x.self_marks !== null) { o.got += x.self_marks; o.max += x.max_marks || 0 } byTopic.set(t, o) }
  $("view").innerHTML = `<section class="panel"><h2>What the exam asks most</h2><p class="muted small">Number of questions per subtopic across all papers in the bank. Dark = main topic, light = also involved.</p><div class="legend" style="margin:8px 0"><span style="--c:var(--accent)">main topic</span><span style="--c:color-mix(in srgb,var(--accent) 35%,var(--surface2))">secondary</span></div>
   ${rows.slice(0, 40).map(r => `<div class="hbar"><span title="${esc(r.s.name)}"><span class="mono">${esc(r.s.code)}</span> ${esc(r.s.name.split(/[:;(]/)[0].slice(0, 34))}</span><span class="track"><i style="width:${100 * r.a / mx}%" title="main: ${r.a}"></i><i class="s" style="width:${100 * r.b / mx}%" title="secondary: ${r.b}"></i></span><span class="v">${r.a + r.b}</span></div>`).join("")}</section>
  <section class="panel"><h2>Where the marks go</h2><p class="muted small">Share of all marks by unit (main topic).</p>${D.topics.filter(t => marks.get(t.id)).map(t => `<div class="hbar"><span>${esc(t.id)} · ${esc(t.name)}</span><span class="track"><i style="width:${100 * marks.get(t.id) / tot}%"></i></span><span class="v">${Math.round(100 * marks.get(t.id) / tot)}%</span></div>`).join("")}</section>
  <section class="panel"><h2>Your results by unit</h2>${byTopic.size ? `<div class="tw"><table><thead><tr><th>Unit</th><th>Done</th><th>Score</th><th>Avg time / question</th></tr></thead><tbody>${D.topics.filter(t => byTopic.get(t.id)).map(t => { const o = byTopic.get(t.id); return `<tr><td>${esc(t.id)} · ${esc(t.name)}</td><td class="mono">${o.n}</td><td class="mono">${o.max ? Math.round(100 * o.got / o.max) + "%" : "—"}</td><td class="mono">${fmtTime(o.sec / o.n)}</td></tr>` }).join("")}</tbody></table></div>` : `<p class="empty">Complete a few questions and your scores per unit will appear here.</p>`}</section>`;
}

/* ---------------- ACCOUNT ---------------- */
function vAccount() {
  const a = S.attempts.slice(-15).reverse();
  $("view").innerHTML = `<section class="panel"><h2>${esc(S.user.name)}</h2><p class="muted">${esc(S.user.email || "")}${DEMO ? " · demo mode: progress is stored in this browser only" : ""}</p><div class="cta" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="a-theme">Switch light / dark</button><button class="btn" id="a-out">Sign out</button><button class="btn" id="a-wipe">Delete my progress</button></div></section>
  <section class="panel"><h2>Recent activity</h2>${a.length ? `<div class="tw"><table><thead><tr><th>When</th><th>Question</th><th>Result</th><th>Time</th></tr></thead><tbody>${a.map(x => `<tr><td>${esc((x.created_at || "").slice(0, 16).replace("T", " "))}</td><td class="mono">${esc(x.question_id)}</td><td>${x.correct === true ? "✓" : x.correct === false ? "✗ " + esc(x.chosen) : (x.self_marks ?? "–") + "/" + (x.max_marks ?? "")}</td><td class="mono">${fmtTime(x.seconds || 0)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing yet.</p>`}</section>`;
  $("a-theme").onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); const nx = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = nx; ls.set("qb_theme", nx) };
  $("a-out").onclick = async () => { await flush(); if (DEMO) { localStorage.removeItem("qb_demo_user"); S.user = null; showAuth() } else await sb.auth.signOut() };
  $("a-wipe").onclick = async () => { if (!confirm("Delete all your saved progress? This cannot be undone.")) return; if (DEMO) ls.set("qb_attempts", []); else { const { error } = await sb.from("attempts").delete().eq("user_id", S.user.id); if (error) return toast(error.message) } S.attempts = []; toast("Progress deleted"); vAccount() };
}
const th = ls.get("qb_theme", null); if (th) document.documentElement.dataset.theme = th;
boot();
})();
