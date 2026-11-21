const APP_NAME = 'ScubaPilot';
const APP_VERSION = '1.19';
const APP_RELEASE = 'Novembre 2026';

// ---------- Courriels : copier-coller ----------
// ScubaPilot n'ouvre plus de logiciel de messagerie : chaque élément d'un courriel (adresses, objet,
// message) a un petit bouton 📋 qui le copie, à coller ensuite dans la messagerie de son choix.
function copyText(text) {
  text = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
  }
  return Promise.resolve(copyTextFallback(text));
}
function copyTextFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}
// ---------- Texte mis en forme (messages des courriels) ----------
// Mise en forme volontairement minimale : gras, italique, souligné, double souligné. Le message est
// gardé en HTML très simple (bodyHtml des modèles) ; tout le reste est retiré (sanitizeEmailHtml).
const DOUBLE_UNDERLINE_STYLE = 'text-decoration: underline; text-decoration-style: double; text-underline: double';
function textToHtml(text) {
  return escapeHtml(String(text == null ? '' : text)).replace(/\r?\n/g, '<br>');
}
// Corps HTML d'un modèle : sa version mise en forme si elle existe, sinon son texte brut converti.
function templateBodyHtml(tpl) {
  return tpl && tpl.bodyHtml ? tpl.bodyHtml : textToHtml(tpl ? tpl.body : '');
}
// HTML -> texte brut (pour la version « texte seul » du presse-papiers et le champ body des modèles).
function htmlToPlainText(html) {
  // Un bloc (<div>, <p>, <li>) commence sur une nouvelle ligne, sauf s'il en commence déjà une
  // (comme dans le navigateur : « a<div>b</div> » et « a<br><div>b</div> » donnent deux lignes).
  let out = '';
  String(html || '').split(/(<[^>]*>)/).forEach(part => {
    if (/^<br\s*\/?>$/i.test(part)) out += '\n';
    else if (/^<(div|p|li)\b/i.test(part)) { if (out && !out.endsWith('\n')) out += '\n'; }
    else if (/^<\/(p)>$/i.test(part)) out += '\n';
    else if (!/^</.test(part)) out += part;
  });
  return out
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n$/, '');
}
// Variables dans un message HTML : même règle que mergeTemplate (une variable vide emporte l'espace
// qui la précède), les valeurs sont échappées et leurs retours à la ligne deviennent des <br>.
function mergeTemplateHtml(html, ctx) {
  return String(html || '').replace(/((?:[ \t]|&nbsp;)?)\{(\w+)\}/g, (m, sp, k) => {
    if (ctx[k] === undefined) return m;
    return ctx[k] === '' ? '' : sp + textToHtml(ctx[k]);
  });
}
// Ne garde que le texte, les retours à la ligne et les 4 mises en forme permises.
function sanitizeEmailHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const out = [];
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.push(escapeHtml(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out.push('<br>'); continue; }
      if (['script', 'style', 'head', 'title', 'meta'].includes(tag)) continue;
      const st = (n.getAttribute('style') || '').toLowerCase();
      const wrap = [];
      if (tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|[6-9]00)/.test(st)) wrap.push('b');
      if (tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/.test(st)) wrap.push('i');
      const dbl = (n.classList && n.classList.contains('u2')) || /double/.test(st);
      if (dbl) wrap.push('u2');
      else if (tag === 'u' || /text-decoration[^;]*underline/.test(st)) wrap.push('u');
      const block = ['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'tr'].includes(tag);
      if (block && out.length && !/<br>$/.test(out[out.length - 1]) && out.join('').length) out.push('<br>');
      wrap.forEach(w => out.push(w === 'u2' ? `<span class="u2" style="${DOUBLE_UNDERLINE_STYLE}">` : `<${w}>`));
      walk(n);
      wrap.slice().reverse().forEach(w => out.push(w === 'u2' ? '</span>' : `</${w}>`));
      if (block && n.nextSibling && n.nextSibling.nodeType === 3 && n.nextSibling.nodeValue.trim()) out.push('<br>');
    }
  };
  walk(doc.body.firstChild);
  return out.join('').replace(/(<br>)+$/, '');
}
function richEditorHtml(o) {
  return `<div class="rich-wrap">
    <div class="rich-toolbar" role="toolbar" aria-label="Mise en forme">
      <button type="button" data-cmd="bold" title="Gras (Ctrl+B)" aria-label="Gras"><b>G</b></button>
      <button type="button" data-cmd="italic" title="Italique (Ctrl+I)" aria-label="Italique"><i>I</i></button>
      <button type="button" data-cmd="underline" title="Souligné (Ctrl+U)" aria-label="Souligné"><u>S</u></button>
      <button type="button" data-cmd="double" title="Double souligné" aria-label="Double souligné"><span style="${DOUBLE_UNDERLINE_STYLE}">S</span></button>
      <button type="button" data-cmd="clear" title="Retirer la mise en forme de la sélection" aria-label="Retirer la mise en forme">⌫</button>
    </div>
    <div class="rich-editor ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''} contenteditable="true" role="textbox" aria-multiline="true" aria-label="${escapeHtml(o.label || 'Message')}" spellcheck="true" style="min-height:${o.minHeight || 160}px">${o.html || ''}</div>
  </div>`;
}
function wireRichEditor(container) {
  container.querySelectorAll('.rich-wrap').forEach(wrap => {
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const editor = wrap.querySelector('.rich-editor');
    wrap.querySelectorAll('.rich-toolbar button').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault()); // garde la sélection dans le texte
      b.addEventListener('click', () => {
        editor.focus();
        const cmd = b.dataset.cmd;
        if (cmd === 'double') toggleDoubleUnderline(editor);
        else if (cmd === 'clear') { document.execCommand('removeFormat'); unwrapDoubleInSelection(editor); }
        else document.execCommand(cmd);
      });
    });
    // Coller : on garde les 4 mises en forme permises, on retire le reste (polices, couleurs, tableaux…).
    editor.addEventListener('paste', e => {
      const cd = e.clipboardData; if (!cd) return;
      e.preventDefault();
      const html = cd.getData('text/html');
      document.execCommand('insertHTML', false, html ? sanitizeEmailHtml(html) : textToHtml(cd.getData('text/plain')));
    });
  });
}
function selectionRangeIn(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return editor.contains(r.commonAncestorContainer) ? r : null;
}
function unwrapNode(n) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); }
function unwrapDoubleInSelection(editor) {
  const r = selectionRangeIn(editor); if (!r) return false;
  let found = false;
  let anc = r.commonAncestorContainer; anc = anc.nodeType === 1 ? anc : anc.parentNode;
  const outer = anc.closest('span.u2');
  if (outer && editor.contains(outer)) { unwrapNode(outer); found = true; }
  editor.querySelectorAll('span.u2').forEach(s => { if (r.intersectsNode(s)) { unwrapNode(s); found = true; } });
  return found;
}
function toggleDoubleUnderline(editor) {
  if (unwrapDoubleInSelection(editor)) return;
  const r = selectionRangeIn(editor);
  if (!r || r.collapsed) { toast('Sélectionnez d\'abord le texte à souligner deux fois', true); return; }
  const span = document.createElement('span');
  span.className = 'u2'; span.setAttribute('style', DOUBLE_UNDERLINE_STYLE);
  span.appendChild(r.extractContents());
  r.insertNode(span);
  const sel = window.getSelection(), nr = document.createRange();
  nr.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(nr);
}
// Copie le message avec sa mise en forme (HTML) et une version texte seul pour les messageries
// qui ne gardent pas la mise en forme.
async function copyRich(html) {
  const full = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 11pt">${html}</div>`;
  const text = htmlToPlainText(html);
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([full], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
      return;
    }
  } catch (e) {}
  // Repli : sélectionner le contenu mis en forme et utiliser la copie du navigateur.
  const box = document.createElement('div');
  box.innerHTML = full; box.style.position = 'fixed'; box.style.left = '-9999px';
  document.body.appendChild(box);
  const range = document.createRange(); range.selectNodeContents(box);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  try { document.execCommand('copy'); } catch (e) { await copyText(text); }
  sel.removeAllRanges(); box.remove();
}
// Champ avec bouton « copier » : cf = { id, label, value, area (zone de texte), rows, cls }.
function copyFieldHtml(cf) {
  const idAttr = cf.id ? ` id="${cf.id}"` : '';
  if (cf.rich) {
    // Message mis en forme : éditeur (gras, italique, souligné, double souligné) ; le bouton copie
    // le texte AVEC sa mise en forme, prête à coller dans Outlook ou Gmail.
    return `<div class="copy-field copy-field-rich">
      <div class="copy-field-head"><span class="copy-label">${escapeHtml(cf.label)}</span>
        <button type="button" class="copy-btn" title="Copier : ${escapeHtml(cf.label)} (avec la mise en forme)" aria-label="Copier : ${escapeHtml(cf.label)}">📋 <span>Copier</span></button></div>
      ${richEditorHtml({ id: cf.id, cls: cf.cls, html: cf.html, minHeight: cf.minHeight, label: cf.label })}
    </div>`;
  }
  const input = cf.area
    ? `<textarea${idAttr} class="${cf.cls || ''}" style="min-height:${cf.minHeight || 160}px">${escapeHtml(cf.value || '')}</textarea>`
    : `<input${idAttr} class="${cf.cls || ''}" value="${escapeHtml(cf.value || '')}">`;
  return `<div class="copy-field">
    <div class="copy-field-head"><label${cf.id ? ` for="${cf.id}"` : ''}>${escapeHtml(cf.label)}</label>
      <button type="button" class="copy-btn" title="Copier : ${escapeHtml(cf.label)}" aria-label="Copier : ${escapeHtml(cf.label)}">📋 <span>Copier</span></button></div>
    ${input}
  </div>`;
}
// Branche tous les boutons « copier » d'un conteneur : copie la valeur ACTUELLE du champ voisin.
function wireCopyButtons(container) {
  container.querySelectorAll('.copy-field').forEach(field => {
    const btn = field.querySelector('.copy-btn');
    const editor = field.querySelector('.rich-editor');
    const input = editor || field.querySelector('input, textarea');
    if (!btn || !input || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    if (editor) wireRichEditor(field);
    btn.addEventListener('click', async () => {
      if (editor) {
        const html = sanitizeEmailHtml(editor.innerHTML);
        if (!htmlToPlainText(html).trim()) { toast('Ce champ est vide : rien à copier', true); return; }
        await copyRich(html);
      } else {
        if (!input.value.trim()) { toast('Ce champ est vide : rien à copier', true); return; }
        await copyText(input.value);
      }
      const span = btn.querySelector('span');
      btn.classList.add('copied'); span.textContent = 'Copié';
      setTimeout(() => { btn.classList.remove('copied'); span.textContent = 'Copier'; }, 1600);
    });
  });
}
// ---------- Trace des courriels ----------
// ScubaPilot n'envoie rien lui-même : c'est vous qui indiquez qu'un courriel est parti, avec le
// bouton « Marquer comme envoyé ». La date et le modèle sont notés dans la fiche de l'étudiant
// (champ mailLog de student.json, 20 dernières entrées).
function mailLogText(s) {
  const log = Array.isArray(s.mailLog) ? s.mailLog : [];
  if (!log.length) return 'Aucun courriel noté pour cet étudiant.';
  const m = log[log.length - 1];
  return `Dernier courriel noté : ${shortDate(m.date)}${m.template ? ' — ' + m.template : ''} (${m.kind === 'groupe' ? 'email groupé' : 'email individuel'})` + (log.length > 1 ? ` · ${log.length} au total` : '');
}
function mailLogHistory(s) {
  return (Array.isArray(s.mailLog) ? s.mailLog : []).slice().reverse()
    .map(m => `${shortDate(m.date)} — ${m.template || m.subject || 'courriel'} (${m.kind === 'groupe' ? 'groupé' : 'individuel'})`).join('\n');
}
async function logMailSent(course, students, entry) {
  let done = 0;
  for (const s of students) {
    const log = [...(Array.isArray(s.mailLog) ? s.mailLog : []), entry].slice(-20);
    await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, { mailLog: log });
    s.mailLog = log;
    done++;
  }
  // Met à jour les lignes « Dernier courriel noté » déjà affichées.
  document.querySelectorAll('[data-mail-log]').forEach(node => {
    const s = students.find(x => x.folder === node.dataset.mailLog);
    if (s) { node.textContent = mailLogText(s); node.title = mailLogHistory(s); }
  });
  const sum = document.querySelector('[data-mail-summary]');
  if (sum) sum.textContent = mailSummaryText(course);
  return done;
}
function mailSummaryText(course) {
  const withMail = course.students.filter(s => s.email);
  const never = withMail.filter(s => !(s.mailLog || []).length);
  if (!withMail.length) return '';
  return never.length ? `Courriels : aucun envoi noté pour ${never.length} étudiant(s) sur ${withMail.length} — ${never.map(s => s.firstName).join(', ')}.`
    : `Courriels : un envoi est noté pour chacun des ${withMail.length} étudiant(s) ayant une adresse.`;
}
// Bouton « Marquer comme envoyé » : exécute run(), puis se fige sur « ✔ Noté ».
function wireSentButton(btn, run) {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await run(); btn.textContent = '✔ Noté'; btn.classList.remove('secondary'); }
    catch (e) { btn.disabled = false; toast('Erreur : ' + friendlyError(e), true); }
  });
}

// Fenêtre « courriel à copier » : destinataire, objet et message, chacun avec son bouton copier.
// o.action = { label, run } ajoute un bouton d'action (ex. « Marquer comme envoyé »).
function showMailModal(o) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box modal-wide" role="dialog" aria-modal="true" aria-label="${escapeHtml(o.title || 'Courriel')}">
        <h3>${escapeHtml(o.title || 'Courriel')}</h3>
        <p class="muted">Copiez chaque élément avec 📋, puis collez-le dans votre messagerie.</p>
        ${copyFieldHtml({ label: 'À', value: o.to })}
        ${o.cc ? copyFieldHtml({ label: 'Cc', value: o.cc }) : ''}
        ${copyFieldHtml({ label: 'Objet', value: o.subject })}
        ${o.bodyHtml !== undefined ? copyFieldHtml({ label: 'Message', html: o.bodyHtml, rich: true, minHeight: 200 }) : copyFieldHtml({ label: 'Message', value: o.body, area: true, minHeight: 200 })}
        ${o.note ? `<p class="muted">${escapeHtml(o.note)}</p>` : ''}
        <div class="actions-inline" style="justify-content:flex-end">
          ${o.action ? `<button class="btn secondary" id="mail-modal-action">${escapeHtml(o.action.label)}</button>` : ''}
          <button class="btn secondary" id="mail-modal-close">Fermer</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  wireCopyButtons(overlay);
  const prevFocus = document.activeElement;
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} } };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#mail-modal-close').addEventListener('click', close);
  if (o.action) wireSentButton(overlay.querySelector('#mail-modal-action'), o.action.run);
  setTimeout(() => { const b = overlay.querySelector('.copy-btn'); if (b) b.focus(); }, 0);
}

const state = { settings: null, courseTypes: [], sites: [], studentFields: [], emailTemplates: [], buddies: [], centers: [], billing: null };

// ---------- Helpers ----------
async function api(method, url, body) {
  // X-ScubaPilot : exigé par le serveur pour toute modification (protection contre les autres sites).
  const opts = { method, headers: { 'X-ScubaPilot': '1' } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'ERROR'), { data });
  return data;
}
// Transforme une erreur technique (souvent juste un code renvoyé par le serveur, ex. "ERROR" ou
// "ROOT_NOT_FOUND") en message compréhensible pour l'instructeur. Les appelants qui reconnaissent
// un code précis (ex. CENTER_REQUIRED) le traduisent eux-mêmes avant d'appeler cette fonction ;
// celle-ci sert de filet pour tous les autres cas.
function friendlyError(e) {
  const raw = (e && e.message) || '';
  if (!raw || raw === 'ERROR') return "Une erreur est survenue. Réessayez, et si le problème persiste, vérifiez votre connexion ou le répertoire racine dans Paramètres.";
  if (raw === 'INVALID_DATE') return 'Date invalide : utilisez le format JJ/MM/AAAA.';
  if (raw === 'CORRUPT_FILE') {
    const f = e.data && e.data.file ? ` (${e.data.file})` : '';
    return `Un fichier de données est illisible${f}. Rien n'a été modifié, pour ne pas écraser son contenu. Restaurez une version précédente du fichier (clic droit sur le fichier → Historique des versions dans OneDrive) ou depuis une sauvegarde, puis rechargez la page.`;
  }
  if (raw === 'INVALID_PATH') return "Nom de dossier invalide : l'opération a été refusée.";
  if (raw === 'INVALID_STUDENT_ID') return "Identifiant d'étudiant invalide.";
  if (raw === 'ARCHIVE_IN_PROGRESS') return "Ce cours est déjà en cours d'archivage.";
  if (raw === 'ARCHIVE_INCOMPLETE') return "Des fichiers du cours sont illisibles : il n'a pas été archivé.";
  if (raw === 'FILE_TOO_LARGE') return 'Fichier trop volumineux (plus de 8 Go).';
  if (raw === 'DISK_FULL') return "Le disque est plein : le fichier n'a pas été copié.";
  if (raw === 'UPLOAD_ABORTED') return "L'envoi a été interrompu : le fichier n'a pas été copié.";
  if (raw === 'ROOT_NOT_FOUND') return `Le répertoire racine est introuvable${e.data && e.data.rootDir ? ' (' + e.data.rootDir + ')' : ''}. Vérifiez que OneDrive (ou le disque) est bien disponible.`;
  if (raw === 'COURSE_EXISTS') return 'Un cours portant ce nom existe déjà : opération impossible.';
  if (raw === 'COURSE_NOT_FOUND') return "Le cours de cet étudiant n'existe plus : restaurez d'abord le cours depuis la corbeille.";
  if (raw === 'STUDENT_EXISTS') return 'Un étudiant du même nom existe déjà dans ce cours : restauration impossible.';
  if (raw === 'TRASH_ENTRY_INVALID') return "Cet élément de la corbeille est incomplet et ne peut pas être restauré automatiquement. Son contenu reste dans le dossier _Corbeille.";
  if (raw === 'IMPORT_DIR_NOT_FOUND') return "Ce dossier n'existe pas. Collez le chemin complet de l'ancien dossier de l'application (ou de son dossier « data »).";
  if (raw === 'IMPORT_NOTHING_FOUND') return "Aucun fichier de réglages trouvé dans ce dossier. Indiquez l'ancien dossier de l'application ou son sous-dossier « data ».";
  if (raw === 'IMPORT_SAME_DIR') return 'Ce dossier est déjà celui des réglages en cours.';
  if (raw === 'NOT_A_COURSE' || raw === 'NOT_A_STUDENT') return "Ce dossier n'est pas un cours ou un étudiant géré par ScubaPilot : il n'a pas été supprimé.";
  if (e instanceof TypeError && /fetch|network/i.test(raw)) return "ScubaPilot ne répond pas : le programme est arrêté. Relancez-le (« Lancer ScubaPilot.bat »), puis rechargez la page.";
  if (/^[A-Z0-9_]+$/.test(raw)) return `Une erreur est survenue (code : ${raw}). Réessayez.`;
  return raw;
}
// Désactive le bouton le temps d'une action réseau asynchrone, pour éviter qu'un double-clic
// pendant la requête ne déclenche l'action deux fois (ex. créer le même cours ou étudiant deux fois).
// Restaure systématiquement le texte et l'état du bouton à la fin, succès ou échec.
async function withBusy(btn, fn, busyText) {
  if (!btn) return fn();
  const originalText = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  if (busyText) btn.textContent = busyText;
  try {
    return await fn();
  } finally {
    btn.disabled = wasDisabled;
    if (busyText) btn.textContent = originalText;
  }
}
function toast(msg, isError) {
  const box = document.getElementById('toast');
  const node = document.createElement('div');
  node.className = 'toast-msg' + (isError ? ' error' : '');
  node.setAttribute('role', isError ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = msg;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Fermer la notification');
  close.textContent = '×';
  node.appendChild(text); node.appendChild(close);
  box.appendChild(node);
  // Les erreurs restent plus longtemps ; le survol met la minuterie en pause.
  const base = isError ? 10000 : 4000;
  let timer = null;
  const dismiss = () => { clearTimeout(timer); node.remove(); };
  const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, base); };
  close.addEventListener('click', dismiss);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', arm);
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', arm);
  arm();
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
// Un <tr> autonome ne peut pas être parsé correctement via innerHTML d'un <div>
// (le navigateur l'ignore silencieusement hors contexte de <table>). On passe donc par un <table>.
function elRow(html) { const t = document.createElement('table'); t.innerHTML = html.trim(); return t.querySelector('tr'); }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Dérive un identifiant stable (ex. "certificat_medical") à partir d'un libellé saisi par
// l'instructeur (ex. "Certificat médical"), pour les nouveaux documents de type de cours et
// champs de profil étudiant créés depuis les formulaires de Paramètres.
function slugify(str) {
  const base = (str || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || ('champ_' + Date.now());
}
function humanDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function progressClass(p) { return p >= 90 ? '' : (p >= 50 ? 'mid' : 'low'); }
function badgeClass(p) { return p === 100 ? 'ok' : (p >= 50 ? 'warn' : 'bad'); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function courseTypeLabel(code) { const t = state.courseTypes.find(t => t.code === code); return t ? t.label : code; }
function siteLabel(id) { const s = state.sites.find(s => s.id === id); return s ? s.name : '(site non défini)'; }
function siteFull(id) { const s = state.sites.find(s => s.id === id); return s ? (s.name + (s.address ? ' - ' + s.address : '')) : ''; }
function buddyLabel(b) { return b ? (b.name + (b.role ? ' (' + b.role + ')' : '')) : '(coéquipier supprimé)'; }
function buddyById(id) { return state.buddies.find(b => b.id === id); }
function buddyLabelById(id) { const b = buddyById(id); return b ? buddyLabel(b) : (id ? '(coéquipier supprimé)' : ''); }
function centerLabel(id) { const c = state.centers.find(c => c.id === id); return c ? c.name : (id ? '(centre supprimé)' : '(non défini)'); }
function centerById(id) { return state.centers.find(c => c.id === id); }
// Instructeurs rattachés à un cours donné : un sous-ensemble de la liste globale de coéquipiers
// (choisi à la création du cours ou via "Modifier les notes / le centre"), pas une liste séparée —
// un coéquipier qui est instructeur (ex: rôle "Instructeur") est simplement un coéquipier de plus.
// Sert à limiter le choix de l'instructeur certificateur d'un étudiant à des personnes pertinentes
// pour ce cours précis.
function courseInstructors(course) {
  return (course.instructorIds || []).map(id => buddyById(id)).filter(Boolean);
}

// Taille lisible : 1,4 Mo, 2,31 Go...
function fmtBytes(n) {
  n = Number(n) || 0;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? String(n) : n.toFixed(n >= 100 ? 0 : (n >= 10 ? 1 : 2)).replace('.', ',')) + ' ' + units[i];
}
// Envoie un fichier tel quel (en flux, sans le charger en mémoire) : pas de limite de taille pratique.
// onProgress(fraction 0..1) est appelé pendant l'envoi.
function uploadFile(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl + (uploadUrl.includes('?') ? '&' : '?') + 'filename=' + encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-ScubaPilot', '1');
    xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || 'ERROR'), { data }));
    };
    xhr.onerror = () => reject(new TypeError('Failed to fetch'));
    xhr.onabort = () => reject(new Error('UPLOAD_ABORTED'));
    xhr.send(file);
  });
}

// Construit une zone de glisser-déposer générique qui envoie chaque fichier déposé (ou choisi via
// le sélecteur) à uploadUrl (en flux, avec progression), puis rafraîchit la liste de fichiers affichée sans recharger
// toute la page (même principe que les checklists : pas de route() systématique).
function buildDropZone(uploadUrl, initialFiles, label) {
  const wrap = el(`
    <div class="dropzone-wrap">
      <div class="dropzone">
        <div class="dropzone-label">${escapeHtml(label || 'Glissez un document ici, ou')} <label class="dropzone-browse">parcourir<input type="file" multiple style="display:none"></label></div>
      </div>
      <div class="dropzone-files"></div>
    </div>
  `);
  const zone = wrap.querySelector('.dropzone');
  const filesBox = wrap.querySelector('.dropzone-files');
  const fileInput = wrap.querySelector('input[type=file]');
  let files = initialFiles || [];

  function renderFiles() {
    filesBox.innerHTML = files.length
      ? 'Fichiers présents : ' + files.map(escapeHtml).join(', ')
      : 'Aucun fichier dans le dossier.';
  }
  renderFiles();

  async function doUpload(fileList) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    zone.classList.add('busy');
    let okCount = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const prefix = (list.length > 1 ? `(${i + 1}/${list.length}) ` : '') + `Copie de « ${f.name} » (${fmtBytes(f.size)})`;
      filesBox.textContent = prefix + '...';
      try {
        const r = await uploadFile(uploadUrl, f, frac => { filesBox.textContent = `${prefix} — ${Math.round(frac * 100)} %`; });
        files.push(r.filename);
        okCount++;
      } catch (e) {
        toast(`Échec de l'envoi de "${f.name}" : ` + friendlyError(e), true);
      }
    }
    zone.classList.remove('busy');
    renderFiles();
    if (okCount) toast(okCount > 1 ? `${okCount} documents copiés` : 'Document copié dans le dossier');
  }

  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => doUpload(e.dataTransfer.files));
  fileInput.addEventListener('change', (e) => { doUpload(e.target.files); fileInput.value = ''; });

  return wrap;
}

