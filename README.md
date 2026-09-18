# NEOLITIK Planning

Application React/Vite de planification des équipes, avec stockage Supabase et déploiement Vercel. Les règles du moteur et de la paie sont partagées entre l'application et ses tests.

## Utilisation

1. Dans **Équipe**, régler les niveaux N1–N4, désigner les **chefs** et choisir les **binômes**. Le rôle de chef est indépendant du niveau. À la migration, les anciens N4 deviennent chefs pour conserver le comportement existant.
2. Choisir l'année et les semaines à planifier. Le calcul cherche exactement **un chef par poste ouvert**, au moins **trois personnes la nuit**, puis minimise les nuits consécutives et équilibre les rotations selon la présence.
3. Les binômes disponibles restent ensemble. Le lien est réciproque et exclusif ; l'absence d'un membre n'empêche pas l'autre de travailler. Deux chefs ne peuvent pas former un binôme. Le mode volant s'applique aux deux membres.
4. Lire les alertes : une alerte rouge empêche la publication ; une nuit consécutive nécessaire produit une alerte orange. Un effectif insuffisant ne peut pas être résolu sans remplaçant ou changement d'organisation.
5. **Publier** met à jour l'instantané en lecture seule. Le bandeau « Modifications non publiées » rappelle quand le brouillon diffère de cet instantané.

Les glissements et échanges déplacent les binômes ensemble, sans empiler deux chefs. **Recalculer** retire les ajustements hebdomadaires de la fenêtre affichée modifiable ; les semaines archivées, les ajustements plus éloignés, les verrous individuels et les ajustements journaliers sont conservés.

### Affectations verrouillées

Dans le panneau **Affectations à conserver lors du recalcul**, choisir une semaine, une personne et un poste. Son binôme suit. Les autres affectations restent calculées. **Déverrouiller** rend la personne au calcul automatique. Des verrous incompatibles déclenchent des alertes et empêchent la publication.

### Remplacements à la journée

Une absence partielle qui laisse un poste sans chef ou la nuit avec moins de trois personnes déclenche une recherche de remplacement pour la journée concernée. Elle privilégie le minimum de changements. Les chefs supplémentaires peuvent servir de réserve. Si aucune proposition conforme n'est trouvée, l'alerte reste visible.

Dans **Jours → Affectations**, consulter ou modifier une seule date, demander une proposition et enregistrer l'ajustement. Les volants restent exclus de la recherche automatique ; une case permet de les inclure dans une proposition explicite. **Revenir au calcul automatique** efface l'ajustement de cette date. Les changements de poste journaliers sont contrôlés avec un minimum de planification de 11 heures entre deux postes voisins de la même semaine ; ce contrôle ne constitue pas un audit réglementaire complet.

Les remplacements apparaissent dans la vue Jours et dans un résumé des autres vues, l'impression, le CSV et la publication. Le récapitulatif mensuel compte les personnes effectivement affectées chaque jour. Une réserve non postée ne génère pas d'heures postées. Les compteurs de rotation de l'onglet Équité restent exprimés en semaines ; la paie reflète les ajustements journaliers.

## Données et migration

Aucune nouvelle table ou colonne n'est nécessaire. Les champs `isLeader`, `partnerId`, `employmentFrom` et `employmentTo` utilisent le JSON `data` de `neolitik_operators`.

La clé `planning_years` de `neolitik_config` contient les données par année ISO : absences, congés, ajustements hebdomadaires, verrous, samedis, fermetures, horaires, notes, historique annuler/rétablir et dernier brouillon. Les ajustements journaliers utilisent une date `YYYY-MM-DD` à l'intérieur de cette année. Les règles d'accès de Supabase doivent autoriser cette clé comme les autres configurations.

Au premier chargement, les anciennes données sont attribuées à l'année enregistrée dans l'application. Les anciennes clés sont conservées sans modification ; la migration n'est pas rejouée lorsqu'un stockage annuel existe. Une nouvelle année commence sans recopier les absences ni les ajustements de l'année précédente. Les dates d'arrivée et de départ gardent leur année : un contrat terminé ne réapparaît pas l'année suivante.

Les **archives existantes ont priorité absolue**. Une semaine passée sans archive est figée depuis le dernier brouillon ou l'instantané publié ; à défaut, elle est reconstruite avec l'ancien moteur. Une reconstruction est signalée et doit être rapprochée des éléments de paie : elle ne prouve pas le planning réellement travaillé. Les affectations journalières sont archivées avec la semaine. Une absence rétroactive reste possible pour corriger les heures sans déplacer les affectations archivées.

Le récapitulatif mensuel suit les dates calendaires et les années ISO, y compris les jours de décembre rattachés à janvier et les premiers jours de janvier rattachés à décembre. Les historiques d'absences qui n'ont jamais été enregistrés par année ne peuvent pas être récupérés par la migration. Les règles existantes sont conservées : 7 heures payées par poste, nuit 22 h–6 h, heures supplémentaires au-delà de 35 h/semaine réparties entre les mois au prorata.

Les lectures et écritures vérifient les erreurs HTTP. Les écritures d'une page sont ordonnées ; un échec reste visible et peut être réessayé. Un échec de lecture bloque l'interface sans sauvegarder les valeurs par défaut. Une erreur de sauvegarde empêche la publication. La suppression d'une personne présente dans les archives est refusée ; utiliser sa fin de contrat ou sa désactivation.

## Limites conservées

- Le calendrier est lundi–vendredi avec samedi optionnel. Le dimanche n'est pas planifié : ce calendrier ne couvre donc pas une exploitation 24/7 complète.
- Les niveaux sont des informations de qualification ; aucun seuil de compétence métier supplémentaire n'a été inventé.
- La recherche examine les répartitions complètes et anticipe une semaine. Elle ne garantit pas l'optimum global sur plusieurs mois. Une limite de calcul explicite empêche de publier un résultat dont la recherche a été tronquée.
- L'équité et la prévention des semaines de nuit consécutives reposent sur les rotations hebdomadaires. Les arrangements journaliers restent visibles et sont comptés en paie.
- L'authentification et les politiques RLS de production ne sont pas modifiées. Les autorisations nominatives et la gestion de deux administrateurs simultanés restent des travaux distincts.

## Développement et tests

```bash
npm ci
npm test
npm run build
npm run test:html
```

`test-algo.html` s'ouvre hors ligne par double-clic. Il est généré depuis les vrais modules de l'application, sans copie manuelle du moteur. Le régénérer après modification des règles ou des tests.

```bash
npx playwright install chromium
npm run test:ui
```

Les tests navigateur démarrent Vite et simulent Supabase intégralement : aucune écriture de production. `TEST_BASE_URL` permet d'utiliser un serveur existant et `CHROMIUM_EXECUTABLE` un Chromium installé.

La suite couvre notamment les rôles, binômes, nuits consécutives, effectifs insuffisants, contrats, archives, remplacements journaliers, verrous, séparations annuelles, limites ISO, paie, sauvegardes, annuler/rétablir et publication.

## Déploiement

Le dépôt existant et son circuit GitHub/Vercel sont conservés. Au premier usage, vérifier les rôles dans Équipe, les éventuelles archives reconstruites et les alertes, puis republier l'instantané après vérification du planning.

Un retour à l'ancien code ne supprime pas les nouveaux champs, mais l'ancien code ignore `planning_years`. Les anciennes clés conservées représentent l'état d'avant migration : un retour au code antérieur nécessite donc de reprendre explicitement les modifications saisies depuis la migration avant de travailler à nouveau avec cet ancien code.
