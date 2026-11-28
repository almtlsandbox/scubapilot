// Fonctions de calcul de l'interface (public/app.js) : statuts, liste « À faire », factures,
// import d'étudiants, modèles de courriel, calendrier.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadInterface } = require('./charger-interface');

const TODAY = '2026-11-14';
const ui = loadInterface(TODAY);
ui.setState({
  centers: [{ id: 'c1', name: 'Centre Plongée Horizon', email: 'info@exemple.ca' }, { id: 'c2', name: 'Club Aqua Nord' }],
  sites: [{ id: 's1', name: 'Piscine municipale', address: '55 rue du Parc, Laval' }],
  buddies: [{ id: 'b1', name: 'Marie Lavoie', role: 'Instructeur' }],
  courseTypes: [{ code: 'OWD', label: 'Open Water Diver' }],
  billing: { currency: 'CAD', taxes: { tps: { label: 'T.P.S.', rate: 5 }, tvq: { label: 'T.V.Q.', rate: 9.975 } }, priceLists: [] }
});
const stats = (pre, post, students, extra) => ({ prePercent: pre, postPercent: post, students: students || [], generalPreMissing: 0, generalPostMissing: 0, ...(extra || {}) });
const stud = (o) => ({ folder: 'A B', firstName: 'Ana', lastName: 'B', preMissing: 0, postMissing: 0, courseOnly: false, certificationConfirmed: false, fileTransferred: false, hasEmail: true, lastMail: null, ...o });
const course = (o) => ({ id: 'OWD_X', typeCode: 'OWD', centerId: 'c1', sessions: [], students: [], stats: stats(100, 100), ...o });

test('statut d\'un cours selon les dates', async (t) => {
  const st = c => ui.call('courseStatusInfo', course(c));
  await t.test('clos, quoi qu\'il arrive', () => assert.equal(st({ completed: true, sessions: [{ date: '2026-12-01' }], stats: stats(0, 0) }).key, 'closed'));
  await t.test('sans séance : à planifier', () => assert.equal(st({ sessions: [] }).key, 'unplanned'));
  await t.test('à venir, documents incomplets : à préparer (orange au-delà de 7 jours, rouge sinon)', () => {
    const far = st({ sessions: [{ date: '2026-12-05' }], stats: stats(14, 0) });
    assert.equal(far.key, 'prepare'); assert.equal(far.cls, 'warn');
    const near = st({ sessions: [{ date: '2026-11-21' }], stats: stats(56, 0) });
    assert.equal(near.cls, 'bad'); assert.match(near.hint, /dans 7 jours/);
    assert.match(st({ sessions: [{ date: '2026-11-15' }], stats: stats(0, 0) }).hint, /demain/);
  });
  await t.test('à venir, pré-cours complet : prêt, même si le post-cours est à 0 %', () => assert.equal(st({ sessions: [{ date: '2026-12-05' }], stats: stats(100, 0) }).key, 'ready'));
  await t.test('entre la première et la dernière séance : en cours', () => {
    assert.equal(st({ sessions: [{ date: '2026-11-13' }, { date: '2026-11-15' }] }).key, 'running');
    assert.equal(st({ sessions: [{ date: TODAY }] }).key, 'running');
  });
  await t.test('terminé : post-cours à compléter (rouge après 30 jours), ou prêt à clôturer', () => {
    assert.equal(st({ sessions: [{ date: '2026-11-07' }], stats: stats(100, 0) }).cls, 'warn');
    assert.equal(st({ sessions: [{ date: '2026-10-01' }], stats: stats(100, 50) }).cls, 'bad');
    assert.equal(st({ sessions: [{ date: '2026-11-07' }], stats: stats(100, 100) }).key, 'closable');
  });
  await t.test('les séances peuvent être dans le désordre', () => assert.equal(st({ sessions: [{ date: '2026-12-10' }, { date: '2026-11-13' }] }).key, 'running'));
});

test('facture : calcul et statut', async (t) => {
  const inv = { groups: [{ id: 'g1', label: 'Complet', price: 120, share: 0.5 }, { id: 'g2', label: 'Théorie', price: 70, share: 0.5 }],
    assign: { 'A': 'g1', 'B': 'g1', 'C': 'g2', 'D': 'g2' }, tps: true, tvq: true, extras: [] };
  await t.test('totaux avec T.P.S. et T.V.Q.', () => {
    const calc = ui.call('computeInvoice', { students: ['A', 'B', 'C', 'D'] }, inv);
    assert.equal(calc.subtotal, 190); assert.equal(calc.tps, 9.5);
    assert.equal(Math.round(calc.tvq * 100) / 100, 18.95); assert.equal(Math.round(calc.total * 100) / 100, 218.45);
  });
  await t.test('même résultat que les étudiants soient des noms de dossier ou des fiches', () => {
    const a = ui.call('computeInvoice', { students: ['A', 'B', 'C', 'D'] }, inv);
    const b = ui.call('computeInvoice', { students: ['A', 'B', 'C', 'D'].map(f => ({ folder: f })) }, inv);
    assert.equal(a.total, b.total); assert.equal(a.subtotal, b.subtotal);
    assert.deepEqual(a.lines.map(l => l.count), [2, 2]); assert.deepEqual(b.lines.map(l => l.count), [2, 2]);
  });
  await t.test('sans taxes, et avec une ligne supplémentaire négative (rabais)', () => {
    const calc = ui.call('computeInvoice', { students: ['A'] }, { ...inv, tps: false, tvq: false, assign: { A: 'g1' }, extras: [{ label: 'Rabais', amount: -10 }] });
    assert.equal(calc.tps, 0); assert.equal(calc.tvq, 0); assert.equal(calc.total, 50);
  });
  await t.test('statuts', () => {
    const key = c => ui.call('invoiceStatus', c).key;
    assert.equal(key({}), 'none');
    assert.equal(key({ invoice: {} }), 'draft');
    assert.equal(key({ invoice: { submittedDate: '2026-11-01' } }), 'submitted');
    assert.equal(key({ invoice: { submittedDate: '2026-11-01', paidDate: '2026-11-10' } }), 'paid');
    assert.equal(key({ billable: false, invoice: { submittedDate: '2026-11-01' } }), 'nobill', 'un cours non facturé sort du suivi');
  });
});

