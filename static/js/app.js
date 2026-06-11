// Città Nostr — main app controller (vanilla JS, no build step)
"use strict";

const CITY_ID = new URLSearchParams(location.search).get("city") || "bari";
const ALL_DAYS = 31;            // slider max == "all dates"
const GRACE = 6 * 3600;         // keep events visible 6h after start w/o end

const state = {
  city: null,
  nodes: new Map(),             // "kind:pubkey:d" -> EventNode (latest wins)
  places: new Map(),            // "kind:pubkey:d" -> PlaceNode
  profiles: new Map(),          // pubkey -> kind-0 profile (latest wins)
  markers: new Map(),           // node key -> maplibregl.Marker
  placeMarkers: new Map(),
  a11y: new Set(),              // required accessibility features (AND)
  cat: null,                    // active category or null
  windowDays: 7,
  placeTypes: new Set(PLACE_TYPES),   // enabled place layers
  ecashOnly: false,
  map: null,
  pool: null,
  wallet: null,
};

// --------------------------------------------------------------- boot

async function boot() {
  state.city = await (await fetch(`/api/cities/${CITY_ID}`)).json();
  const name = state.city.branding?.displayName?.[LANG] || state.city.name;
  document.getElementById("brand-name").textContent = state.city.name;
  document.title = `${name} — Città Nostr`;

  applyStaticI18n();
  buildA11yFilters();
  initMap();
  initScrubber();
  initLangToggle();
  initPlaceFilters();
  initWallet();
  connectRelays();
}

// --------------------------------------------------------------- map

function initMap() {
  const c = state.city;
  state.map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
    center: [c.mapCenter.lng, c.mapCenter.lat],
    zoom: c.mapZoom || 13,
  });
  state.map.addControl(new maplibregl.NavigationControl(), "top-right");
}

// --------------------------------------------------------------- relays

function connectRelays() {
  const statusEl = document.getElementById("relay-status");
  state.pool = new RelayPool(
    state.city.relays,
    onIncoming,
    n => {
      statusEl.textContent = `● ${n}/${state.city.relays.length}`;
      statusEl.classList.toggle("ok", n > 0);
    },
  );
  state.pool.subscribe([
    { kinds: CALENDAR_KINDS, "#t": [state.city.communityTag], limit: 500 },
    { kinds: [PLACE_KIND], "#t": [state.city.communityTag], limit: 500 },
  ]);
  // If the allow-lists are populated we know whose profiles to fetch now;
  // otherwise authors are discovered from incoming events (see _wantProfile).
  const known = [...new Set([...(state.city.trustedPublishers || []),
                             ...trustedPlacesList()])];
  if (known.length) state.pool.requestProfiles(known);
}

// ----------------------------------------------------- incoming routing

const _profileWanted = new Set();
let _profileTimer = null;

function _wantProfile(pubkey) {
  if (state.profiles.has(pubkey) || _profileWanted.has(pubkey)) return;
  _profileWanted.add(pubkey);
  clearTimeout(_profileTimer);
  _profileTimer = setTimeout(
    () => state.pool.requestProfiles([..._profileWanted]), 400);
}

function onIncoming({ type, node }) {
  if (type === "event") onEventNode(node);
  else if (type === "place") onPlaceNode(node);
  else if (type === "profile") onProfileNode(node);
}

function trustedPlacesList() {
  // trustedMerchants is the pre-v0.5 name; read both
  return state.city.trustedPlaces || state.city.trustedMerchants || [];
}

function onPlaceNode(node) {
  const trusted = trustedPlacesList();
  if (trusted.length && !trusted.includes(node.pubkey)) return;
  const key = `${node.kind}:${node.pubkey}:${node.d}`;
  const prev = state.places.get(key);
  if (prev && prev.createdAt >= node.createdAt) return;
  state.places.set(key, node);
  _wantProfile(node.pubkey);
  queueRender();
}

function onProfileNode(node) {
  const prev = state.profiles.get(node.pubkey);
  if (prev && prev.createdAt >= node.createdAt) return;
  state.profiles.set(node.pubkey, node);
  queueRender();
}

