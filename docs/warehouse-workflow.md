# Parcours magasinier — scan, préparation et réception

Le scan libre fonctionne par lot : action et chantier choisis avant le premier article, zone active conservée entre validations, quantité modifiable dans la liste. Le mode continu (+1 par lecture, conditionnements conservés) est activé par défaut ; une préférence explicite existante pour la fenêtre de quantité reste respectée. Le réglage est accessible dans Options.

Une étiquette de zone s'applique aux prochaines lectures et aux lignes sans zone. Les lignes déjà rangées ailleurs conservent leur emplacement. Le même produit dans deux zones reste sur deux lignes. Les références de racks renvoyées par l'API sont reconnues, même sans préfixe BRZ/RACK.

Les scans sont résolus en séquence pour conserver l'ordre zone/article et éviter les écritures concurrentes de préparation depuis un même écran. Les corrections Zebra/DataWedge (focus synchrone et clavier masqué) sont conservées. Une rafale de scan arrivant dans le champ de quantité est routée vers le lecteur au lieu d'être enregistrée comme une quantité. Pendant la validation, le lecteur et les corrections sont bloqués.

La préparation chantier montre les articles restant à préparer, avec une action Tout préparer. Les articles prêts sont accessibles via Voir les prêts ; les champs manuels sont ouverts par Ajuster. Les scans enregistrent la préparation ; seul Terminer déclenche la sortie de stock, selon l'API existante.

La réception fournisseur garde les quantités en attente jusqu'à Valider la réception. Tout reçu et Ajuster permettent la réception en quantité. Les lignes déjà réceptionnées sont repliées ; la zone reste choisie pour le lot suivant. Les unités alternatives et les avertissements de dépassement sont conservés.

Aucune modification de schéma, de rôle ou des intégrations Bricoloc. Les APIs existantes restent utilisées. Une validation de scan libre est séquentielle, pas une transaction globale multi-services : les lignes confirmées sont retirées immédiatement, les lignes restantes sont conservées en cas d'erreur. Une rupture réseau après écriture peut laisser le résultat inconnu ; l'écran demande alors de contrôler l'historique avant une nouvelle tentative. Il n'y a pas de relance automatique.

## Vérification

Le workflow warehouse-ui-checks réalise compilation/typecheck et recette Chromium sur 390, 768 et 1440 pixels, avec API entièrement simulée et données fictives. Il couvre le scan continu, les quantités cumulées, le maintien des zones, deux zones pour le même article, une zone sans préfixe, l'échec partiel sans rejouer les lignes confirmées, les préparations en séquence et la réception fournisseur. Les captures sont déposées dans l'artefact warehouse-browser-screenshots.

Une recette physique du lecteur Zebra reste nécessaire pour le matériel réel. Ce workflow ne contacte ni serveur de production ni fournisseur, ne charge aucun secret et n'effectue aucun déploiement.
