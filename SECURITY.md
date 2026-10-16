# Sicherheitsbericht Terminplaner

Stand: 16.10.2026. Grundlage: OWASP ASVS 4.0 / Cheat Sheet Series, geprüft am Quellcode und mit automatisierten Tests gegen eine lokale Testumgebung (Datenbank im Arbeitsspeicher). Es wurden keine Tests gegen die produktive Website ausgeführt.

Legende: **umgesetzt** = im Code geändert · **getestet** = durch automatisierte Tests bestätigt · **empfohlen** = nicht umgesetzt, manueller Schritt oder Entscheidung nötig.

## Architektur und Abweichungen vom PHP-Auftrag

Der Auftrag beschreibt eine PHP-Website (httpdocs/private, Plesk). Der Terminplaner läuft dagegen als Node.js-Anwendung auf Vercel mit Postgres (Neon). Die Anforderungen wurden sinngemäß übertragen:

| Auftrag (PHP) | Terminplaner (Vercel) |
|---|---|
| `httpdocs/` als einziges Webroot | `public/` ist das Einzige, was ausgeliefert wird: statische Dateien ohne Geheimnisse. Die Servermodule (`lib/`) und Funktionen (`api/`) werden von Vercel ausgeführt, nie als Datei ausgeliefert. |
| `private/db.php`, `private/config`, `private/smtp_client` | Zugangsdaten nur als Umgebungsvariablen in Vercel (`DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`/`SMTP_*`, `CRON_SECRET`, `SETUP_KEY`), nie im Repository. Datenbankzugriff in `lib/db.js`, Mailversand in `lib/mail.js`. |
| `private/uploads` | Es gibt kein Dateisystem für Uploads. Profilbilder liegen als geprüfte, neu geschriebene Bilddaten in der Datenbank und werden nur angemeldeten Benutzern über die API geliefert. |
| `private/logs` | Sicherheitsprotokoll in der Tabelle `tp_seclog` (Vercel hat kein beschreibbares Dateisystem), Ansicht in der Verwaltung. |
| PDO, `password_hash`, PHP-Sessions | `pg` mit parametrisierten Abfragen, `crypto.scrypt` (Node-Standardbibliothek), eigene Sitzungstabelle mit zufälligen IDs. |
| Apache/Nginx/Plesk-Konfiguration | `vercel.json` (Sicherheits-Kopfzeilen, Region Frankfurt). Directory Listing, PHP-Ausführung und `.htaccess` gibt es auf Vercel nicht. |

## 1. Gefundene Schwachstellen (vor der Überarbeitung)

