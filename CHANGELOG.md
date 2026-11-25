# Änderungsprotokoll

Dieses Dokument wird aus `public/changelog.json` erzeugt, dem Protokoll, das auch die Oberfläche anzeigt. Die neueste Version steht oben.

## 9.28.4 – 2026-11-25

**Chat-Overlay weicht dem Punktespiel aus (optional)**

- Neu: „Chat bei laufender Spielrunde“ – Nichts tun (Standard, wie bisher), Abdunkeln, Ausblenden oder Nach oben schieben. Gilt in jeder Phase der Runde (Anmeldung, Kontrolle, Ergebnis) und nur, solange das Punktespiel eine Runde zeigt; danach kehrt der Chat sanft zurück.
- Einstellbar: verbleibende Deckkraft beim Abdunkeln (0 bis 90 %) und Strecke beim Verschieben (0 bis 900 Pixel). Bei Chat-Position „Oben“ wird nach unten geschoben.
- Das Chat-Overlay erhält die Spielphase über seine bestehende Verbindung zum Control Center; das Punktespiel-Overlay muss dafür nicht in derselben Szene laufen.

## 9.28.3 – 2026-11-25

**Chat-Overlay: Deckkraft, Textschatten, Spielmeldungen aus dem Chat**

- Neu: Deckkraft der Nachrichten (10 bis 100 %, Standard 100). Nur die Blase wird durchsichtig, Text, Namensleiste und Akzentstreifen bleiben deckend.
- Neu: Textschatten „Aus“ (Standard), „Leicht“ oder „Stark“ für bessere Lesbarkeit vor hellen Spielszenen (dunkle Schatten im dunklen Look, heller Schein bei hellen Blasen).
- Neu: „Meldungen des Chat-Spiels“ im Chat zeigen (Standard, wie bisher) oder nur im Spiel-Overlay zeigen. Damit entfallen doppelte Anzeigen während einer Runde.
- Die Breite war bereits einstellbar (Prozent der Quelle, 20 bis 100); ohne Änderung der Einstellungen sieht das Overlay aus wie in 9.28.2.

## 9.28.2 – 2026-11-25

**Punktespiel-Overlay: neue Punkte-Übersicht, Kasten an/aus, Deckkraft**

- Neue Einstellung „Punkte-Übersicht“ im Punktespiel-Overlay: „Karten“ (wie bisher, Standard) oder „Chips mit Punkten“. Die Chips zeigen im Ergebnis „+Punkte Name“ bzw. „-Einsatz Name“, sortiert (Gewinner zuerst nach Betrag, dann Erwischte), nie abgeschnitten; höchstens 12, der Rest als „und N weitere“. Erwischte bekommen mindestens 4 Plätze, damit sie nicht hinter vielen Gewinnern verschwinden. In Anmeldung und Kontrolle zeigen die Chips Name und Einsatz.
- Neu: Kasten hinter dem Panel „An“ (wie bisher, Standard) oder „Aus“ (nur Text mit Schatten direkt im Bild, Chips behalten einen dunklen Grund) und die Deckkraft des Kastens (10 bis 100 %, Standard 100).
- Zusammenspiel mit der Detailstufe: „Ausführlich“ zeigt alles wie bisher, bei „Chips“ anstelle der Karten. „Kompakt“ mit Chips zeigt die Chips nur im Ergebnis und lässt dort die Textzeile mit denselben Punkten weg; „Kompakt“ mit Karten bleibt wie in 9.28.1.
- Zum Ausprobieren lassen sich die Werte in der Overlay-Adresse überschreiben: …&points=chips&box=off&boxopacity=60.
- Nach dem Update in OBS bzw. Moblin die Browserquelle einmal neu laden. Ohne Änderung der Einstellungen sieht das Overlay aus wie in 9.28.1.

## 9.28.1 – 2026-11-25

**Punktespiel-Overlay: Lage, Größe und Detailstufe einstellbar**

- Das Panel des Punktespiel-Overlays (Anmeldung, Kontrolle, Ergebnis) lässt sich jetzt verschieben und verkleinern: Lage in einem von neun Feldern (Standard: unten mittig), Größe in Prozent (Standard 80, bisherige Breite = 100) und Abstand zum Rand. Einstellbar unter Stubenkontrolle → Spielregeln („Overlay: …“).
- Die Männchen der Anmeldung laufen weiter unten am Bildrand. Steht das Panel unten, lässt es dafür einen festen Streifen von 120 px frei; das Panel bleibt in allen Phasen (Anmeldung, Kontrolle, Ergebnis) an derselben Stelle und springt nicht mehr.
- Die Kontrollfigur ist kleiner und sitzt am Panel (bei einer Lage oben darunter, bei einer Lage rechts am linken Panelende); sie wächst und schrumpft mit der Panelgröße.
- Neue Einstellung „Detailstufe“: „Ausführlich“ zeigt alles wie bisher (Karten, Seitenanzeige, Zusatzzeile), „Kompakt“ nur Titel, Kopfzeile und Ergebnistext. Standard ist „Ausführlich“.
- Zum Ausprobieren lassen sich die Werte in der Overlay-Adresse überschreiben, z. B. …#key=…&scale=70&anchor=bottom-center&detail=compact.
- Nach dem Update in OBS bzw. Moblin die Browserquelle einmal neu laden. Wer das Panel bisher in OBS verkleinert oder verschoben hat, setzt die Quelle auf 100 % zurück und stellt Lage und Größe im Control Center ein.

## 9.28.0 – 2026-11-25

**Clips: Chat-Befehl „!clip“**

- Neu unter Twitch → Clips: Der Chat-Befehl „!clip“ (Name einstellbar) erstellt auf Zuruf einen Twitch-Clip des laufenden Streams. Ein einstellbarer Bot schreibt den Link mit dem Namen der Person in den Chat; der Link kommt meist nach wenigen Sekunden, deutlich früher als über die automatische Clip-Erkennung.
- Einstellbar: wer den Befehl nutzen darf (alle, Abonnenten, VIPs, Moderatoren, nur Kanalinhaber), Pause pro Person und für alle, Clip-Länge (5 bis 60 Sekunden, Standard 30), der antwortende Bot sowie die Texte für Erfolg, „Kanal nicht live“ und Fehler.
- Der Clip wird auf Wunsch (Standard: ja) auch in Discord gemeldet, mit Vorschaubild. Der Clip-Monitor meldet denselben Clip nicht noch einmal.
- Der Clip wird über das Kanal-Konto erstellt. Dafür braucht es das Twitch-Recht „clips:edit“; es wird nur angefordert, wenn der Befehl eingeschaltet ist. Danach das Kanal-Konto einmal unter Administration → Twitch-Verbindungen neu verbinden. Die Clips-Seite zeigt, ob das Recht vorhanden ist.
- AutoMod: Clip-Links des antwortenden Bots werden wie die des Clip-Sharing-Bots automatisch freigegeben, falls Twitch sie wegen des Linkfilters zurückhält.
- Das Ausschalten des Moduls „Clips“ schaltet auch den Befehl ab. Der Befehl ist nach dem Update zunächst aus.
- Keine Änderung an der Datenbank oder an der compose.yaml.

## 9.27.5 – 2026-11-24

**Chat-Overlay: Korrektur der Overlay-Seite aus 9.27.4**

- Fehlerbehebung: In 9.27.4 brach das Skript der Overlay-Seite beim Laden ab, dadurch erschien im Chat-Overlay gar nichts mehr (weder Vorschau noch Testnachrichten noch echter Chat). Die Seite zeigt wieder alles an; die Emotes von 7TV, BetterTTV und FrankerFaceZ erscheinen jetzt auch tatsächlich als Bild.
- Neuer Test, der das Skript der Overlay-Seite mit einer DOM-Attrappe wirklich ausführt (Laden, Vorschau, Twitch- und Fremd-Emotes, ungültige Kennungen, Zero-Width), damit so ein Ausfall nicht mehr unbemerkt bleibt.
- Nach dem Update in OBS bzw. Moblin die Browserquelle einmal neu laden (OBS: Eigenschaften → „Cache der aktuellen Seite aktualisieren“).

## 9.27.4 – 2026-11-24

**Chat-Overlay: Emotes von 7TV, BetterTTV und FrankerFaceZ**

- Neu in den Einstellungen des Chat-Overlays: Emotes von 7TV, BetterTTV und FrankerFaceZ als Bilder im Chat. Jeder Dienst hat einen eigenen Schalter, alle sind standardmäßig aus.
- Das Control Center lädt die Emote-Listen (global und die des eigenen Kanals) im Hintergrund von den festen Servern der Dienste und erneuert sie alle paar Stunden. Fällt ein Dienst aus, bleiben seine Emote-Namen einfach Text; der Chat wird nie aufgehalten.
- Die Bilder lädt die Overlay-Quelle (OBS, Moblin) direkt von den Bildservern der eingeschalteten Dienste. Dabei sieht der Dienst die IP-Adresse des Geräts; deshalb sind die Schalter aus, bis du sie einschaltest. Die Inhaltssicherheitsrichtlinie der Overlay-Seite erlaubt dafür nur Bilder von cdn.7tv.app, cdn.betterttv.net und cdn.frankerfacez.com.
- Zero-Width-Emotes von 7TV werden über das vorherige Emote gelegt. Pro Nachricht werden höchstens 30 Fremd-Emotes als Bild gezeigt; „Emotes als Bilder anzeigen“ aus bedeutet weiterhin Text.
- Die Einstellungen des Chat-Overlays sind übersichtlicher: Auswahlfelder, Haken und Farben stehen in Spalten nebeneinander, sodass weniger gescrollt werden muss.

## 9.27.3 – 2026-11-24

**Chat-Overlay: Anpassung von Farben, Position, Schrift und Bildern**