test('liste « À faire »', async (t) => {
  // Sauvegarde récente : le rappel de sauvegarde (testé à part) ne se mêle pas à ces cas.
  const recent = { lastBackup: { at: TODAY + 'T12:00:00.000Z' } };
  const todos = list => ui.call('buildTodos', list, recent).map(td => ({ u: td.urgency, text: td.text, id: td.course && td.course.id }));
  await t.test('cours dans 7 jours : documents manquants et courriels non notés', () => {
    const r = todos([course({ sessions: [{ date: '2026-11-21' }], stats: stats(50, 0, [stud({ firstName: 'Marc', preMissing: 2 }), stud({ firstName: 'Léa', lastMail: { date: '2026-11-10' } })], { generalPreMissing: 1 }) })]);
    assert.equal(r.length, 3);
    assert.ok(r.some(x => /pré-cours manquants pour 1 étudiant/.test(x.text) && /Marc/.test(x.text)));
    assert.ok(r.some(x => /général/.test(x.text)));
    assert.ok(r.some(x => /Aucun courriel noté pour 1 étudiant/.test(x.text) && /Marc/.test(x.text)));
    assert.ok(r.every(x => x.u === 1));
  });
  await t.test('cours dans 3 jours ou moins : urgent', () => {
    const r = todos([course({ sessions: [{ date: '2026-11-16' }], stats: stats(0, 0, [stud({ preMissing: 1, lastMail: { date: '2026-11-01' } })]) })]);
    assert.equal(r[0].u, 2);
  });
  await t.test('cours lointain (plus de 14 jours) : rien encore', () => {
    assert.deepEqual(todos([course({ sessions: [{ date: '2026-12-20' }], stats: stats(0, 0, [stud({ preMissing: 3 })]) })]), []);
  });
  await t.test('cours terminé : documents, certification, transfert, facture', () => {
    const r = todos([course({ sessions: [{ date: '2026-11-07' }], students: ['A B', 'C D'], stats: stats(100, 0, [stud({ postMissing: 2 }), stud({ folder: 'C D', firstName: 'Cy', courseOnly: true })]) })]);
    const texts = r.map(x => x.text).join(' | ');
    assert.match(texts, /Documents manquants pour 1/); assert.match(texts, /Certification à confirmer pour 1/);
    assert.match(texts, /Dossier à transférer pour 1/); assert.match(texts, /Facture à préparer/);
  });
  await t.test('cours terminé et complet : proposer de clôturer', () => {
    const r = todos([course({ invoice: { paidDate: '2026-11-10', submittedDate: '2026-11-08' }, sessions: [{ date: '2026-11-07' }], stats: stats(100, 100, [stud({ certificationConfirmed: true })]) })]);
    assert.equal(r.length, 1); assert.match(r[0].text, /clôturer/); assert.equal(r[0].u, 0);
  });
  await t.test('paiement en attente, avec le nombre de jours et le montant', () => {
    const inv = { number: '2026-004', submittedDate: '2026-10-01', groups: [{ id: 'g', price: 100, share: 1 }], assign: { 'A B': 'g' }, tps: true, tvq: true, extras: [] };
    const r = todos([course({ completed: true, students: ['A B'], invoice: inv, sessions: [{ date: '2026-09-20' }] })]);
    assert.equal(r.length, 1); assert.match(r[0].text, /depuis 44 jour/); assert.match(r[0].text, /2026-004/); assert.match(r[0].text, /114,98/);
    assert.equal(r[0].u, 2, 'urgent au-delà de 30 jours');
  });
  await t.test('cours clos ou non facturé : aucun rappel de facture', () => {
    const base = { sessions: [{ date: '2026-11-07' }], students: ['A B'], stats: stats(100, 100, [stud({ certificationConfirmed: true })]) };
    assert.ok(!todos([course({ ...base, billable: false })]).some(x => /acture/.test(x.text)));
    assert.ok(todos([course({ ...base })]).some(x => /Facture à préparer/.test(x.text)));
  });
  await t.test('les urgents passent en premier', () => {
    const r = todos([
      course({ id: 'A', sessions: [{ date: '2026-11-25' }], stats: stats(0, 0, [stud({ preMissing: 1, lastMail: {} })]) }),
      course({ id: 'B', sessions: [{ date: '2026-11-15' }], stats: stats(0, 0, [stud({ preMissing: 1, lastMail: {} })]) })]);
    assert.deepEqual(r.map(x => x.id), ['B', 'A']);
  });
});