| # | Befund | Schwere | Status |
|---|---|---|---|
| 1 | Sitzung als zustandsloses HMAC-Cookie für 14 Tage: Abmelden machte ein gestohlenes Cookie nicht ungültig, kein Inaktivitäts-Timeout | Mittel | behoben, getestet |
| 2 | Änderungen nur durch Kopfzeile `X-TP` gegen CSRF geschützt (wirksam, aber ohne Token und ohne Herkunftsprüfung) | Niedrig | behoben, getestet |
| 3 | Content-Security-Policy erlaubte Inline-Skripte (`'unsafe-inline'`) | Mittel | behoben, getestet |
| 4 | Profilbilder nur per Muster geprüft, Inhalt nicht; Metadaten (EXIF/GPS) blieben erhalten; Organigramm-Fotos gar nicht serverseitig geprüft | Mittel | behoben, getestet |
| 5 | E-Mail-Adresse ohne Passwortbestätigung änderbar (mit „Passwort vergessen“ wäre das eine Übernahme-Möglichkeit) | Mittel | behoben, getestet |
| 6 | Passwörter ab 8 Zeichen, keine Prüfung gegen bekannte Leaks | Mittel | behoben, getestet |
| 7 | Anmeldesperre zählte IP **oder** Name gemeinsam (8 Versuche): Dritte konnten jedes Konto 15 Minuten sperren | Niedrig | behoben, getestet |
| 8 | Unterschiedliche Antwortzeit bei unbekanntem Namen (Rückschluss auf vorhandene Konten) | Niedrig | behoben |
| 9 | scrypt-Parameter (N = 16384) unter der OWASP-Empfehlung | Niedrig | behoben, getestet (alte Hashes werden beim Anmelden erneuert) |
| 10 | Benutzer löschen ließ Verweise und Namen in Kommentaren, Protokoll, Versionen und Plänen zurück (DSGVO Art. 17) | Mittel | behoben, getestet |
| 11 | Keine Aufbewahrungsfristen (Änderungsprotokoll unbegrenzt) | Niedrig | behoben, getestet |
| 12 | Kein Sicherheitsprotokoll für Angriffe und Kontoänderungen | Mittel | behoben, getestet |
| 13 | Keine Begrenzung für Kommentare mit Erwähnungen, Tickets und Testmails (E-Mail-Spam möglich) | Niedrig | behoben |
| 14 | SMTP ohne erzwungenes TLS | Niedrig | behoben (nicht gegen echten Server getestet) |
| 15 | Cron-Geheimnis nicht zeitkonstant verglichen | Niedrig | behoben, getestet |
| 16 | Service Worker speicherte jede aufgerufene Seite (auch die Verwaltung) als App-Hülle | Niedrig | behoben |
| 17 | Fehlende Kopfzeilen: Permissions-Policy, COOP/CORP, `object-src`, `base-uri`, explizites HSTS | Niedrig | behoben |
| 18 | Kein „Passwort vergessen“ (nur über Admins) | Funktionslücke | sicher umgesetzt, getestet |
| 19 | IP-Adressen im Klartext gespeichert (Anmeldesperre, 15 Minuten) | Niedrig (DSGVO) | behoben: nur noch HMAC-Kürzel |

Nicht gefunden: SQL-Injection (alle Abfragen parametrisiert, Tabellen- und Spaltennamen nur aus festen Listen), XSS (alle Ausgaben werden escaped; Test mit Schadcode in allen Feldern ohne Treffer), IDOR bei Kommentaren, Tickets und Profil, Mass Assignment, offene Weiterleitungen, SSRF (externe Adressen nur aus Umgebungsvariablen), unsichere Deserialisierung. Abhängigkeiten: `npm audit` ohne Befund.

## 2. Geänderte Dateien

- `lib/security.js` (neu): Ratenbegrenzung, Sicherheitsprotokoll, Herkunftsprüfung, Passwortrichtlinie mit Leak-Prüfung, Bildprüfung und Metadaten-Entfernung
- `lib/auth.js`: scrypt mit OWASP-Parametern, Rehash, serverseitige Sitzungen, CSRF-Token, Übernahme alter Cookies
- `lib/handler.js`: CSRF/Origin für alle Änderungen, Anmeldung, Passwort vergessen, E-Mail-Änderung mit Passwort, Rollenwechsel beendet Sitzungen, Anonymisierung beim Löschen, Datenauskunft, Sicherheitsprotokoll, Aufbewahrungsfristen, Ratenbegrenzungen
- `lib/db.js`: Tabellen `tp_sessions`, `tp_rate`, `tp_seclog`, `tp_resets`; Zeitlimits
- `lib/mail.js`: Betreff gegen Header-Injection, strengere Empfängerprüfung, TLS-Pflicht für SMTP
- `api/cron-reminders.js`: zeitkonstanter Vergleich, tägliche Bereinigung
- `vercel.json`: strenge CSP ohne Inline-Skripte, HSTS, Permissions-Policy, COOP, CORP
- `scripts/build.mjs`: Inline-Skripte in eigene Dateien (`app.js`, `admin.js`, `setup.js`), Datenschutzseite
- `src/server-api.js`: CSRF-Token, „Passwort vergessen“, neues Passwort per Link, E-Mail-Änderung mit Passwort, „Meine Daten herunterladen“, Abmelden leert den App-Zwischenspeicher
- `src/admin.html`, `src/setup.html`: CSRF-Token, 12 Zeichen, Anonymisieren beim Löschen, Sicherheitsprotokoll
- `src/sw.js`: nur die Startseite als App-Hülle
- `src/datenschutz.html` (neu): Vorlage der Datenschutzhinweise
- Tests: `src/test_security.cjs` (neu, 20 Tests), `src/test_assignees_server.cjs` angepasst, Bild-Testdateien in `src/fixtures/`

