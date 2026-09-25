/* Past Paper Lab — client app (v2). Content loads only after sign-in.
   Back ends: Supabase (production) or localStorage (demo mode, when config has no SUPABASE_URL). */
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
const S = { user: null, course: null, view: "home", data: null, attempts: [], filters: { hideDone: true }, fb: 0, sessionId: Math.random().toString(36).slice(2) + Date.now().toString(36), sessionDone: 0, fbAsked: 0, set: null };
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const sessOrder = s => { const m = /^([MN])(\d\d)$/.exec(s || ""); return m ? +m[2] * 10 + (m[1] === "N" ? 5 : 0) : 0 };
const sessLabel = s => (s[0] === "M" ? "May" : "Nov") + " 20" + s.slice(1);
const fmtTime = s => { const a = Math.abs(Math.round(s)); return (s < 0 ? "−" : "") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0") };
const fmtDur = s => s >= 3600 ? (s / 3600).toFixed(1) + " h" : Math.round(s / 60) + " min";
const norm = s => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2400) }
function info(html) { $("infobody").innerHTML = html; $("infodlg").showModal() } $("infoclose").onclick = () => $("infodlg").close();

/* ---------------- analytics ---------------- */
const evq = [];
function track(name, props = {}) { evq.push({ session_id: S.sessionId, name, props: { course: S.course, view: S.view, ...props }, ts: new Date().toISOString() }); if (evq.length >= 20 || name === "feedback") flush() }
async function flush() {
  if (!evq.length || !S.user) return; const batch = evq.splice(0, evq.length);
  if (DEMO) { ls.set("qb_events", ls.get("qb_events", []).concat(batch).slice(-2000)); return }
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
  if (DEMO) { const r = await fetch(CFG.DEMO_BASE + "app_data/" + id + ".json"); if (!r.ok) throw new Error("not found"); return r.json() }
  const { data, error } = await sb.storage.from(CFG.BUCKET).download("data/" + id + ".json"); if (error) throw error; return JSON.parse(await data.text());
}
async function loadAttempts() {
  if (DEMO) return ls.get("qb_attempts", []);
  const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from("attempts").select("*").order("created_at").range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break } return out;
}
async function insertAttempt(row) {
  S.attempts.push(row);
  if (DEMO) ls.set("qb_attempts", S.attempts); else { const { error } = await sb.from("attempts").insert({ ...row, user_id: S.user.id }); if (error) toast("Could not save: " + error.message) }
}
async function saveAttempt(a) {
  const row = { question_id: a.question_id, course: S.course, status: "completed", chosen: a.chosen ?? null, correct: a.correct ?? null, self_marks: a.self_marks ?? null, max_marks: a.max_marks, seconds: Math.max(0, Math.min(7200, Math.round(a.seconds || 0))), created_at: new Date().toISOString() };
  await insertAttempt(row); S.sessionDone++; if (S.set) S.set.rows.push(row);
  track("attempt", { q: row.question_id, correct: row.correct, self_marks: row.self_marks, seconds: row.seconds, in_set: !!S.set }); drawXp();
}
async function toggleSaved(q) {
  if (savedSet().has(q.id)) {
    S.attempts = S.attempts.filter(a => !(a.question_id === q.id && a.status === "review"));
    if (DEMO) ls.set("qb_attempts", S.attempts); else await sb.from("attempts").delete().eq("question_id", q.id).eq("status", "review");
    toast("Removed from saved"); track("unsave", { q: q.id });
  } else { await insertAttempt({ question_id: q.id, course: S.course, status: "review", chosen: null, correct: null, self_marks: null, max_marks: q.m, seconds: 0, created_at: new Date().toISOString() }); toast("Saved — it will stay visible"); track("save", { q: q.id }) }
}
function progress() { const m = new Map(); for (const a of S.attempts) if (a.status === "completed") m.set(a.question_id, a); return m }
function savedSet() { return new Set(S.attempts.filter(a => a.status === "review").map(a => a.question_id)) }
const missedOf = a => a.correct === false || (a.self_marks !== null && a.max_marks && a.self_marks / a.max_marks < .5);

/* ---------------- points ---------------- */
function xp() { let x = 0; for (const a of progress().values()) { x += 10; if (a.correct === true || (a.self_marks !== null && a.max_marks && a.self_marks / a.max_marks >= .7)) x += 5 } return x + 15 * S.fb }
function drawXp() { const x = xp(), lvl = Math.floor(x / 200) + 1; $("xp-l").textContent = "Lv " + lvl; $("xp-t").textContent = x + " XP"; $("xp-i").style.width = (x % 200) / 2 + "%" }
$("xp").onclick = () => { const P = progress(), tot = S.data ? S.data.questions.length : 0, done = S.data ? S.data.questions.filter(q => P.has(q.id)).length : 0;
  info(`<h3>Level ${Math.floor(xp() / 200) + 1} · ${xp()} XP</h3><p>${done} of ${tot} questions done in ${esc($("courselbl").textContent)}.</p><p class="muted small">+10 XP for every completed question, +5 when you get it right (or award yourself 70% or more), +15 for each piece of feedback you send us. A new level every 200 XP.</p>`) };

