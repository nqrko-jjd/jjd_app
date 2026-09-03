# apps/mobile — JJD Chantier

Appli terrain + admin (Expo / React Native, hors workspaces npm).

```bash
cd apps/mobile
npm install
npx expo start   # QR code -> Expo Go
```

Navigation selon le role :
- **ouvrier** : Aujourd hui (planning + compteur start/stop hors-ligne), Mes heures, Compte
- **chef de chantier** : idem + Tableau de bord, Chantiers, Planning, Valider
- **bureau / admin** : Tableau de bord, Chantiers (+ fiche + rentabilite), Planning, Valider, Compte

L API doit tourner (port 4100). URL auto-detectee (IP LAN Metro). Pare-feu Windows : port 4100.

**A tester avec David sur un vrai telephone** (reseau, Expo Go, pare-feu).
