/* /stagingsite/banner.js
 * Floating "Deploy to Production" bar.
 * Copies /stagingsite/* (minus banner + base tags) to /
 * Requires the same GitHub PAT the editor stored in localStorage.
 */
(function () {
  const REPO_OWNER = 'DenFCS';
  const REPO_NAME = 'website';
  const BRANCH = 'main';
  const PAT_KEY = 'denfcs_editor_pat';

  // ---------- UI ----------
  const style = document.createElement('style');
  style.textContent = `
    .sb-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #0D0D0D; color: #E8E4DC;
      border-bottom: 2px solid #C8A84E;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      padding: 10px 16px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 4px 18px rgba(0,0,0,0.4);
    }
    .sb-left { display:flex; align-items:center; gap:12px; }
    .sb-dot { width:8px; height:8px; border-radius:50%; background:#C8A84E; box-shadow: 0 0 8px #C8A84E; }
    .sb-label { letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; font-size: 12px; }
    .sb-muted { color:#9A9588; font-size:12px; }
    .sb-btns { display:flex; gap:8px; }
    .sb-btn {
      background:#C8A84E; color:#0D0D0D; border:none; cursor:pointer;
      padding: 8px 16px; font-weight:700; letter-spacing:1px;
      text-transform:uppercase; font-size:12px; border-radius:2px;
    }
    .sb-btn:hover { background:#E0C872; }
    .sb-btn.sb-btn-ghost { background:transparent; color:#E8E4DC; border:1px solid #3a3a3a; }
    .sb-btn.sb-btn-ghost:hover { border-color:#C8A84E; color:#C8A84E; }
    .sb-btn:disabled { opacity:0.5; cursor:not-allowed; }
    body { padding-top: 48px !important; }

    .sb-modal-bg {
      position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:99998;
      display:flex; align-items:center; justify-content:center;
      font-family:-apple-system, BlinkMacSystemFont, sans-serif;
    }
    .sb-modal {
      background:#141414; color:#E8E4DC; padding:28px 32px; max-width:520px;
      border:1px solid #C8A84E; border-radius:4px;
    }
    .sb-modal h3 { margin:0 0 12px; font-size:20px; letter-spacing:1px; }
    .sb-modal p { margin:0 0 16px; font-size:14px; line-height:1.6; color:#ccc; }
    .sb-modal code { background:#0D0D0D; padding:2px 6px; border-radius:2px; font-size:12px; color:#C8A84E; }
    .sb-modal input {
      width:100%; padding:10px; margin-bottom:16px; background:#0D0D0D;
      border:1px solid #333; color:#fff; font-family:monospace; font-size:13px;
    }
    .sb-modal-btns { display:flex; gap:8px; justify-content:flex-end; }
    .sb-log {
      margin-top:12px; max-height:180px; overflow:auto;
      background:#0D0D0D; padding:10px; border:1px solid #222;
      font-family:monospace; font-size:11px; color:#9A9588;
      white-space:pre-wrap;
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'sb-bar';
  bar.innerHTML = `
    <div class="sb-left">
      <span class="sb-dot"></span>
      <span class="sb-label">Staging Preview</span>
      <span class="sb-muted">— changes here are not yet on production</span>
    </div>
    <div class="sb-btns">
      <a href="/editor/" class="sb-btn sb-btn-ghost" style="text-decoration:none;">Open Editor</a>
      <button class="sb-btn" id="sb-deploy">Deploy to Production</button>
    </div>`;
  document.body.insertBefore(bar, document.body.firstChild);

  document.getElementById('sb-deploy').addEventListener('click', openConfirm);

  // ---------- Deploy flow ----------
  function openConfirm() {
    const bg = document.createElement('div');
    bg.className = 'sb-modal-bg';
    bg.innerHTML = `
      <div class="sb-modal">
        <h3>Deploy staging to production?</h3>
        <p>This will replace the live site at <code>thedenfcs.com</code> with whatever is currently at <code>/stagingsite</code>. This cannot be undone from the browser (but every version is saved in git history).</p>
        <div class="sb-modal-btns">
          <button class="sb-btn sb-btn-ghost" id="sb-cancel">Cancel</button>
          <button class="sb-btn" id="sb-confirm">Yes, deploy now</button>
        </div>
        <div class="sb-log" id="sb-log" style="display:none;"></div>
      </div>`;
    document.body.appendChild(bg);
    document.getElementById('sb-cancel').onclick = () => bg.remove();
    document.getElementById('sb-confirm').onclick = () => runDeploy(bg);
  }

  function log(msg) {
    const el = document.getElementById('sb-log');
    if (!el) return;
    el.style.display = 'block';
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
  }

  async function getPat() {
    let pat = localStorage.getItem(PAT_KEY);
    if (pat) return pat;
    pat = prompt('GitHub token needed for deploy.\n\nCreate at https://github.com/settings/tokens (classic, repo scope). Paste here:');
    if (pat) localStorage.setItem(PAT_KEY, pat);
    return pat;
  }

  async function gh(path, opts = {}) {
    const pat = await getPat();
    if (!pat) throw new Error('No token');
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`, {
      ...opts,
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub API ${res.status}: ${t}`);
    }
    return res.json();
  }

  // Strip staging-only markers so production is clean
  function cleanForProd(html) {
    return html
      .replace(/<!-- staging-base-start -->[\s\S]*?<!-- staging-base-end -->\s*/g, '')
      .replace(/<!-- staging-banner-start -->[\s\S]*?<!-- staging-banner-end -->\s*/g, '')
      // Generic staging title suffix strip: " (Staging)" right before </title>
      .replace(/\s*\(Staging\)(\s*<\/title>)/i, '$1')
      // Home page specifically used "Where the Den Trains" for staging; restore.
      .replace(/Where the Den Trains(\s*<\/title>)/i, 'Where the Best Train$1');
  }

  // Recursively collect all files under stagingsite/<subPath>, skipping banner.js.
  async function listStagingRecursive(subPath) {
    const contents = await gh(`/contents/stagingsite${subPath}?ref=${BRANCH}`);
    const out = [];
    for (const entry of contents) {
      if (entry.type === 'dir') {
        const kids = await listStagingRecursive(subPath + '/' + entry.name);
        out.push(...kids);
      } else if (entry.type === 'file') {
        if (entry.name === 'banner.js') continue; // staging-only asset
        out.push({
          stagingPath: entry.path,                              // e.g. "stagingsite/summerprogram/index.html"
          prodPath: entry.path.replace(/^stagingsite\/?/, ''),  // e.g. "summerprogram/index.html"
          downloadUrl: entry.download_url,
          name: entry.name,
        });
      }
    }
    return out;
  }

  async function runDeploy(bg) {
    const btn = document.getElementById('sb-confirm');
    btn.disabled = true;
    btn.textContent = 'Deploying…';
    try {
      log('Listing staging files (recursive)…');
      const files = await listStagingRecursive('');
      log(`Found ${files.length} file(s) to deploy.`);

      for (const f of files) {
        log(`→ ${f.prodPath}`);
        // Fetch staging file content
        const blobRes = await fetch(f.downloadUrl, { cache: 'no-store' });
        const isHtml = f.name.toLowerCase().endsWith('.html');
        let body;
        if (isHtml) {
          const text = await blobRes.text();
          body = cleanForProd(text);
        } else {
          const buf = await blobRes.arrayBuffer();
          body = new Uint8Array(buf);
        }

        // Existing prod sha?
        let prodSha = null;
        try {
          const existing = await gh(`/contents/${f.prodPath}?ref=${BRANCH}`);
          prodSha = existing.sha;
        } catch (e) { /* missing is ok */ }

        const b64 = isHtml
          ? btoa(unescape(encodeURIComponent(body)))
          : btoa(Array.from(body).map(b => String.fromCharCode(b)).join(''));

        await gh(`/contents/${f.prodPath}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Deploy staging → production: ${f.prodPath}`,
            content: b64,
            branch: BRANCH,
            ...(prodSha ? { sha: prodSha } : {}),
          }),
        });
      }

      log('✓ Done. Pages will rebuild in ~30s.');
      btn.textContent = 'Deployed ✓';
      setTimeout(() => { window.location.href = '/'; }, 2500);
    } catch (err) {
      log('ERROR: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  }
})();