/* ---------------- auth ---------------- */
let signup = false;
function showAuth() { $("auth").hidden = false; $("shell").hidden = true }
$("au-toggle").onclick = e => { e.preventDefault(); signup = !signup; $("au-name-l").hidden = !signup; $("au-submit").textContent = $("au-title").textContent = signup ? "Create account" : "Sign in"; $("au-toggle").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account"; $("au-pass").autocomplete = signup ? "new-password" : "current-password" };
$("au-forgot").onclick = async e => { e.preventDefault(); const email = $("au-email").value.trim(); if (!email) { $("au-err").textContent = "Type your email above first, then click “Forgot password?”."; return } if (DEMO) return toast("Not available in demo mode");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); $("au-err").textContent = error ? error.message : "If that email has an account, a reset link is on its way." };
// Pointer-following glow on .glow-btn (login page): --glow-x tracks the pointer across the button.
document.addEventListener("pointermove", e => { const b = e.target.closest?.(".glow-btn"); if (!b) return; const r = b.getBoundingClientRect(); b.style.setProperty("--glow-x", Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) + "%") });
document.addEventListener("pointerout", e => { const b = e.target.closest?.(".glow-btn"); if (b && !b.contains(e.relatedTarget)) b.style.setProperty("--glow-x", "50%") });
$("au-new").onclick = () => info(`<h3>What's new</h3><ul class="newlist"><li><b>Explain this to me.</b> Ask about any markscheme, tap a single line to see how it was obtained, and ask follow-ups.</li><li><b>Practice sets.</b> 20, 45 or 90 minutes of fresh questions with one countdown and a score at the end.</li><li><b>Progress.</b> Your course, topic by topic, with the topics the IB examines most.</li><li><b>More like this.</b> One tap after any question opens similar ones.</li><li><b>Points and levels</b> for every question you finish.</li></ul>`);
$("au-privacy").onclick = e => { e.preventDefault(); info(`<h3>What we store</h3><p>Your email and display name (to sign you in), the questions you complete with your answers, self-awarded marks and time, feedback you choose to send, and usage events such as which screens and filters you use. We use this only to show your progress and to improve the app. No advertising, no third-party trackers. You can reset your progress from the Account screen or ask us to remove your account at any time.</p>`) };
$("authform").onsubmit = async e => {
  e.preventDefault(); $("au-err").textContent = ""; const email = $("au-email").value.trim(), password = $("au-pass").value, name = $("au-name").value.trim();
  if (DEMO) { S.user = { id: "demo", email, name: name || email.split("@")[0] }; ls.set("qb_demo_user", S.user); return boot() }
  $("au-submit").disabled = true;
  try { const res = signup ? await sb.auth.signUp({ email, password, options: { data: { display_name: name } } }) : await sb.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error; if (!res.data.session) throw new Error("Check your inbox to confirm your email, then sign in.");
  } catch (err) { $("au-err").textContent = /Invalid login/.test(err.message) ? "Wrong email or password." : err.message } finally { $("au-submit").disabled = false }
};
async function boot() {
  if (DEMO) { S.user = S.user || ls.get("qb_demo_user", null); S.fb = ls.get("qb_fb", 0) }
  else { const { data } = await sb.auth.getSession(); const u = data.session?.user; S.user = u ? { id: u.id, email: u.email, name: u.user_metadata?.display_name || u.email.split("@")[0] } : null; S.fb = u?.user_metadata?.fb_count || 0 }
  if (!S.user) return showAuth();
  $("auth").hidden = true; $("shell").hidden = false; drawAcct();
  S.course = ls.get("qb_course", null); track("session_start", { ua: navigator.userAgent.slice(0, 120), w: innerWidth, h: innerHeight, demo: DEMO });
  try { S.attempts = await loadAttempts() } catch (e) { toast("Could not load your progress") } drawXp();
  if (!S.course) openCourses(); else await setCourse(S.course);
}
if (!DEMO) sb.auth.onAuthStateChange(async (ev) => {
  if (ev === "PASSWORD_RECOVERY") { const pw = prompt("Choose a new password (at least 6 characters)"); if (pw && pw.length >= 6) { const { error } = await sb.auth.updateUser({ password: pw }); toast(error ? error.message : "Password updated") } }
  if (ev === "SIGNED_IN" && !S.user) boot(); if (ev === "SIGNED_OUT") { S.user = null; showAuth() } });

/* ---------------- course + navigation ---------------- */
function openCourses() { $("tiles").innerHTML = COURSES.map(c => `<button class="tile${c.id === S.course ? " on" : ""}" data-c="${c.id}"><b>${c.label}</b><span class="muted small">${c.sub}</span></button>`).join(""); $("coursedlg").showModal() }
$("coursebtn").onclick = openCourses; $("courseclose").onclick = () => $("coursedlg").close();
$("tiles").onclick = async e => { const t = e.target.closest(".tile"); if (!t) return; $("coursedlg").close(); await setCourse(t.dataset.c) };
async function setCourse(id) {
  S.course = id; ls.set("qb_course", id); $("courselbl").textContent = COURSES.find(c => c.id === id).label; $("view").innerHTML = `<div class="empty">Loading ${esc($("courselbl").textContent)}…</div>`;
  try { S.data = await loadCourse(id) } catch (e) { $("view").innerHTML = `<div class="panel empty">This course could not be loaded. <button class="btn" onclick="document.getElementById('coursebtn').click()">Choose another</button></div>`; return }
  const D = S.data; D.byId = new Map(D.questions.map(q => [q.id, q])); D.sub = new Map(D.syllabus.map(s => [s.code, s]));
  D.questions.forEach(q => { q._p = norm([q.codes[0], D.sub.get(q.codes[0])?.name].join(" ")); q._k = norm([q.codes.join(" "), q.codes.map(c => D.sub.get(c)?.name).join(" "), (q.kw || []).join(" ")].join(" ")); q._t = norm(q.txt) });
  const cnt = new Map(); D.questions.forEach(q => q.codes[0] && cnt.set(q.codes[0], (cnt.get(q.codes[0]) || 0) + 1)); const sorted = [...cnt.values()].sort((a, b) => b - a); D.often = sorted[Math.floor(sorted.length / 4)] || 1e9; D.cnt = cnt;
  S.filters = { hideDone: true }; track("course_open"); go(["home", "practice", "progress"].includes(S.view) ? S.view : "home");
}
$("nav").onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.v) };
function go(v) { S.view = v; document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); track("view"); ({ home: vHome, practice: vPractice, progress: vProgress, account: vAccount }[v])(); scrollTo(0, 0) }

/* ---------------- timer ---------------- */
const T = { target: 0, left: 0, run: false, h: null };
function drawT() { $("tval").textContent = fmtTime(T.left); $("timer").classList.toggle("over", T.left < 0); $("tgo").textContent = T.run ? "❚❚" : "▶" }
function toggleT() { if (T.run) { clearInterval(T.h); T.run = false } else { T.run = true; T.h = setInterval(() => { T.left -= 1; drawT() }, 1000) } drawT() }
function startT(min, lbl) { T.target = Math.round(min * 60); T.left = T.target; $("tlbl").textContent = lbl; if (!T.run) toggleT(); drawT(); track("timer_start", { lbl, min }) }
function stopT() { if (T.run) toggleT() }
$("tgo").onclick = toggleT; $("trs").onclick = () => { stopT(); T.left = T.target; drawT() };