// Confirmation en 2 étapes pour les suppressions coûteuses (cours, étudiant) : une modale doit être
// explicitement validée, et pour les actions les plus risquées on exige de retaper le nom concerné
// (comme sur GitHub) plutôt qu'un simple confirm() qu'on peut valider par réflexe.
// neutral: true -> bouton de confirmation bleu (action non destructrice) au lieu de rouge.
function showConfirmModal({ title, message, confirmText, requireTypeText, neutral }) {
  return new Promise(resolve => {
    const overlay = el(`
      <div class="modal-overlay">
        <div class="modal-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <h3>${escapeHtml(title)}</h3>
          <p>${message}</p>
          ${requireTypeText ? `<p class="muted">Tapez <strong>${escapeHtml(requireTypeText)}</strong> ci-dessous pour confirmer :</p><input id="confirm-type-input">` : ''}
          <div class="actions-inline" style="margin-top:16px">
            <button class="btn${neutral ? '' : ' danger'}" id="confirm-yes-btn" ${requireTypeText ? 'disabled' : ''}>${escapeHtml(confirmText || 'Confirmer la suppression')}</button>
            <button class="btn secondary" id="confirm-no-btn">Annuler</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    const yesBtn = overlay.querySelector('#confirm-yes-btn');
    const noBtn = overlay.querySelector('#confirm-no-btn');
    if (requireTypeText) {
      const input = overlay.querySelector('#confirm-type-input');
      input.addEventListener('input', () => { yesBtn.disabled = input.value.trim() !== requireTypeText; });
      setTimeout(() => input.focus(), 0);
    }
    const prevFocus = document.activeElement;
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Tab') { // garde le focus dans la fenêtre
        const f = [...overlay.querySelectorAll('input,button:not([disabled])')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function cleanup(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
      resolve(result);
    }
    yesBtn.addEventListener('click', () => cleanup(true));
    noBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', onKey);
    if (!requireTypeText) setTimeout(() => noBtn.focus(), 0); // « Annuler » par défaut : évite de valider par réflexe
  });
}
// Confirmation de suppression simple (texte brut, échappé)
function confirmDelete(message, opts) {
  opts = opts || {};
  return showConfirmModal({ title: opts.title || 'Confirmer la suppression', message: escapeHtml(message), confirmText: opts.confirmText || 'Supprimer' });
}

// Rend un élément non-bouton (en-tête, ligne de tableau) utilisable au clavier : Tab + Entrée/Espace.
function makeActivatable(node, role, label) {
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', role || 'button');
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('keydown', e => {
    if (e.target !== node) return; // ne pas intercepter les liens/boutons à l'intérieur
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); node.click(); }
  });
}

// Statut d'un document : "required" (toujours compté), "optional" (jamais compté),
// "conditional" (compté seulement si entry.needed === true pour cet étudiant/ce cours).
function docRequirement(docDef) {
  if (docDef && docDef.requirement) return docDef.requirement;
  return (docDef && docDef.required === false) ? 'optional' : 'required';
}
function countDocGroup(entries, docDefs) {
  // On parcourt la liste des documents définis par le type de cours (la source de vérité),
  // et non les clés déjà enregistrées dans "entries" : une fiche étudiant créée avant l'ajout
  // d'un document au type de cours n'a pas encore d'entrée pour ce document, et il doit quand
  // même compter comme "requis, non coché" — sinon il devient invisible au score (et un groupe
  // entièrement sans entrées affichait à tort 100%).
  const map = entries || {};
  let total = 0, done = 0;
  (docDefs || []).forEach(def => {
    const req = docRequirement(def);
    if (req === 'optional') return;
    const entry = map[def.id];
    if (req === 'conditional' && !(entry && entry.needed)) return;
    total++;
    if (entry && entry.collected) done++;
  });
  return { total, done };
}

// Ces données de référence (types de cours, sites, centres...) changent rarement, alors qu'on
// recharge l'état à chaque navigation. On les récupère en parallèle (plutôt qu'en 8 appels
// séquentiels) et on ne refait l'aller-retour réseau qu'une fois par session : tout code qui
// modifie l'une de ces listes (ex. enregistrer un centre) met aussi à jour `state` directement,
// donc le cache reste à jour sans qu'il faille le recharger. `force` permet de l'invalider
// explicitement si besoin (ex. après une opération qui ne met pas déjà à jour `state`).
let refsLoaded = false;
async function loadRefs(force) {
  if (refsLoaded && !force) return;
  const [settings, courseTypes, sites, studentFields, emailTemplates, buddies, centers, billing] = await Promise.all([
    api('GET', '/api/settings'),
    api('GET', '/api/course-types'),
    api('GET', '/api/sites'),
    api('GET', '/api/student-fields'),
    api('GET', '/api/email-templates'),
    api('GET', '/api/buddies'),
    api('GET', '/api/centers'),
    api('GET', '/api/billing')
  ]);
  Object.assign(state, { settings, courseTypes, sites, studentFields, emailTemplates, buddies, centers, billing: normBilling(billing) });
  refsLoaded = true;
}

// ---------- Router ----------
// Petit encart de crédits en bas de la barre latérale : nom et version de l'application, et
// l'instructeur pour qui elle est configurée (si renseigné dans Paramètres).
function updateSidebarFooter() {
  const footer = document.getElementById('sidebar-footer');
  if (!footer) return;
  const instructorName = state.settings && state.settings.instructorName && state.settings.instructorName !== 'Votre nom'
    ? state.settings.instructorName : '';
  footer.innerHTML = `
    ${escapeHtml(APP_NAME)} v${escapeHtml(APP_VERSION)} — ${escapeHtml(APP_RELEASE)}
    ${instructorName ? `<br>${escapeHtml(instructorName)}` : ''}
  `;
}

async function route() {
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const hash = location.hash.replace('#/', '') || 'dashboard';
  const [view, ...rest] = hash.split('/');
  const app = document.getElementById('app');
  app.innerHTML = '<p class="muted">Chargement...</p>';
  try {
    await loadRefs();
    updateSidebarFooter();
    if (!state.settings.rootDir && view !== 'settings') {
      renderNoRoot();
      return;
    }
    if (view === 'dashboard') { document.querySelector('[data-route=dashboard]').classList.add('active'); await renderDashboard(); }
    else if (view === 'invoices') { document.querySelector('[data-route=invoices]').classList.add('active'); await renderInvoices(); }
    else if (view === 'new-course') { document.querySelector('[data-route=new-course]').classList.add('active'); renderNewCourse(); }
    else if (view === 'settings') { document.querySelector('[data-route=settings]').classList.add('active'); renderSettings(); }
    else if (view === 'course') { await renderCourseDetail(decodeURIComponent(rest.join('/'))); }
    else if (view === 'student') { await renderStudentProfile(decodeURIComponent(rest.join('/'))); }
    else { renderDashboard(); }
  } catch (e) {
    if (e && e.message === 'ROOT_NOT_FOUND') return renderRootMissing((e.data && e.data.rootDir) || '');
    app.innerHTML = `<div class="card"><p>${escapeHtml(friendlyError(e))}</p></div>`;
  }
}
// Le dossier racine enregistré n'est pas accessible (OneDrive pas démarré, disque débranché, dossier
// déplacé) : on l'explique et on propose de réessayer ou d'indiquer le nouvel emplacement.
function renderRootMissing(rootDir) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1>Répertoire racine introuvable</h1>
    <div class="setup-note">
      ScubaPilot ne trouve pas le dossier de vos cours :<br><strong>${escapeHtml(rootDir)}</strong><br><br>
      Vos données ne sont pas perdues. Causes habituelles : OneDrive n'a pas fini de démarrer, un disque externe n'est pas branché, ou le dossier a été déplacé ou renommé.
    </div>
    <div class="card">
      <div class="actions-inline"><button class="btn" id="rm-retry">↻ Réessayer</button></div>
      <label for="rm-root" style="margin-top:14px">Le dossier a changé d'emplacement ? Indiquez le nouveau chemin :</label>
      <input id="rm-root" value="${escapeHtml(rootDir)}">
      <div class="actions-inline"><button class="btn secondary small" id="rm-save">Utiliser ce dossier</button></div>
      <p class="muted" id="rm-status"></p>
    </div>
  `;
  document.getElementById('rm-retry').addEventListener('click', () => { refsLoaded = false; route(); });
  document.getElementById('rm-save').addEventListener('click', async () => {
    const dir = document.getElementById('rm-root').value.trim();
    const status = document.getElementById('rm-status');
    try {
      const r = await api('POST', '/api/settings/check-dir', { dir });
      if (!r.exists) { status.textContent = "❌ Ce dossier n'existe pas non plus."; return; }
      await api('PUT', '/api/settings', { rootDir: dir });
      refsLoaded = false; route();
    } catch (e) { status.textContent = 'Erreur : ' + friendlyError(e); }
  });
}
window.addEventListener('hashchange', route);

// ---------- Menu sur petit écran (tablette, téléphone, fenêtre étroite) ----------
// Sous 900 px de large, la barre latérale devient un panneau qu'on ouvre avec le bouton ☰.
(function setupMobileMenu() {
  const btn = document.getElementById('menu-toggle'), backdrop = document.getElementById('menu-backdrop');
  if (!btn) return;
  const setOpen = open => { document.body.classList.toggle('nav-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  window.addEventListener('hashchange', () => setOpen(false));
  document.querySelectorAll('.sidebar .nav-link').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
})();
window.addEventListener('DOMContentLoaded', route);

function renderNoRoot() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1>Bienvenue</h1>
    <div class="setup-note">
      Avant de commencer, définissez le répertoire racine où seront rangés vos cours et documents d'étudiants.
    </div>
    <button class="btn" onclick="location.hash='#/settings'">Aller aux paramètres</button>
  `;
}

// ---------- Dashboard ----------
// Statut global d'un cours pour la liste du tableau de bord : "Clos" (marqué complété
// manuellement), "En attente" (documents pré/post pas encore à 100%), ou "Prêt à clôturer"
// (tous les documents sont collectés mais le cours n'a pas encore été marqué complété).
// Dates d'un cours : première et dernière séance (ISO), ou null s'il n'y a aucune séance.
function courseDates(c) {
  const dates = (c.sessions || []).map(s => s.date).filter(Boolean).sort();
  return { first: dates.length ? dates[0] : null, last: dates.length ? dates[dates.length - 1] : null };
}
// Nombre de jours de isoA à isoB (positif si isoB est après isoA).
function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB + 'T00:00:00') - new Date(isoA + 'T00:00:00')) / 86400000);
}
// Statut d'un cours, selon l'avancement ET les dates : un cours à venir n'est plus « en attente »
// parce que ses documents post-cours ne sont pas cochés — ils ne peuvent pas l'être avant le cours.
function courseStatusInfo(c) {
  if (c.completed) return { key: 'closed', icon: '✅', label: 'Clos', cls: 'ok' };
  const today = todayISO(), d = courseDates(c), st = c.stats || {};
  if (!d.first) return { key: 'unplanned', icon: '📝', label: 'À planifier', cls: 'neutral', hint: 'Aucune séance planifiée' };
  if (today < d.first) {
    const days = daysBetween(today, d.first);
    const when = days === 1 ? 'demain' : `dans ${days} jours`;
    if (st.prePercent < 100) return { key: 'prepare', icon: '📋', label: 'À préparer', cls: days <= 7 ? 'bad' : 'warn', hint: `Débute ${when} — documents pré-cours incomplets (${st.prePercent} %)` };
    return { key: 'ready', icon: '🗓️', label: 'Prêt', cls: 'ok', hint: `Débute ${when} — documents pré-cours complets` };
  }
  if (today <= d.last) return { key: 'running', icon: '▶️', label: 'En cours', cls: 'info', hint: st.prePercent < 100 ? `Documents pré-cours incomplets (${st.prePercent} %)` : 'Cours en cours' };
  const since = daysBetween(d.last, today);
  if (st.prePercent < 100 || st.postPercent < 100) return { key: 'post', icon: '⏳', label: 'Post-cours à compléter', cls: since > 30 ? 'bad' : 'warn', hint: `Terminé depuis ${since} jour(s) — documents incomplets` };
  return { key: 'closable', icon: '🔷', label: 'Prêt à clôturer', cls: 'info', hint: 'Tous les documents sont complets' };
}

// ---------- Export des séances vers un calendrier (.ics : Outlook, Google Agenda, Apple) ----------
function icsEscape(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
// Une ligne iCalendar ne doit pas dépasser 75 octets : on la replie (suite = ligne commençant par une espace).
function icsFold(line) {
  const enc = new TextEncoder(); const out = []; let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
// Événements d'un cours : un par séance. Avec des heures -> plage horaire ; sans -> journée entière.
function courseIcsEvents(course) {
  const d2 = s => String(s).replace(/-/g, ''), t2 = s => String(s).replace(':', '') + '00';
  const nextDay = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const students = Array.isArray(course.students) ? course.students.length : 0;
  return (course.sessions || []).filter(s => s.date).map((s, i) => {
    const site = state.sites.find(x => x.id === s.siteId);
    const buddies = (s.coequipierIds || []).map(id => buddyById(id)).filter(Boolean).map(b => b.name);
    const desc = [s.notes, buddies.length ? 'Coéquipiers : ' + buddies.join(', ') : '', `Centre : ${centerLabel(course.centerId)}`, students ? `${students} étudiant(s)` : '', 'Cours ' + course.id].filter(Boolean).join('\n');
    const lines = ['BEGIN:VEVENT', `UID:${course.id}-${s.date}-${i}@scubapilot`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`];
    if (s.timeStart) {
      lines.push(`DTSTART:${d2(s.date)}T${t2(s.timeStart)}`);
      // sans heure de fin : 1 h par défaut ; fin avant le début (après minuit) : lendemain
      let endDate = s.date, endTime = s.timeEnd;
      if (!endTime) { const [h, m] = s.timeStart.split(':').map(Number); endTime = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`; if (h === 23) endDate = nextDay(s.date); }
      else if (endTime <= s.timeStart) endDate = nextDay(s.date);
      lines.push(`DTEND:${d2(endDate)}T${t2(endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d2(s.date)}`, `DTEND;VALUE=DATE:${d2(nextDay(s.date))}`);
    }
    lines.push(`SUMMARY:${icsEscape(courseTypeLabel(course.typeCode) + ' — ' + centerLabel(course.centerId))}`);
    if (site) lines.push(`LOCATION:${icsEscape(site.name + (site.address ? ', ' + site.address : ''))}`);
    lines.push(`DESCRIPTION:${icsEscape(desc)}`, 'END:VEVENT');
    return lines;
  });
}
function downloadIcs(filename, courses) {
  const events = courses.flatMap(courseIcsEvents);
  if (!events.length) { toast('Aucune séance datée à exporter', true); return; }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScubaPilot//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events.flat(), 'END:VCALENDAR'];
  const blob = new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${events.length} séance(s) exportée(s) : ouvrez le fichier pour l'ajouter à votre calendrier`);
}

// ---------- Conservation des dossiers ----------
// Durée de conservation choisie dans les Paramètres (5 ans par défaut, jamais moins).
const RETENTION_MIN_YEARS = 5;
function retentionYears() {
  const n = Math.round(Number(state.settings && state.settings.retentionYears));
  return Number.isFinite(n) && n >= RETENTION_MIN_YEARS ? n : RETENTION_MIN_YEARS;
}
// Cours dont la dernière séance date de plus de `years` ans : candidats à l'archivage. Un cours
// sans séance datée n'est jamais candidat. Du plus ancien au plus récent.
function archiveCandidates(courses, years) {
  const today = todayISO();
  const cutoff = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
  return courses.filter(c => !c.corrupted).map(c => ({ c, last: courseDates(c).last }))
    .filter(x => x.last && x.last < cutoff).sort((a, b) => a.last.localeCompare(b.last)).map(x => x.c);
}

// ---------- Liste « À faire » ----------
// Date locale (AAAA-MM-JJ) d'un horodatage ISO enregistré en UTC : une sauvegarde faite à 20 h à
// Toronto porte la date du jour, pas celle du lendemain.
function localIsoDate(at) {
  const d = new Date(at);
  if (isNaN(d)) return String(at || '').slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const BACKUP_REMINDER_DAYS = 30; // rappel si la dernière sauvegarde a plus de 30 jours
// Construit, à partir de tous les cours, ce qui demande une action : documents manquants des cours
// proches, convocations pas encore envoyées, certifications et transferts en attente, factures à
// préparer / soumettre, paiements en attente. urgency : 2 = urgent, 1 = à faire, 0 = quand vous voulez.
// extra (facultatif) : { conflicts: [...copies en conflit OneDrive], lastBackup: {at,...} | null }
function buildTodos(courses, extra) {
  const today = todayISO(), todos = [];
  const names = list => list.slice(0, 3).map(s => `${s.firstName || ''} ${s.lastName || ''}`.trim()).join(', ') + (list.length > 3 ? ` et ${list.length - 3} autre(s)` : '');
  for (const c of courses) {
    if (c.corrupted) continue;
    const d = courseDates(c), st = c.stats || {}, studs = st.students || [];
    const add = (urgency, icon, text, sortDate) => todos.push({ course: c, urgency, icon, text, sortDate: sortDate || d.first || '9999' });
    const ended = !!(d.last && d.last < today), started = !!(d.first && d.first <= today);
    if (!c.completed && d.first) {
      const daysTo = daysBetween(today, d.first);
      if (!ended && daysTo <= 14) { // débute dans les 14 jours, ou en cours
        const u = daysTo <= 3 ? 2 : 1;
        const miss = studs.filter(s => s.preMissing > 0);
        if (miss.length) add(u, '📋', `Documents pré-cours manquants pour ${miss.length} étudiant(s) : ${names(miss)}`);
        if (st.generalPreMissing) add(u, '📋', `${st.generalPreMissing} document(s) général(aux) du cours à régler avant le cours`);
        const noMail = studs.filter(s => s.hasEmail && !s.lastMail);
        if (!started && noMail.length) add(u, '✉️', `Aucun courriel noté pour ${noMail.length} étudiant(s) : ${names(noMail)}`);
      }
      if (ended) {
        const since = daysBetween(d.last, today), u = since > 30 ? 2 : 1;
        const before = todos.length;
        const docs = studs.filter(s => s.preMissing > 0 || s.postMissing > 0);
        if (docs.length) add(u, '📋', `Documents manquants pour ${docs.length} étudiant(s) : ${names(docs)}`, d.last);
        if (st.generalPreMissing + st.generalPostMissing) add(u, '📋', `${st.generalPreMissing + st.generalPostMissing} document(s) général(aux) du cours à compléter`, d.last);
        const certif = studs.filter(s => !s.courseOnly && !s.certificationConfirmed);
        if (certif.length) add(u, '🎓', `Certification à confirmer pour ${certif.length} étudiant(s) : ${names(certif)}`, d.last);
        const transfer = studs.filter(s => s.courseOnly && !s.fileTransferred);
        if (transfer.length) add(u, '📁', `Dossier à transférer pour ${transfer.length} étudiant(s) : ${names(transfer)}`, d.last);
        if (todos.length === before) add(0, '🔷', 'Tout est complet : vous pouvez clôturer ce cours', d.last);
      }
    }
    const inv = invoiceStatus(c);
    if (ended && studs.length && inv.key === 'none') add(daysBetween(d.last, today) > 30 ? 2 : 1, '🧾', 'Facture à préparer', d.last);
    if (ended && inv.key === 'draft') add(daysBetween(d.last, today) > 30 ? 2 : 1, '🧾', `Facture ${c.invoice.number || ''} en brouillon : à soumettre au centre`, d.last);
    if (inv.key === 'submitted') {
      const since = daysBetween(c.invoice.submittedDate, today);
      let amount = '';
      try { amount = ', ' + fmtMoney(computeInvoice(c, c.invoice).total); } catch (e) {}
      const waiting = since <= 0 ? "Facture soumise aujourd'hui, paiement en attente" : `Paiement en attente depuis ${since} jour(s)`;
      add(since > 30 ? 2 : (since > 14 ? 1 : 0), '💵', `${waiting} (facture ${c.invoice.number || ''}${amount})`, c.invoice.submittedDate);
    }
  }
  // Données : copies en conflit de OneDrive, et sauvegarde trop ancienne (ou jamais faite).
  extra = extra || {};
  for (const cf of (extra.conflicts || [])) {
    const where = cf.courseId === '_ScubaPilot' ? 'dans vos réglages' : (cf.studentFolder ? `dans le dossier de ${cf.studentFolder}` : 'dans le dossier du cours');
    todos.push({ course: cf.courseId === '_ScubaPilot' ? null : courses.find(c => c.id === cf.courseId) || null, title: 'Copie en conflit (OneDrive)', href: cf.courseId === '_ScubaPilot' ? '#/settings' : null,
      urgency: 1, icon: '⚠️', sortDate: '0000', conflict: cf,
      text: `OneDrive a créé « ${cf.name} » à côté de « ${cf.original} » ${where} : deux versions différentes existent. Vérifiez les informations dans ScubaPilot, puis supprimez la copie.` });
  }
  if (courses.some(c => !c.corrupted)) {
    const lb = extra.lastBackup && extra.lastBackup.at ? extra.lastBackup : null;
    const days = lb ? daysBetween(localIsoDate(lb.at), todayISO()) : null;
    if (!lb || days > BACKUP_REMINDER_DAYS) todos.push({ course: null, title: 'Sauvegarde', href: '#/settings', urgency: (!lb || days > 3 * BACKUP_REMINDER_DAYS) ? 2 : 1, icon: '💾', sortDate: '0000',
      text: lb ? `Dernière sauvegarde il y a ${days} jours (${shortDate(localIsoDate(lb.at))}) : faites-en une nouvelle (Paramètres → Sauvegarde) et rangez-la hors de l'ordinateur.`
               : "Aucune sauvegarde n'a encore été faite avec ScubaPilot : faites-en une (Paramètres → Sauvegarde) et rangez-la hors de l'ordinateur." });
  }
  // Cours qui ont dépassé la durée de conservation : un seul rappel, sans urgence, vers les Paramètres.
  const old = archiveCandidates(courses, retentionYears());
  if (old.length) todos.push({ course: old[0], urgency: 0, icon: '🗄️', sortDate: '9999', href: '#/settings',
    text: `${old.length} cours ${old.length > 1 ? 'ont' : 'a'} plus de ${retentionYears()} ans : vous pouvez ${old.length > 1 ? 'les' : 'le'} archiver ou ${old.length > 1 ? 'les' : 'le'} supprimer (Paramètres → Archivage)` });
  return todos.sort((a, b) => (b.urgency - a.urgency) || String(a.sortDate).localeCompare(String(b.sortDate)));
}
// Regroupe les actions de la liste « À faire » : une entrée par cours (avec toutes ses actions),
// plus une entrée par sujet hors cours (sauvegarde, réglages, conservation des dossiers).
function groupTodos(todos) {
  const groups = new Map();
  for (const td of todos) {
    const byCourse = td.course && !td.href;
    const key = byCourse ? 'course:' + td.course.id : 'topic:' + (td.title || 'Conservation des dossiers') + (td.href || '');
    if (!groups.has(key)) groups.set(key, { key, course: byCourse ? td.course : null, title: byCourse ? '' : (td.title || 'Conservation des dossiers'), href: byCourse ? '' : (td.href || ''), urgency: 0, sortDate: '9999', items: [] });
    const g = groups.get(key);
    g.items.push(td);
    g.urgency = Math.max(g.urgency, td.urgency);
    if (String(td.sortDate) < g.sortDate) g.sortDate = String(td.sortDate);
  }
  return [...groups.values()].sort((a, b) => (b.urgency - a.urgency) || a.sortDate.localeCompare(b.sortDate));
}
// « débute dans 2 jours », « en cours », « terminé il y a 12 jours »
function courseWhen(c) {
  const d = courseDates(c), today = todayISO();
  if (!d.first) return 'aucune séance planifiée';
  if (today < d.first) { const n = daysBetween(today, d.first); return n === 1 ? 'débute demain' : `débute dans ${n} jours`; }
  if (today <= d.last) return 'en cours';
  const n = daysBetween(d.last, today);
  if (n === 1) return 'terminé hier';
  if (n < 60) return `terminé il y a ${n} jours`;
  if (n < 730) return `terminé il y a ${Math.round(n / 30.44)} mois`;
  return `terminé il y a ${Math.floor(n / 365.25)} ans`;
}
// Dates courtes : « 21 nov. 2026 », « 21–22 nov. 2026 », « 30 nov. – 2 déc. 2026 », « 30 déc. 2026 – 2 janv. 2027 ».
function compactDateRange(sessions) {
  const ds = (sessions || []).map(s => s.date).filter(Boolean).sort();
  if (!ds.length) return '';
  const f = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-CA', opts);
  const a = ds[0], b = ds[ds.length - 1];
  if (a === b) return f(a, { day: 'numeric', month: 'short', year: 'numeric' });
  if (a.slice(0, 7) === b.slice(0, 7)) return `${f(a, { day: 'numeric' })}–${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${f(a, { day: 'numeric', month: 'short' })} – ${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${f(a, { day: 'numeric', month: 'short', year: 'numeric' })} – ${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
// Chiffres clés du tableau de bord.
function dashboardStats(courses, todos) {
  const today = todayISO();
  const live = courses.filter(c => !c.corrupted);
  const statusOf = c => courseStatusInfo(c).key;
  const upcoming = live.filter(c => ['unplanned', 'prepare', 'ready', 'running'].includes(statusOf(c)));
  const nextDays = upcoming.map(c => courseDates(c).first).filter(f => f && f >= today).map(f => daysBetween(today, f)).sort((x, y) => x - y);
  const post = live.filter(c => statusOf(c) === 'post').sort((x, y) => String(courseDates(y).last).localeCompare(String(courseDates(x).last)));  // le plus récent d'abord
  const pending = live.filter(c => invoiceStatus(c).key === 'submitted');
  let pendingAmount = 0;
  for (const c of pending) { try { pendingAmount += computeInvoice(c, c.invoice).total; } catch (e) {} }
  return {
    todoCount: todos.length, urgentCount: todos.filter(td => td.urgency === 2).length,
    upcomingCount: upcoming.length, nextInDays: nextDays.length ? nextDays[0] : null,
    postCount: post.length, postFirst: post[0] || null,
    pendingCount: pending.length, pendingAmount: Math.round(pendingAmount * 100) / 100
  };
}
function buildStatTiles(s) {
  const tile = (cls, label, value, sub, href) => {
    const inner = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div>`;
    return href ? `<a class="stat-tile ${cls}" href="${href}">${inner}</a>` : `<div class="stat-tile ${cls}">${inner}</div>`;
  };
  const postSub = s.postFirst ? `${escapeHtml(courseTypeLabel(s.postFirst.typeCode))} du ${escapeHtml(shortDate(courseDates(s.postFirst).last))}${s.postCount > 1 ? ' et autres' : ''}` : 'aucun';
  return el(`<div class="stat-tiles dash-tiles">
    ${tile(s.urgentCount ? 'bad' : (s.todoCount ? 'warn' : 'ok'), 'À faire', s.todoCount, s.urgentCount ? `<span class="urgent-text">dont ${s.urgentCount} urgent${s.urgentCount > 1 ? 's' : ''}</span>` : (s.todoCount ? 'rien d\'urgent' : 'tout est à jour'))}
    ${tile('', 'Cours à venir', s.upcomingCount, s.nextInDays === null ? (s.upcomingCount ? 'dates à planifier' : 'aucun') : (s.nextInDays === 0 ? "le prochain aujourd'hui" : (s.nextInDays === 1 ? 'le prochain demain' : `le prochain dans ${s.nextInDays} jours`)))}
    ${tile(s.postCount ? 'warn' : 'ok', 'Post-cours à compléter', s.postCount, postSub)}
    ${tile('ok', 'Paiements en attente', fmtMoney(s.pendingAmount), s.pendingCount ? `${s.pendingCount} facture${s.pendingCount > 1 ? 's' : ''} soumise${s.pendingCount > 1 ? 's' : ''}` : 'aucune facture en attente', '#/invoices')}
  </div>`);
}
// État d'affichage du tableau de bord, conservé d'une visite à l'autre pendant la session.
const dashUi = { todoOpen: false, filtersOpen: false, showAllPast: false };
function buildTodoCard(courses, extra) {
  const todos = buildTodos(courses, extra);
  const groups = groupTodos(todos);
  const urgencyBadge = u => u === 2 ? '<span class="badge bad">Urgent</span>' : (u === 1 ? '<span class="badge warn">À faire</span>' : '<span class="tag-status">Quand vous voulez</span>');
  const groupHtml = g => {
    const c = g.course;
    const head = c
      ? `<a href="#/course/${encodeURIComponent(c.id)}"><strong>${escapeHtml(courseTypeLabel(c.typeCode))}</strong>${courseDates(c).first ? ' — ' + escapeHtml(shortDate(courseDates(c).first)) : ''}</a>
         <span class="muted">${escapeHtml(centerLabel(c.centerId))} · ${escapeHtml(courseWhen(c))}</span>`
      : `<a href="${g.href || '#/settings'}"><strong>${escapeHtml(g.title)}</strong></a>`;
    return `<li class="todo-group u${g.urgency}">
      <div class="todo-group-head">${urgencyBadge(g.urgency)} ${head}
        <span class="todo-count">${g.items.length} action${g.items.length > 1 ? 's' : ''}</span></div>
      <ul class="todo-items">${g.items.map(td => `<li>${escapeHtml(td.text)}${td.conflict ? ` <button type="button" class="btn secondary small" data-open-conflict="${escapeHtml(JSON.stringify([td.conflict.courseId, td.conflict.studentFolder]))}">Ouvrir le dossier</button>` : ''}</li>`).join('')}</ul>
    </li>`;
  };
  const card = el(`
    <section class="card todo-card${dashUi.todoOpen ? ' open' : ''}" aria-labelledby="todo-title">
      <div class="card-head">
        <h2 id="todo-title">À faire ${todos.length ? '<span class="muted small-title">· regroupé par cours</span>' : ''}</h2>
        ${todos.length ? `<button type="button" class="link-btn" id="todo-toggle" aria-expanded="${dashUi.todoOpen}">${dashUi.todoOpen ? 'Replier' : `Voir le détail (${todos.length})`}</button>` : ''}
      </div>
      ${groups.length ? `<ul class="todo-groups">${groups.map(groupHtml).join('')}</ul>` : '<p class="muted">Rien à signaler : tout est à jour.</p>'}
    </section>
  `);
  card.querySelectorAll('[data-open-conflict]').forEach(b => b.addEventListener('click', () => {
    const [courseId, studentFolder] = JSON.parse(b.dataset.openConflict);
    openExplorer(courseId, studentFolder || undefined);
  }));
  const toggle = card.querySelector('#todo-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    dashUi.todoOpen = !dashUi.todoOpen;
    card.classList.toggle('open', dashUi.todoOpen);
    toggle.setAttribute('aria-expanded', String(dashUi.todoOpen));
    toggle.textContent = dashUi.todoOpen ? 'Replier' : `Voir le détail (${todos.length})`;
  });
  return { card, todos };
}

function buildCourseRow(c) {
  if (c.corrupted) {
    return elRow(`
      <tr>
        <td><span class="badge bad">⚠ Fichier illisible</span></td>
        <td colspan="6"><strong>${escapeHtml(c.id)}</strong><br><span class="muted">Le fichier course.json de ce dossier est illisible. Vos documents sont intacts : restaurez une version précédente de course.json (OneDrive → Historique des versions) ou reprenez-le d'une sauvegarde.</span></td>
      </tr>
    `);
  }
  const pre = c.stats.prePercent, post = c.stats.postPercent;
  const sessions = c.sessions || [];
  const dateText = sessions.length ? compactDateRange(sessions) : '(aucune séance)';
  const siteText = [...new Set(sessions.map(sess => siteLabel(sess.siteId)).filter(Boolean))].join(', ');
  const status = courseStatusInfo(c);
  // Avant le début du cours, le post-cours n'a pas de sens : barre vide et « — ».
  const started = !!(courseDates(c).first && courseDates(c).first <= todayISO());
  const bar = (label, p, show) => `<div class="doc-bar"><span>${label}</span><div class="doc-track">${show ? `<div class="doc-fill ${badgeClass(p)}" style="width:${p}%"></div>` : ''}</div><span class="doc-pct">${show ? p + ' %' : '—'}</span></div>`;
  const tr = elRow(`
    <tr class="course-row ${c._isPast ? 'course-row-past' : ''}">
      <td><span class="${status.cls === 'neutral' ? 'tag-status' : 'badge ' + status.cls}" title="${escapeHtml(status.hint || status.label)}">${escapeHtml(status.label)}</span></td>
      <td><strong class="course-name">${escapeHtml(courseTypeLabel(c.typeCode))}</strong></td>
      <td class="nowrap">${escapeHtml(dateText)}</td>
      <td>${escapeHtml(centerLabel(c.centerId))}${siteText ? `<div class="muted small">${escapeHtml(siteText)}</div>` : ''}</td>
      <td>${c.stats.studentCount}${c.stats.corruptedStudents ? ` <span class="badge bad" title="${c.stats.corruptedStudents} fiche(s) d'étudiant illisible(s) : ouvrez le cours pour voir lesquelles">⚠ ${c.stats.corruptedStudents}</span>` : ''}</td>
      <td class="docs-cell">${bar('Pré', pre, true)}${bar('Post', post, started)}</td>
      <td>${invoiceBadgeHtml(c, true)}</td>
    </tr>
  `);
  tr.title = c.id;
  tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = '#/course/' + encodeURIComponent(c.id); });
  makeActivatable(tr, 'link', 'Ouvrir le cours ' + courseTypeLabel(c.typeCode) + ' ' + c.id);
  return tr;
}

function buildCourseTable(list) {
  const table = el(`
    <div class="table-scroll">
      <table class="course-table">
        <thead><tr><th>Statut</th><th>Cours</th><th>Dates</th><th>Centre · lieu</th><th>Étudiants</th><th>Documents</th><th>Facture</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `);
  const tbody = table.querySelector('tbody');
  list.forEach(c => tbody.appendChild(buildCourseRow(c)));
  return table;
}

// Un cours correspond à la recherche libre si le texte apparaît dans le type, l'identifiant du
// cours, le centre mandataire, ou le nom d'un de ses étudiants (le nom du dossier étudiant est
// "Prénom Nom", ce qui suffit pour une recherche simple sans appeler chaque fiche de cours).
function courseMatchesFilters(c, filters) {
  if (filters.centerId && c.centerId !== filters.centerId) return false;
  if (filters.typeCode && c.typeCode !== filters.typeCode) return false;
  if (filters.invoice && invoiceStatus(c).key !== filters.invoice) return false;
  const q = filters.q;
  if (!q) return true;
  const haystacks = [
    courseTypeLabel(c.typeCode), c.id, centerLabel(c.centerId),
    ...(c.students || [])
  ].join(' ').toLowerCase();
  return haystacks.includes(q);
}

async function renderDashboard() {
  const courses = await api('GET', '/api/courses');
  const app = document.getElementById('app');
  const centerOptions = state.centers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  const typeOptions = state.courseTypes.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.label)}</option>`).join('');
  app.innerHTML = `
    <div class="dash-head">
      <h1>Tableau de bord</h1>
      <div class="dash-search autocomplete">
        <label for="dash-search" class="visually-hidden">Rechercher un cours, un centre ou un étudiant</label>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <input id="dash-search" type="search" autocomplete="off" placeholder="Rechercher un cours, un centre ou un étudiant…">
        <div class="autocomplete-list" id="dash-suggest" style="display:none"></div>
      </div>
      <div class="dash-actions">
      <button type="button" class="btn secondary" id="dash-filters-btn" aria-expanded="${dashUi.filtersOpen}" aria-controls="dash-filters">Filtres <span id="dash-filter-count"></span></button>
      <a class="btn" href="#/new-course">+ Nouveau cours</a>
      <div class="menu-wrap">
        <button type="button" class="btn secondary icon-btn" id="dash-more" aria-label="Autres actions" aria-haspopup="true" aria-expanded="false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>
        </button>
        <div class="menu-pop" id="dash-more-menu" role="menu" hidden>
          <button type="button" role="menuitem" id="ics-all-btn">Calendrier des cours à venir (.ics)</button>
          <button type="button" role="menuitem" id="summary-btn">Sommaire des activités accomplies</button>
        </div>
      </div>
      </div>
    </div>
    <div class="card dash-filters" id="dash-filters" ${dashUi.filtersOpen ? '' : 'hidden'}>
      <div class="row" style="align-items:flex-end">
        <div><label for="dash-filter-center">Centre</label><select id="dash-filter-center"><option value="">Tous les centres</option>${centerOptions}</select></div>
        <div><label for="dash-filter-type">Type de cours</label><select id="dash-filter-type"><option value="">Tous les types</option>${typeOptions}</select></div>
        <div><label for="dash-filter-invoice">Facture</label>
          <select id="dash-filter-invoice">
            <option value="">Toutes</option>
            <option value="none">Sans facture (à préparer)</option>
            <option value="nobill">Non facturé</option>
            <option value="draft">Brouillon (à soumettre)</option>
            <option value="submitted">Soumise (paiement en attente)</option>
            <option value="paid">Payée</option>
          </select></div>
        <div style="flex:0 0 auto;min-width:0"><button type="button" class="link-btn" id="dash-filters-reset">Effacer les filtres</button></div>
      </div>
    </div>
  `;

  // --- Menu « ⋯ » ---
  const moreBtn = app.querySelector('#dash-more'), moreMenu = app.querySelector('#dash-more-menu');
  const closeMenu = () => { moreMenu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); };
  moreBtn.addEventListener('click', e => { e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; moreBtn.setAttribute('aria-expanded', String(!moreMenu.hidden)); if (!moreMenu.hidden) moreMenu.querySelector('button').focus(); });
  document.addEventListener('click', function onDoc(e) { if (!document.body.contains(moreMenu)) return document.removeEventListener('click', onDoc); if (!e.target.closest('.menu-wrap')) closeMenu(); });
  moreMenu.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); moreBtn.focus(); } });
  app.querySelector('#summary-btn').addEventListener('click', () => { closeMenu(); exportActivitySummary(courses); });
  app.querySelector('#ics-all-btn').addEventListener('click', () => {
    closeMenu();
    const today = todayISO();
    // seulement les séances d'aujourd'hui et à venir
    const upcoming = courses.filter(c => !c.corrupted).map(c => ({ ...c, sessions: (c.sessions || []).filter(s => s.date && s.date >= today) })).filter(c => c.sessions.length);
    downloadIcs('ScubaPilot-cours-a-venir.ics', upcoming);
  });

  if (!courses.length) {
    app.appendChild(el(`<div class="card"><p class="muted">Aucun cours pour l'instant.</p><a class="btn" href="#/new-course">+ Créer un cours</a></div>`));
    return;
  }

  // Un cours est "passé" quand sa dernière séance est antérieure à aujourd'hui. Les cours sans
  // séance planifiée sont considérés à venir (impossible de savoir), affichés en fin de liste.
  const today = todayISO();
  courses.forEach(c => {
    const sessions = (c.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    c._firstDate = sessions.length ? sessions[0].date : null;
    c._lastDate = sessions.length ? sessions[sessions.length - 1].date : null;
    c._isPast = !!(c._lastDate && c._lastDate < today);
  });

  // Relu à chaque affichage : la sauvegarde a pu être faite depuis (ou sur un autre ordinateur).
  let lastBackup = state.settings && state.settings.lastBackup;
  const [conflicts, st] = await Promise.all([api('GET', '/api/conflicts').catch(() => []), api('GET', '/api/settings').catch(() => null)]);
  if (st) { lastBackup = st.lastBackup; if (state.settings) state.settings.lastBackup = st.lastBackup; }
  const { card: todoCard, todos } = buildTodoCard(courses, { conflicts, lastBackup });
  app.appendChild(buildStatTiles(dashboardStats(courses, todos)));
  app.appendChild(todoCard);

  const resultsBox = el('<div></div>');
  app.appendChild(resultsBox);
  const PAST_LIMIT = 5;
  const filtersBox = app.querySelector('#dash-filters');
  const readFilters = () => ({
    q: app.querySelector('#dash-search').value.trim().toLowerCase(),
    centerId: app.querySelector('#dash-filter-center').value,
    typeCode: app.querySelector('#dash-filter-type').value,
    invoice: app.querySelector('#dash-filter-invoice').value
  });

  function renderResults() {
    const filters = readFilters();
    const active = [filters.centerId, filters.typeCode, filters.invoice].filter(Boolean).length;
    app.querySelector('#dash-filter-count').innerHTML = active ? `<span class="count-pill">${active}</span>` : '';
    const searching = !!(filters.q || active);
    const filtered = courses.filter(c => courseMatchesFilters(c, filters));
    const upcoming = filtered.filter(c => !c._isPast)
      .sort((a, b) => (a._firstDate || '9999-99-99').localeCompare(b._firstDate || '9999-99-99'));
    const past = filtered.filter(c => c._isPast)
      .sort((a, b) => (b._lastDate || '').localeCompare(a._lastDate || ''));

    resultsBox.innerHTML = '';
    if (!filtered.length) {
      resultsBox.appendChild(el(`<div class="card"><p class="muted">Aucun cours ne correspond à cette recherche.</p></div>`));
      return;
    }
    const upCard = el(`<section class="card" aria-labelledby="up-title"><div class="card-head"><h2 id="up-title">Cours à venir <span class="muted small-title">· ${upcoming.length}</span></h2></div></section>`);
    upCard.appendChild(upcoming.length ? buildCourseTable(upcoming) : el(`<p class="muted">${searching ? 'Aucun cours à venir ne correspond.' : 'Aucun cours à venir.'}</p>`));
    resultsBox.appendChild(upCard);
    if (past.length) {
      // Les plus récents seulement, sauf pendant une recherche (tout ce qui correspond est montré).
      const showAll = searching || dashUi.showAllPast || past.length <= PAST_LIMIT;
      const shown = showAll ? past : past.slice(0, PAST_LIMIT);
      const pastCard = el(`<section class="card" aria-labelledby="past-title"><div class="card-head">
        <h2 id="past-title">Cours passés <span class="muted small-title">· ${shown.length < past.length ? `${shown.length} récents sur ${past.length}` : past.length}</span></h2>
        ${!searching && past.length > PAST_LIMIT ? `<button type="button" class="link-btn" id="past-toggle">${dashUi.showAllPast ? 'Afficher seulement les plus récents' : `Voir les ${past.length - PAST_LIMIT} autres`}</button>` : ''}
      </div></section>`);
      pastCard.appendChild(buildCourseTable(shown));
      const tg = pastCard.querySelector('#past-toggle');
      if (tg) tg.addEventListener('click', () => { dashUi.showAllPast = !dashUi.showAllPast; renderResults(); });
      resultsBox.appendChild(pastCard);
    }
  }

  // --- Filtres ---
  const filtersBtn = app.querySelector('#dash-filters-btn');
  filtersBtn.addEventListener('click', () => {
    dashUi.filtersOpen = !dashUi.filtersOpen;
    filtersBox.hidden = !dashUi.filtersOpen;
    filtersBtn.setAttribute('aria-expanded', String(dashUi.filtersOpen));
    if (dashUi.filtersOpen) app.querySelector('#dash-filter-center').focus();
  });
  ['#dash-filter-center', '#dash-filter-type', '#dash-filter-invoice'].forEach(sel => app.querySelector(sel).addEventListener('change', renderResults));
  app.querySelector('#dash-filters-reset').addEventListener('click', () => {
    ['#dash-filter-center', '#dash-filter-type', '#dash-filter-invoice'].forEach(sel => { app.querySelector(sel).value = ''; });
    renderResults();
  });

  // --- Recherche unique : filtre les cours ET propose la fiche globale des étudiants qui correspondent ---
  const searchInput = app.querySelector('#dash-search'), suggest = app.querySelector('#dash-suggest');
  let debounce, studentDebounce;
  const hideSuggest = () => { suggest.style.display = 'none'; };
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce); debounce = setTimeout(renderResults, 150);
    clearTimeout(studentDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) { hideSuggest(); return; }
    studentDebounce = setTimeout(async () => {
      let persons = [];
      try { persons = groupPersons(await api('GET', '/api/global-students?q=' + encodeURIComponent(q))); } catch (e) {}
      if (searchInput.value.trim() !== q || !persons.length) { if (!persons.length) hideSuggest(); return; }
      suggest.innerHTML = `<div class="suggest-title">Fiche globale d'un étudiant</div>`;
      persons.slice(0, 6).forEach(pn => {
        const item = el(`<a href="#/student/${encodeURIComponent(pn.studentId)}" class="suggest-item">${escapeHtml(pn.latest.firstName)} ${escapeHtml(pn.latest.lastName)} <span class="muted">— ${escapeHtml(personHint(pn))}</span></a>`);
        suggest.appendChild(item);
      });
      suggest.style.display = 'block';
    }, 250);
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideSuggest();
    if (e.key === 'ArrowDown' && suggest.style.display !== 'none') { e.preventDefault(); const first = suggest.querySelector('a'); if (first) first.focus(); }
  });
  suggest.addEventListener('keydown', e => {
    const items = [...suggest.querySelectorAll('a')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : searchInput).focus(); }
    if (e.key === 'Escape') { hideSuggest(); searchInput.focus(); }
  });
  app.querySelector('.dash-search').addEventListener('focusout', () => setTimeout(() => { if (!app.querySelector('.dash-search').contains(document.activeElement)) hideSuggest(); }, 150));

  renderResults();
}