function publisherName(pubkey) {
  const p = state.profiles.get(pubkey);
  return p && p.name ? p.name : null;
}

function isTrustedPublisher(pubkey) {
  const t = state.city.trustedPublishers;
  return Array.isArray(t) && t.includes(pubkey);
}

let renderQueued = false;

function onEventNode(node) {
  // Allow-list: if the city profile names trusted publishers, only their
  // events are shown. Empty/missing list = open mode (bootstrap).
  const trusted = state.city.trustedPublishers;
  if (Array.isArray(trusted) && trusted.length &&
      !trusted.includes(node.pubkey)) return;

  const key = `${node.kind}:${node.pubkey}:${node.d}`;
  const prev = state.nodes.get(key);
  if (prev && prev.createdAt >= node.createdAt) return; // older version
  state.nodes.set(key, node);
  _wantProfile(node.pubkey);
  queueRender();
}

function queueRender() {
  if (renderQueued) return;      // batch bursts of incoming events
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

// --------------------------------------------------------------- filters

function buildA11yFilters() {
  const box = document.getElementById("a11y-filters");
  box.innerHTML = "";
  for (const value of A11Y_VOCAB) {
    const label = document.createElement("label");
    label.className = "a11y-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.a11y.has(value);
    input.addEventListener("change", () => {
      input.checked ? state.a11y.add(value) : state.a11y.delete(value);
      render();
    });
    label.append(input, document.createTextNode(tA11y(value)));
    box.append(label);
  }
}

function buildCategoryChips(visibleNodes) {
  const box = document.getElementById("category-chips");
  const cats = new Set();
  for (const n of visibleNodes)
    n.cats.forEach(c => { if (c !== state.city.communityTag) cats.add(c); });
  if (state.cat) cats.add(state.cat);   // keep active chip even if it empties
  box.innerHTML = "";
  for (const cat of [...cats].sort()) {
    const b = document.createElement("button");
    b.className = "chip" + (state.cat === cat ? " active" : "");
    b.textContent = cat;
    b.addEventListener("click", () => {
      state.cat = state.cat === cat ? null : cat;
      render();
    });
    box.append(b);
  }
}

function initScrubber() {
  const range = document.getElementById("time-range");
  range.value = state.windowDays;
  range.addEventListener("input", () => {
    state.windowDays = parseInt(range.value, 10);
    updateReadout();
    render();
  });
  updateReadout();
}

function updateReadout() {
  document.getElementById("time-readout").textContent =
    state.windowDays >= ALL_DAYS ? t("all_dates") : t("within_days")(state.windowDays);
}

const PLACE_GLYPHS = { venue: "\u{1F3AD}", merchant: "\u{1F6CD}\uFE0F",
  food: "\u{1F37D}\uFE0F", transport: "\u{1F68D}", worship: "\u26EA",
  poi: "\u{1F3DB}\uFE0F", info: "\u2139\uFE0F" };

function initPlaceFilters() {
  const only = document.getElementById("ecash-only-toggle");
  only.checked = state.ecashOnly;
  only.addEventListener("change", () => {
    state.ecashOnly = only.checked;
    render();
  });
  buildPlaceTypeFilters();
}

function buildPlaceTypeFilters() {
  const box = document.getElementById("place-type-filters");
  const counts = {};
  for (const pNode of state.places.values()) {
    counts[pNode.placeType] = (counts[pNode.placeType] || 0) + 1;
  }
  box.innerHTML = "";
  for (const type of PLACE_TYPES) {
    const label = document.createElement("label");
    label.className = "a11y-check place-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.placeTypes.has(type);
    input.addEventListener("change", () => {
      input.checked ? state.placeTypes.add(type)
                    : state.placeTypes.delete(type);
      render();
    });
    const text = document.createElement("span");
    text.textContent = `${PLACE_GLYPHS[type]} ${tPlace(type)}`;
    const count = document.createElement("span");
    count.className = "type-count";
    count.textContent = counts[type] || 0;
    label.append(input, text, count);
    box.append(label);
  }
  document.getElementById("places-empty").hidden = state.places.size > 0;
}

function initWallet() {
  state.wallet = new CashuWalletProvider(state.city.mints || []);
  const modal = document.getElementById("wallet-modal");
  document.getElementById("wallet-open").addEventListener("click", () => {
    modal.hidden = false;
    refreshWallet();
  });
  document.getElementById("wallet-close").addEventListener("click",
    () => { modal.hidden = true; });
  modal.addEventListener("click",
    e => { if (e.target === modal) modal.hidden = true; });

  document.getElementById("wallet-receive-btn").addEventListener("click",
    async () => {
      const input = document.getElementById("wallet-token-input");
      const out = document.getElementById("wallet-receive-result");
      out.textContent = "…";
      out.className = "wallet-msg";
      try {
        const tok = await state.wallet.receive(input.value);
        out.textContent =
          `+${tok.amount} ${tok.unit} · ${t("wallet_redeemed")} · ${tok.mint}` +
          (tok.memo ? ` · "${tok.memo}"` : "");
        out.className = "wallet-msg ok";
        input.value = "";
        refreshWallet();
      } catch (err) {
        out.textContent = err.message;
        out.className = "wallet-msg err";
      }
    });

  document.getElementById("wallet-send-btn").addEventListener("click",
    async () => {
      const amountEl = document.getElementById("wallet-send-amount");
      const out = document.getElementById("wallet-send-result");
      out.textContent = "…";
      out.className = "wallet-msg";
      try {
        const res = await state.wallet.send(parseInt(amountEl.value, 10));
        out.textContent = "";
        out.className = "wallet-msg ok";
        const ta = document.createElement("textarea");
        ta.readOnly = true;
        ta.rows = 3;
        ta.value = res.encoded;
        ta.id = "wallet-send-output";
        out.append(document.createTextNode(
          `${res.amount} sat — ${t("wallet_send_done")}`), ta);
        refreshWallet();
      } catch (err) {
        out.textContent = err.message;
        out.className = "wallet-msg err";
      }
    });
}

function renderTickets() {
  const box = document.getElementById("wallet-tickets");
  const tickets = state.wallet.listTickets();
  document.getElementById("wallet-tickets-section").hidden = !tickets.length;
  box.innerHTML = "";
  const locale = LANG === "it" ? "it-IT" : "en-GB";
  for (const tk of [...tickets].reverse()) {
    const li = document.createElement("li");
    li.className = "ticket-item";
    const head = document.createElement("div");
    head.className = "ticket-head";
    head.textContent = `\u{1F39F}\uFE0F ${tk.title} — ` +
      new Date(tk.start * 1000).toLocaleString(locale,
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) +
      ` · ${tk.amount} ${tk.unit}`;
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.rows = 2;
    ta.value = tk.token;
    ta.title = t("ticket_token_hint");
    li.append(head, ta);
    box.append(li);
  }
}

function renderPendingTokens() {
  const box = document.getElementById("wallet-pending");
  const pending = state.wallet.listPending();
  document.getElementById("wallet-pending-section").hidden = !pending.length;
  box.innerHTML = "";
  for (const enc of pending) {
    const li = document.createElement("li");
    li.className = "ticket-item";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = t("wallet_redeem_now");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await state.wallet.receive(enc);
        state.wallet.removePending(enc);
      } catch (err) {
        if (/already spent|spent/.test(err.message)) {
          state.wallet.removePending(enc);   // worthless, drop it
        }
        alert(err.message);
      }
      refreshWallet();
    });
    li.append(document.createTextNode(enc.slice(0, 28) + "… "), btn);
    box.append(li);
  }
}

