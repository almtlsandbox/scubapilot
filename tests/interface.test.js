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
  const todos = list => ui.call('buildTodos', list).map(td => ({ u: td.urgency, text: td.text, id: td.course.id }));
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
    const r = ui.call('buildTodos', [c('A', '2019-06-01'), c('B', '2020-06-01')]);
    assert.equal(r.length, 1); assert.equal(r[0].urgency, 0); assert.equal(r[0].href, '#/settings');
    assert.match(r[0].text, /2 cours ont plus de 5 ans/);
    assert.deepEqual(ui.call('buildTodos', [c('A', '2024-06-01')]), []);
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