/* ---------------- shared ---------------- */
const current = q => !(S.data.hasLegacy && (q.codes[0] || "").startsWith("X"));
function mine() { const ids = S.data.byId; return [...progress().values()].filter(a => ids.has(a.question_id)) }
function subStats() { const P = progress(), m = new Map(); for (const q of S.data.questions) { const c = q.codes[0]; if (!c) continue; const o = m.get(c) || { n: 0, done: 0 }; o.n++; if (P.has(q.id)) o.done++; m.set(c, o) } return m }
function streak() { const days = new Set(S.attempts.filter(a => a.status === "completed").map(a => (a.created_at || "").slice(0, 10))); let n = 0; const d = new Date(); if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1) } return n }
const isHL = c => { const s = S.data.sub.get(c); return s && /^AHL$/.test(s.level || "") };
function unitsHtml(st) {
  const D = S.data; return D.topics.map(t => { const rows = D.syllabus.filter(s => s.topic === t.id); if (!rows.length) return ""; const n = rows.reduce((x, s) => x + (st.get(s.code)?.n || 0), 0), d = rows.reduce((x, s) => x + (st.get(s.code)?.done || 0), 0); if (!n) return "";
    return `<div class="unit"><h3>${esc(t.id)} · ${esc(t.name)} <span>${d}/${n} done</span></h3>${rows.map(s => { const o = st.get(s.code) || { n: 0, done: 0 }; return `<button class="subrow${isHL(s.code) ? " hl" : ""}${t.id === "X" ? " x" : ""}" data-code="${esc(s.code)}"><span class="code">${esc(s.code)}</span><span>${esc(s.name)}${(D.cnt.get(s.code) || 0) >= D.often && t.id !== "X" ? `<span class="tag-often">often examined</span>` : ""}</span><span class="bar"><i style="width:${o.n ? 100 * o.done / o.n : 0}%"></i></span><span class="n">${o.done}/${o.n}</span></button>` }).join("")}</div>` }).join("");
}
function bindRows() { document.querySelectorAll(".subrow").forEach(r => r.onclick = () => { S.filters = { hideDone: true, topic: r.dataset.code }; go("practice") }) }

/* ---------------- HOME ---------------- */
function vHome() {
  const D = S.data, a = mine(), P = progress(), mcq = a.filter(x => x.correct !== null), ok = mcq.filter(x => x.correct).length, sec = a.reduce((t, x) => t + (x.seconds || 0), 0);
  const wr = a.filter(x => x.self_marks !== null), sm = wr.reduce((t, x) => t + x.self_marks, 0), mm = wr.reduce((t, x) => t + (x.max_marks || 0), 0), missed = a.filter(missedOf).length, saved = [...savedSet()].filter(id => D.byId.has(id)).length;
  const cur = D.questions.filter(current), done = cur.filter(q => P.has(q.id)).length;
  const papers = new Map(); for (const q of cur) { const o = papers.get(q.pid) || { pid: q.pid, s: q.s, p: q.p, tz: q.tz, n: 0, d: 0 }; o.n++; if (P.has(q.id)) o.d++; papers.set(q.pid, o) }
  const plist = [...papers.values()].sort((x, y) => sessOrder(y.s) - sessOrder(x.s) || String(x.p).localeCompare(String(y.p)) || String(x.tz).localeCompare(String(y.tz)));
  $("view").innerHTML = `
  <section class="panel" style="display:grid;gap:14px"><div><p class="muted small" style="margin:0">${esc(D.label)}</p><h1>${a.length ? `Welcome back, ${esc(S.user.name)}.` : `Hi ${esc(S.user.name)}. What do you want to work on?`}</h1>
    <div class="bar" style="height:10px;max-width:520px"><i style="width:${cur.length ? 100 * done / cur.length : 0}%"></i></div><p class="muted small" style="margin:6px 0 0">${done} of ${cur.length} questions done · ${plist.filter(p => p.d === p.n).length} of ${plist.length} papers completed</p></div>
    <div class="actions"><button class="action main" id="h-topic"><b>Practise a topic</b><span class="muted small">Choose what to work on, one question at a time</span></button>
    <button class="action" id="h-set"><b>Build a practice set</b><span class="muted small">A timed mix, like a mini past paper</span></button>
    <button class="action" id="h-missed"><b>Redo my mistakes${missed ? ` (${missed})` : ""}</b><span class="muted small">${missed ? "Questions you got wrong or scored under half" : "Nothing here yet"}</span></button>
    ${saved ? `<button class="action" id="h-saved"><b>Saved for later (${saved})</b><span class="muted small">Questions you bookmarked</span></button>` : ""}</div></section>
  <section class="kpis"><div class="kpi"><div class="big-num">${a.length}</div><div class="lbl">Questions done</div></div><div class="kpi"><div class="big-num">${fmtDur(sec)}</div><div class="lbl">Time practised</div></div>
    <div class="kpi"><div class="big-num">${mcq.length ? Math.round(100 * ok / mcq.length) + "%" : "—"}</div><div class="lbl">Multiple choice</div></div><div class="kpi"><div class="big-num">${mm ? Math.round(100 * sm / mm) + "%" : "—"}</div><div class="lbl">Written (self-marked)</div></div>
    <div class="kpi"><div class="big-num">${streak()}</div><div class="lbl">Day streak</div></div></section>
  <section class="panel"><h2>Past papers</h2><p class="muted small">Each bar is one paper. Tap one to work through it.</p><div class="papers">${plist.slice(0, 60).map(p => `<button class="paper${p.d === p.n ? " full" : ""}" data-pid="${esc(p.pid)}"><span><b>${esc(sessLabel(p.s))}</b> · P${esc(p.p)}${p.tz !== "0" ? " TZ" + esc(p.tz) : ""} <span class="muted">${p.d}/${p.n}</span></span><span class="bar"><i style="width:${100 * p.d / p.n}%"></i></span></button>`).join("")}</div></section>`;
  $("h-topic").onclick = () => { S.filters = { hideDone: true }; go("practice") }; $("h-set").onclick = openBuilder;
  $("h-missed").onclick = () => { if (!missed) return toast("No mistakes to redo yet"); S.filters = { missed: true }; go("practice") }; if ($("h-saved")) $("h-saved").onclick = () => { S.filters = { saved: true }; go("practice") };
  document.querySelectorAll(".paper").forEach(b => b.onclick = () => { S.filters = { pid: b.dataset.pid, sort: "paper" }; go("practice") });
}