async function refreshWallet() {
  const bal = await state.wallet.balance();
  document.getElementById("wallet-balance").textContent =
    `${bal.amount} ${bal.unit}`;
  document.getElementById("wallet-balance-note").textContent =
    bal.perMint.map(m => `${m.amount} sat @ ${m.mint}`).join(" · ") ||
    t("wallet_empty");
  renderTickets();
  renderPendingTokens();

  const list = document.getElementById("wallet-mints");
  list.textContent = "…";
  const infos = await state.wallet.mintInfo();
  list.innerHTML = "";
  if (!infos.length) {
    list.textContent = t("wallet_no_mints");
    return;
  }
  for (const m of infos) {
    const li = document.createElement("li");
    li.className = "mint-item " + (m.ok ? "ok" : "err");
    const dot = document.createElement("span");
    dot.className = "mint-dot";
    const label = document.createElement("span");
    label.textContent = m.ok ? `${m.name} ${m.version}` : `${m.url} — offline`;
    li.append(dot, label);
    list.append(li);
  }
}

function initLangToggle() {
  document.getElementById("lang-toggle").addEventListener("click", () => {
    LANG = LANG === "it" ? "en" : "it";
    applyStaticI18n();
    buildA11yFilters();
    updateReadout();
    render();
  });
}

