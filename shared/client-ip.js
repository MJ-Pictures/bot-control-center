"use strict";
/*
 * V8.6.6 – Client-IP- und Lokalitätslogik des Control Centers.
 *
 * Rein funktional und ohne Zugriff auf process.env, damit das Verhalten ohne
 * laufenden Server getestet werden kann. app/server.js übergibt die
 * Konfiguration (TRUSTED_PROXY_CIDRS, LOCAL_NETWORK_CIDRS, Host-Fallback).
 *
 * Grundsätze:
 *  - Der Host-Header ist kein Herkunftsnachweis. Er darf höchstens bei einer
 *    direkten Verbindung ohne jegliche Proxy-Header als Ersatz dienen, weil
 *    Docker-NAT die Quelladresse einer LAN-Anfrage verändern kann.
 *  - Proxy-Header (X-Forwarded-For usw.) werden nur ausgewertet, wenn die
 *    unmittelbare Gegenstelle ein ausdrücklich vertrauter Proxy ist.
 *  - Bei vertrautem Proxy zählt der erste NICHT vertraute Eintrag von rechts in
 *    X-Forwarded-For. Der linkeste Eintrag stammt vom Client und ist fälschbar.
 *  - Kommen Proxy-Header von einer nicht vertrauten Gegenstelle, gilt die
 *    Anfrage nicht als lokal.
 */

const FORWARDING_HEADERS = [
  "x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host",
  "x-forwarded-proto", "x-forwarded-server", "cf-connecting-ip", "true-client-ip"
];

function ipv4Int(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = ((out << 8) >>> 0) + n;
  }
  return out >>> 0;
}

function stripMapped(ip) {
  return String(ip || "").trim().replace(/^::ffff:/i, "");
}

// Liefert eine syntaktisch plausible IP-Adresse (IPv4/IPv6) oder "".
function normalizeIp(value) {
  let raw = String(value || "").trim();
  if (!raw || raw.length > 64) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end < 0) return "";
    raw = raw.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(raw)) {
    raw = raw.slice(0, raw.lastIndexOf(":"));
  }
  raw = stripMapped(raw).toLowerCase();
  if (ipv4Int(raw) !== null) return raw;
  if (raw.includes(":") && /^[0-9a-f:.]+$/.test(raw) && raw.length <= 45) return raw;
  return "";
}