test('rappel de sauvegarde et copies en conflit', async (t) => {
  const one = [course({ id: 'A', completed: true, billable: false, sessions: [{ date: '2026-10-01' }] })];
  const backupTodo = extra => ui.call('buildTodos', one, extra).filter(x => x.title === 'Sauvegarde');
  await t.test('jamais faite : rappel urgent', () => {
    const r = backupTodo({}); assert.equal(r.length, 1); assert.equal(r[0].urgency, 2); assert.match(r[0].text, /Aucune sauvegarde/); assert.equal(r[0].href, '#/settings');
  });
  await t.test('faite il y a 30 jours ou moins : rien', () => assert.deepEqual(backupTodo({ lastBackup: { at: '2026-10-15T10:00:00Z' } }), []));
  await t.test('plus de 30 jours : rappel ; plus de 90 jours : urgent', () => {
    const r = backupTodo({ lastBackup: { at: '2026-10-01T10:00:00Z' } }); assert.equal(r.length, 1); assert.equal(r[0].urgency, 1); assert.match(r[0].text, /il y a 44 jours/);
    assert.equal(backupTodo({ lastBackup: { at: '2026-07-01T10:00:00Z' } })[0].urgency, 2);
  });
  await t.test("la date affichée est la date locale (sauvegarde faite le soir)", () => {
    // 00 h 40 UTC le 15 = 19 h 40 le 14 à Toronto (fuseau des tests sur GitHub : UTC, donc on vérifie la conversion elle-même)
    const at = '2026-11-15T00:40:00.000Z', d = new Date(at);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(ui.call('localIsoDate', at), expected);
  });
  await t.test('aucun cours : pas de rappel (installation neuve)', () => assert.deepEqual(ui.call('buildTodos', [], {}), []));
  await t.test('copie en conflit : signalée, avec son dossier', () => {
    const r = ui.call('buildTodos', one, { lastBackup: { at: TODAY + 'T09:00:00Z' }, conflicts: [
      { courseId: 'A', studentFolder: 'Zoé LÉVESQUE', name: 'student-BUREAU.json', original: 'student.json' },
      { courseId: '_ScubaPilot', studentFolder: '', name: 'centers-PORTABLE.json', original: 'centers.json' }] });
    const cf = r.filter(x => x.conflict);
    assert.equal(cf.length, 2);
    assert.match(cf[0].text, /student-BUREAU\.json/); assert.match(cf[0].text, /dossier de Zoé LÉVESQUE/); assert.equal(cf[0].course.id, 'A');
    assert.match(cf[1].text, /dans vos réglages/); assert.equal(cf[1].course, null); assert.equal(cf[1].href, '#/settings');
  });
});

test('modèles de courriel', async (t) => {
  await t.test('une variable vide emporte l\'espace qui la précède', () => {
    assert.equal(ui.call('mergeTemplate', 'Bonjour {prenom},', { prenom: '' }), 'Bonjour,');
    assert.equal(ui.call('mergeTemplate', 'Bonjour {prenom} {nom},', { prenom: '', nom: '' }), 'Bonjour,');
    assert.equal(ui.call('mergeTemplate', 'Bonjour {prenom},', { prenom: 'Léa' }), 'Bonjour Léa,');
  });
  await t.test('une variable inconnue est laissée telle quelle', () => assert.equal(ui.call('mergeTemplate', 'Le {truc} est là', { prenom: 'x' }), 'Le {truc} est là'));
});

