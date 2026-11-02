# Pokésammlung

Private iPhone-App für die eigene Pokémon-Kartensammlung: Mastersets abhaken, Karten scannen (auch im Dauer-Modus für den
Cardslinger), Marktwerte von Cardmarket, Wunschliste mit Preisalarm, Slabs mit eBay-Preisen, Wertverlauf, Statistik und Backup.

## App aufs iPhone bringen

Die App wird bei jedem Push automatisch von GitHub gebaut (Tab **Actions** → „iOS-App bauen“, ca. 10 Minuten).

1. **App herunterladen:** Actions → den neuesten Lauf mit grünem ✓ öffnen → unten bei *Artifacts* `Pokesammlung-iOS`
   herunterladen → ZIP entpacken → `Pokesammlung.ipa`.
2. **Sideloadly installieren:** <https://sideloadly.io>. Falls das iPhone nicht erkannt wird, iTunes **von apple.com**
   (nicht aus dem Microsoft Store) installieren.
3. **iPhone per USB anschließen** und auf dem iPhone „Vertrauen“ tippen.
4. In Sideloadly die `.ipa` hineinziehen, bei *Apple ID* die eigene Apple-ID eintragen und **Start** drücken.
5. Auf dem iPhone einmalig:
   - *Einstellungen → Allgemein → VPN & Geräteverwaltung* → eigene Apple-ID → **Vertrauen**
   - *Einstellungen → Datenschutz & Sicherheit → Entwicklermodus* einschalten (iPhone startet neu)

Mit einer kostenlosen Apple-ID läuft die App **7 Tage**. Danach einfach mit Sideloadly neu installieren – die Sammlung
bleibt erhalten. In Sideloadly kann man „Automatic refresh“ aktivieren (PC und iPhone im selben WLAN).

**Tipp:** Vor dem Neuinstallieren unter *Einstellungen → Sicherung exportieren* ein Backup machen.

## Einrichtung in der App (optional)

- Der Scanner liest Karten live auf dem iPhone (Apple Vision: Text + Bildabgleich), ohne Schlüssel.
  Ein **OCR-Schlüssel** (<https://ocr.space/ocrapi/freekey>) wird nur für die Browser-Vorschau gebraucht.
- **eBay-Schlüssel** für Slab-Preise: kostenloser Entwicklerzugang unter <https://developer.ebay.com/my/keys>,
  „Production“-Keys erstellen, App ID und Cert ID in den Einstellungen eintragen.

## Entwicklung

```bash
npm install
npx expo start --web     # im Browser testen
```

Datenquellen: TCGdex (Karten, Cardmarket-Preise), pokemontcg.io / Scrydex / Pokellector (fehlende Kartenbilder),
OCR.space (Texterkennung), eBay Browse API (Slab-Preise), Frankfurter (Wechselkurse).