## 3. CSRF-Schutz

Jede zustandsändernde Aktion ist nur per POST möglich und braucht

1. die Kopfzeile `X-TP: 1` (erzwingt bei fremden Seiten eine CORS-Vorabfrage, die der Server nicht erlaubt),
2. eine passende Herkunft: `Origin` gleich dem eigenen Host bzw. `Sec-Fetch-Site: same-origin`,
3. bei angemeldeten Benutzern das CSRF-Token der Sitzung in `X-CSRF`. Es ist ein HMAC der Sitzungs-ID, wird zeitkonstant verglichen und ändert sich mit jeder neuen Sitzung.

Ausnahmen ohne Sitzung (nur 1 und 2): `login`, `setup`, `reset_request`, `reset_confirm`. Das Sitzungs-Cookie ist zusätzlich `SameSite=Strict`. Mehrere Tabs funktionieren, weil das Token je Sitzung gilt; nach einem Passwortwechsel holt die Seite das neue Token automatisch.

Geschützte Aktionen: `put`, `del`, `restore`, `import`, `comment_new`, `comment_del`, `ticket_new`, `ticket_update`, `ticket_del`, `profile_save` (inkl. Profilbild), `password`, `logout`, `user_save`, `user_del`, `mail_test`, `weekly_run`, `reminders_run`.

## 4. Authentifizierung und Sitzungen

- **Passwörter:** scrypt mit N = 2^17, r = 8, p = 1, Salz je Passwort. Alte Hashes werden beim nächsten Anmelden erneuert. Neue Passwörter brauchen 12 bis 256 Zeichen, dürfen nicht den Namen enthalten und werden per k-Anonymität gegen Have I Been Pwned geprüft (nur 5 Zeichen des SHA-1-Hashes verlassen den Server; ist der Dienst nicht erreichbar, entfällt nur diese Prüfung). Bestehende kürzere Passwörter funktionieren weiter.
- **Anmeldung:** gleiche Meldung und Rechenzeit für unbekannte Namen. Begrenzt auf 10 Fehlversuche je Konto und 30 je IP in 15 Minuten; die Sperre ist zeitlich begrenzt.
- **Sitzungen:** 256-Bit-Zufalls-ID im Cookie (`__Host-tp_sid`, HttpOnly, Secure, SameSite=Strict, Path=/), in der Datenbank nur ihr SHA-256-Hash. Ablauf nach 3 Tagen Inaktivität bzw. spätestens 14 Tagen. Jede Anmeldung bekommt eine neue ID, Abmelden löscht die Sitzung serverseitig.
- **Sitzungen beenden:** ein Passwortwechsel beendet alle anderen Sitzungen; ein Rollenwechsel oder ein von Admins gesetztes Passwort beendet alle Sitzungen des Benutzers.
- **Passwort vergessen:** 256-Bit-Token, gespeichert nur als Hash, 30 Minuten gültig, nur einmal verwendbar (atomar), alle Sitzungen werden beendet. Die Antwort verrät nicht, ob ein Konto existiert. Begrenzt auf 5 Anfragen je IP und 3 je Konto pro Stunde. Das Token steht im URL-Fragment und wird sofort aus Adresse und Verlauf entfernt.
- **Rechte:** Rolle und Berechtigung werden bei jeder Anfrage aus der Datenbank geprüft (Standard: verweigern). Abgewiesene Zugriffe werden protokolliert.
- **E-Mail-Adresse ändern:** nur mit aktuellem Passwort, die alte Adresse wird benachrichtigt.
- **Mehrfaktor-Anmeldung:** nicht umgesetzt (**empfohlen**). TOTP ließe sich ohne Zusatzbibliothek ergänzen.

## 5. Profilbilder und Fotos