- Neue Karte „Anpassung“ in den Einstellungen des Chat-Overlays: Position oben oder unten, Abstand zum Rand, Breite in Prozent der Quelle sowie eigene Farben für Namensleiste und Nachricht (jeweils mit Textfarbe). Ohne gesetzten Haken gilt die Farbe des gewählten Looks.
- Eigene Schrift: Neben der Systemschrift und Akzidenz kann ein beliebiger Schriftname eingetragen werden, der auf dem Gerät mit OBS oder Moblin installiert ist. Ist die Schrift dort nicht vorhanden, gilt die Systemschrift. Es wird keine Schriftdatei geladen.
- Neue Bildplätze unter Administration → Profil & Branding: je ein eigenes Symbol für die Karten Follower, Raid, Abo, Geschenkabo, Bits und Kanalpunkte sowie eine kachelbare Textur über den Nachrichten (Stärke einstellbar). Ohne Upload erscheinen die eingebauten Symbole. Geöffnete Quellen übernehmen neue Bilder und Einstellungen sofort.
- Alle Eingaben werden geprüft (Farben nur als #RRGGBB, Schriftname nur Buchstaben, Ziffern, Leerzeichen und . _ -, Bilder nur über die Bildplätze der Installation). Die Drittanbieter-Emotes (7TV, BTTV, FFZ) sind nicht enthalten.

## 9.27.2 – 2026-11-24

**Chat-Overlay: Karten für Abos, Bits und Kanalpunkte**

- Das Chat-Overlay zeigt jetzt auch Karten für Abos (neuer Abonnent, Verlängerung mit Monatszahl, Geschenkabo, Sammel-Geschenkabos), für Bits und für eingelöste Kanalpunkte-Belohnungen (zum Beispiel „10 Liegestütze“). Die Karten folgen dem gewählten Look und der Akzentfarbe, jede Art hat ein eigenes Symbol.
- Abo- und Bits-Karten sind standardmäßig an und brauchen keine neuen Rechte. Bei einer Sammelaktion erscheint nur eine Karte („verschenkt 50 Abos“), nicht eine pro Empfänger. Anonyme Spender erscheinen als „Anonym“.
- Die Kanalpunkte-Karte ist standardmäßig aus. Wird sie eingeschaltet, braucht das Kanal-Konto das zusätzliche Recht „Einlösungen lesen“ und muss unter Administration → Verbindungen einmal neu verbunden werden. Die Eingabe des Zuschauers bei einer Einlösung wird nie angezeigt.
- Neu im Bot: Abonnement-Benachrichtigungen werden zusätzlich abonniert (gleiche Berechtigung wie der Chat-Empfang); die Kanalpunkte laufen über die Verbindung des Kanal-Kontos, die auch das Subathon-Modul nutzt.

## 9.27.1 – 2026-11-24

**Chat-Overlay: Karten für neue Follower und Raids**

- Im Chat-Overlay erscheinen jetzt Ereigniskarten mitten im Chatfluss: „Neuer Follower“ mit Herz-Symbol und „Raid“ mit Zuschauerzahl. Die Karten nutzen den gewählten Look (dunkel, hell, kantig) und die eingestellte Akzentfarbe.
- Die Karten stammen aus den echten Twitch-Ereignissen und erscheinen ohne Verzögerung. Beide lassen sich in den Einstellungen des Chat-Overlays einzeln abschalten (Standard: an). Die Vorschau und die Testnachrichten enthalten Beispielkarten.
- Der Twitch-Bot meldet Raids jetzt zusätzlich an die Weboberfläche. Die Raid-Nachricht im Chat ist davon unabhängig und wird auch bei einem Fehler dabei wie bisher gesendet.

## 9.27.0 – 2026-11-24

**Neues Modul: Chat-Overlay für OBS und Moblin**

- Das Chat-Overlay zeigt den Twitch-Chat als eigene Browserquelle (Adresse unter Live-Zentrale → Chat-Overlay). Drei Looks stehen zur Wahl: dunkel (Standard), hell und kantig. Dazu Ausrichtung links oder rechts, Akzentfarbe, Schriftgröße, Emotes, Abzeichen und ein farbiger Punkt für die Nutzerfarbe. Es wird eine Systemschrift verwendet, die auf jedem Gerät vorhanden ist.
- Das Overlay erhält nur Nachrichten, die alle Filter des Bots bereits bestanden haben. Zusätzlich lässt sich eine Verzögerung (0 bis 5 Sekunden, Standard 2) einstellen; wird die Nachricht in dieser Zeit gelöscht oder der Nutzer gesperrt, erscheint sie nie. Spätere Löschungen und „Chat leeren“ entfernen die Nachricht auch aus der Einblendung.
- Befehle (beginnend mit !) und bekannte Fremd-Bots lassen sich ausblenden. Nachrichten des eigenen Bots sind einstellbar: keine (Standard), nur Spielmeldungen des Punktespiels oder alle.
- Das Modul ist standardmäßig ausgeschaltet und wird unter Administration → Integrationen aktiviert. Zum Ausprobieren gibt es eine Vorschau mit Beispielnachrichten und Testnachrichten im echten Overlay.
- Neu im Hintergrund: Chat-Nachrichten für das Overlay werden ohne Warteschlange übertragen, damit ein voller Chat keine Follow- oder Raid-Ereignisse verdrängt.

## 9.26.2 – 2026-11-23

**Clip-Meldungen in Discord: Vorschaubild zuverlässig, Nachricht auffindbar**

- Das Vorschaubild eines Clips wird vom Bot selbst geladen und an die Discord-Nachricht angehängt (wie bei Social Media). Bisher lud Discord das Bild von Twitch, oft bevor es dort abrufbar war, und zeigte dann dauerhaft keines. Ist das Bild noch nicht da, wartet der Bot bis zu etwa 3 Minuten und sendet danach trotzdem.
- Gesendete Ankündigungen merken sich Kanal und Nachrichten-ID. Unter Discord → Kommunikation steht ein Link zur letzten Clip- und Live-Nachricht. Wurde eine Nachricht nach dem Senden in Discord gelöscht, lässt sich das so erkennen.
- Eine Ankündigung, die Discord dauerhaft ablehnt, blockiert die Warteschlange nicht mehr: Nach 40 Versuchen (ca. 10 Minuten) wird sie aufgegeben. Der Fehler erscheint unter Administration → Systemfehler (ab dem 5. Versuch und beim Aufgeben).

## 9.26.1 – 2026-11-23

**Clip-Monitor übersteht Netzausfälle**

- Nach einem Ausfall der Verbindung zu Twitch holt der Clip-Monitor verpasste Clips nach: Er sucht ab dem letzten erfolgreichen Abruf (höchstens 60 Minuten zurück) statt wie bisher nur in den letzten 10 Minuten. Das Suchfenster im Normalbetrieb ist 15 Minuten, weil Twitch neue Clips nach bisheriger Beobachtung erst nach einigen Minuten listet. Doppelte Meldungen verhindert die bestehende Clip-Reservierung. Nach einem Neustart gilt wieder das normale Fenster.
- Die Fehlermeldung nennt jetzt die Ursache (zum Beispiel DNS-Fehler oder Zeitüberschreitung) statt nur „fetch failed“.
- Neues Standard-Prüfintervall 10 Sekunden (einstellbar von 5 bis 120 Sekunden); gespeicherte Einstellungen bleiben unverändert.
- Der Status unter Clips zeigt, wie lange Twitch nach dem Erstellen gebraucht hat, bis der zuletzt geteilte Clip abrufbar war.

## 9.26.0 – 2026-11-22

**Automatische Updates auch für andere Betreiber (Update-Werkzeug 1.9.0)**

- Das Update-Werkzeug arbeitet jetzt auch ohne GitHub-Token aus dem öffentlichen Repository. So können andere Betreiber neue Versionen automatisch melden lassen und nach Freigabe unter Administration → Updates installieren.
- Einrichtung vereinfacht: „launcher.py init“ legt den Arbeitsordner selbst an, trägt kein Token mehr ein, wenn keines angegeben ist, und liest Dienstnamen und Datenbank-Werte aus der compose.yaml. Eine vorhandene Einrichtung bleibt unverändert.
- Verständliche Meldungen beim GitHub-Abfragelimit und bei nicht gefundenem Repository; „status“ zeigt, ob mit oder ohne Token abgefragt wird.
- Neue Anleitung tools/deploy/UPDATER-EINRICHTEN.md; das öffentliche Release enthält zusätzlich das Startpaket des Update-Werkzeugs.
- Für die eigene Installation ändert sich nichts: Das Werkzeug 1.9.0 kommt wie gewohnt per Selbstupdate mit.

## 9.25.7 – 2026-11-21

**Öffentliche Veröffentlichung auch nachträglich auslösbar**

- Neuer manueller Workflow „publish-public“ (GitHub → Actions): Er veröffentlicht ein bereits gebautes Release nachträglich im öffentlichen Repository. Das ist nötig, wenn der Schalter PUBLIC_RELEASE erst nach dem Release gesetzt wurde, denn ein erneuter Lauf des Release-Workflows baut nie ein vorhandenes Release neu.
- Es gelten dieselben Prüfungen wie bei der automatischen Veröffentlichung. Im Programm selbst ändert sich nichts.

## 9.25.6 – 2026-11-21

**TikTok-Meldungen nur noch mit erreichbarem Link**

- Neue TikTok-Beiträge werden vor dem Senden an Discord geprüft: Ist der Link bei TikTok nicht abrufbar (zum Beispiel gelöscht oder nur für eine Werbekampagne angelegt), wird nichts gesendet. Der Bot prüft in den nächsten Abfragen noch bis zu dreimal und verwirft den Beitrag dann. Ist die Prüfung selbst nicht möglich, wird wie bisher gesendet.
- Neue Altersgrenze für TikTok (Standard 48 Stunden, 0 = unbegrenzt): Ältere Beiträge werden nicht mehr nachträglich in Discord angekündigt. Beides ist unter Social Media → Einstellungen einstellbar; die Linkprüfung lässt sich abschalten.
- Die Liste Social Media → Veröffentlichungen zeigt jetzt, wann ein Beitrag erkannt und gesendet wurde, und kennt die Status „Wartet auf Link“ und „Übersprungen“ samt Grund.
- Instagram bleibt unverändert.

## 9.25.5 – 2026-11-21

**Lizenzangabe der MCP-Bibliotheken ergänzt**

- Die Drittkomponenten-Übersicht (Hilfe → Rechtliches) nennt jetzt die Lizenz der MCP-Bibliotheken: Apache License 2.0, mit dem Hinweis auf den laufenden Übergang von der MIT-Lizenz und auf CC-BY-4.0 für deren Dokumentation.
- Im Programm selbst ändert sich nichts.

## 9.25.4 – 2026-11-20

**Öffentliche README mit Funktionsumfang**

- Die README der veröffentlichten Fassung beschreibt jetzt, was das Bot Control Center kann (Twitch, Discord, Control Center), was man zum Betrieb braucht und wo die Anleitungen stehen, damit man das vor der Installation weiß. Sie nennt keine Versionsnummer und wird bei neuen Funktionen mitgepflegt.
- Im Programm selbst ändert sich nichts.

## 9.25.3 – 2026-11-20

**Weniger Datenbanklast im Dauerbetrieb**

- Der Sekundentakt von Followathon und Subathon lädt den Zustand nicht mehr jedes Mal komplett aus der Datenbank. Geprüft wird nur noch, ob sich der Stand geändert hat; nur dann wird neu geladen. Das senkt die Last auf Datenbank und Web-Dienst sowie den internen Datenverkehr deutlich, auch wenn gerade kein Followathon läuft.
- Overlays erhalten weiterhin jede Sekunde den aktuellen Stand. Ist kein Overlay verbunden, wird nichts mehr berechnet.
- Verhalten, Anzeige und gespeicherte Daten bleiben unverändert.

## 9.25.2 – 2026-11-20

**Freiwillige Unterstützung per PayPal in der README**

- Die README hat einen Abschnitt „Unterstützen“ mit einem freiwilligen PayPal-Link. Die Nutzung der Software und die Lizenz bleiben davon unberührt.
- Das öffentliche Repository bekommt den Sponsor-Knopf („Sponsor“ oberhalb der Dateiliste) über die Datei .github/FUNDING.yml; sie bleibt bei jeder neuen Version erhalten.
- Im Programm selbst ändert sich nichts (kein Link in der Fußzeile).

## 9.25.1 – 2026-11-20

**Browser-Symbol (Favicon) auch als ICO-Datei**

- Fehlerbehebung: Unter Profil & Branding wurde für das Browser-Symbol keine .ico-Datei angenommen („Dateiformat wird nicht unterstützt“). Das Browser-Symbol darf jetzt zusätzlich eine ICO-Datei sein (auch mit mehreren Größen, mindestens 32 × 32 im größten Bild). Die anderen Bildplätze bleiben bei PNG, WebP, JPG und GIF.
- Hinweistexte und Dateiauswahl nennen das ICO-Format beim Browser-Symbol.

## 9.25.0 – 2026-11-20

**Veröffentlichung der neutralen Fassung vorbereitet**

- Der Quellcode-Hinweis in der Fußzeile der neutralen Fassung verweist auf das öffentliche Repository (bot-control-center). Die Fassung für die eigene Installation ändert sich nicht.
- Neues Werkzeug für die Veröffentlichung: Jede Version wird vor dem Hochladen auf Altwerte, Dateiliste, Verweise und neutrale Tests geprüft; schlägt eine Prüfung fehl, wird nichts veröffentlicht. Bestehende Veröffentlichungen werden nie überschrieben.
- Update-Paket, Werkzeug-Paket und Manifest der öffentlichen Fassung entstehen im selben Format wie bisher, damit das Update-Werkzeug sie später ohne Zugangsschlüssel lesen kann.

## 9.24.0 – 2026-11-20

**Hilfe → Rechtliches und neutrale Standardfigur für das Punktespiel**

- Neuer Tab „Rechtliches“ unter Hilfe: Lizenz mit Kurzfassung (Erlaubt / Nicht erlaubt), Annahme, Prüfsumme und vollständigem Text sowie die Begleitdokumente (Datenschutz, Sicherheit, Drittkomponenten, Mitwirken, Urheberhinweis). Die Texte sind auch ohne Anmeldung lesbar (/api/license/text, /api/legal).
- Punktespiel-Overlay: Ohne hochgeladene Figur erscheint jetzt eine eingebaute neutrale Standardfigur, ein Lehrer mit Brille, Strickjacke und Krawatte, in den drei Zuständen Kontrolle, bestanden und durchgefallen. Ein eigenes Bild lässt sich weiterhin unter Profil & Branding hochladen und ersetzt die Standardfigur.
- Die Laufmännchen im Overlay haben in der neutralen Fassung keinen Helm mehr (Haare, bunte Kleidung). Bestehende Installationen mit der bisherigen Figur sehen keine Änderung.
- Export für die öffentliche Fassung: ersetzt das Sprite-Blatt durch das neutrale, behält die Begleitdokumente zusätzlich unter public/legal (für die Anzeige in der Oberfläche) und prüft die Verweise der Hauptordner-Fassung.

## 9.23.0 – 2026-11-20

**Öffentliche Fassung: neutrale Anleitungen und Begleitdokumente**

- Die Discord-Anleitung (DISCORD-SETUP.md) ist neu geschrieben: nach Themen statt nach Versionen, ohne Kennungen und Namen einer bestimmten Installation, mit den neutralen Rollenbezeichnungen Administrator, Moderator und Mitglied.
- Die Anleitung zum Punktespiel (STUBENKONTROLLE-SETUP.md) und das Prüfprotokoll sind neutral neu geschrieben (Spielname, Punktename und Befehle sind einstellbar).
- Neue Begleitdokumente für die öffentliche Fassung: SECURITY.md (Meldeweg), PRIVACY.md (Datenverarbeitung, externe Verbindungen, keine Telemetrie), CONTRIBUTING.md, NOTICE und THIRD_PARTY_LICENSES.md (Drittkomponenten); die README enthält eine Lizenzübersicht und eine aktuelle Dokumentenliste. Die Quellen liegen unter public/legal.
- Export-Werkzeug: legt die Dokumente im Hauptordner ab, erzeugt CHANGELOG.md aus dem Änderungsprotokoll, lässt Bilder und Videos der Bestandsinstallation aus (u. a. Banner mit Emblem) und meldet jede nicht freigegebene Binärdatei als Fund.
- Das Dokument THIRD-PARTY-NOTICES.md ist in THIRD_PARTY_LICENSES.md aufgegangen und enthält jetzt auch die Bibliotheken des optionalen MCP-Dienstes.

## 9.22.0 – 2026-11-20

**Lizenz: Bot Control Center Community License (BCC-CL 1.0)**

- Die Software steht unter der Bot Control Center Community License (BCC-CL 1.0): kostenlos nutzbar, auch mit monetarisierten Kanälen und dienstlich; Weiterverkauf, kostenpflichtiges Hosting und unautorisierte Weitergabe sind ohne Genehmigung untersagt. Der vollständige Text liegt unter public/license und ist unter /api/license/text ohne Anmeldung lesbar.
- Neue Installationen: Der Einrichtungsassistent beginnt mit der Lizenzvereinbarung (Kurzfassung, vollständiger Text, Zustimmung). Ohne Zustimmung kann die Einrichtung nicht abgeschlossen werden.
- Version, Zeitpunkt und Prüfsumme der angenommenen Lizenz stehen in Administration → Profil & Branding → Lizenz. Es wird nichts an den Lizenzgeber übermittelt.
- Bestehende Installationen gelten als angenommen (einmaliger Vermerk beim ersten Start, keine Abfrage).
- Update-Werkzeug: Lizenz- und Rechtsdateien im Hauptordner (LICENSE.md, PRIVACY.md, SECURITY.md u. a.) sind für künftige Releases erlaubt.
- Technisch: Der Export für die öffentliche Fassung legt LICENSE.md und LICENSE-SUMMARY.md an und prüft zusätzlich auf Hinweise zu KI-Werkzeugen.

## 9.21.0 – 2026-11-20

**Vorbereitung der öffentlichen Fassung (Export und Prüfung)**

- Ein Export-Werkzeug erzeugt aus dem Entwicklungsstand eine neutrale Fassung und prüft sie (Suchlauf über alle Dateitypen, Dateiliste, Verweise, neutrale Tests). Es ist ein Probelauf: Es wird nichts veröffentlicht.
- Hilfetext der Team-Seite: neutrale Beispiel-Aliase statt Namen aus der bisherigen Installation.
- Die Anwendung selbst ändert sich nicht.

## 9.20.4 – 2026-11-19

**Browser-Symbol (Favicon) mit Upload**

- Die Weboberfläche hat ein Browser-Symbol für Tab und Lesezeichen. Ohne Upload erscheint ein neutrales mitgeliefertes Symbol.
- Eigenes Symbol: Administration → Profil & Branding → Bildplatz „Browser-Symbol (Favicon)“ (PNG, JPG, WebP oder GIF, quadratisch, mindestens 64 Pixel, empfohlen 256). Der Austausch wirkt nach dem Neuladen der Seite; Browser zwischenspeichern Symbole teils länger.

## 9.20.3 – 2026-11-19

**Subathon: eigene Kanal-Verbindung, korrekte Anzeige**

- Subathon: Abos, Geschenkabos, Resubs und Bits laufen jetzt über eine eigene EventSub-Verbindung mit dem Token des Kanal-Kontos (Twitch bindet eine Verbindung an den Benutzer des Tokens). Sie startet nur bei eingeschaltetem Modul und verbundenem Kanal-Konto und wird bei geänderten Rechten oder fehlgeschlagenen Abos selbst neu aufgebaut.
- Behoben: Die Subathon-Karte zeigte „Kanal-Konto nicht verbunden“, weil sie das Konto unter dem falschen Schlüssel suchte; fehlende Rechte werden jetzt angezeigt.
- Behoben: Subathon-Ereignisse hätten den Weg vom Twitch-Bot zur Weboberfläche nicht passiert (Ereignisnamen mit Punkt werden abgelehnt).
- Die Karte nennt das zuständige Konto, erklärt, wo neu autorisiert wird, und hat den Knopf „Verbindung prüfen“.

## 9.20.2 – 2026-11-19

**Aufräumen: weniger Dateien, neutrale Texte**

- Im Hauptordner liegt nur noch die UPDATE-Datei der aktuellen Version; der Verlauf steht in diesem Änderungsprotokoll.
- Veraltete Einmal-Anleitungen (alte Datenbank-Umstellung, Umstellung auf 8.12.0, Werkzeug-Upgrade 1.5.0) sind entfernt.
- Änderungsprotokoll und Anleitungen: Markennamen, frühere Rollen- und Bot-Bezeichnungen durch neutrale Begriffe ersetzt. Keine Funktionsänderung.

## 9.20.1 – 2026-11-19

**Subathon: Einstellungen vor dem Start ändern, optionales Logo**

- Subathon: Regeln und Overlay-Darstellung (Farben, Schrift, Beschriftung, Namen) können bearbeitet werden, solange das Event noch nicht gestartet ist; ab dem Start sind sie gesperrt.
- Subathon-Overlay: optionales Logo über den neuen Bildplatz „Subathon-Logo“ (Administration → Profil & Branding).
- Ungültige Farbangaben werden auf die Standardfarben zurückgesetzt.

## 9.20.0 – 2026-11-19

**Neues Modul: Subathon**

- Subathon (Modul, standardmäßig aus): Countdown wird durch Abos/Resubs, geschenkte Abos, Bits und optional Follows verlängert; Zeit je Ereignis, Startdauer, maximale Restzeit, Gesamtdauer und Tageslimit sind einstellbar.
- Beim Start eines Subathons wird ein laufender Followathon beendet (mit Bestätigung); solange der Subathon läuft, ist der Followathon gesperrt.
- OBS-Overlay unter /subathon/overlay, Protokoll, manuelle Zeitkorrektur und geschützter Testmodus; neue Rechte twitch.subathon.view/edit.
- Twitch-Rechte channel:read:subscriptions und bits:read werden nur angefordert, wenn das Modul eingeschaltet ist; das Kanal-Konto muss danach einmal neu verbunden werden.

## 9.19.0 – 2026-11-19

**Rechteverwaltung blendet ausgeschaltete Module aus**

- Benutzer & Rechte: Bereiche, deren Modul ausgeschaltet ist, werden in der Rechtematrix ausgeblendet (mit Hinweis je Gruppe); Gruppen ohne sichtbare Bereiche verschwinden.
- Bereits gespeicherte Rechte bleiben unverändert erhalten und gelten wieder, sobald das Modul eingeschaltet wird.
- Geteilte Rechte (z. B. Discord-Moderation für Levelsystem und Moderation) werden nur ausgeblendet, wenn alle zugehörigen Module aus sind.

## 9.18.1 – 2026-11-19

**Neutralisierung: Levelsystem**

- Neue Installationen starten im Levelsystem mit neutralen Stufen (Stufe 1–10), neutralen Missionen und dem Kanalnamen „LEVELSYSTEM“; Namen und XP-Schwellen sind weiterhin frei einstellbar (Ränge bearbeiten).
- Der Befehl für Missionen heißt in neuen Installationen /mission (Bestandsinstallation: /einsatz). Teilstreitkräfte entfallen in neuen Installationen: kein /teilstreitkraft, nur ein Namensfeld je Rang, keine Zweig-Spalten.
- Alle Texte des Levelsystems (Rang, Aufstieg, tägliche Meldung, Missionen) kommen aus dem Textpaket; die Bestandsinstallation behält Dienstgrade, Einsätze, Beförderungen und Teilstreitkräfte wortgleich.
- Intern: Voreinstellung der Bestandsinstallation (26 Dienstgrade, Einsätze, Kanalnamen) liegt nur noch in der Übernahme-Datei; gespeicherte Konfigurationen haben weiter Vorrang. Leak-Test ohne Ausnahme für das Levelsystem.

## 9.18.0 – 2026-11-19

**Neutralisierung: Rollennamen, Überschriften, interne Schlüssel**

- Neue Installationen zeigen überall neutrale Rollennamen (Member, Moderator, Administrator) statt der bisherigen Bezeichnungen; die Bestandsinstallation behält ihre bisherigen Bezeichnungen.
- Punktespiel: Die drei Overlay-Überschriften (Anmeldung, Kontrolle, Ergebnis) sind jetzt in den Einstellungen frei änderbar; Standard neutral, Bestandsinstallation behält die bisherigen Überschriften.
- Lurk-Rückkehr: neutrale Standardtexte für neue Installationen; bereits gespeicherte Texte bleiben unverändert.
- Intern: Rollenschlüssel im Discord-Dienst und in der Oberfläche heißen jetzt moderator/administrator/member; gespeicherte Kanalzeiten, Wartungsmodus und Berechtigungen (bisherige Rechtenamen → discord.member.*) werden automatisch übernommen, die bisherigen Umgebungsvariablen bleiben gültig (Compose unverändert).
- Overlay: Markenspezifischer Schriftname, Farbvariable und Skriptname neutralisiert; Prüftest gegen Rückfall erweitert.
- Folgt in 9.18.1: Levelsystem (neutrale Stufen, /mission, keine Teilstreitkräfte).

## 9.17.8 – 2026-11-19

**Design: Kontrast auf Standardniveau**

- Alle Texte auf allen Seiten (Twitch und Discord, Hell und Dunkel) erreichen jetzt mindestens das Kontrastverhältnis 4,5 (zuvor 3): Favoriten-Stern, Plattform-Symbole T/D, Code-Platzhalter wie {caught} im hellen Design; „EventSub“-Beschriftung und „Schutzfunktion“ im dunklen Design.
- Weitere Seiten (Punktespiel, Community, Module, Backup, Hilfe) auf gestapelte Karten geprüft: keine weiteren Auffälligkeiten.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.7 – 2026-11-19

**Design: fehlende Raster**

- Live-Zentrale → Followathon: Das Formular „Followathon anlegen“ stand einspaltig mit eng aufeinanderliegenden Feldern; jetzt vierspaltiges Raster mit Abstand, Farbfelder in normaler Höhe (Seite ca. 430 Pixel kürzer).
- Administration → Systemstatus: Die 20 Leistungskennzahlen („Nachrichtenverarbeitung & Persistenz“) standen untereinander (ca. 2170 Pixel hoch); jetzt als Kachelraster (ca. 305 Pixel).
- Gefunden durch eine Prüfung aller Oberflächen-Klassen auf fehlende Stilregeln; weitere Seiten sind unverändert.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.6 – 2026-11-19

**Design: Lesbarkeit in beiden Designs**

- Alle Seiten beider Plattformen wurden im hellen und im dunklen Design auf zu schwachen Kontrast geprüft und korrigiert.
- Dunkles Design: Fehlermeldungen (dunkelrot auf dunkel), Hilfetexte, Beschriftungen der Kennzahlen in der Übersicht und der Fußzeilen-Link „Quellcode & Lizenz“ (war blau auf dunkel) sind jetzt gut lesbar.
- Helles Design: „Fehlt: …“-Hinweise in der Diagnose, der Favoriten-Stern, „Ctrl K“ in der Kopfzeile, die Fußzeile und „Schutzfunktion“ bei den Modulen sind kräftiger.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.5 – 2026-11-19

**Design: Korrektur Helles Design und Kartenköpfe**

- Korrektur im hellen Design: Der Name oben rechts in der Kopfzeile war dunkel auf dunklem Grund und kaum lesbar. Im aufgeklappten Konto-Menü waren „Verknüpfte Konten“, „Twitch“ und „Discord“ weiß auf weiß und die Kontonamen gelb auf weiß. Alles ist jetzt lesbar; „Alle Sitzungen abmelden“ ist im hellen Design kräftiger rot.
- Karten, die mit einem Titelblock beginnen (z. B. Instagram, TikTok, Letzte Veröffentlichungen), haben oben nicht mehr den doppelten Abstand (34 statt 17 Pixel bis zur Überschrift).
- Die Knöpfe „Original“ und „Demo senden“ in der Veröffentlichungsliste sind gleich hoch.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.4 – 2026-11-19

**Design: Übersicht und Sonderknöpfe**

- Design (fünfter Teil): Die Kennzahlen „Aktive Funktionen“ in der Übersicht stehen bei dieser Breite in einer Zeile statt in zwei (etwa 100 Pixel weniger Höhe) und passen sich der Fensterbreite an.
- Symbol-Knöpfe (z. B. Löschen bei den Follow-Meldungen) haben dieselbe Höhe wie alle anderen Knöpfe.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.3 – 2026-11-19

**Design: Einzelfälle**

- Design (vierter Teil): Die Erklärkarte „So funktionieren Event-Profile“ ist jetzt einklappbar und standardmäßig zu (etwa 270 Pixel weniger Höhe); ein Klick auf die Überschrift klappt sie auf.
- Module-Karten in der Administration sind etwas kompakter; Überschriften am Anfang von Karten haben einen einheitlichen kleineren Abstand.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.2 – 2026-11-19

**Design: Knöpfe, Eingabefelder und Reiter**

- Design (dritter Teil): Knöpfe, Eingabefelder und Auswahllisten haben jetzt dieselbe Höhe (34 Pixel statt 36 bis 40) und denselben Eckenradius; in Zeilen mit Feld und Knopf (z. B. Testnachricht) stehen sie auf einer Linie.
- Die Reiter der Seiten sind etwas niedriger; die Reiterleiste der Administration bleibt unverändert einzeilig (bei 1280 bis 1920 Pixel Breite gemessen).
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.1 – 2026-11-19

**Design: Seitenkopf**

- Design (zweiter Teil): Der Kopf jeder Seite (Überschrift und Hinweistext) ist gestrafft und braucht etwa 35 Pixel weniger Höhe; der Inhalt beginnt früher.
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.17.0 – 2026-11-18

**Design: Maßsystem, Abstände und Kacheln**

- Design (erster Teil, weitere Schritte folgen in 9.17.x): einheitliches Maßsystem für Abstände, Radien und Kachelmaße als gemeinsame Variablen.
- Korrektur: Karten in Listen und Rastern hatten doppelten Abstand (z. B. rund 36 statt 12 Pixel zwischen den Modul-Karten in der Administration). Betrifft Module, Community, Moderation, Auswertung, Systemstatus und Backup.
- Status-, Kennzahl- und Zählerkacheln sind einheitlich und etwas kompakter (z. B. Statuskarten der Übersicht 74 → 62 Pixel, Statistik- und Diagnosekacheln rund 20 Pixel niedriger).
- Nur Darstellung: keine Funktionsänderung, keine Datenänderung.

## 9.16.0 – 2026-11-18

**Neutrale Vorlage und Installationsanleitung**

- Neu: Installationsanleitung tools/compose/INSTALLATION.md für eine eigene Installation auf NAS, Server oder Docker Desktop (Dateien, Zugangsdaten, Compose-Anpassung, Ersteinrichtung, Weiterleitungsadressen).
- Die Compose-Vorlage und die Setup-Anleitungen enthalten keine festen Adressen, Netze oder Kanalnamen mehr (Platzhalter bot.example.org, 192.168.1.x).
- Der Leak-Test schlägt jetzt fehl, wenn feste Marken-, Domain-, Heimnetz-, Discord-ID- oder Punktenamen im Programmcode auftauchen.
- Letzte feste Texte neutralisiert (Hinweis zur Twitch-Anwendung, Hilfetexte zu Timern, Filtern und Banner).
- Bestandsinstallation: keine Änderung am Verhalten; die produktive compose.yaml bleibt unberührt.

## 9.15.1 – 2026-11-18

**Login-Protokoll und Discord in der Ersteinrichtung**

- Neu: Die Ersteinrichtung hat einen optionalen Schritt „Discord“ (Server-ID). Die Rollen legst du später unter Discord → Rollen fest, sobald der Bot auf dem Server ist. Das Punktespiel ist jetzt Schritt 6.
- Korrektur: Das Login-Protokoll zeigt statt „Log-Datei: 0 B / noch leer“ jetzt den Speicherort („Datenbank“). Ohne Datenbank steht dort weiter die Dateigröße.

## 9.15.0 – 2026-11-18

**Dynamische Bot-Liste**

- Neu: Dynamische Bot-Liste. Unter Administration → Twitch-Verbindungen gibt es die Karte „Bots und Kanal“: ein Kanal-Konto, ein Haupt-Bot (Moderationsrechte, Pflicht) und beliebig viele weitere Bots, die sich hinzufügen, umbenennen und entfernen lassen.
- Neu: Die Grunddaten stehen jetzt in ihren Fachbereichen und werden einzeln gespeichert: Öffentliche Adresse und Weiterleitungsadressen im neuen Reiter Administration → Adresse, Punktespiel (Name, Punktename, Befehle) in der Stubenkontrolle, Discord-Server und Rollenfunktionen unter Discord → Rollen. Profil & Branding behält Name, Bilder und Impressum. Die Reiterleiste bleibt einzeilig wie bisher.
- Neu: Die Ersteinrichtung fragt jetzt Kanal-Login und Haupt-Bot ab (Schritt 4 „Kanal und Haupt-Bot“, danach Schritt 5 „Punktespiel“). Der Kanal-Login ist Pflicht, außer die Umgebungsvariable TWITCH_CHANNEL_LOGIN gibt ihn vor.
- Wird ein Bot entfernt, senden die Funktionen, die ihn gewählt hatten, danach über den Haupt-Bot. Die Token-Datei des entfernten Bots bleibt auf dem Datenträger liegen.
- Alle Auswahllisten (Befehle, Auto-Antworten, Timer, Events, Filter, Lurk-Rückkehr, Clip-Weitergabe) und die Statuskarten kommen aus der Bot-Liste. Neu: Der Bot für die Clip-Weitergabe ist wählbar.
- Neue Installationen starten mit einem neutralen Haupt-Bot; der Kanal-Login kann im Profil gesetzt werden (die Umgebungsvariable TWITCH_CHANNEL_LOGIN geht weiter vor; ohne beides gibt es keinen Besitzer über den Kanalnamen).
- Bestandsinstallation: Die bisherigen fünf Bots, ihre Schlüssel, Token-Dateien und gespeicherten Bot-Zuordnungen bleiben unverändert; beim ersten Start wird die Bot-Liste daraus übernommen.
- Interne Änderung: Keine festen Bot-Namen mehr im Programmcode; die neutralen Standardwerte lassen das Bot-Feld leer (= Haupt-Bot).

## 9.14.1 – 2026-11-18

**Schreibsperre für neue Discord-Mitglieder und Bilder in der Sicherung**

- Neu: Unter Discord → Freischaltung lässt sich eine Schreibsperre nach der Regelannahme einstellen (Minuten, 0 = aus, Standard aus). Beim Vergeben der Freischaltrolle setzt der Bot einen Timeout: Das Mitglied sieht die Kanäle, kann aber erst nach Ablauf schreiben. Hintergrund: Discords eigene Wartezeit von 10 Minuten gilt nicht für Mitglieder mit einer Rolle.
- Der Timeout wird vor der Rollenvergabe gesetzt, verkürzt nie einen bereits laufenden Timeout, blockiert die Freischaltung bei einem Fehler nicht und wird im Discord-Log vermerkt. Der Bot braucht dafür die Berechtigung „Mitglieder moderieren“.
- Neu: Die hochgeladenen Bilder (Logo, Banner, Emblem, Figur) sind ein eigener Bereich der Sicherung und werden beim Wiederherstellen erneut geprüft.
- Das Größenlimit für Sicherungsdateien beim Wiederherstellen wurde auf 64 MB erhöht.

## 9.14.0 – 2026-11-18

**Bild-Upload für Banner, Emblem, Spielfigur und Logo (D1, Schritt 4)**

- Neu: Unter Administration → Profil & Branding gibt es den Bereich „Bilder“. Owner können für Follower-Alert-Banner, Follower-Alert-Emblem, Figur des Punktespiels und Logo der Weboberfläche eigene Bilder hochladen und jederzeit auf den Standard zurücksetzen.
- Erlaubt sind PNG, WebP, JPG und GIF bis 5 MB; SVG ist aus Sicherheitsgründen nicht erlaubt. Die Dateiart wird am Inhalt geprüft, nicht am Dateinamen. Größe und Seitenverhältnis werden geprüft (Banner empfohlen 2126×387, Emblem 256×256, Figur 512×512, Logo 512×512).
- Das Follower-Alert-Overlay und das Overlay des Punktespiels verwenden die hochgeladenen Bilder; das Logo erscheint links in der Kopfzeile.
- Bestehende Installation: Banner und Emblem bleiben das bisherige Bild, die Figur bleibt die bisherige Animation – ohne Upload ändert sich nichts. Neue Installationen starten ohne Bilder (schlichter Hintergrund, keine Figur).
- Hochgeladene Dateien liegen im Ordner data/uploads der Installation.

## 9.13.0 – 2026-11-17

**Neutrale Standardtexte, Link-Freigaben und Fußzeile (D1, Schritt 3)**

- Neu: Standardtexte sind jetzt neutral (Willkommens-, Follow-, Team- und Moderationstexte, Discord-Regeln, Willkommens-, Sperr- und Entsperrtexte, Einladungstexte, Stubenkontrolle/Punktespiel-Sprüche, Testmeldungen). Neue Installationen starten ohne Marken- und Fachsprache.
- Bestehende Installation: Die bisherigen Standardtexte werden einmalig als Textpaket „legacy-bwk“ übernommen und bleiben wortgetreu erhalten; gespeicherte Texte werden nicht verändert.
- Neu: Die Link-Freigaben (Domains/Links) sind in neuen Installationen leer; die bisherigen Werte bleiben in bestehenden erhalten.
- Neu: Fußzeile mit festem Hinweis auf den Ersteller (Mario Janssen, Link zum Impressum), festem Link zu Quellcode & Lizenz und einem optionalen Impressum des Betreibers (Profil & Branding, nur https).
- Intern: neue Textpaket-Verwaltung (shared/text-pack.js), neue Tests.

## 9.12.0 – 2026-11-17

**Discord-Server und Rollen in Profil & Branding (D1, Schritt 2)**

- Neu: In Administration → Integrationen → Profil & Branding steht jetzt der Abschnitt „Discord-Server und Rollen“. Dort werden die Discord-Server-ID und die Rollen Administrator, Moderator, Member (Freischaltrolle) und die Rolle des Bots festgelegt. Die Rollen wählt man aus der Rollenliste des Servers.
- Bestehende Installation: Server und Rollen werden beim ersten Start einmalig aus den bisherigen Werten übernommen. Die bisherigen Rollen werden den neutralen Rollen Administrator, Moderator und Member zugeordnet. Die IDs bleiben gleich, sichtbar ändert sich nichts. Die Umgebungsvariablen in der compose.yaml gelten weiter und haben Vorrang.
- Neue Installationen brauchen für Discord nur noch Client-ID, Secrets und Bot-Token in der Installation. Server-ID und Rollen werden in der Oberfläche eingerichtet; der Discord-Dienst startet auch ohne sie und verbindet sich, sobald alles vorliegt.
- Feste Discord-IDs sind aus dem Code entfernt (Rollen für Rechte und Rollenvergabe, Avatar-Adressen, Mitglied-Anzeige in der Mitgliederliste, Stabsraum-Rückfall). Kategorien und Kanäle aus der Umgebung sind nur noch Vorbelegungen und nicht mehr Pflicht.
- Die Discord-Weiterleitungsadresse wird aus der öffentlichen Adresse abgeleitet. DISCORD_REDIRECT_URI aus der Installation hat Vorrang.
- Neue Umgebungsvariablen (optional): DISCORD_ROLE_ADMINISTRATOR_ID, DISCORD_ROLE_MODERATOR_ID, DISCORD_ROLE_MEMBER_ID. Die bisherigen Namen die früheren Rollen-Variablen funktionieren weiter.

## 9.11.0 – 2026-11-17

**Profil & Branding, Ersteinrichtung, anpassbares Punktespiel (D1, Schritt 1)**

- Neu: Administration → Integrationen → Profil & Branding. Dort stehen der Name der Oberfläche, die öffentliche Adresse mit den Weiterleitungsadressen für Twitch und Discord sowie Name, Punktename und Befehle des Punktespiels. Lesen dürfen Administratoren, ändern nur Owner.
- Bestehende Installation: Alle bisherigen Werte werden beim ersten Start einmalig übernommen (bisheriger Name der Installation, Stubenkontrolle mit Punkten und den Befehlen !stube, !punkte, !topspind, !stubenhilfe). Sichtbar ändert sich nichts.
- Neue Installationen starten neutral (Bot Control Center, Punktespiel mit !spiel, !punkte, !top, !spielhilfe) und zeigen statt der Anmeldung einen Einrichtungsassistenten. Er ist durch einen Einrichtungscode geschützt, der nur im Protokoll des Containers bcc-web steht. Das funktioniert auf Synology, VPS und Docker Desktop gleich.
- Öffentliche Adresse: PUBLIC_BASE_URL aus der Installation hat Vorrang. Ist sie nicht gesetzt, gilt die Adresse aus Profil & Branding. https ist Pflicht, http ist nur für localhost erlaubt. Weiterleitungsadressen und die Overlay-Adresse der Stubenkontrolle werden daraus abgeleitet, es steht keine feste Domain mehr im Code.
- Punktespiel: Die Befehle für Runde, Kontostand, Rangliste und Hilfe sowie Spiel- und Punktename sind anpassbar. Doppelte oder anderweitig belegte Befehle werden abgelehnt. !daily, !give und !gift bleiben fest. Neue Befehlsnamen gelten im Chat spätestens nach 30 Sekunden.
- Kleine Textänderungen im Chat: „Erlaubter Einsatz: 50 bis 500 Punkte.“ und „Nächste Runde Stubenkontrolle in … Min.“
- Lokales Netz für den lokalen Admin-Login: Der Standard sind jetzt die üblichen privaten Netze. Gesetzte Werte in der compose.yaml gelten unverändert.
- Sicherungen tragen die neutrale Kennung „Bot Control Center Backup“; ältere Sicherungen lassen sich weiter einspielen. Beim Wiederherstellen bleibt das Installationsprofil unverändert.
- Keine Änderung an Datenbankschema, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.10.0 – 2026-11-17

**Stubenkontrolle: !gift für den Owner**

- Neuer Chat-Befehl !gift NICK BETRAG: Der Owner verschenkt Punkte, ohne dass sein eigenes Guthaben belastet wird. Buchung „Geschenk (!gift)“ beim Empfänger, Eintrag im Activity Board.
- Einstellbar in der Stubenkontrolle (nur für Owner): wer !gift nutzen darf – Kanalinhaber (Standard an) und/oder Owner des Control Centers über ihr verknüpftes Twitch-Konto (Standard aus) – sowie der Höchstbetrag pro Geschenk (Standard 10.000, 0 = unbegrenzt).
- Wer nicht berechtigt ist, bekommt keine Antwort; !gift wird dann wie ein unbekannter Befehl behandelt. !give bleibt unverändert (Überweisung vom eigenen Guthaben).
- Vorsorge: Alle Datumsspalten der Datenbank werden als Text gelesen, sodass Statistiken auch bei gesetzter Container-Zeitzone den richtigen Tag zeigen.
- Keine Änderung an Datenbankschema, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.9.1 – 2026-11-16

**Korrektur: !daily nur noch einmal pro Tag**

- Stubenkontrolle: !daily ließ sich mehrmals am Tag abholen (für alle, auch für den Owner). Ursache: Die Datenbank lieferte das Datum der letzten Abholung in einem anderen Format, sodass der Vergleich „heute schon abgeholt“ nie zutraf. Jetzt gilt wieder: einmal pro Kalendertag (Zeitzone Berlin).
- Gleiche Ursache behoben bei den Tageszählern der Command- und Auto-Reply-Statistik („heute“), die dadurch bei jedem Lesen auf null zurückfielen.
- Bereits zu viel ausgezahlte Punkte werden nicht automatisch zurückgebucht; das geht bei Bedarf über die Korrektur in der Stubenkontrolle.
- Keine Änderung an Datenbankschema, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.9.0 – 2026-11-16

**Modulschalter: Meldungen und Kanalzeiten abschaltbar**

- Meldungen und Kanalzeiten lassen sich unter Administration → Integrationen → Module ausschalten (Gruppe „Discord“). Nach dem Update sind beide eingeschaltet, das Verhalten ändert sich nicht.
- Meldungen aus: „Nachricht melden“, „User melden“, /melden und der Melde-Knopf antworten „Das Meldesystem ist derzeit deaktiviert.“; Reiter, Schnellzugriff und Kennzahl im Discord-Lagebild sind ausgeblendet bzw. gesperrt. Bisherige Meldungen und Anhänge bleiben gespeichert.
- Kanalzeiten aus: Der Bot öffnet und schließt keine Kanäle mehr, auch nicht beim Start oder nach dem Notfallmodus. Die Kanäle bleiben im Zustand zum Zeitpunkt des Ausschaltens. Zeitpläne bleiben gespeichert.
- Freischaltung, Notfallmodus, Sanktionsübersicht, Userhistorie sowie Protokoll & Test bleiben fester Bestandteil des Discord-Teils.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.8.0 – 2026-11-16

**Modulschalter: Discord-Ankündigungen und Einladungslink abschaltbar**

- Discord-Ankündigungen und Einladungslink lassen sich unter Administration → Integrationen → Module ausschalten (Gruppe „Twitch und Discord“). Nach dem Update sind beide eingeschaltet, das Verhalten ändert sich nicht.
- Ankündigungen aus: Stream-Starts und Clips werden nicht in Discord gemeldet; bereits eingereihte Meldungen werden verworfen statt gepostet. Meldungen aus dieser Zeit werden nicht nachgeholt.
- Einladungslink aus: Der Link wird nicht geprüft oder erneuert, und {discord_invite} in Twitch-Commands zeigt den festen Ersatztext. Einstellungen und der bestehende Link bleiben erhalten.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.7.0 – 2026-11-16

**Modulschalter: Clips und Event-Profile abschaltbar**

- Clips und Event-Profile lassen sich unter Administration → Integrationen → Module ausschalten. Nach dem Update sind beide eingeschaltet, das Verhalten ändert sich nicht.
- Clips aus: keine Clip-Suche, kein Teilen im Twitch-Chat, keine Clip-Meldung an Discord; Clips aus dieser Zeit werden nicht nachgeholt. Event-Profile verändern das Clip-Teilen dann nicht.
- Event-Profile aus: kein Profilwechsel möglich, der zuletzt angewendete Zustand bleibt stehen; Änderungen an Commands, Timern usw. werden nicht in die Profile übernommen. Alle Profile bleiben gespeichert.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.6.0 – 2026-11-16

**Moderation abschaltbar – getrennt nach System, mit verschärfter Warnung; Wortfilter je Plattform**

- Drei neue Module unter Administration → Integrationen → Module: „Twitch-Chat-Filter“ (Links, Emotes, Satzzeichen, Großbuchstaben), „Wortfilter“ (Twitch und Discord) und „Discord-Moderation“ (Spam-Schutz, Link-Filter). Nach dem Update sind alle eingeschaltet, das Verhalten ändert sich nicht.
- Diese Module sind als Schutzfunktion markiert: Beim Ausschalten erscheint eine verschärfte Warnung, und der Modulname muss zur Bestätigung eingetippt werden.
- Der Discord-Notfallmodus, Sanktionsübersicht, Userhistorie, Meldungen sowie „Protokoll & Test“ bleiben immer verfügbar.
- Wortfilter je Plattform: Auf der Wortfilter-Seite lässt sich der Wortfilter für Twitch und für Discord getrennt ein- und ausschalten.
- Event-Profile: neue Schalter „Wortfilter (Twitch)“ und „Wortfilter (Discord)“. Bestehende Profile übernehmen beim ersten Speichern den aktuellen Stand (an). Link-, Emote-, Satzzeichen- und Großbuchstaben-Filter bleiben wie bisher im Profil schaltbar.
- Ist ein Moderationsmodul aus, zeigen Event-Profile dessen Schalter nicht an und ändern sie nicht; Einstellungen, Wortbestand und Protokolle bleiben gespeichert. Discord-Befehl /add nimmt bei ausgeschaltetem Wortfilter keine Begriffe an.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.5.0 – 2026-11-16

**Modulschalter: Levelsystem / Dienstgrade abschaltbar**

- Das Discord-Minigame (Levelsystem / Dienstgrade) lässt sich unter Administration → Integrationen → Module ausschalten (Gruppe „Discord“). Nach dem Update ist es eingeschaltet, das Verhalten ändert sich nicht.
- Ausgeschaltet: keine XP für Nachrichten, keine XP-Rücknahmen, keine Beförderungen und Rollenänderungen, keine Topliste; /rang, /toprang, /rangliste, /teilstreitkraft, /dailyxp und /einsatz sowie die Minigame-Knöpfe antworten „Das Minigame ist derzeit deaktiviert.“
- Niemand verliert seine Dienstgrad-Rolle; XP-Stände, Verlauf und Einstellungen bleiben gespeichert. Aktivität aus der Aus-Zeit wird nicht nachgetragen.
- Die Minigame-Reiter und die XP-Spalte in der Discord-Mitgliederverwaltung sind ausgeblendet, die Verwaltung ist gesperrt.
- Der bisherige Schalter „Minigame aktiv“ in der Minigame-Konfiguration bleibt als zweite Ebene bestehen.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.4.0 – 2026-11-16

**Modulschalter erreichen den Discord-Bot; Social Media abschaltbar**

- Der Discord-Bot kennt jetzt den Modulstand: Die Weboberfläche schickt ihn bei jeder Änderung sofort, zusätzlich holt der Discord-Bot ihn beim Start und jede Minute. Fällt die Weboberfläche aus, gilt der zuletzt bekannte Stand – Module werden dadurch nie abgeschaltet.
- Social Media lässt sich unter Administration → Integrationen → Module ausschalten (Gruppe „Discord“). Nach dem Update ist das Modul eingeschaltet, das Verhalten ändert sich nicht.
- Ausgeschaltet: Instagram und TikTok werden nicht abgefragt, nichts wird in Discord veröffentlicht, alle Social-Media-Reiter, der Schnellzugriff und die Karte im Discord-Lagebild sind ausgeblendet, die Verwaltung ist gesperrt.
- Das Instagram-Zugangstoken wird auch bei ausgeschaltetem Modul weiter automatisch verlängert, damit die Verbindung nicht abläuft. Verbindungen, Einstellungen und Verlauf bleiben erhalten.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.3.0 – 2026-11-16

**Modulschalter: Followathon und Stubenkontrolle abschaltbar**

- Followathon und Stubenkontrolle lassen sich unter Administration → Integrationen → Module ausschalten. Nach dem Update sind beide eingeschaltet, das Verhalten ändert sich nicht.
- Ausgeschaltet: Reiter weg, Schnittstellen gesperrt, OBS-Quellen zeigen eine leere Seite, der Followathon bekommt keine Follows gutgeschrieben, die Spiel-Befehle der Stubenkontrolle (!stube, !punkte, !daily, !give, !topspind) werden nicht mehr beantwortet; eigene Commands mit gleichem Namen greifen dann wieder.
- Ein laufender oder pausierter Followathon und eine laufende Stubenkontrolle-Runde verhindern das Ausschalten.
- Event-Profile lassen die Stubenkontrolle bei ausgeschaltetem Modul unberührt.
- Alle Daten (Events, Gutschriften, Punkte, Runden, Buchungen) bleiben erhalten.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.2.0 – 2026-11-16

**Modulschalter: Gewinnspiel und Follower-Alert abschaltbar, Fundament für weitere Module**

- Gewinnspiel und Follower-Alert lassen sich unter Administration → Integrationen → Module ausschalten. Nach dem Update sind beide eingeschaltet, das Verhalten ändert sich nicht.
- Ausgeschaltete Module sind auch für die Schnittstellen gesperrt (Antwort „Modul ist ausgeschaltet“); die Daten bleiben erhalten.
- OBS-Quellen ausgeschalteter Module zeigen eine leere, transparente Seite (Follower-Alert).
- Ein Gewinnspiel, das gerade läuft, verhindert das Ausschalten des Moduls (erst beenden).
- Ausgeschaltet nimmt niemand mehr per Chat am Gewinnspiel teil, und neue Follower werden nicht eingeblendet.
- Event-Profile lassen Schalter ausgeschalteter Module unberührt: nicht angezeigt, nicht angewendet, gespeicherte Profilwerte bleiben.
- Seite „Module“ nach Plattform gegliedert, mit Angabe, in welchem Dienst das Modul läuft.
- Favoriten: Community, Top-Chatters, Lurk-Rückkehr, Auto-Replies, Follower-Alert, Wortfilter, Social Media, Updates und weitere Reiter lassen sich jetzt als Favorit speichern; Statistiken und Activity Board auch mit Twitch-Rechten.
- Keine Änderung an Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.1.2 – 2026-11-16

**Korrektur: ausgeschaltete Module auch in Suche und Favoriten unsichtbar**

- Die globale Suche findet ausgeschaltete Module nicht mehr (z. B. Lurk-Rückkehr). Bisher ließ sich der Reiter dort finden und öffnen.
- Favoriten eines ausgeschalteten Moduls werden ausgeblendet und lassen sich nicht öffnen; beim Wiedereinschalten erscheinen sie wieder.
- Wird ein Reiter eines ausgeschalteten Moduls direkt aufgerufen (z. B. zuletzt geöffnete Seite), öffnet sich stattdessen der erste erlaubte Reiter.
- Keine Änderung an Daten, Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.1.1 – 2026-11-16

**Modulschalter: Module lassen sich unter Administration → Integrationen ein- und ausschalten**

- Neue Seite Administration → Integrationen → Module (nur Administration): Jedes Modul hat einen Schieberegler. Beim Ausschalten erscheint eine Warnung, dass das unter Umständen zu Datenverlusten führen kann; abbrechen ist möglich.
- Ein ausgeschaltetes Modul ist in der Oberfläche nirgends sichtbar und läuft nicht. Erstes Modul: Lurk-Rückkehr – der Reiter unter Community entfällt, der Bot erfasst keine Lurks und meldet keine Rückkehr.
- Die Daten bleiben beim Ausschalten erhalten: Einstellungen, Stufen und laufende Lurk-Zustände bleiben gespeichert, nach dem Wiedereinschalten ist alles wie vorher. Solange das Modul aus ist, wird nichts erfasst.
- Der zusätzliche Schalter „Rückkehr-Meldungen aktiv“ auf der Einstellungsseite bleibt bestehen (zwei Ebenen: Modul freigeschaltet, Funktion aktiv).
- Neue Module sind nach dem Update ausgeschaltet. Lurk-Rückkehr ist es auch, es sei denn, „Rückkehr-Meldungen aktiv“ war bereits eingeschaltet: Dann bleibt das Modul an, das Verhalten ändert sich nicht.
- Das Ein- und Ausschalten erscheint im Activity Board (Bereich „Module“). Die Einstellungen eines ausgeschalteten Moduls lassen sich nicht überschreiben.
- Grundlage für alle künftigen Module: zentrale Modulregistrierung (shared/modules.js) mit Standardzustand, Abhängigkeiten, Oberflächen-Reitern und Warntext.
- Keine Änderung an compose.yaml, Datenbank, Abhängigkeiten oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.1.0 – 2026-11-15

**Neues Modul „Lurk-Rückkehr“: Der Bot meldet, wie lange jemand nach !lurk weg war**

- Wer einen Lurk-Command schreibt (Standard !lurk, weitere einstellbar), wird gemerkt. Bei der nächsten Chatnachricht meldet der Bot kurz, nach wie vielen Minuten oder Stunden die Person zurück ist.
- Die Meldung ist nach der Dauer gestaffelt und frei einstellbar. Standard im bisherigem Ton: bis 2 Minuten „Schnelles Comeback“, bis 10, 30, 60 und 180 Minuten je ein eigener Text, darüber eine Vermisstenmeldung.
- Neue Seite Community → Lurk-Rückkehr (gleiches Recht wie die Community-Seite): Ein/Aus, Commands, Bot, Stufen und Texte, Verfallszeit und Mindestabstand. Das Modul ist nach dem Update ausgeschaltet.
- Der bestehende Command !lurk und sein Antworttext bleiben unverändert; das Modul beobachtet ihn nur.
- Schutz des Chats: Meldungen haben niedrigen Vorrang (fallen bei Stau zuerst weg), zwischen zwei Meldungen liegt ein einstellbarer Mindestabstand, Lurks verfallen nach einstellbarer Zeit und werden bei einem neuen Stream verworfen.
- Laufende Lurks überstehen einen Neustart des Twitch-Bots (kleine Datei im Datenordner, keine Datenbankänderung).
- Keine Änderung an compose.yaml, Datenbank, Abhängigkeiten oder Update-Werkzeug (bleibt bei 1.8.0).

## 9.0.2 – 2026-11-15

**Dokumentation: README gekürzt, Titel „Bot Control Center“ (keine Funktionsänderung)**

- Der Titel der README lautet jetzt „Bot Control Center“.
- Die alten Hinweise zu 8.0.x am Ende der README sind entfernt.
- Keine Änderung an Code, Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0). Keine Handgriffe auf der NAS nötig.

