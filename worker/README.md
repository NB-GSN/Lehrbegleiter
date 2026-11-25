# Abrufdienst für den Lehrbegleiter

Dieser kleine Dienst läuft kostenlos bei Cloudflare. Er meldet sich mit deinem WebUntis-Lehrerkonto an und gibt der App nur zwei Dinge weiter: deinen Stundenplan (diese und nächste Woche) und deine erteilten Hausaufgaben. Dein Passwort liegt dadurch nie im Browser und nie im öffentlichen GitHub-Repo.

**Keine Schülerdaten:** Der Dienst fragt nie Schülerlisten, Klassenbuch, Fehlzeiten, Noten oder Prüfungen ab. Jede Antwort von WebUntis wird auf wenige Felder reduziert (Datum, Uhrzeit, Fach, Klasse, Raum, Status, Hinweistext, Hausaufgabentext). Er speichert nichts dauerhaft, nur einen 10-Minuten-Zwischenspeicher.

Die Einrichtung geht komplett im Browser und dauert etwa 15 Minuten. Du kannst dasselbe Cloudflare-Konto wie beim Lernbegleiter nutzen.

## 1. Worker aus GitHub anlegen

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) anmelden.
2. **Workers & Pages** → **Erstellen** → **Repository importieren**.
3. Zugriff auf `NB-GSN/Lehrbegleiter` erlauben (bei GitHub ggf. unter „Configure“ das Repo hinzufügen) und es auswählen.
4. Einstellungen: Projektname `lehrbegleiter-sync`, **Root-Verzeichnis `worker`**, Build-Befehl leer, Deploy-Befehl `npx wrangler deploy`.
5. **Bereitstellen**. Test: `<Adresse>/health` im Browser zeigt `{"ok":true,"service":"lehrbegleiter-sync"}`.

## 2. Werte eintragen

Beim Worker unter **Einstellungen → Variablen und Geheimnisse** hinzufügen, alle als Typ **Geheimnis**:

| Name | Was hinein gehört |
| --- | --- |
| `APP_KEY` | Ein langes, frei ausgedachtes Passwort. Dasselbe kommt in die App. Nimm ein anderes als beim Lernbegleiter. |
| `UNTIS_SERVER` | Servername aus der WebUntis-Adresszeile, z. B. `gsnpb.webuntis.com` |
| `UNTIS_SCHOOL` | Optional. Leer lassen, nur nötig bei „Schule nicht gefunden“. |
| `UNTIS_USER` | Dein WebUntis-Benutzername |
| `UNTIS_PASSWORD` | Dein WebUntis-Passwort |

Danach erneut **Bereitstellen**.

## 3. In der App verbinden

App öffnen (`https://nb-gsn.github.io/Lehrbegleiter/`) → **Einstellungen** → Adresse des Dienstes und `APP_KEY` eintragen → **Speichern & abrufen**. Danach aktualisiert sich die App beim Öffnen automatisch, höchstens alle 30 Minuten.

## Gut zu wissen

- **Anmeldung über Microsoft-Konto:** Wenn du dich bei WebUntis nur per Microsoft- oder Schulkonto (Single Sign-on) anmeldest, klappt die Anmeldung mit Benutzername und Passwort nicht. Die App zeigt dann einen Fehler bei `webuntis`. Dann brauchen wir einen anderen Weg.
- **Inoffizielle Schnittstelle:** Der Dienst nutzt dieselben Wege wie die WebUntis-Webseite. Das kann sich bei Updates ändern.
- **Hausaufgaben-Klasse:** Die Klasse einer Hausaufgabe wird über den Stundenplan zugeordnet (gleiches Fach am Tag der Erteilung). Bei Fächern in mehreren Klassen am selben Tag kann sie danebenliegen.

## Umzug auf einen eigenen Server (Weihnachtsferien)

Derselbe Code läuft mit Node.js 18 oder neuer:

1. Den Ordner `worker` auf den Server kopieren.
2. `.env.example` als `.env` kopieren und dieselben Werte eintragen.
3. `node server.js` oder per Docker: `docker build -t lehrbegleiter-sync .` und `docker run --env-file .env -p 8787:8787 lehrbegleiter-sync`.
4. Über HTTPS erreichbar machen (z. B. mit Caddy als Reverse Proxy).
5. In der App nur die Adresse ändern.