- Nur JPEG, PNG und WebP. Der echte Dateiinhalt wird geprüft (Signatur und Struktur), nicht nur der angegebene Typ. SVG, HTML, PHP-Code und Polyglot-Dateien werden abgelehnt.
- Höchstens 150 KB (Profil) bzw. 300 KB (Organigramm) und 1024 × 1024 Pixel.
- Die Datei wird neu zusammengesetzt; dabei werden EXIF/GPS, XMP, ICC, Textblöcke und Kommentare entfernt. Der Browser verkleinert das Bild vorher zusätzlich per Canvas.
- Speicherung in der Datenbank, keine Dateinamen und Pfade (kein Path Traversal möglich). Auslieferung nur an angemeldete Benutzer über die API mit `nosniff`. Anzeige ausschließlich in `<img>`, und die CSP erlaubt nur eigene und `data:`-Bilder.
- Begrenzung auf 30 Profiländerungen pro Stunde; abgelehnte Uploads werden protokolliert.
- Ein eigener Bild-Endpunkt (`/profile-image.php?id=…`) ist nicht nötig, weil die Bilder nie als öffentliche Dateien existieren.

## 6. Kopfzeilen und Serverkonfiguration (`vercel.json`)

- **CSP:** `script-src 'self'` ohne `unsafe-inline` und `unsafe-eval`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `connect-src 'self'`, `frame-ancestors` nur selbst und Microsoft Teams. `style-src` erlaubt weiterhin `'unsafe-inline'`, weil die Oberfläche Stilattribute nutzt (geringes Risiko).
- **Weitere Kopfzeilen:** `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (Kamera, Mikrofon, Standort usw. aus), `Cross-Origin-Opener-Policy` und `Cross-Origin-Resource-Policy: same-origin`.
- **API-Antworten:** `Cache-Control: no-store`. Erlaubt sind nur GET und POST. Kein CORS (keine fremden Origins).
- **Datenbank:** TLS mit Zertifikats- und Hostnamenprüfung (pg behandelt `sslmode=require` als `verify-full`), Zeitlimit je Abfrage 15 s.

## 7. Sicherheitsprotokoll und Aufbewahrung

**Protokolliert werden:** fehlgeschlagene Anmeldungen, Ratenbegrenzungen, CSRF- und Herkunftsfehler, verweigerte Zugriffe, abgelehnte Uploads, Passwort- und E-Mail-Änderungen, „Passwort vergessen“, Admin-Änderungen an Benutzern, Export, Import, Projektlöschung und Datenauskunft.

**Nicht protokolliert werden:** Passwörter, Tokens, Sitzungs-IDs und E-Mail-Adressen. IP-Adressen werden nur als HMAC-Kürzel gespeichert, Steuerzeichen entfernt (gegen Log-Injection).

**Aufbewahrung** (tägliche Bereinigung über den Cron-Aufruf):

| Daten | Frist |
|---|---|
| Sicherheitsprotokoll | 90 Tage |
| Änderungsprotokoll | 12 Monate |
| Ratenzähler | 2 Tage |
| Sitzungen | 3 bzw. 14 Tage |
| Reset-Tokens | 30 Minuten |
| Versandmerker | 400 Tage |

## 8. Ausgeführte Tests

| Test | Ergebnis |
|---|---|
| `npm test`: 6 Testdateien, davon `test_security.cjs` mit 20 Sicherheitstests (Cookies, Session-Fixation, CSRF-Varianten, Brute-Force, SQL-Injection, Passwortrichtlinie, Abmelden, Timeouts, Hash- und Cookie-Migration, Rollen, IDOR, Mass Assignment, Bilder mit EXIF/Text/SVG/PHP/Übergröße, E-Mail-Änderung, Passwort-Reset inkl. Wiederverwendung und Ablauf, Rollenwechsel, Anonymisierung, Datenauskunft, Protokollinhalt, Cron) | alle bestanden |
| Ende-zu-Ende im Browser gegen den lokalen Server **mit denselben Kopfzeilen wie Vercel**: Einrichtung, Verwaltung, Anmeldung, alle sechs Ansichten, Details, Kommentare, Aufgaben, Organigramm, PDF-Export, Profil, Datenauskunft, Passwort vergessen bis Neuanmeldung, Abmelden, Rolle „Nur Gantt“ | funktioniert, 0 CSP-Verstöße |
| XSS: Schadcode in Projektname, Vorgängen, Beschreibungen, Status-Bahnen, Feiertagen, Aufgaben, Organigramm, Kommentaren und Tickets, Desktop und Handy, **ohne** CSP (prüft das Escaping selbst) | 0 ausgeführt |
| `curl`: `/../package.json`, `/%2e%2e/lib/auth.js`, `/.env` → 404; Anmelden ohne `X-TP` oder mit fremdem `Origin` → 403 | bestanden |
| `npm audit` | 0 Schwachstellen |

**Nicht getestet:** die echte Vercel-Umgebung (Kopfzeilen, HSTS, IP-Kopfzeilen), die TLS-Verbindung zu Neon, echter Mailversand über Resend/SMTP, die Have-I-Been-Pwned-Abfrage (aus der Testumgebung nicht erreichbar) und die Einbettung in Teams.

## 9. Verbleibende Risiken

- Projekte sind für alle angemeldeten Benutzer sichtbar, und Bearbeiter können jedes Projekt löschen (so gewollt; gelöschte Projekte lassen sich nur aus einer Sicherung wiederherstellen).
- Bei einer Teams-Einbettung wird das Cookie mit `SameSite=Strict` im fremden Rahmen nicht gesendet (galt mit `Lax` ebenso).
- `style-src 'unsafe-inline'` bleibt nötig.
- Keine Mehrfaktor-Anmeldung.
- Die Vercel-Protokolle (Funktionsaufrufe mit IP-Adressen) liegen beim Anbieter; die Aufbewahrung hängt vom Vercel-Tarif ab.
- Die Datenbank-Sicherungen erstellt Neon (Point-in-Time-Restore, verschlüsselt beim Anbieter). Eigene, verschlüsselte Offline-Sicherungen gibt es nicht automatisch; der JSON-Export der Verwaltung ist unverschlüsselt.

## 10. Manuelle Schritte für Betreiber

1. **Umgebungsvariablen in Vercel prüfen:**
   - `SESSION_SECRET`: mindestens 32 zufällige Zeichen, zum Beispiel `openssl rand -base64 48`.
   - `CRON_SECRET`: mindestens 16 Zeichen.
   - `SETUP_KEY`: nach der Einrichtung entfernen oder ändern (die Einrichtung ist dann ohnehin gesperrt).
   - Optional `PWNED_CHECK=off`, um die Leak-Prüfung abzuschalten.
2. **Preview-Deployments absichern:** In Vercel „Deployment Protection“ aktivieren oder ihnen eine eigene Datenbank geben, damit Testversionen nicht mit Echtdaten arbeiten.
3. **Least Privilege (empfohlen):** In Neon eine eigene Datenbankrolle nur mit SELECT/INSERT/UPDATE/DELETE auf die `tp_*`-Tabellen anlegen und in `DATABASE_URL` verwenden, sobald das Schema einmal mit der Besitzerrolle angelegt wurde. Achtung: Bei künftigen Schemaänderungen dann einmal mit der Besitzerrolle starten.
4. **Datenschutzhinweise:** die gelb markierten Stellen in `src/datenschutz.html` ausfüllen und prüfen lassen.
5. **Organisatorisches** (siehe DSGVO-Einschätzung): Auftragsverarbeitungsverträge mit Vercel, Neon und Resend, Verarbeitungsverzeichnis, Einwilligung für Fotos.
6. **Passwörter:** Benutzer mit kurzen Passwörtern bitten, ein neues zu setzen (alte bleiben gültig).
7. **Optional:** eigene Domain mit HSTS-Preload, Vercel Firewall (Attack Challenge Mode) bei Angriffen, Mehrfaktor-Anmeldung als nächster Ausbauschritt.

Nach dem Update bleiben alle Benutzer angemeldet: alte Cookies werden beim ersten Aufruf automatisch in eine neue Sitzung überführt. Datenbankänderungen sind nur neue Tabellen; bestehende Daten bleiben unverändert. Rückweg: Vercel-Deployment auf die vorherige Version zurücksetzen. Die neuen Tabellen stören die alte Version nicht; nach dem Zurücksetzen müssen sich alle einmal neu anmelden.