// --------------------------------------------------------------- selection

function passesFilters(n, now, ignoreCat = false) {
  const ends = n.end ?? (n.start + GRACE);
  if (ends < now) return false;                              // already over
  if (state.windowDays < ALL_DAYS &&
      n.start > now + state.windowDays * 86400) return false; // outside window
  for (const need of state.a11y)
    if (!n.a11y.includes(need)) return false;                 // AND semantics
  if (!ignoreCat && state.cat && !n.cats.includes(state.cat)) return false;
  return true;
}

// --------------------------------------------------------------- render

function render() {
  const now = Math.floor(Date.now() / 1000);
  // chips reflect everything passing the time + a11y filters (category ignored)
  const inWindow = [...state.nodes.values()]
    .filter(n => passesFilters(n, now, true));
  const visible = [...state.nodes.values()]
    .filter(n => passesFilters(n, now))
    .sort((a, b) => a.start - b.start);

  buildCategoryChips(inWindow);
  renderList(visible);
  renderMarkers(visible);
  const placesShown = renderPlaceMarkers();
  buildPlaceTypeFilters();

  document.getElementById("event-count").textContent = visible.length;
  document.getElementById("place-count").textContent =
    `${placesShown}/${state.places.size}`;
  document.getElementById("empty-state").hidden = visible.length > 0;
}

function renderList(nodes) {
  const list = document.getElementById("event-list");
  const tpl = document.getElementById("event-item-tpl");
  list.innerHTML = "";
  for (const n of nodes) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.querySelector(".event-when").textContent = whenLabel(n.start);
    li.querySelector(".event-title").textContent = n.title;
    const org = publisherName(n.pubkey);
    li.querySelector(".event-venue").textContent =
      (n.location || "") +
      (org ? ` — ${org}${isTrustedPublisher(n.pubkey) ? " ✓" : ""}` : "");
    const badges = li.querySelector(".event-badges");
    if (n.price) {
      badges.append(badge(`\u{1F39F}\uFE0F ${n.price.amount} ${n.price.unit}`, "ecash"));
    }
    n.a11y.forEach(v => badges.append(badge(tA11y(v))));
    n.cats.filter(c => c !== state.city.communityTag)
      .forEach(c => badges.append(badge(c, "cat")));
    const open = () => focusNode(n);
    li.addEventListener("click", open);
    li.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    list.append(li);
  }
}

function badge(text, extra = "") {
  const s = document.createElement("span");
  s.className = ("badge " + extra).trim();
  s.textContent = text;
  return s;
}