test('import d\'étudiants', async (t) => {
  await t.test('tableau collé depuis Excel (tabulations), lignes vides ignorées', () => {
    assert.deepEqual(ui.call('parseTable', 'Prénom\tNom\r\nJean\tDupont\r\n\r\nMarie\tRoy\t'), [['Prénom', 'Nom'], ['Jean', 'Dupont'], ['Marie', 'Roy', '']]);
  });
  await t.test('CSV avec guillemets, séparateur dans une valeur, retour de ligne dans une valeur', () => {
    assert.deepEqual(ui.call('parseTable', 'nom,adresse\n"Roy, Inès","12, rue ""A""\nApp 3"'), [['nom', 'adresse'], ['Roy, Inès', '12, rue "A"\nApp 3']]);
    assert.deepEqual(ui.call('parseTable', 'a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']], 'point-virgule préféré quand il domine');
  });
  await t.test('titres de colonnes reconnus, en français et en anglais', () => {
    const g = h => ui.call('guessTargetFromHeader', h);
    assert.equal(g('Prénom'), 'firstName'); assert.equal(g('First name'), 'firstName');
    assert.equal(g('NOM DE FAMILLE'), 'lastName'); assert.equal(g('Nom'), 'lastName');
    assert.equal(g('Nom complet'), 'fullName'); assert.equal(g('Étudiant'), 'fullName');
    assert.equal(g('Courriel'), 'email'); assert.equal(g('E-mail'), 'email');
    assert.equal(g('Tél. cellulaire'), 'phoneCell'); assert.equal(g('Téléphone maison'), 'phoneHome');
    assert.equal(g('Date de naissance'), 'birthDate'); assert.equal(g('Statut'), 'status'); assert.equal(g('Remarque'), '');
  });
  await t.test('sans titres : colonnes devinées d\'après leur contenu', () => {
    assert.deepEqual(ui.call('guessTargetsFromContent', [['Jean', 'Dupont', '514 555-0101', 'j@x.ca', '1990-04-12'], ['Marie', 'Roy', '(438) 555-0102', 'm@x.ca', '03/09/1996']], 5),
      ['firstName', 'lastName', 'phoneCell', 'email', 'birthDate']);
  });
  await t.test('dates : jour/mois/année, ou année-mois-jour', () => {
    assert.equal(ui.call('importDateToIso', '03/09/1996'), '1996-09-03'); assert.equal(ui.call('importDateToIso', '1990-4-2'), '1990-04-02');
    assert.equal(ui.call('importDateToIso', '12.04.1990'), '1990-04-12'); assert.equal(ui.call('importDateToIso', 'avril 1990'), '');
  });
  await t.test('nom complet dans les deux sens, lignes incomplètes signalées', () => {
    const r = ui.call('rowsToStudents', [['Lévesque, Zoé', 'zoe@x.ca', 'Cours + Certification'], ['Jean Dupont', '', 'cours'], ['Seul', '', '']], ['fullName', 'email', 'status']);
    assert.deepEqual(r.students, [{ lastName: 'Lévesque', firstName: 'Zoé', email: 'zoe@x.ca', status: 'both' }, { firstName: 'Jean', lastName: 'Dupont', status: 'cours' }]);
    assert.equal(r.problems.length, 1); assert.match(r.problems[0], /Ligne 3/);
  });
});

test('export calendrier (.ics)', async (t) => {
  const c = course({ id: 'OWD_21NOV2026', students: ['A', 'B'], sessions: [
    { date: '2026-11-21', timeStart: '09:00', timeEnd: '12:00', siteId: 's1', notes: 'Théorie; piscine, puis bilan', coequipierIds: ['b1'] },
    { date: '2026-11-22', timeStart: '', timeEnd: '' },
    { date: '2026-11-23', timeStart: '22:00', timeEnd: '01:00' },
    { date: '', timeStart: '09:00' }] });
  const ev = ui.call('courseIcsEvents', c);
  await t.test('une entrée par séance datée', () => assert.equal(ev.length, 3));
  await t.test('séance avec heures', () => {
    assert.ok(ev[0].includes('DTSTART:20261121T090000') && ev[0].includes('DTEND:20261121T120000'));
    assert.ok(ev[0].includes('SUMMARY:Open Water Diver — Centre Plongée Horizon'));
    assert.ok(ev[0].includes('LOCATION:Piscine municipale\\, 55 rue du Parc\\, Laval'), 'virgules échappées');
    assert.ok(ev[0].some(l => l.startsWith('DESCRIPTION:Théorie\\; piscine\\, puis bilan\\nCoéquipiers : Marie Lavoie')), 'point-virgule, virgule et retour de ligne échappés');
  });
  await t.test('séance sans heure : journée entière', () => assert.ok(ev[1].includes('DTSTART;VALUE=DATE:20261122') && ev[1].includes('DTEND;VALUE=DATE:20261123')));
  await t.test('fin après minuit : le lendemain', () => assert.ok(ev[2].includes('DTEND:20261124T010000')));
  await t.test('identifiants stables et distincts', () => {
    const uids = ev.map(e => e.find(l => l.startsWith('UID:')));
    assert.equal(new Set(uids).size, 3);
    assert.deepEqual(uids, ui.call('courseIcsEvents', c).map(e => e.find(l => l.startsWith('UID:'))));
  });
  await t.test('lignes repliées à 75 octets, accents compris', () => {
    const folded = ui.call('icsFold', 'DESCRIPTION:' + 'é'.repeat(100));
    const parts = folded.split('\r\n');
    assert.ok(parts.length > 1 && parts.every(p => Buffer.byteLength(p, 'utf8') <= 75));
    assert.ok(parts.slice(1).every(p => p.startsWith(' ')));
    assert.equal(parts.map((p, i) => i ? p.slice(1) : p).join(''), 'DESCRIPTION:' + 'é'.repeat(100));
  });
});

