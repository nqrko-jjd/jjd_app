# apps/mobile — JJD Chantier

Appli terrain (Expo / React Native, hors workspaces npm).

```bash
cd apps/mobile
npm install
npx expo start   # QR code -> Expo Go
```

L API doit tourner (port 4100). En dev, l URL de l API est auto-detectee
(IP LAN de la machine Metro). Pare-feu Windows : autoriser le port 4100.

Ecrans : connexion, Aujourd hui (planning du jour + compteur start/stop,
file d attente hors-ligne), Mes heures (decompte du mois), Compte.

**A tester avec David sur un vrai telephone** (reseau, Expo Go, pare-feu).