/* ---------------- PRACTICE ---------------- */
let results = [], firstSeen = new Map(), io = null, shown = 15, searchT = null;
function topicOptions(sel) { const D = S.data; return `<option value="">All topics</option>` + D.topics.map(t => { const rows = D.syllabus.filter(s => s.topic === t.id && D.cnt.get(s.code)); if (!rows.length) return ""; return `<optgroup label="${esc(t.id + " · " + t.name)}"><option value="U:${esc(t.id)}"${sel === "U:" + t.id ? " selected" : ""}>All of ${esc(t.name)}</option>${rows.map(s => `<option value="${esc(s.code)}"${sel === s.code ? " selected" : ""}>${esc(s.code + " · " + s.name)}</option>`).join("")}</optgroup>` }).join("") }
function vPractice() {
  const D = S.data, f = S.filters, sess = [...new Set(D.questions.map(q => q.s))].sort((a, b) => sessOrder(a) - sessOrder(b)), papers = [...new Set(D.questions.map(q => q.p))].sort();
  const opt = (arr, sel, all) => `<option value="">${all}</option>` + arr.map(([v, l]) => `<option value="${esc(v)}"${String(sel ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("");
  const hasTypes = new Set(D.questions.map(q => q.t)).size > 1, moreOpen = f.paper || f.from || f.to || f.diff || f.sort || f.main || f.missed || f.saved || f.pid || f.cur === false;
  $("view").innerHTML = `<div class="layout" id="lay"><aside class="panel filters">
    <label for="f-q">Search<input id="f-q" type="search" placeholder="e.g. projectile, half-life, SL 5.8" value="${esc(f.q || "")}"></label>
    <label for="f-topic">Topic<select id="f-topic">${topicOptions(f.topic || "")}</select></label>
    ${hasTypes ? `<div class="field" style="margin:0"><span class="flabel">Question type</span><div class="seg full" id="f-type"><button data-v="" class="${!f.type ? "on" : ""}">All</button><button data-v="mcq" class="${f.type === "mcq" ? "on" : ""}">Multiple choice</button><button data-v="structured" class="${f.type === "structured" ? "on" : ""}">Written</button></div></div>` : ""}
    <label class="chk"><input type="checkbox" id="f-hide" ${f.hideDone ? "checked" : ""}> Hide questions I've done</label>
    <details class="more" ${moreOpen ? "open" : ""}><summary>More filters</summary><div class="inner">
      <div class="row2"><label for="f-paper">Paper<select id="f-paper">${opt(papers.map(p => [p, "Paper " + p]), f.paper, "Any")}</select></label><label for="f-diff">Difficulty<select id="f-diff">${opt([[1, "Easier"], [2, "Standard"], [3, "Harder"]], f.diff, "Any")}</select></label></div>
      <div class="row2"><label for="f-from">From<select id="f-from">${opt(sess.map(s => [s, sessLabel(s)]), f.from, "Earliest")}</select></label><label for="f-to">To<select id="f-to">${opt(sess.map(s => [s, sessLabel(s)]), f.to, "Latest")}</select></label></div>
      <label for="f-sort">Order<select id="f-sort">${opt([["new", "Newest first"], ["old", "Oldest first"], ["easy", "Easiest first"], ["marks", "Most marks first"], ["paper", "Paper order"]], f.sort, "Best match")}</select></label>
      <label class="chk"><input type="checkbox" id="f-missed" ${f.missed ? "checked" : ""}> Only my mistakes</label><label class="chk"><input type="checkbox" id="f-saved" ${f.saved ? "checked" : ""}> Only saved for later</label>
      <label class="chk"><input type="checkbox" id="f-main" ${f.main ? "checked" : ""}> Topic must be the main one</label>
      ${D.hasLegacy ? `<label class="chk"><input type="checkbox" id="f-cur" ${f.cur !== false ? "checked" : ""}> Current syllabus only</label>` : ""}</div></details>
    <button class="btn" id="f-reset">Clear filters</button></aside>
    <section style="display:grid;gap:12px"><div class="resultbar"><span id="p-count"></span>${f.pid ? `<span class="badge t">one paper <a href="#" id="p-clearpid">×</a></span>` : ""}<span class="sp"><button class="btn primary" id="p-focus">Start focus mode</button><button class="btn" id="p-hide">Hide filters</button></span></div><div id="p-list" style="display:grid;gap:12px"></div><button class="btn" id="p-more" hidden>Show more</button></section></div>`;
  ["f-q", "f-topic", "f-paper", "f-from", "f-to", "f-diff", "f-sort", "f-main", "f-hide", "f-missed", "f-saved", "f-cur"].forEach(id => $(id) && $(id).addEventListener("input", () => { readFilters(); runSearch(true) }));
  if ($("f-type")) $("f-type").onclick = e => { const b = e.target.closest("button"); if (!b) return; $("f-type").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); readFilters(); runSearch(true) };
  $("f-reset").onclick = () => { S.filters = { hideDone: true }; vPractice() }; $("p-hide").onclick = () => { const on = $("lay").classList.toggle("nofilters"); $("p-hide").textContent = on ? "Show filters" : "Hide filters" };
  if ($("p-clearpid")) $("p-clearpid").onclick = e => { e.preventDefault(); delete S.filters.pid; vPractice() };
  $("p-focus").onclick = () => openFocus(0); $("p-more").onclick = () => { shown += 15; renderList() }; runSearch(false);
}
function readFilters() { const v = id => $(id)?.value || "", c = id => !!$(id)?.checked; S.filters = { q: v("f-q"), topic: v("f-topic"), type: $("f-type")?.querySelector(".on")?.dataset.v || "", paper: v("f-paper"), from: v("f-from"), to: v("f-to"), diff: v("f-diff"), sort: v("f-sort"), main: c("f-main"), hideDone: c("f-hide"), missed: c("f-missed"), saved: c("f-saved"), cur: $("f-cur") ? c("f-cur") : undefined, pid: S.filters.pid } }
const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "and", "for", "with", "by", "is"]);
function query(f) {
  const D = S.data, P = progress(), SV = savedSet(), terms = norm(f.q).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t)), unit = (f.topic || "").startsWith("U:") ? f.topic.slice(2) : "", sub = unit ? "" : f.topic;
  const codesOf = q => f.main ? q.codes.slice(0, 1) : q.codes;
  let r = D.questions.filter(q => (!unit || codesOf(q).some(c => D.sub.get(c)?.topic == unit)) && (!sub || codesOf(q).includes(sub)) && (!f.type || q.t === f.type) && (!f.paper || q.p == f.paper) && (!f.pid || q.pid === f.pid)
    && (!f.from || sessOrder(q.s) >= sessOrder(f.from)) && (!f.to || sessOrder(q.s) <= sessOrder(f.to)) && (!f.diff || q.d == f.diff)
    && (!f.hideDone || f.missed || f.saved || !P.has(q.id) || SV.has(q.id)) && (f.cur === false || sub || f.pid || current(q))
    && (!f.missed || (P.has(q.id) && missedOf(P.get(q.id)))) && (!f.saved || SV.has(q.id)));
  if (terms.length) r = r.map(q => { let s = 0; for (const t of terms) { if (q._p.includes(t)) s += 6; else if (q._k.includes(t)) s += 3; else if (q._t.includes(t) || q.id.toLowerCase().includes(t)) s += 1; else return null } return [q, s] }).filter(Boolean).sort((a, b) => b[1] - a[1] || sessOrder(b[0].s) - sessOrder(a[0].s)).map(x => x[0]);
  const by = (a, b) => sessOrder(b.s) - sessOrder(a.s) || String(a.p).localeCompare(String(b.p)) || String(a.tz).localeCompare(String(b.tz)) || a.q - b.q;
  if (f.sort === "new" || (!f.sort && !terms.length)) r.sort(by); else if (f.sort === "old") r.sort((a, b) => -by(a, b)); else if (f.sort === "marks") r.sort((a, b) => b.m - a.m); else if (f.sort === "easy") r.sort((a, b) => (a.d || 2) - (b.d || 2) || a.m - b.m); else if (f.sort === "paper") r.sort((a, b) => a.pid.localeCompare(b.pid) || a.q - b.q);
  return r;
}
function runSearch(log) { results = query(S.filters); shown = 15; renderList(); if (log) { clearTimeout(searchT); searchT = setTimeout(() => track("search", { ...S.filters, n: results.length }), 1200) } }
async function renderList() {
  const P = progress(), page = results.slice(0, shown);
  $("p-count").textContent = `${results.length} question${results.length === 1 ? "" : "s"} · about ${fmtDur(results.reduce((t, q) => t + q.min * 60, 0))}`;
  $("p-list").innerHTML = page.length ? page.map(q => cardHtml(q, P.get(q.id))).join("") : `<div class="panel empty">${S.filters.hideDone ? "Nothing left here — you have done them all, or the filters are too narrow." : "Nothing matches these filters."}</div>`; $("p-more").hidden = results.length <= shown;
  const urls = await imageUrls(page.map(q => q.img)); page.forEach((q, i) => { const im = document.querySelector(`[data-qimg="${CSS.escape(q.id)}"]`); if (im && urls[i]) im.src = urls[i] });
  if (io) io.disconnect(); io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !firstSeen.has(e.target.dataset.id)) firstSeen.set(e.target.dataset.id, Date.now()) }), { threshold: .5 }); document.querySelectorAll("#p-list .q").forEach(el => io.observe(el));
}
function chips(q) { const D = S.data; return q.codes.map((c, i) => `<span class="badge${i === 0 ? " t" : ""}${isHL(c) ? " hl" : ""}" title="${esc(c + " · " + (D.sub.get(c)?.name || ""))}">${esc((D.sub.get(c)?.name || c).split(/[:;(]/)[0].slice(0, i ? 28 : 46))}</span>`).join("") }
function stateBadge(q, att) { return att ? (att.correct === true ? `<span class="badge ok">✓ correct</span>` : att.correct === false ? `<span class="badge no">✗ you chose ${esc(att.chosen)}</span>` : `<span class="badge ok">✓ done · ${att.self_marks ?? "–"}/${q.m}</span>`) : "" }
function cardHtml(q, att) {
  const dots = q.d ? `<span class="dots" title="${["", "easier", "standard", "harder"][q.d]}">${[1, 2, 3].map(i => `<i class="${i <= q.d ? "on" : ""}"></i>`).join("")}</span>` : "", sv = savedSet().has(q.id);
  return `<article class="q${att ? " done" : ""}" data-id="${esc(q.id)}"><div class="qhead"><span class="qtitle">${esc(sessLabel(q.s))} · Paper ${esc(q.p)}${q.tz && q.tz !== "0" ? " TZ" + esc(q.tz) : ""} · Q${q.q}</span><span class="badge marks">${q.m} mark${q.m === 1 ? "" : "s"} · ≈ ${Math.max(1, Math.round(q.min))} min</span>${dots}${stateBadge(q, att)}</div>
  <div class="qhead">${chips(q)}</div><div class="qimg"><img data-qimg="${esc(q.id)}" alt="Question ${q.q}" loading="lazy"></div>
  <div class="qact">${q.t === "mcq" ? `<div class="mcq" role="group" aria-label="Your answer">${["A", "B", "C", "D"].map(l => `<button data-l="${l}" class="${att && q.ans === l ? "right" : att && att.chosen === l ? "wrong" : ""}">${l}</button>`).join("")}</div>` : `<button class="btn" data-act="ms">${q.ms ? "Show markscheme" : "No markscheme"}</button>`}
  <button class="btn ghost" data-act="focus">Focus</button><button class="btn ghost${sv ? " saved" : ""}" data-act="save">${sv ? "★ Saved" : "☆ Save for later"}</button></div><div class="msbox"></div><div class="afterbox"></div></article>`;
}
document.addEventListener("click", async e => {
  const card = e.target.closest("#p-list .q"); if (!card) return; const q = S.data.byId.get(card.dataset.id); if (!q) return;
  if (e.target.dataset.l) return answerMcq(q, e.target.dataset.l, card, (Date.now() - (firstSeen.get(q.id) || Date.now())) / 1000);
  const act = e.target.dataset.act; if (act === "focus") openFocus(results.indexOf(q)); if (act === "ms") showMs(q, card, (Date.now() - (firstSeen.get(q.id) || Date.now())) / 1000);
  if (act === "save") { await toggleSaved(q); const sv = savedSet().has(q.id); e.target.textContent = sv ? "★ Saved" : "☆ Save for later"; e.target.classList.toggle("saved", sv) }
});
async function answerMcq(q, l, scope, seconds) {
  if (scope.dataset.locked) return; scope.dataset.locked = 1; const correct = q.ans ? l === q.ans : null;
  scope.querySelectorAll(".mcq button").forEach(b => { b.classList.toggle("right", b.dataset.l === q.ans); b.classList.toggle("wrong", b.dataset.l === l && l !== q.ans) });
  await saveAttempt({ question_id: q.id, chosen: l, correct, max_marks: 1, seconds: Math.min(seconds, 1200) }); toast(correct ? "Correct  +15 XP" : q.ans ? `Not quite — the answer is ${q.ans}  +10 XP` : "Saved"); scope.classList.add("done"); afterDone(q, scope);
}
async function showMs(q, scope, seconds) {
  const box = scope.querySelector(".msbox"); if (!q.ms) return; if (box.innerHTML) { box.innerHTML = ""; return } track("ms_reveal", { q: q.id });
  const [u] = await imageUrls([q.ms]); const half = Math.round(q.m / 2);
  box.innerHTML = `<div class="qimg ms${CFG.EXPLAIN_FN ? " tapms" : ""}"><img src="${u}" alt="Markscheme"><i class="tapmark" hidden></i></div>${CFG.EXPLAIN_FN ? `<p class="muted small taphint">Tap any line of the markscheme to see how it was obtained.</p><div class="exchat" aria-live="polite"></div><div class="qact" style="margin-top:10px"><input type="text" class="ex-note" id="exn-${esc(q.id)}" aria-label="Your question" placeholder="What confuses you? (optional)" style="flex:1;min-width:180px"><button class="btn" data-ex="1">Explain this to me</button></div>` : ""}
  <div class="selfmark" style="margin-top:10px"><label for="sm-${esc(q.id)}" style="display:contents"><span>How many marks would you give yourself?</span><input id="sm-${esc(q.id)}" type="range" min="0" max="${q.m}" value="${half}" step="1"></label><b class="mono"><span class="smv">${half}</span>/${q.m}</b><button class="btn good" data-done="1">Mark as complete</button></div>`;
  const rng = box.querySelector("input[type=range]"); rng.oninput = () => box.querySelector(".smv").textContent = rng.value;
  box.querySelector("[data-done]").onclick = async ev => { ev.target.disabled = true; await saveAttempt({ question_id: q.id, self_marks: +rng.value, max_marks: q.m, seconds: scope._sec ? scope._sec() : Math.min(seconds, 3600) }); toast("Done  +" + (+rng.value / q.m >= .7 ? 15 : 10) + " XP"); scope.classList.add("done"); box.querySelector(".selfmark").remove(); afterDone(q, scope) };
  const ex = box.querySelector("[data-ex]"); if (ex) { const inp = box.querySelector(".ex-note"); box._turns = [];
    ex.onclick = () => explain(q, box, inp.value); inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); ex.click() } };
    box.querySelector(".tapms").onclick = e => tapLine(q, box, e) }
}
let katexP;
function renderMath(el) { // KaTeX loaded on first use; math is rendered from text nodes, so model output is never parsed as HTML
  katexP ??= new Promise((ok, no) => { const add = (tag, attrs) => Object.assign(document.head.appendChild(document.createElement(tag)), attrs), K = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
    add("link", { rel: "stylesheet", href: K + "katex.min.css" }); add("script", { src: K + "katex.min.js", onerror: no, onload: () => add("script", { src: K + "contrib/auto-render.min.js", onload: ok, onerror: no }) }) });
  return katexP.then(() => renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }], throwOnError: false })).catch(() => {});
}
// One conversation per open markscheme: box._turns holds {role, text}; box._line is the cropped line image (data URL) it started from, if any.
async function explain(q, box, text, line) {
  const chat = box.querySelector(".exchat"), btn = box.querySelector("[data-ex]"), inp = box.querySelector(".ex-note"); if (btn.disabled) return;
  text = String(text || "").trim().slice(0, 300); if (!text && box._turns.length) return inp.focus();
  if (line || !box._turns.length) { box._turns = []; box._line = line?.src || null; chat.innerHTML = "" } // tapping a line starts a new thread
  box._turns.push({ role: "user", text: text || (line ? line.ask : "") });
  if (line || text) { const me = document.createElement("div"); me.className = "exq"; if (line) me.innerHTML = `<img src="${line.src}" alt="The markscheme line you tapped">`; me.append(text || line.ask); chat.append(me) }
  const ans = document.createElement("div"); ans.className = "explain muted"; ans.textContent = "Thinking…"; chat.append(ans); btn.disabled = true; inp.value = "";
  track("explain_request", { q: q.id, turn: box._turns.length, line: !!line });
  try { const { data, error } = await sb.functions.invoke(CFG.EXPLAIN_FN, { body: { course: S.course, img: q.img, ms: q.ms, marks: q.m, turns: box._turns, line: box._line || undefined } }); if (error) throw error; if (data.error) throw new Error(data.error);
    ans.className = "explain"; ans.textContent = data.text; box._turns.push({ role: "assistant", text: data.text }); await renderMath(ans);
    btn.textContent = "Ask"; inp.placeholder = "Ask a follow-up…" }
  catch (e) { box._turns.pop(); ans.textContent = /limit/i.test(e.message) ? "You have used today's explanations. They reset tomorrow." : "Could not get an explanation right now. Try again in a moment." }
  btn.disabled = false;
}
async function tapLine(q, box, e) {
  const wrap = e.currentTarget, img = wrap.querySelector("img"), r = img.getBoundingClientRect(); if (e.clientY > r.bottom || e.clientX > r.right || box.querySelector("[data-ex]").disabled) return;
  const fy = (e.clientY - r.top) / r.height, mark = wrap.querySelector(".tapmark"), ask = "How was this line obtained?";
  try {
    box._bmp ??= fetch(img.src, { cache: "no-store" }).then(x => x.blob()).then(createImageBitmap); // fetched again with CORS so the canvas is not tainted
    const bmp = await box._bmp, half = 40, y0 = Math.max(0, Math.round(fy * bmp.height) - half), h = Math.min(2 * half, bmp.height - y0);
    const c = Object.assign(document.createElement("canvas"), { width: bmp.width, height: h }); c.getContext("2d").drawImage(bmp, 0, y0, bmp.width, h, 0, 0, bmp.width, h);
    Object.assign(mark.style, { top: y0 / bmp.height * r.height + "px", height: h / bmp.height * r.height + "px", width: r.width + "px" }); mark.hidden = false;
    explain(q, box, "", { src: c.toDataURL("image/png"), ask });
  } catch { explain(q, box, `${ask} (the line about ${Math.round(fy * 100)}% of the way down the markscheme)`) }
}
function afterDone(q, scope) {
  const box = scope.querySelector(".afterbox"); if (!box) return; const askFb = S.sessionDone % 3 === 0 && S.fbAsked < 3 && !S.set;
  box.innerHTML = `<div class="after">${S.set ? "" : `<button class="btn" data-like="1">More like this</button>`}<span class="muted small">${askFb ? "" : ""}</span></div>${askFb ? `<div class="fb"><div class="row"><b>Quick one: how is this working for you?</b><span class="badge hl">+15 XP</span></div><div class="row"><button class="btn" data-r="up">👍 Good</button><button class="btn" data-r="meh">😐 OK</button><button class="btn" data-r="down">👎 Not great</button><button class="btn ghost" data-r="skip">Skip</button></div></div>` : ""}`;
  if (askFb) { S.fbAsked++; const fb = box.querySelector(".fb"); fb.onclick = ev => { const r = ev.target.dataset.r; if (!r) return; if (r === "skip") { fb.remove(); return track("feedback_skip") }
      fb.innerHTML = `<b>Thanks! Anything we should fix or add?</b><textarea id="fbt-${esc(q.id)}" placeholder="One sentence is plenty."></textarea><div class="row"><button class="btn primary" data-send="1">Send  +15 XP</button><button class="btn ghost" data-send="0">Just the rating</button></div>`;
      fb.onclick = async e2 => { if (e2.target.dataset.send === undefined) return; const text = e2.target.dataset.send === "1" ? fb.querySelector("textarea").value.trim().slice(0, 1000) : ""; track("feedback", { rating: r, text, q: q.id }); S.fb++; if (DEMO) ls.set("qb_fb", S.fb); else sb.auth.updateUser({ data: { fb_count: S.fb } }); drawXp(); fb.innerHTML = `<b>Got it, thank you.  +15 XP</b>`; setTimeout(() => fb.remove(), 1800) } } }
  const like = box.querySelector("[data-like]"); if (like) like.onclick = () => { track("more_like_this", { q: q.id }); if ($("focus").open) $("focus").close(); clearInterval(ft); S.filters = { hideDone: true, topic: q.codes[0] || "", type: q.t, main: true }; S.view = "practice"; document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === "practice")); vPractice(); results = results.filter(x => x.id !== q.id).sort((a, b) => Math.abs(a.m - q.m) - Math.abs(b.m - q.m)); if (results.length) openFocus(0); else toast("No more questions on this topic") };
}

/* ---------------- FOCUS MODE + SETS ---------------- */
let fi = 0, ft = null, fstart = 0;
function openFocus(i) { if (!results.length) return toast("No questions to show"); fi = Math.max(0, i); const dlg = $("focus"); if (!dlg.open) dlg.showModal(); track("focus_open", { set: !!S.set }); drawFocus() }
async function drawFocus() {
  const q = results[fi], dlg = $("focus"), att = progress().get(q.id); fstart = Date.now(); clearInterval(ft);
  dlg.innerHTML = `<div class="fbar"><b>${esc(sessLabel(q.s))} · P${esc(q.p)}${q.tz && q.tz !== "0" ? " TZ" + esc(q.tz) : ""} · Q${q.q}</b><span class="badge marks">${q.m} mark${q.m === 1 ? "" : "s"}</span><span class="muted small">${fi + 1} / ${results.length}</span><span class="ftime" id="ftime">00:00</span><span class="muted small" id="fof">${S.set ? "left in this set" : "of ≈ " + Math.max(1, Math.round(q.min)) + " min"}</span></div>
  <div class="fbody q${att ? " done" : ""}" data-id="${esc(q.id)}"><div class="qhead">${S.set ? "" : chips(q)}${stateBadge(q, att)}</div><div class="qimg"><img id="fimg" alt="Question"></div>
  <div class="qact">${q.t === "mcq" ? `<div class="mcq">${["A", "B", "C", "D"].map(l => `<button data-l="${l}">${l}</button>`).join("")}</div>` : `<button class="btn primary" id="fms">${q.ms ? "I'm done — show markscheme" : "No markscheme"}</button>`}<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="fprev">←</button><button class="btn" id="fnext">Skip →</button><button class="btn ghost" id="fclose">${S.set ? "End set" : "Close"}</button></span></div><div class="msbox"></div><div class="afterbox"></div></div>`;
  const [u] = await imageUrls([q.img]); if ($("fimg")) $("fimg").src = u; imageUrls(results.slice(fi + 1, fi + 3).map(x => x.img));
  const secs = () => (Date.now() - fstart) / 1000, body = dlg.querySelector(".fbody"); let frozen = null; body._sec = () => frozen ?? secs();
  ft = setInterval(() => { const el = $("ftime"); if (!el) return clearInterval(ft); if (S.set) { const left = S.set.total - (Date.now() - S.set.started) / 1000; el.textContent = fmtTime(left); el.classList.toggle("over", left < 0) } else if (frozen === null) { const s = secs(); el.textContent = fmtTime(s); el.classList.toggle("over", s > q.min * 60) } }, 500);
  const next = () => { if (fi < results.length - 1) { fi++; drawFocus() } else if (S.set) endSet(); else { toast("That was the last one"); closeFocus() } };
  dlg.querySelectorAll(".mcq button").forEach(b => b.onclick = async () => { frozen = secs(); await answerMcq(q, b.dataset.l, body, frozen); $("fnext").textContent = "Next →"; $("fnext").classList.add("primary") });
  if ($("fms")) $("fms").onclick = () => { if (frozen === null) frozen = secs(); showMs(q, body, frozen); $("fnext").textContent = "Next →" };
  $("fnext").onclick = () => { if (!progress().has(q.id)) track("skip", { q: q.id, seconds: Math.round(secs()) }); next() }; $("fprev").onclick = () => { if (fi > 0) { fi--; drawFocus() } }; $("fclose").onclick = () => S.set ? endSet() : closeFocus();
}
function closeFocus() { clearInterval(ft); if ($("focus").open) $("focus").close(); if (S.view === "practice") runSearch(false); else go(S.view) }
$("focus").addEventListener("cancel", e => { if (S.set) { e.preventDefault(); endSet() } else { clearInterval(ft); setTimeout(() => S.view === "practice" ? runSearch(false) : go(S.view), 0) } });
function openBuilder() { const D = S.data; $("b-units").innerHTML = D.topics.filter(t => t.id !== "X" && D.syllabus.some(s => s.topic === t.id && D.cnt.get(s.code))).map(t => `<button data-u="${esc(t.id)}" class="on">${esc(t.id + " · " + t.name)}</button>`).join(""); $("builder").showModal() }
document.querySelectorAll("#builder .seg").forEach(seg => seg.onclick = e => { const b = e.target.closest("button"); if (b) seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)) });
$("b-units").onclick = e => { const b = e.target.closest("button"); if (b) b.classList.toggle("on") }; $("b-cancel").onclick = () => $("builder").close();
$("b-go").onclick = () => {
  const D = S.data, P = progress(), mins = +$("b-len").querySelector(".on").dataset.v, type = $("b-type").querySelector(".on").dataset.v, units = new Set([...$("b-units").querySelectorAll(".on")].map(b => b.dataset.u));
  if (!units.size) return toast("Pick at least one unit");
  let pool = D.questions.filter(q => !P.has(q.id) && current(q) && q.codes[0] && units.has(String(D.sub.get(q.codes[0])?.topic)) && (!type || q.t === type) && q.min <= mins * .6).sort(() => Math.random() - .5);
  const pick = [], used = new Map(); let t = 0, tm = 0; const wantM = type ? null : mins * .35;
  for (const q of pool) { if (t >= mins) break; if (t + q.min > mins * 1.1) continue; if (wantM !== null && q.t === "mcq" && tm >= wantM) continue; const c = q.codes[0]; if ((used.get(c) || 0) >= Math.max(2, mins / 15)) continue; pick.push(q); used.set(c, (used.get(c) || 0) + 1); t += q.min; if (q.t === "mcq") tm += q.min }
  if (pick.length < 2) return toast("Not enough fresh questions for that choice");
  pick.sort((a, b) => (a.t === "mcq" ? 0 : 1) - (b.t === "mcq" ? 0 : 1) || (a.d || 2) - (b.d || 2)); $("builder").close();
  S.set = { total: Math.round(t * 60), started: Date.now(), rows: [], ids: pick.map(q => q.id), mins }; results = pick; track("set_start", { mins, type, n: pick.length, units: [...units] }); openFocus(0);
};
function endSet() {
  clearInterval(ft); const st = S.set; S.set = null; if ($("focus").open) $("focus").close(); const D = S.data, rows = st.rows, mcq = rows.filter(r => r.correct !== null), wr = rows.filter(r => r.self_marks !== null);
  const got = mcq.filter(r => r.correct).length + wr.reduce((t, r) => t + r.self_marks, 0), max = mcq.length + wr.reduce((t, r) => t + (r.max_marks || 0), 0), used = (Date.now() - st.started) / 1000; track("set_end", { done: rows.length, n: st.ids.length, got, max, seconds: Math.round(used) });
  const weak = new Map(); rows.filter(missedOf).forEach(r => { const c = D.byId.get(r.question_id)?.codes[0]; if (c) weak.set(c, (weak.get(c) || 0) + 1) });
  info(`<h3>Set finished</h3><p><b class="mono">${got}/${max}</b> marks${max ? ` (${Math.round(100 * got / max)}%)` : ""} · ${rows.length} of ${st.ids.length} questions · ${fmtDur(used)} of ${st.mins} min</p>${weak.size ? `<p class="muted small">Worth another look:</p><ul>${[...weak.keys()].map(c => `<li>${esc(D.sub.get(c)?.name || c)}</li>`).join("")}</ul>` : rows.length ? `<p class="muted small">No weak spots in this set. Nice.</p>` : ""}`); go("home");
}

/* ---------------- PROGRESS ---------------- */
function vProgress() {
  const D = S.data, st = subStats(), a = mine(), byTopic = new Map();
  for (const x of a) { const q = D.byId.get(x.question_id), t = q && D.sub.get(q.codes[0])?.topic; if (!t) continue; const o = byTopic.get(t) || { n: 0, got: 0, max: 0, sec: 0 }; o.n++; o.sec += x.seconds || 0; if (x.correct !== null) { o.got += x.correct ? 1 : 0; o.max += 1 } else if (x.self_marks !== null) { o.got += x.self_marks; o.max += x.max_marks || 0 } byTopic.set(t, o) }
  $("view").innerHTML = `<section class="panel"><h2>Your results by unit</h2>${byTopic.size ? `<div class="tw"><table><thead><tr><th>Unit</th><th>Done</th><th>Score</th><th>Avg time</th></tr></thead><tbody>${D.topics.filter(t => byTopic.get(t.id)).map(t => { const o = byTopic.get(t.id); return `<tr><td>${esc(t.id)} · ${esc(t.name)}</td><td class="mono">${o.n}</td><td class="mono">${o.max ? Math.round(100 * o.got / o.max) + "%" : "—"}</td><td class="mono">${fmtTime(o.sec / o.n)}</td></tr>` }).join("")}</tbody></table></div>` : `<p class="empty">Complete a few questions and your scores per unit will appear here.</p>`}</section>
  <section class="panel"><h2>Syllabus map</h2><p class="muted small">Every subtopic with how many of its questions you have done. Amber codes are HL only. “Often examined” marks the topics that come up most in past papers. Tap a row to practise it.</p><div class="units">${unitsHtml(st)}</div></section>`; bindRows();
}

/* ---------------- ACCOUNT ---------------- */
function vAccount() {
  const a = S.attempts.filter(x => x.status === "completed").slice(-15).reverse();
  $("view").innerHTML = `<section class="panel"><h2>${esc(S.user.name)}</h2><p class="muted">${esc(S.user.email || "")}${DEMO ? " · demo mode: progress is stored in this browser only" : ""}</p></section>
  <section class="panel"><h2>Recent activity</h2>${a.length ? `<div class="tw"><table><thead><tr><th>When</th><th>Question</th><th>Result</th><th>Time</th></tr></thead><tbody>${a.map(x => `<tr><td>${esc((x.created_at || "").slice(0, 16).replace("T", " "))}</td><td class="mono">${esc(x.question_id)}</td><td>${x.correct === true ? "✓" : x.correct === false ? "✗ " + esc(x.chosen) : (x.self_marks ?? "–") + "/" + (x.max_marks ?? "")}</td><td class="mono">${fmtTime(x.seconds || 0)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing yet.</p>`}</section>`;
}
/* account menu (top right) */
function drawAcct() { $("acct-av").textContent = (S.user.name || "?").trim()[0].toUpperCase(); $("acct-n").textContent = $("acct-name").textContent = S.user.name; $("acct-email").textContent = S.user.email || ""; $("acct-theme").textContent = document.documentElement.dataset.theme === "light" ? "Dark mode" : "Light mode" }
function acctMenu(open) { $("acctmenu").hidden = !open; $("acctbtn").setAttribute("aria-expanded", open) }
$("acctbtn").onclick = () => acctMenu($("acctmenu").hidden);
document.addEventListener("click", e => { if (!e.target.closest(".acct")) acctMenu(false) });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("acctmenu").hidden) { acctMenu(false); $("acctbtn").focus() } });
$("acctmenu").onclick = async e => {
  const b = e.target.closest("[data-a]"); if (!b) return; acctMenu(false);
  ({
    activity: () => go("account"),
    theme: () => { const nx = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = nx; ls.set("qb_theme", nx); drawAcct() },
    fb: () => { const t = prompt("What should we fix or add?"); if (t && t.trim()) { track("feedback", { rating: "free", text: t.trim().slice(0, 1000) }); S.fb++; if (DEMO) ls.set("qb_fb", S.fb); else sb.auth.updateUser({ data: { fb_count: S.fb } }); drawXp(); toast("Thank you  +15 XP") } },
    out: async () => { await flush(); if (DEMO) { localStorage.removeItem("qb_demo_user"); S.user = null; showAuth() } else await sb.auth.signOut() },
    wipe: async () => { if (!confirm("Reset all your progress and saved questions? Every question will show up again. This cannot be undone.")) return; if (DEMO) ls.set("qb_attempts", []); else { const { error } = await sb.from("attempts").delete().eq("user_id", S.user.id); if (error) return toast(error.message) } S.attempts = []; track("reset_progress"); drawXp(); toast("Fresh start"); go("home") },
  })[b.dataset.a]();
};
document.documentElement.dataset.theme = ls.get("qb_theme", null) || "dark"; // dark unless the student chose light
boot();
})();
