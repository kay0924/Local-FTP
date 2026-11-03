// Folder Access — per-user folder picker for FileBrowser (served from branding/img, same origin as FileBrowser).
// Each user's access is stored as FileBrowser rules:
//   scope "/" + [Deny regex ^/.+ , Allow regex ^/(FolderA|FolderB)(/|$)]   → only those top-level folders
//   scope "/" + no rules                                                   → all folders
"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const DENY_ALL = "^/.+";
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unesc = s => s.replace(/\\(.)/g, "$1");
  const AV = ["#9D5CFF", "#E040E8", "#4CC9F0", "#3DDC97", "#F5B544", "#FF5C7A", "#6C8CFF"];
  const avColor = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };

  let users = [], folders = [], state = {}, orig = {}, password = null, hl = null;

  /* ---------- API ---------- */
  function token() { try { return localStorage.getItem("jwt"); } catch (e) { return null; } }
  async function api(path, opts = {}) {
    const t = token();
    if (!t) throw Object.assign(new Error("not logged in"), { status: 401 });
    const r = await fetch(path, { ...opts, headers: { "X-Auth": t, ...(opts.headers || {}) } });
    if (r.headers.get("X-Renew-Token") === "true") renew(t);
    if (!r.ok) throw Object.assign(new Error((await r.text()) || r.statusText), { status: r.status });
    return r;
  }
  async function renew(t) {
    try {
      const r = await fetch("/api/renew", { method: "POST", headers: { "X-Auth": t } });
      if (r.ok) { const n = await r.text(); localStorage.setItem("jwt", n); document.cookie = `auth=${n}; Path=/; SameSite=Strict;`; }
    } catch (e) { /* keep old token */ }
  }

  /* ---------- rules <-> access ---------- */
  function readAccess(u) {
    if (u.perm && u.perm.admin) return { kind: "admin", set: new Set() };
    const rules = u.rules || [], scope = (u.scope || "/").replace(/\/+$/, "") || "/";
    if (scope === "/" && rules.length === 0) return { kind: "all", set: new Set() };
    if (scope !== "/" && rules.length === 0) {
      const name = scope.replace(/^\//, "");
      if (!name.includes("/") && folders.includes(name)) return { kind: "some", set: new Set([name]) };
      return { kind: "custom", set: new Set() };
    }
    if (scope === "/" && rules[0] && !rules[0].allow && rules[0].regex && rules[0].regexp && rules[0].regexp.raw === DENY_ALL) {
      if (rules.length === 1) return { kind: "some", set: new Set() };
      const r = rules[1];
      if (rules.length === 2 && r.allow && r.regex && r.regexp) {
        const m = /^\^\/\((.*)\)\(\/\|\$\)$/.exec(r.regexp.raw);
        if (m) return { kind: "some", set: new Set(m[1].split(/(?<!\\)\|/).map(unesc)) };
      }
    }
    return { kind: "custom", set: new Set() };
  }
  function buildRules(st) {
    if (st.kind === "all") return [];
    const rules = [{ allow: false, path: "", regex: true, regexp: { raw: DENY_ALL } }];
    const names = [...st.set].sort();
    if (names.length) rules.push({ allow: true, path: "", regex: true, regexp: { raw: `^/(${names.map(esc).join("|")})(/|$)` } });
    return rules;
  }
  const sig = st => st.kind + ":" + [...st.set].sort().join("\u0000");

  /* ---------- load ---------- */
  async function load() {
    $("msg").hidden = false; $("msg").textContent = "Loading…";
    try {
      const [ur, fr] = await Promise.all([api("/api/users"), api("/api/resources/")]);
      users = (await ur.json()).sort((a, b) => a.username.localeCompare(b.username));
      const listing = await fr.json();
      folders = (listing.items || []).filter(i => i.isDir && !i.name.startsWith(".")).map(i => i.name).sort((a, b) => a.localeCompare(b));
      state = {}; orig = {};
      for (const u of users) { const a = readAccess(u); state[u.id] = { kind: a.kind, set: new Set(a.set) }; orig[u.id] = sig(a); }
      render();
    } catch (e) {
      $("grid").replaceChildren();
      const m = $("msg"); m.hidden = false; m.replaceChildren();
      if (e.status === 401 || e.status === 403) {
        m.append(el("b", null, e.status === 401 ? "Please log in first" : "Admins only"),
          document.createTextNode(e.status === 401 ? "Log in to File Server as an admin, then come back to this page." : "Only admin accounts can manage folder access."));
        const a = el("a", "pill", "Go to login"); a.href = "/login"; a.style.marginTop = "14px"; m.append(el("br"), a);
      } else m.append(el("b", null, "Could not load"), document.createTextNode(e.message));
    }
  }

  /* ---------- render ---------- */
  function changedIds() { return users.filter(u => state[u.id] && sig(state[u.id]) !== orig[u.id]).map(u => u.id); }
  function hasAccess(u, f) { const s = state[u.id]; return s.kind === "admin" || s.kind === "all" || (s.kind === "some" && s.set.has(f)); }

  function render() {
    const q = $("filter").value.trim().toLowerCase();
    const fs = folders.filter(f => !q || f.toLowerCase().includes(q) || users.some(u => u.username.toLowerCase().includes(q)));
    const us = users.filter(u => !q || u.username.toLowerCase().includes(q) || folders.some(f => f.toLowerCase().includes(q)));
    const showF = fs.filter(f => !q || f.toLowerCase().includes(q)).length ? fs.filter(f => !q || f.toLowerCase().includes(q)) : fs;
    const showU = us.filter(u => !q || u.username.toLowerCase().includes(q)).length ? us.filter(u => !q || u.username.toLowerCase().includes(q)) : us;

    const tbl = $("grid"); tbl.replaceChildren();
    $("msg").hidden = true;
    if (!users.length) { $("msg").hidden = false; $("msg").textContent = "No users yet — create them in Settings → User Management."; }
    else if (!folders.length) { $("msg").hidden = false; $("msg").textContent = "No folders yet — create one above."; }

    const thead = el("thead"), hr = el("tr");
    hr.append(el("th", "usr", "User"));
    const allTh = el("th", null, "All folders"); hr.append(allTh);
    for (const f of showF) {
      const th = el("th", "fold" + (hl === f ? " hl" : "")); th.title = "Click to highlight who can open " + f;
      th.append(el("span", "nm", f), el("span", "ct", (n => n + (n === 1 ? " user" : " users"))(users.filter(u => hasAccess(u, f)).length)));
      th.onclick = () => { hl = hl === f ? null : f; render(); };
      hr.append(th);
    }
    thead.append(hr); tbl.append(thead);

    const tb = el("tbody");
    for (const u of showU) {
      const s = state[u.id], tr = el("tr", sig(s) !== orig[u.id] ? "changed" : "");
      const tdU = el("td", "usr"), box = el("div", "u"), av = el("span", "av", u.username.slice(0, 2).toUpperCase());
      av.style.background = avColor(u.username);
      const info = el("div"); info.append(el("div", "un", u.username));
      const tagTxt = { admin: ["admin", "admin · sees all"], all: ["all", "all folders"], custom: ["custom", "custom rules"] }[s.kind];
      if (tagTxt) info.append(el("span", "tag " + tagTxt[0], tagTxt[1]));
      else info.append(el("span", "tag none", s.set.size ? s.set.size + " folder" + (s.set.size > 1 ? "s" : "") : "no folders"));
      box.append(av, info); tdU.append(box); tr.append(tdU);

      const tdA = el("td"), allCb = el("input", "cb"); allCb.type = "checkbox";
      allCb.checked = s.kind === "all" || s.kind === "admin"; allCb.disabled = s.kind === "admin";
      allCb.title = s.kind === "admin" ? "Admins always see everything" : "Access to all folders (including future ones)";
      allCb.onchange = () => { if (allCb.checked) state[u.id] = { kind: "all", set: new Set() }; else state[u.id] = { kind: "some", set: new Set() }; render(); };
      tdA.append(allCb); tr.append(tdA);

      for (const f of showF) {
        const td = el("td", hl === f ? "hl" : ""), cb = el("input", "cb"); cb.type = "checkbox";
        cb.checked = hasAccess(u, f); cb.disabled = s.kind === "admin";
        cb.title = `${u.username} → ${f}`;
        cb.onchange = () => {
          let st = state[u.id];
          if (st.kind === "all") st = { kind: "some", set: new Set(folders) };     // un-ticking one folder from "all"
          else if (st.kind !== "some") st = { kind: "some", set: new Set() };      // custom → managed here
          cb.checked ? st.set.add(f) : st.set.delete(f);
          state[u.id] = st; render();
        };
        td.append(cb); tr.append(td);
      }
      tb.append(tr);
    }
    tbl.append(tb);
    const n = changedIds().length;
    $("save").disabled = !n; $("undo").disabled = !n;
    $("save").textContent = n ? `Save changes (${n} user${n > 1 ? "s" : ""})` : "Save changes";
  }

  /* ---------- save ---------- */
  function askPassword() {
    return new Promise(resolve => {
      const m = $("pwModal"), inp = $("pw"); m.classList.add("show"); inp.value = ""; setTimeout(() => inp.focus(), 30);
      const done = v => { m.classList.remove("show"); $("pwOk").onclick = $("pwCancel").onclick = inp.onkeydown = null; resolve(v); };
      $("pwOk").onclick = () => done(inp.value);
      $("pwCancel").onclick = () => done(null);
      inp.onkeydown = e => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); };
    });
  }
  async function save() {
    const ids = changedIds(); if (!ids.length) return;
    if (password == null) { password = await askPassword(); if (!password) { password = null; return; } }
    $("save").disabled = true; $("save").textContent = "Saving…";
    let ok = 0, fail = [], failedIds = [];
    for (const id of ids) {
      const u = users.find(x => x.id === id), st = state[id];
      const data = { ...u, id, scope: "/", rules: buildRules(st), hideDotfiles: true };
      try {
        await api(`/api/users/${id}`, { method: "PUT",
          body: JSON.stringify({ what: "user", which: ["scope", "rules", "hideDotfiles"], current_password: password, data }) });
        ok++;
      } catch (e) {
        fail.push(u.username + ": " + e.message); failedIds.push(id);
        if (e.status === 401 || e.status === 403) password = null;   // wrong password → ask again next time
      }
    }
    const keep = {}; for (const id of failedIds) keep[id] = state[id];      // unsaved ticks survive a failed save
    await load();
    for (const id of failedIds) if (state[id]) state[id] = keep[id];
    if (failedIds.length) render();
    const wrongPw = fail.some(f => /403|forbidden|password/i.test(f));
    toast(fail.length ? (wrongPw ? "Wrong admin password — nothing saved for " + failedIds.length + " user(s). Try Save again."
                                 : `Saved ${ok}, failed ${fail.length} — ${fail[0]}`)
                      : `Saved access for ${ok} user${ok > 1 ? "s" : ""}`, !!fail.length);
  }

  async function createFolder() {
    const name = $("newFolder").value.trim();
    if (!name || /[\/\\]/.test(name) || name.startsWith(".")) { toast("Enter a folder name (no / or \\, not starting with .)", true); return; }
    if (folders.includes(name)) { toast("That folder already exists", true); return; }
    try {
      await api("/api/resources/" + encodeURIComponent(name) + "/?override=false", { method: "POST" });
      $("newFolder").value = ""; toast(`Folder “${name}” created`);
      const keep = { ...state }; await load();
      for (const u of users) if (keep[u.id] && sig(keep[u.id]) !== orig[u.id]) state[u.id] = keep[u.id];   // keep unsaved ticks
      render();
    } catch (e) { toast("Could not create folder: " + e.message, true); }
  }

  let tT;
  function toast(t, err) { const x = $("toast"); x.textContent = t; x.className = "toast show" + (err ? " err" : ""); clearTimeout(tT); tT = setTimeout(() => x.className = "toast", 4500); }

  $("save").onclick = save;
  $("undo").onclick = () => { for (const u of users) { const a = readAccess(u); state[u.id] = { kind: a.kind, set: new Set(a.set) }; } render(); };
  $("mkFolder").onclick = createFolder;
  $("newFolder").onkeydown = e => { if (e.key === "Enter") createFolder(); };
  $("filter").oninput = render;
  addEventListener("beforeunload", e => { if (changedIds().length) { e.preventDefault(); e.returnValue = ""; } });
  load();
})();
