# Terminplaner

Gantt-Terminplaner für die gemeinsame Projektplanung im Team.

**Funktionen**

- Vorgänge, Untervorgänge (Sammelvorgänge) und Meilensteine mit einer oder mehreren verantwortlichen Personen
- Verantwortliche aus den Benutzerkonten suchen und per Häkchen zuordnen; mehrere Personen als Initialen mit vollständigen Namen beim Darüberfahren anzeigen
- Fortschritt je Untervorgang in 10-%-Schritten; ein Vorgang ist erst bei 100 %, wenn alle Untervorgänge erledigt sind, das Projekt erst, wenn alle Vorgänge 100 % haben; Fortschrittsbalken in allen Ansichten
- Rubrik „Aufgaben“: To-dos anlegen, mehreren Teammitgliedern zuweisen, Termin, Priorität und Bezug zu einem Vorgang; neu Zugewiesene bekommen eine E-Mail, zwei Tage vor dem Termin eine Erinnerung
- Wochenübersicht per E-Mail jeden Montag: Vorgänge und Aufgaben der Woche, Überfälliges und offene Aufgaben ohne Termin (im Profil abschaltbar)
- Darstellung umschaltbar: automatisch, Desktop oder Mobil (je Gerät gespeichert)
- Als App installierbar (PWA): auf dem Handy über „Zum Home-Bildschirm“ bzw. „App installieren“, startet im Vollbild mit eigenem Symbol; mobil mit Navigationsleiste am unteren Rand
- Am Handy und Tablet voll bedienbar: Kanban-Karten, Organigramm, Zeilen und Gantt-Balken lassen sich per Finger ziehen (Kanban und Organigramm: lange drücken, dann ziehen); Organigramm mobil untereinander mit eingerückten Unterteams
- Termine im Detailfenster über Start + Ende, Start + Dauer oder Ende + Dauer eingeben; neue Vorgänge öffnen gleich die Detailmaske
- Balken im Gantt-Diagramm ziehen: verschieben (Start), rechtes Ende (Dauer), linkes Ende (Start bei gleichem Ende); Nachfolger passen sich an
- Organigramm (Ansicht „Team“): Projektleitung nebeneinander, darunter Teams und Unterteams mit Teamleitung und untereinander gelisteten Teammitgliedern; Personen mit Bild, Name und Rolle, auch in mehreren Teams (Hauptteam, Rolle je Team); per Ziehen zuordnen (zusätzlich zuordnen mit Strg/Alt oder dem Schalter „Zusätzlich zuordnen“)
- Eigene Farben je Vorgang (Detailfenster), sichtbar in Gantt, Liste, Kanban, Kalender und PDF
- Spalten je Person ein- und ausblenden und in der Breite anpassen; Untervorgänge je Sammelvorgang ein- und ausklappen
- Mehrere Vorgänger je Vorgang, jeweils mit Beziehung (EA, AA, EE, AE) und Versatz; bearbeitbar im Detailfenster, der späteste Vorgänger bestimmt den Start; Vorgänger, die einen Zirkelbezug erzeugen würden, sind nicht wählbar
- Feiertage automatisch: Bundesland wählen, alle gesetzlichen Feiertage werden berechnet (alle 16 Länder, jedes Jahr); dazu eigene freie Tage und Zeiträume wie Betriebsurlaub
- Rolle „Nur Gantt ansehen“ (Verwaltung → Benutzer): sieht nur den Terminplan als Gantt-Diagramm und kann ihn als PDF exportieren; Aufgaben, Organigramm, Beschreibungen und Kommentare liefert der Server an diese Rolle gar nicht aus
- PDF-Export zum Drucken: Terminplan (Gantt) und/oder Organigramm, je eine Seite im Querformat; beim Terminplan Auswahl der Spalten, des Zeitraums und der Vorgänge; das Organigramm mit Fotos, Projektleitung, Teams, Unterteams und „Noch ohne Team“
- Vorgänge, Untervorgänge und Meilensteine per Ziehen und Ablegen verschieben (Tastatur: Griff fokussieren, Pfeil hoch/runter); Löschen im Detailfenster
- Änderungsprotokoll: jede Änderung mit Person und Zeit, als Eintrag im Verlauf des Vorgangs; von anderen geänderte Vorgänge werden markiert, bis man sie öffnet; Administratoren sehen das gesamte Protokoll und wer zuletzt bearbeitet hat
- Detailfenster je Vorgang mit Beschreibung und Kommentaren; @-Erwähnungen benachrichtigen per E-Mail (optional zusätzlich in einem Teams-Kanal)
- Abhängigkeiten Ende-Anfang, Anfang-Anfang, Ende-Ende, Anfang-Ende mit Versatz, grafisch als Pfeile
- Dauer in Arbeitstagen (mit Feiertagen) oder Kalendertagen, Raster Tage oder Wochen
- Ansichten: Gantt, Liste, Kanban (eigene Bahnen), Kalender
- Aufklappbare Filter für Suche, Person und Status in allen Ansichten, auch bei mehreren Verantwortlichen
- PDF-Export als eine durchgehende Seite im Querformat, CSV- und JSON-Export
- Mehrere Projekte, Teamarbeit mit Live-Abgleich, zeilenweises Zusammenführen gleichzeitiger Änderungen
- Benutzer mit Rollen und Profilbild, eigenes Passwort und E-Mail-Adresse unter „Mein Profil“
- Tickets: Ideen, Probleme und Fragen an die Administratoren, mit Antwort per E-Mail
- E-Mail-Erinnerung 2 Tage vor dem Ende eines Vorgangs an die verantwortliche Person
- Zeitachse zoombar von 40 % bis 400 %
- Versionsverlauf (40 Stände je Projekt), Sicherung und Wiederherstellung

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/` | Quellcode der Oberfläche (`head.html`, `body.html`, `logic.js`, `ui.js`, `views.js`, `pdf.js`), Verwaltungs- und Einrichtungsseite, Server-Anbindung `server-api.js` |
| `api/tp.js` | Vercel-Funktion, alle Aktionen über `/api/tp?a=<aktion>` |
| `api/cron-reminders.js` | täglicher Erinnerungs-Job (Vercel Cron, siehe `vercel.json`) |
| `lib/` | Server: Datenbank (`db.js`), Anmeldung (`auth.js`), Aktionen (`handler.js`), E-Mail (`mail.js`), Erinnerungen (`reminders.js`), Terminberechnung (`logic.cjs`, erzeugt aus `src/logic.js`) |
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
   - `CRON_SECRET`: mindestens 16 zufällige Zeichen, schützt den täglichen Erinnerungs-Job
   - E-Mail (für Erinnerungen und Tickets), siehe nächster Abschnitt
4. **Deploy** auslösen (oder erneut deployen, nachdem die Variablen gesetzt sind).
5. Die Seite öffnen. Beim ersten Aufruf erscheint die **Einrichtung**: `SETUP_KEY` eingeben und den ersten Administrator anlegen.
6. Unter **Verwaltung** die Kollegen anlegen:
   - *Bearbeiten*: Pläne ansehen und ändern
   - *Nur lesen*: Pläne ansehen und exportieren
   - *Administrator*: zusätzlich Benutzer, Sicherung und Versionsverlauf

Die Funktionen laufen in der Region Frankfurt (`fra1`, siehe `vercel.json`).

## E-Mail einrichten

Der Terminplaner verschickt Erinnerungen und Ticket-Benachrichtigungen. Dafür eine der beiden Varianten:

- **SMTP eines vorhandenen Postfachs** (am schnellsten, z. B. Gmail): `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` = Gmail-Adresse, `SMTP_PASS` = ein *App-Passwort* (Google-Konto → Sicherheit → Bestätigung in zwei Schritten einschalten → App-Passwörter), `MAIL_FROM` = `Terminplaner <dieselbe Gmail-Adresse>`. Andere Anbieter (GMX, web.de, Outlook.com …) funktionieren genauso mit deren SMTP-Daten.
- **Resend** mit eigener Domain: Konto bei resend.com, eigene Domain über die angezeigten DNS-Einträge verifizieren (Region Ireland), API-Schlüssel anlegen, in Vercel `RESEND_API_KEY` und `MAIL_FROM` (z. B. `Terminplaner <terminplaner@deine-domain.de>`) setzen. Liegt die Domain bei Vercel, richtet die Resend-Integration im Vercel Marketplace die DNS-Einträge automatisch ein.

**Teams (optional):** In einem Teams-Kanal über *Workflows* die Vorlage „Bei Empfang einer Webhookanforderung in einem Kanal posten“ einrichten und die erzeugte Adresse als `TEAMS_WEBHOOK_URL` in Vercel eintragen. Dann erscheint bei jedem Kommentar mit @-Erwähnung eine Nachricht in diesem Kanal.

Unter *Verwaltung → E-Mail und Erinnerungen* zeigt der Terminplaner, ob der Versand eingerichtet ist, und kann eine Testmail schicken.

**Erinnerungen:** Täglich gegen 7 Uhr (Winterzeit 6 Uhr) prüft der Job alle Projekte. Wer einem noch nicht erledigten Vorgang als Benutzer zugeordnet ist, eine E-Mail-Adresse hinterlegt und Erinnerungen eingeschaltet hat, bekommt 2 Tage vor dem Ende eine Mail. Bestehende Namenseinträge werden bei eindeutiger Übereinstimmung zugeordnet. Jede Erinnerung geht nur einmal raus; verschiebt sich das Ende, wird neu erinnert.

## Lokal ausprobieren

```bash
npm install
npm run dev          # http://localhost:3000, Einrichtungsschlüssel: lokal1234
```

Ohne `DATABASE_URL` läuft eine Datenbank im Arbeitsspeicher, die beim Beenden verloren geht. E-Mails werden lokal nur in der Konsole ausgegeben und sind unter `http://localhost:3000/__outbox` einsehbar. Mit einer echten Datenbank:

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

Änderungen an der Oberfläche in `src/` vornehmen, dann `npm run build`. `npm test` prüft die Terminberechnung und die Filterfunktionen.