test('conservation des dossiers', async (t) => {
  const c = (id, last, extra) => course({ id, sessions: [{ date: '2015-01-01' }, { date: last }].filter(s => s.date), completed: true, billable: false, ...(extra || {}) });
  await t.test('durée par défaut : 5 ans, jamais moins', () => {
    ui.setState({ settings: {} }); assert.equal(ui.call('retentionYears'), 5);
    ui.setState({ settings: { retentionYears: 2 } }); assert.equal(ui.call('retentionYears'), 5);
    ui.setState({ settings: { retentionYears: 7 } }); assert.equal(ui.call('retentionYears'), 7);
    ui.setState({ settings: { retentionYears: 'abc' } }); assert.equal(ui.call('retentionYears'), 5);
    ui.setState({ settings: {} });
  });
  await t.test("candidats : dernière séance de plus de N ans, au jour près, du plus ancien au plus récent", () => {
    const list = [c('A', '2021-11-13'), c('B', '2021-11-14'), c('C', '2019-06-01'), c('D', '2026-01-01'), course({ id: 'E', sessions: [] }), { id: 'F', corrupted: true }];
    assert.deepEqual(ui.call('archiveCandidates', list, 5).map(x => x.id), ['C', 'A'], 'le 14 novembre 2021 a tout juste 5 ans : pas encore');
    assert.deepEqual(ui.call('archiveCandidates', list, 7).map(x => x.id), ['C']);
    assert.deepEqual(ui.call('archiveCandidates', list, 10).map(x => x.id), []);
  });
  await t.test("c'est la DERNIÈRE séance qui compte, pas la première", () => {
    assert.deepEqual(ui.call('archiveCandidates', [course({ id: 'X', sessions: [{ date: '2015-01-01' }, { date: '2024-01-01' }] })], 5), []);
  });
  await t.test('un seul rappel, sans urgence, dans la liste « À faire »', () => {
    const r = ui.call('buildTodos', [c('A', '2019-06-01'), c('B', '2020-06-01')], { lastBackup: { at: TODAY + 'T09:00:00Z' } });
    assert.equal(r.length, 1); assert.equal(r[0].urgency, 0); assert.equal(r[0].href, '#/settings');
    assert.match(r[0].text, /2 cours ont plus de 5 ans/);
    assert.deepEqual(ui.call('buildTodos', [c('A', '2024-06-01')], { lastBackup: { at: TODAY + 'T09:00:00Z' } }), []);
  });
});

test("personnes et homonymes", async (t) => {
  const recs = [
    { studentId: 'etu_aaaaaaaaaaaa', courseId: 'OWD_1', folder: 'Léa TREMBLAY', firstName: 'Léa', lastName: 'Tremblay', email: 'lea@exemple.ca' },
    { studentId: 'etu_aaaaaaaaaaaa', courseId: 'AOWD_2', folder: 'Léa TREMBLAY', firstName: 'Léa', lastName: 'Tremblay', birthDate: '1996-09-03' },
    { studentId: 'etu_bbbbbbbbbbbb', courseId: 'OWD_3', folder: 'Lea TREMBLAY', firstName: 'Lea', lastName: 'TREMBLAY' }];
  await t.test('les fiches sont regroupées par identifiant, pas par nom', () => {
    const persons = ui.call('groupPersons', recs);
    assert.equal(persons.length, 2);
    assert.deepEqual(persons.map(p => p.records.length), [2, 1]);
  });
  await t.test('indice pour distinguer deux homonymes', () => {
    const [a, b] = ui.call('groupPersons', recs);
    assert.equal(ui.call('personHint', a), 'lea@exemple.ca · né(e) en 1996 · 2 cours');
    assert.equal(ui.call('personHint', b), '1 cours');
  });
  await t.test('nom comparé sans majuscules ni accents', () => {
    assert.equal(ui.call('normPersonName', recs[0]), ui.call('normPersonName', recs[2]));
    assert.equal(ui.call('normPersonName', { firstName: '  Jean-  Pierre ', lastName: 'CÔTÉ' }), 'jean- pierre cote');
  });
});

