# ScubaPilot

Version 1.0 — Septembre 2026

Application **locale** (aucune donnée envoyée sur internet) pour gérer votre activité d'instructeur de plongée indépendant : cours, étudiants, checklist de documents à collecter, et génération d'emails.

L'application a maintenant un logo (`public/logo.svg`, un masque de plongée avec une aiguille de boussole) : visible dans la barre latérale, dans l'onglet du navigateur (favicon), sur la carte "À propos" de Paramètres, et en en-tête du rapport de cours imprimable. Vous pouvez le remplacer par votre propre image en écrasant ce fichier (gardez le nom `logo.svg`, ou mettez à jour les quelques références dans `index.html`/`app.js` si vous changez de nom/format).

## Installation (une seule fois)

1. Installez [Node.js](https://nodejs.org/) (version 18 ou plus récente) si ce n'est pas déjà fait.
2. Décompressez ce dossier où vous voulez sur votre PC (ex: `C:\Apps\dive-instructor-app`).
3. Ouvrez une invite de commande (cmd ou PowerShell) dans ce dossier.
4. Lancez :
   ```
   npm install
   ```

## Lancer l'application

**Option A — manuellement, quand vous en avez besoin :**
Double-cliquez sur **`Lancer (avec fenetre).bat`**. Une fenêtre s'ouvre (laissez-la ouverte) et votre navigateur s'ouvre sur l'application.

**Option B — toujours démarrée, sans rien avoir à ouvrir :**
1. Appuyez sur `Win + R`, tapez `shell:startup`, Entrée — le dossier "Démarrage" de Windows s'ouvre.
2. Faites un clic droit sur **`Demarrage-automatique.vbs`** (dans le dossier de l'application) → **Créer un raccourci**, puis déplacez ce raccourci dans le dossier "Démarrage" qui vient de s'ouvrir.
3. C'est tout. À chaque ouverture de session Windows, l'application démarre automatiquement et silencieusement (aucune fenêtre ne s'ouvre) — elle est ensuite toujours disponible sur **http://localhost:4531**, vous n'avez qu'à ouvrir un onglet de navigateur vers cette adresse quand vous en avez besoin.
4. Pour l'arrêter (ex: avant une mise à jour), double-cliquez sur **`Arreter.bat`**.
5. Journal de démarrage (en cas de souci) : fichier `app.log` créé dans le dossier de l'application.

Astuce : épinglez `http://localhost:4531` en favori ou en raccourci sur le bureau pour y accéder en un clic.

## Premiers pas

1. Allez dans **Paramètres** et définissez le **répertoire racine** (ex: `D:\Plongee\Instructeur`) où seront rangés tous vos cours et documents. Utilisez "Créer si absent" s'il n'existe pas encore.
2. Vérifiez/complétez les **types de cours** (modèles) et les **sites de plongée** — ils sont stockés en JSON et modifiables directement dans les Paramètres.
3. Ajoutez au moins un **centre partenaire** (Paramètres → "Centres partenaires") — c'est obligatoire pour créer un cours.
4. Personnalisez si besoin les **modèles d'email** (convocation / rappel) et le **modèle de facturation** (Paramètres → "Facturation").
5. Créez un **nouveau cours**, ajoutez des étudiants, cochez les documents au fur et à mesure que vous les recevez.

## Organisation des données sur le disque

```
<votre racine>/
  OWD_20SEP2026/
    course.json
    Photo/
      (photos du cours, glissées-déposées depuis l'application)
    Arnaud LINA/
      student.json
      (vos scans/photos de documents...)
    Julie MARTIN/
      student.json
  RESCUE_05OCT2026/
    course.json
    ...
```

- Le dossier de cours est nommé `TYPE_DATE` (ex: `OWD_20SEP2026`), ce qui l'identifie de façon unique.
- Chaque étudiant a son propre sous-dossier `Prénom NOM`.
- Les fichiers `course.json` et `student.json` sont gérés par l'application ; vous pouvez glisser vos scans, photos ou PDF directement dans les dossiers étudiants via l'Explorateur Windows (bouton "📂 Ouvrir dans l'Explorateur" présent pour chaque cours et chaque étudiant).
- L'application liste aussi les fichiers réellement présents dans chaque dossier étudiant, pour vérifier en un coup d'œil.

## Fonctionnalités

- **Tableau de bord** : deux listes distinctes — **"À venir"** (le prochain cours en haut, triés du plus proche au plus lointain) et **"Cours passés"** en dessous (du plus récent au plus ancien, grisés pour les distinguer d'un coup d'œil). Un cours est considéré "passé" dès que sa dernière séance planifiée est antérieure à aujourd'hui.
- **Fiche cours** :
  - **Séances** : un cours peut avoir plusieurs séances (date, heure, lieu), par ex. théorie le samedi matin, piscine le samedi après-midi, fosse le dimanche. Ajoutez-en autant que nécessaire.
  - **Documents généraux du cours** : checklist de documents non liés à un étudiant en particulier (ex: assurance transmise au centre, feuille de présence), définie par le type de cours.
  - **Communications** : génère en une fois la liste des convocations ou des rappels pour tous les étudiants du cours (dates/heures/lieux insérés automatiquement), avec bouton pour copier une adresse individuellement, copier toutes les adresses email, ou copier tous les messages d'un coup.
  - Accès direct au dossier Windows du cours.
- **Fiche étudiant** : coordonnées, statut, checklist de documents pré/post-cours (les cases se cochent sans recharger la page, vous pouvez enchaîner plusieurs clics), accès direct au dossier Windows. Un badge **"⚠ Infos incomplètes"** apparaît automatiquement s'il manque un numéro de téléphone (maison ou cellulaire), un email, ou une date de naissance — survolez le badge pour voir précisément ce qui manque.
- **Recherche d'étudiant existant** : lors de l'ajout d'un étudiant à un nouveau cours, recherchez-le par nom pour copier automatiquement ses coordonnées depuis un cours précédent.

## Modèles de cours (types)

Dans les Paramètres, les types de cours s'éditent maintenant via un vrai formulaire (ajouter/modifier/supprimer un type, et pour chaque type, ajouter/modifier/supprimer un document dans chacune des 4 listes ci-dessous) — plus besoin d'éditer du JSON à la main.

Chaque type de cours définit 4 listes de documents :
- `preDocs` / `postDocs` : documents à collecter **par étudiant**.
- `generalPreDocs` / `generalPostDocs` : documents **généraux du cours**, cochés une seule fois pour tout le cours (ex: feuille de présence collective).

### Statut d'un document (`requirement`)

Chaque document a un statut parmi 3 :
- `"required"` : toujours nécessaire, compte toujours dans le % de complétion.
- `"optional"` : jamais compté dans le % (purement informatif, ex: une pièce jointe facultative).
- `"conditional"` : nécessaire seulement pour **certains** étudiants (ex: certificat médical du médecin selon les réponses au questionnaire, autorisation parentale selon l'âge). Pour ces documents, un interrupteur **"Nécessaire ?"** apparaît à côté de la case à cocher habituelle, à activer au cas par cas pour chaque étudiant. Le document ne compte dans le score que si "Nécessaire ?" est coché ET qu'il n'est pas encore reçu ; s'il n'est pas nécessaire pour un étudiant donné, il est simplement exclu de son calcul (ne pénalise pas son %).

Exemple :
```json
{ "id": "certificat_medecin", "label": "Certificat médical du médecin", "requirement": "conditional" }
```

## Champs du profil étudiant

Le formulaire "Ajouter un étudiant" / "Modifier les infos" est généré à partir des champs définis dans Paramètres, où ils s'éditent via un formulaire (plus de JSON à modifier à la main) : ajouter/modifier/supprimer un champ, choisir son type (`Texte`, `Téléphone`, `Email`, `Date`, `Texte long`, `Liste déroulante`), le marquer obligatoire, et pour une liste déroulante, gérer ses options (valeur + libellé affiché). Gardez toujours les champs "Prénom" et "Nom" (ils servent à nommer les dossiers sur le disque — un avertissement s'affiche si vous tentez de les supprimer). Par défaut : prénom, nom, adresse, téléphone (maison), téléphone (cellulaire), email, date de naissance, statut.

Les champs de type `date` (ex: date de naissance) utilisent un champ texte "JJ/MM/AAAA" à saisie continue plutôt que le sélecteur natif du navigateur — sur certains systèmes Windows, ce dernier ne passait pas correctement au mois après les 4 chiffres de l'année. Tapez simplement les 8 chiffres à la suite, les "/" s'insèrent automatiquement. Pour le champ `birthDate` spécifiquement, l'âge actuel est calculé et affiché automatiquement : en direct pendant la saisie (formulaire d'ajout/modification), dans les coordonnées de la fiche étudiant, et dans le rapport imprimable.

## Écrire à un étudiant

Sous chaque étudiant (une fois sa fiche dépliée), le bouton **"✉️ Écrire un email"** ouvre votre client mail avec son adresse déjà prête. Si le cours a un modèle d'email associé (voir "Communications"), le sujet et le message sont également prêts, personnalisés pour cet étudiant — vous pouvez bien sûr tout modifier avant l'envoi. Sans modèle associé, l'email s'ouvre vide, adresse déjà remplie.

## Séances : édition directe et coéquipiers

Tous les champs d'une séance (date, heure de début, heure de fin, lieu, notes) sont modifiables directement dans le tableau — changez la valeur et elle s'enregistre automatiquement (un changement de date recharge la page pour re-trier le tableau). Le formulaire "+ Ajouter une séance" est repliable pour économiser de la place.

**Heure de début / heure de fin et durée** : chaque séance a désormais deux champs d'heure distincts. Une colonne **Durée** est calculée et affichée automatiquement (ex: "3h30") dès que les deux heures sont renseignées — pratique pour la facturation. La carte "Séances" affiche aussi la **durée totale du cours** (somme de toutes les séances) en haut, quand au moins une séance a ses deux heures renseignées. Les séances créées avec l'ancienne version (une seule heure) restent affichées normalement, avec l'heure de fin vide.

**Saisie de la date** : le champ Date des séances (partout où il apparaît : nouveau cours, ajout de séance, tableau des séances) utilise désormais le même champ texte "JJ/MM/AAAA" à saisie continue que la date de naissance, plutôt que le sélecteur natif du navigateur — plus fiable sur certains systèmes Windows où ce dernier ne passait pas correctement au mois après les 4 chiffres de l'année. Tapez simplement les 8 chiffres à la suite, les "/" s'insèrent automatiquement.

**Coéquipiers** : gérez une liste globale (Paramètres → "Coéquipiers") avec nom, rôle et email. Sur chaque séance, ajoutez-en un via le menu "+ ajouter..." (il apparaît sous forme de "chip" avec un × pour le retirer). Leur email est automatiquement inclus en copie cachée dans l'email groupé du cours. L'ancien champ texte libre (versions précédentes) reste affiché tel quel si vous en aviez déjà saisi.

## Rapport de cours imprimable

Sur la fiche d'un cours, le bouton **"🖨️ Exporter un rapport (imprimable)"** ouvre un nouvel onglet contenant un rapport complet et autonome : séances, documents généraux du cours, et pour chaque étudiant ses coordonnées et l'état détaillé de sa checklist (pré/post-cours). Un bouton "Imprimer / Enregistrer en PDF" dans l'onglet déclenche l'impression native du navigateur — choisissez "Enregistrer en PDF" comme imprimante pour obtenir un fichier PDF sans rien installer de plus. Si votre navigateur bloque l'ouverture (popup), autorisez les popups pour `localhost` et réessayez.

## Confirmations de suppression

Supprimer un cours ou un étudiant efface réellement des dossiers et documents sur votre disque — ces deux actions demandent maintenant de **retaper le nom exact** dans une fenêtre de confirmation avant que le bouton de suppression ne s'active, pour éviter un clic accidentel.

## Importer un roster (PDF) en une fois

L'application ne peut pas ouvrir votre PDF elle-même, mais vous pouvez déléguer la conversion :
1. Ouvrez une conversation avec Claude et donnez-lui le PDF du roster, en lui demandant de générer un tableau JSON d'étudiants (firstName, lastName, email, phoneCell, etc.).
2. Sur la fiche du cours, cliquez sur **"Importer plusieurs étudiants (JSON)"**, collez le résultat, cliquez sur Importer.
3. Les étudiants (et leurs dossiers) sont créés en un coup ; les doublons (même prénom/nom déjà dans ce cours) sont automatiquement ignorés et listés.

## Emails

Deux façons d'envoyer des emails depuis un cours :

- **Un seul email groupé** (nouveau) : un unique message, adressé à vous-même (champ "À"), avec un CC configurable (ex: le centre partenaire) et en copie cachée (CCI) : tous les étudiants du cours + les coéquipiers ajoutés aux séances de ce cours + votre liste de BCC par défaut. Configurez votre email, votre CC et votre BCC par défaut dans Paramètres → "Vos coordonnées" ; ils sont préremplis à chaque génération mais modifiables au cas par cas avant l'envoi. Comme ce message n'est pas personnalisé par étudiant, les variables `{prenom}`, `{nom}` et `{liste_docs_manquants}` restent vides — préférez `{liste_etudiants}` (liste de tous les noms) si besoin.
- **Un email par étudiant** (personnalisé) : un message distinct par étudiant, avec ses documents manquants à lui. Utile pour les relances individuelles.

Les modèles ne sont plus limités à "convocation" et "rappel" fixes : vous gérez une **bibliothèque de modèles** nommés (Paramètres → "Modèles d'email"), aussi nombreux que vous voulez.

Chaque cours a un **modèle associé par défaut**, choisi à sa création (ou modifiable à tout moment dans la carte "Communications" de la fiche cours — le changement est enregistré automatiquement).

Les modèles supportent la variable `{liste_dates_lieux}` qui insère automatiquement la liste des séances du cours (date, heure, lieu). Une variante plus narrative est disponible : `{liste_dates_lieux_note_coequipier}`, qui formate chaque séance ainsi : *"Rendez-vous le [date] à [heure], [lieu], [notes], et nous serons accompagnés de [coéquipiers]"* (les parties notes/coéquipiers sont omises si vides). Les anciennes variables `{date_debut}`, `{date_fin}`, `{lieu}` restent disponibles si vous préférez un format plus simple.

Vos coordonnées (Paramètres → "Vos coordonnées") sont aussi disponibles comme variables : `{instructeur}` (nom), `{instructeur_padi}` (statut/numéro PADI, ex: "Instructeur PADI #123456"), `{instructeur_tel}` (téléphone) — pratique pour une signature d'email complète.

**Mise à jour depuis une version antérieure :** si vous aviez déjà personnalisé vos modèles convocation/rappel, ils sont migrés automatiquement dans la nouvelle bibliothèque au premier démarrage — à condition de ne pas copier le fichier `data/email_templates.json` du zip par-dessus votre dossier `data/` existant (voir la note ci-dessous).

## Centres partenaires et facturation

Chaque **nouveau** cours doit obligatoirement être associé à un **centre mandataire**, géré dans Paramètres → "Centres partenaires" (nom, contact, adresse, email, téléphone, n° de taxe/référence, notes). Ce centre apparaît sur le tableau de bord, le rapport de cours, et sert d'en-tête "Facturé à" sur les factures. Un cours créé avec une version antérieure de l'application, sans centre, reste consultable et affiche "non défini" — modifiez-le une fois via "Modifier les notes / le centre" pour lui en assigner un.

Sur la fiche d'un cours, le bouton **"🧾 Générer une facture"** calcule automatiquement le montant à partir du **modèle de facturation** (Paramètres → "Facturation") : un prix de base couvrant un nombre minimum d'étudiants pour ce type de cours, plus un montant par étudiant additionnel au-delà de ce minimum. Vous pouvez définir un modèle par défaut et le surclasser pour des types de cours spécifiques. Avant de générer, vous pouvez ajuster le numéro/date de facture, ajouter une ligne de frais additionnels (description + montant) et des notes — ces informations sont conservées avec le cours. La facture s'ouvre ensuite dans un nouvel onglet imprimable, comme le rapport de cours.

## Instructeur certificateur (à partir de la liste de coéquipiers)

Il n'y a qu'une seule liste de personnes à enregistrer : les **coéquipiers** (Paramètres → "Coéquipiers"), qui sert aussi bien pour les séances que pour désigner qui certifie un étudiant — un collègue instructeur est simplement un coéquipier comme un autre (donnez-lui par exemple le rôle "Instructeur" pour le retrouver facilement).

- À la création d'un cours (ou plus tard via "Modifier les notes / le centre / les instructeurs"), choisissez lesquels de vos coéquipiers sont rattachés à **ce** cours — ils apparaissent ensuite dans l'en-tête de la fiche du cours sous "Instructeur(s)".
- Dans la fiche dépliée de chaque étudiant, section **"Certification"**, un menu **"Instructeur certificateur"** permet de désigner lequel des coéquipiers de ce cours a effectivement certifié cet étudiant. Ce choix est enregistré immédiatement et apparaît aussi dans la fiche étudiant globale (colonne "Instructeur certificateur") et sur le rapport imprimable.
- **La case "Certification confirmée" ne peut pas être cochée tant qu'un instructeur certificateur n'a pas été choisi** — elle reste désactivée (grisée) jusque-là, avec un message l'indiquant.
- Si aucun coéquipier n'est rattaché au cours, un lien raccourci permet d'en associer directement depuis la fiche étudiant.

## Documents par glisser-déposer

Vous pouvez maintenant glisser un fichier (scan, photo, PDF) directement dans l'application pour qu'il soit copié automatiquement au bon endroit sur le disque :
- **Documents généraux du cours** : zone de dépôt en bas de la carte "Documents généraux du cours" — le fichier est copié dans le dossier du cours (ex: assurance transmise par le centre, feuille de présence signée).
- **Documents d'un étudiant** : zone de dépôt dans la fiche dépliée de l'étudiant — le fichier est copié dans son dossier.
- **Photos du cours** : chaque cours a désormais systématiquement un sous-dossier **`Photo`**, créé automatiquement à la création du cours (et créé à la volée pour vos cours plus anciens dès que vous ouvrez leur fiche). La carte "Photos du cours" sur la fiche du cours a sa propre zone de dépôt, distincte des documents administratifs, avec un bouton "📂 Ouvrir le dossier Photo" pour y accéder directement dans l'Explorateur.

Dans les deux cas, vous pouvez aussi cliquer sur "parcourir" pour choisir un ou plusieurs fichiers sans glisser-déposer. Si un fichier du même nom existe déjà, une copie est créée (`nom (2).ext`) plutôt que d'écraser l'original. La liste des fichiers réellement présents dans le dossier s'affiche et se met à jour immédiatement après l'envoi.

## Certification confirmée

Dans la fiche dépliée de chaque étudiant, une case **"🎓 Certification confirmée (100%)"** permet de marquer explicitement qu'un étudiant a bien reçu sa certification finale (distinct du % de documents collectés). Une fois cochée, un badge **"🎓 Certifié"** apparaît dans l'en-tête de l'étudiant et sur le rapport imprimable du cours.

Cette case et ce badge ne s'affichent que pour un étudiant dont le statut est **"Certification"** ou **"Cours + Certification"**. Pour un étudiant en **"Cours seulement"**, la certification ne s'applique pas : ni la case, ni le badge ne sont affichés (ni dans la fiche étudiant, ni dans le rapport imprimable).

**Correction (calcul des %)** : le calcul des pourcentages "Pré" et "Post" se base désormais sur la liste des documents définis par le type de cours, plutôt que sur les seules entrées déjà enregistrées pour l'étudiant. Auparavant, une fiche étudiant créée avant l'ajout d'un nouveau document au type de cours pouvait afficher à tort "100%" alors que des documents requis restaient décochés (ils étaient invisibles au calcul faute d'entrée enregistrée). Ce n'était pas une perte de données : rouvrez simplement la fiche de l'étudiant concerné, le pourcentage affiché est maintenant correct.

## Marquer un cours comme complété

Sur la fiche d'un cours, à droite de "Supprimer le cours", une case **"☐ Marquer le cours comme complété"** permet de clôturer manuellement un cours une fois tout le suivi terminé. Une fois cochée, un badge **"✅ Clos"** apparaît à côté du titre du cours.

Sur le tableau de bord, une nouvelle colonne **Statut** indique en un coup d'œil où en est chaque cours :
- **✅ Clos** — le cours a été marqué complété manuellement.
- **⏳ En attente** — les documents pré-cours et/ou post-cours (étudiants + généraux) ne sont pas encore à 100%.
- **🔷 Prêt à clôturer** — tous les documents sont à 100% mais le cours n'a pas encore été marqué complété.

## Sommaire des activités accomplies

Sur le tableau de bord, le bouton **"📋 Sommaire des activités accomplies"** ouvre un rapport imprimable listant tous vos cours (date, type, nombre d'étudiants, centre), triés du plus récent au plus ancien, avec le total de cours et d'étudiants — utile pour un suivi global ou un partenaire qui demande un résumé de votre activité.

## Sauvegarde (backup)

Dans Paramètres, la carte **"Sauvegarde"** crée en un clic une copie .zip de **tout** votre répertoire racine (tous les cours, tous les étudiants, tous les documents et photos) et vous laisse choisir où l'enregistrer (clé USB, disque externe, dossier cloud comme OneDrive/Google Drive, etc.) via la boîte de dialogue "Enregistrer sous" de votre navigateur. Le nom du fichier inclut la date et l'heure : `PLONGEE_BACKUP_AAAAMMJJ_HHMM.zip`.

Pour un gros répertoire (beaucoup de photos/documents), la création peut prendre quelques dizaines de secondes à quelques minutes — le bouton reste désactivé pendant ce temps avec un message "Création en cours...". Cette fonctionnalité utilise l'outil de compression intégré à Windows (`Compress-Archive`), donc aucune installation supplémentaire n'est nécessaire.

## Recherche et filtres sur le tableau de bord

Au-dessus de la liste des cours, une barre de recherche filtre instantanément par nom de cours, centre ou étudiant, et deux listes déroulantes filtrent par centre ou par type de cours. Un second champ, **"Ouvrir la fiche globale d'un étudiant"**, propose un étudiant au fil de la frappe et ouvre directement sa fiche (voir section suivante) sans avoir à d'abord retrouver un de ses cours.

## Fiche étudiant globale

Comme un même étudiant peut suivre plusieurs cours au fil du temps, chaque fiche étudiant (dans un cours) affiche un lien **"fiche globale"** à côté de son nom. Cette fiche réunit :
- l'historique de tous ses cours (date, type, centre, % pré/post-cours, certification), cliquable pour rouvrir le cours concerné ;
- ses coordonnées (les plus récentes), modifiables en un seul endroit avec le bouton **"Mettre à jour partout"**, qui reporte le changement sur le dossier de cet étudiant dans chacun de ses cours — plus besoin de corriger un numéro de téléphone cours par cours.

## Navigation par onglets dans la fiche de cours

La fiche d'un cours est organisée en 3 onglets — **Séances & Photos**, **Documents & communications**, **Étudiants** — pour éviter d'avoir à faire défiler toute la page quand un cours compte plusieurs étudiants. Le résumé du cours (dates, site, centre, % globaux, actions) reste visible en haut, hors onglets. L'onglet actif est conservé lors des rafraîchissements (ex. après l'ajout d'un étudiant).

## Fiabilité des actions et messages d'erreur

Les boutons de création/enregistrement (nouveau cours, nouvel étudiant, facture, import, et tous les formulaires de Paramètres) se désactivent le temps de la requête, pour éviter qu'un double-clic ne crée deux fois la même chose. Les messages d'erreur imprévus affichent désormais un texte compréhensible plutôt qu'un code technique brut.

## Mettre à jour l'application sans perdre vos données

Quand vous recevez une nouvelle version (nouveau zip) :
- **Remplacez toujours** : `server.js`, tout le dossier `public/`, `README.md`, et les scripts `.bat`/`.vbs` à la racine.
- **Ne copiez jamais** les fichiers du dossier `data/` par-dessus les vôtres si vous avez déjà personnalisé vos types de cours, sites, champs étudiant, modèles d'email, centres ou facturation — ces fichiers contiennent votre travail. L'application crée automatiquement tout nouveau fichier nécessaire (ex: `centers.json`, `billing.json`) au premier démarrage.

## Notes techniques

- Le serveur tourne uniquement sur votre machine (`localhost:4531`), rien n'est envoyé sur internet.
- Les paramètres, types de cours et sites sont stockés dans le dossier `data/` de l'application (pas dans votre répertoire racine de données).
- Le bouton "Ouvrir dans l'Explorateur" utilise la commande Windows `explorer` — fonctionne sous Windows. Sous macOS/Linux il faudrait l'adapter (dites-le moi si besoin).