// ---------- Suivi des factures : toutes les factures, totaux, export CSV ----------
async function renderInvoices() {
  const courses = await api('GET', '/api/courses');
  const app = document.getElementById('app');
  const rows = [];
  for (const c of courses) {
    if (c.corrupted || !c.invoice || c.billable === false) continue;
    const inv = c.invoice;
    let calc = { subtotal: 0, tps: 0, tvq: 0, total: 0 };
    try { calc = computeInvoice(c, inv); } catch (e) {}
    const st = invoiceStatus(c);
    rows.push({ c, inv, calc, st, date: inv.date || c.invoiceDate || '', year: String(inv.date || c.invoiceDate || '').slice(0, 4), centerId: inv.centerId || c.centerId || '' });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.inv.number || '').localeCompare(String(a.inv.number || '')));
  const years = [...new Set(rows.map(r => r.year).filter(Boolean))].sort().reverse();
  const thisYear = todayISO().slice(0, 4);
  const centerIds = [...new Set(rows.map(r => r.centerId).filter(Boolean))];
  app.innerHTML = `
    <div class="actions-inline" style="justify-content:space-between;margin:0 0 16px">
      <h1 style="margin:0">Suivi des factures</h1>
      <button class="btn secondary small" id="inv-csv">⬇ Exporter en CSV (Excel)</button>
    </div>
    <div class="card">
      <div class="row" style="align-items:flex-end">
        <div><label for="invl-year">Année (date de la facture)</label>
          <select id="invl-year"><option value="">Toutes les années</option>${years.map(y => `<option value="${y}" ${y === thisYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div><label for="invl-center">Centre</label>
          <select id="invl-center"><option value="">Tous les centres</option>${centerIds.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(centerLabel(id))}</option>`).join('')}</select></div>
        <div><label for="invl-status">Statut</label>
          <select id="invl-status"><option value="">Tous</option><option value="draft">Brouillon (à soumettre)</option><option value="submitted">Soumise (paiement en attente)</option><option value="paid">Payée</option></select></div>
      </div>
    </div>
    <div id="invl-results"></div>
  `;
  const box = app.querySelector('#invl-results');
  let current = [];
  const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
  function render() {
    const y = app.querySelector('#invl-year').value, ce = app.querySelector('#invl-center').value, s = app.querySelector('#invl-status').value;
    current = rows.filter(r => (!y || r.year === y) && (!ce || r.centerId === ce) && (!s || r.st.key === s));
    if (!rows.length) { box.innerHTML = '<div class="card"><p class="muted">Aucune facture pour l\'instant. Une facture se prépare depuis la fiche d\'un cours (bouton « Facture »).</p></div>'; return; }
    if (!current.length) { box.innerHTML = '<div class="card"><p class="muted">Aucune facture ne correspond à ces filtres.</p></div>'; return; }
    const by = key => current.filter(r => r.st.key === key);
    const tile = (label, list, cls) => `<div class="stat-tile ${cls || ''}"><div class="stat-label">${label}</div><div class="stat-value">${fmtMoney(sum(list, r => r.calc.total))}</div><div class="muted">${list.length} facture(s)</div></div>`;
    const centers = [...new Set(current.map(r => r.centerId))];
    box.innerHTML = `
      <div class="stat-tiles">
        ${tile('Total facturé (taxes incluses)', current)}
        ${tile('Payé', by('paid'), 'ok')}
        ${tile('Soumis, en attente de paiement', by('submitted'), 'warn')}
        ${tile('Brouillons, à soumettre', by('draft'))}
      </div>
      <div class="card">
        <table>
          <thead><tr><th>N°</th><th>Date</th><th>Cours</th><th>Centre</th><th class="num">Sous-total</th><th class="num">T.P.S.</th><th class="num">T.V.Q.</th><th class="num">Total</th><th>Statut</th></tr></thead>
          <tbody>${current.map(r => `
            <tr class="course-row" data-id="${escapeHtml(r.c.id)}">
              <td><strong>${escapeHtml(r.inv.number || '—')}</strong></td>
              <td>${escapeHtml(r.date ? shortDate(r.date) : '—')}</td>
              <td>${escapeHtml(courseTypeLabel(r.c.typeCode))}<br><span class="muted">${escapeHtml(r.c.id)}</span></td>
              <td>${escapeHtml(centerLabel(r.centerId))}</td>
              <td class="num">${fmtMoney(r.calc.subtotal)}</td><td class="num">${fmtMoney(r.calc.tps)}</td><td class="num">${fmtMoney(r.calc.tvq)}</td>
              <td class="num"><strong>${fmtMoney(r.calc.total)}</strong></td>
              <td>${invoiceBadgeHtml(r.c, true)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="4"><strong>Total (${current.length})</strong></td>
            <td class="num"><strong>${fmtMoney(sum(current, r => r.calc.subtotal))}</strong></td><td class="num"><strong>${fmtMoney(sum(current, r => r.calc.tps))}</strong></td>
            <td class="num"><strong>${fmtMoney(sum(current, r => r.calc.tvq))}</strong></td><td class="num"><strong>${fmtMoney(sum(current, r => r.calc.total))}</strong></td><td></td></tr></tfoot>
        </table>
      </div>
      ${centers.length > 1 ? `
      <div class="card">
        <h2>Par centre</h2>
        <table>
          <thead><tr><th>Centre</th><th class="num">Factures</th><th class="num">Total facturé</th><th class="num">Payé</th><th class="num">En attente</th></tr></thead>
          <tbody>${centers.map(id => { const l = current.filter(r => r.centerId === id); return `
            <tr><td>${escapeHtml(centerLabel(id))}</td><td class="num">${l.length}</td><td class="num">${fmtMoney(sum(l, r => r.calc.total))}</td>
              <td class="num">${fmtMoney(sum(l.filter(r => r.st.key === 'paid'), r => r.calc.total))}</td>
              <td class="num">${fmtMoney(sum(l.filter(r => r.st.key !== 'paid'), r => r.calc.total))}</td></tr>`; }).join('')}
          </tbody>
        </table>
      </div>` : ''}
    `;
    box.querySelectorAll('tr.course-row').forEach(tr => {
      tr.addEventListener('click', () => location.hash = '#/course/' + encodeURIComponent(tr.dataset.id));
      makeActivatable(tr, 'link', 'Ouvrir le cours ' + tr.dataset.id);
    });
  }
  ['#invl-year', '#invl-center', '#invl-status'].forEach(sel => app.querySelector(sel).addEventListener('change', render));
  app.querySelector('#inv-csv').addEventListener('click', () => {
    if (!current.length) { toast('Aucune facture à exporter', true); return; }
    // Séparateur « ; » et virgule décimale : s'ouvre directement dans Excel en français. BOM pour les accents.
    const num = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
    const cell = v => { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const head = ['Numéro', 'Date', 'Cours', 'Type de cours', 'Centre', 'Référence', 'Sous-total', 'TPS', 'TVQ', 'Total', 'Statut', 'Soumise le', 'Payée le'];
    const lines = current.map(r => [r.inv.number || '', r.date, r.c.id, courseTypeLabel(r.c.typeCode), centerLabel(r.centerId), r.inv.ref || '',
      num(r.calc.subtotal), num(r.calc.tps), num(r.calc.tvq), num(r.calc.total), r.st.short, r.inv.submittedDate || '', r.inv.paidDate || ''].map(cell).join(';'));
    const blob = new Blob(['\uFEFF' + [head.join(';'), ...lines].join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ScubaPilot-factures-${app.querySelector('#invl-year').value || 'toutes'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${current.length} facture(s) exportée(s)`);
  });
  render();
}

// ---------- Sommaire global des activités accomplies (tous cours confondus) ----------
function exportActivitySummary(courses) {
  const rows = courses.filter(c => !c.corrupted).sort((a, b) => {
    const da = (a.sessions && a.sessions[0] && a.sessions[0].date) || '';
    const db = (b.sessions && b.sessions[0] && b.sessions[0].date) || '';
    return db.localeCompare(da); // plus récent en premier
  });
  const totalStudents = rows.reduce((sum, c) => sum + (c.stats ? c.stats.studentCount : 0), 0);
  const generatedAt = new Date().toLocaleString('fr-FR');
  const tableRows = rows.map(c => {
    const sessions = c.sessions || [];
    const dateText = sessions.length
      ? (sessions.length === 1 ? humanDate(sessions[0].date) : humanDate(sessions[0].date) + ' → ' + humanDate(sessions[sessions.length - 1].date))
      : '(aucune séance)';
    return `<tr>
      <td>${dateText}</td>
      <td>${escapeHtml(courseTypeLabel(c.typeCode))}</td>
      <td>${c.stats ? c.stats.studentCount : 0}</td>
      <td>${escapeHtml(centerLabel(c.centerId))}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">Aucune activité</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Sommaire des activités accomplies</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 30px 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #777; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 18px 0; }
  th, td { border: 1px solid #ddd; padding: 7px 10px; text-align: left; }
  th { background: #f2f5f7; }
  .summary-badges { display: flex; gap: 16px; margin: 14px 0 6px; flex-wrap: wrap; }
  .badge-box { border: 1px solid #ccc; border-radius: 8px; padding: 8px 16px; font-size: 14px; }
  .print-bar { margin-bottom: 20px; }
  .print-bar button { padding: 9px 18px; font-size: 14px; cursor: pointer; border-radius: 6px; border: none; background: #0e6ba8; color: #fff; }
  @media print { .print-bar { display: none; } body { padding: 10px 20px; } }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button></div>
  <h1>Sommaire des activités accomplies</h1>
  ${state.settings.instructorName ? `<div class="muted">${escapeHtml(state.settings.instructorName)}${state.settings.instructorPadi ? ' — ' + escapeHtml(state.settings.instructorPadi) : ''}</div>` : ''}
  <div class="muted">Généré le ${generatedAt}</div>
  <div class="summary-badges">
    <div class="badge-box">Cours : <strong>${rows.length}</strong></div>
    <div class="badge-box">Étudiants (total, toutes activités) : <strong>${totalStudents}</strong></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Type</th><th>Nb étudiants</th><th>Centre</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { toast('Le navigateur a bloqué l\'ouverture du rapport. Autorisez les popups pour ce site puis réessayez.', true); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---------- New course ----------
function renderNewCourse() {
  const app = document.getElementById('app');
  const typeOptions = state.courseTypes.map(t => `<option value="${t.code}">${escapeHtml(t.label)} (${t.code})</option>`).join('');
  const siteOptions = `<option value="">-- choisir --</option>` + state.sites.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  const tplOptions = `<option value="">-- aucun --</option>` + state.emailTemplates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  const centerOptions = `<option value="">-- choisir --</option>` + state.centers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  app.innerHTML = `
    <h1>Nouveau cours</h1>
    ${!state.centers.length ? `<div class="setup-note">Aucun centre partenaire enregistré. <a href="#/settings">Ajoutez-en un dans Paramètres</a> avant de créer un cours — le centre mandataire est obligatoire.</div>` : ''}
    <div class="card">
      <div class="row">
        <div><label for="f-type">Type de cours (modèle) *</label><select id="f-type">${typeOptions}</select></div>
        <div><label for="f-center">Centre mandataire *</label><select id="f-center">${centerOptions}</select></div>
        <div><label for="f-template">Modèle d'email associé</label><select id="f-template">${tplOptions}</select></div>
      </div>
      <fieldset class="check-group" id="f-instructors">
        <legend>Instructeurs / coéquipiers de ce cours <span class="muted">(optionnel — cochez-en un ou plusieurs)</span></legend>
        ${state.buddies.map(b => `<label class="checklist-item"><input type="checkbox" value="${escapeHtml(b.id)}"> <span>${escapeHtml(buddyLabel(b))}</span></label>`).join('')}
      </fieldset>
      ${!state.buddies.length ? '<p class="muted">Aucun coéquipier enregistré — ajoutez-en dans Paramètres pour pouvoir, plus tard, désigner qui a certifié chaque étudiant.</p>' : ''}
      <h3 style="margin-top:16px">Première séance</h3>
      <div class="row">
        <div><label for="f-date">Date *</label>${plainDateInputHtml('f-date', '', 'f-date')}</div>
        <div><label for="f-time-start">Heure de début</label>${timeInputHtml("", "", "f-time-start")}</div>
        <div><label for="f-time-end">Heure de fin</label>${timeInputHtml("", "", "f-time-end")}</div>
        <div><label for="f-site">Lieu</label><select id="f-site">${siteOptions}</select></div>
      </div>
      <p class="muted">Vous pourrez ajouter d'autres séances (dates/heures/lieux) et changer le modèle d'email après la création du cours.</p>
      <label for="f-notes">Notes</label>
      <textarea id="f-notes" placeholder="Notes libres sur ce cours..."></textarea>
      <label class="checklist-item" style="margin-top:12px"><input type="checkbox" id="f-billable" checked> <span>Ce cours est facturé <span class="muted">— décochez si vous ne le facturez pas (modifiable ensuite dans la fiche du cours)</span></span></label>
      <div class="actions-inline">
        <button class="btn" id="f-submit">Créer le cours</button>
      </div>
      <p class="form-error" id="f-error" role="alert"></p>
      <p class="muted">* champs obligatoires</p>
    </div>
  `;
  attachPlainDateAutoFormat(app);
  // Dès qu'un champ en erreur est corrigé, on retire sa mise en évidence.
  app.querySelectorAll('#f-type, #f-center, .f-date').forEach(n => ['input', 'change'].forEach(evt => n.addEventListener(evt, () => n.classList.remove('field-error'))));
  document.getElementById('f-submit').addEventListener('click', async () => {
    const typeCode = document.getElementById('f-type').value;
    const centerId = document.getElementById('f-center').value;
    const date = displayToIsoDate(app.querySelector('.f-date').value);
    const timeStart = document.getElementById('f-time-start').value;
    const timeEnd = document.getElementById('f-time-end').value;
    const siteId = document.getElementById('f-site').value;
    const notes = document.getElementById('f-notes').value;
    const emailTemplateId = document.getElementById('f-template').value;
    const instructorIds = Array.from(document.querySelectorAll('#f-instructors input:checked')).map(o => o.value);
    // Validation : chaque champ fautif est encadré en rouge, le premier reçoit le curseur.
    const dateInput = app.querySelector('.f-date');
    const problems = [];
    if (!typeCode) problems.push([document.getElementById('f-type'), 'choisissez un type de cours']);
    if (!centerId) problems.push([document.getElementById('f-center'), 'choisissez le centre mandataire']);
    if (!date) problems.push([dateInput, dateInput.value.trim() ? 'la date est invalide (format JJ/MM/AAAA)' : 'indiquez la date de la première séance']);
    app.querySelectorAll('.field-error').forEach(n => n.classList.remove('field-error'));
    if (problems.length) {
      problems.forEach(([node]) => node.classList.add('field-error'));
      document.getElementById('f-error').textContent = 'À corriger : ' + problems.map(p2 => p2[1]).join(' ; ') + '.';
      problems[0][0].focus();
      return;
    }
    document.getElementById('f-error').textContent = '';
    await withBusy(document.getElementById('f-submit'), async () => {
      try {
        const c = await api('POST', '/api/courses', { typeCode, notes, emailTemplateId, centerId, instructorIds, billable: document.getElementById('f-billable').checked, session: { date, timeStart, timeEnd, siteId } });
        toast('Cours créé : ' + c.id);
        location.hash = '#/course/' + encodeURIComponent(c.id);
      } catch (e) {
        document.getElementById('f-error').textContent = e.data && e.data.error === 'COURSE_EXISTS'
          ? 'Un cours existe déjà pour ce type et cette date.'
          : (e.data && e.data.error === 'CENTER_REQUIRED' ? 'Le centre mandataire est obligatoire.' : friendlyError(e));
      }
    }, 'Création en cours...');
  });
}

// ---------- Course detail ----------
function computeOverallStats(course, type) {
  const gPre = countDocGroup(course.generalPreDocs, type.generalPreDocs);
  const gPost = countDocGroup(course.generalPostDocs, type.generalPostDocs);
  let totalPre = gPre.total, donePre = gPre.done, totalPost = gPost.total, donePost = gPost.done;
  (course.students || []).forEach(s => {
    const p = countDocGroup(s.preDocs, type.preDocs);
    const q = countDocGroup(s.postDocs, type.postDocs);
    totalPre += p.total; donePre += p.done;
    totalPost += q.total; donePost += q.done;
  });
  return {
    prePct: totalPre ? Math.round(100 * donePre / totalPre) : 100,
    postPct: totalPost ? Math.round(100 * donePost / totalPost) : 100
  };
}
function refreshCourseBadges(course, type) {
  const { prePct, postPct } = computeOverallStats(course, type);
  const preEl = document.getElementById('course-pre-badge');
  const postEl = document.getElementById('course-post-badge');
  if (preEl) { preEl.textContent = prePct + '% des documents pré-cours collectés'; preEl.className = 'badge ' + badgeClass(prePct); }
  if (postEl) { postEl.textContent = postPct + '% des documents post-cours collectés'; postEl.className = 'badge ' + badgeClass(postPct); }
}
function updateStudentBadges(s, type) {
  const p = countDocGroup(s.preDocs, type.preDocs);
  const q = countDocGroup(s.postDocs, type.postDocs);
  const prePct = p.total ? Math.round(100 * p.done / p.total) : 100;
  const postPct = q.total ? Math.round(100 * q.done / q.total) : 100;
  const preBadge = document.querySelector(`[data-pre-badge="${s.folder}"]`);
  const postBadge = document.querySelector(`[data-post-badge="${s.folder}"]`);
  if (preBadge) { preBadge.textContent = 'Pré ' + prePct + '%'; preBadge.className = 'badge ' + badgeClass(prePct); }
  if (postBadge) { postBadge.textContent = 'Post ' + postPct + '%'; postBadge.className = 'badge ' + badgeClass(postPct); }
}

// Construit une case à cocher générique (utilisée pour les documents d'un étudiant OU les documents
// généraux d'un cours) et met à jour uniquement les badges concernés après enregistrement, sans jamais
// recharger toute la page — c'est ce qui permet de cocher plusieurs cases à la suite sans que le panneau se referme.
// Pour un document "conditional" (ex: certificat médical, autorisation parentale), un second interrupteur
// "Nécessaire ?" apparaît : le document ne compte dans le score que si celui-ci est activé.
function buildGenericChecklistItem(dataObj, group, docDef, putUrl, onChanged) {
  const req = docRequirement(docDef);
  const entry = (dataObj[group] && dataObj[group][docDef.id]) || { collected: false, date: null, needed: req === 'required' };
  const item = el(`<div class="checklist-item-row"></div>`);

  if (req === 'conditional') {
    item.innerHTML = `
      <label class="checklist-item">
        <input type="checkbox" class="needed-toggle" ${entry.needed ? 'checked' : ''}>
        <span>Nécessaire ?</span>
      </label>
      <label class="checklist-item">
        <input type="checkbox" class="collected-toggle">
        <span>${escapeHtml(docDef.label)}</span>
        <span class="muted doc-date"></span>
      </label>
    `;
  } else {
    item.innerHTML = `
      <label class="checklist-item">
        <input type="checkbox" class="collected-toggle">
        <span>${escapeHtml(docDef.label)}</span>
        ${req === 'optional' ? '<span class="muted">(optionnel — n\'affecte pas le score)</span>' : ''}
        <span class="muted doc-date"></span>
      </label>
    `;
  }
  const collectedInput = item.querySelector('.collected-toggle');
  collectedInput.checked = !!entry.collected;
  const dateSpan = item.querySelector('.doc-date');
  dateSpan.textContent = entry.date ? '— ' + humanDate(entry.date) : '';

  async function persist(newEntry) {
    const updatedGroup = { ...(dataObj[group] || {}) };
    updatedGroup[docDef.id] = newEntry;
    dataObj[group] = updatedGroup;
    try {
      await api('PUT', putUrl, { [group]: updatedGroup });
      Object.assign(entry, newEntry);
      if (onChanged) onChanged();
      return true;
    } catch (e) {
      toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
      return false;
    }
  }

  collectedInput.addEventListener('change', async (ev) => {
    const collected = ev.target.checked;
    const dateVal = collected ? new Date().toISOString().slice(0, 10) : null;
    const ok = await persist({ ...entry, collected, date: dateVal });
    if (ok) { dateSpan.textContent = dateVal ? '— ' + humanDate(dateVal) : ''; }
    else { ev.target.checked = !collected; }
  });

  const neededInput = item.querySelector('.needed-toggle');
  if (neededInput) {
    neededInput.checked = !!entry.needed;
    neededInput.addEventListener('change', async (ev) => {
      const needed = ev.target.checked;
      const ok = await persist({ ...entry, needed });
      if (!ok) { ev.target.checked = !needed; }
    });
  }

  return item;
}

// Construit la cellule "Coéquipiers" d'une séance : chips pour les coéquipiers sélectionnés dans la
// liste globale (avec bouton × pour retirer) + un menu "+ ajouter..." pour en choisir un autre.
// L'ancien texte libre (versions précédentes de l'app) reste affiché en dessous si présent.
function buildCoequipierCell(course, realIdx, persistSessions) {
  const sess = course.sessions[realIdx];
  const cell = el('<div class="coeq-cell"></div>');
  const selectedIds = sess.coequipierIds || [];

  function renderChips() {
    cell.querySelectorAll('.chip').forEach(c => c.remove());
    const addSelect = cell.querySelector('.coeq-add-select');
    selectedIds.slice().reverse().forEach(id => {
      const b = state.buddies.find(x => x.id === id);
      const chip = el(`<span class="chip">${escapeHtml(buddyLabel(b))} <button type="button" class="chip-remove">×</button></span>`);
      chip.querySelector('.chip-remove').addEventListener('click', async () => {
        const idx = selectedIds.indexOf(id);
        if (idx > -1) selectedIds.splice(idx, 1);
        sess.coequipierIds = selectedIds;
        await persistSessions();
        toast('Coéquipier retiré');
        renderChips();
      });
      cell.insertBefore(chip, addSelect || null);
    });
  }

  const available = () => state.buddies.filter(b => !selectedIds.includes(b.id));
  function renderAddSelect() {
    const old = cell.querySelector('.coeq-add-select');
    if (old) old.remove();
    const opts = available();
    if (!opts.length) return;
    const select = el(`<select class="coeq-add-select"><option value="">+ ajouter...</option>${opts.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(buddyLabel(b))}</option>`).join('')}</select>`);
    select.addEventListener('change', async () => {
      if (!select.value) return;
      selectedIds.push(select.value);
      sess.coequipierIds = selectedIds;
      await persistSessions();
      toast('Coéquipier ajouté');
      renderChips();
      renderAddSelect();
    });
    cell.appendChild(select);
  }

  renderAddSelect();
  renderChips();
  if (sess.coequipiers) {
    cell.appendChild(el(`<div class="muted" style="width:100%;font-size:11px;margin-top:4px">Texte libre (ancien format) : ${escapeHtml(sess.coequipiers)}</div>`));
  }
  return cell;
}