function whenLabel(start) {
  const locale = LANG === "it" ? "it-IT" : "en-GB";
  const d = new Date(start * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((d - today) / 86400000);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `${t("today")}\n${time}`;
  if (days === 1) return `${t("tomorrow")}\n${time}`;
  const date = d.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  return `${date}\n${time}`;
}

function renderMarkers(nodes) {
  const wanted = new Set();
  for (const n of nodes) {
    if (n.lat == null || n.lng == null) continue;
    const key = `${n.kind}:${n.pubkey}:${n.d}`;
    wanted.add(key);
    if (state.markers.has(key)) continue;

    const el = document.createElement("div");
    el.className = "marker" + (n.a11y.length ? " a11y" : "");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", n.title);

    const popup = new maplibregl.Popup({ offset: 14 })
      .setDOMContent(popupContent(n));
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([n.lng, n.lat])
      .setPopup(popup)
      .addTo(state.map);
    state.markers.set(key, marker);
  }
  for (const [key, marker] of state.markers) {
    if (!wanted.has(key)) { marker.remove(); state.markers.delete(key); }
  }
}

function popupContent(n) {
  const locale = LANG === "it" ? "it-IT" : "en-GB";
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = n.title;
  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = new Date(n.start * 1000).toLocaleString(locale, {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  }) + (n.location ? " · " + n.location : "");
  const desc = document.createElement("div");
  desc.className = "popup-desc";
  desc.textContent = n.description;
  const badges = document.createElement("div");
  badges.className = "event-badges";
  n.a11y.forEach(v => badges.append(badge(tA11y(v))));
  box.append(title, meta, desc, badges);
  const org = publisherName(n.pubkey);
  if (org) {
    const pub = document.createElement("div");
    pub.className = "popup-publisher";
    pub.textContent = `${t("published_by")} ${org}` +
                      (isTrustedPublisher(n.pubkey) ? " ✓" : "");
    if (isTrustedPublisher(n.pubkey)) {
      pub.title = t("trusted_publisher");
    }
    box.append(pub);
  }
  if (n.price) {
    const row = document.createElement("div");
    row.className = "popup-buy";
    const btn = document.createElement("button");
    btn.className = "primary buy-btn";
    btn.textContent =
      `\u{1F39F}\uFE0F ${t("buy_ticket")} — ${n.price.amount} ${n.price.unit}`;
    const msg = document.createElement("div");
    msg.className = "wallet-msg";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      msg.textContent = "…";
      msg.className = "wallet-msg";
      try {
        await state.wallet.buyTicket(n);
        msg.textContent = t("ticket_bought");
        msg.className = "wallet-msg ok";
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "wallet-msg err";
        btn.disabled = false;
      }
    });
    row.append(btn, msg);
    box.append(row);
  }
  return box;
}

function renderPlaceMarkers() {
  const wanted = new Set();
  let visibleCount = 0;
  for (const [key, m] of state.places) {
    if (m.lat == null || m.lng == null) continue;
    if (!state.placeTypes.has(m.placeType)) continue;
    if (state.ecashOnly && !m.acceptsEcash) continue;
    visibleCount++;
    wanted.add(key);
    if (state.placeMarkers.has(key)) continue;
    const el = document.createElement("div");
    el.className = "marker place" + (m.acceptsEcash ? " ecash" : "");
    el.textContent = PLACE_GLYPHS[m.placeType] || PLACE_GLYPHS.poi;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${tPlace(m.placeType)}: ${m.name}`);
    const popup = new maplibregl.Popup({ offset: 16 })
      .setDOMContent(placePopupContent(m));
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([m.lng, m.lat])
      .setPopup(popup)
      .addTo(state.map);
    state.placeMarkers.set(key, marker);
  }
  for (const [key, marker] of state.placeMarkers) {
    if (!wanted.has(key)) { marker.remove(); state.placeMarkers.delete(key); }
  }
  return visibleCount;
}

function placePopupContent(m) {
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = m.name;
  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = m.address || "";
  const desc = document.createElement("div");
  desc.className = "popup-desc";
  desc.textContent = m.description;
  const badges = document.createElement("div");
  badges.className = "event-badges";
  badges.append(badge(`${PLACE_GLYPHS[m.placeType]} ${tPlace(m.placeType)}`, "cat"));
  if (m.acceptsEcash) badges.append(badge(t("accepts_ecash"), "ecash"));
  else badges.append(badge(t("no_ecash"), "muted"));
  m.cats.filter(c => c !== state.city.communityTag)
    .forEach(c => badges.append(badge(c, "cat")));
  box.append(title, meta, desc, badges);
  if (m.mints.length) {
    const mints = document.createElement("div");
    mints.className = "popup-publisher";
    mints.textContent = "mint: " + m.mints.join(", ");
    box.append(mints);
  }
  return box;
}

function focusNode(n) {
  if (n.lat == null) return;
  state.map.flyTo({ center: [n.lng, n.lat], zoom: 15.5 });
  const key = `${n.kind}:${n.pubkey}:${n.d}`;
  const marker = state.markers.get(key);
  if (marker && !marker.getPopup().isOpen()) marker.togglePopup();
}

boot();