test('petits utilitaires', () => {
  assert.equal(ui.call('fmtBytes', 0), '0 o'); assert.equal(ui.call('fmtBytes', 1536), '1,50 Ko'); assert.equal(ui.call('fmtBytes', 300000000), '286 Mo');
  assert.equal(ui.call('daysBetween', '2026-11-14', '2026-11-21'), 7); assert.equal(ui.call('daysBetween', '2026-03-07', '2026-03-09'), 2, 'changement d\'heure');
  assert.equal(ui.call('escapeHtml', '<b>"a" & b</b>'), '&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
});

test('tableau de bord allégé', async (t) => {
  await t.test('dates compactes', () => {
    assert.equal(ui.call('compactDateRange', []), '');
    assert.equal(ui.call('compactDateRange', [{ date: '2026-11-21' }]), '21 nov. 2026');
    assert.equal(ui.call('compactDateRange', [{ date: '2026-11-22' }, { date: '2026-11-21' }]), '21–22 nov. 2026');
    assert.equal(ui.call('compactDateRange', [{ date: '2026-11-30' }, { date: '2026-12-02' }]), '30 nov. – 2 déc. 2026');
    assert.equal(ui.call('compactDateRange', [{ date: '2026-12-30' }, { date: '2027-01-02' }]), '30 déc. 2026 – 2 janv. 2027');
  });
  await t.test('moment relatif du cours', () => {
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2026-11-16' }] })), 'débute dans 2 jours');
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2026-11-15' }] })), 'débute demain');
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2026-11-14' }] })), 'en cours');
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2026-11-02' }] })), 'terminé il y a 12 jours');
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2026-08-14' }] })), 'terminé il y a 3 mois');
    assert.equal(ui.call('courseWhen', course({ sessions: [{ date: '2021-05-08' }] })), 'terminé il y a 5 ans');
    assert.equal(ui.call('courseWhen', course({})), 'aucune séance planifiée');
  });
  await t.test('« À faire » regroupé par cours', () => {
    const a = { id: 'A' }, b = { id: 'B' };
    const g = ui.call('groupTodos', [
      { course: a, urgency: 1, text: 'a1', sortDate: '2026-11-20' },
      { course: b, urgency: 2, text: 'b1', sortDate: '2026-11-16' },
      { course: a, urgency: 2, text: 'a2', sortDate: '2026-11-20' },
      { course: null, urgency: 0, text: 'sauvegarde', title: 'Sauvegarde', href: '#/settings', sortDate: '9999' },
      { course: a, urgency: 0, text: 'archiver', href: '#/settings', sortDate: '2019' }
    ]);
    assert.equal(g.length, 4);
    assert.deepEqual(g.map(x => x.key), ['course:B', 'course:A', 'topic:Conservation des dossiers#/settings', 'topic:Sauvegarde#/settings']);
    assert.equal(g[1].items.length, 2); assert.equal(g[1].urgency, 2);
    assert.equal(g[3].course, null);
  });
  await t.test('chiffres clés', () => {
    const todos = [{ urgency: 2 }, { urgency: 1 }, { urgency: 2 }];
    const s = ui.call('dashboardStats', [
      course({ id: 'U1', sessions: [{ date: '2026-11-21' }] }),
      course({ id: 'U2', sessions: [{ date: '2026-11-16' }], stats: stats(50, 0) }),
      course({ id: 'P0', sessions: [{ date: '2021-05-08' }], stats: stats(100, 0) }),
      course({ id: 'P1', sessions: [{ date: '2026-11-07' }], stats: stats(100, 50) }),
      course({ id: 'F1', sessions: [{ date: '2026-10-01' }], completed: true, invoice: { submittedDate: '2026-10-05', groups: [{ label: 'X', unitPrice: 100, studentFolders: [] , quantity: 2 }] } }),
      { id: 'BAD', corrupted: true }
    ], todos);
    assert.equal(s.todoCount, 3); assert.equal(s.urgentCount, 2);
    assert.equal(s.upcomingCount, 2); assert.equal(s.nextInDays, 2);
    assert.equal(s.postCount, 2); assert.equal(s.postFirst.id, 'P1');
    assert.equal(s.pendingCount, 1);
  });
});

test('courriels : message mis en forme, équipe et copie', async (t) => {
  ui.setState({
    settings: { instructorName: 'Arnaud LINA', instructorEmail: 'arnaud@exemple.ca' },
    buddies: [
      { id: 'b1', name: 'Arnaud LINA', role: 'Instructeur', email: 'Arnaud@Exemple.ca' },
      { id: 'b2', name: 'Karim Ait Oumeziane', role: 'Instructeur', email: 'karim@exemple.ca' },
      { id: 'b3', name: 'Martin Chamberland', role: 'Dive Master', email: 'martin@exemple.ca' },
      { id: 'b4', name: 'Sans Courriel', role: 'DM' }
    ]
  });
  const c = { id: 'X', instructorIds: ['b1', 'b2'], sessions: [{ date: '2026-12-04', coequipierIds: ['b2', 'b3'] }, { date: '2026-12-05', coequipierIds: ['b4'] }] };
  await t.test('texte -> HTML et retour', () => {
    assert.equal(ui.call('textToHtml', 'Bonjour <tous>\nA & B'), 'Bonjour &lt;tous&gt;<br>A &amp; B');
    assert.equal(ui.call('htmlToPlainText', 'Un <b>gras</b><br>deux<div>trois</div><div>&nbsp;quatre &amp; cinq</div>'), 'Un gras\ndeux\ntrois\n quatre & cinq');
    assert.equal(ui.call('htmlToPlainText', 'b<div><br></div><div>c</div>'), 'b\n\nc');
    assert.equal(ui.call('templateBodyHtml', { body: 'a\nb' }), 'a<br>b');
    assert.equal(ui.call('templateBodyHtml', { body: 'a\nb', bodyHtml: '<b>a</b><br>b' }), '<b>a</b><br>b');
  });
  await t.test('variables dans un message HTML', () => {
    const ctx = { prenom: '', nom: '', instructeur: 'Arnaud LINA', liste: '- 4 déc.\n- 5 déc. <piscine>' };
    assert.equal(ui.call('mergeTemplateHtml', 'Bonjour {prenom},<br>Je suis <b>{instructeur}</b>.<br>{liste}<br>{inconnu}', ctx),
      'Bonjour,<br>Je suis <b>Arnaud LINA</b>.<br>- 4 déc.<br>- 5 déc. &lt;piscine&gt;<br>{inconnu}');
    assert.equal(ui.call('mergeTemplateHtml', 'Bonjour&nbsp;{prenom}, ok', { prenom: '' }), 'Bonjour, ok');
  });
  await t.test('équipe du cours', () => {
    assert.deepEqual(ui.call('courseTeam', c).map(b => b.id), ['b1', 'b2', 'b3', 'b4']);
    assert.equal(ui.call('courseTeamNames', c), 'Arnaud LINA, Karim Ait Oumeziane, Martin Chamberland et Sans Courriel');
    assert.equal(ui.call('courseTeamNames', { sessions: [] }), 'Arnaud LINA');
  });
  await t.test('copie (Cc) : équipe sans vous, sans doublon', () => {
    assert.deepEqual(ui.call('courseCcList', c), ['karim@exemple.ca', 'martin@exemple.ca']);
    assert.deepEqual(ui.call('courseCcList', c, ['info@centre.ca', 'KARIM@exemple.ca']), ['info@centre.ca', 'KARIM@exemple.ca', 'martin@exemple.ca']);
  });
});

test('liste des lieux avec adresse', () => {
  ui.setState({ sites: [{ id: 's1', name: 'Piscine', address: '1 rue A' }, { id: 's2', name: 'Carrière' }, { id: 's3', name: 'Boutique', address: '3 ch. C' }] });
  assert.equal(ui.call('buildSitesAddressList', [
    { date: '2026-12-05', siteId: 's2' }, { date: '2026-12-04', timeStart: '21:00', siteId: 's1' },
    { date: '2026-12-04', timeStart: '18:00', siteId: 's3' }, { date: '2026-12-06', siteId: 's1' }, { date: '2026-12-07', siteId: '' }, { date: '2026-12-08', siteId: 'supprime' }
  ]), '- Boutique : 3 ch. C\n- Piscine : 1 rue A\n- Carrière');
  assert.equal(ui.call('buildSitesAddressList', []), '(aucun lieu indiqué)');
});

test('répertoire des étudiants', () => {
  ui.setState({ studentFields: [{ id: 'status', type: 'select', options: [{ value: 'both', label: 'Cours et certification' }, { value: 'cours', label: 'Cours seulement' }] }] });
  const courses = [
    { id: 'OWD_01MAI2026', typeCode: 'OWD', centerId: 'c1', sessions: [{ date: '2026-05-01' }, { date: '2026-05-03' }] },
    { id: 'AOWD_10OCT2026', typeCode: 'AOWD', centerId: 'c2', sessions: [{ date: '2026-10-10' }] },
    { id: 'NITROX_20NOV2026', typeCode: 'NITROX', centerId: 'c1', sessions: [{ date: '2026-11-20' }] },
    { id: 'BAD', corrupted: true }
  ];
  const records = [
    { courseId: 'OWD_01MAI2026', folder: 'Zoé Lévesque', studentId: 'etu_000000000001', firstName: 'Zoé', lastName: 'Lévesque', email: 'zoe@x.ca', status: 'both', certificationConfirmed: true, certifyingInstructorId: 'b1' },
    { courseId: 'AOWD_10OCT2026', folder: 'Zoé Lévesque', studentId: 'etu_000000000001', firstName: 'Zoé', lastName: 'Lévesque', status: 'both', phoneCell: '514' },
    { courseId: 'NITROX_20NOV2026', folder: 'Marc Roy', studentId: 'etu_000000000002', firstName: 'Marc', lastName: 'Roy', status: 'cours' },
    { courseId: 'OWD_01MAI2026', folder: 'Ana Bé', studentId: 'etu_000000000003', firstName: 'Ana', lastName: 'Bé', status: 'both' },
    { courseId: 'NITROX_20NOV2026', folder: 'Ana Bé', studentId: 'etu_000000000003', firstName: 'Ana', lastName: 'Bé', status: 'both' }
  ];
  const dir = ui.call('buildStudentDirectory', records, courses);
  const zoe = dir.find(p => p.firstName === 'Zoé');
  assert.deepEqual(zoe.items.map(i => [i.typeCode, i.state]), [['AOWD', 'toconfirm'], ['OWD', 'certified']]);
  assert.equal(zoe.email, 'zoe@x.ca'); assert.equal(zoe.phone, '514'); assert.equal(zoe.lastDate, '2026-10-10'); assert.equal(zoe.lastCenterId, 'c2');
  assert.deepEqual(dir.find(p => p.firstName === 'Marc').items.map(i => i.state), ['courseonly']);
  assert.deepEqual(dir.find(p => p.firstName === 'Ana').items.map(i => i.state), ['pending', 'toconfirm']);
  const names = f => ui.call('sortStudentDirectory', dir.filter(p => ui.call('studentDirMatches', p, f)), 'name').map(p => p.firstName);
  assert.deepEqual(names({}), ['Ana', 'Zoé', 'Marc']);
  assert.deepEqual(names({ q: 'levesque' }), ['Zoé']);
  assert.deepEqual(names({ typeCode: 'OWD' }), ['Ana', 'Zoé']);
  assert.deepEqual(names({ typeCode: 'OWD', state: 'certified' }), ['Zoé']);
  assert.deepEqual(names({ state: 'toconfirm' }), ['Ana', 'Zoé']);
  assert.deepEqual(ui.call('sortStudentDirectory', dir, 'recent').map(p => p.firstName), ['Ana', 'Marc', 'Zoé']);
});

test('répertoire : certifiés par moi ou par un autre instructeur', () => {
  ui.setState({
    settings: { instructorName: 'Arnaud LINA', instructorEmail: 'arnaud@x.ca' },
    buddies: [{ id: 'me', name: 'Arnaud Lina', email: '' }, { id: 'k', name: 'Karim A', email: 'k@x.ca' }, { id: 'me2', name: 'Autre nom', email: 'ARNAUD@x.ca' }],
    studentFields: []
  });
  assert.equal(ui.call('isMyBuddyId', 'me'), true);
  assert.equal(ui.call('isMyBuddyId', 'me2'), true);
  assert.equal(ui.call('isMyBuddyId', 'k'), false);
  assert.equal(ui.call('isMyBuddyId', ''), false);
  const courses = [{ id: 'A', typeCode: 'OWD', sessions: [{ date: '2026-05-01' }] }, { id: 'B', typeCode: 'AOWD', sessions: [{ date: '2026-06-01' }] }];
  const records = [
    { courseId: 'A', folder: 'x', studentId: 'etu_000000000001', firstName: 'Zoé', lastName: 'A', certificationConfirmed: true, certifyingInstructorId: 'me' },
    { courseId: 'B', folder: 'x', studentId: 'etu_000000000001', firstName: 'Zoé', lastName: 'A', certificationConfirmed: true, certifyingInstructorId: 'k' },
    { courseId: 'A', folder: 'y', studentId: 'etu_000000000002', firstName: 'Marc', lastName: 'B', certificationConfirmed: true, certifyingInstructorId: 'k' },
    { courseId: 'A', folder: 'z', studentId: 'etu_000000000003', firstName: 'Ana', lastName: 'C' }
  ];
  const dir = ui.call('buildStudentDirectory', records, courses);
  const names = f => dir.filter(p => ui.call('studentDirMatches', p, f)).map(p => p.firstName).sort();
  assert.deepEqual(names({ by: 'me' }), ['Zoé']);
  assert.deepEqual(names({ by: 'other' }), ['Marc', 'Zoé']);
  assert.deepEqual(names({ by: 'me', typeCode: 'AOWD' }), []);
  assert.deepEqual(names({ by: 'other', typeCode: 'OWD' }), ['Marc']);
});

test('documents « Automatique » : âge et statut', () => {
  assert.equal(ui.call('ageOn', '2010-11-21', '2026-11-20'), 15);
  assert.equal(ui.call('ageOn', '2010-11-20', '2026-11-20'), 16);
  assert.equal(ui.call('ageOn', '', '2026-11-20'), null);
  const minor = { maxAge: 18 }, certif = { statuses: ['certif', 'both'] };
  const need = (rule, s, d) => ui.call('docRuleNeed', rule, s, d || '2026-12-04');
  assert.deepEqual(need(minor, { birthDate: '2010-01-01' }), { needed: true, reason: '16 ans' });
  assert.deepEqual(need(minor, { birthDate: '2008-12-04' }), { needed: false, reason: '18 ans' });
  assert.deepEqual(need(minor, {}), { needed: true, reason: 'date de naissance manquante' });
  assert.equal(need(certif, { status: 'both' }).needed, true);
  assert.equal(need(certif, { status: 'cours' }).needed, false);
  assert.equal(need(certif, {}).needed, false);
  assert.equal(need({ maxAge: 18, statuses: ['both'] }, { birthDate: '2010-01-01', status: 'cours' }).needed, false);
  assert.equal(need({}, {}).needed, true);
  // dans le score
  const defs = [{ id: 'q', requirement: 'required' }, { id: 'parent', requirement: 'rule', rule: minor }, { id: 'photo', requirement: 'rule', rule: certif }];
  const entries = { q: { collected: true }, parent: { collected: false }, photo: { collected: true } };
  const count = (s) => ui.call('countDocGroup', entries, defs, { student: s, start: '2026-12-04' });
  assert.deepEqual(count({ birthDate: '1990-01-01', status: 'cours' }), { total: 1, done: 1 });
  assert.deepEqual(count({ birthDate: '2012-01-01', status: 'both' }), { total: 3, done: 2 });
  assert.deepEqual(ui.call('countDocGroup', entries, defs), { total: 3, done: 2 }, 'sans contexte : comptés');
});

test('coéquipiers proposés pour les séances : ceux du cours, sans vous', () => {
  ui.setState({
    settings: { instructorName: 'Arnaud LINA', instructorEmail: 'a@x.ca' },
    buddies: [{ id: 'me', name: 'Arnaud LINA' }, { id: 'k', name: 'Karim' }, { id: 'm', name: 'Martin' }, { id: 'r', name: 'René' }]
  });
  assert.deepEqual(ui.call('courseBuddyChoices', { instructorIds: ['me', 'k', 'm'] }).map(b => b.id), ['k', 'm']);
  assert.deepEqual(ui.call('courseBuddyChoices', {}), []);
});