function buildSessionsCard(course) {
  const totalDuration = totalSessionsDuration(course.sessions);
  const card = el(`<div class="card"><div class="actions-inline" style="justify-content:space-between;margin-top:0"><h2 style="margin:0">Séances (date / heure / lieu)</h2><button class="btn small secondary" id="ics-course-btn" title="Fichier .ics à ouvrir dans Outlook, Google Agenda ou Calendrier">📅 Ajouter au calendrier</button></div>${totalDuration ? `<p class="muted">Durée totale du cours : <strong>${totalDuration}</strong> (utile pour la facturation)</p>` : ''}</div>`);
  course.sessions = course.sessions || [];
  card.querySelector('#ics-course-btn').addEventListener('click', () => downloadIcs(`ScubaPilot-${course.id}.ics`, [course]));
  const siteOptionsHtml = (selectedId) => `<option value="">-- choisir --</option>` +
    state.sites.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  const sortedIdx = course.sessions.map((s, i) => i).sort((a, b) => (course.sessions[a].date || '').localeCompare(course.sessions[b].date || ''));

  async function persistSessions() {
    await api('PUT', `/api/courses/${encodeURIComponent(course.id)}`, { sessions: course.sessions });
  }

  if (sortedIdx.length) {
    const table = el('<table><thead><tr><th>Date</th><th>Début</th><th>Fin</th><th>Durée</th><th>Lieu</th><th>Notes</th><th>Coéquipiers</th><th></th></tr></thead><tbody></tbody></table>');
    const tbody = table.querySelector('tbody');
    sortedIdx.forEach(realIdx => {
      const sess = course.sessions[realIdx];
      const tr = elRow(`
        <tr>
          <td>${plainDateInputHtml('sess-date', sess.date || '')}</td>
          <td>${timeInputHtml("sess-time-start", sess.timeStart)}</td>
          <td>${timeInputHtml("sess-time-end", sess.timeEnd)}</td>
          <td class="sess-duration muted">${sessionDuration(sess.timeStart, sess.timeEnd)}</td>
          <td><select class="sess-site">${siteOptionsHtml(sess.siteId)}</select></td>
          <td><input class="sess-notes" value="${escapeHtml(sess.notes || '')}"></td>
          <td class="sess-coeq-td"></td>
          <td><button class="btn small danger">Suppr.</button></td>
        </tr>
      `);
      attachPlainDateAutoFormat(tr);
      const durationCell = tr.querySelector('.sess-duration');
      tr.querySelector('.sess-coeq-td').appendChild(buildCoequipierCell(course, realIdx, persistSessions));
      tr.querySelector('.sess-date').addEventListener('change', async (ev) => {
        const iso = displayToIsoDate(ev.target.value);
        if (!iso) { toast('Date invalide (format attendu JJ/MM/AAAA)', true); ev.target.value = isoToDisplayDate(sess.date); return; }
        course.sessions[realIdx].date = iso;
        await persistSessions();
        toast('Séance mise à jour');
        route();
      });
      tr.querySelector('.sess-time-start').addEventListener('change', async (ev) => {
        course.sessions[realIdx].timeStart = ev.target.value;
        durationCell.textContent = sessionDuration(course.sessions[realIdx].timeStart, course.sessions[realIdx].timeEnd);
        await persistSessions();
        toast('Séance mise à jour');
      });
      tr.querySelector('.sess-time-end').addEventListener('change', async (ev) => {
        course.sessions[realIdx].timeEnd = ev.target.value;
        durationCell.textContent = sessionDuration(course.sessions[realIdx].timeStart, course.sessions[realIdx].timeEnd);
        await persistSessions();
        toast('Séance mise à jour');
      });
      tr.querySelector('.sess-site').addEventListener('change', async (ev) => {
        course.sessions[realIdx].siteId = ev.target.value;
        await persistSessions();
        toast('Séance mise à jour');
      });
      tr.querySelector('.sess-notes').addEventListener('change', async (ev) => {
        course.sessions[realIdx].notes = ev.target.value;
        await persistSessions();
        toast('Séance mise à jour');
      });
      tr.querySelector('button.danger').addEventListener('click', async () => {
        if (!(await confirmDelete('Supprimer cette séance ?'))) return;
        course.sessions.splice(realIdx, 1);
        await persistSessions();
        toast('Séance supprimée');
        route();
      });
      tbody.appendChild(tr);
    });
    card.appendChild(table);
  } else {
    card.appendChild(el(`<p class="muted">Aucune séance planifiée.</p>`));
  }

  // Formulaire d'ajout repliable, pour ne pas occuper de place verticale en permanence.
  const toggleBtn = el(`<button class="btn small secondary" id="toggle-add-session" style="margin-top:12px">+ Ajouter une séance</button>`);
  const siteOptions = siteOptionsHtml('');
  const addForm = el(`
    <div style="margin-top:14px; display:none">
      <div class="row">
        <div><label for="ns-date">Date</label>${plainDateInputHtml('ns-date', '', 'ns-date')}</div>
        <div><label for="ns-time-start">Heure de début</label>${timeInputHtml("", "", "ns-time-start")}</div>
        <div><label for="ns-time-end">Heure de fin</label>${timeInputHtml("", "", "ns-time-end")}</div>
        <div><label for="ns-site">Lieu</label><select id="ns-site">${siteOptions}</select></div>
      </div>
      <label for="ns-notes">Notes (optionnel)</label><input id="ns-notes">
      <label style="margin-top:10px">Coéquipiers (optionnel, maintenez Ctrl/Cmd pour en choisir plusieurs)</label>
      <select id="ns-buddies" multiple size="4">
        ${state.buddies.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(buddyLabel(b))}</option>`).join('')}
      </select>
      ${!state.buddies.length ? '<p class="muted">Aucun coéquipier enregistré — ajoutez-en dans Paramètres.</p>' : ''}
      <div class="actions-inline">
        <button class="btn small" id="ns-add">Ajouter cette séance</button>
        <button class="btn small secondary" id="ns-cancel">Annuler</button>
      </div>
    </div>
  `);
  attachPlainDateAutoFormat(addForm);
  toggleBtn.addEventListener('click', () => {
    addForm.style.display = 'block';
    toggleBtn.style.display = 'none';
  });
  addForm.querySelector('#ns-cancel').addEventListener('click', () => {
    addForm.style.display = 'none';
    toggleBtn.style.display = 'inline-block';
  });
  addForm.querySelector('#ns-add').addEventListener('click', async () => {
    const date = displayToIsoDate(addForm.querySelector('.ns-date').value);
    if (!date) { toast('Merci de saisir une date valide (JJ/MM/AAAA)', true); return; }
    const coequipierIds = Array.from(addForm.querySelector('#ns-buddies').selectedOptions).map(o => o.value);
    course.sessions.push({
      date, timeStart: addForm.querySelector('#ns-time-start').value, timeEnd: addForm.querySelector('#ns-time-end').value,
      siteId: addForm.querySelector('#ns-site').value,
      notes: addForm.querySelector('#ns-notes').value,
      coequipierIds
    });
    await api('PUT', `/api/courses/${encodeURIComponent(course.id)}`, { sessions: course.sessions });
    toast('Séance ajoutée');
    route();
  });
  card.appendChild(toggleBtn);
  card.appendChild(addForm);
  return card;
}

function buildGeneralDocsCard(course, type) {
  const card = el(`<div class="card"><h2>Documents généraux du cours</h2></div>`);
  const pre = type.generalPreDocs || [], post = type.generalPostDocs || [];
  if (!pre.length && !post.length) {
    card.appendChild(el(`<p class="muted">Aucun document général défini pour ce type de cours (non lié à un étudiant en particulier).</p>`));
    card.appendChild(el('<h3 style="margin-top:16px">Fichiers du cours</h3>'));
    card.appendChild(buildDropZone(`/api/courses/${encodeURIComponent(course.id)}/upload`, course.files || [], 'Glissez un document du cours ici, ou'));
    return card;
  }
  const cols = el(`<div class="two-col"><div><h3>Avant le cours</h3><div class="gpre"></div></div><div><h3>Après le cours</h3><div class="gpost"></div></div></div>`);
  const preBox = cols.querySelector('.gpre');
  pre.forEach(d => preBox.appendChild(buildGenericChecklistItem(course, 'generalPreDocs', d, `/api/courses/${encodeURIComponent(course.id)}`, () => refreshCourseBadges(course, type))));
  if (!pre.length) preBox.appendChild(el('<p class="muted">Aucun.</p>'));
  const postBox = cols.querySelector('.gpost');
  post.forEach(d => postBox.appendChild(buildGenericChecklistItem(course, 'generalPostDocs', d, `/api/courses/${encodeURIComponent(course.id)}`, () => refreshCourseBadges(course, type))));
  if (!post.length) postBox.appendChild(el('<p class="muted">Aucun.</p>'));
  card.appendChild(cols);
  card.appendChild(el('<h3 style="margin-top:16px">Fichiers du cours</h3>'));
  card.appendChild(buildDropZone(`/api/courses/${encodeURIComponent(course.id)}/upload`, course.files || [], 'Glissez un document général du cours ici (ex: assurance, feuille de présence), ou'));
  return card;
}

// Partie du contexte de fusion commune aux emails individuels et à l'email groupé (séances/dates/lieux).
function coequipierNames(sess) {
  const fromList = (sess.coequipierIds || []).map(id => { const b = state.buddies.find(x => x.id === id); return b ? buddyLabel(b) : null; }).filter(Boolean);
  const parts = [...fromList];
  if (sess.coequipiers) parts.push(sess.coequipiers);
  return parts.join(', ');
}
// Formatte l'heure d'une séance : "9h00 à 12h00" si début et fin connus, sinon juste l'heure de début.
function sessionTimeLabel(sess) {
  if (sess.timeStart && sess.timeEnd) return `de ${sess.timeStart} à ${sess.timeEnd}`;
  if (sess.timeStart) return `à ${sess.timeStart}`;
  return '';
}
function buildSessionsContext(course) {
  const sessions = (course.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timeStart || '').localeCompare(b.timeStart || ''));
  const listeDatesLieux = sessions.length
    ? sessions.map(sess => `- ${humanDate(sess.date)}${sessionTimeLabel(sess) ? ' ' + sessionTimeLabel(sess) : ''} — ${siteLabel(sess.siteId)}`).join('\n')
    : '(aucune séance planifiée)';
  const listeDatesLieuxNoteCoequipier = sessions.length
    ? sessions.map(sess => {
        let line = `Rendez-vous le ${humanDate(sess.date)}${sessionTimeLabel(sess) ? ' ' + sessionTimeLabel(sess) : ''}, ${siteLabel(sess.siteId)}`;
        if (sess.notes) line += `, ${sess.notes}`;
        const names = coequipierNames(sess);
        if (names) line += `, et nous serons accompagnés de ${names}`;
        return '- ' + line;
      }).join('\n')
    : '(aucune séance planifiée)';
  const dateDebut = sessions.length ? humanDate(sessions[0].date) : '';
  const dateFin = sessions.length ? humanDate(sessions[sessions.length - 1].date) : '';
  const lieu = [...new Set(sessions.map(sess => siteLabel(sess.siteId)).filter(Boolean))].join(', ');
  return { listeDatesLieux, listeDatesLieuxNoteCoequipier, dateDebut, dateFin, lieu };
}

// Équipe d'un cours : les instructeurs rattachés au cours, puis les coéquipiers des séances
// (Divemasters, autres instructeurs), sans doublon. Sert à la copie (Cc) des courriels et à {equipe}.
function courseTeam(course) {
  const ids = [...(course.instructorIds || [])];
  (course.sessions || []).forEach(sess => (sess.coequipierIds || []).forEach(id => ids.push(id)));
  const seen = new Set();
  return ids.map(id => buddyById(id)).filter(b => b && !seen.has(b.id) && seen.add(b.id));
}
const sameAddress = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const sameName = (a, b) => normHead(a) === normHead(b);
// Adresses à mettre en copie : instructeurs et coéquipiers du cours (sauf vous, déjà destinataire),
// précédées des adresses données (ex. : le Cc par défaut des Paramètres), sans doublon.
function courseCcList(course, extra) {
  const me = state.settings && state.settings.instructorEmail;
  const out = [];
  const add = a => { a = String(a || '').trim(); if (a && !sameAddress(a, me) && !out.some(x => sameAddress(x, a))) out.push(a); };
  (extra || []).forEach(add);
  courseTeam(course).forEach(b => add(b.email));
  return out;
}
// « Arnaud LINA, Karim Ait Oumeziane et Martin Chamberland » : vous d'abord, puis l'équipe du cours.
function courseTeamNames(course) {
  const me = (state.settings && state.settings.instructorName) || '';
  const names = me ? [me] : [];
  courseTeam(course).forEach(b => {
    if ((me && sameName(b.name, me)) || sameAddress(b.email, state.settings && state.settings.instructorEmail)) return;
    if (!names.some(n => sameName(n, b.name))) names.push(b.name);
  });
  return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
}

// Contexte pour un email personnalisé à UN étudiant (inclut ses documents manquants à lui).
function buildEmailContext(course, type, s) {
  const sc = buildSessionsContext(course);
  const missingPre = Object.entries(s.preDocs || {})
    .filter(([id, v]) => !v.collected)
    .map(([id]) => (type.preDocs || []).find(d => d.id === id)?.label || id);
  const allPre = (type.preDocs || []).map(d => d.label);
  return {
    prenom: s.firstName, nom: s.lastName,
    type_cours: courseTypeLabel(course.typeCode),
    date_debut: sc.dateDebut, date_fin: sc.dateFin, lieu: sc.lieu,
    liste_dates_lieux: sc.listeDatesLieux,
    liste_dates_lieux_note_coequipier: sc.listeDatesLieuxNoteCoequipier,
    instructeur: state.settings.instructorName || '',
    instructeur_tel: state.settings.instructorPhone || '',
    instructeur_padi: state.settings.instructorPadi || '',
    equipe: courseTeamNames(course),
    liste_docs_pre: allPre.length ? '- ' + allPre.join('\n- ') : '(aucun)',
    liste_docs_manquants: missingPre.length ? '- ' + missingPre.join('\n- ') : '(aucun document manquant)'
  };
}

// Contexte pour l'email GROUPÉ (un seul message pour tout le cours) : pas de "prénom" ni de documents
// manquants individuels puisque le message n'est pas personnalisé par étudiant.
function buildGroupEmailContext(course, type) {
  const sc = buildSessionsContext(course);
  const allPre = (type.preDocs || []).map(d => d.label);
  const listeEtudiants = course.students.length ? course.students.map(s => `${s.firstName} ${s.lastName}`).join(', ') : '(aucun étudiant)';
  return {
    prenom: '', nom: '',
    type_cours: courseTypeLabel(course.typeCode),
    date_debut: sc.dateDebut, date_fin: sc.dateFin, lieu: sc.lieu,
    liste_dates_lieux: sc.listeDatesLieux,
    liste_dates_lieux_note_coequipier: sc.listeDatesLieuxNoteCoequipier,
    liste_etudiants: listeEtudiants,
    instructeur: state.settings.instructorName || '',
    instructeur_tel: state.settings.instructorPhone || '',
    instructeur_padi: state.settings.instructorPadi || '',
    equipe: courseTeamNames(course),
    liste_docs_pre: allPre.length ? '- ' + allPre.join('\n- ') : '(aucun)',
    liste_docs_manquants: ''
  };
}

function renderEmailBatch(box, course, type, tpl) {
  const withEmail = course.students.filter(s => s.email);
  box.innerHTML = '';
  if (!tpl) { box.appendChild(el('<p class="muted">Choisissez d\'abord un modèle ci-dessus.</p>')); return; }
  if (!withEmail.length) { box.appendChild(el('<p class="muted">Aucun étudiant avec une adresse email.</p>')); return; }
  const composed = withEmail.map(s => {
    const ctx = buildEmailContext(course, type, s);
    return { student: s, subject: mergeTemplate(tpl.subject, ctx), bodyHtml: mergeTemplateHtml(templateBodyHtml(tpl), ctx) };
  });
  const cc = courseCcList(course).join(', ');
  box.appendChild(el(`<p class="muted" style="margin:10px 0">Un message par étudiant. Copiez l'adresse, l'objet et le message avec 📋, puis collez-les dans votre messagerie.</p>`));
  composed.forEach(c => {
    const item = el(`
      <div class="student-block">
        <div class="student-header" style="cursor:default">
          <div><strong>${escapeHtml(c.student.firstName)} ${escapeHtml(c.student.lastName)}</strong></div>
        </div>
        <div class="student-details open">
          ${copyFieldHtml({ label: 'À', value: c.student.email, cls: 'em-to' })}
          ${cc ? copyFieldHtml({ label: 'Cc — instructeurs et coéquipiers du cours', value: cc, cls: 'em-cc' }) : ''}
          ${copyFieldHtml({ label: 'Objet', value: c.subject, cls: 'em-subject' })}
          ${copyFieldHtml({ label: 'Message', html: c.bodyHtml, cls: 'em-body', rich: true, minHeight: 140 })}
          <div class="actions-inline"><button class="btn small secondary em-sent">✔ Marquer comme envoyé</button>
            <span class="muted" data-mail-log="${escapeHtml(c.student.folder)}" title="${escapeHtml(mailLogHistory(c.student))}">${escapeHtml(mailLogText(c.student))}</span></div>
        </div>
      </div>
    `);
    wireCopyButtons(item);
    wireSentButton(item.querySelector('.em-sent'), async () => {
      await logMailSent(course, [c.student], { date: todayISO(), kind: 'individuel', template: tpl.name || '', subject: item.querySelector('.em-subject').value });
      toast(`Envoi noté pour ${c.student.firstName} ${c.student.lastName}`);
    });
    box.appendChild(item);
  });
}

// Compose UN SEUL email pour tout le cours : vous en destinataire, CC configurable
// (ex: le centre partenaire), tous les étudiants en copie cachée (CCI/BCC).
function renderGroupEmail(box, course, type, tpl) {
  box.innerHTML = '';
  if (!tpl) { box.appendChild(el('<p class="muted">Choisissez d\'abord un modèle ci-dessus.</p>')); return; }
  const studentEmails = course.students.map(s => s.email).filter(Boolean);
  const splitList = v => String(v || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  const ccList = courseCcList(course, splitList(state.settings.defaultCc));
  const bccList = [...new Set([...studentEmails, ...splitList(state.settings.defaultBcc)])].filter(a => !ccList.some(c => sameAddress(c, a)));
  const ctx = buildGroupEmailContext(course, type);
  const subject = mergeTemplate(tpl.subject, ctx);
  const bodyHtml = mergeTemplateHtml(templateBodyHtml(tpl), ctx);
  // {prenom} et {nom} désignent l'ÉTUDIANT : dans un message groupé, ils restent vides.
  const usesStudentName = /\{(prenom|nom)\}/.test((tpl.subject || '') + (tpl.bodyHtml || tpl.body || ''));
  const item = el(`
    <div class="student-block">
      <div class="student-header">
        <strong>Email groupé — un seul message pour tout le cours</strong>
      </div>
      <div class="student-details open">
        <p class="muted">Vous en destinataire ; en copie (Cc), le Cc par défaut des Paramètres et les instructeurs et coéquipiers du cours ; les étudiants en copie cachée (CCI). Copiez chaque élément avec 📋, puis collez-le dans votre messagerie.</p>
        ${usesStudentName ? `<p class="hint-warn">⚠ Ce modèle contient {prenom} ou {nom} : ces variables désignent l'étudiant et restent vides dans un message groupé. Pour vous nommer, utilisez {instructeur} ; pour nommer toute l'équipe du cours, {equipe}.</p>` : ''}
        ${copyFieldHtml({ id: 'grp-to', label: 'À (vous)', value: state.settings.instructorEmail || '' })}
        ${copyFieldHtml({ id: 'grp-cc', label: 'Cc — séparés par des virgules', value: ccList.join(', ') })}
        ${copyFieldHtml({ id: 'grp-bcc', label: 'Cci — séparés par des virgules', value: bccList.join(', ') })}
        ${copyFieldHtml({ id: 'grp-subject', label: 'Objet', value: subject })}
        ${copyFieldHtml({ id: 'grp-body', label: 'Message', html: bodyHtml, rich: true, minHeight: 200 })}
        <p class="muted" id="grp-warn"></p>
        <div class="actions-inline"><button class="btn small secondary" id="grp-sent">✔ Marquer comme envoyé aujourd'hui</button>
          <span class="muted">Une fois le courriel parti, notez-le : la date sera inscrite dans la fiche des ${course.students.filter(s => s.email).length} étudiant(s) ayant une adresse.</span></div>
      </div>
    </div>
  `);
  box.appendChild(item);
  wireCopyButtons(item);
  wireSentButton(item.querySelector('#grp-sent'), async () => {
    const n = await logMailSent(course, course.students.filter(s => s.email), { date: todayISO(), kind: 'groupe', template: tpl.name || '', subject: item.querySelector('#grp-subject').value });
    toast(`Envoi noté pour ${n} étudiant(s)`);
  });
  if (!state.settings.instructorEmail) {
    item.querySelector('#grp-warn').textContent = 'Astuce : renseignez votre email dans Paramètres pour préremplir le champ "À" automatiquement.';
  }
}

function buildCommunicationsCard(course, type) {
  const card = el(`<div class="card"><h2>Communications</h2></div>`);
  const emails = course.students.map(s => s.email).filter(Boolean);
  card.appendChild(el(`<p class="muted">${emails.length} étudiant(s) avec une adresse email sur ${course.students.length}.</p>`));
  card.appendChild(el(`<p class="muted" data-mail-summary>${escapeHtml(mailSummaryText(course))}</p>`));

  const tplOptions = `<option value="">-- choisir un modèle --</option>` +
    state.emailTemplates.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === course.emailTemplateId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
  const tplRow = el(`
    <div class="row" style="align-items:flex-end">
      <div><label for="comm-template">Modèle associé à ce cours</label><select id="comm-template">${tplOptions}</select></div>
    </div>
  `);
  card.appendChild(tplRow);
  if (!state.emailTemplates.length) {
    card.appendChild(el('<p class="muted">Aucun modèle disponible — créez-en un dans Paramètres → Modèles d\'email.</p>'));
  }

  const btnRow = el(`
    <div class="actions-inline">
      <button class="btn small secondary" id="copy-emails-btn">📋 Copier la liste des emails</button>
      <button class="btn small" id="gen-group-btn">Un seul email groupé (étudiants en CCI)</button>
      <button class="btn small secondary" id="gen-emails-btn">Un email par étudiant (personnalisé)</button>
    </div>
  `);
  card.appendChild(btnRow);
  const resultsBox = el(`<div class="comm-results"></div>`);
  card.appendChild(resultsBox);

  const templateSelect = tplRow.querySelector('#comm-template');
  templateSelect.addEventListener('change', async () => {
    course.emailTemplateId = templateSelect.value;
    await api('PUT', `/api/courses/${encodeURIComponent(course.id)}`, { emailTemplateId: course.emailTemplateId });
    toast('Modèle associé à ce cours');
  });

  btnRow.querySelector('#copy-emails-btn').addEventListener('click', () => {
    if (!emails.length) { toast('Aucune adresse email renseignée', true); return; }
    copyText(emails.join(', ')).then(() => toast(`${emails.length} adresse(s) copiée(s)`));
  });
  btnRow.querySelector('#gen-group-btn').addEventListener('click', () => {
    const tpl = state.emailTemplates.find(t => t.id === templateSelect.value);
    if (!tpl) { toast('Choisissez un modèle d\'abord', true); return; }
    renderGroupEmail(resultsBox, course, type, tpl);
  });
  btnRow.querySelector('#gen-emails-btn').addEventListener('click', () => {
    const tpl = state.emailTemplates.find(t => t.id === templateSelect.value);
    if (!tpl) { toast('Choisissez un modèle d\'abord', true); return; }
    renderEmailBatch(resultsBox, course, type, tpl);
  });
  return card;
}

// ---------- Rapport de cours imprimable ----------
// Une seule ligne de checklist pour le rapport, tenant compte du statut requis/optionnel/conditionnel.
function reportDocLine(entry, docDef) {
  entry = entry || { collected: false, needed: false };
  const req = docRequirement(docDef);
  if (req === 'conditional' && !entry.needed) {
    return `<li class="doc-na">○ ${escapeHtml(docDef.label)} <span class="muted">(non nécessaire)</span></li>`;
  }
  const mark = entry.collected ? '☑' : '☐';
  const cls = entry.collected ? 'doc-ok' : 'doc-missing';
  const tag = req === 'optional' ? ' <span class="muted">(optionnel)</span>' : (req === 'conditional' ? ' <span class="muted">(nécessaire)</span>' : '');
  return `<li class="${cls}">${mark} ${escapeHtml(docDef.label)}${tag}</li>`;
}

function buildReportHtml(course, type) {
  const sessions = (course.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timeStart || '').localeCompare(b.timeStart || ''));
  const stats = computeOverallStats(course, type);
  const generatedAt = new Date().toLocaleString('fr-FR');
  const totalDuration = totalSessionsDuration(sessions);

  const sessionsRows = sessions.length ? sessions.map(sess => `
    <tr>
      <td>${humanDate(sess.date)}</td>
      <td>${escapeHtml(sess.timeStart || '-')}</td>
      <td>${escapeHtml(sess.timeEnd || '-')}</td>
      <td>${escapeHtml(sessionDuration(sess.timeStart, sess.timeEnd) || '-')}</td>
      <td>${escapeHtml(siteLabel(sess.siteId))}</td>
      <td>${escapeHtml(sess.notes || '')}</td>
      <td>${escapeHtml(coequipierNames(sess) || '')}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">Aucune séance planifiée</td></tr>';

  const genPreItems = (type.generalPreDocs || []).map(d => reportDocLine(course.generalPreDocs && course.generalPreDocs[d.id], d)).join('');
  const genPostItems = (type.generalPostDocs || []).map(d => reportDocLine(course.generalPostDocs && course.generalPostDocs[d.id], d)).join('');

  const studentsHtml = course.students.map(s => {
    const p = countDocGroup(s.preDocs, type.preDocs);
    const q = countDocGroup(s.postDocs, type.postDocs);
    const prePct = p.total ? Math.round(100 * p.done / p.total) : 100;
    const postPct = q.total ? Math.round(100 * q.done / q.total) : 100;
    const infoLines = state.studentFields
      .filter(f => f.id !== 'firstName' && f.id !== 'lastName')
      .map(f => {
        let v = fieldValueOf(s, f);
        if (!v) return '';
        if (f.type === 'date') {
          const age = f.id === 'birthDate' ? calculateAge(v) : null;
          v = humanDate(v) + (age !== null ? ` (${age} ans)` : '');
        }
        if (f.type === 'select') { const opt = (f.options || []).find(o => o.value === v); v = opt ? opt.label : v; }
        return `<div><span class="muted">${escapeHtml(f.label)} :</span> ${escapeHtml(v)}</div>`;
      }).filter(Boolean).join('');
    const preItems = (type.preDocs || []).map(d => reportDocLine(s.preDocs && s.preDocs[d.id], d)).join('');
    const postItems = (type.postDocs || []).map(d => reportDocLine(s.postDocs && s.postDocs[d.id], d)).join('');
    return `
      <div class="student-card">
        <h3>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)} <span class="pct">Pré ${prePct}% · Post ${postPct}%${studentHasCertification(s) ? ` · ${s.certificationConfirmed ? '✅ Certifié' : '❌ Non certifié'}${s.certifyingInstructorId ? ' (' + escapeHtml(buddyLabelById(s.certifyingInstructorId)) + ')' : ''}` : ` · ${s.fileTransferred ? '📁 Dossier transféré' : '📁 Dossier non transféré'}`}</span></h3>
        <div class="student-info">${infoLines || '<span class="muted">Aucune coordonnée renseignée</span>'}</div>
        ${s.note && s.note.trim() ? `<div class="student-note-print"><strong>Notes :</strong> ${escapeHtml(s.note).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="two-col-print">
          <div><h4>Documents pré-cours</h4><ul>${preItems || '<li class="muted">Aucun</li>'}</ul></div>
          <div><h4>Documents post-cours</h4><ul>${postItems || '<li class="muted">Aucun</li>'}</ul></div>
        </div>
      </div>`;
  }).join('');

  const instructorLine1 = `${escapeHtml(state.settings.instructorName || '')}${state.settings.instructorPadi ? ' — ' + escapeHtml(state.settings.instructorPadi) : ''}`;
  const contactBits = [state.settings.instructorEmail, state.settings.instructorPhone].filter(Boolean).map(escapeHtml).join(' · ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport — ${escapeHtml(courseTypeLabel(course.typeCode))} — ${escapeHtml(course.id)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 30px 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 26px 0 8px; border-bottom: 2px solid #0e6ba8; padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: center; }
  h4 { font-size: 12px; margin: 10px 0 4px; text-transform: uppercase; color: #555; }
  .muted { color: #777; }
  .header-meta { font-size: 13px; color: #444; margin-bottom: 3px; }
  .summary-badges { display: flex; gap: 16px; margin: 14px 0 20px; flex-wrap: wrap; }
  .badge-box { border: 1px solid #ccc; border-radius: 8px; padding: 8px 16px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f2f5f7; }
  .student-card { border: 1px solid #ddd; border-radius: 8px; padding: 14px 18px; margin-bottom: 14px; page-break-inside: avoid; }
  .pct { font-size: 12px; font-weight: normal; color: #333; white-space: nowrap; }
  .student-info { font-size: 12px; margin-bottom: 8px; columns: 2; column-gap: 24px; }
  .student-note-print { font-size: 12px; background: #fdf6e9; border-left: 3px solid #e2a44a; padding: 6px 10px; margin-bottom: 8px; }
  .two-col-print { display: flex; gap: 30px; }
  .two-col-print > div { flex: 1; }
  ul { margin: 0; padding-left: 18px; font-size: 13px; }
  li { margin-bottom: 3px; }
  .doc-ok { color: #1a9c5e; }
  .doc-missing { color: #c0392b; }
  .doc-na { color: #999; }
  .print-bar { margin-bottom: 20px; }
  .print-bar button { padding: 9px 18px; font-size: 14px; cursor: pointer; border-radius: 6px; border: none; background: #0e6ba8; color: #fff; }
  @media print { .print-bar { display: none; } body { padding: 10px 20px; } .student-card { break-inside: avoid; } }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button></div>
  <div style="display:flex; align-items:center; gap:10px; margin-bottom:2px">
    <img src="${location.origin}/logo.svg" alt="" style="width:30px; height:30px">
    <span style="font-size:13px; font-weight:700; color:#0e6ba8">${escapeHtml(APP_NAME)}</span>
  </div>
  <h1>${escapeHtml(courseTypeLabel(course.typeCode))}</h1>
  <div class="header-meta">Identifiant du cours : ${escapeHtml(course.id)}</div>
  <div class="header-meta">Centre mandataire : ${escapeHtml(centerLabel(course.centerId))}</div>
  ${instructorLine1.trim() ? `<div class="header-meta">Instructeur : ${instructorLine1}</div>` : ''}
  ${contactBits ? `<div class="header-meta">${contactBits}</div>` : ''}
  <div class="header-meta muted">Rapport généré le ${generatedAt}</div>
  ${course.notes ? `<div class="header-meta"><strong>Notes :</strong> ${escapeHtml(course.notes)}</div>` : ''}

  <div class="summary-badges">
    <div class="badge-box">Documents pré-cours : <strong>${stats.prePct}%</strong></div>
    <div class="badge-box">Documents post-cours : <strong>${stats.postPct}%</strong></div>
    <div class="badge-box">Étudiants : <strong>${course.students.length}</strong></div>
    ${totalDuration ? `<div class="badge-box">Durée totale : <strong>${totalDuration}</strong></div>` : ''}
  </div>

  <h2>Séances</h2>
  <table>
    <thead><tr><th>Date</th><th>Début</th><th>Fin</th><th>Durée</th><th>Lieu</th><th>Notes</th><th>Coéquipiers</th></tr></thead>
    <tbody>${sessionsRows}</tbody>
  </table>

  <h2>Documents généraux du cours</h2>
  <div class="two-col-print">
    <div><h4>Avant le cours</h4><ul>${genPreItems || '<li class="muted">Aucun</li>'}</ul></div>
    <div><h4>Après le cours</h4><ul>${genPostItems || '<li class="muted">Aucun</li>'}</ul></div>
  </div>

  <h2>Étudiants (${course.students.length})</h2>
  ${studentsHtml || '<p class="muted">Aucun étudiant inscrit.</p>'}
</body>
</html>`;
}

function exportReport(course, type) {
  const html = buildReportHtml(course, type);
  const win = window.open('', '_blank');
  if (!win) {
    toast('Le navigateur a bloqué l\'ouverture du rapport. Autorisez les popups pour ce site puis réessayez.', true);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---------- Facturation ----------
// Une facture par cours (stockée dans course.invoice) : groupes de tarification (description, part,
// prix unitaire), étudiants issus du cours affectés à un groupe, taxes optionnelles, lignes
// supplémentaires, logo et étampe. Les tarifs par défaut viennent de Paramètres → Facturation
// (grilles par centre et/ou type de cours), mais tout est modifiable sur la facture elle-même.
function normBilling(b) {
  b = Object.assign({}, b || {});
  b.currency = b.currency || 'CAD';
  b.taxes = b.taxes || {};
  b.taxes.tps = Object.assign({ label: 'T.P.S.', rate: 5 }, b.taxes.tps || {});
  b.taxes.tvq = Object.assign({ label: 'T.V.Q.', rate: 9.975 }, b.taxes.tvq || {});
  b.priceLists = Array.isArray(b.priceLists) ? b.priceLists : [];
  b.footer = b.footer !== undefined ? b.footer : 'MERCI DE VOTRE CONFIANCE !';
  b.counter = b.counter || { year: 0, last: 0 };
  return b;
}
function fmtNum(n) { return String(Math.round(n * 10000) / 10000).replace('.', ','); }
function fmtMoney(n) {
  const cur = (state.billing && state.billing.currency) || 'CAD';
  const sym = (cur === 'CAD' || cur === 'USD') ? '$' : cur;
  return (Number(n) || 0).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}
// Suivi de la facture : brouillon -> soumise (date) -> payée (date). Dates ISO stockées dans course.invoice.
function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}
function invoiceStatus(course) {
  // Un cours marqué « non facturé » (billable === false) sort du suivi : ni rappel, ni total.
  if (course && course.billable === false) return { key: 'nobill', label: "Ce cours n'est pas facturé", cls: '', short: 'Non facturé' };
  const inv = course && course.invoice;
  if (!inv) return { key: 'none', label: 'Aucune facture', cls: '', short: '—' };
  if (inv.paidDate) return { key: 'paid', label: 'Payée le ' + shortDate(inv.paidDate), cls: 'ok', short: 'Payée', date: inv.paidDate };
  if (inv.submittedDate) return { key: 'submitted', label: 'Soumise le ' + shortDate(inv.submittedDate) + ' — en attente de paiement', cls: 'warn', short: 'Soumise', date: inv.submittedDate };
  return { key: 'draft', label: 'Brouillon — non soumise', cls: '', short: 'Brouillon' };
}
function invoiceBadgeHtml(course, withDate) {
  const st = invoiceStatus(course);
  if (st.key === 'none') return '<span class="muted">—</span>';
  const txt = withDate && st.date ? `${st.short} · ${shortDate(st.date)}` : st.short;
  return st.cls
    ? `<span class="badge ${st.cls}" title="${escapeHtml(st.label)}">${st.key === 'paid' ? '💵' : '📤'} ${escapeHtml(txt)}</span>`
    : `<span class="tag-status" title="${escapeHtml(st.label)}">${escapeHtml(txt)}</span>`;
}
function suggestInvoiceNumber() {
  const y = new Date().getFullYear();
  const c = state.billing.counter || {};
  const last = c.year === y ? (c.last || 0) : 0;
  return `${y}-${String(last + 1).padStart(3, '0')}`;
}
// Grille de tarifs la plus spécifique : centre+type, centre, type, générale.
function pickPriceGroups(centerId, typeCode) {
  const lists = state.billing.priceLists || [];
  const score = l => {
    if (l.centerId && l.centerId !== centerId) return -1;
    if (l.typeCode && l.typeCode !== typeCode) return -1;
    return (l.centerId ? 2 : 0) + (l.typeCode ? 1 : 0);
  };
  let best = null, bs = -1;
  lists.forEach(l => { const s = score(l); if (s > bs) { bs = s; best = l; } });
  const groups = best && (best.groups || []).length ? best.groups : [{ label: 'Cours complet', price: 0 }];
  return groups.map((g, i) => ({ id: 'g' + (i + 1), label: g.label || '', price: Number(g.price) || 0 }));
}
function defaultInvoice(course) {
  const n = Math.max(1, (course.instructorIds || []).length);
  const share = Math.round(10000 / n) / 10000;
  const groups = pickPriceGroups(course.centerId, course.typeCode).map(g => Object.assign(g, { share }));
  const sessions = (course.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let range = '';
  if (sessions.length) {
    range = sessions.length === 1 || sessions[0].date === sessions[sessions.length - 1].date
      ? ' du ' + humanDate(sessions[0].date)
      : ' du ' + humanDate(sessions[0].date) + ' au ' + humanDate(sessions[sessions.length - 1].date);
  }
  const names = courseInstructors(course).map(b => b.name).filter(Boolean);
  const assign = {};
  (course.students || []).forEach(s => { assign[s.folder] = groups[0].id; });
  return {
    centerId: course.centerId || '',
    number: course.invoiceNumber || suggestInvoiceNumber(),
    date: course.invoiceDate || todayISO(),
    ref: courseTypeLabel(course.typeCode) + range,
    instructorCount: n,
    groups, assign, listNames: true,
    tps: false, tvq: false, showLogo: true, showStamp: true,
    note: names.filter(x => x.trim().toLowerCase() !== (state.settings.instructorName || '').trim().toLowerCase()).length ? `Cours ${courseTypeLabel(course.typeCode)} avec ${names.filter(x => x.trim().toLowerCase() !== (state.settings.instructorName || '').trim().toLowerCase()).join(', ')}` : '',
    extras: [], kmNote: '', submittedDate: '', paidDate: '', groupsEdited: false
  };
}
function computeInvoice(course, inv) {
  const students = course.students || [];
  const lines = (inv.groups || []).map(g => {
    // Dans la liste des cours, les étudiants sont de simples noms de dossier ; dans la fiche, des objets.
    const members = students.filter(s => (inv.assign || {})[typeof s === 'string' ? s : s.folder] === g.id);
    const count = members.length;
    const share = Number(g.share) || 0, price = Number(g.price) || 0;
    return { g, members, count, share, price, total: count * share * price };
  });
  const extras = (inv.extras || []).map(x => ({ label: x.label, amount: Number(x.amount) || 0 }));
  const subtotal = lines.reduce((a, l) => a + l.total, 0) + extras.reduce((a, x) => a + x.amount, 0);
  const t = state.billing.taxes;
  const tps = inv.tps ? Math.round(subtotal * t.tps.rate) / 100 : 0;
  const tvq = inv.tvq ? Math.round(subtotal * t.tvq.rate) / 100 : 0;
  return { lines, extras, subtotal, tps, tvq, total: subtotal + tps + tvq };
}
const INVOICE_CSS = `
.inv-sheet{background:#fff;color:#13293d;font-family:system-ui,'Segoe UI',Arial,sans-serif;font-size:13px;padding:40px 48px;box-sizing:border-box;position:relative;min-height:980px}
.inv-sheet .inv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.inv-sheet .inv-from{line-height:1.5}
.inv-sheet .inv-from b{font-size:16px}
.inv-sheet .inv-right{text-align:right}
.inv-sheet .inv-logo{width:56px;height:56px}
.inv-sheet .inv-title{font-size:30px;font-weight:700;letter-spacing:4px;color:#094a75;margin-top:6px}
.inv-sheet .inv-meta{line-height:1.5}
.inv-sheet .inv-client{margin-top:22px;padding:12px 14px;background:#eef3f6;line-height:1.5}
.inv-sheet .inv-client small{display:block;font-size:11px;letter-spacing:1px;color:#4a6071}
.inv-sheet .inv-ref{margin-top:16px}
.inv-sheet table{width:100%;border-collapse:collapse;margin-top:12px}
.inv-sheet th{background:#094a75;color:#fff;padding:7px 9px;text-align:left;font-weight:600}
.inv-sheet td{padding:9px;border-bottom:1px solid #d5dee5;vertical-align:top}
.inv-sheet .r{text-align:right;white-space:nowrap}
.inv-sheet .c{text-align:center;white-space:nowrap}
.inv-sheet .names{font-size:11.5px;color:#4a6071}
.inv-sheet .inv-note{margin-top:10px;font-size:12px;color:#4a6071}
.inv-sheet .inv-totals{display:flex;justify-content:flex-end;margin-top:18px}
.inv-sheet .inv-totals table{width:290px;margin:0}
.inv-sheet .inv-totals td{border:0;padding:5px 9px}
.inv-sheet .inv-totals tr.grand td{background:#094a75;color:#fff;font-weight:700;font-size:15px;padding:8px 9px}
.inv-sheet .inv-stamp{display:block;margin:26px 0 0 auto;max-width:200px;max-height:110px;transform:rotate(-3deg)}
.inv-sheet .inv-foot{margin-top:34px;text-align:center;font-weight:700;letter-spacing:2px;color:#094a75}
`;
function invoiceInnerHtml(course, inv, calc, base) {
  const s = state.settings || {};
  const center = centerById(inv.centerId);
  const fromBits = [s.instructorPadi, s.instructorAddress, [s.instructorPhone, s.instructorEmail].filter(Boolean).join(' · ')].filter(Boolean);
  const stamp = inv.showStamp && state.stamp ? `<img class="inv-stamp" src="${state.stamp}" alt="Étampe">` : '';
  const rows = calc.lines.filter(l => l.count > 0 || calc.lines.length === 1).map(l => `
    <tr><td><b>${escapeHtml(l.g.label)}</b>${inv.listNames && l.members.length ? `<div class="names">${l.members.map(m => escapeHtml(m.firstName + ' ' + m.lastName)).join(', ')}</div>` : ''}</td>
    <td class="c">${l.count} × ${fmtNum(l.share)}</td><td class="r">${fmtMoney(l.price)}</td><td class="r">${fmtMoney(l.total)}</td></tr>`).join('');
  const extraRows = calc.extras.filter(x => x.label || x.amount).map(x => `<tr><td>${escapeHtml(x.label)}</td><td class="c">1</td><td class="r">${fmtMoney(x.amount)}</td><td class="r">${fmtMoney(x.amount)}</td></tr>`).join('');
  const taxRow = (on, t, amt) => on ? `<tr><td>${escapeHtml(t.label)} (${fmtNum(t.rate)} %)</td><td class="r">${fmtMoney(amt)}</td></tr>` : '';
  const anyTax = !!(inv.tps || inv.tvq);
  return `<div class="inv-sheet">
    <div class="inv-head">
      <div class="inv-from"><b>${escapeHtml(s.instructorName || '')}</b>${fromBits.map(b => '<div>' + escapeHtml(b) + '</div>').join('')}</div>
      <div class="inv-right">${inv.showLogo ? `<img class="inv-logo" src="${base}logo.svg" alt="">` : ''}</div>
    </div>
    <div class="inv-head" style="margin-top:14px;align-items:flex-end">
      <div class="inv-title">FACTURE</div>
      <div class="inv-meta inv-right">Date : ${escapeHtml(humanDate(inv.date))}<br>N° : ${escapeHtml(inv.number)}</div>
    </div>
    <div class="inv-client"><small>CLIENT</small>${center ? `<b>${escapeHtml(center.name)}</b>
      ${center.contactName ? `<div>Att. : ${escapeHtml(center.contactName)}</div>` : ''}
      ${center.address ? `<div>${escapeHtml(center.address)}</div>` : ''}
      ${center.phone ? `<div>${escapeHtml(center.phone)}</div>` : ''}
      ${center.taxId ? `<div>${escapeHtml(center.taxId)}</div>` : ''}` : '<i>(centre non défini)</i>'}</div>
    ${inv.ref ? `<div class="inv-ref"><b>Réf. Cours :</b> ${escapeHtml(inv.ref)}</div>` : ''}
    <table><thead><tr><th>Descriptions / Noms étudiants</th><th class="c">Nombre étudiants</th><th class="r">Prix unitaire</th><th class="r">Total</th></tr></thead>
    <tbody>${rows}${extraRows}</tbody></table>
    ${inv.note ? `<div class="inv-note">${escapeHtml(inv.note)}</div>` : ''}
    ${inv.kmNote ? `<div class="inv-note">${escapeHtml(inv.kmNote)}</div>` : ''}
    <div class="inv-totals"><table>
      ${anyTax ? `<tr><td>SOUS-TOTAL</td><td class="r">${fmtMoney(calc.subtotal)}</td></tr>` : ''}
      ${taxRow(inv.tps, state.billing.taxes.tps, calc.tps)}${taxRow(inv.tvq, state.billing.taxes.tvq, calc.tvq)}
      <tr class="grand"><td>TOTAL</td><td class="r">${fmtMoney(calc.total)}</td></tr></table></div>
    ${stamp}
    <div class="inv-foot">${escapeHtml(state.billing.footer || '')}</div>
  </div>`;
}

async function openInvoiceForm(course, type) {
  if (state.stamp === undefined) {
    try { state.stamp = (await api('GET', '/api/stamp')).dataUrl || ''; } catch (e) { state.stamp = ''; }
  }
  const inv = Object.assign(defaultInvoice(course), course.invoice || {});
  inv.groups = (inv.groups || []).map(g => Object.assign({}, g));
  inv.assign = Object.assign({}, inv.assign);
  inv.extras = (inv.extras || []).map(x => Object.assign({}, x));
  (course.students || []).forEach(s => { if (!inv.groups.some(g => g.id === inv.assign[s.folder])) inv.assign[s.folder] = inv.groups[0] ? inv.groups[0].id : ''; });
  const app = document.getElementById('app');
  const T = state.billing.taxes;
  const inp = 'style="width:100%"';

  async function save(btn) {
    const payload = { invoice: inv, invoiceNumber: inv.number, invoiceDate: inv.date };
    await api('PUT', `/api/courses/${encodeURIComponent(course.id)}`, payload);
    Object.assign(course, payload);
    if (inv.number === suggestInvoiceNumber()) {
      const y = new Date().getFullYear(), c = state.billing.counter || {};
      state.billing.counter = { year: y, last: (c.year === y ? c.last || 0 : 0) + 1 };
      await api('PUT', '/api/billing', state.billing);
    }
  }

  function build() {
    app.innerHTML = '';
    const centerOpts = state.centers.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === inv.centerId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const groupOpts = inv.groups.map(g => `<option value="${g.id}">${escapeHtml(g.label)}</option>`).join('');
    const page = el(`<div>
      <style>${INVOICE_CSS}.inv-edit input{width:100%;box-sizing:border-box}.inv-edit td:first-child{min-width:120px}.inv-edit td:nth-child(5){white-space:nowrap}.inv-edit th{font-size:11px}.inv-edit td{padding:3px}.inv-grid{display:grid;grid-template-columns:minmax(460px,600px) minmax(0,1fr);gap:20px;align-items:start}.inv-preview{border:1px solid var(--border,#b8c6d0);box-shadow:0 2px 8px rgba(19,41,61,.12);overflow:auto}@media(max-width:1100px){.inv-grid{grid-template-columns:1fr}}</style>
      <button class="btn secondary small" id="inv-back">← Retour au cours</button>
      <h1>Facture — ${escapeHtml(courseTypeLabel(course.typeCode))} <span class="muted">${escapeHtml(course.id)}</span></h1>
      <div class="actions-inline" style="margin:0 0 14px">
        <button class="btn secondary" id="inv-save">Enregistrer le brouillon</button>
        <button class="btn secondary" id="inv-mail">Courriel au centre</button>
        <button class="btn" id="inv-print">🖨️ Imprimer / PDF</button>
      </div>
      <div class="inv-grid"><div>
        <div class="card"><h3>1 · En-tête</h3>
          <div class="row">
            <div><label for="inv-center">Centre à facturer</label><select id="inv-center"><option value="">(aucun)</option>${centerOpts}</select></div>
            <div><label for="inv-number">N° de facture</label><input id="inv-number" value="${escapeHtml(inv.number)}"></div>
            <div><label for="inv-date">Date</label><input type="date" id="inv-date" value="${escapeHtml(inv.date)}"></div>
          </div>
          <label for="inv-ref">Réf. cours (modifiable)</label><input id="inv-ref" value="${escapeHtml(inv.ref)}">
        </div>
        <div class="card"><h3>2 · Groupes de tarification</h3>
          <p class="muted">Un groupe = un tarif par étudiant. Ces groupes sont <strong>copiés</strong> de votre grille de tarifs (Paramètres → Facturation) à l'ouverture de la facture : vous pouvez les modifier ici sans toucher à la grille, et inversement. « ↻ Tarifs du centre » recopie la grille.</p>
          <div class="row"><div><label for="inv-icount">Nb d'instructeurs sur le cours (part = 1 ÷ n)</label><input type="number" min="1" step="1" id="inv-icount" value="${inv.instructorCount}"></div>
          <div style="align-self:flex-end"><button class="btn secondary small" id="inv-reload">↻ Tarifs du centre</button> <button class="btn secondary small" id="inv-addgroup">+ Groupe</button></div></div>
          <table class="inv-edit" style="width:100%"><thead><tr><th>Description</th><th>Nb</th><th>Part</th><th>Prix unit.</th><th>Total</th><th></th></tr></thead><tbody id="inv-groups"></tbody></table>
        </div>
        <div class="card"><h3>3 · Étudiants (issus du cours)</h3>
          ${(course.students || []).length ? '' : '<p class="muted">Aucun étudiant dans ce cours.</p>'}
          <div id="inv-students">${(course.students || []).map(s => `<div class="row" style="align-items:center;margin-bottom:4px"><div>${escapeHtml(s.firstName + ' ' + s.lastName)}</div><div><select class="inv-assign" aria-label="Groupe de ${escapeHtml(s.firstName + ' ' + s.lastName)}" data-folder="${escapeHtml(s.folder)}">${groupOpts}</select></div></div>`).join('')}</div>
          <label class="checklist-item"><input type="checkbox" id="inv-names" ${inv.listNames ? 'checked' : ''}> Lister les noms sous chaque groupe</label>
        </div>
        <div class="card"><h3>4 · Options</h3>
          <label class="checklist-item"><input type="checkbox" id="inv-tps" ${inv.tps ? 'checked' : ''}> Appliquer ${escapeHtml(T.tps.label)} (${fmtNum(T.tps.rate)} %)</label>
          <label class="checklist-item"><input type="checkbox" id="inv-tvq" ${inv.tvq ? 'checked' : ''}> Appliquer ${escapeHtml(T.tvq.label)} (${fmtNum(T.tvq.rate)} %)</label>
          <label class="checklist-item"><input type="checkbox" id="inv-logo" ${inv.showLogo ? 'checked' : ''}> Afficher le logo ScubaPilot</label>
          <label class="checklist-item"><input type="checkbox" id="inv-stamp" ${inv.showStamp ? 'checked' : ''}> Apposer l'étampe ${state.stamp ? '' : '(aucune image : à ajouter dans Paramètres → Facturation)'}</label>
          <label for="inv-note">Note libre</label><input id="inv-note" value="${escapeHtml(inv.note)}">
          <label for="inv-kmnote">Note kilométrage</label><input id="inv-kmnote" placeholder="ex. : Déplacement : 120 km aller-retour × 0,70 $/km" value="${escapeHtml(inv.kmNote || '')}">
          <h3 style="margin-top:12px">Lignes supplémentaires (frais, rabais…)</h3>
          <div id="inv-extras"></div>
          <button class="btn secondary small" id="inv-addextra">+ Ligne supplémentaire</button>
        </div>
        <div class="card"><h3>5 · Suivi de la facture</h3>
          <p class="muted" id="inv-status-summary"></p>
          <div class="row">
            <div>
              <label class="checklist-item"><input type="checkbox" id="inv-submitted" ${inv.submittedDate ? 'checked' : ''}> Soumise au centre</label>
              <label for="inv-submitted-date">Date de soumission</label>
              <input type="date" id="inv-submitted-date" value="${escapeHtml(inv.submittedDate || '')}" ${inv.submittedDate ? '' : 'disabled'}>
            </div>
            <div>
              <label class="checklist-item"><input type="checkbox" id="inv-paid" ${inv.paidDate ? 'checked' : ''}> Payée</label>
              <label for="inv-paid-date">Date de paiement</label>
              <input type="date" id="inv-paid-date" value="${escapeHtml(inv.paidDate || '')}" ${inv.paidDate ? '' : 'disabled'}>
            </div>
          </div>
          <p class="muted" id="inv-status-warn" style="color:var(--red)"></p>
          <p class="muted">Ces changements s'enregistrent automatiquement.</p>
        </div>
      </div>
      <div><div style="font-size:12px;color:var(--text-light,#4a6071);margin-bottom:6px">Aperçu en direct</div><div class="inv-preview" id="inv-preview"></div></div></div>
    </div>`);
    app.appendChild(page);

    const gbody = page.querySelector('#inv-groups');
    inv.groups.forEach((g, i) => {
      const tr = el(`<table><tbody><tr data-i="${i}">
        <td><input class="g-label" aria-label="Description groupe ${i + 1}" value="${escapeHtml(g.label)}"></td>
        <td class="g-count">0</td>
        <td style="width:62px"><input class="g-share" aria-label="Part groupe ${i + 1}" value="${fmtNum(g.share)}"></td>
        <td style="width:74px"><input class="g-price" aria-label="Prix groupe ${i + 1}" value="${String(g.price).replace('.', ',')}"></td>
        <td class="g-total" style="text-align:right"></td>
        <td><button class="btn danger small g-del" aria-label="Supprimer le groupe ${i + 1}" ${inv.groups.length < 2 ? 'disabled' : ''}>✕</button></td></tr></tbody></table>`).querySelector('tr');
      gbody.appendChild(tr);
    });
    const num = v => parseFloat(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
    gbody.querySelectorAll('tr').forEach(tr => {
      const g = inv.groups[+tr.dataset.i];
      tr.querySelector('.g-label').addEventListener('input', e => { g.label = e.target.value; inv.groupsEdited = true; page.querySelectorAll('.inv-assign option[value="' + g.id + '"]').forEach(o => o.textContent = g.label); refresh(); });
      tr.querySelector('.g-share').addEventListener('input', e => { g.share = num(e.target.value); inv.groupsEdited = true; refresh(); });
      tr.querySelector('.g-price').addEventListener('input', e => { g.price = num(e.target.value); inv.groupsEdited = true; refresh(); });
      tr.querySelector('.g-del').addEventListener('click', () => {
        inv.groups = inv.groups.filter(x => x !== g); inv.groupsEdited = true;
        Object.keys(inv.assign).forEach(k => { if (inv.assign[k] === g.id) inv.assign[k] = inv.groups[0].id; });
        build();
      });
    });
    page.querySelectorAll('.inv-assign').forEach(sel => {
      sel.value = inv.assign[sel.dataset.folder] || (inv.groups[0] && inv.groups[0].id);
      sel.addEventListener('change', () => { inv.assign[sel.dataset.folder] = sel.value; refresh(); });
    });
    const ex = page.querySelector('#inv-extras');
    inv.extras.forEach((x, i) => {
      const row = el(`<div class="row" style="align-items:flex-end"><div><label for="ex-l-${i}">Description</label><input id="ex-l-${i}" value="${escapeHtml(x.label || '')}"></div><div><label for="ex-a-${i}">Montant (négatif = rabais)</label><input id="ex-a-${i}" value="${String(x.amount || '').replace('.', ',')}"></div><div><button class="btn danger small" aria-label="Supprimer la ligne ${i + 1}">✕</button></div></div>`);
      row.querySelector(`#ex-l-${i}`).addEventListener('input', e => { x.label = e.target.value; refresh(); });
      row.querySelector(`#ex-a-${i}`).addEventListener('input', e => { x.amount = num(e.target.value); refresh(); });
      row.querySelector('button').addEventListener('click', () => { inv.extras.splice(i, 1); build(); });
      ex.appendChild(row);
    });
    const bind = (id, key, isCheck) => page.querySelector(id).addEventListener(isCheck ? 'change' : 'input', e => { inv[key] = isCheck ? e.target.checked : e.target.value; refresh(); });
    bind('#inv-number', 'number'); bind('#inv-date', 'date'); bind('#inv-ref', 'ref'); bind('#inv-note', 'note'); bind('#inv-kmnote', 'kmNote');
    bind('#inv-names', 'listNames', true); bind('#inv-tps', 'tps', true); bind('#inv-tvq', 'tvq', true); bind('#inv-logo', 'showLogo', true); bind('#inv-stamp', 'showStamp', true);
    page.querySelector('#inv-center').addEventListener('change', e => {
      inv.centerId = e.target.value;
      if (!inv.groupsEdited) { reloadPrices(); build(); } else refresh();
    });
    function reloadPrices() {
      const old = inv.groups; const share = Math.round(10000 / Math.max(1, inv.instructorCount)) / 10000;
      inv.groups = pickPriceGroups(inv.centerId, course.typeCode).map(g => Object.assign(g, { share }));
      Object.keys(inv.assign).forEach(k => { if (!inv.groups.some(g => g.id === inv.assign[k])) inv.assign[k] = inv.groups[0].id; });
      inv.groupsEdited = false;
    }
    page.querySelector('#inv-reload').addEventListener('click', () => { reloadPrices(); build(); });
    page.querySelector('#inv-icount').addEventListener('change', e => {
      inv.instructorCount = Math.max(1, parseInt(e.target.value, 10) || 1);
      const share = Math.round(10000 / inv.instructorCount) / 10000;
      inv.groups.forEach(g => { g.share = share; }); build();
    });
    page.querySelector('#inv-addgroup').addEventListener('click', () => {
      let n = inv.groups.length + 1; while (inv.groups.some(g => g.id === 'g' + n)) n++;
      inv.groups.push({ id: 'g' + n, label: 'Nouveau groupe', price: 0, share: inv.groups[0] ? inv.groups[0].share : 1 }); inv.groupsEdited = true; build();
    });
    page.querySelector('#inv-addextra').addEventListener('click', () => { inv.extras.push({ label: '', amount: 0 }); build(); });
    // --- Suivi de la facture (soumise / payée) : enregistré tout de suite ---
    const subChk = page.querySelector('#inv-submitted'), subDate = page.querySelector('#inv-submitted-date');
    const paidChk = page.querySelector('#inv-paid'), paidDate = page.querySelector('#inv-paid-date');
    function refreshStatusUi() {
      const st = invoiceStatus({ invoice: inv });
      page.querySelector('#inv-status-summary').textContent = 'Statut : ' + (st.key === 'draft' ? 'Brouillon — non soumise' : st.label);
      subDate.disabled = !subChk.checked; paidDate.disabled = !paidChk.checked;
      page.querySelector('#inv-status-warn').textContent =
        (inv.submittedDate && inv.paidDate && inv.paidDate < inv.submittedDate) ? '⚠ La date de paiement précède la date de soumission.' : '';
    }
    async function saveStatus() {
      refreshStatusUi();
      try { await save(); toast('Suivi de la facture enregistré'); } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    }
    subChk.addEventListener('change', () => { inv.submittedDate = subChk.checked ? (subDate.value || todayISO()) : ''; subDate.value = inv.submittedDate; saveStatus(); });
    paidChk.addEventListener('change', () => { inv.paidDate = paidChk.checked ? (paidDate.value || todayISO()) : ''; paidDate.value = inv.paidDate; saveStatus(); });
    subDate.addEventListener('change', () => { inv.submittedDate = subDate.value; if (!subDate.value) subChk.checked = false; saveStatus(); });
    paidDate.addEventListener('change', () => { inv.paidDate = paidDate.value; if (!paidDate.value) paidChk.checked = false; saveStatus(); });
    refreshStatusUi();
    page.querySelector('#inv-back').addEventListener('click', () => renderCourseDetail(course.id));

    page.querySelector('#inv-save').addEventListener('click', ev => withBusy(ev.currentTarget, async () => {
      try { await save(); toast('Facture enregistrée'); } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    }, 'Enregistrement...'));
    page.querySelector('#inv-print').addEventListener('click', ev => withBusy(ev.currentTarget, async () => {
      try { await save(); printInvoice(course, inv); } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    }, 'Ouverture...'));
    page.querySelector('#inv-mail').addEventListener('click', ev => withBusy(ev.currentTarget, async () => {
      try {
        await save();
        const c = centerById(inv.centerId), calc = computeInvoice(course, inv);
        const subject = `Facture ${inv.number} — ${inv.ref}`;
        const body = `Bonjour${c && c.contactName ? ' ' + c.contactName : ''},\n\nVeuillez trouver ci-joint la facture ${inv.number} (${inv.ref}), au montant de ${fmtMoney(calc.total)}.\n\nMerci,\n${state.settings.instructorName || ''}`;
        showMailModal({ title: 'Courriel au centre', to: (c && c.email) || '', subject, body,
          note: 'Pensez à joindre la facture en PDF (bouton « Imprimer / PDF », puis « Enregistrer en PDF »).',
          action: inv.submittedDate ? null : { label: '✔ Marquer la facture comme soumise', run: async () => {
            inv.submittedDate = todayISO();
            const chk = page.querySelector('#inv-submitted'), dt = page.querySelector('#inv-submitted-date');
            if (chk) chk.checked = true;
            if (dt) { dt.value = inv.submittedDate; dt.disabled = false; }
            await save();
            const sumEl = page.querySelector('#inv-status-summary');
            if (sumEl) sumEl.textContent = 'Statut : ' + invoiceStatus({ invoice: inv }).label;
            toast('Facture marquée comme soumise');
          } } });
      } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    }, 'Préparation...'));

    function refresh() {
      const calc = computeInvoice(course, inv);
      gbody.querySelectorAll('tr').forEach((tr, i) => {
        tr.querySelector('.g-count').textContent = calc.lines[i].count;
        tr.querySelector('.g-total').textContent = fmtMoney(calc.lines[i].total);
      });
      const pv = page.querySelector('#inv-preview');
      pv.innerHTML = invoiceInnerHtml(course, inv, calc, '');
      // Aperçu à l'échelle : la feuille garde sa largeur Letter (816 px) et est réduite pour tenir dans la colonne.
      const sheet = pv.firstElementChild, w = pv.clientWidth || 816, k = Math.min(1, w / 816);
      sheet.style.width = '816px'; sheet.style.transformOrigin = 'top left'; sheet.style.transform = `scale(${k})`;
      pv.style.height = Math.ceil(sheet.offsetHeight * k) + 'px'; pv.style.overflow = 'hidden';
    }
    refresh();
  }
  build();
}

function printInvoice(course, inv) {
  const calc = computeInvoice(course, inv);
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture ${escapeHtml(inv.number)}</title>
<style>${INVOICE_CSS}
body{margin:0;background:#e9eef2}.print-bar{padding:12px;text-align:center}.print-bar button{padding:9px 18px;font-size:14px;cursor:pointer;border-radius:6px;border:none;background:#0e6ba8;color:#fff}
.inv-sheet{max-width:816px;margin:0 auto}
@page{size:letter;margin:0}
@media print{body{background:#fff}.print-bar{display:none}.inv-sheet{min-height:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="print-bar"><button onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button></div>
${invoiceInnerHtml(course, inv, calc, location.origin + '/')}</body></html>`;
  const win = window.open('', '_blank');
  if (!win) { toast('Le navigateur a bloqué l\'ouverture de la facture. Autorisez les popups pour ce site puis réessayez.', true); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// Onglet actif de la fiche de cours, conservé au niveau du module pour survivre aux rafraîchissements
// de renderCourseDetail (ex. après l'ajout d'un étudiant) tant qu'on reste sur le même cours.
let lastCourseTab = 'seances';
async function renderCourseDetail(id) {
  const course = await api('GET', '/api/courses/' + encodeURIComponent(id));
  const type = state.courseTypes.find(t => t.code === course.typeCode) || { preDocs: [], postDocs: [], generalPreDocs: [], generalPostDocs: [] };
  const app = document.getElementById('app');

  const sessions = (course.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const dateRangeText = sessions.length
    ? (sessions.length === 1 ? humanDate(sessions[0].date) : humanDate(sessions[0].date) + ' → ' + humanDate(sessions[sessions.length - 1].date))
    : '(aucune séance)';
  const siteNames = [...new Set(sessions.map(s => siteLabel(s.siteId)).filter(Boolean))].join(', ') || '(aucun site)';
  const stats = computeOverallStats(course, type);

  app.innerHTML = `
    <h1>${escapeHtml(courseTypeLabel(course.typeCode))} <span class="muted">— ${escapeHtml(course.id)}</span> ${course.completed ? '<span class="badge ok" id="course-completed-title-badge">✅ Clos</span>' : ''}</h1>
    <div class="card">
      <div class="row">
        <div><h3>Dates</h3>${dateRangeText}</div>
        <div><h3>Site(s)</h3>${escapeHtml(siteNames)}</div>
        <div><h3>Centre mandataire</h3>${escapeHtml(centerLabel(course.centerId))}</div>
        <div><h3>Instructeur(s)</h3>${courseInstructors(course).length ? escapeHtml(courseInstructors(course).map(b => buddyLabel(b)).join(', ')) : '<span class="muted">(aucun assigné)</span>'}</div>
        <div><h3>Dossier</h3><button class="btn small secondary" id="open-course-folder">📂 Ouvrir dans l'Explorateur</button></div>
      </div>
      <div class="row" style="margin-top:14px">
        <div><h3>Avant le cours (étudiants + général)</h3><span class="badge ${badgeClass(stats.prePct)}" id="course-pre-badge">${stats.prePct}% des documents pré-cours collectés</span></div>
        <div><h3>Après le cours (étudiants + général)</h3><span class="badge ${badgeClass(stats.postPct)}" id="course-post-badge">${stats.postPct}% des documents post-cours collectés</span></div>
      </div>
      ${course.notes ? `<div style="margin-top:12px"><h3>Notes</h3><p>${escapeHtml(course.notes)}</p></div>` : ''}
      <div class="actions-inline" style="justify-content:space-between">
        <div class="actions-inline" style="margin-top:0">
          <button class="btn secondary small" id="edit-course-btn">Modifier les notes / le centre / les instructeurs</button>
          <button class="btn secondary small" id="export-report-btn">🖨️ Exporter un rapport (imprimable)</button>
          <button class="btn secondary small" id="export-invoice-btn" ${course.billable === false ? 'hidden' : ''}>🧾 Facture</button>
          <span id="course-invoice-status" style="align-self:center">${invoiceBadgeHtml(course, true)}</span>
        </div>
        <label class="checklist-item course-completed-toggle-label" style="margin:0">
          <input type="checkbox" id="course-completed-toggle" ${course.completed ? 'checked' : ''}>
          <span id="course-completed-toggle-text">${course.completed ? '✅ Cours complété' : '☐ Marquer le cours comme complété'}</span>
        </label>
        <label class="checklist-item" style="margin:0" title="Décochez si vous ne facturez pas ce cours : il sort alors du suivi des factures et des rappels.">
          <input type="checkbox" id="course-billable-toggle" ${course.billable === false ? '' : 'checked'}>
          <span>Ce cours est facturé</span>
        </label>
      </div>
    </div>
    <div class="tabs-nav">
      <button type="button" class="tab-btn" data-tab="seances">Séances &amp; Photos</button>
      <button type="button" class="tab-btn" data-tab="documents">Documents &amp; communications</button>
      <button type="button" class="tab-btn" data-tab="etudiants">Étudiants (${course.students.length})</button>
    </div>

    <div class="tab-panel" data-panel="seances">
      <div id="sessions-card"></div>
      <div id="photos-card"></div>
    </div>

    <div class="tab-panel" data-panel="documents">
      <div id="general-docs-card"></div>
      <div id="comm-card"></div>
    </div>

    <div class="tab-panel" data-panel="etudiants">
      <div id="students-list"></div>
      <button class="btn" id="add-student-btn">+ Ajouter un étudiant</button>
      <button class="btn secondary" id="bulk-import-btn">Importer plusieurs étudiants (Excel, CSV)</button>
    </div>

    <div class="danger-zone">
      <span class="muted">Ce cours n'a plus lieu d'être ? Il sera déplacé dans la corbeille (restaurable depuis Paramètres).</span>
      <button class="btn danger small" id="delete-course-btn">Supprimer ce cours…</button>
    </div>
  `;

  // Reste sur le même onglet après un rafraîchissement de la page (ex. après l'ajout d'un étudiant),
  // plutôt que de systématiquement revenir sur "Séances & Photos" et perdre le contexte de l'utilisateur.
  const tabToShow = app.querySelector(`.tab-btn[data-tab="${lastCourseTab}"]`) ? lastCourseTab : 'seances';
  app.querySelector(`.tab-btn[data-tab="${tabToShow}"]`).classList.add('active');
  app.querySelector(`.tab-panel[data-panel="${tabToShow}"]`).classList.add('active');

  app.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      app.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      app.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
      lastCourseTab = btn.dataset.tab;
    });
  });

  document.getElementById('open-course-folder').addEventListener('click', () => openExplorer(course.id));
  document.getElementById('export-report-btn').addEventListener('click', () => exportReport(course, type));
  document.getElementById('course-completed-toggle').addEventListener('change', async (ev) => {
    const completed = ev.target.checked;
    try {
      await api('PUT', '/api/courses/' + encodeURIComponent(course.id), { completed });
      course.completed = completed;
      document.getElementById('course-completed-toggle-text').textContent = completed ? '✅ Cours complété' : '☐ Marquer le cours comme complété';
      const titleH1 = document.querySelector('#app > h1');
      let titleBadge = document.getElementById('course-completed-title-badge');
      if (completed && !titleBadge) {
        titleBadge = el('<span class="badge ok" id="course-completed-title-badge">✅ Clos</span>');
        titleH1.appendChild(document.createTextNode(' '));
        titleH1.appendChild(titleBadge);
      } else if (!completed && titleBadge) {
        titleBadge.remove();
      }
      toast(completed ? 'Cours marqué comme complété' : 'Cours rouvert (non complété)');
    } catch (e) {
      ev.target.checked = !completed;
      toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
    }
  });
  document.getElementById('export-invoice-btn').addEventListener('click', () => openInvoiceForm(course, type));
  document.getElementById('course-billable-toggle').addEventListener('change', async (ev) => {
    const billable = ev.target.checked;
    try {
      await api('PUT', '/api/courses/' + encodeURIComponent(course.id), { billable });
      course.billable = billable;
      document.getElementById('export-invoice-btn').hidden = !billable;
      document.getElementById('course-invoice-status').innerHTML = invoiceBadgeHtml(course, true);
      toast(billable ? 'Ce cours est facturé' : (course.invoice ? 'Cours marqué non facturé (la facture déjà préparée est conservée, mais sort du suivi)' : 'Cours marqué non facturé'));
    } catch (e) { ev.target.checked = !billable; toast('Erreur : ' + friendlyError(e), true); }
  });
  document.getElementById('delete-course-btn').addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Supprimer ce cours ?',
      message: `Le cours <strong>${escapeHtml(course.id)}</strong> et tous ses dossiers d'étudiants (documents inclus) seront déplacés dans la <strong>corbeille</strong> de ScubaPilot. Vous pourrez le restaurer depuis Paramètres → Corbeille.`,
      requireTypeText: course.id
    });
    if (!ok) return;
    try { await api('DELETE', '/api/courses/' + encodeURIComponent(course.id)); }
    catch (e) { toast('Suppression impossible : ' + friendlyError(e), true); return; }
    toast('Cours déplacé dans la corbeille (Paramètres → Corbeille pour le restaurer)');
    location.hash = '#/dashboard';
  });
  document.getElementById('edit-course-btn').addEventListener('click', () => renderEditCourseForm(course));

  document.getElementById('sessions-card').appendChild(buildSessionsCard(course));
  document.getElementById('photos-card').appendChild(buildPhotosCard(course));
  document.getElementById('general-docs-card').appendChild(buildGeneralDocsCard(course, type));
  document.getElementById('comm-card').appendChild(buildCommunicationsCard(course, type));

  const list = document.getElementById('students-list');
  course.students.forEach(s => list.appendChild(renderStudentBlock(course, type, s)));

  document.getElementById('add-student-btn').addEventListener('click', () => renderAddStudentForm(course, type));
  document.getElementById('bulk-import-btn').addEventListener('click', () => renderBulkImportForm(course, type));
}

// ---------- Fiche étudiant globale (tous les cours d'un même étudiant) ----------
// Chaque fiche de cours porte un identifiant de personne (studentId). Cette vue regroupe toutes les
// fiches d'une même personne, affiche l'historique de ses cours, et permet de la renommer, de mettre
// à jour ses coordonnées partout, de fusionner un homonyme qui est en fait la même personne, ou de
// détacher un cours rattaché par erreur.
async function renderStudentProfile(key) {
  const app = document.getElementById('app');
  app.innerHTML = '<p class="muted">Chargement...</p>';

  let records;
  if (STUDENT_ID_RE.test(key)) {
    records = await api('GET', '/api/global-students?sid=' + encodeURIComponent(key));
  } else {
    // Ancien lien par nom : une seule personne porte ce nom -> on y va ; plusieurs -> on demande laquelle.
    const candidates = (await api('GET', '/api/global-students?q=' + encodeURIComponent(key))).filter(r => studentKey(r) === key);
    const persons = groupPersons(candidates);
    if (persons.length === 1 && STUDENT_ID_RE.test(persons[0].studentId)) { location.replace('#/student/' + encodeURIComponent(persons[0].studentId)); return; }
    if (persons.length > 1) {
      app.innerHTML = `
        <h1>Plusieurs personnes portent ce nom</h1>
        <div class="card"><p class="muted">Choisissez la fiche à ouvrir :</p>
          <ul>${persons.map(pn => `<li><a href="#/student/${encodeURIComponent(pn.studentId)}">${escapeHtml(pn.latest.firstName)} ${escapeHtml(pn.latest.lastName)}</a> <span class="muted">— ${escapeHtml(personHint(pn))}</span></li>`).join('')}</ul>
        </div>`;
      return;
    }
    records = candidates;
  }
  const sid = records.length ? records[0].studentId : '';
  if (!records.length) {
    app.innerHTML = `
      <div class="card">
        <p class="muted">Aucun étudiant ne correspond à cette fiche.</p>
        <button class="btn secondary" onclick="location.hash='#/dashboard'">← Retour au tableau de bord</button>
      </div>`;
    return;
  }

  // Les enregistrements renvoyés par /api/global-students n'incluent pas les documents (pré/post),
  // nécessaires pour calculer les pourcentages par cours : on va chercher le détail de chaque cours
  // concerné (en dédoublonnant les appels), en parallèle.
  const uniqueCourseIds = [...new Set(records.map(r => r.courseId))];
  const courseDetails = await Promise.all(uniqueCourseIds.map(id => api('GET', '/api/courses/' + encodeURIComponent(id)).catch(() => null)));
  const courseByIdFull = {};
  courseDetails.forEach(c => { if (c) courseByIdFull[c.id] = c; });

  const rows = records.map(r => {
    const course = courseByIdFull[r.courseId];
    const fullStudent = course ? (course.students || []).find(s => s.folder === r.folder) : null;
    const type = course ? (state.courseTypes.find(t => t.code === course.typeCode) || { preDocs: [], postDocs: [] }) : { preDocs: [], postDocs: [] };
    const sessions = course ? (course.sessions || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')) : [];
    const firstDate = sessions.length ? sessions[0].date : '';
    const p = fullStudent ? countDocGroup(fullStudent.preDocs, type.preDocs) : { total: 0, done: 0 };
    const q = fullStudent ? countDocGroup(fullStudent.postDocs, type.postDocs) : { total: 0, done: 0 };
    return {
      record: fullStudent || r, course, firstDate,
      prePct: p.total ? Math.round(100 * p.done / p.total) : 100,
      postPct: q.total ? Math.round(100 * q.done / q.total) : 100
    };
  }).sort((a, b) => (b.firstDate || '').localeCompare(a.firstDate || ''));

  const latest = rows[0].record;

  app.innerHTML = `
    <div class="actions-inline" style="justify-content:space-between;margin:0 0 16px">
      <h1 style="margin:0">${escapeHtml(latest.firstName)} ${escapeHtml(latest.lastName)}</h1>
      <button class="btn secondary small" onclick="location.hash='#/dashboard'">← Retour au tableau de bord</button>
    </div>
    <div id="profile-homonyms"></div>
    <div class="card">
      <h2>Nom</h2>
      <p class="muted">Corrigez ici le prénom ou le nom : le dossier de l'étudiant est renommé dans ${records.length > 1 ? `ses ${records.length} cours` : 'son cours'}, avec ses documents.</p>
      <div class="row" style="align-items:flex-end">
        <div><label for="profile-first">Prénom</label><input id="profile-first" value="${escapeHtml(latest.firstName || '')}"></div>
        <div><label for="profile-last">Nom</label><input id="profile-last" value="${escapeHtml(latest.lastName || '')}"></div>
        <div style="flex:0 0 auto;min-width:0"><button class="btn small secondary" id="profile-rename">Renommer</button></div>
      </div>
      <p class="form-error" id="profile-rename-error" role="alert"></p>
    </div>
    <div class="card">
      <h2>Coordonnées</h2>
      <p class="muted">Coordonnées les plus récentes${rows[0].firstDate ? ` (cours du ${humanDate(rows[0].firstDate)})` : ''}. Modifiez-les ici puis cliquez sur "Mettre à jour partout" pour les reporter sur ${records.length > 1 ? `les ${records.length} cours` : "ce cours"} de cet étudiant.</p>
      <div id="profile-fields-box" class="row"></div>
      <div class="actions-inline">
        <button class="btn small" id="profile-save">Mettre à jour partout (${records.length} cours)</button>
      </div>
      <p class="muted" id="profile-error"></p>
    </div>
    <div class="card">
      <h2>Historique des cours (${records.length})</h2>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Centre</th><th>Pré-cours</th><th>Post-cours</th><th>Certification</th><th>Instructeur certificateur</th><th>Notes</th>${records.length > 1 ? '<th></th>' : ''}</tr></thead>
        <tbody id="profile-history"></tbody>
      </table>
    </div>
  `;

  const fieldsBox = document.getElementById('profile-fields-box');
  state.studentFields.forEach(f => {
    if (f.id === 'firstName' || f.id === 'lastName') return; // modifiables dans la carte « Nom » (renommage)
    if (f.id === 'status') return;                           // propre à chaque cours : se règle dans la fiche du cours
    fieldsBox.appendChild(el(`<div style="flex:1;min-width:200px"><label for="sf-${escapeHtml(f.id)}">${escapeHtml(f.label)}</label>${renderFieldInput(f, fieldValueOf(latest, f))}</div>`));
  });
  attachDateAutoFormat(fieldsBox);

  const historyBox = document.getElementById('profile-history');
  rows.forEach(({ record, course, firstDate, prePct, postPct }) => {
    const tr = elRow(`
      <tr class="${course ? 'course-row' : ''}">
        <td>${firstDate ? humanDate(firstDate) : '(date inconnue)'}</td>
        <td>${course ? escapeHtml(courseTypeLabel(course.typeCode)) : escapeHtml(record.courseId || '')}</td>
        <td>${course ? escapeHtml(centerLabel(course.centerId)) : '-'}</td>
        <td><span class="badge ${badgeClass(prePct)}">${prePct}%</span></td>
        <td><span class="badge ${badgeClass(postPct)}">${postPct}%</span></td>
        <td>${studentHasCertification(record) ? (record.certificationConfirmed ? '✅ Certifié' : '❌ Non certifié') : (record.fileTransferred ? '📁 Dossier transféré' : '📁 Dossier non transféré')}</td>
        <td>${record.certifyingInstructorId ? escapeHtml(buddyLabelById(record.certifyingInstructorId)) : '<span class="muted">-</span>'}</td>
        <td style="white-space:pre-wrap;max-width:260px">${record.note && record.note.trim() ? escapeHtml(record.note) : '<span class="muted">-</span>'}</td>
        ${records.length > 1 ? '<td style="text-align:right"><button class="btn secondary small" data-act="detach" title="Ce cours a été suivi par quelqu\'un d\'autre (un homonyme) : le sortir de cette fiche">Détacher</button></td>' : ''}
      </tr>
    `);
    if (course) { tr.addEventListener('click', () => location.hash = '#/course/' + encodeURIComponent(course.id)); makeActivatable(tr, 'link', 'Ouvrir le cours ' + course.id); }
    const detachBtn = tr.querySelector('[data-act=detach]');
    if (detachBtn && course) detachBtn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const ok = await showConfirmModal({
        title: 'Détacher ce cours de la fiche ?',
        message: `Le cours <strong>${escapeHtml(courseTypeLabel(course.typeCode))}</strong>${firstDate ? ' du ' + escapeHtml(humanDate(firstDate)) : ''} sera sorti de cette fiche : ScubaPilot considérera qu'il a été suivi par une <strong>autre personne</strong> du même nom. Rien n'est supprimé, et vous pourrez fusionner les deux fiches plus tard.`,
        confirmText: 'Détacher', neutral: true
      });
      if (!ok) return;
      try { await api('POST', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(record.folder)}/detach`); toast('Cours détaché : il a maintenant sa propre fiche'); renderStudentProfile(sid); }
      catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    });
    historyBox.appendChild(tr);
  });

  // --- Renommer la personne dans tous ses cours ---
  document.getElementById('profile-rename').addEventListener('click', async (ev) => {
    const firstName = document.getElementById('profile-first').value.trim(), lastName = document.getElementById('profile-last').value.trim();
    const err = document.getElementById('profile-rename-error');
    if (!firstName || !lastName) { err.textContent = 'Le prénom et le nom sont obligatoires.'; return; }
    if (firstName === (latest.firstName || '') && lastName === (latest.lastName || '') && records.every(r => r.firstName === firstName && r.lastName === lastName)) { err.textContent = "Le nom n'a pas changé."; return; }
    err.textContent = '';
    await withBusy(ev.currentTarget, async () => {
      try {
        const r = await api('POST', `/api/students/${encodeURIComponent(sid)}/rename`, { firstName, lastName });
        toast(r.failed && r.failed.length ? `Renommé dans ${r.renamed.length} cours ; ${r.failed.length} en échec` : `Renommé dans ${r.renamed.length} cours`, !!(r.failed && r.failed.length));
        renderStudentProfile(sid);
      } catch (e) { err.textContent = friendlyError(e); }
    }, 'Renommage en cours...');
  });

  // --- Homonymes : d'autres fiches portent le même nom ; est-ce la même personne ? ---
  api('GET', '/api/global-students?q=' + encodeURIComponent(`${latest.firstName || ''} ${latest.lastName || ''}`.trim())).then(all => {
    const others = groupPersons(all.filter(r => r.studentId !== sid && normPersonName(r) === normPersonName(latest)));
    const box = document.getElementById('profile-homonyms');
    if (!box || !others.length) return;
    box.innerHTML = `
      <div class="setup-note">
        <strong>${others.length === 1 ? 'Une autre fiche porte' : others.length + ' autres fiches portent'} le même nom.</strong>
        ScubaPilot les garde séparées, parce que ni le courriel ni la date de naissance ne concordent. Si c'est la même personne, fusionnez-les.
        <ul style="margin:8px 0 0">${others.map((pn, i) => `<li><a href="#/student/${encodeURIComponent(pn.studentId)}">${escapeHtml(pn.latest.firstName)} ${escapeHtml(pn.latest.lastName)}</a> <span class="muted">— ${escapeHtml(personHint(pn))} (${pn.records.map(r => escapeHtml(r.courseId)).join(', ')})</span>
          <button class="btn secondary small" data-merge="${i}" style="margin-left:8px">C'est la même personne : fusionner</button></li>`).join('')}</ul>
      </div>`;
    box.querySelectorAll('[data-merge]').forEach(btn => btn.addEventListener('click', async () => {
      const pn = others[Number(btn.dataset.merge)];
      const ok = await showConfirmModal({
        title: 'Fusionner ces deux fiches ?',
        message: `Les ${pn.records.length} cours de l'autre fiche (${escapeHtml(personHint(pn))}) rejoindront l'historique de cette fiche. Aucun dossier n'est déplacé ni supprimé. Vous pourrez détacher un cours ensuite si c'était une erreur.`,
        confirmText: 'Fusionner', neutral: true
      });
      if (!ok) return;
      try { await api('POST', '/api/students/merge', { from: pn.studentId, into: sid }); toast('Fiches fusionnées'); renderStudentProfile(sid); }
      catch (e) { toast('Erreur : ' + friendlyError(e), true); }
    }));
  }).catch(() => {});

  document.getElementById('profile-save').addEventListener('click', async (ev) => {
    const payload = readFieldValues(state.studentFields.filter(f => f.id !== 'firstName' && f.id !== 'lastName' && f.id !== 'status'));
    await withBusy(ev.currentTarget, async () => {
      let okCount = 0, failCount = 0;
      for (const r of records) {
        try {
          await api('PUT', `/api/courses/${encodeURIComponent(r.courseId)}/students/${encodeURIComponent(r.folder)}`, payload);
          okCount++;
        } catch (e) { failCount++; }
      }
      if (failCount) {
        document.getElementById('profile-error').textContent = `${okCount} cours mis à jour, ${failCount} en échec.`;
      } else {
        document.getElementById('profile-error').textContent = '';
        toast(`Coordonnées mises à jour sur ${okCount} cours`);
      }
    }, 'Mise à jour en cours...');
  });
}

function renderEditCourseForm(course) {
  const centerOptions = state.centers.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === course.centerId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const selectedInstructorIds = course.instructorIds || [];
  const instructorOptions = state.buddies.map(b => `<option value="${escapeHtml(b.id)}" ${selectedInstructorIds.includes(b.id) ? 'selected' : ''}>${escapeHtml(buddyLabel(b))}</option>`).join('');
  const box = el(`
    <div class="card">
      <h2>Modifier les notes / le centre / les instructeurs</h2>
      <label for="e-center">Centre mandataire *</label>
      <select id="e-center"><option value="">-- choisir --</option>${centerOptions}</select>
      <label for="e-instructors">Instructeurs/coéquipiers de ce cours (optionnel, maintenez Ctrl/Cmd pour en choisir plusieurs)</label>
      <select id="e-instructors" multiple size="4">${instructorOptions}</select>
      ${!state.buddies.length ? '<p class="muted">Aucun coéquipier enregistré — ajoutez-en dans Paramètres.</p>' : ''}
      <label for="e-notes">Notes</label>
      <textarea id="e-notes">${escapeHtml(course.notes || '')}</textarea>
      <div class="actions-inline">
        <button class="btn" id="e-save">Enregistrer</button>
        <button class="btn secondary" id="e-cancel">Annuler</button>
      </div>
      <p class="muted" id="e-error"></p>
      <p class="muted">Pour changer les dates/heures/lieux, utilisez la carte "Séances" ci-dessous.</p>
    </div>
  `);
  document.getElementById('app').insertBefore(box, document.getElementById('app').children[1]);
  document.getElementById('e-cancel').addEventListener('click', () => box.remove());
  document.getElementById('e-save').addEventListener('click', async (ev) => {
    const centerId = document.getElementById('e-center').value;
    if (!centerId) { document.getElementById('e-error').textContent = 'Le centre mandataire est obligatoire.'; return; }
    const instructorIds = Array.from(document.getElementById('e-instructors').selectedOptions).map(o => o.value);
    await withBusy(ev.currentTarget, async () => {
      try {
        await api('PUT', '/api/courses/' + encodeURIComponent(course.id), {
          notes: document.getElementById('e-notes').value,
          centerId,
          instructorIds
        });
        toast('Cours mis à jour');
        route();
      } catch (e) {
        document.getElementById('e-error').textContent = friendlyError(e);
      }
    });
  });
}

function statusLabelFor(s) {
  const statusField = state.studentFields.find(f => f.id === 'status');
  if (statusField && statusField.options) {
    const opt = statusField.options.find(o => o.value === s.status);
    if (opt) return opt.label;
  }
  return s.status || '';
}

// Coordonnées minimales attendues pour un étudiant : au moins un numéro de téléphone
// (maison ou cellulaire), un email, et une date de naissance.
function studentMissingInfo(s) {
  const missing = [];
  const hasPhone = !!(s.phoneHome || s.phoneCell || s.phone);
  if (!hasPhone) missing.push('téléphone');
  if (!s.email) missing.push('email');
  if (!s.birthDate) missing.push('date de naissance');
  return missing;
}

// La certification ne s'applique pas à un étudiant inscrit en "Cours seulement" (statut "cours") :
// pas de case "Certification confirmée" à afficher dans ce cas, ni de badge associé.
// Le statut est reconnu par sa valeur ("cours") OU par son libellé (ex: une option renommée
// "Cours seulement" dans Paramètres a une valeur différente, générée à partir du libellé).
function studentIsCourseOnly(s) {
  if (!s.status) return false;
  if (s.status === 'cours') return true;
  const field = state.studentFields.find(f => f.id === 'status');
  const opt = field && (field.options || []).find(o => o.value === s.status);
  const label = ((opt && opt.label) || String(s.status)).toLowerCase();
  return label.includes('cours') && !label.includes('certif');
}
function studentHasCertification(s) {
  return !studentIsCourseOnly(s);
}

// Ancienne clé (nom en minuscules) : ne sert plus qu'à comprendre d'anciens liens « #/student/prénom nom ».
// Une personne est désormais désignée par son identifiant studentId (voir server.js).
function studentKey(s) {
  return `${s.firstName || ''} ${s.lastName || ''}`.trim().toLowerCase();
}
const STUDENT_ID_RE = /^etu_[0-9a-f]{12}$/;
// Nom comparé sans majuscules ni accents (même règle que le serveur).
function normPersonName(s) {
  return `${(s && s.firstName) || ''} ${(s && s.lastName) || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
// Regroupe des fiches (une par cours) en personnes : [{ studentId, records, latest }].
function groupPersons(records) {
  const map = new Map();
  records.forEach(r => { const k = r.studentId || `sans-id:${r.courseId}/${r.folder}`; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  return [...map.entries()].map(([studentId, recs]) => ({ studentId, records: recs, latest: recs[recs.length - 1] }));
}
// De quoi distinguer deux homonymes dans une liste : courriel, année de naissance, nombre de cours.
function personHint(person) {
  const withEmail = person.records.find(r => r.email), withBirth = person.records.find(r => r.birthDate);
  return [withEmail ? withEmail.email : '', withBirth ? 'né(e) en ' + String(withBirth.birthDate).slice(0, 4) : '', `${person.records.length} cours`].filter(Boolean).join(' · ');
}

function renderStudentBlock(course, type, s) {
  // Deux étudiants du même nom dans ce cours : on affiche de quoi les distinguer.
  const namesake = (course.students || []).some(o => o !== s && normPersonName(o) === normPersonName(s));
  const namesakeHint = namesake ? `<span class="tag-status" title="Un autre étudiant de ce cours porte le même nom">homonyme · ${escapeHtml(s.email || (s.birthDate ? 'né(e) en ' + String(s.birthDate).slice(0, 4) : 'dossier « ' + s.folder + ' »'))}</span>` : '';
  const p = countDocGroup(s.preDocs, type.preDocs);
  const q = countDocGroup(s.postDocs, type.postDocs);
  const prePct = p.total ? Math.round(100 * p.done / p.total) : 100;
  const postPct = q.total ? Math.round(100 * q.done / q.total) : 100;
  const statusLabel = statusLabelFor(s);
  const missingInfo = studentMissingInfo(s);

  const block = el(`
    <div class="student-block">
      <div class="student-header">
        <div>
          <strong>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</strong>
          <a href="#/student/${encodeURIComponent(s.studentId || studentKey(s))}" class="muted" style="font-size:12px;text-decoration:underline" data-act="profile-link" title="Voir tous les cours de cet étudiant">fiche globale</a>
          <span class="tag-status">${escapeHtml(statusLabel)}</span>
          ${namesakeHint}
          ${s.corrupted ? '<span class="badge bad" title="Le fichier student.json de cet étudiant est illisible. Restaurez une version précédente (OneDrive → Historique des versions). Toute modification est refusée en attendant.">⚠ Fiche illisible</span>' : (missingInfo.length ? `<span class="badge bad" title="Manque : ${escapeHtml(missingInfo.join(', '))}">⚠ Infos incomplètes</span>` : '')}
          <span class="badge note-flag" data-note-flag="${escapeHtml(s.folder)}" style="${s.note && s.note.trim() ? '' : 'display:none'}" title="${escapeHtml((s.note || '').slice(0, 200))}">📝 Note</span>
        </div>
        <div>
          <span class="badge ${badgeClass(prePct)}" data-pre-badge="${escapeHtml(s.folder)}">Pré ${prePct}%</span>
          <span class="badge ${badgeClass(postPct)}" data-post-badge="${escapeHtml(s.folder)}">Post ${postPct}%</span>
          ${studentHasCertification(s)
            ? `<span class="badge ${s.certificationConfirmed ? 'ok' : 'bad'}" data-certif-badge="${escapeHtml(s.folder)}">${s.certificationConfirmed ? '✅ Certifié' : '❌ Non certifié'}</span>`
            : `<span class="badge ${s.fileTransferred ? 'ok' : 'bad'}" data-transfer-badge="${escapeHtml(s.folder)}">${s.fileTransferred ? '📁 Dossier transféré' : '📁 Dossier non transféré'}</span>`}
        </div>
      </div>
      <div class="student-details"></div>
    </div>
  `);
  const header = block.querySelector('.student-header');
  const details = block.querySelector('.student-details');
  makeActivatable(header, 'button');
  header.setAttribute('aria-expanded', 'false');
  header.addEventListener('click', () => {
    if (details.classList.contains('open')) { details.classList.remove('open'); header.setAttribute('aria-expanded', 'false'); return; }
    details.classList.add('open');
    header.setAttribute('aria-expanded', 'true');
    if (!details.dataset.loaded) {
      details.appendChild(buildStudentDetails(course, type, s));
      details.dataset.loaded = '1';
    }
  });
  return block;
}

function buildStudentDetails(course, type, s) {
  const wrap = el(`<div></div>`);
  const preCountForDetails = countDocGroup(s.preDocs, type.preDocs);
  const postCountForDetails = countDocGroup(s.postDocs, type.postDocs);
  const prePctForDetails = preCountForDetails.total ? Math.round(100 * preCountForDetails.done / preCountForDetails.total) : 100;
  const postPctForDetails = postCountForDetails.total ? Math.round(100 * postCountForDetails.done / postCountForDetails.total) : 100;
  const tpl = state.emailTemplates.find(t => t.id === course.emailTemplateId);
  let mailSubject = '', mailBodyHtml = '';
  if (tpl) {
    const ctx = buildEmailContext(course, type, s);
    mailSubject = mergeTemplate(tpl.subject, ctx);
    mailBodyHtml = mergeTemplateHtml(templateBodyHtml(tpl), ctx);
  }

  wrap.innerHTML = `
    <div class="two-col">
      <div>
        <h3>Coordonnées</h3>
        <p class="muted">${buildCoordonneesHtml(s) || '(aucune coordonnée renseignée)'}</p>
        ${studentMissingInfo(s).length ? `<p style="color:var(--red); font-size:13px; margin-top:-4px">⚠ Il manque : ${escapeHtml(studentMissingInfo(s).join(', '))}</p>` : ''}
        <div class="actions-inline">
          <button class="btn small secondary" data-act="edit-info">Modifier les infos</button>
          <button class="btn small secondary" data-act="open-folder">📂 Ouvrir le dossier</button>
          ${s.email ? `<button class="btn small secondary" data-act="mail">✉️ Email à copier</button>` : ''}
          <button class="btn small danger" data-act="delete-student">Supprimer</button>
        </div>
        ${!s.email ? '<p class="muted" style="margin-top:6px">Renseignez une adresse email pour préparer un message à lui envoyer.</p>'
          : `<p class="muted" style="margin-top:6px" data-mail-log="${escapeHtml(s.folder)}" title="${escapeHtml(mailLogHistory(s))}">${escapeHtml(mailLogText(s))}</p>`}
        <div class="student-files"></div>
      </div>
      <div>
        <h3>Documents pré-cours <span class="muted">(${prePctForDetails}%)</span></h3>
        <div class="pre-checklist"></div>
        <h3 style="margin-top:14px">Documents post-cours <span class="muted">(${postPctForDetails}%)</span></h3>
        <div class="post-checklist"></div>
      </div>
    </div>
    <div class="edit-info-form" style="display:none"></div>
    <div class="student-note">
      <h3>Notes <span class="muted student-note-status" aria-live="polite"></span></h3>
      <label for="student-note-${escapeHtml(s.folder)}" class="muted">Notes personnelles sur cet étudiant, pour ce cours (enregistrées automatiquement)</label>
      <textarea id="student-note-${escapeHtml(s.folder)}" class="student-note-input" rows="3" placeholder="Ex. : à l'aise dans l'eau, appréhension pour la vidange du masque, allergie, rappeler le 15 octobre…">${escapeHtml(s.note || '')}</textarea>
    </div>
    ${studentHasCertification(s) ? `
    <div class="certif-final">
      <h3>Certification</h3>
      <label for="certif-instructor-${escapeHtml(s.folder)}">Instructeur certificateur</label>
      ${courseInstructors(course).length ? `
        <select id="certif-instructor-${escapeHtml(s.folder)}" class="certif-instructor-select">
          <option value="">-- non précisé --</option>
          ${courseInstructors(course).map(b => `<option value="${escapeHtml(b.id)}" ${s.certifyingInstructorId === b.id ? 'selected' : ''}>${escapeHtml(buddyLabel(b))}</option>`).join('')}
        </select>
      ` : `<p class="muted">Aucun instructeur/coéquipier n'est rattaché à ce cours. <a href="#" data-act="edit-course-instructors">Associez-en un ou plusieurs</a> pour pouvoir désigner qui a certifié cet étudiant.</p>`}
      <label class="checklist-item certif-final-label" style="margin-top:10px">
        <input type="checkbox" class="certif-toggle" data-folder="${escapeHtml(s.folder)}" ${s.certificationConfirmed ? 'checked' : ''} ${!s.certificationConfirmed && !s.certifyingInstructorId ? 'disabled' : ''}>
        <span class="certif-final-text">${s.certificationConfirmed ? '✅ Certification confirmée (100%)' : '❌ Certification non confirmée'}</span>
      </label>
      ${!s.certificationConfirmed && !s.certifyingInstructorId ? '<p class="muted" style="margin-top:2px">Choisissez d\'abord l\'instructeur certificateur ci-dessus.</p>' : ''}
    </div>` : `
    <div class="certif-final">
      <h3>Transfert de dossier</h3>
      <label class="checklist-item certif-final-label">
        <input type="checkbox" class="transfer-toggle" data-folder="${escapeHtml(s.folder)}" ${s.fileTransferred ? 'checked' : ''}>
        <span class="transfer-final-text">${s.fileTransferred ? '✅ Dossier transféré' : '❌ Dossier non transféré'}</span>
      </label>
    </div>`}
  `;

  const preBox = wrap.querySelector('.pre-checklist');
  (type.preDocs || []).forEach(docDef => preBox.appendChild(
    buildGenericChecklistItem(s, 'preDocs', docDef, `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`,
      () => { updateStudentBadges(s, type); refreshCourseBadges(course, type); })
  ));
  const postBox = wrap.querySelector('.post-checklist');
  (type.postDocs || []).forEach(docDef => postBox.appendChild(
    buildGenericChecklistItem(s, 'postDocs', docDef, `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`,
      () => { updateStudentBadges(s, type); refreshCourseBadges(course, type); })
  ));

  wrap.querySelector('[data-act=open-folder]').addEventListener('click', () => openExplorer(course.id, s.folder));
  const mailBtn = wrap.querySelector('[data-act=mail]');
  if (mailBtn) mailBtn.addEventListener('click', () => showMailModal({
    title: `Courriel à ${s.firstName} ${s.lastName}`, to: s.email, cc: courseCcList(course).join(', '), subject: mailSubject, bodyHtml: mailBodyHtml,
    note: tpl ? '' : "Aucun modèle d'email n'est associé à ce cours : choisissez-en un dans l'onglet « Documents & communications » pour préremplir l'objet et le message.",
    action: { label: '✔ Marquer comme envoyé', run: async () => {
      await logMailSent(course, [s], { date: todayISO(), kind: 'individuel', template: tpl ? tpl.name : '', subject: mailSubject });
      toast(`Envoi noté pour ${s.firstName} ${s.lastName}`);
    } }
  }));
  wrap.querySelector('[data-act=delete-student]').addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Supprimer cet étudiant ?',
      message: `Le dossier de <strong>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</strong> (et tous ses documents) sera retiré de ce cours et déplacé dans la <strong>corbeille</strong> de ScubaPilot. Vous pourrez le restaurer depuis Paramètres → Corbeille.`,
      requireTypeText: s.lastName
    });
    if (!ok) return;
    try { await api('DELETE', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`); }
    catch (e) { toast('Suppression impossible : ' + friendlyError(e), true); return; }
    toast('Étudiant déplacé dans la corbeille (Paramètres → Corbeille pour le restaurer)');
    route();
  });
  wrap.querySelector('[data-act=edit-info]').addEventListener('click', () => toggleEditInfo(wrap, course, s));

  wrap.querySelector('.student-files').appendChild(
    buildDropZone(`/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}/upload`, s.files || [], 'Glissez un document de cet étudiant ici, ou')
  );

  const editInstructorsLink = wrap.querySelector('[data-act=edit-course-instructors]');
  if (editInstructorsLink) editInstructorsLink.addEventListener('click', (ev) => { ev.preventDefault(); renderEditCourseForm(course); });

  const certifToggle = wrap.querySelector('.certif-toggle');
  const certifFinalBox = wrap.querySelector('.certif-final');
  const certifHint = certifFinalBox ? certifFinalBox.querySelector('p.muted[style*="margin-top:2px"]') : null;

  const certifInstructorSelect = wrap.querySelector('.certif-instructor-select');
  if (certifInstructorSelect) certifInstructorSelect.addEventListener('change', async (ev) => {
    const certifyingInstructorId = ev.target.value;
    const previous = s.certifyingInstructorId;
    try {
      await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, { certifyingInstructorId });
      s.certifyingInstructorId = certifyingInstructorId;
      toast('Instructeur certificateur enregistré');
      // Une fois un instructeur choisi, la case "Certifié" devient disponible (sauf si elle l'était
      // déjà, auquel cas elle n'a jamais été bloquée).
      if (certifToggle && !certifToggle.checked) {
        certifToggle.disabled = !certifyingInstructorId;
        if (certifHint) certifHint.style.display = certifyingInstructorId ? 'none' : '';
      }
    } catch (e) {
      ev.target.value = previous || '';
      toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
    }
  });

  const certifText = wrap.querySelector('.certif-final-text');
  if (certifToggle) certifToggle.addEventListener('change', async (ev) => {
    const certificationConfirmed = ev.target.checked;
    if (certificationConfirmed && !s.certifyingInstructorId) {
      ev.target.checked = false;
      toast('Choisissez d\'abord l\'instructeur certificateur avant de confirmer la certification.', true);
      return;
    }
    try {
      await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, { certificationConfirmed });
      s.certificationConfirmed = certificationConfirmed;
      if (certifText) certifText.textContent = certificationConfirmed ? '✅ Certification confirmée (100%)' : '❌ Certification non confirmée';
      const badge = document.querySelector(`[data-certif-badge="${s.folder}"]`);
      if (badge) {
        badge.textContent = certificationConfirmed ? '✅ Certifié' : '❌ Non certifié';
        badge.className = 'badge ' + (certificationConfirmed ? 'ok' : 'bad');
      }
      toast(certificationConfirmed ? 'Certification confirmée' : 'Certification non confirmée');
    } catch (e) {
      ev.target.checked = !certificationConfirmed;
      toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
    }
  });

  // Note libre par étudiant : enregistrée automatiquement (pause de frappe ou sortie du champ).
  const noteInput = wrap.querySelector('.student-note-input');
  const noteStatus = wrap.querySelector('.student-note-status');
  let noteTimer = null, noteSaved = s.note || '';
  async function saveNote() {
    clearTimeout(noteTimer);
    const note = noteInput.value;
    if (note === noteSaved) return;
    noteStatus.textContent = 'Enregistrement…';
    try {
      await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, { note });
      s.note = note; noteSaved = note;
      noteStatus.textContent = '✓ Enregistré';
      const flag = document.querySelector(`[data-note-flag="${s.folder}"]`);
      if (flag) flag.style.display = note.trim() ? '' : 'none';
    } catch (e) {
      noteStatus.textContent = '';
      toast('Erreur lors de l\'enregistrement de la note : ' + friendlyError(e), true);
    }
  }
  noteInput.addEventListener('input', () => { noteStatus.textContent = ''; clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 1000); });
  noteInput.addEventListener('blur', saveNote);

  const transferToggle = wrap.querySelector('.transfer-toggle');
  const transferText = wrap.querySelector('.transfer-final-text');
  if (transferToggle) transferToggle.addEventListener('change', async (ev) => {
    const fileTransferred = ev.target.checked;
    try {
      await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, { fileTransferred });
      s.fileTransferred = fileTransferred;
      if (transferText) transferText.textContent = fileTransferred ? '✅ Dossier transféré' : '❌ Dossier non transféré';
      const badge = document.querySelector(`[data-transfer-badge="${s.folder}"]`);
      if (badge) {
        badge.textContent = fileTransferred ? '📁 Dossier transféré' : '📁 Dossier non transféré';
        badge.className = 'badge ' + (fileTransferred ? 'ok' : 'bad');
      }
      toast(fileTransferred ? 'Dossier marqué comme transféré' : 'Dossier marqué comme non transféré');
    } catch (e) {
      ev.target.checked = !fileTransferred;
      toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
    }
  });

  return wrap;
}

function mergeTemplate(tpl, ctx) {
  // Une variable vide (ex. {prenom} dans un email groupé) emporte l'espace qui la précède :
  // « Bonjour {prenom}, » devient « Bonjour, » et non « Bonjour , ».
  return tpl.replace(/([ \t]?)\{(\w+)\}/g, (m, sp, k) => {
    if (ctx[k] === undefined) return m;
    return ctx[k] === '' ? '' : sp + ctx[k];
  });
}

// ---------- Champs étudiant dynamiques (basés sur data/student_fields.json) ----------
// Champ "date" personnalisé (JJ/MM/AAAA en saisie continue) plutôt que <input type="date"> :
// sur certains systèmes, le sélecteur natif du navigateur ne passe pas correctement au segment
// "mois" après les 4 chiffres de l'année. Un simple champ texte avec insertion automatique des "/"
// contourne complètement ce problème, tout en stockant la date au format ISO en interne.
function isoToDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function displayToIsoDate(disp) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((disp || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
// Âge en années révolues à la date du jour, à partir d'une date ISO (YYYY-MM-DD).
function calculateAge(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const birth = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}
function attachDateAutoFormat(container) {
  container.querySelectorAll('input.date-input').forEach(input => {
    const fieldId = input.id.replace(/^sf-/, '');
    const hint = container.querySelector('#age-hint-' + fieldId);
    function updateHint() {
      if (!hint) return;
      const age = calculateAge(displayToIsoDate(input.value));
      hint.textContent = age !== null ? `(${age} ans)` : '';
    }
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 8);
      let out = digits.slice(0, 2);
      if (digits.length >= 3) out += '/' + digits.slice(2, 4);
      if (digits.length >= 5) out += '/' + digits.slice(4, 8);
      input.value = out;
      updateHint();
    });
    updateHint();
  });
  enhanceDateInputs(container);
}

// Version générique du même champ date JJ/MM/AAAA à saisie continue (sans indice d'âge), pour
// toute date de l'application qui n'utilise pas le sélecteur natif du navigateur (séances, etc.) —
// le sélecteur natif pose problème sur certains systèmes Windows (voir attachDateAutoFormat).
// id : à ne fournir que lorsque ce champ est unique sur la page (un formulaire ponctuel), jamais
// pour un champ répété (une ligne par séance), sous peine d'identifiants dupliqués dans le DOM.
function plainDateInputHtml(cls, iso, id) {
  return `<input type="text" class="date-input-plain ${cls || ''}" ${id ? `id="${id}"` : ''} value="${escapeHtml(isoToDisplayDate(iso || ''))}" placeholder="JJ/MM/AAAA" inputmode="numeric" maxlength="10">`;
}
function attachPlainDateAutoFormat(container) {
  container.querySelectorAll('input.date-input-plain').forEach(input => {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 8);
      let out = digits.slice(0, 2);
      if (digits.length >= 3) out += '/' + digits.slice(2, 4);
      if (digits.length >= 5) out += '/' + digits.slice(4, 8);
      input.value = out;
    });
  });
  enhanceDateInputs(container);
  attachTimeInputs(container);
}

// ---------- Sélecteur de date (petit calendrier) et saisie d'heure ----------
// Le champ date reste un champ texte JJ/MM/AAAA (saisie continue, fiable partout) ; un bouton 📅 à
// côté ouvre le calendrier natif du navigateur (via un <input type="date"> caché) et reporte la date choisie.
function enhanceDateInputs(container) {
  container.querySelectorAll('input.date-input, input.date-input-plain').forEach(input => {
    if (input.dataset.calReady) return;
    input.dataset.calReady = '1';
    const wrap = document.createElement('span');
    wrap.className = 'date-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const hidden = document.createElement('input');
    hidden.type = 'date'; hidden.className = 'date-native'; hidden.tabIndex = -1; hidden.setAttribute('aria-hidden', 'true');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'date-cal-btn'; btn.title = 'Choisir dans le calendrier';
    btn.setAttribute('aria-label', 'Ouvrir le calendrier'); btn.textContent = '📅';
    wrap.appendChild(btn); wrap.appendChild(hidden);
    btn.addEventListener('click', () => {
      hidden.value = displayToIsoDate(input.value) || '';
      if (typeof hidden.showPicker === 'function') { try { hidden.showPicker(); return; } catch (e) {} }
      hidden.focus(); hidden.click();
    });
    hidden.addEventListener('change', () => {
      if (!hidden.value) return;
      input.value = isoToDisplayDate(hidden.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
// Heure : champ texte 24 h "HH:MM" à saisie continue (tapez 0930 → 09:30, ou 9 → 09:00) avec une liste
// de suggestions toutes les 15 minutes (clic dans le champ ou flèche bas), au lieu du sélecteur natif.
function normalizeTime(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 4);
  if (!d) return '';
  let h, m;
  if (d.length <= 2) { h = d.length === 1 ? '0' + d : d; m = '00'; }
  else if (d.length === 3) { h = '0' + d[0]; m = d.slice(1); }
  else { h = d.slice(0, 2); m = d.slice(2); }
  return (+h < 24 && +m < 60) ? `${h}:${m}` : '';
}
function ensureTimeSlots() {
  if (document.getElementById('time-slots')) return;
  const dl = document.createElement('datalist'); dl.id = 'time-slots';
  for (let h = 6; h <= 22; h++) for (const m of ['00', '15', '30', '45']) {
    if (h === 22 && m !== '00') continue;
    const o = document.createElement('option'); o.value = `${String(h).padStart(2, '0')}:${m}`; dl.appendChild(o);
  }
  document.body.appendChild(dl);
}
function timeInputHtml(cls, value, id) {
  return `<input type="text" class="time-input ${cls || ''}" ${id ? `id="${id}"` : ''} value="${escapeHtml(value || '')}" placeholder="HH:MM" inputmode="numeric" maxlength="5" list="time-slots" autocomplete="off">`;
}
function attachTimeInputs(container) {
  ensureTimeSlots();
  container.querySelectorAll('input.time-input').forEach(input => {
    if (input.dataset.timeReady) return;
    input.dataset.timeReady = '1';
    input.addEventListener('input', () => {
      const d = input.value.replace(/\D/g, '').slice(0, 4);
      input.value = d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
    });
    // Enregistré avant les écouteurs "change" des formulaires : la valeur lue ensuite est déjà normalisée.
    input.addEventListener('change', () => { input.value = normalizeTime(input.value); });
  });
}

// Durée entre deux heures "HH:MM" (heure de début / heure de fin d'une séance), affichée en
// "Xh" ou "Xh MMmin" — utile pour la facturation. Retourne '' si les heures sont incomplètes
// ou incohérentes (fin avant début).
function sessionDuration(timeStart, timeEnd) {
  const m1 = /^(\d{2}):(\d{2})$/.exec(timeStart || '');
  const m2 = /^(\d{2}):(\d{2})$/.exec(timeEnd || '');
  if (!m1 || !m2) return '';
  const startMin = (+m1[1]) * 60 + (+m1[2]);
  const endMin = (+m2[1]) * 60 + (+m2[2]);
  const diff = endMin - startMin;
  if (diff <= 0) return '';
  const h = Math.floor(diff / 60), m = diff % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
function totalSessionsDuration(sessions) {
  let totalMin = 0;
  (sessions || []).forEach(sess => {
    const m1 = /^(\d{2}):(\d{2})$/.exec(sess.timeStart || '');
    const m2 = /^(\d{2}):(\d{2})$/.exec(sess.timeEnd || '');
    if (!m1 || !m2) return;
    const diff = ((+m2[1]) * 60 + (+m2[2])) - ((+m1[1]) * 60 + (+m1[2]));
    if (diff > 0) totalMin += diff;
  });
  if (!totalMin) return '';
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function renderFieldInput(field, value) {
  const val = value !== undefined && value !== null ? value : '';
  if (field.type === 'select') {
    const opts = (field.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${o.value === val ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    return `<select id="sf-${field.id}">${opts}</select>`;
  }
  if (field.type === 'textarea') return `<textarea id="sf-${field.id}">${escapeHtml(val)}</textarea>`;
  if (field.type === 'date') {
    const ageHint = field.id === 'birthDate'
      ? `<span class="muted" id="age-hint-${field.id}" style="margin-left:8px; font-size:12px"></span>`
      : '';
    return `<input type="text" class="date-input" id="sf-${field.id}" value="${escapeHtml(isoToDisplayDate(val))}" placeholder="JJ/MM/AAAA" inputmode="numeric" maxlength="10">${ageHint}`;
  }
  const inputType = field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text';
  return `<input type="${inputType}" id="sf-${field.id}" value="${escapeHtml(val)}">`;
}
function readFieldValues(fields) {
  const out = {};
  fields.forEach(f => {
    const inputEl = document.getElementById('sf-' + f.id);
    if (!inputEl) return;
    out[f.id] = f.type === 'date' ? displayToIsoDate(inputEl.value) : inputEl.value;
  });
  return out;
}
function fieldValueOf(s, f) {
  let v = s[f.id];
  if (f.id === 'phoneHome' && !v && s.phone) v = s.phone; // repli pour les dossiers créés avant la séparation tél. maison/cellulaire
  return v;
}
function buildCoordonneesHtml(s) {
  return state.studentFields
    .filter(f => f.id !== 'firstName' && f.id !== 'lastName' && f.id !== 'status')
    .map(f => {
      let v = fieldValueOf(s, f);
      if (!v) return '';
      if (f.type === 'date') {
        const age = f.id === 'birthDate' ? calculateAge(v) : null;
        v = humanDate(v) + (age !== null ? ` (${age} ans)` : '');
      }
      if (f.type === 'select') { const opt = (f.options || []).find(o => o.value === v); v = opt ? opt.label : v; }
      return escapeHtml(f.label) + ' : ' + escapeHtml(v);
    })
    .filter(Boolean)
    .join('<br>');
}

function toggleEditInfo(wrap, course, s) {
  const box = wrap.querySelector('.edit-info-form');
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const fieldsHtml = state.studentFields.map(f =>
    `<div style="flex:1;min-width:200px"><label for="sf-${escapeHtml(f.id)}">${escapeHtml(f.label)}</label>${renderFieldInput(f, fieldValueOf(s, f))}</div>`
  ).join('');
  box.innerHTML = `
    <h3 style="margin-top:16px">Modifier les informations</h3>
    <div class="row">${fieldsHtml}</div>
    <p class="muted">Note : renommer le prénom/nom ne renomme pas le dossier existant sur le disque.</p>
    <div class="actions-inline"><button class="btn small" id="ei-save">Enregistrer</button></div>
  `;
  attachDateAutoFormat(box);
  box.querySelector('#ei-save').addEventListener('click', async (ev) => {
    const payload = readFieldValues(state.studentFields);
    await withBusy(ev.currentTarget, async () => {
      try {
        await api('PUT', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`, payload);
        toast('Informations mises à jour');
        route();
      } catch (e) {
        toast('Erreur lors de la mise à jour : ' + friendlyError(e), true);
      }
    });
  });
}

function renderAddStudentForm(course, type) {
  const fields = state.studentFields;
  const fieldsHtml = fields.map(f =>
    `<div style="flex:1;min-width:200px"><label for="sf-${escapeHtml(f.id)}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>${renderFieldInput(f, '')}</div>`
  ).join('');
  const box = el(`
    <div class="card">
      <h2>Ajouter un étudiant</h2>
      <div class="autocomplete">
        <label for="as-search">Rechercher un étudiant existant (pour copier ses infos)</label>
        <input id="as-search" placeholder="Tapez un nom...">
        <div class="autocomplete-list" style="display:none"></div>
      </div>
      <div class="row">${fieldsHtml}</div>
      <div class="actions-inline">
        <button class="btn" id="as-save">Ajouter</button>
        <button class="btn secondary" id="as-cancel">Annuler</button>
      </div>
      <p class="muted" id="as-error"></p>
    </div>
  `);
  // Dans l'onglet Étudiants, au-dessus de la zone « Supprimer ce cours ».
  (document.querySelector('.tab-panel[data-panel="etudiants"]') || document.getElementById('app')).appendChild(box);
  box.scrollIntoView({ behavior: 'smooth' });
  attachDateAutoFormat(box);

  const searchInput = box.querySelector('#as-search');
  const listBox = box.querySelector('.autocomplete-list');
  let debounce, pickedStudentId = '';
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    pickedStudentId = '';
    const q = searchInput.value.trim();
    if (!q) { listBox.style.display = 'none'; return; }
    debounce = setTimeout(async () => {
      const results = await api('GET', '/api/global-students?q=' + encodeURIComponent(q));
      if (!results.length) { listBox.style.display = 'none'; return; }
      listBox.innerHTML = '';
      results.slice(0, 8).forEach(r => {
        const item = el(`<div>${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)} <span class="muted">(${escapeHtml(r.courseId)}${r.email ? ' · ' + escapeHtml(r.email) : ''})</span></div>`);
        item.addEventListener('click', () => {
          pickedStudentId = r.studentId || ''; // même personne : son historique suivra
          fields.forEach(f => {
            const inputEl = document.getElementById('sf-' + f.id);
            if (!inputEl) return;
            let v = r[f.id];
            if (f.id === 'phoneHome' && !v && r.phone) v = r.phone;
            inputEl.value = f.type === 'date' ? isoToDisplayDate(v || '') : (v || '');
          });
          listBox.style.display = 'none';
          searchInput.value = `${r.firstName || ''} ${r.lastName || ''}`;
        });
        listBox.appendChild(item);
      });
      listBox.style.display = 'block';
    }, 250);
  });

  box.querySelector('#as-cancel').addEventListener('click', () => box.remove());
  box.querySelector('#as-save').addEventListener('click', async (ev) => {
    const payload = readFieldValues(fields);
    if (!payload.firstName || !payload.lastName) { box.querySelector('#as-error').textContent = 'Prénom et nom requis.'; return; }
    if (pickedStudentId) payload.studentId = pickedStudentId;
    const url = `/api/courses/${encodeURIComponent(course.id)}/students`;
    await withBusy(ev.currentTarget, async () => {
      try {
        try { await api('POST', url, payload); }
        catch (e) {
          // Un étudiant du même nom est déjà dans ce cours : on demande si c'est quelqu'un d'autre.
          if (!(e.data && e.data.error === 'STUDENT_EXISTS' && e.data.homonym)) throw e;
          const ok = await showConfirmModal({
            title: 'Un homonyme dans ce cours ?',
            message: `Un étudiant nommé <strong>${escapeHtml(payload.firstName)} ${escapeHtml(payload.lastName)}</strong> est déjà inscrit à ce cours. S'agit-il d'une <strong>autre personne</strong> qui porte le même nom ?`,
            confirmText: "Oui, c'est quelqu'un d'autre : l'ajouter", neutral: true
          });
          if (!ok) return;
          await api('POST', url, { ...payload, homonym: true });
        }
        toast('Étudiant ajouté');
        route();
      } catch (e) {
        box.querySelector('#as-error').textContent = e.data && e.data.error === 'STUDENT_EXISTS'
          ? 'Cet étudiant est déjà inscrit à ce cours.' : friendlyError(e);
      }
    });
  });
}

// Import de plusieurs étudiants à partir d'un JSON collé (ex: généré par Claude à partir d'un roster PDF).
// ---------- Import de plusieurs étudiants : tableau collé depuis Excel, fichier CSV, ou JSON ----------
// Lit un texte tabulaire (séparateur tabulation, point-virgule ou virgule ; guillemets gérés).
function parseTable(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sample = text.split('\n').slice(0, 10).join('\n');
  const count = ch => { let n = 0, q = false; for (const c of sample) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
  const delim = [['\t', count('\t')], [';', count(';')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0];
  const d = delim[1] > 0 ? delim[0] : '\t';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); rows.push(row);
  return rows.filter(r => r.some(v => v !== ''));
}
const IMPORT_TARGETS = [
  ['', '— ignorer —'], ['firstName', 'Prénom'], ['lastName', 'Nom'], ['fullName', 'Nom complet (Prénom Nom, ou Nom, Prénom)'],
  ['email', 'Email'], ['phoneCell', 'Téléphone (cellulaire)'], ['phoneHome', 'Téléphone (maison)'],
  ['address', 'Adresse'], ['birthDate', 'Date de naissance'], ['status', 'Statut']
];
const normHead = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Devine la colonne d'après son titre.
function guessTargetFromHeader(h) {
  const n = normHead(h);
  if (!n) return '';
  if (/^(prenom|first name|firstname|given name)/.test(n)) return 'firstName';
  if (/(nom complet|full name|^name$|^etudiant$|^participant$|^student$)/.test(n)) return 'fullName';
  if (/^(nom|last name|lastname|surname|nom de famille|family name)/.test(n)) return 'lastName';
  if (/(mail|courriel)/.test(n)) return 'email';
  if (/(maison|home|domicile|residence)/.test(n) && /(tel|phone)/.test(n)) return 'phoneHome';
  if (/(tel|phone|cell|mobile|portable)/.test(n)) return 'phoneCell';
  if (/(adresse|address)/.test(n)) return 'address';
  if (/(naissance|birth|ddn|dob)/.test(n)) return 'birthDate';
  if (/(statut|status)/.test(n)) return 'status';
  return '';
}
// Sans ligne de titres : devine d'après le contenu des colonnes.
function guessTargetsFromContent(rows, nCols) {
  const targets = new Array(nCols).fill('');
  const col = i => rows.map(r => r[i] || '').filter(Boolean);
  const share = (vals, re) => vals.length ? vals.filter(v => re.test(v)).length / vals.length : 0;
  const used = new Set();
  const take = (i, tg) => { if (!targets[i] && !used.has(tg)) { targets[i] = tg; used.add(tg); return true; } return false; };
  for (let i = 0; i < nCols; i++) {
    const v = col(i);
    if (share(v, /^[^\s@]+@[^\s@]+\.[^\s@]+$/) > 0.6) take(i, 'email');
    else if (share(v, /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}$/) > 0.6) take(i, 'birthDate');
    else if (share(v, /^[+()\d][\d\s().-]{6,}$/) > 0.6) take(i, used.has('phoneCell') ? 'phoneHome' : 'phoneCell');
  }
  // Les deux premières colonnes de texte restantes : prénom puis nom (ou une seule : nom complet).
  const free = []; for (let i = 0; i < nCols; i++) if (!targets[i] && share(col(i), /[A-Za-zÀ-ÿ]/) > 0.6) free.push(i);
  if (free.length >= 2) { targets[free[0]] = 'firstName'; targets[free[1]] = 'lastName'; }
  else if (free.length === 1) targets[free[0]] = 'fullName';
  return targets;
}
function importDateToIso(v) {
  v = String(v || '').trim();
  let m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(v); // jour/mois/année (usage au Québec)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function importStatus(v) {
  const n = normHead(v);
  if (!n) return '';
  if (/(both|deux|cours.*certif|certif.*cours|complet)/.test(n)) return 'both';
  if (/certif/.test(n)) return 'certif';
  if (/cours|course|theorie/.test(n)) return 'cours';
  return '';
}
// Transforme les lignes + la correspondance des colonnes en étudiants ; note les lignes inutilisables.
function rowsToStudents(rows, targets) {
  const students = [], problems = [];
  rows.forEach((r, idx) => {
    const s = {};
    targets.forEach((tg, i) => {
      const v = (r[i] || '').trim();
      if (!tg || !v) return;
      if (tg === 'fullName') {
        if (v.includes(',')) { const [last, first] = v.split(',').map(x => x.trim()); s.lastName = s.lastName || last; s.firstName = s.firstName || first || ''; }
        else { const parts = v.split(/\s+/); s.firstName = s.firstName || parts[0]; s.lastName = s.lastName || parts.slice(1).join(' '); }
      } else if (tg === 'birthDate') { const iso = importDateToIso(v); if (iso) s.birthDate = iso; else problems.push(`Ligne ${idx + 1} : date de naissance « ${v} » non reconnue (ignorée)`); }
      else if (tg === 'status') { const st = importStatus(v); if (st) s.status = st; }
      else s[tg] = v;
    });
    if (!s.firstName || !s.lastName) { problems.push(`Ligne ${idx + 1} : prénom ou nom manquant — non importée`); return; }
    students.push(s);
  });
  return { students, problems };
}
// Lit un fichier texte en devinant son encodage (UTF-8, sinon Windows-1252 : cas des CSV enregistrés par Excel).
async function readTextFileSmart(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
function renderBulkImportForm(course, type) {
  const previous = document.getElementById('bulk-import-card');
  if (previous) previous.remove();
  const box = el(`
    <div class="card" id="bulk-import-card">
      <h2>Importer plusieurs étudiants</h2>
      <p class="muted">Dans Excel, sélectionnez les lignes de vos étudiants (avec ou sans la ligne de titres), copiez (Ctrl+C), puis collez ci-dessous (Ctrl+V). Vous pouvez aussi choisir un fichier .csv. Colonnes reconnues : prénom, nom (ou nom complet), email, téléphone, adresse, date de naissance, statut.</p>
      <textarea id="bi-text" style="min-height:140px; font-family:monospace;" placeholder="Prénom	Nom	Email	Téléphone
Jean	Dupont	jean@exemple.com	514-000-0000
Marie	Tremblay	marie@exemple.com	438-000-0000"></textarea>
      <div class="actions-inline">
        <label class="btn small secondary" style="margin:0">Choisir un fichier .csv<input type="file" id="bi-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></label>
        <button class="btn small secondary" id="bi-cancel">Annuler</button>
      </div>
      <div id="bi-preview"></div>
      <p class="form-error" id="bi-error" role="alert"></p>
      <div id="bi-result"></div>
    </div>
  `);
  // Dans l'onglet Étudiants, au-dessus de la zone « Supprimer ce cours ».
  (document.querySelector('.tab-panel[data-panel="etudiants"]') || document.getElementById('app')).appendChild(box);
  box.scrollIntoView({ behavior: 'smooth' });
  const textArea = box.querySelector('#bi-text'), preview = box.querySelector('#bi-preview'), errorEl = box.querySelector('#bi-error');
  let rows = [], targets = [], hasHeader = false, jsonList = null;

  function analyse() {
    errorEl.textContent = ''; jsonList = null;
    const raw = textArea.value.trim();
    if (!raw) { rows = []; preview.innerHTML = ''; return; }
    if (raw[0] === '[') { // ancien format JSON, toujours accepté
      try { const l = JSON.parse(raw); if (!Array.isArray(l)) throw new Error('tableau attendu'); jsonList = l; }
      catch (e) { preview.innerHTML = ''; errorEl.textContent = 'JSON invalide : ' + e.message; return; }
      renderPreview(); return;
    }
    rows = parseTable(raw);
    const nCols = Math.max(...rows.map(r => r.length));
    rows.forEach(r => { while (r.length < nCols) r.push(''); });
    const fromHead = rows[0].map(guessTargetFromHeader);
    hasHeader = fromHead.filter(Boolean).length >= 2 || (fromHead.filter(Boolean).length === 1 && nCols <= 2);
    targets = hasHeader ? fromHead : guessTargetsFromContent(rows, nCols);
    renderPreview();
  }
  function renderPreview() {
    if (jsonList) {
      const ok = jsonList.filter(s => s && s.firstName && s.lastName).length;
      preview.innerHTML = `<p style="margin-top:12px"><strong>${ok}</strong> étudiant(s) prêt(s) à importer (format JSON).</p><div class="actions-inline"><button class="btn small" id="bi-import" ${ok ? '' : 'disabled'}>Importer ${ok} étudiant(s)</button></div>`;
      preview.querySelector('#bi-import').addEventListener('click', ev => doImport(ev.currentTarget, jsonList));
      return;
    }
    const data = hasHeader ? rows.slice(1) : rows;
    const { students, problems } = rowsToStudents(data, targets);
    const opts = sel => IMPORT_TARGETS.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
    const shown = data.slice(0, 8);
    preview.innerHTML = `
      <h3 style="margin-top:16px">Vérifiez la correspondance des colonnes</h3>
      <label class="checklist-item"><input type="checkbox" id="bi-header" ${hasHeader ? 'checked' : ''}> <span>La première ligne contient les titres des colonnes</span></label>
      <div class="table-scroll"><table class="import-preview">
        <thead><tr>${targets.map((tg, i) => `<th><select data-col="${i}" aria-label="Contenu de la colonne ${i + 1}">${opts(tg)}</select>${hasHeader ? `<div class="muted">${escapeHtml(rows[0][i] || '')}</div>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(r => `<tr>${r.map((v, i) => `<td class="${targets[i] ? '' : 'ignored'}">${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${data.length > shown.length ? `<p class="muted">… et ${data.length - shown.length} autre(s) ligne(s).</p>` : ''}
      ${problems.length ? `<p class="form-error">${problems.slice(0, 6).map(escapeHtml).join('<br>')}${problems.length > 6 ? '<br>…' : ''}</p>` : ''}
      <div class="actions-inline"><button class="btn small" id="bi-import" ${students.length ? '' : 'disabled'}>Importer ${students.length} étudiant(s)</button></div>
      ${students.length ? '' : '<p class="muted">Indiquez au moins quelles colonnes contiennent le prénom et le nom (ou le nom complet).</p>'}
    `;
    preview.querySelector('#bi-header').addEventListener('change', e => {
      hasHeader = e.target.checked;
      if (hasHeader) { const g = rows[0].map(guessTargetFromHeader); if (g.some(Boolean)) targets = g; }
      renderPreview();
    });
    preview.querySelectorAll('select[data-col]').forEach(sel => sel.addEventListener('change', () => {
      const i = Number(sel.dataset.col);
      // Un même champ ne peut venir que d'une colonne : l'ancienne est remise à « ignorer ».
      if (sel.value) targets = targets.map((tg, k) => (k !== i && tg === sel.value) ? '' : tg);
      targets[i] = sel.value; renderPreview();
    }));
    preview.querySelector('#bi-import').addEventListener('click', ev => doImport(ev.currentTarget, students));
  }
  async function doImport(btn, list) {
    await withBusy(btn, async () => {
      try {
        const res = await api('POST', `/api/courses/${encodeURIComponent(course.id)}/students/bulk`, { students: list });
        errorEl.textContent = '';
        const resultBox = box.querySelector('#bi-result');
        resultBox.innerHTML = '';
        resultBox.appendChild(el(`<p>${res.created.length} étudiant(s) créé(s)${res.skipped.length ? ', ' + res.skipped.length + ' ignoré(s)' : ''}.</p>`));
        if (res.skipped.length) {
          resultBox.appendChild(el('<p class="muted">Ignorés : ' + res.skipped.map(s2 => escapeHtml(s2.name + ' (' + s2.reason + ')')).join(', ') + '</p>'));
        }
        toast(res.created.length + ' étudiant(s) importé(s)');
        setTimeout(() => route(), res.skipped.length ? 3500 : 1200);
      } catch (e) {
        errorEl.textContent = friendlyError(e);
      }
    }, 'Import en cours...');
  }
  let timer = null;
  textArea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(analyse, 150); });
  box.querySelector('#bi-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { textArea.value = await readTextFileSmart(f); analyse(); }
    catch (err) { errorEl.textContent = 'Lecture du fichier impossible : ' + err.message; }
    e.target.value = '';
  });
  box.querySelector('#bi-cancel').addEventListener('click', () => box.remove());
}

async function openExplorer(courseId, studentFolder, sub) {
  try {
    await api('POST', '/api/open-explorer', { courseId, studentFolder, sub });
  } catch (e) {
    toast("Impossible d'ouvrir l'Explorateur : " + friendlyError(e), true);
  }
}

// ---------- Photos du cours (sous-dossier "Photo", créé systématiquement pour chaque cours) ----------
function buildPhotosCard(course) {
  const card = el(`
    <div class="card">
      <div class="actions-inline" style="justify-content:space-between">
        <h2 style="margin:0">Photos du cours</h2>
        <button class="btn small secondary" id="open-photo-folder">📂 Ouvrir le dossier Photo</button>
      </div>
      <p class="muted">Chaque cours a un sous-dossier "Photo" dédié — glissez vos photos ici, elles y sont copiées automatiquement.</p>
    </div>
  `);
  card.querySelector('#open-photo-folder').addEventListener('click', () => openExplorer(course.id, null, 'Photo'));
  card.appendChild(buildDropZone(`/api/courses/${encodeURIComponent(course.id)}/photos/upload`, course.photos || [], 'Glissez une ou plusieurs photos ici, ou'));
  return card;
}

// ---------- Settings ----------
// ---------- Bibliothèque de modèles d'email (Paramètres) ----------
function buildEmailTemplatesCard() {
  const card = el(`
    <div class="card">
      <h2>Modèles d'email</h2>
      <p class="muted">Variables disponibles : {prenom} {nom} (l'étudiant — vides dans un email groupé) {type_cours} {liste_dates_lieux} {liste_dates_lieux_note_coequipier} {date_debut} {date_fin} {lieu} {instructeur} (vous) {instructeur_tel} {instructeur_padi} {equipe} (vous et les instructeurs et coéquipiers du cours) {liste_etudiants} (email groupé) {liste_docs_pre} {liste_docs_manquants}</p>
    </div>
  `);
  const list = el('<div id="tpl-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="tpl-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="tpl-add-btn">+ Nouveau modèle</button></div>');
  card.appendChild(addRow);

  function renderList() {
    list.innerHTML = '';
    if (!state.emailTemplates.length) {
      list.appendChild(el('<p class="muted">Aucun modèle pour l\'instant. Créez-en un ci-dessous.</p>'));
      return;
    }
    state.emailTemplates.forEach(t => {
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <strong>${escapeHtml(t.name)}</strong>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(t));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!(await confirmDelete(`Supprimer le modèle "${t.name}" ?`))) return;
        state.emailTemplates = state.emailTemplates.filter(x => x.id !== t.id);
        await api('PUT', '/api/email-templates', state.emailTemplates);
        toast('Modèle supprimé');
        renderList();
      });
      list.appendChild(row);
    });
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le modèle' : 'Nouveau modèle'}</h3>
      <label for="tpl-name">Nom du modèle (ex: "Convocation - printemps")</label><input id="tpl-name" value="${existing ? escapeHtml(existing.name) : ''}">
      <label for="tpl-subject">Sujet</label><input id="tpl-subject" value="${existing ? escapeHtml(existing.subject) : ''}">
      <label>Message <span class="muted">— sélectionnez du texte puis G, I, S ou S double pour le mettre en forme</span></label>
      ${richEditorHtml({ id: 'tpl-body', html: existing ? templateBodyHtml(existing) : '', minHeight: 220, label: 'Message du modèle' })}
      <div class="actions-inline">
        <button class="btn small" id="tpl-save">Enregistrer</button>
        <button class="btn small secondary" id="tpl-cancel">Annuler</button>
      </div>
      <p class="muted" id="tpl-error"></p>
    `;
    wireRichEditor(formBox);
    formBox.querySelector('#tpl-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#tpl-save').addEventListener('click', async (ev) => {
      const name = formBox.querySelector('#tpl-name').value.trim();
      const subject = formBox.querySelector('#tpl-subject').value;
      // bodyHtml : le message mis en forme ; body : sa version texte seul (compatibilité).
      const bodyHtml = sanitizeEmailHtml(formBox.querySelector('#tpl-body').innerHTML);
      const body = htmlToPlainText(bodyHtml);
      if (!name) { formBox.querySelector('#tpl-error').textContent = 'Le nom du modèle est requis.'; return; }
      const next = state.emailTemplates.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = { ...existing, name, subject, body, bodyHtml };
      } else {
        next.push({ id: 'tpl-' + Date.now(), name, subject, body, bodyHtml });
      }
      await withBusy(ev.currentTarget, async () => {
        try {
          await api('PUT', '/api/email-templates', next);
          state.emailTemplates = next;
          toast('Modèle enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#tpl-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#tpl-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

// ---------- Liste globale de coéquipiers (Paramètres) ----------
function buildBuddiesCard() {
  const card = el(`
    <div class="card">
      <h2>Coéquipiers (Divemaster, autres instructeurs...)</h2>
      <p class="muted">Enregistrez-les une fois ici ; vous pourrez ensuite les ajouter à une séance en un clic avec le "+". Leur email sera automatiquement mis en copie (Cc) des courriels du cours où ils interviennent.</p>
    </div>
  `);
  const list = el('<div id="buddy-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="buddy-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="buddy-add-btn">+ Nouveau coéquipier</button></div>');
  card.appendChild(addRow);

  function renderList() {
    list.innerHTML = '';
    if (!state.buddies.length) {
      list.appendChild(el('<p class="muted">Aucun coéquipier enregistré.</p>'));
      return;
    }
    state.buddies.forEach(b => {
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <div><strong>${escapeHtml(buddyLabel(b))}</strong><br><span class="muted">${escapeHtml(b.email || '')}</span></div>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(b));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!(await confirmDelete(`Supprimer "${b.name}" de la liste des coéquipiers ?`))) return;
        state.buddies = state.buddies.filter(x => x.id !== b.id);
        await api('PUT', '/api/buddies', state.buddies);
        toast('Coéquipier supprimé');
        renderList();
      });
      list.appendChild(row);
    });
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le coéquipier' : 'Nouveau coéquipier'}</h3>
      <div class="row">
        <div><label for="buddy-name">Nom</label><input id="buddy-name" value="${existing ? escapeHtml(existing.name) : ''}"></div>
        <div><label for="buddy-role">Rôle (optionnel, ex: DM)</label><input id="buddy-role" value="${existing ? escapeHtml(existing.role || '') : ''}"></div>
      </div>
      <label for="buddy-email">Email</label><input id="buddy-email" type="email" value="${existing ? escapeHtml(existing.email || '') : ''}">
      <div class="actions-inline">
        <button class="btn small" id="buddy-save">Enregistrer</button>
        <button class="btn small secondary" id="buddy-cancel">Annuler</button>
      </div>
      <p class="muted" id="buddy-error"></p>
    `;
    formBox.querySelector('#buddy-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#buddy-save').addEventListener('click', async (ev) => {
      const name = formBox.querySelector('#buddy-name').value.trim();
      const role = formBox.querySelector('#buddy-role').value.trim();
      const email = formBox.querySelector('#buddy-email').value.trim();
      if (!name) { formBox.querySelector('#buddy-error').textContent = 'Le nom est requis.'; return; }
      const next = state.buddies.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = { ...existing, name, role, email };
      } else {
        next.push({ id: 'buddy-' + Date.now(), name, role, email });
      }
      await withBusy(ev.currentTarget, async () => {
        try {
          await api('PUT', '/api/buddies', next);
          state.buddies = next;
          toast('Coéquipier enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#buddy-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#buddy-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

// ---------- Centres partenaires (Paramètres) ----------
function buildCentersCard() {
  const card = el(`
    <div class="card">
      <h2>Centres partenaires</h2>
      <p class="muted">Chaque cours doit être associé à un centre mandataire. Ces informations servent aussi d'en-tête pour les factures générées.</p>
    </div>
  `);
  const list = el('<div id="center-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="center-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="center-add-btn">+ Nouveau centre</button></div>');
  card.appendChild(addRow);

  function renderList() {
    list.innerHTML = '';
    if (!state.centers.length) {
      list.appendChild(el('<p class="muted">Aucun centre enregistré. Un centre est obligatoire pour créer un cours.</p>'));
      return;
    }
    state.centers.forEach(c => {
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <div><strong>${escapeHtml(c.name)}</strong><br><span class="muted">${escapeHtml([c.contactName, c.email, c.phone].filter(Boolean).join(' · '))}</span></div>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(c));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!(await confirmDelete(`Supprimer le centre "${c.name}" ?`))) return;
        state.centers = state.centers.filter(x => x.id !== c.id);
        await api('PUT', '/api/centers', state.centers);
        toast('Centre supprimé');
        renderList();
      });
      list.appendChild(row);
    });
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le centre' : 'Nouveau centre'}</h3>
      <label for="ctr-name">Nom du centre</label><input id="ctr-name" value="${existing ? escapeHtml(existing.name) : ''}">
      <div class="row">
        <div><label for="ctr-contact">Personne-contact</label><input id="ctr-contact" value="${existing ? escapeHtml(existing.contactName || '') : ''}"></div>
        <div><label for="ctr-email">Email</label><input id="ctr-email" type="email" value="${existing ? escapeHtml(existing.email || '') : ''}"></div>
        <div><label for="ctr-phone">Téléphone</label><input id="ctr-phone" type="tel" value="${existing ? escapeHtml(existing.phone || '') : ''}"></div>
      </div>
      <label for="ctr-address">Adresse</label><input id="ctr-address" value="${existing ? escapeHtml(existing.address || '') : ''}">
      <div class="row">
        <div><label for="ctr-taxid">N° de taxe / référence (optionnel)</label><input id="ctr-taxid" value="${existing ? escapeHtml(existing.taxId || '') : ''}"></div>
      </div>
      <label for="ctr-notes">Notes (optionnel)</label><textarea id="ctr-notes">${existing ? escapeHtml(existing.notes || '') : ''}</textarea>
      <div class="actions-inline">
        <button class="btn small" id="ctr-save">Enregistrer</button>
        <button class="btn small secondary" id="ctr-cancel">Annuler</button>
      </div>
      <p class="muted" id="ctr-error"></p>
    `;
    formBox.querySelector('#ctr-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#ctr-save').addEventListener('click', async () => {
      const name = formBox.querySelector('#ctr-name').value.trim();
      if (!name) { formBox.querySelector('#ctr-error').textContent = 'Le nom est requis.'; return; }
      const data = {
        name,
        contactName: formBox.querySelector('#ctr-contact').value.trim(),
        email: formBox.querySelector('#ctr-email').value.trim(),
        phone: formBox.querySelector('#ctr-phone').value.trim(),
        address: formBox.querySelector('#ctr-address').value.trim(),
        taxId: formBox.querySelector('#ctr-taxid').value.trim(),
        notes: formBox.querySelector('#ctr-notes').value.trim()
      };
      const next = state.centers.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = { ...existing, ...data };
      } else {
        next.push({ id: 'centre-' + Date.now(), ...data });
      }
      await withBusy(formBox.querySelector('#ctr-save'), async () => {
        try {
          await api('PUT', '/api/centers', next);
          state.centers = next;
          toast('Centre enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#ctr-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#center-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

// ---------- Facturation (Paramètres) ----------
function buildBillingCard() {
  const b = normBilling(state.billing);
  state.billing = b;
  const lists = JSON.parse(JSON.stringify(b.priceLists));
  const card = el(`
    <div class="card">
      <h2>Facturation</h2>
      <p class="muted">Grilles de tarifs utilisées pour préremplir les factures (modifiables sur chaque facture), taxes, message de pied de page et étampe.</p>
      <div class="row">
        <div><label for="bill-currency">Devise (ex: CAD, EUR, USD)</label><input id="bill-currency" value="${escapeHtml(b.currency)}"></div>
        <div><label for="bill-footer">Message de pied de page</label><input id="bill-footer" value="${escapeHtml(b.footer)}"></div>
      </div>
      <div class="row">
        <div><label for="bill-tps-l">Taxe 1 — libellé</label><input id="bill-tps-l" value="${escapeHtml(b.taxes.tps.label)}"></div>
        <div><label for="bill-tps-r">Taux (%)</label><input id="bill-tps-r" value="${fmtNum(b.taxes.tps.rate)}"></div>
        <div><label for="bill-tvq-l">Taxe 2 — libellé</label><input id="bill-tvq-l" value="${escapeHtml(b.taxes.tvq.label)}"></div>
        <div><label for="bill-tvq-r">Taux (%)</label><input id="bill-tvq-r" value="${fmtNum(b.taxes.tvq.rate)}"></div>
      </div>
      <h3 style="margin-top:14px">Étampe</h3>
      <div class="row" style="align-items:center">
        <div id="bill-stamp-prev"></div>
        <div><label class="dropzone-browse btn secondary small">Choisir une image (PNG/JPG)<input type="file" id="bill-stamp-file" accept="image/*" style="display:none"></label>
        <button class="btn danger small" id="bill-stamp-del">Retirer</button></div>
      </div>
      <h3 style="margin-top:14px">Grilles de tarifs</h3>
      <p class="muted">La grille la plus précise s'applique (centre + type, puis centre, puis type, puis générale).</p>
      <div id="bill-lists"></div>
      <button class="btn secondary small" id="bill-addlist">+ Grille de tarifs</button>
      <div class="actions-inline" style="margin-top:14px"><button class="btn small" id="bill-save">Enregistrer la facturation</button></div>
      <p class="muted" id="bill-error"></p>
    </div>`);
  const box = card.querySelector('#bill-lists');
  const centerOpts = sel => `<option value="">Tous les centres</option>` + state.centers.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === sel ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const typeOpts = sel => `<option value="">Tous les types</option>` + state.courseTypes.map(t => `<option value="${escapeHtml(t.code)}" ${t.code === sel ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
  function renderLists() {
    box.innerHTML = '';
    lists.forEach((l, li) => {
      l.groups = l.groups || [];
      const w = el(`<div style="border:1px solid #d5dee5;border-radius:8px;padding:10px;margin-bottom:10px">
        <div class="row" style="align-items:flex-end">
          <div><label for="pl-c-${li}">Centre</label><select id="pl-c-${li}">${centerOpts(l.centerId)}</select></div>
          <div><label for="pl-t-${li}">Type de cours</label><select id="pl-t-${li}">${typeOpts(l.typeCode)}</select></div>
          <div><button class="btn danger small" data-act="del">Supprimer la grille</button></div>
        </div><div class="pl-groups"></div>
        <button class="btn secondary small" data-act="add">+ Groupe de prix</button></div>`);
      w.querySelector(`#pl-c-${li}`).addEventListener('change', e => { l.centerId = e.target.value; });
      w.querySelector(`#pl-t-${li}`).addEventListener('change', e => { l.typeCode = e.target.value; });
      const gb = w.querySelector('.pl-groups');
      l.groups.forEach((g, gi) => {
        const r = el(`<div class="row" style="align-items:flex-end"><div><label for="pg-l-${li}-${gi}">Description</label><input id="pg-l-${li}-${gi}" value="${escapeHtml(g.label || '')}"></div><div><label for="pg-p-${li}-${gi}">Prix unitaire</label><input id="pg-p-${li}-${gi}" value="${String(g.price || 0).replace('.', ',')}"></div><div><button class="btn danger small" aria-label="Retirer ce groupe">✕</button></div></div>`);
        r.querySelector(`#pg-l-${li}-${gi}`).addEventListener('input', e => { g.label = e.target.value; });
        r.querySelector(`#pg-p-${li}-${gi}`).addEventListener('input', e => { g.price = parseFloat(String(e.target.value).replace(',', '.')) || 0; });
        r.querySelector('button').addEventListener('click', () => { l.groups.splice(gi, 1); renderLists(); });
        gb.appendChild(r);
      });
      w.querySelector('[data-act=add]').addEventListener('click', () => { l.groups.push({ label: '', price: 0 }); renderLists(); });
      w.querySelector('[data-act=del]').addEventListener('click', () => { lists.splice(li, 1); renderLists(); });
      box.appendChild(w);
    });
    if (!lists.length) box.appendChild(el('<p class="muted">Aucune grille : la facture démarre avec un groupe « Cours complet » à 0 $.</p>'));
  }
  renderLists();
  card.querySelector('#bill-addlist').addEventListener('click', () => { lists.push({ centerId: '', typeCode: '', groups: [{ label: 'Cours complet', price: 0 }] }); renderLists(); });

  async function showStamp() {
    if (state.stamp === undefined) { try { state.stamp = (await api('GET', '/api/stamp')).dataUrl || ''; } catch (e) { state.stamp = ''; } }
    card.querySelector('#bill-stamp-prev').innerHTML = state.stamp ? `<img src="${state.stamp}" alt="Étampe" style="max-width:180px;max-height:90px">` : '<span class="muted">(aucune étampe)</span>';
    card.querySelector('#bill-stamp-del').style.display = state.stamp ? '' : 'none';
  }
  showStamp();
  card.querySelector('#bill-stamp-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try { await api('PUT', '/api/stamp', { dataUrl: r.result }); state.stamp = r.result; showStamp(); toast('Étampe enregistrée'); }
      catch (err) { toast('Erreur : ' + friendlyError(err), true); }
    };
    r.readAsDataURL(f);
  });
  card.querySelector('#bill-stamp-del').addEventListener('click', async () => {
    await api('PUT', '/api/stamp', { dataUrl: '' }); state.stamp = ''; showStamp();
  });

  card.querySelector('#bill-save').addEventListener('click', async (ev) => {
    const rate = id => parseFloat(String(card.querySelector(id).value).replace(',', '.')) || 0;
    const nb = Object.assign({}, state.billing, {
      currency: card.querySelector('#bill-currency').value.trim() || 'CAD',
      footer: card.querySelector('#bill-footer').value,
      taxes: {
        tps: { label: card.querySelector('#bill-tps-l').value || 'T.P.S.', rate: rate('#bill-tps-r') },
        tvq: { label: card.querySelector('#bill-tvq-l').value || 'T.V.Q.', rate: rate('#bill-tvq-r') }
      },
      priceLists: lists.map(l => ({ centerId: l.centerId || '', typeCode: l.typeCode || '', groups: (l.groups || []).filter(g => g.label) }))
    });
    await withBusy(ev.currentTarget, async () => {
      try { await api('PUT', '/api/billing', nb); state.billing = nb; toast('Facturation enregistrée'); }
      catch (e) { card.querySelector('#bill-error').textContent = friendlyError(e); }
    });
  });
  return card;
}

// Éditeur réutilisable pour une liste de documents (préDocs/postDocs/generalPreDocs/generalPostDocs
// d'un type de cours) : chaque ligne a un libellé et un niveau d'exigence. getValue() ne garde que
// les lignes dont le libellé n'est pas vide, et conserve l'id existant d'un document déjà présent
// (le renommer casserait le rapprochement avec les cases déjà cochées chez des étudiants existants).
function buildDocListEditor(groupLabel, initialDocs) {
  const wrap = el(`<div style="margin-top:10px">
    <div style="font-weight:600;font-size:13px;color:var(--text-light);margin-bottom:4px">${escapeHtml(groupLabel)}</div>
    <div class="doclist-rows"></div>
    <button type="button" class="btn small secondary doclist-add" style="margin-top:6px">+ Ajouter un document</button>
  </div>`);
  const rowsBox = wrap.querySelector('.doclist-rows');
  function addRow(doc) {
    const row = el(`
      <div class="row" style="align-items:center;margin-bottom:4px">
        <div style="flex:2;min-width:220px"><input class="dl-label" placeholder="Libellé du document" value="${escapeHtml((doc && doc.label) || '')}"></div>
        <div style="flex:1;min-width:150px">
          <select class="dl-req">
            <option value="required" ${!doc || !doc.requirement || doc.requirement === 'required' ? 'selected' : ''}>Obligatoire</option>
            <option value="optional" ${doc && doc.requirement === 'optional' ? 'selected' : ''}>Optionnel</option>
            <option value="conditional" ${doc && doc.requirement === 'conditional' ? 'selected' : ''}>Conditionnel (selon l'étudiant)</option>
          </select>
        </div>
        <div style="flex:0"><button type="button" class="btn small danger dl-remove">✕</button></div>
      </div>
    `);
    row.dataset.id = (doc && doc.id) || '';
    row.querySelector('.dl-remove').addEventListener('click', () => row.remove());
    rowsBox.appendChild(row);
  }
  (initialDocs || []).forEach(addRow);
  wrap.querySelector('.doclist-add').addEventListener('click', () => addRow(null));
  wrap.getValue = function () {
    const out = [];
    rowsBox.querySelectorAll(':scope > div').forEach(row => {
      const labelVal = row.querySelector('.dl-label').value.trim();
      if (!labelVal) return;
      const id = row.dataset.id || slugify(labelVal);
      out.push({ id, label: labelVal, requirement: row.querySelector('.dl-req').value });
    });
    return out;
  };
  return wrap;
}

function buildCourseTypesCard() {
  const card = el(`
    <div class="card">
      <h2>Modèles de cours (types)</h2>
      <p class="muted">Chaque type de cours définit son code, son nom, et les documents à collecter avant/après le cours (pour chaque étudiant, et en général pour le cours).</p>
    </div>
  `);
  const list = el('<div id="ctype-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="ctype-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="ctype-add-btn">+ Nouveau type de cours</button></div>');
  card.appendChild(addRow);

  function renderList() {
    list.innerHTML = '';
    if (!state.courseTypes.length) { list.appendChild(el('<p class="muted">Aucun type de cours défini.</p>')); return; }
    state.courseTypes.forEach(t => {
      const nbDocs = (t.preDocs || []).length + (t.postDocs || []).length + (t.generalPreDocs || []).length + (t.generalPostDocs || []).length;
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <div><strong>${escapeHtml(t.label)}</strong> <span class="muted">(${escapeHtml(t.code)})</span><br><span class="muted">${nbDocs} document(s) suivi(s)</span></div>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(t));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!(await confirmDelete(`Supprimer le type de cours "${t.label}" ? Les cours déjà créés avec ce type conservent leurs données, mais ce type ne sera plus proposé pour un nouveau cours.`))) return;
        const next = state.courseTypes.filter(x => x.code !== t.code);
        try {
          await api('PUT', '/api/course-types', next);
          state.courseTypes = next;
          toast('Type de cours supprimé');
          renderList();
        } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
      });
      list.appendChild(row);
    });
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le type de cours' : 'Nouveau type de cours'}</h3>
      <div class="row">
        <div><label for="ct-code">Code (ex: OWD)</label><input id="ct-code" value="${existing ? escapeHtml(existing.code) : ''}" ${existing ? 'readonly' : ''}></div>
        <div><label for="ct-label">Nom complet</label><input id="ct-label" value="${existing ? escapeHtml(existing.label) : ''}"></div>
      </div>
      <div id="ct-doclists"></div>
      <div class="actions-inline" style="margin-top:12px">
        <button class="btn small" id="ct-save">Enregistrer</button>
        <button class="btn small secondary" id="ct-cancel">Annuler</button>
      </div>
      <p class="muted" id="ct-error"></p>
    `;
    const doclistsBox = formBox.querySelector('#ct-doclists');
    const preEditor = buildDocListEditor('Documents pré-cours (par étudiant)', existing ? existing.preDocs : []);
    const postEditor = buildDocListEditor('Documents post-cours (par étudiant)', existing ? existing.postDocs : []);
    const genPreEditor = buildDocListEditor('Documents généraux pré-cours (une fois par cours)', existing ? existing.generalPreDocs : []);
    const genPostEditor = buildDocListEditor('Documents généraux post-cours (une fois par cours)', existing ? existing.generalPostDocs : []);
    doclistsBox.appendChild(preEditor);
    doclistsBox.appendChild(postEditor);
    doclistsBox.appendChild(genPreEditor);
    doclistsBox.appendChild(genPostEditor);

    formBox.querySelector('#ct-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#ct-save').addEventListener('click', async (ev) => {
      const code = formBox.querySelector('#ct-code').value.trim().toUpperCase();
      const label = formBox.querySelector('#ct-label').value.trim();
      if (!code || !label) { formBox.querySelector('#ct-error').textContent = 'Code et nom sont requis.'; return; }
      if (!existing && state.courseTypes.some(x => x.code === code)) {
        formBox.querySelector('#ct-error').textContent = 'Ce code existe déjà.'; return;
      }
      const data = {
        code, label,
        preDocs: preEditor.getValue(),
        postDocs: postEditor.getValue(),
        generalPreDocs: genPreEditor.getValue(),
        generalPostDocs: genPostEditor.getValue()
      };
      const next = state.courseTypes.slice();
      if (existing) {
        const idx = next.findIndex(x => x.code === existing.code);
        next[idx] = data;
      } else {
        next.push(data);
      }
      await withBusy(ev.currentTarget, async () => {
        try {
          await api('PUT', '/api/course-types', next);
          state.courseTypes = next;
          toast('Type de cours enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#ct-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#ctype-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

function buildSitesCard() {
  const card = el(`
    <div class="card">
      <h2>Sites de plongée</h2>
    </div>
  `);
  const list = el('<div id="site-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="site-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="site-add-btn">+ Nouveau site</button></div>');
  card.appendChild(addRow);

  function renderList() {
    list.innerHTML = '';
    if (!state.sites.length) { list.appendChild(el('<p class="muted">Aucun site enregistré.</p>')); return; }
    state.sites.forEach(s2 => {
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <div><strong>${escapeHtml(s2.name)}</strong>${s2.address ? `<br><span class="muted">${escapeHtml(s2.address)}</span>` : ''}</div>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(s2));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!(await confirmDelete(`Supprimer le site "${s2.name}" ?`))) return;
        const next = state.sites.filter(x => x.id !== s2.id);
        try {
          await api('PUT', '/api/sites', next);
          state.sites = next;
          toast('Site supprimé');
          renderList();
        } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
      });
      list.appendChild(row);
    });
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le site' : 'Nouveau site'}</h3>
      <label for="site-name">Nom du site</label><input id="site-name" value="${existing ? escapeHtml(existing.name) : ''}">
      <label for="site-address">Adresse (optionnel)</label><input id="site-address" value="${existing ? escapeHtml(existing.address || '') : ''}">
      <label for="site-notes">Notes (optionnel)</label><textarea id="site-notes">${existing ? escapeHtml(existing.notes || '') : ''}</textarea>
      <div class="actions-inline">
        <button class="btn small" id="site-save">Enregistrer</button>
        <button class="btn small secondary" id="site-cancel">Annuler</button>
      </div>
      <p class="muted" id="site-error"></p>
    `;
    formBox.querySelector('#site-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#site-save').addEventListener('click', async (ev) => {
      const name = formBox.querySelector('#site-name').value.trim();
      if (!name) { formBox.querySelector('#site-error').textContent = 'Le nom est requis.'; return; }
      const data = {
        name,
        address: formBox.querySelector('#site-address').value.trim(),
        notes: formBox.querySelector('#site-notes').value.trim()
      };
      const next = state.sites.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = { ...existing, ...data };
      } else {
        next.push({ id: 'site-' + Date.now(), ...data });
      }
      await withBusy(ev.currentTarget, async () => {
        try {
          await api('PUT', '/api/sites', next);
          state.sites = next;
          toast('Site enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#site-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#site-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

function buildStudentFieldsCard() {
  const card = el(`
    <div class="card">
      <h2>Champs du profil étudiant</h2>
      <p class="muted">Personnalisez les champs du formulaire étudiant. Gardez toujours un champ "Prénom" (id <code>firstName</code>) et "Nom" (id <code>lastName</code>) : ils servent à nommer le dossier sur le disque.</p>
    </div>
  `);
  const list = el('<div id="sfield-list"></div>');
  card.appendChild(list);
  const formBox = el('<div id="sfield-form"></div>');
  card.appendChild(formBox);
  const addRow = el('<div class="actions-inline" style="margin-top:10px"><button class="btn small" id="sfield-add-btn">+ Nouveau champ</button></div>');
  card.appendChild(addRow);

  const typeLabels = { text: 'Texte', tel: 'Téléphone', email: 'Email', date: 'Date', textarea: 'Texte long', select: 'Liste déroulante' };

  function renderList() {
    list.innerHTML = '';
    if (!state.studentFields.length) { list.appendChild(el('<p class="muted">Aucun champ défini.</p>')); return; }
    state.studentFields.forEach(f => {
      const row = el(`
        <div class="actions-inline" style="justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0; margin-top:0">
          <div><strong>${escapeHtml(f.label)}</strong> <span class="muted">(${escapeHtml(typeLabels[f.type] || f.type)}${f.required ? ', obligatoire' : ''})</span></div>
          <div class="actions-inline">
            <button class="btn small secondary" data-act="edit">Modifier</button>
            <button class="btn small danger" data-act="del">Supprimer</button>
          </div>
        </div>
      `);
      row.querySelector('[data-act=edit]').addEventListener('click', () => showForm(f));
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        const warn = (f.id === 'firstName' || f.id === 'lastName')
          ? ` Attention : "${f.label}" sert à nommer le dossier de l'étudiant sur le disque — le supprimer peut empêcher la création de nouveaux étudiants.`
          : '';
        if (!(await confirmDelete(`Supprimer le champ "${f.label}" ?${warn}`))) return;
        const next = state.studentFields.filter(x => x.id !== f.id);
        try {
          await api('PUT', '/api/student-fields', next);
          state.studentFields = next;
          toast('Champ supprimé');
          renderList();
        } catch (e) { toast('Erreur : ' + friendlyError(e), true); }
      });
      list.appendChild(row);
    });
  }

  function buildOptionsEditor(initialOptions) {
    const wrap = el(`<div style="margin-top:8px">
      <label style="margin-bottom:2px">Options de la liste</label>
      <div class="sf-opt-rows"></div>
      <button type="button" class="btn small secondary sf-opt-add" style="margin-top:4px">+ Ajouter une option</button>
    </div>`);
    const rowsBox = wrap.querySelector('.sf-opt-rows');
    function addRow(opt) {
      const row = el(`
        <div class="row" style="align-items:center;margin-bottom:4px">
          <div style="flex:1;min-width:120px"><input class="sfo-value" placeholder="valeur (ex: cours)" value="${escapeHtml((opt && opt.value) || '')}"></div>
          <div style="flex:1;min-width:120px"><input class="sfo-label" placeholder="libellé affiché" value="${escapeHtml((opt && opt.label) || '')}"></div>
          <div style="flex:0"><button type="button" class="btn small danger sfo-remove">✕</button></div>
        </div>
      `);
      row.querySelector('.sfo-remove').addEventListener('click', () => row.remove());
      rowsBox.appendChild(row);
    }
    (initialOptions || []).forEach(addRow);
    wrap.querySelector('.sf-opt-add').addEventListener('click', () => addRow(null));
    wrap.getValue = function () {
      const out = [];
      rowsBox.querySelectorAll(':scope > div').forEach(row => {
        const value = row.querySelector('.sfo-value').value.trim();
        const label = row.querySelector('.sfo-label').value.trim();
        if (!value || !label) return;
        out.push({ value, label });
      });
      return out;
    };
    return wrap;
  }

  function showForm(existing) {
    formBox.innerHTML = `
      <h3 style="margin-top:16px">${existing ? 'Modifier le champ' : 'Nouveau champ'}</h3>
      <div class="row">
        <div><label for="sff-label">Libellé affiché</label><input id="sff-label" value="${existing ? escapeHtml(existing.label) : ''}"></div>
        <div><label for="sff-type">Type</label>
          <select id="sff-type">
            ${Object.keys(typeLabels).map(t => `<option value="${t}" ${existing && existing.type === t ? 'selected' : ''}>${typeLabels[t]}</option>`).join('')}
          </select>
        </div>
      </div>
      <label class="checklist-item" style="margin-top:10px"><input type="checkbox" id="sff-required" ${existing && existing.required ? 'checked' : ''}> Champ obligatoire</label>
      <div id="sff-options-container"></div>
      <div class="actions-inline" style="margin-top:12px">
        <button class="btn small" id="sff-save">Enregistrer</button>
        <button class="btn small secondary" id="sff-cancel">Annuler</button>
      </div>
      <p class="muted" id="sff-error"></p>
    `;
    const optsContainer = formBox.querySelector('#sff-options-container');
    let optionsEditor = null;
    function syncOptionsEditor() {
      optsContainer.innerHTML = '';
      if (formBox.querySelector('#sff-type').value === 'select') {
        optionsEditor = buildOptionsEditor(existing ? existing.options : []);
        optsContainer.appendChild(optionsEditor);
      } else {
        optionsEditor = null;
      }
    }
    syncOptionsEditor();
    formBox.querySelector('#sff-type').addEventListener('change', syncOptionsEditor);

    formBox.querySelector('#sff-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#sff-save').addEventListener('click', async (ev) => {
      const label = formBox.querySelector('#sff-label').value.trim();
      const type = formBox.querySelector('#sff-type').value;
      const required = formBox.querySelector('#sff-required').checked;
      if (!label) { formBox.querySelector('#sff-error').textContent = 'Le libellé est requis.'; return; }
      const id = existing ? existing.id : slugify(label);
      if (!existing && state.studentFields.some(x => x.id === id)) {
        formBox.querySelector('#sff-error').textContent = 'Un champ équivalent existe déjà ; choisissez un libellé différent.';
        return;
      }
      const data = { id, label, type, required };
      if (type === 'select') data.options = optionsEditor ? optionsEditor.getValue() : [];
      const next = state.studentFields.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = data;
      } else {
        next.push(data);
      }
      await withBusy(ev.currentTarget, async () => {
        try {
          await api('PUT', '/api/student-fields', next);
          state.studentFields = next;
          toast('Champ enregistré');
          formBox.innerHTML = '';
          renderList();
        } catch (e) {
          formBox.querySelector('#sff-error').textContent = friendlyError(e);
        }
      });
    });
  }

  addRow.querySelector('#sfield-add-btn').addEventListener('click', () => showForm(null));
  renderList();
  return card;
}

// ---------- Paramètres : emplacements & corbeille ----------
async function renderLocationsCard() {
  const card = document.getElementById('locations-card');
  if (!card) return;
  let info;
  try { info = await api('GET', '/api/app-info'); }
  catch (e) { card.innerHTML = `<h2>Emplacements</h2><p class="muted">${escapeHtml(friendlyError(e))}</p>`; return; }
  const line = (label, value, help) => `<tr><td style="white-space:nowrap;vertical-align:top"><strong>${label}</strong></td><td><code style="word-break:break-all">${escapeHtml(value || '—')}</code>${help ? `<br><span class="muted">${help}</span>` : ''}</td></tr>`;
  card.innerHTML = `
    <h2>Emplacements</h2>
    <table><tbody>
      ${line('Application', info.installDir, `Version ${escapeHtml(info.version || APP_VERSION)}. C'est ce dossier que vous remplacez lors d'une mise à jour.`)}
      ${line('Réglages', info.configDir, info.rootDir ? 'Centres, tarifs, modèles d\'email, types de cours, étampe. Rangés avec vos cours : une mise à jour ne les touche plus.' : 'Provisoire : ils seront rangés dans le répertoire racine dès qu\'il sera choisi.')}
      ${line('Corbeille', info.trashDir, '')}
      ${info.archiveDir ? line('Archives', info.archiveDir, 'Zips des anciens cours archivés.') : ''}
      ${line('Chemin de la racine', info.localFile, 'Propre à cet ordinateur.')}
      ${info.logFile ? line('Journal', info.logFile, 'Messages de démarrage et erreurs. Archivé automatiquement au-delà de 1 Mo.') : ''}
    </tbody></table>
    <details style="margin-top:10px">
      <summary style="cursor:pointer">Importer les réglages d'une ancienne installation</summary>
      <p class="muted" style="margin-top:8px">À utiliser si vos centres, tarifs ou modèles ont disparu après une mise à jour : indiquez l'ancien dossier de l'application (ou son sous-dossier <code>data</code>). Les réglages actuels sont mis de côté avant d'être remplacés.</p>
      <label for="imp-dir">Chemin de l'ancien dossier</label>
      <input id="imp-dir" placeholder="ex. : C:\\Users\\vous\\Documents\\scubapilot-ancien">
      <div class="actions-inline"><button class="btn secondary small" id="imp-btn">Importer ces réglages</button></div>
      <p class="muted" id="imp-status"></p>
    </details>
  `;
  card.querySelector('#imp-btn').addEventListener('click', async () => {
    const dir = card.querySelector('#imp-dir').value.trim();
    const status = card.querySelector('#imp-status');
    if (!dir) { status.textContent = 'Indiquez un chemin.'; return; }
    const ok = await showConfirmModal({
      title: 'Importer ces réglages ?',
      message: `Les réglages actuels (centres, tarifs, modèles d'email, types de cours...) seront <strong>remplacés</strong> par ceux du dossier <strong>${escapeHtml(dir)}</strong>. Une copie des réglages actuels est conservée dans le dossier des réglages.`,
      confirmText: 'Importer'
    });
    if (!ok) return;
    try {
      const r = await api('POST', '/api/config/import', { dir });
      toast(`Réglages importés (${r.imported.length} fichier(s))`);
      await loadRefs(true);
      route();
    } catch (e) { status.textContent = '❌ ' + friendlyError(e); }
  });
}
// Carte « Archivage » : durée de conservation, cours qui l'ont dépassée, archives déjà faites.
async function renderArchiveCard() {
  const card = document.getElementById('archive-card');
  if (!card) return;
  let courses, arch;
  try { [courses, arch] = await Promise.all([api('GET', '/api/courses'), api('GET', '/api/archives')]); }
  catch (e) { card.innerHTML = `<h2>Archivage des anciens cours</h2><p class="muted">${escapeHtml(friendlyError(e))}</p>`; return; }
  const years = retentionYears();
  const list = archiveCandidates(courses, years);
  const oldest = courses.filter(c => !c.corrupted).map(c => courseDates(c).last).filter(Boolean).sort()[0];
  card.innerHTML = `
    <h2>Archivage des anciens cours</h2>
    <p class="muted">Rien n'est jamais archivé ni supprimé automatiquement. ScubaPilot vous signale seulement les cours dont la dernière séance dépasse la durée de conservation ; c'est vous qui décidez, cours par cours.</p>
    <div class="row" style="align-items:flex-end">
      <div style="flex:0 0 260px"><label for="arch-years">Durée de conservation (années, ${RETENTION_MIN_YEARS} au minimum)</label>
        <input id="arch-years" type="number" min="${RETENTION_MIN_YEARS}" max="50" step="1" value="${years}"></div>
      <div style="flex:0 0 auto;min-width:0"><button class="btn small secondary" id="arch-save-years">Enregistrer</button></div>
    </div>
    ${list.length ? `
      <h3 style="margin-top:18px">${list.length} cours de plus de ${years} ans</h3>
      <table>
        <thead><tr><th style="width:36px"><input type="checkbox" id="arch-all" aria-label="Tout sélectionner"></th><th>Dernière séance</th><th>Cours</th><th>Centre</th><th>Étudiants</th><th>Facture</th></tr></thead>
        <tbody>${list.map(c => `
          <tr>
            <td><input type="checkbox" class="arch-pick" value="${escapeHtml(c.id)}" aria-label="Sélectionner ${escapeHtml(c.id)}"></td>
            <td>${escapeHtml(shortDate(courseDates(c).last))}</td>
            <td><a href="#/course/${encodeURIComponent(c.id)}">${escapeHtml(courseTypeLabel(c.typeCode))}</a><br><span class="muted">${escapeHtml(c.id)}</span></td>
            <td>${escapeHtml(centerLabel(c.centerId))}</td>
            <td>${(c.stats && c.stats.studentCount) || 0}</td>
            <td>${invoiceBadgeHtml(c, true)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="actions-inline">
        <button class="btn small" id="arch-zip" disabled>🗄️ Archiver la sélection</button>
        <button class="btn danger small" id="arch-delete" disabled>Supprimer la sélection</button>
      </div>
      <p class="muted"><strong>Archiver</strong> : le dossier complet du cours est enregistré dans un fichier zip (dossier <code>_Archives</code>), puis retiré des listes. <strong>Supprimer</strong> : le cours est retiré sans zip. Dans les deux cas, le dossier d'origine passe par la corbeille : il n'est détruit pour de bon que lorsque vous la videz.</p>
      <p class="form-error" id="arch-error" role="alert"></p>
    ` : `<p style="margin-top:14px">Aucun cours n'a plus de ${years} ans${oldest ? ` (le plus ancien s'est terminé le ${escapeHtml(shortDate(oldest))})` : ''}.</p>`}
    ${arch.archives.length ? `
      <h3 style="margin-top:18px">Archives (${arch.archives.length})</h3>
      <ul class="plain-list">${arch.archives.map(a => `<li><code>${escapeHtml(a.name)}</code> <span class="muted">— ${fmtBytes(a.bytes)}, archivé le ${escapeHtml(a.archivedAt ? shortDate(a.archivedAt.slice(0, 10)) : '')}</span></li>`).join('')}</ul>
      <div class="actions-inline"><button class="btn small secondary" id="arch-open">Ouvrir le dossier des archives</button></div>
      <p class="muted">Pour consulter un cours archivé, ouvrez son zip. Pour le remettre dans ScubaPilot, extrayez le zip dans le répertoire racine : le dossier du cours y est recréé.</p>
    ` : ''}
  `;
  card.querySelector('#arch-save-years').addEventListener('click', async () => {
    const n = Math.round(Number(card.querySelector('#arch-years').value));
    if (!Number.isFinite(n) || n < RETENTION_MIN_YEARS) { toast(`La durée de conservation est d'au moins ${RETENTION_MIN_YEARS} ans`, true); card.querySelector('#arch-years').value = years; return; }
    const previous = state.settings.retentionYears;
    state.settings.retentionYears = n;
    try { await api('PUT', '/api/settings', state.settings); toast(`Durée de conservation : ${n} ans`); renderArchiveCard(); }
    catch (e) { state.settings.retentionYears = previous; toast('Erreur : ' + friendlyError(e), true); }
  });
  const openBtn = card.querySelector('#arch-open');
  if (openBtn) openBtn.addEventListener('click', () => openExplorer('_Archives'));
  if (!list.length) return;
  const picks = () => [...card.querySelectorAll('.arch-pick:checked')].map(i => i.value);
  const sync = () => { const n = picks().length; card.querySelector('#arch-zip').disabled = !n; card.querySelector('#arch-delete').disabled = !n; };
  card.querySelectorAll('.arch-pick').forEach(i => i.addEventListener('change', sync));
  card.querySelector('#arch-all').addEventListener('change', e => { card.querySelectorAll('.arch-pick').forEach(i => { i.checked = e.target.checked; }); sync(); });
  const run = async (btn, ids, action, doneWord) => {
    const errEl = card.querySelector('#arch-error'); errEl.textContent = '';
    let ok = 0; const problems = [];
    await withBusy(btn, async () => {
      for (const id of ids) {
        try { await action(id); ok++; }
        catch (e) {
          problems.push(e.message === 'ARCHIVE_INCOMPLETE'
            ? `${id} : ${(e.data.files || []).length} fichier(s) illisible(s) (${(e.data.files || []).slice(0, 3).join(', ')}) — le cours n'a pas été archivé. Vérifiez que ses fichiers sont bien téléchargés sur cet ordinateur.`
            : `${id} : ${friendlyError(e)}`);
        }
      }
    }, 'En cours...');
    if (ok) toast(`${ok} cours ${doneWord}`);
    await renderArchiveCard(); renderTrashCard();
    if (problems.length) { const el2 = document.querySelector('#archive-card #arch-error'); if (el2) el2.innerHTML = problems.map(escapeHtml).join('<br>'); else toast(problems[0], true); }
  };
  card.querySelector('#arch-zip').addEventListener('click', async ev => {
    const ids = picks();
    const ok = await showConfirmModal({ title: `Archiver ${ids.length} cours ?`, neutral: true, confirmText: 'Archiver',
      message: `Chaque cours sélectionné sera enregistré dans un fichier zip (dossier <strong>_Archives</strong> du répertoire racine), puis retiré des listes de ScubaPilot. Le dossier d'origine reste dans la corbeille jusqu'à ce que vous la vidiez.` });
    if (ok) run(ev.target, ids, id => api('POST', `/api/courses/${encodeURIComponent(id)}/archive`), 'archivé(s)');
  });
  card.querySelector('#arch-delete').addEventListener('click', async ev => {
    const ids = picks();
    const ok = await showConfirmModal({ title: `Supprimer ${ids.length} cours ?`, confirmText: 'Supprimer', requireTypeText: 'SUPPRIMER',
      message: `Les <strong>${ids.length}</strong> cours sélectionnés, avec les dossiers et documents de leurs étudiants, seront déplacés dans la <strong>corbeille</strong>, <strong>sans archive zip</strong>. Ils seront détruits pour de bon quand vous viderez la corbeille.` });
    if (ok) run(ev.target, ids, id => api('DELETE', `/api/courses/${encodeURIComponent(id)}`), 'déplacé(s) dans la corbeille');
  });
}
async function renderTrashCard() {
  const card = document.getElementById('trash-card');
  if (!card) return;
  let items;
  try { items = await api('GET', '/api/trash'); }
  catch (e) { card.innerHTML = `<h2>Corbeille</h2><p class="muted">${escapeHtml(friendlyError(e))}</p>`; return; }
  const when = iso => iso ? new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const label = it => it.kind === 'course' ? `Cours <strong>${escapeHtml(it.name)}</strong>${it.archivedAs ? ` <span class="muted">— archivé dans ${escapeHtml(it.archivedAs)}</span>` : ''}`
    : it.kind === 'student' ? `Étudiant <strong>${escapeHtml(it.name)}</strong> <span class="muted">— cours ${escapeHtml(it.courseId)}</span>`
    : `<strong>${escapeHtml(it.name)}</strong>`;
  card.innerHTML = `
    <h2>Corbeille</h2>
    <p class="muted">Les cours et étudiants supprimés sont conservés ici (dossier <code>_Corbeille</code> du répertoire racine), avec tous leurs documents, jusqu'à ce que vous les supprimiez définitivement.</p>
    ${items.length ? `
      <table>
        <thead><tr><th>Élément</th><th>Supprimé le</th><th></th></tr></thead>
        <tbody>${items.map(it => `
          <tr>
            <td>${label(it)}</td>
            <td>${escapeHtml(when(it.deletedAt))}</td>
            <td style="white-space:nowrap;text-align:right">
              ${it.restorable ? `<button class="btn secondary small" data-restore="${escapeHtml(it.tid)}">↩ Restaurer</button>` : ''}
              <button class="btn danger small" data-purge="${escapeHtml(it.tid)}">Supprimer définitivement</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="actions-inline"><button class="btn danger small" id="trash-empty">Vider la corbeille (${items.length})</button></div>
    ` : '<p class="muted"><em>La corbeille est vide.</em></p>'}
  `;
  const byId = Object.fromEntries(items.map(it => [it.tid, it]));
  card.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const r = await api('POST', `/api/trash/${encodeURIComponent(btn.dataset.restore)}/restore`);
      toast(r.kind === 'course' ? 'Cours restauré' : 'Étudiant restauré dans son cours');
      renderTrashCard();
    } catch (e) { toast('Restauration impossible : ' + friendlyError(e), true); }
  }));
  card.querySelectorAll('[data-purge]').forEach(btn => btn.addEventListener('click', async () => {
    const it = byId[btn.dataset.purge];
    if (!(await confirmDelete(`Supprimer définitivement « ${it.name} » et tous ses documents ? Cette fois, c'est irréversible.`, { title: 'Suppression définitive', confirmText: 'Supprimer définitivement' }))) return;
    try { await api('DELETE', '/api/trash/' + encodeURIComponent(it.tid)); toast('Supprimé définitivement'); renderTrashCard(); }
    catch (e) { toast('Erreur : ' + friendlyError(e), true); }
  }));
  const emptyBtn = card.querySelector('#trash-empty');
  if (emptyBtn) emptyBtn.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Vider la corbeille ?',
      message: `Les <strong>${items.length}</strong> élément(s) de la corbeille et tous leurs documents seront supprimés <strong>définitivement</strong>. Cette action est irréversible.`,
      confirmText: 'Vider la corbeille', requireTypeText: 'VIDER'
    });
    if (!ok) return;
    try { await api('DELETE', '/api/trash'); toast('Corbeille vidée'); renderTrashCard(); }
    catch (e) { toast('Erreur : ' + friendlyError(e), true); }
  });
}

