export const SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>suxdash</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
  body { margin: 0; padding: 1.5rem; max-width: 780px; margin-inline: auto; }
  h1 { font-size: 1.1rem; }
  .panel { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; padding: 1rem; }
  .item { padding: .4rem 0; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  .item:first-child { border-top: 0; }
  .badge { font-size: .7rem; opacity: .7; border: 1px solid currentColor; border-radius: 999px; padding: 0 .4rem; margin-right: .4rem; }
  .stale { opacity: .5; }
  button { font: inherit; padding: .35rem .7rem; border-radius: 8px; cursor: pointer; }
  input, textarea { font: inherit; width: 100%; box-sizing: border-box; margin: .25rem 0; padding: .4rem; }
  dialog { border: 1px solid; border-radius: 10px; max-width: 460px; }
</style>
</head>
<body>
  <h1>suxdash — Fabric</h1>
  <div id="meta" class="stale">loading…</div>
  <div id="panel" class="panel"></div>

  <dialog id="dlg">
    <form method="dialog" id="form">
      <p><strong>File a fabric issue</strong></p>
      <input id="repo" placeholder="repo (e.g. sux)" />
      <input id="title" placeholder="issue title" />
      <textarea id="body" rows="3" placeholder="body"></textarea>
      <pre id="preview" class="stale"></pre>
      <menu style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button value="cancel">Cancel</button>
        <button id="preview-btn" value="default">Preview</button>
        <button id="confirm-btn" disabled>Confirm &amp; file</button>
      </menu>
    </form>
  </dialog>

<script type="module">
// Panel items carry untrusted text (GitHub issue/PR titles) — render as inert
// data via DOM nodes, never interpolated into innerHTML (see design doc §5).
function itemNode(i) {
  var div = document.createElement("div");
  div.className = "item";
  if (i.badge) {
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = i.badge;
    div.appendChild(badge);
  }
  if (i.url) {
    var a = document.createElement("a");
    a.href = i.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = i.title;
    div.appendChild(a);
  } else {
    div.appendChild(document.createTextNode(i.title));
  }
  if (i.subtitle) {
    var sub = document.createElement("small");
    sub.className = "stale";
    sub.textContent = " " + i.subtitle;
    div.appendChild(sub);
  }
  return div;
}

async function load() {
  const res = await fetch("/api/fabric");
  const p = await res.json();
  const el = document.getElementById("panel");
  el.replaceChildren.apply(el, p.items.map(itemNode));
  var ageMs = p.staleAt - Date.now();
  document.getElementById("meta").textContent =
    ageMs > 0 ? "fresh · refreshes in " + Math.round(ageMs / 1000) + "s"
              : "stale — refresh to update";
  var bar = document.createElement("div");
  bar.style.margin = "1rem 0";
  (p.actions || []).forEach(function (a) {
    if (a.verb !== "dispatch-issue") return;
    var b = document.createElement("button");
    b.textContent = a.label;
    b.onclick = function () { document.getElementById("dlg").showModal(); };
    bar.appendChild(b);
  });
  el.after(bar);
}

function payload() {
  return {
    repo: document.getElementById("repo").value,
    title: document.getElementById("title").value,
    body: document.getElementById("body").value,
  };
}

document.getElementById("preview-btn").addEventListener("click", async function (e) {
  e.preventDefault();
  try {
    var res = await fetch("/api/act/dispatch-issue?dry=1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    var plan = await res.json();
    if (!res.ok) throw new Error(plan && plan.error ? plan.error : "request failed");
    document.getElementById("preview").textContent = plan.summary + "  →  " + plan.target;
    document.getElementById("confirm-btn").disabled = false;
  } catch (err) {
    document.getElementById("preview").textContent = "error: " + err.message;
    document.getElementById("confirm-btn").disabled = true;
  }
});

document.getElementById("confirm-btn").addEventListener("click", async function (e) {
  e.preventDefault();
  var res = await fetch("/api/act/dispatch-issue", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  var out = await res.json();
  document.getElementById("preview").textContent = out.ok ? "filed: " + out.url : "error: " + out.error;
  document.getElementById("confirm-btn").disabled = true;
});

load();
</script>
</body>
</html>`;
