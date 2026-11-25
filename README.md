# Lehrbegleiter

Deine Unterrichtswoche auf einen Blick: Stundenplan mit Vertretungen, Ausfällen, Beratung und Aufsichten sowie deine erteilten Hausaufgaben. Eine Web-App (PWA) für PC und Handy.

**Phase 0** (dieser Stand): Anbindung an WebUntis mit dem Lehrerkonto, ohne Schülerdaten. Konzept und weitere Phasen stehen im Konzeptdokument.

## Bestandteile

- `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`: die App, eine reine statische Webseite ohne Build. Daten liegen nur im Browser (`localStorage`, Schlüssel `lehrbegleiter.v1`).
- `worker/`: der Abrufdienst. Einrichtung siehe [worker/README.md](worker/README.md).

Ohne eingerichteten Abrufdienst zeigt die App frei erfundene Demo-Daten.

## Veröffentlichen mit GitHub Pages

Im Repo unter **Settings → Pages**: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`. Die App liegt dann unter `https://nb-gsn.github.io/Lehrbegleiter/`.

Auf dem Handy die Seite öffnen und „Zum Startbildschirm hinzufügen“ wählen. Am PC in Edge oder Chrome über das Installieren-Symbol in der Adresszeile.

## Datenschutz

- Keine Schülerdaten: keine Namen, Noten, Fehlzeiten, Klassenlisten, weder im Abrufdienst noch in der App.
- Keine Passwörter oder geheimen Links ins Repo, es ist öffentlich.

## Entwicklung

Bei Änderungen an App-Dateien `VERSION` in `sw.js` erhöhen, damit Geräte die neue Version laden.