function lastBackupHtml(lb) {
  if (!lb || !lb.at) return `<span class="badge warn">Aucune sauvegarde enregistrée</span> <span class="muted">— un rappel apparaît dans la liste « À faire » tant qu'aucune n'est faite, puis tous les ${BACKUP_REMINDER_DAYS} jours.</span>`;
  const days = daysBetween(localIsoDate(lb.at), todayISO());
  return `<span class="badge ${days > BACKUP_REMINDER_DAYS ? 'warn' : 'ok'}">Dernière sauvegarde : ${escapeHtml(shortDate(localIsoDate(lb.at)))}${days > 0 ? ` (il y a ${days} jour${days > 1 ? 's' : ''})` : " (aujourd'hui)"}</span> <span class="muted">${escapeHtml(lb.filename || '')}${lb.bytes ? ', ' + fmtBytes(lb.bytes) : ''}</span>`;
}
// Relit la date de dernière sauvegarde (notée par le programme quand le zip a été téléchargé).
async function refreshLastBackup() {
  try { const fresh = await api('GET', '/api/settings'); state.settings.lastBackup = fresh.lastBackup; } catch (e) {}
  const p = document.getElementById('s-backup-last');
  if (p) p.innerHTML = lastBackupHtml(state.settings.lastBackup);
}
function renderSettings() {
  const app = document.getElementById('app');
  const s = state.settings;
  app.innerHTML = `
    <h1>Paramètres</h1>
    <div class="card">
      <div style="display:flex; align-items:center; gap:14px">
        <img src="logo.svg" alt="" style="width:48px; height:48px; flex-shrink:0">
        <div>
          <h2 style="margin-bottom:2px">À propos</h2>
          <p class="muted" style="margin:0">
            <strong>${escapeHtml(APP_NAME)}</strong> — version ${escapeHtml(APP_VERSION)} (${escapeHtml(APP_RELEASE)})
            ${s.instructorName && s.instructorName !== 'Votre nom' ? `<br>Configuré pour : ${escapeHtml(s.instructorName)}${s.instructorPadi ? ' — ' + escapeHtml(s.instructorPadi) : ''}` : ''}
          </p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Répertoire racine</h2>
      <p class="muted">Structure : racine → TYPE_DATE (ex: OWD_20SEP2026) → Prénom NOM → documents</p>
      <label for="s-root">Chemin du répertoire (ex: D:\\Plongee\\Instructeur)</label>
      <input id="s-root" value="${escapeHtml(s.rootDir || '')}">
      <div class="actions-inline">
        <button class="btn secondary small" id="s-check">Vérifier</button>
        <button class="btn secondary small" id="s-create">Créer si absent</button>
        <button class="btn small" id="s-save-root">Enregistrer</button>
      </div>
      <p class="muted" id="s-root-status"></p>
    </div>

    <div class="card" id="locations-card">
      <h2>Emplacements</h2>
      <p class="muted">Chargement...</p>
    </div>

    <div class="card">
      <h2>Sauvegarde</h2>
      <p class="muted">Crée une copie .zip de tout le répertoire racine : tous les cours, étudiants et documents, <strong>vos réglages</strong> (dossier <code>_ScubaPilot</code>) et la corbeille. Vous choisissez où l'enregistrer (clé USB, autre disque...). Nom du fichier : <code>PLONGEE_BACKUP_AAAAMMJJ_HHMM.zip</code>.</p>
      <div class="actions-inline">
        <button class="btn small" id="s-backup-btn">💾 Créer une sauvegarde (.zip)</button>
      </div>
      <p id="s-backup-last">${lastBackupHtml(s.lastBackup)}</p>
      <p class="muted" id="s-backup-status"></p>
    </div>

    <div class="card" id="archive-card">
      <h2>Archivage des anciens cours</h2>
      <p class="muted">Chargement...</p>
    </div>

    <div class="card" id="trash-card">
      <h2>Corbeille</h2>
      <p class="muted">Chargement...</p>
    </div>

    <div class="card">
      <h2>Vos coordonnées (pour les emails)</h2>
      <label for="s-instructor">Votre nom (signature des emails)</label>
      <input id="s-instructor" value="${escapeHtml(s.instructorName || '')}">
      <label for="s-instructor-padi">Statut / numéro PADI (ex: "Instructeur PADI #123456")</label>
      <input id="s-instructor-padi" value="${escapeHtml(s.instructorPadi || '')}" placeholder="Instructeur PADI #123456">
      <label for="s-instructor-address">Votre adresse (en-tête des factures)</label>
      <input id="s-instructor-address" value="${escapeHtml(s.instructorAddress || '')}">
      <div class="row">
        <div><label for="s-instructor-email">Votre email (destinataire "À" de l'email groupé)</label><input id="s-instructor-email" type="email" value="${escapeHtml(s.instructorEmail || '')}"></div>
        <div><label for="s-instructor-phone">Votre téléphone</label><input id="s-instructor-phone" type="tel" value="${escapeHtml(s.instructorPhone || '')}"></div>
      </div>
      <label for="s-default-cc">CC par défaut pour l'email groupé (ex: centre partenaire, séparés par des virgules)</label>
      <input id="s-default-cc" value="${escapeHtml(s.defaultCc || '')}">
      <label for="s-default-bcc">CCI (BCC) par défaut pour l'email groupé (séparés par des virgules)</label>
      <input id="s-default-bcc" value="${escapeHtml(s.defaultBcc || '')}">
      <div class="actions-inline"><button class="btn small" id="s-save-instructor">Enregistrer</button></div>
    </div>

    <div id="centers-card-container"></div>

    <div id="billing-card-container"></div>

    <div id="buddies-card-container"></div>

    <div id="templates-card-container"></div>

    <div id="course-types-card-container"></div>

    <div id="sites-card-container"></div>

    <div id="student-fields-card-container"></div>
  `;

  document.getElementById('s-check').addEventListener('click', async () => {
    const dir = document.getElementById('s-root').value;
    const r = await api('POST', '/api/settings/check-dir', { dir });
    document.getElementById('s-root-status').textContent = r.exists ? '✅ Le répertoire existe.' : '❌ Le répertoire n\'existe pas.';
  });
  document.getElementById('s-create').addEventListener('click', async () => {
    const dir = document.getElementById('s-root').value;
    await api('POST', '/api/settings/create-dir', { dir });
    document.getElementById('s-root-status').textContent = '✅ Répertoire créé (ou déjà existant).';
  });
  document.getElementById('s-save-root').addEventListener('click', async () => {
    const previous = s.rootDir;
    const status = document.getElementById('s-root-status');
    s.rootDir = document.getElementById('s-root').value.trim();
    try {
      const r = await api('PUT', '/api/settings', s);
      toast(r.adopted ? 'Répertoire racine enregistré — les réglages déjà présents dans ce dossier sont utilisés' : 'Répertoire racine enregistré');
      await loadRefs(true); // les réglages viennent de la racine : on les relit
      route();
    } catch (e) {
      s.rootDir = previous;
      status.textContent = e.message === 'ROOT_NOT_FOUND' ? "❌ Ce dossier n'existe pas. Cliquez d'abord sur « Créer si absent »." : '❌ ' + friendlyError(e);
    }
  });
  renderLocationsCard();
  renderArchiveCard();
  renderTrashCard();
  document.getElementById('s-backup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('s-backup-btn');
    const statusEl = document.getElementById('s-backup-status');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Création de la sauvegarde en cours...';
    statusEl.textContent = '';
    try {
      // 1) Lancer la création du zip (tâche de fond côté programme), 2) suivre l'avancement,
      // 3) laisser le navigateur télécharger le fichier directement sur le disque.
      let job = await api('POST', '/api/backup');
      while (job.state === 'running') {
        const pct = job.bytesTotal ? Math.round(job.bytesDone / job.bytesTotal * 100) : 0;
        statusEl.textContent = `⏳ ${job.filesDone} / ${job.filesTotal} fichiers — ${fmtBytes(job.bytesDone)} sur ${fmtBytes(job.bytesTotal)} (${pct} %)`;
        await new Promise(r => setTimeout(r, 700));
        job = await api('GET', '/api/backup/status');
      }
      if (job.state !== 'done') throw Object.assign(new Error('BACKUP_FAILED'), { data: { details: job.error } });
      const a = document.createElement('a');
      a.href = '/api/backup/download/' + encodeURIComponent(job.id);
      a.download = job.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(refreshLastBackup, 2500); setTimeout(refreshLastBackup, 10000);
      const skipped = job.skipped || [];
      statusEl.innerHTML = `✅ Sauvegarde créée : <strong>${escapeHtml(job.filename)}</strong> (${fmtBytes(job.zipBytes)}, ${job.filesTotal - skipped.length} fichiers). Le téléchargement démarre dans votre navigateur.` +
        (skipped.length ? `<br><span style="color:var(--red)">⚠ ${skipped.length} fichier(s) n'ont pas pu être lus et ne sont PAS dans la sauvegarde :</span><br>${skipped.slice(0, 20).map(s => escapeHtml(s.file)).join('<br>')}${skipped.length > 20 ? '<br>…' : ''}` : '');
      toast(skipped.length ? `Sauvegarde créée, mais ${skipped.length} fichier(s) illisible(s)` : 'Sauvegarde créée : ' + job.filename, !!skipped.length);
    } catch (e) {
      const messages = {
        ROOT_NOT_SET: 'Aucun répertoire racine défini.',
        ROOT_EMPTY: 'Le répertoire racine est vide — rien à sauvegarder.',
        BACKUP_FAILED: 'Échec de la création du zip : ' + ((e.data && e.data.details) || '')
      };
      statusEl.textContent = '❌ ' + (messages[e.message] || friendlyError(e));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
  document.getElementById('s-save-instructor').addEventListener('click', async () => {
    s.instructorName = document.getElementById('s-instructor').value;
    s.instructorPadi = document.getElementById('s-instructor-padi').value;
    s.instructorAddress = document.getElementById('s-instructor-address').value;
    s.instructorEmail = document.getElementById('s-instructor-email').value;
    s.instructorPhone = document.getElementById('s-instructor-phone').value;
    s.defaultCc = document.getElementById('s-default-cc').value;
    s.defaultBcc = document.getElementById('s-default-bcc').value;
    await api('PUT', '/api/settings', s);
    toast('Coordonnées enregistrées');
  });
  document.getElementById('centers-card-container').appendChild(buildCentersCard());
  document.getElementById('billing-card-container').appendChild(buildBillingCard());
  document.getElementById('buddies-card-container').appendChild(buildBuddiesCard());
  document.getElementById('templates-card-container').appendChild(buildEmailTemplatesCard());
  document.getElementById('course-types-card-container').appendChild(buildCourseTypesCard());
  document.getElementById('sites-card-container').appendChild(buildSitesCard());
  document.getElementById('student-fields-card-container').appendChild(buildStudentFieldsCard());
}