## 9.0.1 – 2026-11-15

**Dokumentation: README auf den heutigen Aufbau gebracht (keine Funktionsänderung)**

- Die README beschreibt jetzt den heutigen Aufbau mit fünf Diensten, die Tests und den Weg von Release und Update. Sie nennt keine Versionsnummer mehr; den Stand zeigen VERSION, der Changelog und die GitHub-Releases.
- Die alten Hinweise zu 8.0.x stehen unverändert als Archiv am Ende der README.
- Keine Änderung an Code, Datenbank, compose.yaml oder Update-Werkzeug (bleibt bei 1.8.0). Keine Handgriffe auf der NAS nötig.

## 9.0.0 – 2026-11-15

**Entkopplung abgeschlossen: Weboberfläche, Twitch-Bot und Discord-Bot sind immer eigene Dienste**

- Die Weboberfläche enthält keinen Twitch-Bot mehr. Den früheren Betrieb in einem einzigen Container gibt es nicht mehr; der Aufbau aus eigenen Diensten ist der einzige.
- Neustart im Systemstatus: vier Ziele für die einzelnen Dienste (Weboberfläche, Twitch-Bot, Discord-Bot, alle). Die Karte „Dienste“ zeigt keine Betriebsart mehr.
- Die alten Dienst- und Containernamen (twitchbot, discordbot, frühere Namenspräfixe) sind aus dem Code entfernt; eingestellte Werte in der compose.yaml gelten unverändert.
- Die Skripte für Datenbank-Sicherung und -Wiederherstellung benutzen die heutigen Dienstnamen. Mit den alten Namen liefen sie seit der Umstellung auf getrennte Container nicht mehr.
- Keine Handgriffe auf der NAS nötig; das Update-Werkzeug bleibt bei 1.8.0.

## 8.12.0 – 2026-11-15

**MCP-Zugang als Dienst des Control Centers (rein lesend), Update-Werkzeug 1.8.0 kommt erstmals mit dem Release**

- Der MCP-Zugang gehört jetzt zum Control Center (Ordner mcp-app, Container bcc-mcp) und kommt künftig mit jedem Update. Der frühere eigene MCP-Ordner und der Neubau von Hand entfallen.
- Der MCP-Zugang ist rein lesend: Die früheren Update-Funktionen sind entfernt, der Container hat keine Schreib-Mounts mehr. Er meldet die Version des Control Centers.
- Dieses Release bringt das Update-Werkzeug 1.8.0 mit. Mit deiner Freigabe wird zuerst das Werkzeug gewechselt, im nächsten Lauf folgt die Installation (insgesamt etwa 10 Minuten).
- Der Arbeitsordner des Update-Werkzeugs zieht in den Projektordner (deploy/work); der Aufgabenplaner ruft danach nur noch die Startdatei auf.
- Einmalige Umstellung von Hand nötig (neue compose.yaml, zwei Geheimnis-Dateien, Arbeitsordner verschieben): Anleitung UMSTELLUNG-8.12.0.md. Bis dahin läuft alles wie bisher.

## 8.11.0 – 2026-11-14

**Update-Werkzeug kommt künftig mit den Releases (Startdatei und Selbstupdate, Werkzeug 1.7.0)**

- Das Update-Werkzeug auf dem Host kann künftig mit einem Release mitkommen. Es wird nur zusammen mit dem Release eingespielt, das du freigibst; der Hinweis nennt dann ausdrücklich das Werkzeug-Update.
- Eine kleine Startdatei schaltet nach bestandenem Selbsttest auf die neue Fassung um. Besteht sie ihn nicht oder bricht ihr erster Lauf ab, läuft die bisherige Fassung weiter.
- Updates-Seite und Systemstatus zeigen die Fassung des Update-Werkzeugs und einen fehlgeschlagenen Werkzeugwechsel; zusätzlich gibt es dafür eine Discord-Meldung (Ereignis „Update-Werkzeug zurückgesetzt“).
- Einmalige Einrichtung von Hand nötig: Startpaket in den Projektordner legen und den Befehl im Aufgabenplaner umstellen (Anleitung UPGRADE-1.7.0.md). Bis dahin arbeitet alles wie bisher.
- Der MCP-Server bleibt unverändert (1.6.0); ein Neubau ist nicht nötig.

## 8.10.0 – 2026-11-13

**Werkzeuge im Repository: MCP-Server und Deploy-Werkzeug (Paket 1.6.0), keine Änderung der Oberfläche**

- Der MCP-Server liegt jetzt zusammen mit dem Deploy-Werkzeug im Repository (Ordner tools) und wird bei jedem Release mitgeprüft. Er ist nicht Teil dieses Updates und wird weiter getrennt betrieben.
- MCP-Server 1.6.0 kennt die Dienstnamen des getrennten Betriebs (web, twitch, discord) für die Statusabfrage; ein Neubau des MCP-Containers von Hand ist nötig (Anleitung UPGRADE-1.6.0.md im Ordner tools/mcp).
- Neue Prüfungen verhindern, dass Zugangsdaten, Betriebsdaten oder Sicherungen des MCP-Ordners ins Repository gelangen.
- Control Center, Twitch-Bot und Discord-Bot verhalten sich unverändert; nur die Versionsnummer ändert sich.

## 8.9.23 – 2026-11-13

**Systemstatus: Dienste-Übersicht und Neustart einzelner Dienste**

- Systemstatus zeigt jetzt die Dienste auf einen Blick: Weboberfläche, Twitch-Bot, Discord-Bot und Datenbank – jeweils mit Zustand, Laufzeit und Speicherbedarf – sowie die Betriebsart (getrennt oder ein Container).
- Wartende Ereignisse des Twitch-Bots (z. B. Follows während eines Neustarts der Oberfläche) werden angezeigt.
- Im getrennten Betrieb lassen sich Weboberfläche, Twitch-Bot und Discord-Bot einzeln neu starten. Beim Neustart nur des Twitch-Bots bleibt die Oberfläche erreichbar.
- Die Texte nennen keine alten Containernamen mehr.

## 8.9.22 – 2026-11-13

**Vorbereitung: eigener Twitch-Bot-Container (Schritt 3b Teil 2, keine Änderung im laufenden Betrieb)**

- Der Twitch-Bot kann jetzt als eigener Dienst laufen (neuer Ordner twitch-app). Standard bleibt der bisherige Betrieb in einem Container; umgeschaltet wird erst später über die compose.yaml.
- Schutz vor doppeltem Bot: Ein eigener Twitch-Bot-Dienst startet nur, wenn die Weboberfläche den getrennten Betrieb bestätigt.
- Systemstatus zeigt Betriebsart und Erreichbarkeit des Twitch-Bots. Das Deploy-Werkzeug liegt jetzt im Repository und wird bei jedem Release mitgetestet.
- Nach dem Update bitte kurz prüfen: Systemstatus, Testnachricht, !team, !stubenhilfe.

## 8.9.21 – 2026-11-13

**Vorbereitung: eigener Twitch-Bot-Container (Schritt 3b Teil 1, keine Funktionsänderung)**

- Technisch: Was Weboberfläche und Twitch-Bot gemeinsam brauchen (Konfiguration, Speicher, Audit, Wortfilter, Twitch-App-Zugang), liegt jetzt in einem gemeinsamen Fundament. Die Datenfunktionen (Gewinnspiel, Watchtime, Nutzungsstatistik, Clips) und die Twitch-Laufzeit liegen ebenfalls im gemeinsamen Ordner.
- Damit kann der Twitch-Bot im nächsten Schritt als eigener Dienst starten. Weiterhin ein Container, Code unverändert verschoben.
- Nach dem Update bitte kurz prüfen: Systemstatus, Testnachricht, Seiten Gewinnspiel, Watchtime und Nutzungsstatistik laden.

## 8.9.20 – 2026-11-13

**Vorbereitung: eigener Twitch-Bot-Container (Schritt 3a, keine Funktionsänderung)**

- Technisch: Die Weboberfläche wartet jetzt bei jedem Zugriff auf den Twitch-Bot-Teil auf die Antwort und tauscht nur noch einfache Daten aus. Das ist Voraussetzung dafür, dass beide später in getrennten Containern laufen.
- Die Stammdaten der Twitch-Konten liegen in einem gemeinsamen Modul; der Abgleich gesperrter Begriffe gibt sein Ergebnis ausdrücklich zurück.
- Bedienung unverändert. Nach dem Update bitte kurz prüfen: Systemstatus, Seite „Verbindungen“, Testnachricht, eine Wortfilter-Änderung speichern.

## 8.9.19 – 2026-11-13

**Vorbereitung: interne Adressen und Dienstnamen einstellbar (Schritt 2, keine Funktionsänderung)**

- Technisch: Die Adresse, unter der der Discord-Bot die Weboberfläche erreicht, stand fest im Code und ist jetzt einstellbar (CONTROL_CENTER_URL). Ohne Einstellung gilt der bisherige Wert.
- Die Adresse des Discord-Dienstes (DISCORD_SERVICE_URL) wird jetzt streng geprüft; der Anzeigename des Discord-Dienstes ist einstellbar (DISCORD_SERVICE_LABEL).
- Für den laufenden Betrieb ändert sich nichts; es muss nichts eingestellt werden. Nach dem Update bitte kurz prüfen: Discord-Seiten laden, /admin in Discord antwortet.

## 8.9.18 – 2026-11-13

**Vorbereitung: Trennung von Weboberfläche und Twitch-Bot (Schritt 1d, keine Funktionsänderung)**

- Technisch: Der gesamte Twitch-Bot-Teil liegt jetzt in einer eigenen Datei (app/twitch-runtime.js); server.js enthält nur noch die Weboberfläche. Der Code wurde unverändert verschoben.
- Geprüft im Vergleich mit Version 8.9.14 gegen ein nachgestelltes Twitch: gleiche Chat-Antworten, gleiche Twitch-Aufrufe, gleiches Protokoll.
- Nach dem Update bitte kurz prüfen: Systemstatus (EventSub verbunden), Testnachricht, ein Chat-Befehl wie !team, Seite „Verbindungen“.

## 8.9.17 – 2026-11-13

**Vorbereitung: Trennung von Weboberfläche und Twitch-Bot (Schritt 1c, keine Funktionsänderung)**

- Technisch: Twitch-Zugangsdaten gehören jetzt allein dem Twitch-Bot-Teil. Die Weboberfläche erhält nur noch Status und Stammdaten der Konten, keine Token-Inhalte oder Dateipfade.
- Ein neu verbundenes Konto wird einmalig an den Bot-Teil übergeben; Prüfen und Erneuern der Zugangsdaten erfolgt nur noch dort.
- Bedienung unverändert. Nach dem Update bitte kurz prüfen: Seite „Verbindungen“ zeigt alle Konten wie zuvor, Testnachricht kommt an.

## 8.9.16 – 2026-11-13

**Vorbereitung: Trennung von Weboberfläche und Twitch-Bot (Schritt 1b, keine Funktionsänderung)**

- Technisch: Der Twitch-Bot meldet Follows und Chat-Befehle nur noch über eine feste Übergabestelle; Stubenkontrolle, Follower-Alert und Followathon gehören jetzt zur Weboberfläche.
- Bedienung und Verhalten unverändert (Reihenfolge bei einem Follow wie bisher: Follower-Alert, Followathon, Begrüßung).
- Nach dem Update bitte kurz prüfen: !stubenhilfe im Chat, Follower-Alert-Test und Followathon-Test in der Oberfläche.

## 8.9.15 – 2026-11-13

**Vorbereitung: Trennung von Weboberfläche und Twitch-Bot (Schritt 1a, keine Funktionsänderung)**

- Technisch: Die Weboberfläche greift nur noch über eine feste Schnittstelle auf die Twitch-Laufzeit zu (EventSub-Status, Chat-Versand, Tokens, Follower-Liste, Nachrichtenzähler, Clip-Prüfung, Wortfilter).
- Grundlage dafür, dass der Twitch-Bot später in einem eigenen Container laufen kann. Weiterhin ein Container, Bedienung und Verhalten unverändert.
- Nach dem Update bitte kurz prüfen: Systemstatus zeigt EventSub verbunden, Testnachricht kommt im Chat an.

## 8.9.14 – 2026-11-13

**Wartungsmodus: eigene Kanalliste und wählbare Rollen**

- Wartungsmodus: Du kannst jetzt wählen, welche Kanäle gesperrt werden – entweder die Kanäle der aktiven Zeitprofile (wie bisher) oder eine eigene Kanalliste. Ein aktives Kanalzeitprofil ist dafür nicht mehr nötig.
- Wartungsmodus: Wählbare Rollen (Mitglied und/oder Moderationsrolle). Standard bleibt nur Mitglied.
- Auswahl lässt sich nur ändern, solange der Wartungsmodus nicht aktiv ist. Das automatische Update über die Updates-Seite nutzt dieselbe Auswahl.
- Bestehende Einstellungen bleiben unverändert wirksam (Zeitprofile, nur Mitglied).

## 8.9.13 – 2026-11-13

**Releases werden automatisch auf GitHub erstellt (keine Funktionsänderung)**

- Technisch: Ein GitHub-Workflow baut und veröffentlicht künftig das Release (ZIP + Manifest), sobald ein Branch release/X.Y.Z gepusht wird. Du musst Releases nicht mehr von Hand anlegen und hochladen.
- Sicherheit unverändert: Das Release installiert sich nie von selbst. Freigabe mit Version und Prüfsumme bleibt Pflicht (Updates-Seite).
- Hinweis: Workflow und Bauskripte liegen unter .github/ und sind nicht Teil des ZIP. Die App selbst verhält sich wie in 8.9.12.

## 8.9.12 – 2026-11-13

**Updates: Prüfung vor dem Wartungsmodus, klare Fehlermeldungen, aufgeräumte Administration**

- Behoben: Konnte die Freigabe nicht gespeichert werden (Rechte auf der NAS), schaltete das Control Center den Wartungsmodus an und gleich wieder aus. Jetzt wird vorher geprüft, ob der Freigabeordner beschreibbar ist. Ist er es nicht, bleibt der Wartungsmodus aus und es erscheint eine klare Meldung.
- Behoben: Fehlermeldungen der Updates-Seite erschienen mit grünem Haken. Sie werden jetzt als Fehler (rot, länger sichtbar) angezeigt.
- Behoben: In der Administration rutschte die Gruppe „System“ in eine zweite Zeile, und der Titel hing unten links. Der Titel steht jetzt über den Reitern, alle Gruppen haben Platz in einer Zeile.
- Enthalten ist alles aus 8.9.11 (Freigabe auch ohne Wartungsmodus).

## 8.9.11 – 2026-11-13

**Updates: Freigabe auch ohne Wartungsmodus möglich**

