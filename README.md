# Dashboard Ops

Un tableau de bord qui affiche ce que tu veux, mis à jour tout seul :
- **Outlook** (mails + règles d'extraction) et **Excel** (SharePoint, OneDrive, disque réseau)
- **N'importe quel site où tu es connecté** (Qargo, portails clients, WMS…) grâce à l'extension

```
dashboard/        la page du dashboard → à mettre sur GitHub Pages
extension/        l'extension Chrome/Edge "Dashboard Ops - Connecteur"
option-netlify/   (facultatif) version avec serveur pour les webhooks Qargo officiels
```

Mise en place : **une seule fois, environ 20 minutes.** Ensuite tout se met à jour automatiquement.

---

## Étape 1 — Mettre le dashboard en ligne (GitHub Pages, gratuit)

1. Créer un compte sur github.com (si besoin) → **New repository** → nom `dashboard-ops` → **Public** → *Create*.
   (GitHub Pages gratuit = dépôt public. Le code est visible mais il ne contient aucune donnée ni mot de passe :
   tes données restent dans ton navigateur.)
2. *Add file > Upload files* → glisser **les 2 fichiers** du dossier `dashboard/` (`index.html`, `auth.html`) → *Commit*.
3. *Settings > Pages* → Source : **Deploy from a branch** → Branch : `main` / `(root)` → *Save*.
4. Une minute plus tard : ton dashboard est à `https://TON-PSEUDO.github.io/dashboard-ops/`
   → l'ajouter en favori (et sur l'écran d'accueil du téléphone).

Mise à jour du dashboard plus tard : remplacer `index.html` sur GitHub, c'est tout.

## Étape 2 — Installer l'extension (Chrome ou Edge)

1. Ouvrir `chrome://extensions` (ou `edge://extensions`) → activer **Mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → choisir le dossier `extension/`.
3. Épingler l'icône (puzzle → punaise).
4. Ouvrir ton dashboard → cliquer sur l'icône de l'extension → **Associer ce dashboard**.

Si le bouton « Mode développeur » est grisé, ton PC est verrouillé par l'entreprise : utilise un PC/navigateur où c'est permis,
ou passe par les mails/exports Qargo (étape 3).

## Étape 3 — Brancher tes sources (une fois par source)

### Un site web (Qargo ou autre)
1. Se connecter normalement au site et aller sur la page qui affiche les données voulues (ex. planning des trajets).
2. Icône de l'extension → **Activer sur ce site** → la page se recharge.
3. Rouvrir l'extension → liste des **données détectées** (avec le nombre de lignes et les colonnes) →
   **Utiliser** sur celle qui correspond → donner un nom (ex. `Qargo trajets`) → choisir l'heure de mise à jour → **Créer la source**.
4. Dans le dashboard : **+ Widget** → source *Extension* → données `Qargo trajets` → tableau, chiffre clé, barres…

Astuce : sur Qargo, applique tes filtres (date du jour, client) **avant** de créer la source : la mise à jour quotidienne
rouvrira exactement cette page avec ces filtres.

### Outlook / SharePoint / OneDrive
1. https://entra.microsoft.com → *App registrations > New registration* → nom `Dashboard Ops`, *cet annuaire uniquement*,
   redirect URI de type **Single-page application (SPA)** = l'adresse affichée dans ⚙ Réglages du dashboard
   (`https://TON-PSEUDO.github.io/dashboard-ops/auth.html`).
2. Copier *Application (client) ID* et *Directory (tenant) ID* → ⚙ Réglages → coller → **Se connecter**.
3. ⚙ → source **Outlook** → *Activée*. Pour Excel : ⚙ → Ajouter *Excel SharePoint* → coller le lien de partage.

Si TML bloque l'enregistrement d'applications, cette partie demande l'IT. Le reste (extension, Excel local) fonctionne sans.

Règles mails (transformer des mails en données), dans la source Outlook :
```json
[{ "name": "Retards transport", "match": { "subject": "retard" },
   "extract": { "camion": "camion\\s*:?\\s*([A-Z0-9-]+)", "retard_min": "(\\d+)\\s*min" } }]
```

---

## Comment ça se met à jour tout seul

| Source | Mise à jour | Condition |
|---|---|---|
| Sites via l'extension | **chaque jour à l'heure choisie** (l'extension ouvre la page en arrière-plan, lit les données, referme l'onglet) + à chaque fois que tu consultes le site | navigateur ouvert, session du site encore valide |
| Outlook / Excel SharePoint | toutes les X secondes tant que le dashboard est ouvert | connecté à Microsoft |
| Excel local | toutes les X secondes tant que le dashboard est ouvert | Chrome/Edge, fichier autorisé |

- PC éteint à l'heure prévue → rattrapage automatique au prochain démarrage du navigateur.
- Mise à jour immédiate : bouton ↻ dans l'extension, ou clic sur la pastille « Extension » du dashboard.
- Session expirée (ex. Qargo te déconnecte) → l'extension affiche « session expirée » : ouvre le site, reconnecte-toi, c'est reparti.
  Cocher « rester connecté » sur le site évite la plupart des déconnexions.
- Pour que Chrome tourne même fenêtre fermée : *Paramètres > Système > Poursuivre l'exécution d'applications en arrière-plan*.

## Sécurité
- L'extension ne lit que le **contenu des réponses** des sites que tu as activés : jamais ton mot de passe, tes cookies ni tes jetons.
- Les données restent **sur ton PC** (stockage de l'extension) et ne sont envoyées qu'au dashboard que tu as associé.
- La config du dashboard (widgets, sources) est gardée dans ton navigateur : ⚙ **Exporter / Importer** pour la copier sur un autre PC.
- Lire automatiquement un site avec ton compte peut être encadré par les conditions d'utilisation de ce site : en cas de doute,
  vérifie avec ton responsable.

## Option Netlify (facultatif)
Le dossier `option-netlify/` contient la version avec serveur : webhooks Qargo officiels en temps réel, config partagée
entre appareils. Utile seulement si l'admin Qargo active les webhooks. Guide dans `option-netlify/README.md`.
