const APP_NAME = 'ScubaPilot';
const APP_VERSION = '1.3';
const APP_RELEASE = 'Octobre 2026';

const state = { settings: null, courseTypes: [], sites: [], studentFields: [], emailTemplates: [], buddies: [], centers: [], billing: null };

// ---------- Helpers ----------
async function api(method, url, body) {
  const opts = { method, headers: {} };
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
  const el = document.createElement('div');
  el.className = 'toast-msg' + (isError ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3500);
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

// Lit un fichier <input type=file> ou déposé (drag&drop) et renvoie {filename, dataBase64}.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const comma = result.indexOf(',');
      resolve({ filename: file.name, dataBase64: comma > -1 ? result.slice(comma + 1) : result });
    };
    reader.onerror = () => reject(reader.error || new Error('READ_ERROR'));
    reader.readAsDataURL(file);
  });
}

// Construit une zone de glisser-déposer générique qui envoie chaque fichier déposé (ou choisi via
// le sélecteur) à uploadUrl en base64, puis rafraîchit la liste de fichiers affichée sans recharger
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
    for (const f of list) {
      try {
        const { filename, dataBase64 } = await fileToBase64(f);
        const r = await api('POST', uploadUrl, { filename, dataBase64 });
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
function showConfirmModal({ title, message, confirmText, requireTypeText }) {
  return new Promise(resolve => {
    const overlay = el(`
      <div class="modal-overlay">
        <div class="modal-box">
          <h3>${escapeHtml(title)}</h3>
          <p>${message}</p>
          ${requireTypeText ? `<p class="muted">Tapez <strong>${escapeHtml(requireTypeText)}</strong> ci-dessous pour confirmer :</p><input id="confirm-type-input">` : ''}
          <div class="actions-inline" style="margin-top:16px">
            <button class="btn danger" id="confirm-yes-btn" ${requireTypeText ? 'disabled' : ''}>${escapeHtml(confirmText || 'Confirmer la suppression')}</button>
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
    function cleanup(result) { overlay.remove(); resolve(result); }
    yesBtn.addEventListener('click', () => cleanup(true));
    noBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
    });
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
    else if (view === 'new-course') { document.querySelector('[data-route=new-course]').classList.add('active'); renderNewCourse(); }
    else if (view === 'settings') { document.querySelector('[data-route=settings]').classList.add('active'); renderSettings(); }
    else if (view === 'course') { await renderCourseDetail(decodeURIComponent(rest.join('/'))); }
    else if (view === 'student') { await renderStudentProfile(decodeURIComponent(rest.join('/'))); }
    else { renderDashboard(); }
  } catch (e) {
    app.innerHTML = `<div class="card"><p>${escapeHtml(friendlyError(e))}</p></div>`;
  }
}
window.addEventListener('hashchange', route);
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
function courseStatusInfo(c) {
  if (c.completed) return { icon: '✅', label: 'Clos', cls: 'ok' };
  if (c.stats.prePercent < 100 || c.stats.postPercent < 100) return { icon: '⏳', label: 'En attente', cls: 'bad' };
  return { icon: '🔷', label: 'Prêt à clôturer', cls: 'info' };
}

function buildCourseRow(c) {
  const pre = c.stats.prePercent, post = c.stats.postPercent;
  const sessions = c.sessions || [];
  const dateText = sessions.length
    ? (sessions.length === 1 ? humanDate(sessions[0].date) : humanDate(sessions[0].date) + ' → ' + humanDate(sessions[sessions.length - 1].date))
    : '(aucune séance)';
  const siteText = [...new Set(sessions.map(sess => siteLabel(sess.siteId)).filter(Boolean))].join(', ') || '-';
  const status = courseStatusInfo(c);
  const tr = elRow(`
    <tr class="course-row ${c._isPast ? 'course-row-past' : ''}">
      <td><span class="badge ${status.cls}" title="${escapeHtml(status.label)}">${status.icon} ${escapeHtml(status.label)}</span></td>
      <td><strong>${escapeHtml(courseTypeLabel(c.typeCode))}</strong><br><span class="muted">${escapeHtml(c.id)}</span></td>
      <td>${dateText} ${c._isPast ? '<span class="tag-status">Passé</span>' : ''}</td>
      <td>${escapeHtml(siteText)}</td>
      <td>${escapeHtml(centerLabel(c.centerId))}</td>
      <td>${c.stats.studentCount}</td>
      <td><span class="badge ${badgeClass(pre)}">${pre}%</span></td>
      <td><span class="badge ${badgeClass(post)}">${post}%</span></td>
    </tr>
  `);
  tr.addEventListener('click', () => location.hash = '#/course/' + encodeURIComponent(c.id));
  return tr;
}

function buildCourseTable(list) {
  const table = el(`
    <div class="card">
      <table>
        <thead><tr><th>Statut</th><th>Cours</th><th>Dates</th><th>Site</th><th>Centre</th><th>Étudiants</th><th>Pré-cours</th><th>Post-cours</th></tr></thead>
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
  app.innerHTML = `
    <div class="actions-inline" style="justify-content:space-between">
      <h1 style="margin:0">Tableau de bord</h1>
      <button class="btn secondary small" id="summary-btn">📋 Sommaire des activités accomplies</button>
    </div>
  `;
  document.getElementById('summary-btn').addEventListener('click', () => exportActivitySummary(courses));
  if (!courses.length) {
    app.appendChild(el(`<div class="card"><p class="muted">Aucun cours pour l'instant.</p><button class="btn" onclick="location.hash='#/new-course'">+ Créer un cours</button></div>`));
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

  const centerOptions = state.centers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  const typeOptions = state.courseTypes.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.label)}</option>`).join('');
  const filterBar = el(`
    <div class="card">
      <div class="row" style="align-items:flex-end">
        <div style="flex:2;min-width:220px">
          <label for="dash-search">Rechercher (cours, centre, étudiant...)</label>
          <input id="dash-search" placeholder="Tapez pour filtrer...">
        </div>
        <div>
          <label for="dash-filter-center">Centre</label>
          <select id="dash-filter-center"><option value="">Tous les centres</option>${centerOptions}</select>
        </div>
        <div>
          <label for="dash-filter-type">Type de cours</label>
          <select id="dash-filter-type"><option value="">Tous les types</option>${typeOptions}</select>
        </div>
      </div>
      <div class="autocomplete" style="margin-top:10px;max-width:360px">
        <label for="dash-student-search">Ouvrir la fiche globale d'un étudiant (tous ses cours)</label>
        <input id="dash-student-search" placeholder="Tapez un nom d'étudiant...">
        <div class="autocomplete-list" style="display:none"></div>
      </div>
    </div>
  `);
  app.appendChild(filterBar);

  const resultsBox = el('<div></div>');
  app.appendChild(resultsBox);

  function renderResults() {
    const filters = {
      q: filterBar.querySelector('#dash-search').value.trim().toLowerCase(),
      centerId: filterBar.querySelector('#dash-filter-center').value,
      typeCode: filterBar.querySelector('#dash-filter-type').value
    };
    const filtered = courses.filter(c => courseMatchesFilters(c, filters));
    const upcoming = filtered.filter(c => !c._isPast)
      .sort((a, b) => (a._firstDate || '9999-99-99').localeCompare(b._firstDate || '9999-99-99'));
    const past = filtered.filter(c => c._isPast)
      .sort((a, b) => (b._lastDate || '').localeCompare(a._lastDate || ''));

    resultsBox.innerHTML = '';
    if (!filtered.length) {
      resultsBox.appendChild(el('<div class="card"><p class="muted">Aucun cours ne correspond à cette recherche.</p></div>'));
      return;
    }
    if (upcoming.length) {
      resultsBox.appendChild(buildCourseTable(upcoming));
    } else {
      resultsBox.appendChild(el('<div class="card"><p class="muted">Aucun cours à venir.</p></div>'));
    }
    if (past.length) {
      resultsBox.appendChild(el('<h2 style="margin-top:28px">Cours passés</h2>'));
      resultsBox.appendChild(buildCourseTable(past));
    }
  }

  let debounce;
  filterBar.querySelector('#dash-search').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(renderResults, 150);
  });
  filterBar.querySelector('#dash-filter-center').addEventListener('change', renderResults);
  filterBar.querySelector('#dash-filter-type').addEventListener('change', renderResults);

  const studentSearchInput = filterBar.querySelector('#dash-student-search');
  const studentListBox = filterBar.querySelector('.autocomplete-list');
  let studentDebounce;
  studentSearchInput.addEventListener('input', () => {
    clearTimeout(studentDebounce);
    const q = studentSearchInput.value.trim();
    if (!q) { studentListBox.style.display = 'none'; return; }
    studentDebounce = setTimeout(async () => {
      const results = await api('GET', '/api/global-students?q=' + encodeURIComponent(q));
      // Un même étudiant peut apparaître dans plusieurs cours : on ne garde qu'une entrée par nom.
      const seen = new Set();
      const unique = results.filter(r => {
        const k = studentKey(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!unique.length) { studentListBox.style.display = 'none'; return; }
      studentListBox.innerHTML = '';
      unique.slice(0, 8).forEach(r => {
        const item = el(`<div>${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</div>`);
        item.addEventListener('click', () => { location.hash = '#/student/' + encodeURIComponent(studentKey(r)); });
        studentListBox.appendChild(item);
      });
      studentListBox.style.display = 'block';
    }, 250);
  });

  renderResults();
}

// ---------- Sommaire global des activités accomplies (tous cours confondus) ----------
function exportActivitySummary(courses) {
  const rows = courses.slice().sort((a, b) => {
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
        <div><label for="f-type">Type de cours (modèle)</label><select id="f-type">${typeOptions}</select></div>
        <div><label for="f-center">Centre mandataire *</label><select id="f-center">${centerOptions}</select></div>
        <div><label for="f-template">Modèle d'email associé</label><select id="f-template">${tplOptions}</select></div>
      </div>
      <label for="f-instructors" style="margin-top:16px">Instructeurs/coéquipiers de ce cours (optionnel, maintenez Ctrl/Cmd pour en choisir plusieurs)</label>
      <select id="f-instructors" multiple size="4">
        ${state.buddies.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(buddyLabel(b))}</option>`).join('')}
      </select>
      ${!state.buddies.length ? '<p class="muted">Aucun coéquipier enregistré — ajoutez-en dans Paramètres pour pouvoir, plus tard, désigner qui a certifié chaque étudiant.</p>' : ''}
      <h3 style="margin-top:16px">Première séance</h3>
      <div class="row">
        <div><label for="f-date">Date</label>${plainDateInputHtml('f-date', '', 'f-date')}</div>
        <div><label for="f-time-start">Heure de début</label>${timeInputHtml("", "", "f-time-start")}</div>
        <div><label for="f-time-end">Heure de fin</label>${timeInputHtml("", "", "f-time-end")}</div>
        <div><label for="f-site">Lieu</label><select id="f-site">${siteOptions}</select></div>
      </div>
      <p class="muted">Vous pourrez ajouter d'autres séances (dates/heures/lieux) et changer le modèle d'email après la création du cours.</p>
      <label for="f-notes">Notes</label>
      <textarea id="f-notes" placeholder="Notes libres sur ce cours..."></textarea>
      <div class="actions-inline">
        <button class="btn" id="f-submit">Créer le cours</button>
      </div>
      <p class="muted" id="f-error"></p>
    </div>
  `;
  attachPlainDateAutoFormat(app);
  document.getElementById('f-submit').addEventListener('click', async () => {
    const typeCode = document.getElementById('f-type').value;
    const centerId = document.getElementById('f-center').value;
    const date = displayToIsoDate(app.querySelector('.f-date').value);
    const timeStart = document.getElementById('f-time-start').value;
    const timeEnd = document.getElementById('f-time-end').value;
    const siteId = document.getElementById('f-site').value;
    const notes = document.getElementById('f-notes').value;
    const emailTemplateId = document.getElementById('f-template').value;
    const instructorIds = Array.from(document.getElementById('f-instructors').selectedOptions).map(o => o.value);
    if (!typeCode || !date) { document.getElementById('f-error').textContent = 'Type et date requises (JJ/MM/AAAA).'; return; }
    if (!centerId) { document.getElementById('f-error').textContent = 'Le centre mandataire est obligatoire.'; return; }
    await withBusy(document.getElementById('f-submit'), async () => {
      try {
        const c = await api('POST', '/api/courses', { typeCode, notes, emailTemplateId, centerId, instructorIds, session: { date, timeStart, timeEnd, siteId } });
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
  const card = el(`<div class="card"><h2>Séances (date / heure / lieu)</h2>${totalDuration ? `<p class="muted">Durée totale du cours : <strong>${totalDuration}</strong> (utile pour la facturation)</p>` : ''}</div>`);
  course.sessions = course.sessions || [];
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
        if (!confirm('Supprimer cette séance ?')) return;
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
    return { student: s, subject: mergeTemplate(tpl.subject, ctx), body: mergeTemplate(tpl.body, ctx) };
  });
  const copyAllBtn = el(`<button class="btn small secondary" style="margin:10px 0 16px">Copier tous les emails (${composed.length})</button>`);
  copyAllBtn.addEventListener('click', () => {
    const all = composed.map(c => `À : ${c.student.email}\nObjet : ${c.subject}\n\n${c.body}`).join('\n\n-----------------------------\n\n');
    navigator.clipboard.writeText(all).then(() => toast('Tous les emails copiés'));
  });
  box.appendChild(copyAllBtn);
  composed.forEach(c => {
    const item = el(`
      <div class="student-block">
        <div class="student-header">
          <div><strong>${escapeHtml(c.student.firstName)} ${escapeHtml(c.student.lastName)}</strong></div>
          <span class="muted">${escapeHtml(c.student.email)}</span>
        </div>
        <div class="student-details open">
          <label>Sujet</label><input class="em-subject" value="${escapeHtml(c.subject)}">
          <label>Message</label><textarea class="em-body" style="min-height:140px">${escapeHtml(c.body)}</textarea>
          <div class="actions-inline">
            <a class="btn small em-mailto" href="#">Ouvrir dans le client mail</a>
            <button class="btn small secondary em-copy">Copier ce message</button>
          </div>
        </div>
      </div>
    `);
    const subjInput = item.querySelector('.em-subject');
    const bodyInput = item.querySelector('.em-body');
    const mailtoLink = item.querySelector('.em-mailto');
    const updateMailto = () => {
      mailtoLink.href = `mailto:${encodeURIComponent(c.student.email)}?subject=${encodeURIComponent(subjInput.value)}&body=${encodeURIComponent(bodyInput.value)}`;
    };
    updateMailto();
    subjInput.addEventListener('input', updateMailto);
    bodyInput.addEventListener('input', updateMailto);
    item.querySelector('.em-copy').addEventListener('click', () => {
      navigator.clipboard.writeText('Objet: ' + subjInput.value + '\n\n' + bodyInput.value).then(() => toast('Message copié'));
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
  const defaultBccList = (state.settings.defaultBcc || '').split(',').map(x => x.trim()).filter(Boolean);
  const buddyIds = new Set();
  (course.sessions || []).forEach(sess => (sess.coequipierIds || []).forEach(id => buddyIds.add(id)));
  const buddyEmails = [...buddyIds].map(id => { const b = state.buddies.find(x => x.id === id); return b && b.email; }).filter(Boolean);
  const bccList = [...new Set([...studentEmails, ...defaultBccList, ...buddyEmails])];
  const ctx = buildGroupEmailContext(course, type);
  const subject = mergeTemplate(tpl.subject, ctx);
  const body = mergeTemplate(tpl.body, ctx);
  const item = el(`
    <div class="student-block">
      <div class="student-header">
        <strong>Email groupé — un seul message pour tout le cours</strong>
      </div>
      <div class="student-details open">
        <p class="muted">Vous en destinataire, CC configurable ci-dessous, étudiants + coéquipiers des séances + BCC par défaut en copie cachée (CCI).</p>
        <div class="row">
          <div><label for="grp-to">À (vous)</label><input id="grp-to" value="${escapeHtml(state.settings.instructorEmail || '')}"></div>
          <div><label for="grp-cc">Cc</label><input id="grp-cc" value="${escapeHtml(state.settings.defaultCc || '')}"></div>
        </div>
        <label for="grp-bcc">Cci — séparés par des virgules</label><input id="grp-bcc" value="${escapeHtml(bccList.join(', '))}">
        <label for="grp-subject">Sujet</label><input id="grp-subject" value="${escapeHtml(subject)}">
        <label for="grp-body">Message</label><textarea id="grp-body" style="min-height:200px">${escapeHtml(body)}</textarea>
        <div class="actions-inline">
          <a class="btn small" id="grp-mailto" href="#">Ouvrir dans le client mail</a>
          <button class="btn small secondary" id="grp-copy">Copier le message</button>
        </div>
        <p class="muted" id="grp-warn"></p>
      </div>
    </div>
  `);
  box.appendChild(item);
  if (!state.settings.instructorEmail) {
    item.querySelector('#grp-warn').textContent = 'Astuce : renseignez votre email dans Paramètres pour préremplir le champ "À" automatiquement.';
  }
  const toI = item.querySelector('#grp-to'), ccI = item.querySelector('#grp-cc'), bccI = item.querySelector('#grp-bcc');
  const subjI = item.querySelector('#grp-subject'), bodyI = item.querySelector('#grp-body');
  const mailtoLink = item.querySelector('#grp-mailto');
  const updateMailto = () => {
    let href = `mailto:${encodeURIComponent(toI.value)}?subject=${encodeURIComponent(subjI.value)}&body=${encodeURIComponent(bodyI.value)}`;
    if (ccI.value) href += `&cc=${encodeURIComponent(ccI.value)}`;
    if (bccI.value) href += `&bcc=${encodeURIComponent(bccI.value)}`;
    mailtoLink.href = href;
  };
  updateMailto();
  [toI, ccI, bccI, subjI, bodyI].forEach(i => i.addEventListener('input', updateMailto));
  item.querySelector('#grp-copy').addEventListener('click', () => {
    const text = `À : ${toI.value}\nCc : ${ccI.value}\nCci : ${bccI.value}\nObjet : ${subjI.value}\n\n${bodyI.value}`;
    navigator.clipboard.writeText(text).then(() => toast('Message copié'));
  });
}

function buildCommunicationsCard(course, type) {
  const card = el(`<div class="card"><h2>Communications</h2></div>`);
  const emails = course.students.map(s => s.email).filter(Boolean);
  card.appendChild(el(`<p class="muted">${emails.length} étudiant(s) avec une adresse email sur ${course.students.length}.</p>`));

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
      <button class="btn small secondary" id="copy-emails-btn">Copier la liste des emails</button>
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
    navigator.clipboard.writeText(emails.join(', ')).then(() => toast('Adresses copiées'));
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
    extras: [], groupsEdited: false
  };
}
function computeInvoice(course, inv) {
  const students = course.students || [];
  const lines = inv.groups.map(g => {
    const members = students.filter(s => inv.assign[s.folder] === g.id);
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
  const taxRow = (on, t, amt) => `<tr><td>${escapeHtml(t.label)}${on ? ' (' + fmtNum(t.rate) + ' %)' : ''}</td><td class="r">${on ? fmtMoney(amt) : '—'}</td></tr>`;
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
    <div class="inv-totals"><table>
      <tr><td>SOUS-TOTAL</td><td class="r">${fmtMoney(calc.subtotal)}</td></tr>
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
          <h3 style="margin-top:12px">Lignes supplémentaires (frais, rabais…)</h3>
          <div id="inv-extras"></div>
          <button class="btn secondary small" id="inv-addextra">+ Ligne supplémentaire</button>
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
    bind('#inv-number', 'number'); bind('#inv-date', 'date'); bind('#inv-ref', 'ref'); bind('#inv-note', 'note');
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
        window.location.href = `mailto:${encodeURIComponent((c && c.email) || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        toast('Joignez le PDF (Imprimer / PDF) au courriel');
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
          <button class="btn secondary small" id="export-invoice-btn">🧾 Facture</button>
          <button class="btn danger small" id="delete-course-btn">Supprimer le cours</button>
        </div>
        <label class="checklist-item course-completed-toggle-label" style="margin:0">
          <input type="checkbox" id="course-completed-toggle" ${course.completed ? 'checked' : ''}>
          <span id="course-completed-toggle-text">${course.completed ? '✅ Cours complété' : '☐ Marquer le cours comme complété'}</span>
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
      <button class="btn secondary" id="bulk-import-btn">Importer plusieurs étudiants (JSON)</button>
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
  document.getElementById('delete-course-btn').addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Supprimer ce cours ?',
      message: `Cette action supprime <strong>définitivement</strong> le cours <strong>${escapeHtml(course.id)}</strong> et tous les dossiers étudiants associés (documents inclus) de votre disque. Cette action est irréversible.`,
      requireTypeText: course.id
    });
    if (!ok) return;
    await api('DELETE', '/api/courses/' + encodeURIComponent(course.id));
    toast('Cours supprimé');
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
// Il n'existe pas d'identifiant unique d'étudiant dans ce système : chaque cours a son propre
// dossier "Prénom Nom". Cette vue regroupe tous les dossiers correspondant au même nom (clé
// `studentKey`), affiche l'historique de ses cours, et permet de mettre à jour ses coordonnées
// sur tous ces dossiers en une seule action plutôt que cours par cours.
async function renderStudentProfile(key) {
  const app = document.getElementById('app');
  app.innerHTML = '<p class="muted">Chargement...</p>';

  const candidates = await api('GET', '/api/global-students?q=' + encodeURIComponent(key));
  const records = candidates.filter(r => studentKey(r) === key);
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
    <div class="actions-inline" style="justify-content:space-between">
      <h1 style="margin:0">${escapeHtml(latest.firstName)} ${escapeHtml(latest.lastName)}</h1>
      <button class="btn secondary small" onclick="location.hash='#/dashboard'">← Retour au tableau de bord</button>
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
        <thead><tr><th>Date</th><th>Type</th><th>Centre</th><th>Pré-cours</th><th>Post-cours</th><th>Certification</th><th>Instructeur certificateur</th></tr></thead>
        <tbody id="profile-history"></tbody>
      </table>
    </div>
  `;

  const fieldsBox = document.getElementById('profile-fields-box');
  state.studentFields.forEach(f => {
    if (f.id === 'firstName' || f.id === 'lastName') return; // déjà dans le titre, non modifiables ici
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
      </tr>
    `);
    if (course) tr.addEventListener('click', () => location.hash = '#/course/' + encodeURIComponent(course.id));
    historyBox.appendChild(tr);
  });

  document.getElementById('profile-save').addEventListener('click', async (ev) => {
    const payload = readFieldValues(state.studentFields.filter(f => f.id !== 'firstName' && f.id !== 'lastName'));
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

// Clé utilisée pour regrouper les dossiers étudiant d'un même nom à travers tous les cours (il n'y a
// pas d'identifiant unique d'étudiant dans ce système, seulement un dossier "Prénom Nom" par cours).
function studentKey(s) {
  return `${s.firstName || ''} ${s.lastName || ''}`.trim().toLowerCase();
}

function renderStudentBlock(course, type, s) {
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
          <a href="#/student/${encodeURIComponent(studentKey(s))}" class="muted" style="font-size:12px;text-decoration:underline" data-act="profile-link" title="Voir tous les cours de cet étudiant">fiche globale</a>
          <span class="tag-status">${escapeHtml(statusLabel)}</span>
          ${missingInfo.length ? `<span class="badge bad" title="Manque : ${escapeHtml(missingInfo.join(', '))}">⚠ Infos incomplètes</span>` : ''}
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
  header.addEventListener('click', () => {
    if (details.classList.contains('open')) { details.classList.remove('open'); return; }
    details.classList.add('open');
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
  let mailSubject = '', mailBody = '';
  if (tpl) {
    const ctx = buildEmailContext(course, type, s);
    mailSubject = mergeTemplate(tpl.subject, ctx);
    mailBody = mergeTemplate(tpl.body, ctx);
  }
  const mailtoParams = [];
  if (mailSubject) mailtoParams.push('subject=' + encodeURIComponent(mailSubject));
  if (mailBody) mailtoParams.push('body=' + encodeURIComponent(mailBody));
  const mailtoHref = s.email ? `mailto:${encodeURIComponent(s.email)}${mailtoParams.length ? '?' + mailtoParams.join('&') : ''}` : '';

  wrap.innerHTML = `
    <div class="two-col">
      <div>
        <h3>Coordonnées</h3>
        <p class="muted">${buildCoordonneesHtml(s) || '(aucune coordonnée renseignée)'}</p>
        ${studentMissingInfo(s).length ? `<p style="color:var(--red); font-size:13px; margin-top:-4px">⚠ Il manque : ${escapeHtml(studentMissingInfo(s).join(', '))}</p>` : ''}
        <div class="actions-inline">
          <button class="btn small secondary" data-act="edit-info">Modifier les infos</button>
          <button class="btn small secondary" data-act="open-folder">📂 Ouvrir le dossier</button>
          ${s.email ? `<a class="btn small secondary" href="${escapeHtml(mailtoHref)}">✉️ Écrire un email</a>` : ''}
          <button class="btn small danger" data-act="delete-student">Supprimer</button>
        </div>
        ${!s.email ? '<p class="muted" style="margin-top:6px">Renseignez une adresse email pour pouvoir lui écrire directement.</p>' : ''}
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
  wrap.querySelector('[data-act=delete-student]').addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Supprimer cet étudiant ?',
      message: `Cette action supprime <strong>définitivement</strong> le dossier de <strong>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</strong> (et tous ses documents) de ce cours. Cette action est irréversible.`,
      requireTypeText: s.lastName
    });
    if (!ok) return;
    await api('DELETE', `/api/courses/${encodeURIComponent(course.id)}/students/${encodeURIComponent(s.folder)}`);
    toast('Étudiant supprimé');
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
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));
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
  document.getElementById('app').appendChild(box);
  box.scrollIntoView({ behavior: 'smooth' });
  attachDateAutoFormat(box);

  const searchInput = box.querySelector('#as-search');
  const listBox = box.querySelector('.autocomplete-list');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (!q) { listBox.style.display = 'none'; return; }
    debounce = setTimeout(async () => {
      const results = await api('GET', '/api/global-students?q=' + encodeURIComponent(q));
      if (!results.length) { listBox.style.display = 'none'; return; }
      listBox.innerHTML = '';
      results.slice(0, 8).forEach(r => {
        const item = el(`<div>${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)} <span class="muted">(${escapeHtml(r.courseId)})</span></div>`);
        item.addEventListener('click', () => {
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
    await withBusy(ev.currentTarget, async () => {
      try {
        await api('POST', `/api/courses/${encodeURIComponent(course.id)}/students`, payload);
        toast('Étudiant ajouté');
        route();
      } catch (e) {
        box.querySelector('#as-error').textContent = e.data && e.data.error === 'STUDENT_EXISTS'
          ? 'Un dossier existe déjà pour ce prénom/nom dans ce cours.' : friendlyError(e);
      }
    });
  });
}

// Import de plusieurs étudiants à partir d'un JSON collé (ex: généré par Claude à partir d'un roster PDF).
function renderBulkImportForm(course, type) {
  const box = el(`
    <div class="card">
      <h2>Importer plusieurs étudiants</h2>
      <p class="muted">Collez un tableau JSON d'étudiants (un objet par étudiant, avec au minimum firstName et lastName).
      Astuce : donnez votre roster PDF à Claude dans une conversation en lui demandant de générer ce JSON, puis collez-le ici.</p>
      <textarea id="bi-json" style="min-height:180px; font-family:monospace;" placeholder='[
  { "firstName": "Jean", "lastName": "Dupont", "email": "jean@exemple.com", "phoneCell": "514-000-0000" },
  { "firstName": "Marie", "lastName": "Tremblay", "email": "marie@exemple.com" }
]'></textarea>
      <div class="actions-inline">
        <button class="btn small" id="bi-import">Importer</button>
        <button class="btn small secondary" id="bi-cancel">Annuler</button>
      </div>
      <p class="muted" id="bi-error"></p>
      <div id="bi-result"></div>
    </div>
  `);
  document.getElementById('app').appendChild(box);
  box.scrollIntoView({ behavior: 'smooth' });
  box.querySelector('#bi-cancel').addEventListener('click', () => box.remove());
  box.querySelector('#bi-import').addEventListener('click', async (ev) => {
    let list;
    try { list = JSON.parse(box.querySelector('#bi-json').value); }
    catch (e) { box.querySelector('#bi-error').textContent = 'JSON invalide : ' + e.message; return; }
    if (!Array.isArray(list)) { box.querySelector('#bi-error').textContent = 'Le JSON doit être un tableau [ ... ].'; return; }
    await withBusy(ev.currentTarget, async () => {
      try {
        const res = await api('POST', `/api/courses/${encodeURIComponent(course.id)}/students/bulk`, { students: list });
        box.querySelector('#bi-error').textContent = '';
        const resultBox = box.querySelector('#bi-result');
        resultBox.innerHTML = '';
        resultBox.appendChild(el(`<p>${res.created.length} étudiant(s) créé(s)${res.skipped.length ? ', ' + res.skipped.length + ' ignoré(s)' : ''}.</p>`));
        if (res.skipped.length) {
          resultBox.appendChild(el('<p class="muted">Ignorés : ' + res.skipped.map(s2 => escapeHtml(s2.name + ' (' + s2.reason + ')')).join(', ') + '</p>'));
        }
        toast(res.created.length + ' étudiant(s) importé(s)');
        setTimeout(() => route(), 1200);
      } catch (e) {
        box.querySelector('#bi-error').textContent = friendlyError(e);
      }
    }, 'Import en cours...');
  });
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
      <p class="muted">Variables disponibles : {prenom} {nom} {type_cours} {liste_dates_lieux} {liste_dates_lieux_note_coequipier} {date_debut} {date_fin} {lieu} {instructeur} {instructeur_tel} {instructeur_padi} {liste_docs_pre} {liste_docs_manquants}</p>
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
        if (!confirm(`Supprimer le modèle "${t.name}" ?`)) return;
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
      <label for="tpl-body">Message</label><textarea id="tpl-body" style="min-height:160px">${existing ? escapeHtml(existing.body) : ''}</textarea>
      <div class="actions-inline">
        <button class="btn small" id="tpl-save">Enregistrer</button>
        <button class="btn small secondary" id="tpl-cancel">Annuler</button>
      </div>
      <p class="muted" id="tpl-error"></p>
    `;
    formBox.querySelector('#tpl-cancel').addEventListener('click', () => { formBox.innerHTML = ''; });
    formBox.querySelector('#tpl-save').addEventListener('click', async (ev) => {
      const name = formBox.querySelector('#tpl-name').value.trim();
      const subject = formBox.querySelector('#tpl-subject').value;
      const body = formBox.querySelector('#tpl-body').value;
      if (!name) { formBox.querySelector('#tpl-error').textContent = 'Le nom du modèle est requis.'; return; }
      const next = state.emailTemplates.slice();
      if (existing) {
        const idx = next.findIndex(x => x.id === existing.id);
        next[idx] = { ...existing, name, subject, body };
      } else {
        next.push({ id: 'tpl-' + Date.now(), name, subject, body });
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
      <p class="muted">Enregistrez-les une fois ici ; vous pourrez ensuite les ajouter à une séance en un clic avec le "+". Leur email sera automatiquement inclus en copie cachée (CCI) dans l'email groupé du cours.</p>
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
        if (!confirm(`Supprimer "${b.name}" de la liste des coéquipiers ?`)) return;
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
        if (!confirm(`Supprimer le centre "${c.name}" ?`)) return;
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
        if (!confirm(`Supprimer le type de cours "${t.label}" ? Les cours déjà créés avec ce type conservent leurs données, mais ce type ne sera plus proposé pour un nouveau cours.`)) return;
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
        if (!confirm(`Supprimer le site "${s2.name}" ?`)) return;
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
        if (!confirm(`Supprimer le champ "${f.label}" ?${warn}`)) return;
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

    <div class="card">
      <h2>Sauvegarde</h2>
      <p class="muted">Crée une copie .zip de tout le répertoire racine (tous les cours, étudiants et documents) et propose de l'enregistrer où vous voulez (clé USB, cloud, autre disque...). Nom du fichier : <code>PLONGEE_BACKUP_AAAAMMJJ_HHMM.zip</code>.</p>
      <div class="actions-inline">
        <button class="btn small" id="s-backup-btn">💾 Créer une sauvegarde (.zip)</button>
      </div>
      <p class="muted" id="s-backup-status"></p>
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
    s.rootDir = document.getElementById('s-root').value;
    await api('PUT', '/api/settings', s);
    toast('Répertoire racine enregistré');
    route();
  });
  document.getElementById('s-backup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('s-backup-btn');
    const statusEl = document.getElementById('s-backup-status');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Création de la sauvegarde en cours... (peut prendre un moment)';
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/backup', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const messages = {
          ROOT_NOT_SET: 'Aucun répertoire racine défini.',
          ROOT_NOT_FOUND: "Le répertoire racine n'existe pas sur le disque.",
          ROOT_EMPTY: 'Le répertoire racine est vide — rien à sauvegarder.',
          BACKUP_FAILED: 'Échec de la création du zip : ' + (err.details || '')
        };
        statusEl.textContent = '❌ ' + (messages[err.error] || ('Erreur : ' + (err.error || res.statusText)));
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(cd);
      const filename = (match && match[1]) || 'PLONGEE_BACKUP.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      statusEl.textContent = '✅ Sauvegarde téléchargée : ' + filename;
      toast('Sauvegarde créée : ' + filename);
    } catch (e) {
      statusEl.textContent = '❌ Erreur lors de la sauvegarde : ' + friendlyError(e);
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
