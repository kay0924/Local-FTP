// "Folder access" section inside FileBrowser's own user edit form (Settings → User Management → user).
// Injected into FileBrowser pages by the nginx front proxy (sub_filter). Served from branding/img.
// It does not save anything by itself: when FileBrowser's own Save sends the user to /api/users,
// this script writes scope "/" + rules for the ticked folders into that same request.
//   only folders A,B : scope "/" + [Deny regex ^/.+ , Allow regex ^/(A|B)(/|$)]
//   all folders      : scope "/" + no rules
(function () {
  "use strict";
  if (window.__fbFolders) return; window.__fbFolders = true;
  const DENY_ALL = "^/.+";
  const ROUTE = /^\/settings\/users\/(\d+|new)\/?$/;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unesc = s => s.replace(/\\(.)/g, "$1");
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };

  // current panel state (null = not on a user edit page / not managing)
  let S = null;

  /* ---------- styles ---------- */
  const css = `
  .fbf{margin:1.2em 0 1.4em;padding:1em 1.1em;border:1px solid rgba(200,170,255,.22);border-radius:12px;background:rgba(157,92,255,.07)}
  .fbf h3{margin:0 0 .25em}
  .fbf .fbf-help{margin:0 0 .8em;font-size:.85em;opacity:.8}
  .fbf .fbf-top{display:flex;flex-wrap:wrap;gap:.6em 1.4em;align-items:center;margin-bottom:.7em}
  .fbf label{display:inline-flex;align-items:center;gap:.45em;cursor:pointer;user-select:none}
  .fbf .fbf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.45em .8em;max-height:260px;overflow:auto;padding:.2em}
  .fbf .fbf-grid label{padding:.45em .6em;border-radius:9px;border:1px solid rgba(200,170,255,.14);background:rgba(0,0,0,.18);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fbf .fbf-grid label.on{border-color:rgba(224,64,232,.6);background:rgba(224,64,232,.14)}
  .fbf .fbf-grid i{font-size:1.15em;color:#B07CFF}
  .fbf .fbf-note{margin:.7em 0 0;font-size:.85em;color:#F5B544}
  .fbf .fbf-count{font-size:.85em;opacity:.8}
  .fbf input[type=checkbox]{accent-color:#9D5CFF;width:1.05em;height:1.05em}
  .fbf .fbf-dis{opacity:.45;pointer-events:none}
  .fbf-hidden{display:none!important}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- API ---------- */
  const token = () => { try { return localStorage.getItem("jwt"); } catch (e) { return null; } };
  const origFetch = window.fetch.bind(window);
  const get = async p => { const r = await origFetch(p, { headers: { "X-Auth": token() } }); if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); };

  /* ---------- rules <-> access ---------- */
  function readAccess(u, folders) {
    if (!u) return { kind: "some", set: new Set() };                       // new user: nothing yet
    if (u.perm && u.perm.admin) return { kind: "admin", set: new Set() };
    const rules = u.rules || [], scope = (u.scope || "/").replace(/\/+$/, "") || "/";
    if ((scope === "/" || scope === ".") && !rules.length) return { kind: "all", set: new Set() };
    if (scope !== "/" && !rules.length) {
      const n = scope.replace(/^\.?\//, "");
      return (!n.includes("/") && folders.includes(n)) ? { kind: "some", set: new Set([n]) } : { kind: "custom", set: new Set() };
    }
    if (scope === "/" && rules[0] && !rules[0].allow && rules[0].regex && rules[0].regexp && rules[0].regexp.raw === DENY_ALL) {
      if (rules.length === 1) return { kind: "some", set: new Set() };
      const r = rules[1], m = rules.length === 2 && r.allow && r.regex && r.regexp && /^\^\/\((.*)\)\(\/\|\$\)$/.exec(r.regexp.raw);
      if (m) return { kind: "some", set: new Set(m[1].split(/(?<!\\)\|/).map(unesc)) };
    }
    return { kind: "custom", set: new Set() };
  }
  function buildRules(all, set) {
    if (all) return [];
    const rules = [{ allow: false, path: "", regex: true, regexp: { raw: DENY_ALL } }];
    const names = [...set].sort();
    if (names.length) rules.push({ allow: true, path: "", regex: true, regexp: { raw: `^/(${names.map(esc).join("|")})(/|$)` } });
    return rules;
  }

  /* ---------- hook FileBrowser's own save ---------- */
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((init && init.method) || "GET").toUpperCase();
      if (S && S.managed && (method === "PUT" || method === "POST") && /\/api\/users(\/\d+)?$/.test(new URL(url, location.href).pathname)
          && init && typeof init.body === "string") {
        const b = JSON.parse(init.body);
        const which = b.which || [];
        const fullSave = method === "POST" || which.includes("all");
        if (b.what === "user" && b.data && fullSave && !(b.data.perm && b.data.perm.admin)) {
          b.data.scope = "/";
          b.data.rules = buildRules(S.all, S.set);
          b.data.hideDotfiles = true;
          init = { ...init, body: JSON.stringify(b) };
          if (window.__fbFoldersDryRun) { console.log("[folder access] would send", b); return Promise.resolve(new Response("", { status: 200 })); }
        }
      }
    } catch (e) { console.warn("[folder access]", e); }
    return origFetch(input, init);
  };

  /* ---------- panel ---------- */
  function findParts() {
    const scope = document.getElementById("scope");
    if (!scope) return null;
    const scopeP = scope.closest("p");
    const rulesForm = document.querySelector("form.rules");
    const rulesBox = rulesForm ? rulesForm.parentElement : null;
    return { scopeP, rulesBox };
  }
  function setNativeHidden(hide) {
    const p = findParts(); if (!p) return;
    p.scopeP && p.scopeP.classList.toggle("fbf-hidden", hide);
    // "create user home directory" checkbox sits right after scope on new users
    const next = p.scopeP && p.scopeP.nextElementSibling;
    if (next && next.classList.contains("small") && next.querySelector("input[type=checkbox]")) next.classList.toggle("fbf-hidden", hide);
    p.rulesBox && p.rulesBox.classList.toggle("fbf-hidden", hide);
  }

  async function mount(id) {
    const parts = findParts(); if (!parts || !parts.scopeP) return;
    const key = id + "@" + location.pathname;
    if (document.querySelector(".fbf") && S && S.key === key) return;
    document.querySelectorAll(".fbf").forEach(x => x.remove());
    const box = el("div", "fbf"); box.append(el("h3", null, "Folder access"), el("p", "fbf-help", "Loading folders…"));
    parts.scopeP.parentNode.insertBefore(box, parts.scopeP);
    S = { key, managed: false, all: false, set: new Set() };
    let folders = [], user = null;
    try {
      const listing = await get("/api/resources/");
      folders = (listing.items || []).filter(i => i.isDir && !i.name.startsWith(".")).map(i => i.name).sort((a, b) => a.localeCompare(b));
      if (id !== "new") user = await get("/api/users/" + id);
    } catch (e) { box.querySelector(".fbf-help").textContent = "Could not load folders (" + e.message + ")."; return; }
    if (!S || S.key !== key) return;                                    // navigated away meanwhile
    const acc = readAccess(user, folders);
    S.all = acc.kind === "all"; S.set = acc.set; S.managed = acc.kind === "all" || acc.kind === "some";
    render(box, folders, acc.kind);
  }

  function render(box, folders, kind) {
    box.replaceChildren();
    box.append(el("h3", null, "Folder access"));
    if (kind === "admin") {
      box.append(el("p", "fbf-help", "Administrators always see every folder."));
      S.managed = false; setNativeHidden(false); return;
    }
    box.append(el("p", "fbf-help", "Tick the folders this user can open. Everything else is hidden from them. Saved with the Save button below."));

    const top = el("div", "fbf-top");
    const manage = el("label"), mcb = el("input"); mcb.type = "checkbox"; mcb.checked = S.managed;
    manage.append(mcb, document.createTextNode("Use folder checkboxes"));
    const allL = el("label"), acb = el("input"); acb.type = "checkbox"; acb.checked = S.all;
    allL.append(acb, document.createTextNode("All folders (incl. future ones)"));
    const count = el("span", "fbf-count");
    top.append(manage, allL, count); box.append(top);

    const grid = el("div", "fbf-grid");
    for (const f of folders) {
      const l = el("label"), cb = el("input"), ic = el("i", "material-icons", "folder");
      cb.type = "checkbox"; cb.checked = S.all || S.set.has(f); cb.dataset.f = f;
      l.title = f; l.append(cb, ic, document.createTextNode(f));
      cb.onchange = () => {
        if (S.all) { S.all = false; acb.checked = false; S.set = new Set(folders); }
        cb.checked ? S.set.add(f) : S.set.delete(f);
        sync();
      };
      grid.append(l);
    }
    if (!folders.length) grid.append(el("span", "fbf-help", "No folders yet — create one in My files first."));
    box.append(grid);

    const note = el("p", "fbf-note");
    box.append(note);

    function sync() {
      grid.querySelectorAll("input").forEach(c => { c.checked = S.all || S.set.has(c.dataset.f); c.parentElement.classList.toggle("on", c.checked); });
      const on = S.managed;
      grid.classList.toggle("fbf-dis", !on || S.all); allL.classList.toggle("fbf-dis", !on);
      count.textContent = !on ? "" : S.all ? "all folders" : `${S.set.size} of ${folders.length} folders`;
      note.textContent = !on ? (kind === "custom"
          ? "This user has hand-written Scope/Rules (shown below). Tick “Use folder checkboxes” to replace them with the checkboxes."
          : "Using the Scope and Rules fields below.")
        : (!S.all && !S.set.size ? "No folders ticked — this user will see nothing." : "");
      setNativeHidden(on);
    }
    mcb.onchange = () => { S.managed = mcb.checked; sync(); };
    acb.onchange = () => { S.all = acb.checked; if (!S.all && !S.set.size) S.set = new Set(); sync(); };
    sync();
  }

  /* ---------- follow FileBrowser's page changes ---------- */
  let pending = false;
  function check() {
    pending = false;
    const m = ROUTE.exec(location.pathname);
    if (!m) { if (S) { S = null; } document.querySelectorAll(".fbf").forEach(x => x.remove()); return; }
    if (document.getElementById("scope") && !document.querySelector(".fbf")) mount(m[1]);
  }
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(check); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  check();
})();
