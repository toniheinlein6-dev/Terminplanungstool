# Terminplaner – Hinweise für Claude Code

Gantt-Terminplaner für ein studentisches Projektteam der Hochschule Biberach
(Gantt, Liste, Kanban, Kalender, Aufgaben, Organigramm/Team). Ansprechpartner: Toni.
Sprache im Code, in Kommentaren, Oberfläche und Commits: **Deutsch**.

## Arbeitsweise (bitte einhalten)

1. **Erst zeigen, dann pushen.** Bei sichtbaren Änderungen (Oberfläche, Optik) vor dem
   Commit Screenshots zeigen bzw. die Änderung kurz zusammenfassen und auf Freigabe warten.
   Kleine, eindeutig gewünschte Korrekturen dürfen direkt committet werden.
2. **Commit und Push gehören dazu.** Nach Freigabe selbst committen und pushen:
   ```bash
   npm test                      # baut und testet; muss grün sein
   git add -A && git commit      # Nachricht auf Deutsch, erste Zeile kurz, darunter Stichpunkte
   git push origin HEAD:main
   ```
   Vercel baut nach dem Push automatisch (`npm run build`, Ausgabe `public/`).
3. Antworten im Chat als Text, keine Word-Dateien.
4. Zugangsdaten **nie** ins Repository, nur als Umgebungsvariablen (siehe unten).

## Aufbau

Alles wird in **`src/`** bearbeitet. `scripts/build.mjs` erzeugt daraus:

| Ziel | Inhalt | im Git |
|---|---|---|
| `public/` | Website für Vercel; Skripte als eigene Dateien (`app.js`, `admin.js`, `setup.js`), weil die CSP nur `script-src 'self'` erlaubt | nein (gitignore) |
| `claude/terminplaner-claude.html` | eine Datei für das Claude-Artifact (gemeinsame Claude-Datenbank) | ja |
| `lib/logic.cjs` | Planungslogik für Server und Tests (aus `src/logic.js`, via `scripts/gen-logic.mjs`) | ja |

Die Client-Skripte werden in dieser Reihenfolge zu **einem** Skript zusammengefügt
(gemeinsamer Gültigkeitsbereich, kein Modulsystem): `logic.js, people.js, ui.js, views.js,
gantt-ext.js, tasks.js, org.js, touch-dnd.js, assignee-picker.js, pdf.js, shell.js`, danach `boot()`.
Neue Dateien in `scripts/build.mjs` eintragen.

- `src/head.html` – Titel, Farbtoken (hell/dunkel, `data-tp-theme`), gesamtes CSS
- `src/body.html` – Markup: Menüleiste, Projektliste, Kopf, Kennzahlen, Werkzeugleiste, Ansichten, Dialoge
- `src/ui.js` – Zustand, Tabelle, Zeitachse, Speichern/Abgleich (`initStore`, `attach`, `persist`, Dreiwege-Merge)
- `src/views.js` – Liste, Kanban, Kalender, Filter, Detailfenster
- `src/shell.js` – Menüleiste (`menuDefs`), Tastenkürzel, Kennzahlen (`paintKpis`), Projektkopf
- `src/server-api.js` – nur Website: Anmeldung, Konto-Menü, Verbindung zu `/api/tp`
- `src/fonts/` – Schrift Figtree (OFL), auf der Website lokal ausgeliefert
- `src/sw.js` – Service Worker der installierten App. Das Build hängt an alle Programmdateien ihre
  Prüfsumme an (`app.js?v=…`); neue Versionen meldet `initUpdates` in `shell.js` („Neue Version laden“)
- `lib/` + `api/` – Server (Vercel Functions): `handler.js` (`/api/tp?a=…`), `auth.js` (Sitzungen,
  scrypt), `security.js` (CSRF, Ratenbegrenzung, Protokoll), `db.js` (Postgres), Mails, Erinnerungen
- `SECURITY.md` – Sicherheitskonzept; bei Änderungen an Anmeldung/API mitpflegen

Optik und Bedienung orientieren sich am **Kapazitätsplaner** (Tonis Nachfolge-App, Electron/React):
Menüleiste, Projektliste links, runde Segmentschalter mit grüner Auswahl, Kennzahlen-Karten.

## Befehle

```bash
npm run build   # baut public/, claude/, lib/logic.cjs
npm test        # baut und führt alle Tests in src/test_*.cjs aus
npm run dev     # lokaler Server, Datenbank im Arbeitsspeicher, SETUP_KEY=lokal1234
```

Lokal: `http://localhost:3000/setup.html` → ersten Admin anlegen → `http://localhost:3000/`.

## Umgebungsvariablen (Vercel / Server)

`DATABASE_URL` (oder `POSTGRES_URL`), `SESSION_SECRET`, `SETUP_KEY`, `APP_URL`, `CRON_SECRET`,
Mail: `RESEND_API_KEY` oder `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`, `MAIL_FROM`,
optional `TEAMS_WEBHOOK_URL`, `PWNED_CHECK` (`off` nur lokal).

## Regeln für den Code

- Element-IDs in `body.html` sind Schnittstellen für die Skripte; beim Umbau des Markups
  alle Verweise (`$('…')`) prüfen.
- Website ohne fremde Server (DSGVO): keine CDNs, keine Google Fonts. Im Claude-Artifact
  wird Figtree über Google Fonts geladen, das Build entfernt diesen Link für die Website.
- Rollen: `admin`, `editor`, `viewer`, `gantt` (sieht nur das Gantt). Nur-Lesen über `readOnly`,
  Nur-Gantt über `ganttOnly` / `html.gonly`.
- Daten sind getrennt vom Code gespeichert (Postgres bzw. Claude-Datenbank, Sammlung `plans`).
  Änderungen am Datenformat immer abwärtskompatibel halten (`sanitize` in `logic.js`).

## Claude-Artifact

Die Claude-Version liegt unter https://claude.ai/artifact/GWZ7R2Vq888zBZMKb2kTLA.
Nach Änderungen dort `claude/terminplaner-claude.html` neu veröffentlichen (über claude.ai,
falls aus Claude Code nicht möglich). Die Projekte in der Artifact-Datenbank bleiben dabei erhalten.

## Offene Punkte

- **Sicherung beim Laden:** Bis die Projekte aus der Datenbank geladen sind, nichts in die
  Datenbank schreiben (sonst kann der Platzhalter „Beispielprojekt“ das echte Projekt `main`
  überschreiben). Beim Start „Verbinde mit der gemeinsamen Datenbank …“ statt Beispielplan zeigen,
  nach einigen Sekunden ohne Verbindung Hinweis mit „Neu laden“. Betrifft `initStore`, `attach`, `persist` in `src/ui.js`.
- Datenschutzseite `src/datenschutz.html`: gelb markierte Platzhalter vor dem Echtbetrieb ausfüllen.
- Geplant: Betrieb auf dem eigenen Firmenserver statt Vercel/Neon.
