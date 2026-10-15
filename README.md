# Terminplaner

Gantt-Terminplaner der Zimmerei Heinlein für die gemeinsame Projektplanung im Team.

**Funktionen**

- Vorgänge, Untervorgänge (Sammelvorgänge) und Meilensteine mit Verantwortlichen
- Abhängigkeiten Ende-Anfang, Anfang-Anfang, Ende-Ende, Anfang-Ende mit Versatz, grafisch als Pfeile
- Dauer in Arbeitstagen (mit Feiertagen) oder Kalendertagen, Raster Tage oder Wochen
- Ansichten: Gantt, Liste, Kanban (eigene Bahnen), Kalender
- PDF-Export als eine durchgehende Seite im Querformat, CSV- und JSON-Export
- Mehrere Projekte, Teamarbeit mit Live-Abgleich, zeilenweises Zusammenführen gleichzeitiger Änderungen
- Benutzer mit Rollen, Versionsverlauf (40 Stände je Projekt), Sicherung und Wiederherstellung

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/` | Quellcode der Oberfläche (`head.html`, `body.html`, `logic.js`, `ui.js`, `views.js`, `pdf.js`), Verwaltungs- und Einrichtungsseite, Server-Anbindung `server-api.js` |
| `api/tp.js` | Vercel-Funktion, alle Aktionen über `/api/tp?a=<aktion>` |
| `lib/` | Server: Datenbank (`db.js`), Anmeldung (`auth.js`), Aktionen (`handler.js`) |
| `scripts/build.mjs` | baut `public/` (Website) und `claude/` (Claude-Version) |
| `scripts/dev-server.mjs` | lokaler Testserver, ohne Datenbank-URL mit Datenbank im Arbeitsspeicher |
| `claude/terminplaner-claude.html` | dieselbe Oberfläche als Claude-Artifact (Speicherung über Claude) |

Die Website lädt nichts von fremden Servern: keine Google Fonts, der PDF-Baustein (jsPDF) liegt lokal unter `public/vendor/`.

## Auf Vercel veröffentlichen

1. **Projekt anlegen:** In Vercel *Add New → Project*, dieses GitHub-Repository importieren. Framework: *Other*. Build-Befehl und Ausgabeordner kommen aus `vercel.json`.
2. **Datenbank:** Im Projekt unter *Storage* eine Postgres-Datenbank von **Neon** hinzufügen, Region **Frankfurt (eu-central-1)**. Vercel setzt `DATABASE_URL` automatisch. Die Tabellen legt der Terminplaner beim ersten Aufruf selbst an.
3. **Umgebungsvariablen** unter *Settings → Environment Variables*:
   - `SESSION_SECRET`: mindestens 32 zufällige Zeichen, z. B. aus `openssl rand -base64 48`
   - `SETUP_KEY`: ein selbst gewählter Einrichtungsschlüssel (mind. 8 Zeichen)
4. **Deploy** auslösen (oder erneut deployen, nachdem die Variablen gesetzt sind).
5. Die Seite öffnen. Beim ersten Aufruf erscheint die **Einrichtung**: `SETUP_KEY` eingeben und den ersten Administrator anlegen.
6. Unter **Verwaltung** die Kollegen anlegen:
   - *Bearbeiten*: Pläne ansehen und ändern
   - *Nur lesen*: Pläne ansehen und exportieren
   - *Administrator*: zusätzlich Benutzer, Sicherung und Versionsverlauf

Die Funktionen laufen in der Region Frankfurt (`fra1`, siehe `vercel.json`).

## Lokal ausprobieren

```bash
npm install
npm run dev          # http://localhost:3000, Einrichtungsschlüssel: lokal1234
```

Ohne `DATABASE_URL` läuft eine Datenbank im Arbeitsspeicher, die beim Beenden verloren geht. Mit einer echten Datenbank:

```bash
DATABASE_URL="postgres://…" SESSION_SECRET="…" SETUP_KEY="…" npm run dev
```

## Sicherung

- *Verwaltung → Alle Projekte sichern* lädt eine JSON-Datei mit allen Projekten, *Sicherung einspielen* stellt sie wieder her.
- Der Versionsverlauf hält die letzten 40 Speicherstände je Projekt.
- Zusätzlich sichert Neon die Datenbank selbst (Point-in-Time-Restore je nach Tarif).

## In Microsoft Teams einbinden

In einem Kanal *+ → Website* wählen und die Vercel-Adresse eintragen. Die nötige Freigabe (`frame-ancestors`) ist in `vercel.json` bereits gesetzt.

## Entwickeln

Änderungen an der Oberfläche in `src/` vornehmen, dann `npm run build`. `npm test` prüft die Terminberechnung.