- Neu: Auf der Updates-Seite gibt es neben „Freigeben und installieren“ den Knopf „Ohne Wartungsmodus freigeben“ (eigene Bestätigung). Der Discord-Wartungsmodus wird dann weder gestartet noch beendet. Gedacht für den Fall, dass er nicht aktivierbar ist, etwa weil kein Kanalprofil aktiv ist.
- Hinweis: Der Wartungsmodus sperrt weiterhin nur die Kanäle aktiver Kanalprofile (derzeit #talk) für die Rolle Mitglied. Eine eigene Kanalliste für den Wartungsmodus ist für eine spätere Version vorgemerkt.

## 8.9.10 – 2026-11-13

**Updates-Seite mit automatischem Wartungsmodus**

- Neu: Unter Administration → System gibt es die Seite „Updates“ (nur Owner). Dort siehst du neue Versionen, die die NAS bereitgestellt hat, mit Beschreibung, Größe, Dateizahl und Prüfsumme und gibst sie frei oder lehnst sie ab.
- Neu: Bei der Freigabe wechselt der Discord-Server automatisch in den Wartungsmodus und nach dem Update wieder zurück. Ist der Wartungsmodus nicht aktivierbar, wird das Update nicht freigegeben. War der Wartungsmodus schon vorher an, bleibt er unverändert.
- Neu: Schlägt die Installation fehl und der alte Stand wird wiederhergestellt, endet der Wartungsmodus ebenfalls und Discord meldet den Fehlschlag. Bei einem Fehler, der manuellen Eingriff braucht, bleibt der Wartungsmodus bewusst aktiv und die Seite zeigt eine Warnung.
- Neu: Discord-Logereignisse „Update verfügbar“, „Update gestartet“, „abgeschlossen“, „fehlgeschlagen“ und „braucht Eingriff“ (unter Logs & Benachrichtigungen einstellbar).
- Hinweis: Die Seite braucht eine einmalige Einbindung des Freigabe-Verzeichnisses der NAS in den Control-Center-Container (siehe UPDATE-8.9.10.md). Ohne sie zeigt die Seite einen Hinweis und alles andere läuft unverändert.

## 8.9.9 – 2026-11-12

**Probe-Release für das Pull-Deployment (keine Funktionsänderung)**

- Technisch: Dieses Release enthält keine Änderung an Funktionen oder Daten. Es dient dazu, den neuen Update-Weg über GitHub einmal vollständig zu erproben (Abholen, Prüfen, Freigabe, Installation).
- Hinweis: Nach der Installation zeigt das Control Center die Version 8.9.9 an. Alles andere verhält sich wie in 8.9.8.

## 8.9.8 – 2026-11-11

**Event-Profile: vollständig, mit Schalterliste und Prüfung nach dem Wechsel**

- Behoben: Beim Profilwechsel blieben Einstellungen vom vorherigen Profil übrig. Drei Ursachen: Neu angelegte Commands, Timer, Auto-Replies oder Begrüßungen fehlten in älteren Profilen und blieben beim Wechsel unverändert; Team-Timer, Team-Mitglieder, Stubenkontrolle, Clip-Sharing, Follower-Alert und Moderationsfilter waren gar nicht im Profil; Änderungen bei aktivem Profil wurden nicht ins Profil übernommen.
- Neu: Jedes Profil legt für jede Funktion einen festen Zustand fest (an/aus und, wo vorhanden, Bot). Zusätzlich enthalten: Team-Timer, Team-Mitglieder, Stubenkontrolle, Clip-Sharing, Follower-Alert, Link-, Emote-, Satzzeichen- und Großbuchstaben-Filter.
- Neu: Knopf „⚙ Einstellungen“ bei jedem Profil öffnet eine gruppierte, aufklappbare Liste aller Funktionen mit Ein/Aus, Bot-Auswahl sowie „Alle an“/„Alle aus“. Ein nicht aktives Profil lässt sich so bearbeiten, ohne es zu aktivieren; beim aktiven Profil gilt die Änderung sofort.
- Neu: Was gespeichert wird, während ein Profil aktiv ist, übernimmt dieses Profil automatisch. Neu angelegte Einträge sind in allen anderen Profilen aus. Gelöschte Einträge verschwinden aus allen Profilen.
- Neu: Nach jedem Wechsel prüft das Control Center jeden einzelnen Schalter gegen das Profil und meldet Abweichungen mit Namen.
- Umstellung: Vorhandene Profile werden beim ersten Start einmalig umgestellt. Bisherige Werte bleiben erhalten, neu hinzugekommene Bereiche übernehmen den aktuellen Stand, Einträge, die in einem nicht aktiven Profil fehlten, sind dort aus.

## 8.9.7 – 2026-11-11

**Bestätigungsdialoge: passende Titel und Knöpfe, Event-Profile verständlicher**

- Behoben: Beim Aktivieren eines Event-Profils erschien der Dialog „Löschen bestätigen“ mit rotem LÖSCHEN-Knopf. Der Lösch-Dialog wurde an 20 Stellen für Aktionen benutzt, die kein Löschen sind. Jetzt haben sie passende Titel und Knöpfe: Aktivieren, Profil aktualisieren, Aufheben (Discord-Verknüpfung), Ziehen (Gewinner), Beenden (Gewinnspiel, Followathon), Trennen (TikTok), Bannen, Veröffentlichen und Zurücknehmen (Öffentliche Seiten, Verifizierungsdatei), Zurücknehmen (Follow-Gutschriften, Wortfilter-Import), Zurücksetzen (Followathon, Watchtime, Punkte), Erstatten (Stubenkontrolle) und Neu erzeugen (Overlay-Schlüssel). Echte Löschungen zeigen unverändert den Lösch-Dialog.
- Verbessert: Event-Profile erklären jetzt verständlich, was „Aktivieren“ tut (gespeicherte Schalter und Bot-Zuordnungen übernehmen, kein neues Profil). Der Knopf heißt „+ Neues Profil“ statt „+ Profil“, hat Hinweistexte, und der Hilfetext nennt die richtigen Knopfnamen.
- Neu: Ein Test stellt sicher, dass der Lösch-Dialog nur noch bei Löschen oder Entfernen verwendet wird.

## 8.9.6 – 2026-11-11

**Stubenkontrolle: Beitritts-Meldungen einstellbar, Vorrang für Kontrolle und Ergebnis**

- Neu: Stubenkontrolle, Spieleinstellungen: „Beitritts-Meldungen im Chat“ als Auswahlmenü. Automatisch (Voreinstellung): die ersten 5 Anmeldungen einzeln, danach alle 10 Sekunden eine Sammelmeldung („+37 melden sich zur Kontrolle · jetzt 82 dabei“). Jeden einzeln (wie bisher). Nur jeden N-ten (N einstellbar, Standard 3). Aus. Die Eröffnung der Runde, das Ende der Anmeldung und das Ergebnis kommen immer. Das Overlay zeigt weiterhin alle Teilnehmenden.
- Neu: Eigener Spruch „Beitritt (Sammelmeldung)“ mit den Platzhaltern {added}, {count} und {factor}.
- Neu: Die Sende-Warteschlange kennt Vorrang-Stufen. Kontrolle, Ergebnis und Rundeneröffnung gehen vor, werden nie wegen Alter verworfen und bei Stau als Letzte geopfert. Beitritts-Meldungen haben niedrigen Vorrang, verfallen nach 15 Sekunden und werden bei Stau zuerst verworfen.
- Hintergrund: Bei 200 bis 250 Anmeldungen in einer Minute hätte der Bot für jede eine eigene Nachricht gesendet, Twitchs Sendelimit gesprengt und die Auswertung hinter den Begrüßungen warten lassen.

## 8.9.5 – 2026-11-11

**Systemstatus: Diagnose-Karte wieder erreichbar**

- Behoben: Die Karte „Nachrichtenverarbeitung & Persistenz“ im Systemstatus meldete „API-Route ist nicht in der Autorisierungsmatrix freigegeben“ und zeigte keine Werte. Die Route /api/admin/performance ist jetzt als reine Administrator-Route eingetragen (Owner und Administratoren, wie beim Systemstatus). Alle anderen API-Routen waren nicht betroffen.
- Neu: Ein Test prüft ab jetzt für alle API-Routen im Code, dass keine von der Standard-Sperre der Rechtematrix blockiert wird.
- Korrigiert: Die Hinweise zu 8.9.4 nennen jetzt den richtigen Ort der neuen Kacheln (Systemstatus statt „Performance-Seite“).

## 8.9.4 – 2026-11-11

**Chat: Link-Filter ohne Fehlalarme, Sende-Warteschlange pro Bot**

- Behoben: Der Linkfilter hielt Texte wie „toll.Und“, „1.Kompanie“, „3.Zug“ oder „z.B.das“ für Links und löschte die Nachricht. Ohne http/https/www zählt ein Text jetzt nur noch als Link, wenn er auf eine echte Domain-Endung (de, com, tv, gg, io …) endet. Endungen, die auch normale Wörter sind (in, es, is, it, to, me …), zählen nur mit Pfad, zum Beispiel „t.me/abc“. Eine Endung mit großem Anfangsbuchstaben („Und“, „Es“) gilt ohne Pfad als Satzanfang. Ausdrücklich eingegebene Links (http, https, www) werden wie bisher immer geprüft.
- Neu: Alle Bot-Antworten im Twitch-Chat laufen über eine Warteschlange pro Bot-Account. Sie hält Twitchs Sendelimits ein (Moderator-Bot (Haupt-Bot) bis 90 Nachrichten pro 30 Sekunden, die anderen Bots bis 17 pro 30 Sekunden, jeweils mit Mindestabstand) und wiederholt bei einem Rate-Limit von Twitch bis zu dreimal. Vorher wurde eine von Twitch abgelehnte Antwort nur im Log vermerkt und ging verloren.
- Neu: Antworten, die älter als 45 Sekunden sind oder bei voller Warteschlange (200 Einträge pro Bot) überzählig werden, werden verworfen und gezählt.
- Geändert: Wird eine Antwort von der Warteschlange verworfen, bekommt die Person den Cooldown für Command, Autoantwort, !followage und !watchtime sofort zurück.
- Neu: Der Systemstatus (Karte „Nachrichtenverarbeitung & Persistenz“) zeigt Antworten in der Warteschlange, die Wartezeit der ältesten, verworfene Antworten und von Twitch gemeldete Rate-Limits.

## 8.9.3 – 2026-11-11

**Stubenkontrolle: Punkte im Ergebnis, sortiert, im Overlay grün/rot**

- Neu: Im Ergebnistext (Chat und Overlay) stehen Gewinner mit ihrem reinen Gewinn „@Name (+250)“ und Erwischte mit ihrem Verlust „@Name (-500)“. Die Platzhalter {winners} und {caught} enthalten die Punkte automatisch; eigene Sprüche müssen nicht angepasst werden.
- Neu: Gewinner und Erwischte sind nach Punkten sortiert (größte Zahl zuerst).
- Geändert: Bei mehr als 8 Personen heißt es „und N weitere“ statt „+N“, damit es nicht wie Punkte aussieht.
- Neu: Im Overlay werden bei der Auflösung Gewinner samt Punkten grün und Erwischte samt Punkten rot dargestellt – im Ergebnistext und auf den Teilnehmerkarten, die ebenfalls nach Punkten sortiert sind. Der Twitch-Chat bleibt einfarbig.

## 8.9.2 – 2026-11-11

**Stubenkontrolle-Overlay dezenter, Leerzeichen vor !stube behoben**

- Geändert: Das Overlay ist deutlich kleiner und dezenter (Panel etwa 60 % breit und halb so hoch, kleinere Schrift). Design, Farben und Schrift bleiben gleich.
- Geändert: Mehr Platz für Teilnehmende: Name und Einsatz in einer Zeile, bis 24 Personen in 6 Spalten, darüber 8 Spalten mit 48 je Seite.
- Geändert: Die Kontrollfigur ist etwas kleiner und steht am rechten Ende des Panels; Männchen und Namensschilder sind kleiner; die Polygon-Linien liegen nur noch im Panel statt über dem ganzen Bild.
- Behoben: Die Textbereinigung der Stubenkontrolle entfernte das Leerzeichen vor jedem Ausrufezeichen („Mit!stube BETRAG“) – im Overlay und im Twitch-Chat, auch bei eigenen Sprüchen. Jetzt wird nur Leerraum vor Satzzeichen am Wortende entfernt.

## 8.9.1 – 2026-11-11

**Stubenkontrolle-Overlay: Kontrollfigur bei der Kontrolle, Ergebnis bleibt stehen, Verbindungsanzeige wählbar, Hausschrift**

- Neu: Während der Kontrolle erscheint der Kontrollfigur mit Klemmbrett und Lupe und schaut sich misstrauisch um (Schleife). Der Strichmännchen-Platzhalter entfällt.
- Geändert: Die Kontrollfigur im Ergebnis blendet nicht mehr nach 5–6 Sekunden aus, sondern bleibt stehen, bis die eingestellte Zeit „Ergebnis sichtbar (Sek.)“ abgelaufen ist.
- Neu: Einstellung „Overlay: Verbindungsanzeige“ – nur bei Problemen (Standard), immer oder nie. Gilt für alle Overlays einschließlich Moblin; mit &status=1 an der Adresse lässt sie sich zum Prüfen erzwingen.
- Geändert: Bei einer Trennung nennt die Anzeige, was zu prüfen ist (Schlüssel, WebSocket im Reverse-Proxy, Verbindungslimit).
- Geändert: Overlay-Texte in Akzidenz Grotesk Bold und rgb(250, 183, 10), wie beim Follower-Alert (Schrift muss auf dem Gerät installiert sein, sonst Arial).
- Geändert: Die Overlay-Tests im Control Center zeigen Kontrolle und Ergebnis so lange wie eingestellt (vorher fest 20 Sekunden).

## 8.9.0 – 2026-11-10

**Stubenkontrolle: animiertes Overlay als Adresse für OBS, Mac und Moblin**

- Neu: Das Stubenkontrolle-Overlay wird vom Control Center ausgeliefert: /stubenkontrolle/overlay#key=SCHLÜSSEL. Die Adresse funktioniert in jeder Browserquelle (OBS am PC oder Mac, Moblin am Handy); die lokale HTML-Datei muss nicht mehr kopiert oder angepasst werden.
- Neu: Bei der Anmeldung läuft jede angemeldete Person als kleines Männchen mit Namensschild am unteren Bildrand hin und her (6 Uniformfarben; ab 25 Personen kleiner und in zwei Bahnen, höchstens 60 sichtbar).
- Neu: Ergebnis-Animation mit der Kontrollfigur samt gelber Schnur: Daumen hoch, sobald mindestens eine Person besteht; wütend, rot und brüllend, wenn alle erwischt werden (WebM mit Alphakanal).
- Neu: Safari/WebKit (iPhone, iPad, Moblin) spielt WebM mit Alphakanal nicht transparent ab; dort zeichnet das Overlay die Kontrollfigur live als SVG. Erzwingen mit &render=svg oder &render=video.
- Neu: Viele Teilnehmende: ab 25 Personen kompakte Liste, die bei mehr als 48 Personen alle 5 Sekunden weiterblättert („Seite x/y“).
- Neu: Overlay-Test „Ergebnis: alle erwischt“. Die Test-Szenarien sind jetzt auf bekannte Werte begrenzt.
- Neu: Nach „Neuen Schlüssel erzeugen“ zeigt das Control Center die fertige Overlay-Adresse zum Kopieren (abgeleitet aus der öffentlichen WSS-Adresse).
- Sicherheit: Die Overlay-Seite bekommt eine eigene strenge Content-Security-Policy (keine Inline-Skripte, nur eigene Videos und der eigene WebSocket). Der Schlüssel steht im URL-Fragment und erreicht den Server nur beim WebSocket-Aufbau; er bleibt ein reiner Lese-Schlüssel.

## 8.8.1 – 2026-11-10

**Discord-Konfigurationsprüfung: Recht ausdrücklich geprüft und gedrosselt (Befund B1 aus dem Code- und Verhaltenstest)**

- Behoben: POST /api/discord/verify („Jetzt prüfen“ in der Discord-Übersicht) verlangte im Handler nur irgendein Discord-Recht. Jetzt wird das Recht „Discord · Übersicht ansehen“ ausdrücklich geprüft, wie es die Rechte-Matrix schon vorgab.
- Neu: Die Prüfung löst mehrere Discord-API-Abrufe aus und ist deshalb auf eine Ausführung alle 15 Sekunden begrenzt (für alle Benutzer gemeinsam). Eine zu frühe Anfrage bekommt 429 mit Retry-After; das Portal zeigt die Meldung als Hinweis.
- Der Test sämtlicher schreibenden Routen mit einem Benutzer, der nur Ansichtsrechte hat, fand keine weitere Route mit zu schwacher Prüfung.
- Vier neue Tests; Gegenprobe mit dem alten Handler schlägt fehl.

## 8.8.0 – 2026-11-10

**Container-Härtung abgeschlossen: Secrets nur noch als Dateien (Audit-Befund N-6, Teil 4)**

- Die Vorlage-compose.yaml enthält keine Klartext-Secrets und keine Platzhalter mehr: TWITCH_CLIENT_SECRET, LOCAL_ADMIN_PASSWORD, INTERNAL_SERVICE_SECRET, DISCORD_CLIENT_SECRET und DISCORD_BOT_TOKEN werden über *_FILE aus Dateien unter secrets/ gelesen (Docker-Secrets).
- Auf dem Produktivsystem ist das seit 8.7.3 umgesetzt und per Log geprüft (alle Quellen „datei“); 8.8.0 bringt die Vorlage und die Anleitung im Paket auf denselben Stand.
- secrets/README.txt beschreibt Anlegen, Rechte (1000:1000, Modus 400), Sicherung und Rotation der Secret-Dateien.
- Fünf neue Tests prüfen die Vorlage: keine Klartextwerte, jede *_FILE-Variable zeigt auf ein deklariertes Secret, gemeinsames INTERNAL_SERVICE_SECRET, nur vom Code unterstützte Namen.
- Kein Anwendungscode geändert, keine Datenbankmigration. Schema bleibt 17.

## 8.7.3 – 2026-11-10

**Secrets aus Dateien statt Klartext in der compose.yaml (Audit-Befund N-6, Teil 3: Codeunterstützung)**

- Neu: Control Center und Discord-Dienst lesen Secrets bevorzugt aus Dateien. Ist NAME_FILE gesetzt (z. B. TWITCH_CLIENT_SECRET_FILE=/run/secrets/twitch_client_secret), wird der Dateiinhalt verwendet; ohne NAME_FILE gilt wie bisher die Umgebungsvariable.
- Unterstützt: TWITCH_CLIENT_SECRET, LOCAL_ADMIN_PASSWORD, INTERNAL_SERVICE_SECRET, DISCORD_BOT_TOKEN, DISCORD_CLIENT_SECRET sowie die optionalen INSTAGRAM_ACCESS_TOKEN, TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN, TIKTOK_CLIENT_SECRET.
- Eine nicht lesbare, leere oder zu große Datei wird im Log gemeldet (ohne Wert); eine vorhandene Umgebungsvariable bleibt dann in Kraft.
- Beim Start steht im Log, aus welcher Quelle jedes Secret kommt („Secret-Quellen“), und die Diagnose enthält dieselbe Übersicht ohne Werte.
- Ohne Änderung der compose.yaml verhält sich alles wie bisher. Zehn neue Tests.

## 8.7.2 – 2026-11-10

**Lokaler Login am Direktport wieder verfügbar, auch mit eingetragenem vertrauten Proxy**

- Behoben: Mit TRUSTED_PROXY_CIDRS=172.21.0.1 (Docker-Gateway) wurde der lokale Login bei Zugriff auf 192.168.1.10:3000 nicht mehr angezeigt, weil Docker-NAT auch direkte LAN-Zugriffe als 172.21.0.1 durchreicht.
- Eine Anfrage vom vertrauten Proxy ohne jeden Weiterleitungs-Header (X-Forwarded-For, X-Real-IP, Forwarded usw.) und mit lokalem Host (192.168.1.x oder localhost) gilt jetzt als direkter LAN-Zugriff. Der Reverse-Proxy setzt immer Weiterleitungs-Header; Anfragen über die Domain bleiben daher unverändert (Client-IP aus X-Forwarded-For).
- Der lokale Login erfordert weiterhin das lokale Passwort; LOCAL_ADMIN_HOST_FALLBACK=false schaltet die Host-Erkennung weiterhin ab.
- Acht neue Tests (Direktzugriff, Proxy extern/LAN, gefälschter Host mit Headern, ohne Proxy-Eintrag); ein M-2-Test an die neue Regel angepasst.

## 8.7.1 – 2026-11-10

**Container-Härtung: schreibgeschütztes Root-Dateisystem (Audit-Befund N-6, Teil 2)**

- Die Vorlage-compose.yaml startet twitchbot und discordbot mit read_only: true; beschreibbar bleiben nur /data (eigener Mount) und /tmp (RAM-Disk, 16 MB, ohne Ausführungsrechte). Auf dem Produktivsystem ist das bereits umgesetzt und geprüft.
- Korrektur zu 8.7.0: Auf der Synology DS920+ unterstützt der Kernel kein PID-Limit; pids_limit: 256 wird dort nicht durchgesetzt. Die Vorlage nennt das jetzt ausdrücklich.
- Kein Anwendungscode geändert, keine Datenbankmigration.

## 8.7.0 – 2026-11-10

**Container-Härtung: Non-Root und PID-Limit (Audit-Befund N-6, Teil 1)**

- Die Vorlage-compose.yaml startet twitchbot und discordbot als Benutzer 1000:1000 (node) und begrenzt jeden Container auf 256 Prozesse. Auf dem Produktivsystem ist das bereits umgesetzt.
- Voraussetzung: data/ und discord-data/ gehören UID/GID 1000 (sudo chown -R 1000:1000 data discord-data); bei cap_drop ALL kann root fremde Dateien nicht überschreiben.
- Die Vorlage nennt jetzt das Image node-pg:7.2.0 wie im Produktivsystem und trägt den Docker-Gateway 172.21.0.1 als Beispiel für TRUSTED_PROXY_CIDRS ein.
- Kein Anwendungscode geändert, keine Datenbankmigration.

## 8.6.11 – 2026-11-10

**Command-Seite: Speichern-Prüfung mit PostgreSQL**

- Neu angelegte Commands lösen beim Speichern keine Fehlermeldung mehr aus: PostgreSQL gibt die Felder eines Objekts in anderer Reihenfolge zurück, der Vergleich nach dem Speichern sortiert die Feldnamen jetzt vor dem Vergleichen.
- Dadurch entfällt auch die Rückfrage „Seite verlassen“ nach dem Anlegen eines Commands, weil die Änderung nicht mehr als ungespeichert gilt.
- Keine Änderung an Server, Datenbank oder compose.yaml.

## 8.6.10 – 2026-11-10

**Command-Seite: Löschen und Speichern-Prüfung korrigiert**

- Neue Commands lassen sich speichern, ohne dass die Meldung „Server hat die Command-Änderungen nicht vollständig übernommen“ erscheint: Der Vergleich nach dem Speichern ignoriert die vom Server ans Ende gestellten Team-Commands und deren Reihenfolge.
- Der Löschen-Knopf der Command-Zeilen wirkt auch dann, wenn die Seite beim Öffnen den identischen Serverstand im Hintergrund nachlädt; bei unverändertem Serverstand bleiben die Objekte der Zeilen erhalten.
- Keine Änderung an Server, Datenbank oder compose.yaml.

## 8.6.9 – 2026-11-10

**Sicherheitshärtung: Content-Security-Policy (Stufe 2)**

- Die Hauptoberfläche läuft jetzt unter einer erzwungenen Content-Security-Policy ohne Inline-Skripte und ohne Inline-Handler (script-src 'self', script-src-attr 'none', connect-src 'self').
- Die sieben letzten Inline-Klick-Handler (Command, Timer, Begrüßung, Wort/Phrase, Auto-Reply hinzufügen sowie Speichern und Test-Nachricht) laufen über eine zentrale Klick-Zuordnung.
- Die Rückmeldeseiten nach Twitch-/Discord-Anmeldung und bei abgelehntem Zugang nutzen eigene Skriptdateien statt Inline-Skripten.
- Verstöße gegen die Policy werden blockiert und weiterhin einmal je Art im Log gemeldet; der Testmodus (Report-Only) entfällt.
- Keine Datenbankmigration und keine Änderung der compose.yaml erforderlich.

## 8.6.8 – 2026-11-10

**Sicherheitshärtung: Content-Security-Policy (Stufe 1)**

- Die Overlay-Seiten von Followathon und Follower-Alert laufen jetzt ohne Inline-Skripte unter einer strengen Content-Security-Policy; ihre Skripte liegen in eigenen Dateien.
- Die Hauptoberfläche bleibt unverändert nutzbar. Zusätzlich läuft eine strenge Policy im Meldemodus (Report-Only); Verstöße werden gesammelt und einmal je Art im Log gemeldet.
- Neuer Meldeendpunkt /csp-report (klein, ratenbegrenzt, nur aggregierte Auswertung, erscheint in der Systemdiagnose).
- Keine Datenbankmigration und keine Änderung der compose.yaml erforderlich.

## 8.6.7 – 2026-11-10

**Sicherheitshärtung: Regex, Sitzungen, Verbindungen, Berechtigungen**

- Wortfilter-Regex: Muster mit wiederholten Gruppen, Alternativen darin oder zu vielen unbegrenzten Quantifizierern werden abgelehnt; Treffer-Prüfungen laufen zusätzlich mit hartem Zeitlimit.
- Sitzungen werden nur noch als SHA-256-Hash gespeichert; bestehende Anmeldungen bleiben beim Update erhalten, abgelaufene Sitzungen werden stündlich entfernt.
- Fehler behoben: Im Dateimodus rief sich das Schreiben der Sitzungen endlos selbst auf.
- Overlay-Verbindungen (Followathon, Follower-Alert) sind auf 20 gesamt und 4 je IP begrenzt.
- Benutzerverwaltung: Administratoren können Administratoren und Owner nicht mehr ändern, deaktivieren, löschen oder neu zuweisen und vergeben die Rollen Administrator und Owner nicht mehr.
- Weniger Statusdaten für Nutzer ohne Administratorstufe: keine Session-IP, Rollenliste, Fehlertexte oder Subscription-Details.
- Keine Datenbankmigration und keine Änderung der compose.yaml erforderlich.

## 8.6.6 – 2026-11-10

**Zugangshärtung: lokale Admin-Erkennung und Proxy-Header**

- Der Host-Header gilt nicht mehr als Herkunftsnachweis: Kommen Proxy-Header von einer nicht vertrauten Adresse, wird die Anfrage nie als lokal behandelt.
- Direkter LAN-Zugriff über das Docker-Gateway bleibt möglich; der Host-Fallback greift nur noch ohne Proxy-Header und lässt sich mit LOCAL_ADMIN_HOST_FALLBACK=false abschalten.
- X-Forwarded-For wird bei vertrauten Proxys von rechts ausgewertet; der fälschbare linke Eintrag wird nicht mehr verwendet.
- Systemstatus zeigt, von welcher Adresse Proxy-Header ohne Vertrauen eingehen, damit TRUSTED_PROXY_CIDRS gezielt gesetzt werden kann.
- Keine Datenbankmigration und keine Änderung der compose.yaml erforderlich.

## 8.6.5 – 2026-11-10

**Neues statisches Follower-Alert-Banner und einstellbare Dauer**

- Überarbeitetes Banner mit klarem weißen Kreuz links, gelber Trennlinie und festem Schriftzug in RGB 250/183/10.
- Der Echtzeit-Nickname wird separat weich eingeblendet; Banner, Überschrift und Linien bleiben völlig unbewegt.
- Anzeigedauer des Follower-Alerts zwischen 5 und 20 Sekunden konfigurierbar (Standard: 7 Sekunden, persistent).
- OBS-Browserquelle, EventSub-Anbindung und Ein-/Ausschalter bleiben unverändert.

## 8.6.4 – 2026-11-09

**Eigener Twitch-Follower-Alert als OBS-Overlay**

- Neue Twitch-Live-Zentrale → Follower-Alert mit persistentem Ein-/Ausschalter, OBS-URL und Test-Follow.
- Transparente, statische Browserquelle im bisherigen Stil: Schrift und Linien bleiben unbewegt, nur der Nickname wird weich eingeblendet.
- Bestehende Twitch-EventSub-Follows speisen das Overlay unabhängig von Followathon und Chat-Begrüßung.

## 8.6.3 – 2026-10-26

**Discord /add: Kategorieauswahl und Logmeldung**

- Kategorie-Vorschläge für /add kommen dynamisch aus dem zentralen Wortfilter.
- Erfolgreich hinzugefügte Begriffe werden kurz im konfigurierten Discord-Logkanal protokolliert.

## 8.6.2 – 2026-10-23

**Persistenter Discord-Wartungsmodus**

- Wartungsmodus in Discord → Kanalzeiten mit frei editierbarem Sperr- und Entsperrtext.
- Mitglied-Schreibrechte aktiver Zeitprofil-Kanäle bleiben über NAS- und Bot-Neustarts hinweg gesperrt.
- Gesicherte Kanalrechte werden beim manuellen Beenden wiederhergestellt; die reguläre Zeitsteuerung wird danach abgeglichen.

## 8.6.1 – 2026-10-23

**Discord-Wortfilter direkt ergänzen**

- Administratoren und Moderatoren können neue Begriffe mit /add in den zentralen Wortfilter eintragen.
- /add ohne Wort öffnet ein privates Discord-Eingabeformular; Kategorie, Schweregrad und Plattform werden geprüft.
- Neue Discord-Einträge aktivieren Leetspeak standardmäßig; doppelte Einträge werden nicht blind überschrieben.
- Legacy-Regeln bleiben als getrennt dokumentierter Bestand erhalten, bis ihre Maßnahmen und Ausnahmen verlustfrei migriert werden können.

## 8.6.0 – 2026-10-20

**Discord-Command für Control-Center-Zugang**

- Der Discord-Befehl /admin prüft eine vorhandene Control-Center-Freigabe und antwortet ausschließlich privat.
- Die Zugangsauskunft nutzt eine geschützte interne Dienstverbindung; Anmeldung und Berechtigungen bleiben unverändert.
- In der Discord-Mitgliederverwaltung heißen die Aktionen jetzt Control Center erlauben und Control Center entziehen.

## 8.5.7 – 2026-10-20

**Asynchrone PostgreSQL-Leseabfragen**

- Die Top-Chatters-Rangliste liest die Daten jetzt ohne blockierendes Warten im HTTP-Event-Loop.
- Eine ergänzende asynchrone PostgreSQL-Schnittstelle bleibt zur bisherigen synchronen API kompatibel.
- Zustandsabhängige Discord-XP-Schreibvorgänge bleiben unverändert und weiterhin bestätigt.

## 8.5.6 – 2026-10-20

**XP-Nachrichtenpfad ohne vollständige Zustandkopie**

- Chat-XP und XP-Rückbuchungen sichern nur die betroffenen Einträge für die Fehler-Rücknahme.
- Die bestätigte Speicherung, Cooldowns und Moderationsreihenfolge bleiben unverändert.
- Zusätzliche Tests prüfen Fehler-Rollback und große XP-Historien.

## 8.5.5 – 2026-10-20

**Discord-Rückstau und XP-Speicherlatenz messbar**

- Discord-Diagnose zählt ausstehende und maximal gleichzeitig ausstehende Nachrichtenverarbeitungen.
- XP-Vergabe und Rückbuchungen erhalten instrumentierte Latenz- und Fehlerzähler, ohne fachliche Regeln oder Reihenfolge zu ändern.
- Zusätzliche Regressionstests für Lastfälle und die Erhaltung der Moderationsreihenfolge.

## 8.5.4 – 2026-10-19

- Discord-Diagnose um Nachrichtenrate, Verarbeitungslatenz und Fehlerzähler erweitert.

## 8.5.3 – 2026-10-19

**Persistente Twitch-Zählerwarteschlange und Performance-Diagnose**

- Twitch-Nachrichtenzähler sichern abgeschlossene Batches vor der Datenbankspeicherung atomar auf dem bestehenden Datenvolume und spielen offene Batches nach Neustarts idempotent erneut ein.
- Mehrere fehlgeschlagene Batches bleiben in Reihenfolge erhalten; eine Kapazitätsgrenze und Fehlerprotokolle begrenzen beziehungsweise melden Rückstau.
- Der administrative Systemstatus enthält aggregierte Kennzahlen zur Twitch-Nachrichtenverarbeitung und Persistierung. Nicht erhobene Discord-Werte werden als nicht verfügbar ausgewiesen.
- Regressionstests für Wiederholungsversuche, Neustart-Recovery, doppelbestätigte Datenbanktransaktionen und synthetische Last ergänzt.

## 8.5.2 – 2026-10-19

**Einheitlicher Dark-Mode-Bestätigungsdialog für Discord-Invites**

- Die manuelle Discord-Invite-Erstellung verwendet den vorhandenen Control-Center-Bestätigungsdialog anstelle des systemabhängigen Browserdialogs.
- Die zwingende ausdrückliche Bestätigung und alle übrigen Invite-Sicherheitsregeln bleiben erhalten.

## 8.5.1 – 2026-10-19

**Zentrale Discord-Einladungsverwaltung für Twitch**

- Persistente Invite-Verwaltung mit Prüfung alle sechs Stunden und kontrollierter Wiederverwendung.
- Neue Discord-Konfiguration für Freigabe, Kanal, Status und manuelle Aktionen.
- Dynamischer {discord_invite}-Platzhalter und sichere !dc-Antwort ohne Link bei deaktivierter Freigabe oder Fehlern.

## 8.5.0 – 2026-10-19

**Twitch Top-Chatters und 30-Tage-Nachrichten**

- Tägliche aggregierte Twitch-Nachrichtenzähler werden zusammen mit den Gesamtwerten transaktionssicher gespeichert.
- Neue Community-Seite Top-Chatters mit 30-Tage- und Gesamt-Rangliste inklusive Nicht-Followern.
- Die bisherige Followage-Zählung bleibt erhalten; historische Tageswerte beginnen mit dieser Version.

## 8.4.4 – 2026-10-19

**Persönliche Einsatzstatistik als Discord-Befehl**

- Neuer Befehl /einsatz statistik zeigt die Anzahl abgeschlossener, erfolgreicher und fehlgeschlagener Einsätze sowie die Erfolgsquote.
- Die Statistik berücksichtigt nur die eigenen bereits abgeholten Einsätze, antwortet privat und benötigt keine zusätzlichen Datenbankfelder.

## 8.4.3 – 2026-10-19

**Einsatzakte und erweiterte Minigame-Auswertung**

- Mitgliederprofil zeigt die letzten zehn abgeschlossenen Einsätze mit Ergebnis und XP sowie den aktuellen Einsatzstatus.
- Statistiken zeigen Erfolgsquote, gescheiterte Einsätze, aktive und abholbereite Einsätze sowie die Missionsverteilung.
- Die erfolgreichsten Einsatzteilnehmer werden für den gewählten Zeitraum ausgewertet.
- Der Slash-Befehl /einsatz status zeigt das Ende zusätzlich relativ und macht die Abholung deutlicher.

## 8.4.2 – 2026-10-19

**Daily-XP und Einsatzbelohnungen im Mitgliederprofil eindeutig benannt**

- XP-Buchungen aus /dailyxp werden als Tägliche Dienstmeldung statt als allgemeine XP-Änderung angezeigt.
- XP-Buchungen aus /einsatz werden als Einsatzbelohnung kenntlich gemacht.
- Die Ranghistorie nutzt die gleichen eindeutigen Quellenbezeichnungen.
- Keine Änderung an XP-Berechnung, gespeicherten Daten oder Berechtigungen.

## 8.4.1 – 2026-10-19

**Discord-Rate-Limit bei Minigame-Einstellungen behoben**

- Speichern der Minigame-Einstellungen registriert Slash-Befehle nicht mehr bei jedem Vorgang neu.
- Slash-Befehle werden nur erstellt oder aktualisiert, wenn die Definition tatsächlich abweicht.
- Discord-API-Rate-Limits werden mit begrenzten, serverseitigen Warteversuchen berücksichtigt.
- Erneute Slash-Command-Synchronisierung nach Aktivierung läuft unabhängig vom Speichervorgang.

## 8.4.0 – 2026-10-19

**Minigame: Dienstmeldung, Einsätze und Community-Statistik**

- Tägliche Dienstmeldung /dailyxp mit einmaliger zufälliger konfigurierbarer XP-Gutschrift je deutschem Kalendertag.
- Einsätze und Übungen über /einsatz starten, status und abholen; serverseitig gesicherte Ergebnisse und Belohnungen.
- Missionstexte, Dauer, Erfolgschance, XP-Bereiche und Tagesgrenzen im Control Center konfigurierbar.
- Minigame-Statistiken über XP-Quellen, Rangverteilung, Beförderungen, Dienstmeldungen und Einsätze.
- Daily- und Einsatz-XP erscheinen im XP-Verlauf und führen bei Rangaufstieg zu Rollensynchronisation und Beförderungsmeldung.
- Sechs neue Tests für Limits, Datumsgrenze, Persistenz und Fehlerfälle.

## 8.3.1 – 2026-10-19

**Speicherfehler sicher behandeln**

- XP-Buchungen, Rückbuchungen und Cooldowns bei fehlgeschlagenem Speichern zurückrollen.
- Konfigurationsänderungen bei Schreibfehlern nicht übernehmen.
- Gezielte Ausfalltests für Levelsystem-Persistenz ergänzt.

## 8.3.0 – 2026-10-19

**Stabilitätsrunde für Minigame, Mitglieder und Control Center**

- Bestehende Minigame-, Mitglieder-, Berechtigungs- und Navigationstests gemeinsam geprüft.
- XP-Cooldown funktioniert nun auch bei Zeitstempel 0 korrekt.
- Backup-Wiederherstellung der XP-Konfiguration und Ranghistorie wird vor dem Speichern validiert.
- Fehlgeschlagene Speicherung beim Levelsystem-Restore stellt den vorherigen Laufzeitstand wieder her.
- Secrets bleiben beim Update ausdrücklich unverändert und sind nicht Bestandteil des Release-Archivs.

## 8.2.13 – 2026-10-19

**Ranghistorie und Diagnose manueller Beförderungen**

- Rangwechsel durch Chat, Memes, manuelle XP-Korrekturen und Nachrichtenlöschungen werden mit Zeitpunkt und Quelle protokolliert.
- Im Mitgliederprofil werden die zehn jüngsten Rangwechsel angezeigt.
- Manuelle XP-Änderungen liefern den Status einer möglichen Beförderungsmeldung inklusive Fehlergrund zurück.
- Die bestehende Einstellung für manuelle Beförderungsmeldungen bleibt standardmäßig deaktiviert.

## 8.2.12 – 2026-10-19

**Manuelle Beförderungen optional veröffentlichen**

- In den Minigame-XP-Regeln lässt sich die Ankündigung von Rangaufstiegen durch manuelle XP-Gutschriften aktivieren.
- Die Einstellung ist standardmäßig deaktiviert; bestehende Installationen behalten dieses Verhalten.
- Nur tatsächliche Beförderungen werden veröffentlicht. Herabstufungen und unveränderte Ränge erzeugen keine Meldung.

## 8.2.11 – 2026-10-19

**XP-Buchungen im Mitgliederprofil**

- Im Minigame-Reiter erscheinen die letzten zehn XP-Buchungen mit Zeitpunkt, Herkunft und Punkteänderung.
- Chat-, Meme- und Löschungsbuchungen werden aus dem vorhandenen Nachrichten-XP-Protokoll gelesen.
- Manuelle XP-Korrekturen werden künftig mit altem und neuem Punktestand protokolliert.

## 8.2.10 – 2026-10-19

**Mitgliederprofil übersichtlicher gestaltet**

- Das Mitgliederprofil hat einen kompakten Kopfbereich mit Avatar, Anzeigename und Control-Center-Status.
- Profilbereiche sind als klar hervorgehobene und mobil horizontal scrollbare Tabs dargestellt.
- Nach Rollen- und Backendzugriffsänderungen wird der gemeinsame Aktualisierungspfad des Profils verwendet.

## 8.2.9 – 2026-10-19

**Mitgliederprofil gezielt aktualisieren**

- Mitgliederprofile können direkt im Dialog aktualisiert werden, ohne sie zu schließen.
- Mitgliederdaten und XP werden weiterhin über die vorhandenen gemeinsamen Endpunkte geladen.
- Nach XP-Änderungen wird der Minigame-Reiter mit aktuellen Daten erneut geöffnet.

## 8.2.8 – 2026-10-19

**Administration übersichtlich gegliedert**

- Die Administration ist in Benutzer & Sicherheit, Integrationen und System gegliedert.
- Alle bisherigen Administrationsseiten, Seiten-IDs und Berechtigungen bleiben erhalten.
- Favoriten, globale Suche und Twitch-/Discord-Wechsel funktionieren weiterhin mit den vorhandenen Funktionszielen.
- Die Unterbereiche sind auch in der mobilen Ansicht kompakt zugänglich.

## 8.2.7 – 2026-10-19

**Navigation nach Arbeitsbereichen gegliedert**

- Twitch Live-Funktionen sind in der Live-Zentrale zusammengefasst, einschließlich Gewinnspiel.
- Discord Mitglieder und Kommunikation erhalten eigene Hauptbereiche. Freischaltung liegt bei Server, Meldungen bei Moderation & Sicherheit.
- Alle vorhandenen Seiten-IDs und Berechtigungszuordnungen bleiben erhalten. Favoriten und globale Suche übernehmen die neuen Bereiche.
- Administration und Hilfe stehen am Ende der Seitenleiste; bestehende Einstellungen bleiben erhalten.

## 8.2.6 – 2026-10-19

**Globale Suche für Funktionen und Discord-Mitglieder**

- Globale Suche über die obere Leiste sowie Strg+K oder Cmd+K geöffnet.
- Funktionen werden lokal durchsucht und anhand der bestehenden Berechtigungen gefiltert.
- Discord-Mitglieder werden nach Eingabe mit kurzer Verzögerung über die vorhandene API gesucht und können direkt im Mitgliederprofil geöffnet werden.
- Favoriten und bisherige Navigation bleiben unverändert.

## 8.2.5 – 2026-10-19

**Persönliche Navigationsfavoriten**

- Berechtigte Seiten können über das Sternsymbol als persönliche Favoriten gespeichert werden.
- Favoriten sind plattformübergreifend über die Navigation erreichbar und können mit Pfeiltasten umsortiert werden.
- Die Auswahl wird benutzerbezogen in der vorhandenen Speicherung abgelegt; nicht mehr berechtigte Ziele werden ausgeblendet.
- Die vollständige Navigationsreform und globale Suche folgen in späteren Versionen.

## 8.2.4 – 2026-10-19

**Mitgliederprofile aus dem Minigame öffnen**

- Minigame-Spieler können direkt in das gemeinsame Discord-Mitgliederprofil geöffnet werden.
- Die vorhandenen Berechtigungen für die Mitgliederansicht werden berücksichtigt; XP-, Rollen- und Moderationsaktionen bleiben in den bestehenden gemeinsamen Diensten.
- Die Minigame-Oberfläche bleibt parallel erhalten; die Anzeige der aktuellen Version wurde berichtigt.

## 8.2.3 – 2026-10-19

**Minigame-Topliste zur vollen Stunde geprüft**

- Die Topliste wird jetzt zur vollen Stunde geprüft statt 60 Minuten nach Botstart.
- Die vorhandene Nachricht wird nur bei Ranglistenänderungen bearbeitet; gelöschte Toplisten werden wiederhergestellt.
- Beim Neustart wird die Topliste zusätzlich geprüft, sodass verpasste Änderungen nachgeholt werden.
- Die Dialogkorrektur aus Version 8.2.2 bleibt enthalten.

## 8.2.2 – 2026-10-19

**Bestätigungsdialog im Mitgliederprofil korrigiert**

- Bestätigungen für Moderationsaktionen erscheinen jetzt über dem geöffneten Mitgliederprofil statt dahinter.
- Escape schließt zunächst die Bestätigung ohne das Mitgliederprofil zu verlassen.
- Der Bestätigen-Button wird beim Öffnen fokussiert; bestehende Berechtigungs- und Timeout-Funktionen bleiben unverändert.

## 8.2.1 – 2026-10-19

**Mitgliederprofil: Timeout aufheben**

- Aktive Discord-Timeouts können direkt im Moderations-Tab des Mitgliederprofils aufgehoben werden.
- Moderationsstatus, Eskalationsstufe und Ereignisverlauf sind übersichtlich getrennt dargestellt.
- Timeout-Aufhebung und Eskalationsrücksetzung bleiben getrennte Aktionen und verwenden die bestehenden Berechtigungsprüfungen.

## 8.2.0 – 2026-10-19

**Mitgliederprofile und Moderationsaktionen vereinheitlicht**

- Die Freigabe der Versionsreihe 8.2 wurde übernommen.
- Im Mitgliederprofil steht für berechtigte Nutzer die Aktion zum Zurücksetzen der Eskalation zur Verfügung.
- Mitgliederprofil und Sanktionsübersicht nutzen denselben geprüften Frontend-Aufruf für diese Aktion.
- Vorhandene Moderations-Endpunkte, Auditierung und serverseitige Berechtigungsprüfungen bleiben erhalten.

## 8.1.15 – 2026-10-19

**XP-Aktionen der Mitgliederverwaltung zusammengeführt**

- Die XP-Verwaltung im Mitgliederprofil und unter Minigame → Spieler verwendet jetzt denselben Frontend-Aktionspfad.
- Discord-ID, XP-Aktion und eingegebene XP-Anzahl werden an einer gemeinsamen Stelle geprüft.
- Die bestehende serverseitige Berechtigungsprüfung und die XP-Engine bleiben unverändert.

## 8.1.14 – 2026-10-19

**Mitgliederstatus und Moderationshistorie verbessert**

- Control-Center-Status in den Mitgliederkarten auf eine kompakte grüne oder rote Kennzeichnung vereinheitlicht.
- Mitgliederprofile laden die Moderationsereignisse gezielt über die Discord-ID statt die gesamte Moderationsübersicht abzufragen.
- Der Profilverlauf zeigt einzelne Ereignisse mit Datum; langsame Anfragen werden zeitlich begrenzt und beim Tabwechsel nicht mehr versehentlich angezeigt.

## 8.1.13 – 2026-10-19

**Mitgliederprofile als Dialog und Zugriff klarer dargestellt**

- Control-Center-Zugriff erscheint als grüner oder roter Status direkt unter Mitglied.
- Die Mitgliederprofile öffnen als Dark-Mode-Dialog über der Liste, einschließlich aller bisherigen Tabs und Aktionen.
- Der Dialog lässt sich per Schließen, Hintergrund oder Escape verlassen; Berechtigungen und Datenzugriffe bleiben unverändert.

## 8.1.12 – 2026-10-19

**Mitgliederverwaltung: gemeinsamer Profileinstieg**

- Technische Bestandsaufnahme der Mitgliederschnittstellen dokumentiert.
- Mitgliederkarten bieten einen zentralen Profileinstieg mit Übersicht, Rollen, Minigame, geschützter Moderationshistorie und Backendzugriff.
- XP-, Rollen- und Backendaktionen verwenden unverändert die vorhandenen APIs und deren serverseitige Berechtigungsprüfungen.
- Bisherige Mitgliederkarten und Minigame-Spielerverwaltung bleiben parallel bestehen.

## 8.1.11 – 2026-10-19

**Minigame-XP in Discord-Mitgliederkarten**

- Discord → Server → Mitglieder zeigt ergänzend XP, Community-Dienstgrad und Teilstreitkraft an.
- Die separate Spielerverwaltung unter Minigame bleibt unverändert bestehen.
- Lesender API-Zugriff folgt der vorhandenen Berechtigung discord.members.view.
- Minigame-Ausfälle blockieren die Mitglieder- und Rollenverwaltung nicht.

## 8.1.10 – 2026-10-19

**Minigame: Aktualisierung vereinfacht**

- Der Button „Aktualisieren“ erscheint im Minigame nur noch im Tab „Konfiguration“.
- Nach dem Speichern von XP-Regeln und Dienstgraden werden die angezeigten Daten automatisch neu geladen.
- Die Spielerliste lädt beim Aufrufen die aktuellen Daten; Ladefehler erscheinen als Popup oben rechts.

## 8.1.9 – 2026-10-19

**Frei benennbare Minigame-Kanäle**

- Kategorie und vier Minigame-Kanäle besitzen konfigurierbare Namen einschließlich Emojis.
- Standardnamen: ╭➤ MINIGAME, 📜・regeln, 🏆・topliste, 🎖️・befoerderungen und 🪪・rangprofile.
- Der Einrichtungsassistent übernimmt die Namen und benennt zugeordnete Kanäle anhand ihrer bestehenden IDs um; Nachrichten und Berechtigungsmodell bleiben erhalten.

## 8.1.8 – 2026-10-19

**Minigame erst nach Regelbestätigung sichtbar**

- Die Kategorie MINIGAME und ihre vier Kanäle sind für nicht freigeschaltete Mitglieder verborgen.
- Die vorhandene Freischaltrolle Mitglied erhält Lesezugriff, jedoch keine Schreibrechte. Bot und Moderatoren behalten ihre Schreibrechte.
- Der Einrichtungsassistent synchronisiert die angepassten Zugriffsrechte auf bereits vorhandene Kanäle.

## 8.1.7

**Minigame-Kanalberechtigungen synchronisiert**

- Kategorie und Kanäle erhalten übereinstimmende Berechtigungen.
- Bot und Moderatoren bekommen ausdrückliche Schreibrechte; @everyone nur Leserechte.

## 8.1.6 – 2026-10-19

**Minigame-Fehlermeldungen verbessert**

- Minigame-Aktionen zeigen Rückmeldungen als vorhandene Benachrichtigungen oben rechts statt als Text unter den Karten.
- Fehlende Discord-Rechte bei Kanaleinrichtung und Nachrichtenveröffentlichung werden mit betroffenem Kanal und erforderlichen Berechtigungen erläutert.
- An der Einrichtung und Aktivierung des Minigames wurden keine Änderungen vorgenommen.

## 8.1.5 – 2026-10-19

**Konfiguration vor Spielstart und Update-Log nachgetragen**

- XP-Regeln, Regeltexte und Dienstgrade können vor der Aktivierung eingestellt werden.
- Regelveröffentlichung als Voraussetzung für die Aktivierung ergänzt; spätere Änderungen verlangen eine erneute Veröffentlichung.
- Einträge für die Entwicklungsstände 8.1.0 bis 8.1.4 im Update-Log nachgetragen.

## 8.1.4 – 2026-10-19

**Discord-Kategorieerkennung und Bestätigung korrigiert**

- Vorhandene Minigame-Kategorien und Kanäle werden über die Discord-API abgefragt.
- Einrichtungsdialog verwendet das dunkle Design des Control Centers.

## 8.1.3 – 2026-10-19

**Statuskarten kompakter dargestellt**

- Minigame-Karten verkleinert und für Desktop, Tablet und Mobilgeräte angepasst.

## 8.1.2 – 2026-10-19

**Statusübersicht überarbeitet**

- Kanal- und Kategoriestatus werden als Karten mit farbigen Hinweisen dargestellt.
- Anzeige für Einrichtungsstatus, Teilnehmer und Kanäle verbessert.

## 8.1.1 – 2026-10-19

**Minigame-Navigation und Spielerliste**

- Eigener Menüeintrag Minigame mit Unterbereichen eingerichtet.
- Spielerliste mit Suche, Filterung, Sortierung und XP-Verwaltung hinzugefügt.

## 8.1.0 – 2026-10-19

**Discord-Levelsystem als Entwicklungsstand integriert**

- Grundlegende XP-Verwaltung, Dienstgrade und private Discord-Rangbefehle integriert.
- Minigame-Einrichtung, Regeln und Topliste als erste Funktionen ergänzt.

## 8.0.13 – 2026-10-19

**Dashboard-Zusammenfassung korrigiert**

- Die Dashboard-Kachel Wortfilter zählt jetzt den zentralen PostgreSQL-Wortfilter statt der alten Legacy-Wortliste.
- Dashboard-Kennzahlen werden über eine eigene aggregierte API geladen und sind dadurch nicht mehr von den Detail-Capabilities des angemeldeten Moderators abhängig.
- Wortfilter zeigt produktiv aktive Begriffe sowie Test-, Twitch- und Discord-Zahlen kompakt an; Legacy-Einträge werden nur noch intern diagnostisch mitgeführt.
- Bot-Karten behaupten bei bloß vorhandener Tokendatei nicht mehr, der Account sei vollständig bereit; angezeigt wird präzise Token vorhanden. Chat Bot Badge wurde in Twitch App Token umbenannt.
- Die lokale Reset-Karte bezeichnet den tatsächlich zurückgesetzten Altbestand korrekt als Legacy-Wortliste; der zentrale V8-Wortfilter bleibt erhalten.
- Die Testnachricht wird Benutzern ohne Bearbeitungsrecht für Twitch-Commands nicht mehr angeboten.
- Keine Datenbankmigration; Schema bleibt 17. Keine compose.yaml-Änderung.

## 8.0.12 – 2026-10-19

**Discord-Statistik: Datumsdarstellung korrigiert**

- Discord-Mitglieder-Snapshots aus PostgreSQL werden als ISO-Datum YYYY-MM-DD exportiert, auch wenn node-postgres DATE-Werte als Date-Objekte liefert.
- Die Statistikansicht formatiert Datumswerte defensiv und zeigt bei ungültigen Werten keinen Browser-Text Invalid Date mehr.
- Vorhandene Statistikdaten bleiben unverändert; keine Datenbankmigration erforderlich.

## 8.0.11 – 2026-10-19

**Wortfilter-Stabilitätsrunde**

- Effektive Wirkung pro Begriff wird im Wortbestand direkt für Twitch und Discord angezeigt.
- Testlabor zeigt Normalisierung, Aktionsquelle, Ausführungsplan, Moderator-Ziel und Hinweise auf deaktivierte Erkennungsoptionen.
- Zentraler V8-Wortfilter ist bei vorhandener zentraler Konfiguration alleinige aktive Filterquelle; Legacy-Wortlisten bleiben nur als Rollback-/Notfallpfad erhalten.
- Discord-Wortfilter beansprucht erkannte Nachrichten vor der Aktion, um parallele Handler besser zu deduplizieren; Eskalation erzeugt keinen zweiten Warnhinweis.
- Schweregrad 1–5 wird im Wortbestand erläutert; Grad und Sanktion bleiben getrennt.
- Keine Datenbankmigration; Schema bleibt 17. Keine compose.yaml-Änderung.

## 8.0.10 – 2026-10-19

**Wortfilter-Aktionen und Diagnose korrigiert**

- Schweregrad und tatsächliche Maßnahme werden in der Oberfläche klar getrennt erklärt; das Testlabor zeigt die effektive Aktion und Erkennungsoptionen.
- Leetspeak-Erkennung behandelt Satzzeichen am Wortende korrekt; ein abschließendes Ausrufezeichen wird nicht mehr fälschlich als Buchstabe i normalisiert.
- Hinweistexte für die Aktion Verwarnen sind pro Kategorie und Plattform konfigurierbar.
- Moderator benachrichtigen sendet nun tatsächlich in den konfigurierten Discord-Moderations-Logkanal und protokolliert das Ziel.
- Doppelte Moderationsverarbeitung derselben Discord-Nachricht wird zeitlich begrenzt dedupliziert; Löschfehler weisen explizit auf fehlende Berechtigungen hin.
- PostgreSQL-Schema 17 ergänzt optionale Nachrichtentemplates für Wortfilter-Kategorien.

## 8.0.9 – 2026-10-19

**Wortfilter-Massenbearbeitung vervollständigt**

- Massenbearbeitung kann Leetspeak-Erkennung jetzt für ausgewählte Begriffe aktivieren, deaktivieren oder unverändert lassen.
- Wiederholte Buchstaben und Sonderzeichen-Trennung sind ebenfalls direkt in der Massenbearbeitung steuerbar, damit Einzel- und Batch-Editor denselben Funktionsumfang besitzen.
- Keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.8 – 2026-10-19

**Wortfilter-Bearbeitung erweitert**

- Wortfilter-Einträge lassen sich nun vollständig in einem Control-Center-Dialog bearbeiten, einschließlich Twitch-/Discord-Zuordnung, Status, Testmodus und Erkennungsoptionen.
- Massenbearbeitung kann die Plattformzuordnung für Twitch und Discord getrennt aktivieren, deaktivieren oder unverändert lassen.
- Native Browser-Prompt-Dialoge wurden aus der Wortfilter-Bearbeitung entfernt; der Editor folgt jetzt dem aktiven Hell-/Dunkelmodus.

## 8.0.7 – 2026-10-19

**Wortfilter-Rechte für Moderatoren korrigiert**

- Der zentrale Wortfilter ist nicht mehr ausschließlich globalen Administratoren vorbehalten.
- Moderatoren mit vorhandenen Twitch-Chatfilter-/Wortlistenrechten oder Discord-Moderationsrechten können den zentralen Wortfilter wieder sehen.
- Schreibende Wortfilter-Aktionen verlangen weiterhin eine vorhandene Bearbeiten-Berechtigung; reine Ansichtsrechte reichen nur zum Lesen.
- Keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.6 – 2026-10-19

**Nachtruhe-Vorwarnung und Punkte-Buchungen**

- Discord-Kanalzeiten können pro Profil vor Beginn der Nachtruhe eine konfigurierbare Vorwarnung senden; Standard sind 30 Minuten.
- Die Vorwarnung nennt Beginn und Ende der Nachtruhe, unterstützt {channel}, {closeTime}, {openTime} und {warningMinutes} und wird pro Zeitfenster nur einmal gesendet.
- Vorwarnungen werden bei Notfallmodus, aktiver manueller Übersteuerung oder bereits geschlossenen Kanälen unterdrückt und im Kanalzeiten-Ereignisprotokoll dokumentiert.
- Punkte-Buchungen zeigen verständliche Buchungsarten sowie Sender und Empfänger; zusammengehörige Transfer-Ein- und -Ausgänge werden in der Oberfläche zu einem Transfer zusammengeführt.
- PostgreSQL-Schema 16 ergänzt den persistenten Vorwarnungsstatus; compose.yaml bleibt unverändert.

## 8.0.5 – 2026-10-19

**Twitch-Zugriffsrechte korrigiert**

- Individuell gespeicherte Twitch-Capabilities werden auch bei ursprünglich automatisch angelegten Moderator-Konten wieder berücksichtigt.
- Der automatische Dashboard-Only-Fallback greift nur noch, wenn für den Twitch-Moderator tatsächlich keine individuellen Capabilities gespeichert sind.
- Keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.4 – 2026-10-18

**Stabilitätsrunde und Discord-Rollennamen**

- Discord-Rollen werden in betroffenen Laufzeitansichten über ihre Rollen-ID aufgelöst; Umbenennungen auf dem Discord-Server ändern die technische Zuordnung nicht.
- Kanalzeiten zeigen die aktuellen Discord-Rollennamen statt fest verdrahteter Bezeichnungen für Freischalt- und Moderationsrollen.
- Interne stabile Rollen-Keys und bestehende Berechtigungen bleiben unverändert, damit gespeicherte Konfigurationen kompatibel bleiben.
- Stabilitätsprüfung für Wortfilter, FollowAge/Nachrichtenzähler und PostgreSQL-Schema 15 ergänzt; keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.3 – 2026-10-18

- Dauerhafter Twitch-Nachrichtenzähler pro Nutzer auf Basis von Twitch-User-ID und Kanal-ID ergänzt.
- Zähleränderungen werden im Arbeitsspeicher gesammelt und etwa alle 20 Sekunden idempotent in PostgreSQL geschrieben.
- Eigene konfigurierte Bot-Accounts werden nicht gezählt; eine begrenzte Nachrichten-ID-Deduplizierung verhindert Doppelzählungen.
- FollowAge zeigt Chatnachrichten je Follower und kann numerisch danach sortieren; Nicht-Follower bleiben in der Zählung erhalten, erscheinen aber nicht in der Followerliste.

## 8.0.2 – 2026-10-18

**Wortfilter – eigene Verwaltungs-Tabs**

- Wortfilter-Verwaltung in sechs klar getrennte Tabs aufgeteilt: Wortbestand, Kategorien & Maßnahmen, Allowlist, Import / Export, Testlabor und Statistik.
- Lange Konfigurationsbereiche werden nicht mehr unterhalb des Wortbestands dargestellt; beim Tabwechsel werden bereits geladene Daten weiterverwendet.
- Tab-Navigation für Mobilgeräte responsiv angepasst.
- Keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.1 – 2026-10-18

**Wortfilter – Filter und Übersicht**

- Wortfilter-Verwaltung um sichtbare Filter für Kategorie, Plattform, Status, Schweregrad, Erkennungsart und Quelle erweitert.
- Suche arbeitet nun gezielt auf Begriff, Quelle, Kategorie und Erkennungsart; Filter können gesammelt angewendet oder vollständig zurückgesetzt werden.
- Wortbestand erhält Sortierung und Seitennavigation mit 25, 50 oder 100 Einträgen pro Seite.
- Twitch- und Discord-Zuordnung sowie Status werden kompakt als Kennzeichnungen dargestellt; Massenbearbeitung ist einklappbar.
- Mobile Wortfilter-Ansicht auf Kartenlayout umgestellt, damit Kategorie, Grad, Plattform und Aktionen eindeutig zugeordnet bleiben.
- Keine Datenbank- oder compose.yaml-Änderung erforderlich.

## 8.0.0 – 2026-10-18

**Zentrale Wortfilter-Verwaltung**

- Gemeinsamen kategorisierten Wortbestand für Twitch und Discord in PostgreSQL eingeführt.
- Bestehende Twitch-Verbotene-Wörter und Discord-Wortregeln werden beim ersten Start in den zentralen Bestand migriert; Legacy-Konfigurationen bleiben als Rollback- und Kompatibilitätspfad erhalten.
- Kategorien, Schweregrade, Plattformzuordnung, Testmodus, Allowlist, Erkennungsarten sowie optionale Leetspeak-, Wiederholungs- und Sonderzeichen-Erkennung ergänzt.
- Maßnahmen pro Kategorie und Plattform getrennt konfigurierbar; Worttreffer allein lösen keinen automatischen permanenten Ban aus.
- TXT-, CSV- und JSON-Import mit Vorschau, Dublettenerkennung, Importhistorie und Rollback ergänzt. LDNOOBW/de ist als statischer CC-BY-4.0-Import mit 66 deaktivierten Testeinträgen verfügbar.
- Testlabor, Trefferstatistik, Fehlalarm-Markierung, Massenbearbeitung und mobile Wortfilter-Ansicht ergänzt.
- Native Discord-AutoMod-Ausführungen bleiben dedupliziert; automatische Synchronisation zentraler Listen zu Discord AutoMod ist bewusst nicht aktiviert.
- Wortfilter-Treffer werden datensparsam ohne Nachrichteninhalte protokolliert und nach konfigurierbarer Frist bereinigt.
- Backup/Restore um den zentralen Wortfilter erweitert. PostgreSQL-Schema auf Version 14 angehoben.
- Keine Änderung der produktiven compose.yaml erforderlich.

## 7.2.20 – 2026-10-18

**Datenbank-Abschlussrunde**

- Command- und Auto-Reply-Nutzungsstatistiken relational in PostgreSQL gespeichert.
- Discord-Mitglieder-Analytics-Snapshots relational gespeichert; bestehende Historie wird automatisch übernommen.
- Backup/Restore und Legacy-Rollback-Export um die relationalisierten Statistikdaten erweitert.
- Datenbankdiagnose zeigt zusätzlich Datenbankgröße, Tabellen-/Indexanzahl sowie Statistik- und Analytics-Zähler.
- Persistenzdiagnose kennzeichnet verbliebene JSONB-Konfigurationen und relationale Legacy-/Rollback-Dokumente ausdrücklich.
- PostgreSQL-Schema auf Version 13 angehoben; keine Compose-Änderung erforderlich.

## 7.2.19 – 2026-10-18

- Twitch-Clip-State relational in PostgreSQL gespeichert.
- Clip-Deduplizierung erfolgt dauerhaft über eindeutige Clip-IDs in PostgreSQL.
- Clip-Monitorstatus und Rollback-Export an die relationale Speicherung angepasst.
- Datenbankdiagnose um Clip-Kennzahlen ergänzt.

## 7.2.18 – 2026-10-18

**Followage-Laden beschleunigt**

- Followage verwendet bei vorhandenem PostgreSQL-Followerbestand jetzt Stale-While-Revalidate: vorhandene Daten werden sofort angezeigt, während ein abgelaufener Cache im Hintergrund von Twitch aktualisiert wird.
- Nur ein vollständig leerer Followerbestand oder die explizite Aktion Twitch-Daten aktualisieren wartet noch synchron auf alle Twitch-Seiten.
- Die Followage-Seite zeigt an, wenn im Hintergrund eine Twitch-Aktualisierung läuft.
- Keine PostgreSQL-Schema- oder Compose-Änderung erforderlich.

## 7.2.17 – 2026-10-18

**Follower-Cache relationalisiert**

- Twitch-Follower-Cache aus dem versionierten JSONB-Dokument in relationale PostgreSQL-Tabellen überführt.
- Followage-Gesamtliste wird im PostgreSQL-Betrieb direkt sortiert und seitenweise aus der Datenbank gelesen, statt den vollständigen Cache für jede Ansicht in den Node-Prozess zu laden.
- Bestehender Follower-Cache wird beim ersten Start automatisch übernommen; der Legacy-Rollback-Export rekonstruiert weiterhin follower-cache.json.
- Datenbankdiagnose um Follower-Zeilen und Follower-Revision ergänzt.

## 7.2.16 – 2026-10-18

**Lokaler Admin-Login auf Synology/Docker wiederhergestellt**

- Direkter LAN-Zugriff über die lokale Synology-IP wird auch dann als lokal erkannt, wenn Docker den TCP-Peer auf eine private Bridge-/Gateway-Adresse umschreibt.
- Die lokale Erkennung bleibt an einen privaten/Loopback-Peer und einen Host innerhalb von LOCAL_NETWORK_CIDRS gebunden; der öffentliche Reverse-Proxy-Host wird dadurch nicht zum lokalen Login.
- Ein leeres TRUSTED_PROXY_CIDRS gilt im Modus direkter LAN-Login nicht mehr automatisch als Systemwarnung; Proxyheader bleiben weiterhin bewusst unvertraut.
- Systemstatus zeigt nun den Local-Admin-Modus direct-lan-only bzw. lan-and-trusted-proxy an.
- Keine Datenbank- oder Compose-Änderung erforderlich.

## 7.2.15 – 2026-10-18

**PostgreSQL: Ankündigungen und Discord-Bridge**

- Discord-Ankündigungszustände für Twitch-Live und Clips werden relational in PostgreSQL gespeichert.
- Die Twitch→Discord-Bridge-Warteschlange wird relational gespeichert und überlebt Neustarts mit ihren Zustellversuchen.
- Datenbankdiagnose um Ankündigungs- und Bridge-Kennzahlen ergänzt.
- Rollback-Export rekonstruiert announcements-state.json und discord-bridge.json aus PostgreSQL.

## 7.2.14 – 2026-10-18

**Timeout-Aufhebung robust und Moderationsprotokoll ausgelagert**

- Manuelles Aufheben aktiver Discord-Timeouts robuster umgesetzt: Der aktuelle Mitgliedsstatus wird vor und nach der Aktion geprüft; falls Discord das Entfernen per null-PATCH ablehnt, wird kontrolliert auf einen abgelaufenen Zeitstempel zurückgefallen.
- Fehlermeldungen beim Aufheben eines Timeouts enthalten nun die konkrete Discord-API-Ursache statt nur einer allgemeinen Meldung.
- Protokoll & Test aus der Moderations-Konfigurationsseite herausgelöst und als eigener Bereich unter Discord → Sicherheit ergänzt.
- Moderation enthält damit nur noch konfigurierbare Bereiche; Protokoll, Dry-Run, Sanktionsübersicht und Userhistorie sind eigenständige Sicherheitsansichten.
- PostgreSQL-Schema bleibt auf Version 9; compose.yaml benötigt keine funktionale Änderung.

## 7.2.13 – 2026-10-18

**Sanktionsübersicht korrigiert**

- Fehler in Discord → Moderation behoben: Nach dem Herauslösen der Sanktionsübersicht wurde dort noch eine nicht mehr vorhandene Funktion loadSanctions aufgerufen.
- Die Moderationsseite lädt wieder fehlerfrei; die eigenständige Sanktionsübersicht bleibt unter Sicherheit verfügbar.
- Kennzahlen in der Sanktionsübersicht zeigen nun einen sichtbaren Abstand zwischen Zahl und Bezeichnung.

## 7.2.12

**Zentrale Discord-Sanktionsübersicht**

- Sanktionsübersicht als eigener Bereich unter Discord → Sicherheit herausgelöst; Moderation → Sanktionen enthält nur noch die Konfiguration des Sanktionsmodells.
- Aktive Timeouts, Bans, allgemeine Eskalationen und Spam-Eskalationen werden in einer gemeinsamen operativen Übersicht zusammengeführt.
- Filter für Alle, Timeout aktiv, Gebannt, Eskalation und Spam sowie Kennzahlen für die aktuellen Zustände ergänzt.
- Aktive Spam-Protect-Timeouts werden auch ohne allgemeine Moderations-Eskalationsstufe zuverlässig als Sanktion angezeigt.
- Timeout aufheben, Timeout + Eskalation zurücksetzen, Nur Eskalation zurücksetzen und Ban aufheben sind direkt in der zentralen Übersicht verfügbar.
- Dashboard-Kennzahl für aktive Eskalationen führt direkt zur neuen Sanktionsübersicht.
- PostgreSQL-Schema bleibt auf Version 9; compose.yaml benötigt keine funktionale Änderung.

## 7.2.11

**Discord-Spam-Timeouts in Sanktionen sichtbar**

- Aktive Spam-Protect-Timeouts erscheinen jetzt zuverlässig in der Sanktionsübersicht, auch wenn die getrennte allgemeine Moderations-Eskalationsstufe 0 ist.
- Die Sanktionsliste nutzt zusätzlich das persistente Moderationsprotokoll als Kandidatenquelle und prüft anschließend den tatsächlichen Discord-Timeoutstatus.
- Spam-Verstöße im aktuellen Eskalationsfenster werden getrennt von allgemeinen Moderationsverstößen angezeigt.
- Timeout + Eskalation zurücksetzen sowie Nur Eskalation zurücksetzen löschen jetzt auch den Spam-Protect-Wiederholungszähler.

## 7.2.10

**Discord-Timeouts manuell aufheben**

- Aktive Discord-Timeouts werden in der Moderationsübersicht direkt gegen den aktuellen Discord-Mitgliedsstatus geprüft und mit Ablaufzeit angezeigt.
- Berechtigte Moderatoren können einen aktiven Timeout sofort aufheben, ohne die bestehende Eskalationshistorie zu verändern.
- Zusätzliche Aktion 'Timeout + Eskalation zurücksetzen' hebt den Discord-Timeout auf und setzt zugleich Timeout-Stufe, Timeout-Zähler und Wiederholungszähler zurück.
- Manuelle Timeout-Aufhebungen werden im Moderationsprotokoll, Audit-Log und optional im Discord-Logkanal dokumentiert.
- Serverseitige Berechtigungsprüfung verwendet weiterhin discord.moderation.edit und prüft zusätzlich die Discord-Berechtigung Mitglieder moderieren.
- PostgreSQL-Schema bleibt auf Version 9; keine Änderung an compose.yaml, Secrets, Ports oder Volumes erforderlich.

## 7.2.9

**Kanalzeiten und Notfallmodus relational**

- Discord-Kanalzeiten-Zustand mit aktiven Sperren, manuellen Overrides und Ereignishistorie in relationale PostgreSQL-Tabellen überführt.
- Notfallmodus-Zustand mit Aktivstatus, Stufe, Laufzeit, betroffenen Kanälen, Permission-Snapshots und Historie relational gespeichert.
- Permission-Snapshots bleiben transaktionssicher erhalten, damit ein Neustart während eines aktiven Notfallmodus die exakte Wiederherstellung der vorherigen Kanalrechte nicht verliert.
- Bestehende channel-times-state- und emergency-state-Daten werden beim ersten Discord-Start idempotent aus PostgreSQL-JSONB oder ersatzweise aus den Legacy-Dateien übernommen.
- Schreibvorgänge verwenden Advisory-Locks und Revisionsprüfungen; parallele veraltete Zustände werden abgewiesen.
- Administration → Datenbank zeigt Kanalzeiten-Aktivzustände, Overrides, Ereignisse sowie Notfallstatus, Snapshots, Historie und Revisionen.
- Flexible Kanalzeiten- und Notfall-Konfigurationen bleiben weiterhin als versionierte JSONB-Konfiguration erhalten.
- PostgreSQL-Schema auf Version 9 angehoben; keine Änderung an compose.yaml, Secrets, Ports oder Volumes erforderlich.

## 7.2.8

**Social-Media-Daten relational & Regeln-UX**

- Instagram-/TikTok-Erkennungszustände, bekannte Beiträge und Discord-Veröffentlichungshistorie in relationale PostgreSQL-Tabellen überführt.
- Social-Media-Konfiguration sowie OAuth-/Access-/Refresh-Token bleiben bewusst außerhalb der relationalen Fachdaten; Secrets werden nicht in die neuen Tabellen übernommen.
- Bestehende social-state- und social-history-Daten werden beim ersten Discord-Start idempotent aus PostgreSQL-JSONB oder ersatzweise aus den Legacy-Dateien übernommen.
- Social-Schreibvorgänge nutzen Advisory-Lock und Revisionsprüfung; bekannte Beiträge sind pro Plattform und externer ID eindeutig.
- Administration → Datenbank zeigt bekannte Social-Beiträge, Historieneinträge, fehlgeschlagene Zustellungen und die Social-Revision.
- Discord-Regeltext unterstützt nun die Discord-Grenze von 2000 Zeichen und zeigt einen Live-Zeichenzähler.
- Bei bereits veröffentlichter Regelnachricht gibt es Speichern & Regelnachricht aktualisieren; normales Speichern weist sichtbar darauf hin, dass Discord noch nicht aktualisiert wurde.
- PostgreSQL-Schema auf Version 8 angehoben; keine Änderung an compose.yaml, Secrets, Ports oder Volumes erforderlich.

## 7.2.7

**Discord-Onboarding und Meldesystem relational**

- Discord-Onboarding/Freischaltung mit Mitgliederzuständen, Begrüßung, Verifizierung, Rejoin-Erkennung und Statistik in relationale PostgreSQL-Tabellen überführt.
- Discord-Meldesystem mit Tickets, Ticket-Aktionen, jährlicher Ticketnummerierung und Melde-Cooldowns relational gespeichert.
- Flexible Onboarding- und Meldesystem-Konfigurationen bleiben bewusst als JSONB-Dokumente erhalten.
- Bestehende Onboarding- und Meldedaten werden beim ersten Discord-Start aus den bisherigen PostgreSQL-JSONB-Dokumenten oder ersatzweise aus den Legacy-Dateien übernommen.
- Schreibvorgänge nutzen Advisory-Locks und Revisionsprüfungen; Ticket-Aktionen werden mit Fremdschlüsselbezug zum jeweiligen Ticket gespeichert.
- Backup/Restore und PostgreSQL-Rollback-Export rekonstruieren onboarding-state.json, reports.json und reports-state.json aus dem relationalen Stand.
- Administration → Datenbank zeigt Onboarding-Mitglieder, verifizierte Mitglieder, Meldungen, offene Meldungen, Ticket-Aktionen und die jeweiligen Revisionen.
- PostgreSQL-Schema auf Version 7 angehoben; keine Änderung an compose.yaml, Secrets, Ports oder Volumes erforderlich.

## 7.2.6

**Benutzer, Rechte und Sessions relational**

- Control-Center-Benutzer und verknüpfte Twitch-/Discord-Identitäten aus dem bisherigen PostgreSQL-JSONB-Dokument in relationale Tabellen überführt.
- Individuelle Capabilities werden in einer eigenen Beziehungstabelle gespeichert; eindeutige Twitch- und Discord-IDs verhindern doppelte Kontozuordnungen auf Datenbankebene.
- Aktive Control-Center-Sessions werden in PostgreSQL mit Ablaufzeit, Authentifizierungsquelle, Identitätsbezug und Security-Revision gespeichert; abgelaufene Sessions werden beim Lesen bereinigt.
- Bestehende users.json-/sessions.json-Bestände beziehungsweise deren bereits importierte JSONB-Dokumente werden beim ersten Start idempotent übernommen, ohne vorhandene relationale Daten zu überschreiben.
- Backup/Restore für Benutzer bleibt kompatibel; ein Benutzer-Restore invalidiert weiterhin alle aktiven Sessions.
- Der PostgreSQL-Rollback-Export rekonstruiert users.json und sessions.json aus dem relationalen Stand.
- Administration → Datenbank zeigt Backend-Benutzer, Capability-Zuordnungen, aktive Sessions und Benutzer-Revision an.
- PostgreSQL-Schema auf Version 6 angehoben; keine Änderung an compose.yaml oder Secrets erforderlich.

## 7.2.5

**Discord-Spam-Schutz**

- Discord-Moderation um einen konfigurierbaren Spam-Schutz für Nachrichtenfluten, identische Wiederholungen und Mention-Spam erweitert.
- Schwellenwerte und Zeitfenster sind im Control Center unter Discord → Moderation → Spam-Schutz einstellbar; Bots und Webhooks werden grundsätzlich ignoriert.
- Administrator und Moderator können automatisch ausgenommen werden; weitere Rollen und Kanäle lassen sich zusätzlich freistellen.
- Spam-Maßnahmen sind getrennt von der allgemeinen Wort-/Link-Eskalation: auslösende Nachricht löschen, Hinweis senden und drei konfigurierbare Timeout-Stufen.
- Spam-Verstöße werden innerhalb eines konfigurierbaren Wiederholungsfensters persistent gezählt; nach Ablauf beginnt die Spam-Eskalation wieder bei Stufe 1.
- Ein Aktions-Cooldown verhindert Mehrfachsanktionen aus demselben Nachrichtenburst; ein automatischer Ban erfolgt durch den Spam-Schutz bewusst nicht.
- Spam-Ereignisse werden in das vorhandene Discord-Moderationsprotokoll geschrieben und nutzen den bestehenden relationalen Moderationszustand in PostgreSQL.
- Für diese Version ist keine Schema- oder compose.yaml-Änderung erforderlich.

## 7.2.4

**Discord-Moderation relational**

- Discord-Moderationszustand aus dem bisherigen PostgreSQL-JSONB-Dokument in relationale PostgreSQL-Tabellen überführt.
- Eskalationsstufen, Timeout-Zähler, Bann-/Entbann-Zustände, letzte Verstöße und Wiederholungsfenster werden strukturiert gespeichert.
- Discord-Moderationsprotokolle bleiben in der bereits seit V7.2.0 relationalen Ereignistabelle; die bisherige 2.000-Ereignisse-Begrenzung bleibt bestehen.
- Schreibvorgänge des Moderationszustands laufen transaktionssicher mit Advisory-Lock und Revisionsprüfung.
- Bestehende Moderationszustände werden beim ersten Start aus dem PostgreSQL-JSONB-Dokument oder ersatzweise aus moderation-state.json übernommen, ohne vorhandene relationale Daten zu überschreiben.
- Backup/Restore und PostgreSQL-Rollback-Export rekonstruieren weiterhin moderation-state.json und moderation-log.jsonl.
- Administration → Datenbank zeigt Moderationsnutzer, Moderationsereignisse, aktive Wiederholungsmarker und die Moderations-Revision im Discord-Bereich an.
- PostgreSQL-Schema auf Version 5 angehoben; bestehende V7.2.3-Datenbanken werden beim Start automatisch und idempotent erweitert.

## 7.2.3

**Gewinnspiele relational**

- Gewinnspiele aus dem bisherigen PostgreSQL-JSONB-Dokument in relationale PostgreSQL-Tabellen überführt.
- Gewinnspiel-Stammdaten, Teilnahmen und Ziehungen werden strukturiert gespeichert; pro Gewinnspiel kann eine Twitch-User-ID nur einmal teilnehmen und nur einmal gewinnen.
- Schreibvorgänge laufen transaktionssicher mit Advisory-Lock und Revisionsprüfung; veraltete parallele Zustände werden abgewiesen statt unbemerkt überschrieben.
- Bestehende Gewinnspiele und Historien werden beim ersten Zugriff aus dem bisherigen PostgreSQL-JSONB-Dokument oder ersatzweise aus giveaways.json übernommen, ohne vorhandene relationale Daten zu überschreiben.
- Keyword- und Random-Gewinnspiele, Rollen-/VIP-Ausschlüsse, Mehrfachziehungen, Verlauf und Twitch-Chat-Ausgaben bleiben fachlich unverändert.
- Backup/Restore und PostgreSQL-Rollback-Export rekonstruieren weiterhin die bisherige giveaways.json-Struktur.
- Administration → Datenbank zeigt Anzahl der Gewinnspiele, Teilnahmen, Ziehungen und die aktuelle Gewinnspiel-Revision an.
- Veralteten Persistenzmodell-Hinweis aus V7.2.2 korrigiert; Followathon wird dort nun korrekt als relational ausgewiesen.
- Backup-Wiederherstellung schreibt Followathon-Daten im PostgreSQL-Modus nun ebenfalls direkt in die relationalen Followathon-Tabellen statt nur in das frühere JSONB-Dokument.
- PostgreSQL-Schema auf Version 4 angehoben; bestehende V7.2.2-Datenbanken werden beim Start automatisch und idempotent erweitert.

## 7.2.2

**Followathon relational**

- Followathon-Zustand aus dem bisherigen PostgreSQL-JSONB-Dokument in relationale PostgreSQL-Tabellen überführt.
- Events, Annahmezeiträume, bereits berücksichtigte Twitch-Nutzer, zurückgehaltene Follows, Ereignisprotokolle und Followathon-Message-IDs werden strukturiert gespeichert.
- Pro Event erzwingt PostgreSQL weiterhin maximal eine Berücksichtigung je Twitch-User-ID; Followathon-Message-IDs besitzen einen eindeutigen Schlüssel.
- Followathon-Schreibvorgänge laufen transaktionssicher mit Advisory-Lock und Revisionsprüfung; veraltete parallele Zustände werden abgewiesen statt unbemerkt überschrieben.
- Bestehende Followathon-Daten werden beim ersten Start aus dem bisherigen PostgreSQL-JSONB-Dokument oder ersatzweise aus followathon.json übernommen, ohne vorhandene relationale Daten zu überschreiben.
- Countdown, Pause, Annahmestopp, feste Endzeit, Grenzkürzung, Auffälligkeitsprüfung, Rücknahmen, Testmodus und OBS-SSE-Overlay bleiben fachlich unverändert.
- Rollback-Export rekonstruiert weiterhin eine vollständige followathon.json aus den relationalen Tabellen.
- Administration → Datenbank zeigt Followathon-Events, berücksichtigte Follows, Protokolle und die aktuelle Followathon-Revision an.
- PostgreSQL-Schema auf Version 3 angehoben; bestehende V7.2.1-Datenbanken werden beim Start automatisch und idempotent erweitert.

## 7.2.1

**Punkte relational**

- Stubenkontrolle und Punkte aus dem bisherigen JSONB-Zustandsdokument in relationale PostgreSQL-Tabellen überführt.
- Konten, Punktestände, reservierte Einsätze, Daily-Status, Runden, Teilnehmer und Buchungen werden strukturiert und transaktionssicher gespeichert.
- Bestehende Punkte-Daten werden beim ersten Start aus dem PostgreSQL-JSONB-Dokument beziehungsweise dem Legacy-JSON übernommen, ohne vorhandene relationale Daten zu überschreiben.
- Schreibvorgänge verwenden eine Revisionsprüfung und einen PostgreSQL-Advisory-Lock; parallele veraltete Zustände werden abgewiesen statt unbemerkt Daten zu überschreiben.
- Runden, Teilnehmer und Buchungen besitzen stabile Primärschlüssel; der bestehende Spielablauf, !give, !daily, Admin-Gutschriften, Erstattungen, Reset und Overlay bleiben fachlich unverändert.
- Backup/Restore und PostgreSQL-Rollback-Export rekonstruieren weiterhin die bisherige stubenkontrolle.json-Struktur, sodass ein kontrollierter Rückweg erhalten bleibt.
- Administration → Datenbank zeigt zusätzlich Anzahl der Spind-Konten, Runden, Buchungen und die aktuelle Spind-Revision an.
- PostgreSQL-Schema auf Version 2 angehoben; bestehende V7.2.0-Datenbanken werden beim Start automatisch und idempotent erweitert.

## 7.2.0

**PostgreSQL-Datenhaltung**

- PostgreSQL als primäre Datenhaltung für strukturierte Laufzeitdaten eingeführt; Datenbank läuft lokal als eigener Container im privaten Docker-Netz und veröffentlicht keinen Port nach außen.
- Vorhandene JSON-/JSONL-Daten werden beim ersten Start kontrolliert und idempotent übernommen; die bisherigen Dateien bleiben als unveränderter Legacy-Ausgangsstand erhalten.
- Tatsächlich übernommene Legacy-Bestände werden mit Quelldatei, Importzeitpunkt und SHA-256-Prüfsumme im Import-Ledger protokolliert.
- Watchtime auf eine relationale Tabelle mit atomaren Inkrementen, Suche, Sortierung und Korrekturen umgestellt.
- EventSub-Message-IDs werden dauerhaft über einen eindeutigen Primärschlüssel dedupliziert, damit doppelte Zustellungen auch nach Neustarts nicht erneut verarbeitet werden.
- Audit-, Login- und Discord-Moderationsereignisse werden in PostgreSQL gespeichert; Discord-Moderationshistorie bleibt auf 2.000 Einträge begrenzt.
- Komplexe bestehende Zustände wie Followathon, Punkte, Gewinnspiele, Benutzer, Sessions, Event-Profile und Discord-Module werden ohne Änderung ihrer Fachlogik als versionierte JSONB-Dokumente gespeichert.
- OAuth-/Refresh-Tokens, Social-Media-Tokenzustände, Report-Anhänge und andere Secrets bleiben bewusst außerhalb PostgreSQL in den bisherigen geschützten Datenverzeichnissen bzw. Umgebungsvariablen.
- Owner-Bereich Administration → Datenbank mit PostgreSQL-Diagnose und kontrolliertem Legacy-Rollback-Export ergänzt.
- Native pg_dump-/pg_restore-Skripte sowie eine ausführliche PostgreSQL-Migrations- und Rollback-Anleitung ergänzt.
- Container-Image für Twitch- und Discord-Dienst enthält den PostgreSQL-Treiber; PostgreSQL ist für die DS920+ mit 512 MB RAM-Limit und moderaten Serverparametern vorkonfiguriert.
- EventSub-Systemstatus erwartet nun alle fünf tatsächlich eingerichteten Subscriptions einschließlich stream.online.

## 7.1.1

**Followathon Overlay-Design**

- Followathon-Overlay auf Akzidenz Grotesk Bold als bevorzugte Schrift umgestellt; lokal installierte Schrift wird durch die OBS-Browserquelle verwendet.
- Standard-Textfarbe des Followathon-Overlays auf RGB 250, 183, 10 (#fab70a) angepasst.
- Countdown, Beschriftung, Follow-Anzahl, optionaler Followername und Zeitgutschrift erhalten eine dezente schwarze Kontur und einen leichten Schatten für bessere Lesbarkeit.
- Bestehende Followathon-Events mit der bisherigen unveränderten Standardfarbe Weiß werden im öffentlichen Overlay automatisch im neuen Gold dargestellt.
- Aus Lizenzgründen wird keine Akzidenz-Grotesk-Schriftdatei mit dem Update verteilt; bei nicht lokal verfügbarer Schrift greift eine fette Sans-Serif-Fallback-Schrift.

## 7.1.0

**Followathon**

- Followathon als eigener Bereich im Live-Betrieb ergänzt.
- Echte channel.follow-v2-Ereignisse aus der bestehenden EventSub-Verbindung verlängern den serverseitigen Countdown; bestehende Follow-Begrüßungen bleiben unverändert aktiv.
- Startdauer, Sekunden pro Follow, maximale Restzeit und feste späteste Endzeit mit Europe/Berlin-Eingabe ergänzt.
- Pause, Fortsetzen, Annahmestopp, manuelle Zeitkorrekturen, Reset und nachvollziehbares Ereignisprotokoll ergänzt.
- Dauerhafte Deduplizierung über Twitch-Message-ID und pro Event über Twitch-User-ID ergänzt.
- Auffälligkeitsschwelle für Follow-Häufungen mit manueller Prüfung sowie Rücknahme einzelner Gutschriften oder eines Zeitraums ergänzt.
- Öffentliches, rein lesendes HTTPS-OBS-Overlay mit SSE-Synchronisierung, Reconnect-Anzeige und optionalen Followernamen ergänzt.
- Followathon-Zustand wird persistent in der bestehenden JSON-Datenhaltung gespeichert; der Server bleibt maßgebliche Zeitquelle und laufende Countdown-Zeit verstreicht auch bei Container-Ausfällen.
- Geschützter Simulationsmodus und Followathon-Regressionstest ergänzt.
- EventSub-Dashboardzählung an die tatsächlich fünf eingerichteten Subscriptions angepasst.
- Nicht unterstützte pids_limit-Einträge aus der Synology-Compose-Konfiguration entfernt; RAM-Limit und übrige Container-Härtung bleiben bestehen.

## 7.0.1

**Security Patch**

- Kritische serverseitige Autorisierung korrigiert: Backup bleibt Owner-only; Benutzerverwaltung und Neustart verwenden explizite globale Admin-/Owner-Guards.
- API-Autorisierung um eine zentrale Default-Deny-Matrix ergänzt.
- Owner-Zielschutz bei Benutzeränderungen und -löschungen anhand effektiver Privilegien gehärtet.
- Bestehende Sessions durch neue Sicherheitsrevision absichtlich invalidiert; sicherheitsrelevante Benutzeränderungen entwerten betroffene Sessions.
- Logout löscht die Session serverseitig; zusätzlich Alle Sitzungen abmelden ergänzt.
- Twitch-/Discord-/Verbindungs-OAuth mit kurzlebigem browser-/sessiongebundenem State und PKCE S256 gehärtet.
- Lokaler Adminzugang verwendet CIDR-basierte IP-Prüfung statt Hostpräfix; Proxyheader werden nur von explizit vertrauenswürdigen Peers akzeptiert.
- Interne Discord-Verwaltungs-API mit gemeinsamem Dienstgeheimnis und Timing-Safe-Prüfung geschützt.
- Archivierte Discord-Anhänge: nur validierte PNG/JPEG/GIF/WebP inline; HTML/SVG/XML/unbekannt nur als sicherer Download.
- JSON-/Backup-Bodies und externe Downloads werden streamingbasiert begrenzt; Timeouts und Parallelitätsgrenzen ergänzt.
- Zentrale CSP, Clickjacking-Schutz, nosniff, Referrer-Policy, Permissions-Policy und HSTS-Logik ergänzt.
- Fehlerhafte Cookie-Codierung führt nicht mehr zu ungefiltertem 500-Fehlertext.
- Stubenkontrolle-WebSocket: unbekannte Upgrades schließen, Clientlimit, Origin-Allowlist und Trennung bestehender Clients bei Schlüsselrotation.
- Compose gehärtet: read-only Code-Mounts, no-new-privileges, cap_drop ALL, PID-/RAM-Limits und privates benanntes Docker-Netz.
- Security-Hardening- und Regressionstest-Dokumentation hinzugefügt.

## 7.0.0

**Stable · Stabilisierung & Abschlussrunde**

- Keine neuen Funktionsmodule; Fokus ausschließlich auf Stabilität und Konsistenz.
- Alle Haupt-JavaScript-Dateien inklusive Supervisoren statisch geprüft.
- Doppelte recordRepeat-Funktionsdefinition im Discord-Moderationsdienst entfernt.
- Compose-Konfiguration für beide Container auf restart: unless-stopped gegengeprüft.
- Supervisor-Startbefehle für Twitch-/Control-Center- und Discord-Dienst gegengeprüft.
- Backup-Schema V2, V1-Kompatibilität und Discord-Backup-Bereiche statisch abgeglichen.
- Tokens, Secrets, Sessions und aktive Rechte-Snapshots bleiben aus Backups ausgeschlossen.
- Restart-Ziele Twitch, Discord und Beide gegen Backend und Oberfläche abgeglichen.
- Versionsbezogene Alttexte in der Hilfe neutralisiert.
- Discord-interne Service-Version auf 2.0.0 konsolidiert.

## 6.8.1

**Hotfix: zuverlässiger Dienst-Neustart**

- Behebt den Fall, dass der Twitch-Container nach einem Neustart aus der Oberfläche gestoppt blieb.
- Beide Container verwenden jetzt einen internen Node-Supervisor als PID 1.
- Twitch-/Control-Center-Dienst wird als Kindprozess des Supervisors gestartet.
- Discord-Dienst wird als Kindprozess des Supervisors gestartet.
- Neustart aus dem Control Center beendet nur den jeweiligen Node-Kindprozess mit reserviertem Exit-Code 75.
- Der Supervisor startet den Kindprozess unmittelbar neu; der Docker-Container bleibt online.
- Kombinierter Neustart verwendet denselben Mechanismus für beide Dienste.
- compose.yaml verwendet jetzt node supervisor.js server.js bzw. node supervisor.js discord-server.js.

## 6.8.0

**Dienst-Neustart & vollständiges Backup / Restore**

- Systemstatus bietet getrennten Neustart für Twitch-/Control-Center-Dienst, Discord-Dienst oder beide Dienste.
- Neustart verwendet die vorhandene Docker-Restart-Policy und wartet in der Oberfläche auf erneute Betriebsbereitschaft.
- Discord-Dienst besitzt einen internen kontrollierten Restart-Endpunkt.
- Backup / Restore um sichere Discord-Daten erweitert.
- Discord Community/Freischaltung und Ankündigungen können gesichert und wiederhergestellt werden.
- Discord Moderation, Eskalationszustände und Userhistorie können gesichert und wiederhergestellt werden.
- Discord Meldesystem inklusive Ticketdaten kann gesichert und wiederhergestellt werden.
- Kanalzeiten-Konfiguration und Verlauf sind im Backup enthalten; aktive Rechte-Snapshots bleiben ausgeschlossen.
- Notfallmodus-Konfiguration und Verlauf sind im Backup enthalten; aktiver Zustand und Rechte-Snapshots bleiben ausgeschlossen.
- Zentrale Discord Log-Konfiguration ist im Backup enthalten.
- Discord Social-Media-Konfiguration, Dedup-/Polling-Zustand und Verlauf sind enthalten; OAuth-/Access-/Refresh-Tokens bleiben ausgeschlossen.
- Öffentliche Webseiten sind nun auch in der Backup-Oberfläche auswählbar.
- Backup-Schema auf V2 erweitert; V1-Backups bleiben für alte Bereiche kompatibel.
- Restore-Dialog verwendet eine passende Wiederherstellungsbestätigung statt Löschdialog.
- Archivierte Attachment-Binärdateien des Meldesystems werden nicht in das JSON-Backup eingebettet.

## 6.7.0

**Discord Userhistorie**

- Neuer Bereich Discord → Sicherheit → Userhistorie.
- Userbezogene Moderationschronik aus gespeicherten Verstößen, Timeouts, Bans und Unbans.
- Suche nach User-ID, Benutzername, Regel, Treffer und protokollierten Aktionen.
- Anzeige von aktueller Eskalationsstufe, Verstoßzähler, Timeout-Gesamtzahl und Banstatus.
- Erster/letzter Verstoß, letzter Timeout, letzter Unban und letztes Ereignis pro User sichtbar.
- Chronik pro User wird mit neuestem Ereignis zuerst dargestellt.
- Eskalation kann direkt aus der Userhistorie zurückgesetzt werden, ohne historische Ereignisse zu löschen.
- Aktive Bans können direkt aus der Userhistorie aufgehoben werden; der Unban bleibt historisch nachvollziehbar.

## 6.6.1

**Lagebild UI-Polish**

- Notfallmodus NORMAL wird grün statt rot dargestellt.
- Deaktivierte optionale Funktionen werden neutral/grau statt als Fehler dargestellt.
- PAUSIERT verwendet einen Warnstatus statt Fehlerstatus.
- System-&-Discord-Statuskarten innerhalb des zweispaltigen Lagebilds auf ein 2×2-Raster umgestellt.
- Lange Server- und Botnamen umbrechen sauber innerhalb ihrer Statusbox.
- Redundante Server-/Bot-Metadaten entfernt; stattdessen Uptime und letztes Gateway-Event.
- Kompakte Prüfkacheln skalieren auf schmaleren Karten responsiv.

## 6.6.0

**Discord Lagebild**

- Discord-Dashboard vollständig als zentrales Lagebild überarbeitet.
- Kennzahlen für offene Meldungen, aktive Moderations-Eskalationen, Nachtruhe und Freischaltungen.
- Live-Systemstatus für Gateway, Bot, Rollen, Kategorien, Kanäle und Rollenhierarchie.
- Moderationsübersicht mit Ereignissen der letzten 7 und 30 Tage.
- Kanalzeiten zeigen aktive Nachtruhe-Kanäle und eine mögliche Pausierung durch den Notfallmodus.
- Aktiver Notfallmodus wird prominent mit Stufe, Grund, ausführendem Benutzer und Ende angezeigt.
- Fehler aus Gateway, Moderation, Meldesystem, Freischaltung, Kanalzeiten und Notfallmodus werden zentral als Warnungen gebündelt.
- Schnellzugriffe zu Meldungen, Moderation, Kanalzeiten, Notfallmodus und Logs.
- Owner erhalten zusätzlich Social-Media-Verbindungsstatus; Nicht-Owner erhalten diese Daten serverseitig nicht.

## 6.5.0

**Discord Notfallmodus**

- Neuer eigenständiger Discord-Menüpunkt Notfallmodus.
- Zugriff ausschließlich für Owner und Admins; sämtliche API-Aktionen serverseitig geschützt.
- Drei frei konfigurierbare Notfallstufen: Eingeschränkt, Lockdown und Vollschutz.
- Betroffen ist ausschließlich die Rolle Mitglied; Administrator, Moderator und Bot bleiben handlungsfähig.
- Regeln, Meldekopf, #log und Stabsraum sind als unveränderbare Schutzkanäle vom Lockdown ausgenommen.
- Textkanäle werden über Schreib- und Thread-Rechte gesperrt; Voice-Kanäle über Connect.
- Stufe 3 kann zusätzlich Reaktionen in den ausgewählten Textkanälen unterbinden.
- Exakter persistenter Snapshot vorhandener Mitglied-Overwrites vor der ersten Rechteänderung.
- Beim Beenden werden die ursprünglichen Rechte exakt wiederhergestellt.
- Notfallmodus kann für 15, 30, 60 oder 120 Minuten oder bis zur manuellen Beendigung laufen.
- Aktiver Notfallmodus wird nach Container-Neustarts automatisch wieder erzwungen.
- Kanal-Zeitsteuerung pausiert während des Notfallmodus und wird danach automatisch mit dem aktuellen Zeitplan abgeglichen.
- Optionale öffentliche Aktivierungs- und Beendigungsnachricht mit editierbaren Templates.
- Konfigurierbarer Hinweis-Kanal.
- Persistente Historie von Aktivierungen, Stufenwechseln und Beendigungen.
- Neue zentrale Log-Kategorie Notfallmodus mit Aktivierung, Stufenwechsel, Beendigung und Fehlern.
- Best-Effort-Rollback bei fehlgeschlagenem Stufenwechsel.

## 6.4.2

**Zentrale Discord Logs & Benachrichtigungen**

- Neuer Admin-Bereich Discord → Administration → Logs & Benachrichtigungen.
- Zugriff auf die Log-Zentrale ausschließlich für globale Admins und Owner.
- Log-Ereignisse nach Kategorien sortiert: Moderation, Freischaltung & Server, Meldesystem, Kanalzeiten und System.
- Globaler Standard-Logkanal mit optionalem Zielkanal-Override pro Ereignis.
- Jedes Log-Ereignis ist einzeln aktivierbar/deaktivierbar und besitzt ein editierbares Nachrichtentemplate.
- Erlaubte Template-Variablen werden direkt am jeweiligen Ereignis angezeigt.
- Test senden und Standard wiederherstellen pro Log-Ereignis.
- Neue konfigurierbare Discord-Logmeldung Ban aufgehoben.
- Unban-Log enthält standardmäßig User, User-ID, handelnden Admin/Owner und Zeitpunkt.
- Unban wird zusätzlich in der internen Moderationshistorie erfasst.
- Moderations-Logs, Freischaltungs-Logs, Ticket-Logs und Kanalzeiten-Logs verwenden jetzt dieselbe zentrale Log-Infrastruktur.
- Bisherige verteilte Log-Einstellungen werden beim ersten Start in die zentrale Konfiguration migriert.
- Fachbereiche verweisen auf die zentrale Log-Verwaltung, statt Discord-Logtexte mehrfach zu pflegen.
- Internes Audit-Protokoll bleibt unabhängig und kann über die Discord-Log-Zentrale nicht deaktiviert werden.
- Persistente Speicherung in /discord-data/discord-log-config.json.

## 6.4.1

**Hotfix: Discord-Ban aufheben**

- Behebt Discord API 400 / Code 50109 beim Aufheben eines Bans.
- Discord-Requests ohne Body senden keinen Content-Type application/json mehr.
- Unban verwendet DELETE ohne JSON-Body, wie von Discord erwartet.
- Der Audit-Log-Grund für das Aufheben des Bans bleibt erhalten.
- Nach erfolgreichem Unban werden Banstatus, Timeout-Stufe, Timeout-Zähler und Wiederholungszähler des Users zurückgesetzt.

## 6.4.0

**Discord Kanal-Zeitsteuerung / Nachtruhe**

- Neuer Bereich Discord → Server → Kanalzeiten.
- Skalierbare Zeitprofile pro Textkanal; weitere Kanäle können ohne Codeänderung ergänzt werden.
- Vorbereitete Profile für #talk und #memes mit 22:00–06:00; globale Funktion startet bewusst deaktiviert.
- Pro Profil frei einstellbare Schließ- und Öffnungszeit.
- Mitglied wird standardmäßig gesperrt; Administrator kann pro Kanal optional einbezogen werden.
- Optional werden Thread-Erstellung und Schreiben in Threads ebenfalls gesperrt.
- Lesen und Reagieren bleiben während der Nachtruhe möglich.
- Beitritt und Regelbestätigung/Freischaltung bleiben jederzeit möglich.
- Konfigurierbare Nachtruhe- und Guten-Morgen-Nachricht je Kanal.
- Exakter Snapshot vorhandener Rollen-Overwrites vor dem Schließen und vollständige Wiederherstellung beim Öffnen.
- Persistente Konfiguration und aktive Snapshots im discord-data-Volume.
- Europe/Berlin als Standard-Zeitzone mit automatischer Sommer-/Winterzeit.
- Minütliche Prüfung sowie automatischer Zustandsabgleich nach Container-Neustart.
- Manuelle Aktionen Jetzt schließen, Jetzt öffnen und Automatik fortsetzen.
- Ereignisprotokoll im Control Center und optional zusätzliche Meldung im Discord-Logkanal.
- Neue Rechte discord.channel-times.view und discord.channel-times.edit.

## 6.3.7

**UI-Fix: neutraler Veröffentlichungsdialog**

- Der bisher nur für Löschaktionen ausgelegte Bestätigungsdialog wurde verallgemeinert.
- Nachträglich veröffentlichen zeigt jetzt den Titel Nachträgliche Veröffentlichung bestätigen.
- Die Buttons lauten bei der Nachveröffentlichung ABBRECHEN und VERÖFFENTLICHEN statt NEIN und JA.
- Der Veröffentlichungsbutton ist nicht mehr als rote Lösch-/Gefahrenaktion gestaltet.
- Der Text nennt je nach Eintrag Instagram oder TikTok korrekt.
- Echte Löschaktionen behalten weiterhin den roten Löschdialog.
- Demo senden bleibt eine direkte Owner-Aktion ohne unnötige Bestätigungsabfrage.

## 6.3.6

**Instagram Token Auto-Refresh + Social-Nachveröffentlichung**

- Instagram Long-Lived Access Token kann Owner-seitig direkt im Control Center eingetragen und ersetzt werden.
- Persistenter Instagram-Token hat Vorrang vor einem älteren Deployment-/Environment-Token und überlebt Container-Neustarts sowie Updates.
- Automatische Instagram-Token-Erneuerung alle 30 Tage über graph.instagram.com/refresh_access_token.
- Fälligkeitsprüfung täglich und beim Start des Discord-Containers.
- 24-Stunden-Mindestalter eines Long-Lived Tokens wird auch beim manuellen Refresh erzwungen.
- Nach erfolgreichem Refresh werden neuer access_token und expires_in-basiertes Ablaufdatum sofort persistent gespeichert und verwendet.
- Status zeigt Ablaufdatum, Restlaufzeit, letzte erfolgreiche Erneuerung, nächsten Versuch und letzten Fehler.
- Begrenzter Retry bei vorübergehenden Fehlern mit zunehmenden Abständen; parallele Refresh-Aufrufe werden verhindert.
- Abgelaufene, widerrufene oder ungültige Tokens werden als Erneute Autorisierung erforderlich markiert.
- Tokens werden niemals an das Frontend zurückgegeben oder in Audit-Einträgen gespeichert.
- Instagram und TikTok unterstützen beide Nachträglich veröffentlichen und Demo senden für bereits erkannte Beiträge.
- Instagram- und TikTok-Veröffentlichungslisten sind nun ausdrücklich nach Veröffentlichungszeit sortiert: neuester Beitrag zuerst.

## 6.3.5

**TikTok-Reels nachträglich veröffentlichen und als Demo senden**

- Bereits erkannte TikTok-Reels können nachträglich manuell an Discord veröffentlicht werden.
- Neue Aktion Demo senden verschickt ein bestehendes echtes TikTok erneut an Discord, ohne den Dedup-/Baseline-Status zu verändern.
- Nachträgliche Veröffentlichung ist für Baseline- und Fehler-Einträge verfügbar und markiert den Eintrag anschließend als versendet.
- Caption, Original-Link und Thumbnail werden bei manuellen Demo-/Nachveröffentlichungen wie bei automatischen Veröffentlichungen verwendet.
- Funktionen stehen unter Social Media → TikTok und Social Media → Veröffentlichungen bereit.
- Manuelle Demo-/Nachveröffentlichungen sind Owner-only und werden im Audit-Protokoll erfasst.

## 6.3.4

**Hotfix: TikTok Profil-Scopes**

- TikTok-Profilabfrage auf open_id, display_name und avatar_url beschränkt.
- profile_deep_link entfernt, da dieses Feld inzwischen user.info.profile benötigt.
- Die Anwendung bleibt bewusst bei user.info.basic und video.list und fordert keine zusätzlichen TikTok-Berechtigungen an.
- Datenschutzentwurf, technische Prüfung und SOCIAL-MEDIA-SETUP.md an die tatsächlich abgerufenen Profilfelder angepasst.

## 6.3.3

**Hotfix: TikTok OAuth-State**

- Discord-Service importiert das Node.js-crypto-Modul jetzt explizit.
- Behebt den Fehler `crypto.randomBytes is not a function` beim Start der TikTok-Autorisierung.
- Der 32-Byte-OAuth-State wird weiterhin kryptografisch sicher mit Node.js `crypto.randomBytes` erzeugt.

## 6.3.2

**Zentrale Stammdaten für öffentliche Webseiten**

- Neuer Tab Stammdaten unter Administration → Öffentliche Webseiten.
- Betreibername, Anschrift, Kontakt, Vertretung, Datenschutzkontakt, TikTok-Rechtsgrundlage und Aufbewahrungs-/Löschregeln werden zentral gepflegt.
- Zusätzliche zentrale Variable für weitere Impressumsangaben.
- Variablen wie [[BETREIBER_NAME]] bleiben in den Seitentexten erhalten und werden in Vorschau und Veröffentlichung automatisch ersetzt.
- Fehlende benötigte Stammdaten blockieren die Veröffentlichung und verweisen direkt auf den Stammdaten-Tab.
- Geschützte Vorschauen verwenden die aktuellen Stammdaten.
- Beim Veröffentlichen wird eine aufgelöste Momentaufnahme gespeichert; spätere Stammdatenänderungen verändern bereits veröffentlichte Seiten nicht.
- Änderungen der Stammdaten werden mit Owner und Zeitpunkt intern protokolliert und über das bestehende Public-Pages-Backup gesichert.

## 6.3.1

**TikTok Login Kit, öffentliche Prüfseiten und Social-Navigation**

- Dritter Social-Plattformschalter entfernt; Navigation bleibt bei Twitch und Discord.
- Social Media ist ausschließlich für Owner sichtbar und erscheint als identischer Menübereich in Twitch und Discord.
- Administration → Öffentliche Webseiten ist ausschließlich für Owner verfügbar.
- Öffentliche Seiten /app, /terms, /privacy und /imprint mit getrennten Entwurfs- und Veröffentlichungsfassungen.
- Entwurfsänderungen verändern eine veröffentlichte Fassung erst nach erneutem Veröffentlichen.
- Geschützte Owner-Vorschau und explizite Warnung vor öffentlicher Veröffentlichung.
- Sicherer eingeschränkter Editor für Überschriften, Absätze, Listen und Links; kein ausführbares HTML oder JavaScript.
- Offene Pflichtplatzhalter blockieren die Veröffentlichung von Terms, Privacy und Impressum.
- Öffentliche Seiten enthalten noindex/nofollow und eine restriktive Content Security Policy; keine Tracker.
- Eng begrenzte TikTok-Verifizierungsdatei: genau eine statische .txt-Datei, maximal 10 KB.
- Öffentliche Webseiten inklusive Entwürfen, Publikationsfassungen, Verifizierungsdatei und Historie in Backup/Restore integriert.
- Vollständiger TikTok Login-Kit-OAuth-Flow für user.info.basic und video.list.
- Kryptografischer, einmaliger OAuth-State mit 10 Minuten Laufzeit und Bindung an die feste Redirect URI.
- Autorisierungscode wird ausschließlich serverseitig gegen Access-/Refresh-Token getauscht.
- Redirect URI wird ausschließlich aus PUBLIC_BASE_URL abgeleitet; ungeprüfte Request-Header werden nicht verwendet.
- TikTok zeigt verbundenen Account, tatsächlich gewährte Scopes, Tokenablauf und Sandbox/Production-Modus.
- TikTok Disconnect versucht Token-Revoke und entfernt lokal verwaltete Zugangstokens.
- Separate Funktion zum Löschen lokaler TikTok-Dedup-/Verlaufsdaten; bestehende Discord-Nachrichten bleiben bewusst erhalten.
- Technische Datenschutzhinweise an die tatsächlich implementierte Datenverarbeitung angepasst.
- Owner-Hilfe enthält kopierbare Website-, Terms-, Privacy-, Impressum- und Redirect-URLs sowie englische Review-Beschreibung und Demo-Video-Ablauf.

## 6.3.0

**Social Media Syndication – Instagram & TikTok → Discord**

- Neuer dritter Plattformbereich Social im Control Center.
- Social-Navigation mit Übersicht, Instagram, TikTok, Veröffentlichungen und Einstellungen.
- Instagram und TikTok bleiben Quellsysteme; das Control Center veröffentlicht nicht auf den Plattformen.
- Neue Veröffentlichungen werden automatisch erkannt und nach #instagram bzw. #tiktok gesendet.
- Persistenter Dedup-Speicher verhindert doppelte Discord-Veröffentlichungen nach Neustarts.
- Beim ersten erfolgreichen Abruf wird nur eine Baseline gesetzt – kein Backfill alter Beiträge.
- Discord-Ausgabe mit Caption, Original-Link, Embed und optionalem Thumbnail.
- Thumbnails werden auf Wunsch als Discord-Anhang hochgeladen, sodass kurzlebige Quell-URLs die Darstellung nicht später zerstören.
- Gemeinsame Veröffentlichungshistorie mit Plattform, Typ, Zeit, Discord-Status und Fehler.
- Fehlgeschlagene Auslieferungen können im Control Center erneut versucht werden.
- Manueller Jetzt-prüfen-Abruf und Testmeldungen pro Plattform.
- Konfigurierbares Poll-Intervall zwischen 5 und 120 Minuten.
- TikTok unterstützt optional die automatische Erneuerung des User Access Tokens per Refresh Token.
- API-Tokens und Client-Secrets bleiben ausschließlich serverseitig und werden nie an das Frontend ausgeliefert.
- Neue Social-Media-Capabilities für Übersicht, Instagram, TikTok, Veröffentlichungen und Einstellungen.

## 6.2.2

**Hotfix: Mitglied-Rolle bleibt nach Regelbestätigung erhalten**

- Kritische Race Condition zwischen MESSAGE_REACTION_ADD und GUILD_MEMBER_UPDATE behoben.
- Die gültige 👍-Bestätigung wird jetzt dauerhaft gespeichert, bevor die Mitglied-Rolle vergeben wird.
- Der Zugangsschutz entfernt Mitglied niemals bei einem bereits verifizierten Mitglied.
- Onboarding-Einträge werden in-place aktualisiert; parallele Event-Handler können sich nicht mehr durch Objekt-Ersatz gegenseitig überschreiben.
- joined_at wird zeitbasiert verglichen, damit Formatunterschiede keine fälschliche Rejoin-Erkennung und keinen Status-Reset auslösen.
- Nach erfolgreicher Bestätigung prüft der Bot nach 1,5 und 5 Sekunden, ob Mitglied weiterhin vorhanden ist, und repariert eine unmittelbar fehlende Rolle.
- Eindeutig erkennbare Alt-Fälle der bisherigen Race Condition werden beim Botstart automatisch repariert.
- Rejoins bleiben geschützt: ein tatsächlich neuer Beitritt übernimmt keine alte Regelbestätigung.
- Discord → Mitglieder zeigt jetzt Regeln bestätigt inklusive Zeitpunkt bzw. Regelbestätigung ausstehend.

## 6.2.1

**Ticket Center – Einstellungen als eigener Tab**

- Discord → Meldungen nutzt jetzt vier klare Tabs: Eingang / Offen, Erledigt, Abgewiesen und Einstellungen.
- Der bisherige aufklappbare Block Meldesystem einrichten wurde aus den Ticketansichten entfernt.
- Button-Kanal, #log, Cooldown, Attachment-Archivierung, Button-Text und Logoptionen befinden sich vollständig im Tab Einstellungen.
- Die bisherigen großen Statistik-Karten als zweite Navigation wurden entfernt.
- Ticketanzahlen werden kompakt direkt in den Status-Tabs angezeigt.
- Ticketansichten enthalten nur noch Suche, Ticketliste und Seitensteuerung.
- Mobile Darstellung der Ticket-Tabs wurde kompakter gestaltet.

## 6.2.0

**Discord Ticket Center / Meldesystem**

- Neuer eigenständiger Discord-Navigationsbereich Meldungen.
- Persistente Ticketnummern im Format D-JJJJ-0001 mit Status Eingang/Offen, Erledigt und Abgewiesen.
- Meldewege über Apps → Nachricht melden, Apps → User melden, /melden und einen veröffentlichbaren Melden-Button.
- Gemeldete Nachrichten werden mit Text, Autor, Kanal, Message-ID und Attachments als Ticketkopie gespeichert.
- Bilder und Attachments können lokal im discord-data-Volume archiviert werden.
- Nachrichtenlöschung, individuelle Verwarnung per DM, frei wählbare Timeouts und Bans direkt aus dem Ticket.
- Vollständige Ticket-Historie mit Bearbeiter und Zeitpunkt.
- Abgewiesene Tickets benötigen eine Begründung; geschlossene Tickets können wieder geöffnet werden.
- Neue Tickets werden mit Ticketnummer und Grund in #log gemeldet; Folgeereignisse sind separat abschaltbar.
- Cooldown und Duplicate-Schutz gegen Meldespam.
- Neue Rechte discord.reports.view und discord.reports.edit; Administrator/Moderator erhalten bei Discord-Login Basiszugriff.
- Discord-Wortfilter reagieren explizit unabhängig von Groß-/Kleinschreibung und Unicode-Schreibweise.

## 6.1.0

**Twitch-/Discord-Plattformnavigation & Darstellung**

- Neuer Twitch-/Discord-Umschalter oben in der bestehenden linken Navigation mit dezent hinterlegten Icons.
- Die zweite Discord-Seitenleiste aus V6.0 wurde entfernt; die volle Inhaltsbreite steht wieder zur Verfügung.
- Twitch und Discord verwenden dieselbe Navigationslogik mit Hauptgruppen und oberen Untertabs.
- Discord Übersicht heißt nun Dashboard.
- Discord: Dashboard, Server, Community, Sicherheit, Auswertung, Administration, Hilfe.
- Twitch: Dashboard, Automatisierung, Community, Live-Betrieb, Moderation, Gewinnspiel, Auswertung, Administration, Hilfe.
- Der zuletzt geöffnete Bereich wird getrennt für Twitch und Discord gespeichert.
- Statistiken und Activity Board richten sich automatisch nach der gewählten Plattform; der zusätzliche Plattformschalter innerhalb der Auswertung entfällt.
- Neue Discord-Rechte discord.statistics.view und discord.activity.view für die Discord-Auswertung.
- Hell / Dunkel / System wurde in das Usermenü integriert; System folgt automatisch der Betriebssystemdarstellung.
- Globale Typografie wurde etwas verkleinert und bleibt bewusst zwischen der früheren kompakten und der zuletzt zu großen Darstellung.
- Sidebar-Icons erhalten eine dezente hinterlegte Fläche.

## 6.0.0

**Discord-Neustrukturierung & timeoutbasierte Sanktionen**

- Hauptnavigation neu sortiert: Discord → Auswertung → Administration → Hilfe.
- Discord hat eine eigene linke Unter-Navigation mit Übersicht, Server, Community und Sicherheit.
- Discord-Moderation ist in Übersicht, Regeln, Link-Whitelist, Sanktionen sowie Protokoll & Test aufgeteilt.
- Globale Schriftgröße wurde gegenüber V5.15 reduziert, bleibt aber größer als vor der letzten Typografie-Anhebung.
- Administrator und Moderator sind automatisch von der Link-Whitelist ausgenommen.
- Einzelne gelöschte Verstöße erhalten nur noch einen freundlichen, bestimmten Hinweis; keine vorzeitige Timeout-Stufenansage.
- Eskalation erfolgt jetzt nach tatsächlich ausgesprochenen Timeouts: 1. Timeout, 2. Timeout, 3. Timeout mit Ban-Hinweis, nächste Eskalation = Ban.
- Nach einem Timeout wird der aktuelle Verstoßzähler zurückgesetzt; die Timeout-Stufe bleibt persistent.
- Sanktionsübersicht zeigt aktuelle Verstöße bis zur nächsten Stufe, Timeout-Stufe und gesamte Timeout-Anzahl.
- Discord-Logmeldungen für Einzelverstöße, Timeouts und Bans können separat ein- oder ausgeschaltet werden.
- Timeouts und Bans werden weiterhin im internen Moderationsprotokoll gespeichert, unabhängig von der Discord-Loganzeige.

## 5.15.0

**Verwarnstufen, Timeout-Historie & automatische Bans**

- Persistente Verwarnstufe pro Discord-User: 1. freundlich, 2. energischer, 3. eindringlich mit Ban-Hinweis, 4. automatischer Ban.
- Die drei Verwarntexte und der Ban-Grund sind im Control Center konfigurierbar.
- Link- sowie Wort-/Phrasenverstöße zählen gemeinsam zur Verwarnstufe.
- Timeouts werden pro User gezählt und mit Zeitpunkt gespeichert.
- Neue Liste Verwarnte User mit Verwarnstufe, Timeout-Anzahl und letztem Verstoß.
- Neue Liste Gebannte User basiert auf der echten Discord-Banliste.
- Moderatoren mit Discord-Moderation-Bearbeiten sowie Owner/Admins können Verwarnungen zurücksetzen und Bans aufheben.
- Beim Aufheben eines Bans werden Verwarnstufe und Timeout-Zähler auf 0 gesetzt.
- Bot-Berechtigungsprüfung wurde um Mitglieder bannen erweitert.

## 5.14.3

**Globale Moderationsmaßnahmen & UI-Aufräumung**

- Nachricht löschen, User warnen, Timeout-Schwelle, Zeitfenster und Timeout-Dauer sind jetzt globale Einstellungen.
- Die globalen Maßnahmen gelten für Linkverstöße sowie alle Wort- und Phrasenregeln.
- Link- und Wortverstöße zählen gemeinsam für die Timeout-Schwelle.
- Einzelne Regeln enthalten nur noch Trefferbedingungen und Ausnahmen.
- Die Moderationsseite ist klarer gegliedert und weniger überladen.
- Die abweichende Monospace-Schrift der Link-Whitelist wurde entfernt; Eingaben, Selects, Textareas und Buttons verwenden explizit die gleiche Systemschrift.
- Bestehende Regelwerte werden als Ausgangswert für die neue globale Konfiguration übernommen, sofern noch keine globalen Werte existieren.

## 5.14.2

**Separate Discord-Link-Whitelist**

- Links werden getrennt von Wort-/Phrasenregeln moderiert.
- Zentrale Link-Whitelist mit getrennten Feldern für erlaubte Domains und spezifische Links.
- Domain-Freigaben gelten für alle Pfade und Unterdomains.
- Spezifische Link-Freigaben gelten nur für den angegebenen Host + Pfad; Query-Parameter und Anker werden ignoriert.
- Nicht freigegebene Links können gelöscht und mit einem separaten Warntext beantwortet werden.
- Dry-Run zeigt erlaubte und blockierte Links getrennt.
- Wort-/Phrasenregeln enthalten keine Link-Freigaben mehr.

## 5.14.1

**Navigation korrigiert**

- Die tatsächlich gerenderte linke Menüleiste wurde korrigiert.
- Discord steht nun vor Administration/Hilfe.
- Auswertung ist jetzt der letzte Hauptbereich in der linken Navigation.
- Der Fehler entstand, weil in V5.14.0 nur die JavaScript-Gruppenreihenfolge geändert wurde, die Sidebar in index.html aber weiterhin fest in der alten Reihenfolge stand.

## 5.14.0

**Discord-Moderation & Stabsraum**

- Neuer Discord-Bereich Moderation mit Ansehen-/Bearbeiten-Capabilities.
- Regelbasierte Filter mit Teiltreffer oder Ganzwort/Phrase, erlaubten Wörtern/Links sowie Rollen- und Kanal-Ausnahmen.
- Aktionen: Nachricht löschen, optionale Warnung und optionaler Timeout nach wiederholten Verstößen.
- Dry-Run/Filtertest ohne Discord-Aktion und Moderationslog ohne vollständigen Chatverlauf.
- Discord AutoMod bleibt erste Schutzschicht; AutoMod-Ausführungen werden zur Vermeidung doppelter Aktionen berücksichtigt.
- Discord-Statistik verwendet das Moderationsprotokoll für Verstöße.
- Interner Team-Kanal ist als Kanal bekannt.
- Navigation: Discord steht vor Auswertung; Auswertung ist die letzte Hauptgruppe.

## 5.13.0

**Login-Protokoll & getrennte Twitch-/Discord-Auswertung**

- Login-Ereignisse wurden aus dem Activity Board entfernt und als Administration → Login-Protokoll nur für Owner/Admin umgesetzt.
- Login-Protokoll zeigt Uhrzeit, Plattform, Username/User-ID, Ergebnis, Grund, Gesamtzahl und Dateigröße.
- Keine automatische Löschung; Einträge älter als 30 Tage können manuell gelöscht werden.
- Historische Login-Ereignisse aus audit.jsonl werden einmalig in auth-log.jsonl übernommen.
- Activity Board ist in Twitch und Discord getrennt.
- Statistiken sind in Twitch und Discord getrennt.
- Discord-Statistiken zeigen Mitglieder, Verstöße und geteilte Inhalte für 7 Tage, 30 Tage und insgesamt sowie eine Tagesliste.
- Discord-Mitgliederstände werden als Tages-Snapshots gespeichert; geteilte Inhalte basieren auf erfolgreich zugestellten Discord-Ankündigungen.
- Discord-Verstöße sind vorbereitet und werden aus Discord-Moderationsereignissen gezählt, sobald diese Funktion aktiv ist.

## 5.12.1

**Account-Menü & Discord-Verknüpfung lösen**

- Neues Account-Dropdown oben rechts zeigt verknüpfte Twitch- und Discord-Identitäten sowie Abmelden.
- Benutzer können ihre eigene Discord-Verknüpfung nach Bestätigung selbst aufheben.
- Owner/Administratoren können Discord-Verknüpfungen direkt unter Administration → Benutzer & Zugriffe aufheben.
- Das Aufheben einer Backend-Verknüpfung verändert keine Discord-Serverrollen wie Mitglied, Administrator oder Moderator.
- Alle aktiven Discord-Login-Sessions der getrennten Discord-ID werden serverseitig invalidiert.
- Wird die aktuell verwendete Discord-Login-Identität getrennt, wird die aktuelle Sitzung sofort beendet.
- Twitch-basierte Sitzungen bleiben beim Trennen einer zusätzlich verknüpften Discord-Identität aktiv.

## 5.12.0

**Rechteverwaltung – Ansehen / Bearbeiten**

- Berechtigungen werden pro Unterseite in Ansehen und Bearbeiten getrennt.
- Rechtegruppen wie Community, Automatisierung, Live-Betrieb, Moderation, Auswertung und Discord sind innerhalb jedes Benutzers einklappbar.
- Bearbeiten aktiviert automatisch Ansehen; wird Ansehen entfernt, wird Bearbeiten ebenfalls entfernt.
- Reine Ansichtsseiten wie Followage, Statistiken und Activity Board besitzen bewusst keine Bearbeiten-Checkbox.
- Discord-Mitglieder behält zusätzliche Aktionsrechte für Mitglied entziehen/vergeben.
- Alte V5.11-Capabilities werden beim Laden automatisch in passende View/Edit-Rechte migriert.
- GET- und Schreibzugriffe werden serverseitig getrennt auf View- bzw. Edit-Capabilities geprüft.

## 5.11.3

**UI-Capability-Fix**

- Followage prüft im Frontend nun twitch.followage statt die alte Editor-Rolle.
- Watchtime und Event-Profile wurden ebenfalls auf die jeweiligen individuellen Capabilities umgestellt.
- Gewinnspiel und Team verwenden ihre eigenen Capabilities für Bearbeitungsrechte.
- Die alte globale Editor-Sperre im Frontend wurde entfernt, damit individuell freigegebene Bereiche nicht nachträglich deaktiviert werden.
- Die Sicherheit bleibt serverseitig Default-Deny; ausgeblendete UI ist nicht die Sicherheitsgrenze.

## 5.11.2

**Capability-Fix & Globalstatus**

- Followage respektiert nun die individuelle Capability twitch.followage statt zusätzlich die alte Editor-Rolle zu verlangen.
- Watchtime, Clips, Event-Profile, Gewinnspiel, Stubenkontrolle und Chat-Test wurden von verbliebenen Legacy-Rollenprüfungen auf Capabilities umgestellt.
- Die serverseitige Default-Deny-Prüfung bleibt bestehen.
- Das missverständliche Grundstatus speichern wurde entfernt; Einzelrechte werden nur über Berechtigungen gespeichert.
- Nur Owner sehen optional Globalstatus speichern für Standardbenutzer, globalen Administrator oder globalen Owner.

## 5.11.1

**Twitch-Mod-Erfassung & einklappbare Benutzer**

- Erfolgreich eingeloggte Twitch-Moderatoren werden beim ersten Login automatisch als interner Benutzer gespeichert.
- Automatisch erfasste Twitch-Mods starten weiterhin ausschließlich mit der Capability Twitch-Dashboard und bleiben damit Default-Deny für alle weiteren Bereiche.
- Owner/Admin können danach unter Administration → Benutzer & Zugriffe unmittelbar individuelle Rechte für den Moderator vergeben.
- Benutzerkarten sind nun ein- und ausklappbar; der Zustand wird lokal im Browser gespeichert.
- Bereits vorhandene manuell angelegte Benutzer werden beim Moderator-Login nicht überschrieben; Name/Login werden lediglich aktualisiert.

## 5.11.0

**Benutzer & Zugriffe / Capability-RBAC**

- Zentrale Administration → Benutzer & Zugriffe führt Twitch- und Discord-Identitäten eines internen Benutzers gemeinsam auf.
- Individuelle Bereichsfreigaben pro Benutzer eingeführt; nicht ausdrücklich freigegebene Bereiche sind serverseitig Default-Deny.
- Twitch-Mods dürfen sich immer anmelden und sehen standardmäßig ausschließlich das Twitch-Dashboard.
- Discord-Administrator allein erhält keinen Backend-Zugang; seine verifizierte Discord-Identität wird dennoch gespeichert, damit Owner/Admin gezielt Rechte vergeben können.
- Discord-Moderator darf sich standardmäßig anmelden und sieht ausschließlich das Discord-Dashboard, solange keine weiteren Bereiche freigegeben sind.
- Owner, globale Administratoren und lokaler Admin besitzen immer Vollzugriff.
- Settings werden serverseitig gefiltert und Schreibzugriffe nur für freigegebene Bereiche übernommen.
- Administrator kann mit eigener Capability Mitglied entziehen; Administrator selbst kann ausschließlich durch Owner/Admin verwaltet werden.
- Erfolgreiche Discord-Verknüpfung wird im Header als Discord ✓ sichtbar.
- Echte Twitch-Clips erhalten im Discord-Embed ein Vorschaubild aus thumbnail_url.

## 5.10.2

**Discord-Login – Persistenz- und Farbfix**

- Endlosrekursion in der Benutzerpersistenz behoben, die beim Discord-Login zu Maximum call stack size exceeded führte.
- Discord-Login-Button wird nun zuverlässig in Discord-Blau (#5865F2) dargestellt.
- OAuth-Fehlerseite und 10-Sekunden-Rückleitung aus V5.10.1 bleiben unverändert erhalten.

## 5.10.1

**Discord-Login – Fehlerseite & Redirect**

- Nicht freigegebene oder unverknüpfte Discord-Logins landen auf einer gestalteten Fehlerseite statt auf Plaintext.
- Automatischer Redirect nach 10 Sekunden zurück zur Login-Seite ergänzt.
- Direkter Button zur Login-Seite ergänzt.
- Discord-Login-Button verwendet jetzt Discord-Blau.
- Discord-OAuth-Fehlerseiten werden explizit als UTF-8 HTML ausgeliefert; Umlaute und Sonderzeichen werden korrekt dargestellt.

## 5.10.0

**Discord-Login & getrennte Backend-Rechte**

- Login-Seite um Mit Discord anmelden ergänzt; Discord OAuth nutzt identify und guilds.members.read.
- Discord Client Secret bleibt ausschließlich im separaten Discord-Dienst; das Control Center erhält nur verifizierte Identitäts- und Mitgliedsdaten.
- Twitch- und Discord-Berechtigungen werden serverseitig als getrennte Domains ausgewertet.
- Twitch-Moderatoren erhalten weiterhin keinen Discord-Backend-Zugang; Discord-Moderatoren erhalten keinen Twitch-Zugang.
- Globale Owner besitzen beide Domains und können Discord-Konten explizit mit ihrem bestehenden Konto verknüpfen.
- Discord → Mitglieder ergänzt Owner-only Backend erlauben/entziehen; Entzug wirkt sofort auch auf bestehende Sessions.
- Discord-Backend-Moderatoren können Übersicht, Kanäle, Rollen und Mitglieder lesen sowie Ankündigungen und Freischaltung bedienen.
- Rollenänderungen und das Anwenden von Kanal-Zugriffsrechten bleiben globalen Ownern vorbehalten.
- Sessions werden serverseitig nach 12 Stunden verworfen; unsichere Cross-Site-Schreibanfragen werden blockiert.
- Ankündigungstexte mit sichtbarem \\n werden beim Laden/Speichern automatisch zu echten Zeilenumbrüchen normalisiert.

## 5.9.0

**Twitch → Discord Ankündigungen**

- Neuer Bereich Discord → Ankündigungen für Twitch-Live- und Clip-Meldungen.
- EventSub stream.online löst eine persistente, deduplizierte Livemeldung in #twitch aus.
- Neue Twitch-Clips werden unabhängig vom Twitch-Chat-Sharing persistent an #clips weitergereicht.
- Bridge-Queue auf Twitch-Seite verhindert Verlust bei vorübergehend nicht erreichbarem Discord-Dienst.
- Discord speichert Stream- und Clip-IDs dauerhaft und verhindert Doppelmeldungen nach Reconnect/Neustart.
- Keine Clip-Rückbefüllung beim ersten Lauf; bestehender Clip-Bestand wird nur als bekannt markiert.
- Texte, Zielkanäle, Embeds und optionale erwähnbare Rolle sind im Dashboard konfigurierbar; @everyone/@here bleiben ausgeschlossen.

## 5.8.1

**Discord-Rollenverwaltung – Staff-Ausnahme**

- Administrator und Moderator werden als bewusst manuell vergebene Vertrauensrollen vom automatischen Mitglied-Bypass-Schutz ausgenommen.
- Das Vergeben von Administrator entfernt eine bereits vorhandene Mitglied-Rolle nicht mehr.
- Nach Entfernen der Vertrauensrolle greift der Regel-Gate-Schutz wieder, falls keine gültige Regelbestätigung gespeichert ist.
- Manuelle Mitglied-Vergabe an ein noch nicht bestätigtes, nicht vertrauensgestuftes Mitglied wird mit verständlicher Meldung blockiert.

## 5.8.0

**Discord-Mitgliederverwaltung**

- Neuer Bereich Discord → Mitglieder mit Suche nach Discord-ID, Benutzername und Anzeigename.
- Mitgliederansicht zeigt Anzeigename, Benutzername, stabile Discord-ID, Status und vorhandene Rollen.
- Administrator und Mitglied können durch globale Owner gezielt vergeben oder entfernt werden; andere Rollen bleiben serverseitig gesperrt.
- Vor jeder Rollenänderung werden Rollenposition und Managebarkeit erneut geprüft.
- Rollenänderungen werden anschließend live bei Discord verifiziert und im Activity Board sowie optional im Discord-Log protokolliert.
- Twitch-Moderatorstatus und Discord-Rollen bleiben vollständig getrennt.

## 5.7.7

**Discord-Freischaltung – Rollen-Race-Fix**

- Race Condition behoben, bei der die gerade vergebene Mitglied-Rolle durch den eigenen Bypass-Schutz sofort wieder entfernt wurde.
- Kurzlebiger verificationPending-Marker schützt das GUILD_MEMBER_UPDATE während der legitimen Rollenvergabe.
- Pending-Marker wird bei Fehler, erfolgreicher Freischaltung und erneutem Serverbeitritt sauber zurückgesetzt.
- Stale Pending-Marker laufen nach 30 Sekunden automatisch aus, damit kein dauerhafter Bypass entstehen kann.

## 5.7.6

**Discord-Zugriffsrechte – Hierarchie-Fix**

- Bot-Zugriff wird nicht mehr über die eigene gemanagte Integrationsrolle gesetzt.
- Bot-Schutz verwendet nun gezielte Member-Overwrites, wodurch die Rollen-Hierarchie der eigenen Bot-Rolle nicht verletzt wird.
- Discord API 403 Missing Access beim Bearbeiten der eigenen Bot-Rolle vermieden.
- Fehlermeldungen nennen nun exakt Zielkanal/-kategorie und Rolle/Mitglied, falls Discord einen einzelnen Overwrite ablehnt.
- Regeln bleiben sichtbar und read-only; Reaktionen bleiben ausdrücklich erlaubt.

## 5.7.5

**Discord-Zugriffsrechte – Missing-Access-Fix**

- Bot-Zugriff auf verwaltete Kategorien und Einstiegskanäle wird vor @everyone-Sperren explizit erhalten.
- Discord API 403 Missing Access beim Anwenden der Zugriffsvorlage behoben.
- Regelkanal ist für @everyone sichtbar und schreibgeschützt, erlaubt aber ausdrücklich Reaktionen und Nachrichtenverlauf.
- Thread-Erstellung und Schreiben in Threads werden im Regelkanal und Meldekopf explizit gesperrt.
- Meldekopf bleibt sichtbar, aber vollständig schreibgeschützt.

## 5.7.4

**Discord-Zugriffsrechte – HTTP-Methoden-Fix**

- Falschen discordApi-Aufruf beim Schreiben von Channel-Permissions korrigiert.
- Fehler '[object Object] is not a valid HTTP method' behoben.
- Permission-Overwrites werden nun korrekt per PUT mit JSON-Body an Discord gesendet.

## 5.7.3

**Discord-Zugriffsrechte – Bestätigungs-Fix**

- POST-Body der Zugriffsvorlage wird nun korrekt aus der HTTP-Anfrage gelesen.
- Fehler trotz korrekt eingegebenem BERECHTIGUNGEN behoben.
- Die Bestätigung wird unverändert an den Discord-Dienst weitergereicht.

## 5.7.2

**Discord-Zugriffsrechte – Manage-Channels-Fix**

- Fehlende BigInt-Konstante MANAGE_CHANNELS ergänzt.
- Fehler Cannot mix BigInt and other types in Discord → Zugriffsrechte vollständig behoben.
- Automatischer Konsistenztest prüft nun, ob alle verwendeten PERM-Konstanten auch definiert sind.

## 5.7.1

**Discord-Zugriffsrechte – BigInt-Fix**

- Fehlende Discord-Permission-Konstanten für Voice- und Thread-Rechte ergänzt.
- Fehler Cannot mix BigInt and other types im Bereich Discord → Zugriffsrechte behoben.
- Zugriffsrechte-Vorschau kann nun die geplanten Warteraum-, BwTalk- und Social-Media-Berechtigungen korrekt berechnen.

## 5.7.0

**Discord-Zugriffsrechte**

- Neuer Discord-Bereich Zugriffsrechte mit Live-Vorschau der Regel-Gate-Berechtigungen.
- Öffentliche Kategorien werden für @everyone ausgeblendet und erst über die Freischaltrolle freigegeben.
- Meldekopf und Regeln bleiben vor Freischaltung sichtbar und schreibgeschützt.
- SOCIAL MEDIA wird für Mitglied lesbar, aber schreibgeschützt vorbereitet.
- Warteraum wird betretbar, aber ohne Sprechen/Streaming vorbereitet; BwTalk bleibt für Mitglied unsichtbar.
- INTERN bleibt für @everyone und Mitglied gesperrt.
- Anwendung erfordert die Bestätigung BERECHTIGUNGEN und verändert nur gezielte Permission-Bits in @everyone-/Freischaltrollen-Overwrites.

## 5.6.1

**Discord-Freischaltung – Aktivierungs-Fix**

- Speichern der Freischalt-Konfiguration und Aktivieren/Deaktivieren technisch getrennt, damit kein zirkulärer Save/Publish/Enable-Ablauf mehr entsteht.
- Eigene Aktion Freischaltung aktivieren/deaktivieren ergänzt.
- Vor Aktivierung wird die gespeicherte Regelnachricht live bei Discord geprüft und die 👍-Reaktion idempotent sichergestellt.
- Aktivierungsfehler zeigen die konkrete Backend-Ursache statt eines allgemeinen bereit-Status.
- Technische Prüfung zeigt zusätzlich Nachrichtenverknüpfung und fehlende Botrechte für Meldekopf, Regelkanal und Logkanal.
- Regeltext, Kanäle und Log-Einstellungen können gespeichert werden, ohne den Aktivierungszustand unbeabsichtigt zu verändern.

## 5.6.0

**Discord-Reaktionsfreischaltung**

- Discord-Freischaltung auf eine zentrale Regelnachricht mit 👍-Bestätigung umgestellt.
- Meldekopf, Regelkanal, Freischaltrolle und interner Logkanal sind im Control Center auswählbar.
- Willkommensnachricht und Regeltext sind editierbar; {rules} verweist direkt auf den ausgewählten Regelkanal.
- Regelnachricht kann einmalig veröffentlicht und danach unter derselben gespeicherten Nachrichten-ID aktualisiert werden.
- Ausschließlich 👍 auf der hinterlegten Regelnachricht löst die Freischaltung aus; Reaktionsentzug nimmt die Rolle nicht zurück.
- Mehrfachereignisse werden persistent dedupliziert; nach Bot-Neustarts wird dieselbe Regelnachricht weiterverwendet.
- Bei erneutem Serverbeitritt ist eine neue Regelbestätigung erforderlich.
- Vorzeitig durch andere Automationen vergebene Freischaltrollen werden bei nach Aktivierung neu beigetretenen Mitgliedern wieder entfernt.
- Berechtigungs-, Rollenpositions- und Kanalzugriffsprüfung mit verständlichen Hinweisen ergänzt.
- Bestehende Mitglieder und Discord-Kanalrechte werden bei der Einrichtung nicht automatisch verändert.
- Native Discord Rules Screening wird als Konflikt angezeigt, da ausstehende Mitglieder dort nicht reagieren können.

## 5.5.0

**Discord-Onboarding**

- Native Discord-Regelannahme wird über den Member-pending-Status erkannt.
- Nach erfolgreicher Regelannahme kann automatisch die Rolle Mitglied vergeben werden.
- Einmalige Begrüßung im Meldekopf mit persistentem Duplikatschutz ergänzt.
- Offene Regelannahmen werden über Neustarts hinweg gespeichert und nach Wiederanlauf geprüft.
- Neue Discord-Seite Begrüßung mit Aktivierung, editierbarem Begrüßungstext und Testmeldung.
- Onboarding ist nach dem Update standardmäßig deaktiviert, damit Dyno während der Umstellung keine Doppelaktionen erzeugt.
- Discord-Logeintrag für erfolgreiche oder fehlgeschlagene Onboarding-Aktionen ergänzt.

## 5.4.0

**Discord-Grundintegration**

- Separaten Discord-Dienst in das gemeinsame Compose-Projekt aufgenommen.
- Discord-Bereich mit Übersicht, Kanalabgleich und Rollenabgleich ergänzt.
- Control Center liest den Discord-Status ausschließlich serverseitig über das interne Compose-Netz.
- Discord-Bereich in dieser ersten Ausbaustufe auf Owner und lokalen Admin begrenzt.
- Manuelle Live-Prüfung von Guild, Rollen, Kategorien, Kanälen und Berechtigungen ergänzt.
- Discord-Service bleibt unabhängig neu startbar; Tokens und Client Secret werden nicht an das Frontend ausgegeben.

## 5.3.2

**EventSub-Reconnect stabilisiert**

- Parallele EventSub-Reconnects verhindert.
- Twitch-session_reconnect gemäß Twitch-Ablauf umgestellt: alte Verbindung bleibt bis zum Welcome der neuen Verbindung offen.
- Bei Twitch-Reconnect werden bestehende Subscriptions übernommen und nicht doppelt neu angelegt.
- Normale Verbindungsabbrüche verwenden gestaffelte Wiederholungsintervalle statt einer festen Reconnect-Schleife.
- Keepalive-Überwachung ergänzt, damit hängende Verbindungen automatisch neu aufgebaut werden.
- Dashboard unterscheidet verbunden, verbindet, Twitch-Reconnect, Wartefenster und getrennt.
- Systemstatus um letzte Verbindung, letzte EventSub-Nachricht, Close-Code, Fehler und nächsten Reconnect erweitert.

## 5.3.1

**Stubenkontrolle – Chat und Meldungen bereinigt**

- Technische Runden-ID aus den öffentlichen Chat- und Overlay-Sprüchen entfernt.
- Runden-ID bleibt intern für Historie, Buchungen und Erstattungen vollständig erhalten.
- Auch bereits gespeicherte Sprüche mit {round} werden vor der öffentlichen Ausgabe bereinigt.
- Browser-Popups der Stubenkontrolle durch dezente, nicht blockierende Statusmeldungen ersetzt.
- Erfolgs-, Warn- und Fehlermeldungen der Spielverwaltung optisch vereinheitlicht.

## 5.3.0

**Stubenkontrolle und Punkte**

- Neues Twitch-Minispiel Stubenkontrolle mit persistenter Spielwährung Punkte ergänzt.
- Commands !stube, !punkte, !daily, !give, !topspind und !stubenhilfe ergänzt.
- Konfigurierbare Einsätze, Anmeldezeit, Rundenpause, Gewinnfaktor und Wahrscheinlichkeiten ergänzt.
- Punktekonten anhand stabiler Twitch-User-IDs, atomare Übertragungen und Buchungshistorie umgesetzt.
- Admin-Gutschriften, einmalige Runden-/Teilnehmer-Erstattungen und Gesamtreset mit RESET-Bestätigung ergänzt.
- Vor einem Gesamtreset wird automatisch eine lokale Punkte-Sicherung erstellt; Startguthaben- und Daily-Historie bleiben erhalten.
- Laufende Runden werden bei technischem Bot-Neustart automatisch abgebrochen und reservierte Einsätze zurückgegeben.
- Lokales OBS-Overlay mit lesendem WSS-Zugang, automatischer Wiederverbindung, Vollsynchronisierung und Countdown ergänzt.
- Stubenkontrolle-Daten in Backup / Restore integriert.
- Eigene Spielverwaltung mit Kontensuche, Rundenhistorie, Overlay-Tests und Verbindungsstatus ergänzt.

## 5.2.0

**Follow-Nachrichten und Dark-Mode-Korrektur**

- Weißen Tabellenkopf der Auto-Replies im Dark Mode korrigiert.
- Follow-Bereich um eine frei pflegbare Liste mehrerer Nachrichten erweitert.
- Follow-Nachrichten werden der Reihe nach abwechselnd verwendet.
- Follow-Nachrichten können direkt in der Community-Verwaltung hinzugefügt, bearbeitet und gelöscht werden.
- Bestehende einzelne Follow-Nachricht wird beim Update automatisch als erster Listeneintrag übernommen.

## 5.1.0

**Team-Seite und Team-Commands**

- Eigenen Team-Bereich unter Community ergänzt.
- Benutzerprofile angelegt.
- Dienstgrad, Dienstbeginn, Stream-Rolle und optionaler Insider/Humor pro Teammitglied editierbar gemacht.
- !team und persönliche Team-Commands werden automatisch aus den Profilen erzeugt; leere Felder werden ausgelassen.
- Aliase für Team-Commands unterstützt.
- Team-Timer mit 30 Minuten und mindestens 15 Chatzeilen integriert und über die Team-Seite konfigurierbar gemacht.
- Chat-Vorschau für !team, persönliche Commands und Timer-Nachricht ergänzt.

## 5.0.1

**Bot-Neustart im Systemstatus**

- Owner und lokalen Admin um eine Neustart-Funktion im Systemstatus ergänzt.
- Neustart beendet den Node-Prozess kontrolliert; Docker übernimmt den automatischen Container-Neustart.
- Control Center prüft nach dem Neustart automatisch, wann das Backend wieder erreichbar ist.
- Neustart-Anforderungen werden im Activity Board protokolliert.

## 5.0.0

**Neue Navigation und Bedienstruktur**

- Hauptnavigation in eine logisch gruppierte linke Seitenleiste umgebaut.
- Sidebar auf Desktop und Tablet einklappbar gemacht; kompakte Icon-Ansicht mit Tooltips ergänzt.
- Smartphone-Navigation als Off-Canvas-Menü mit Menü-Schaltfläche umgesetzt.
- Unterbereiche als Tabs oberhalb des Inhalts angeordnet.
- Sidebar-Zustand und zuletzt geöffneter Bereich werden lokal im Browser gespeichert.
- Rollenabhängige Sichtbarkeit der Administrationsbereiche beibehalten.
- Twitch-Moderatoren und Broadcaster/Owner von Command-Cooldowns ausgenommen.

## 4.12.3

**Followage-Übersicht bereinigt**

- Karte für aktuelle Anzeige/Seite aus der Followage-Übersicht entfernt.
- Übersicht auf Follower gesamt, Letzter Follow und Sortierung reduziert.

## 4.12.2

**Letzter Follow wieder sichtbar**

- Übersichtskarte für den letzten Follow in der Followage-Ansicht wiederhergestellt.
- Letzter Follow bleibt unabhängig von der gewählten Sortierung sichtbar.
- Sortierstatus als eigene Übersichtskarte beibehalten.

## 4.12.1

**Followage-Sortierung**

- Followage-Liste um Sortierung nach Followage aufsteigend und absteigend ergänzt.
- Sortierung nach Twitch-Name A–Z und Z–A ergänzt.
- Komplette Follower-Liste für globale Sortierung in einem 15-Minuten-Cache zusammengeführt.
- Seitennavigation auf numerische Seiten umgestellt.
- Schaltfläche zum manuellen Aktualisieren des Follower-Caches ergänzt.

## 4.12.0

**Followage-Liste**

- Eigenen Followage-Bereich für Editor und höhere Rollen ergänzt.
- Follower direkt über die Twitch API mit bis zu 100 Einträgen pro Seite geladen.
- Seitennavigation über Twitch-Cursor ergänzt.
- Follow-Datum und berechnete Followage pro Nutzer angezeigt.
- Suche nach exaktem Twitch-Login ergänzt.
- Gesamtzahl der Follower und aktuelle Seiteninformationen ergänzt.

## 4.11.1

**Command-Bearbeitung und Event-Profile**

- Bearbeitung älterer Commands mit numerischen IDs korrigiert.
- Command-Sortierung für ältere und neue IDs vereinheitlicht.
- Event-Profile direkt im Control Center mit einer kurzen Schritt-für-Schritt-Erklärung ergänzt.
- Bezeichnung zum Aktualisieren eines bestehenden Profilstands verständlicher formuliert.

## 4.11.0

**Event-Profile**

- Eigenen Bereich Event-Profile für Editor und höhere Rollen ergänzt.
- Aktiv-Status und Bot-Zuordnung von Commands, Timern, Auto-Replies und Begrüßungen in Profilen speicherbar gemacht.
- Follow, Raid, !followage und !watchtime in Event-Profile aufgenommen.
- Profile mit einem Klick aktivierbar gemacht, ohne Antworttexte, Cooldowns oder andere Inhalte zu überschreiben.
- Vorhandene Profile mit dem aktuell gespeicherten Stand aktualisierbar gemacht.
- Aktives Profil und Profiländerungen im Control Center sichtbar gemacht.
- Event-Profile in Backup / Restore aufgenommen.
- Anlegen, Aktualisieren, Aktivieren und Löschen von Profilen im Activity Board protokolliert.

## 4.10.0

**Backup und Restore**

- Owner-only Bereich Backup / Restore ergänzt; der lokale Admin hat ebenfalls Zugriff.
- Einstellungen, Benutzer/Rollen, Gewinnspiele, Watchtime, Nutzungsstatistiken und Clip-Status einzeln auswählbar gemacht.
- Backups als lesbare JSON-Datei exportierbar gemacht.
- Backup-Dateien vor dem Restore serverseitig geprüft und zusammengefasst.
- Beim Restore auswählbare Bereiche gezielt ersetzt, ohne andere Daten anzutasten.
- OAuth-Tokens, Refresh-Tokens, App Access Token, Login-Sessions und lokales Admin-Passwort grundsätzlich vom Backup ausgeschlossen.
- Backup-Exporte, erfolgreiche Restores und Restore-Fehler im Activity Board protokolliert.

## 4.9.0

**Command- und Auto-Reply-Statistiken**

- Eigenen Bereich Statistiken für Commands und Auto-Replies ergänzt.
- Auslösungen für heute, den aktuellen Stream und gesamt erfasst.
- Zeitpunkt und auslösenden Nutzer der letzten Verwendung gespeichert.
- Aktuellen Stream anhand der Twitch Stream-ID getrennt erfasst.
- Statistiken dauerhaft in usage-stats.json gespeichert.
- Übersicht nach Gesamtverwendungen sortiert und Top-Einträge direkt sichtbar gemacht.

## 4.8.0

**Watchtime-Verwaltung**

- Eigenen Bereich Watchtime für Editor und höhere Rollen ergänzt.
- Watchtime-Daten nach Twitch-Name, Login oder User-ID durchsuchbar gemacht.
- Serverseitige Seitennavigation mit maximal 100 Einträgen pro Seite ergänzt.
- Sortierung nach höchster/niedrigster Watchtime, Name oder letztem Kontakt ergänzt.
- Watchtime einzelner Nutzer manuell korrigierbar und auf 0 zurücksetzbar gemacht.
- Watchtime-Korrekturen und Resets im Activity Board protokolliert.
- Übersicht mit Nutzerzahl, kumulierter Watchtime und letzter Aktualisierung ergänzt.

## 4.7.0

**Systemstatus und Diagnose**

- Owner-only Systemstatus ergänzt; der lokale Admin hat ebenfalls Zugriff.
- Twitch-Verbindungen mit Token- und Scope-Status zusammengefasst.
- EventSub-WebSocket und alle erwarteten Subscriptions sichtbar gemacht.
- Letzte Follow-, Raid-, AutoMod-, Clip- und Moderationsereignisse in der Diagnose ergänzt.
- Clip-Monitor, Watchtime-Datei, persistente Datendateien, Server-Uptime und Speicherverbrauch sichtbar gemacht.
- Bis zu 20 zuletzt protokollierte Systemfehler direkt im Systemstatus angezeigt.
- Access- und Refresh-Tokens werden in der Diagnose nicht ausgegeben.

## 4.6.3

**Hilfe und Update-Log**

- Hilfe in die Bereiche Hilfe und Update-Log aufgeteilt.
- Update-Log für die Versionshistorie ergänzt.
- Hilfe-Texte an den aktuellen Funktionsstand angepasst.

## 4.6.2

**Activity Board und Legacy-Command**

- Den früheren Beispiel-Command !beratung aus der Standardkonfiguration entfernt.
- Vorhandenen !beratung-Eintrag per einmaliger Migration entfernt.
- Activity Board auf 100 Einträge pro Seite begrenzt.
- Serverseitige Seitennavigation und Filterung ergänzt.

## 4.6.1

**AutoMod Auto-Allow Hotfix**

- Clip-Bot bei AutoMod primär über die Twitch User ID erkannt.
- Auto-Allow nicht mehr an ein festes Nachrichtenpräfix gebunden.
- Diagnose-Logging für relevante AutoMod-Holds ergänzt.

## 4.6.0

**Community und Auto-Replies**

- Bereich Follow / Raid / Begrüßungen in Community umbenannt.
- !followage als feste Community-Funktion ergänzt.
- !watchtime mit lokaler Watchtime-Erfassung ergänzt.
- AutoMod Auto-Allow für Clip-Nachrichten von Clip-Bot ergänzt.
- Auto-Replies auf kompakte Übersicht mit Detailansicht umgestellt.
- Mehrere Auslöser und Cooldown pro Auto-Reply ergänzt.

## 4.5.0

**Automatisches Clip-Sharing**

- Eigenen Bereich Clips ergänzt.
- Neue Twitch-Clips automatisch erkennen und durch Clip-Bot im Chat teilen.
- Prüfintervall, Live-only-Modus und Nachrichtenvorlage konfigurierbar gemacht.
- Bereits bekannte Clip-IDs persistent gespeichert, um Doppelposts zu verhindern.

## 4.4.3

**Command-Speichern stabilisiert**

- Command-Felder vor dem Speichern direkt aus der Oberfläche in das Datenmodell übernommen.
- Auto-Refresh während des Speicherns pausiert.
- Gespeicherten Serverstand nach dem Speichern automatisch überprüft.

## 4.4.2

**Speicherpfad repariert**

- Twitch Blocked Terms vom normalen Speichern der Konfiguration entkoppelt.
- Konkrete Serverfehler beim Speichern sichtbar gemacht.
- Geöffnete Command-Details nach dem Speichern beibehalten.

## 4.4.1

**Status-Hotfix**

- Fehler im /api/status-Endpunkt behoben, durch den alle Dashboard-Statuskarten auf Statusfehler standen.

## 4.4.0

**Livebetrieb-Fixes**

- Bot-Auswahl und Cooldown bei bestehenden Commands korrigiert.
- Follow- und Raid-EventSub über Haupt-Bot als technischen Moderator angebunden.
- Begrüßungen von Commands und Auto-Replies entkoppelt.
- Punkt und Komma vom Sonderzeichen-Filter ausgenommen.
- Caps-Filter auf zusammenhängende Großbuchstabenfolgen umgestellt.

## 4.3.3

**Commands automatisch synchronisiert**

- Command-Seite beim Öffnen automatisch aktualisiert.
- Änderungen anderer Nutzer alle fünf Sekunden übernommen.
- Auto-Refresh bei eigenen ungespeicherten Änderungen pausiert.

## 4.3.2

**Dashboard / Auto-Replies Hotfix**

- Fehlende renderAuto-Funktion wiederhergestellt.
- Dashboard-Anzeige der aktiven Funktionen repariert.

## 4.3.1

**Gewinnspiel-Logging reduziert**

- Erfolgreiche Gewinnspiel-Teilnahmen aus dem Audit entfernt.
- Nur relevante Gewinnspiel-Ereignisse und Ablehnungen weiter protokolliert.

## 4.3.0

**Wortfilter und Twitch Blocked Terms**

- Verbotene Wörter um die Aktionen Nur erkennen, Nachricht löschen und Bei Twitch blockieren erweitert.
- Synchronisierung mit Twitch Blocked Terms ergänzt.
- Gewinnspiel-Berechtigungen für Mods, Owner und VIPs getrennt.
- VIPs standardmäßig zur Teilnahme zugelassen und sichtbar markiert.

## 4.2.2

**Gewinnspiel erweitert**

- Teilnehmerstand während laufender Gewinnspiele automatisch aktualisiert.
- Eigenes Gewinner-Modal statt Browser-Popup eingeführt.
- Mehrere Gewinner pro Gewinnspiel ermöglicht.
- Ausschlussoptionen für Moderatoren und Owner ergänzt.

## 4.2.1

**Timeout optional**

- Timeout pro Moderationsfilter abschaltbar gemacht.
- Reines Löschen einer Nachricht ohne Timeout ermöglicht.

## 4.2.0

**Aktive Moderation und Gewinnspiele**

- Dashboard um Gewinnspiel-Bot, Clip-Bot und Live-Bot erweitert.
- Moderationsfilter mit echter Lösch- und Timeout-Funktion aktiviert.
- Keyword- und Random-Gewinnspiele ergänzt.
- Gewinnspiel-Zustand persistent gespeichert.

## 4.1.1

**Haupt-Bot als technischer Moderator**

- Haupt-Bot um Moderations-Scopes für Löschen, Timeout und Ban erweitert.

## 4.1.0

**Twitch-Verbindungen**

- Eigenes OAuth-Center für Bot- und Kanal-Accounts ergänzt.
- Gewinnspiel-Bot, Clip-Bot und Live-Bot eingebunden.
- Scopes und erwarteten Twitch-Account bei der Autorisierung geprüft.

## 4.0.0

**Benutzer, Rollen und Logs**

- Rollen Owner, Admin, Editor und Viewer eingeführt.
- Manuelle Freigabe zusätzlicher Twitch-Nutzer ermöglicht.
- Activity Board in Änderungs- und Login-Logs getrennt.
- Filter nach Benutzer, Bereich und Aktion ergänzt.

## 3.4.2

**Version und Dashboard**

- Footer-Version aus version.json dynamisch geladen.
- Dashboard bei Auto-Replies auf reine Anzahl reduziert.

## 3.4.1

**Moderation**

- Reagierenden Bot im Moderationsbereich auswählbar gemacht.

## 3.4.0

**Link-Filter vorbereitet**

- Moderationsbereich mit Link-Filter, Domain-Whitelist und User-Whitelist ergänzt.
- Ausnahmen für Moderatoren und Broadcaster ergänzt.

## 3.3.4

**Footer**

- Footer mit Erstellerangabe korrigiert.

## 3.3.2

**Dark Mode**

- Darstellung des Löschdialogs im Dark Mode korrigiert.

## 3.3.1

**Command-Speichern**

- Anzeige neu angelegter Commands nach dem Speichern korrigiert.

## 3.3.0

**Dark Mode und Timer-Layout**

- Dark Mode ergänzt.
- Timer-Editor übersichtlicher angeordnet.

## 3.2.1

**Timer-Bedingungen**

- UND/ODER-Verknüpfung für Zeit und Mindest-Zeilen ergänzt.

## 3.2.0

**Timer**

- Timer um Zeitintervall und Mindest-Zeilen erweitert.
- Timer nur während laufender Streams ausgeführt.

## 3.1.0

**Kompakte Commands**

- Command-Ansicht auf kompakte Übersicht mit Detailbearbeitung per Stift umgestellt.
- Suche und Sortierung für Commands ergänzt.

## 3.0.0

**Control Center Ausbau**

- Grundstruktur des Control Centers mit Dashboard, Commands, Timern, Events, Wortfiltern, Auto-Replies, Activity Board und Hilfe zusammengeführt.

## 2.5.2

**Activity Board Hotfix**

- Einlesen des Audit-Logs korrigiert.

## 2.4.1

**Frontend Hotfix**

- JavaScript-Fehler behoben, der zu einer leeren Oberfläche führen konnte.
