"use strict";
// Oeffentliche Fassung: Es gibt keine Bestandsinstallation, die uebernommen werden muesste.
// Diese Datei ersetzt beim Export die Datei mit den Werten der urspruenglichen Installation und liefert nur neutrale Werte.
const LEGACY_BACKUP_TYPES = Object.freeze([]);
const LEGACY_PRODUCT_NAME = "Bot Control Center";

// Eine neue Installation ist nie eine Bestandsinstallation.
function isExistingInstallation() { return false; }
function legacyInstallation() { return require("./installation-profile").freshInstallation(); }
function legacyDiscord() { return require("./installation-profile").normalizeDiscord({}); }
function legacyRoster() { return require("./bot-roster").freshRoster(); }
function legacyTextPack() { return require("./text-pack").NEUTRAL; }
function legacyLevelPreset() { return null; }

module.exports = { legacyLevelPreset, legacyRoster, LEGACY_PRODUCT_NAME, LEGACY_BACKUP_TYPES, isExistingInstallation, legacyInstallation, legacyDiscord, legacyTextPack };