function ipInCidr(ip, cidr) {
  const raw = stripMapped(ip);
  if (cidr === "::1/128" || cidr === "::1") return raw === "::1";
  const [base, bitsRaw] = String(cidr || "").split("/");
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const a = ipv4Int(raw), b = ipv4Int(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (a & mask) === (b & mask);
}

function ipInAnyCidr(ip, cidrs) {
  return (cidrs || []).some(c => ipInCidr(ip, c));
}

function isPrivateOrLoopbackIp(ip) {
  const raw = stripMapped(ip);
  if (raw === "::1") return true;
  if (ipv4Int(raw) === null) return false;
  return ipInCidr(raw, "127.0.0.0/8") || ipInCidr(raw, "10.0.0.0/8") ||
    ipInCidr(raw, "172.16.0.0/12") || ipInCidr(raw, "192.168.0.0/16");
}

function hasForwardingHeaders(req) {
  const headers = req?.headers || {};
  return FORWARDING_HEADERS.some(name => String(headers[name] || "").trim() !== "");
}

function requestHostName(req) {
  const raw = String(req?.headers?.host || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(":")[0];
}

function createClientIpResolver(options = {}) {
  const trustedCidrs = Array.isArray(options.trustedProxyCidrs) ? options.trustedProxyCidrs : [];
  const localCidrs = Array.isArray(options.localNetworkCidrs) ? options.localNetworkCidrs : [];
  const hostFallback = options.hostFallback !== false;
  const observed = { untrustedForwardedRequests: 0, lastUntrustedPeer: null, lastSeenAt: null };

  function peerIp(req) {
    return stripMapped(req?.socket?.remoteAddress || "");
  }

  function trustedProxy(req) {
    const peer = peerIp(req);
    return !!peer && ipInAnyCidr(peer, trustedCidrs);
  }

  // { ip, viaTrustedProxy, fromHeader }
  function resolve(req) {
    const peer = peerIp(req);
    if (!trustedProxy(req)) return { ip: peer, viaTrustedProxy: false, fromHeader: false };
    const entries = String(req.headers?.["x-forwarded-for"] || "")
      .split(",").map(x => x.trim()).filter(Boolean);
    if (entries.length) {
      let outermost = "";
      for (let i = entries.length - 1; i >= 0; i--) {
        const ip = normalizeIp(entries[i]);
        if (!ip) return { ip: peer, viaTrustedProxy: true, fromHeader: false };
        if (!ipInAnyCidr(ip, trustedCidrs)) return { ip, viaTrustedProxy: true, fromHeader: true };
        outermost = ip;
      }
      return { ip: outermost || peer, viaTrustedProxy: true, fromHeader: !!outermost };
    }
    const real = normalizeIp(req.headers?.["x-real-ip"]);
    if (real) return { ip: real, viaTrustedProxy: true, fromHeader: true };
    return { ip: peer, viaTrustedProxy: true, fromHeader: false };
  }

  function clientIp(req) {
    return resolve(req).ip;
  }

  // Nur bei direkter Verbindung ohne Proxy-Header: Docker-NAT kann die
  // Quelladresse einer LAN-Anfrage durch das private Docker-Gateway ersetzen.
  // Das Gateway kann zugleich als vertrauter Proxy eingetragen sein (8.7.2):
  // Der Reverse-Proxy setzt immer Forwarding-Header, ein direkter LAN-Zugriff
  // nie. Ohne jeden Forwarding-Header und mit lokalem Host gilt die Anfrage
  // deshalb als direkt, auch wenn die Gegenstelle ein vertrauter Proxy ist.
  function directLocalHostRequest(req) {
    if (!hostFallback) return false;
    if (hasForwardingHeaders(req)) return false;
    const host = requestHostName(req);
    const peer = peerIp(req);
    if (!host || !peer || !isPrivateOrLoopbackIp(peer)) return false;
    if (host === "localhost") return true;
    return ipInAnyCidr(host, localCidrs);
  }

  function isLocalRequest(req) {
    const r = resolve(req);
    if (r.viaTrustedProxy) {
      // Ohne verwertbare Client-Angabe des vertrauten Proxys ist die Herkunft unbekannt,
      // außer es ist ein direkter LAN-Zugriff über das Docker-Gateway (siehe oben).
      if (!r.fromHeader) return directLocalHostRequest(req);
      return r.ip === "::1" || ipInAnyCidr(r.ip, localCidrs);
    }
    // Proxy-Header von einer nicht vertrauten Gegenstelle: Herkunft nicht belegbar.
    if (hasForwardingHeaders(req)) return false;
    if (r.ip === "::1" || ipInAnyCidr(r.ip, localCidrs)) return true;
    return directLocalHostRequest(req);
  }

  // Diagnose: merkt sich, von welcher Adresse Proxy-Header ohne Vertrauen kamen.
  function observe(req) {
    if (!trustedProxy(req) && hasForwardingHeaders(req)) {
      observed.untrustedForwardedRequests += 1;
      observed.lastUntrustedPeer = peerIp(req) || null;
      observed.lastSeenAt = new Date().toISOString();
    }
  }

  function observation() {
    return { ...observed };
  }

  return { peerIp, trustedProxy, resolve, clientIp, directLocalHostRequest, isLocalRequest, observe, observation };
}

module.exports = {
  FORWARDING_HEADERS, ipv4Int, normalizeIp, ipInCidr, ipInAnyCidr, isPrivateOrLoopbackIp,
  hasForwardingHeaders, requestHostName, createClientIpResolver
};
