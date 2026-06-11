// Città Nostr — minimal i18n (it / en)
"use strict";

const I18N = {
  it: {
    tagline: "eventi culturali · accessibilità",
    filters_a11y: "Accessibilità",
    filters_cat: "Categorie",
    events: "Eventi",
    when: "Quando",
    within_days: n => `entro ${n} giorn${n === 1 ? "o" : "i"}`,
    all_dates: "tutte le date",
    empty_title: "Nessun evento trovato.",
    empty_hint: "Prova ad allargare i filtri o la finestra temporale.",
    today: "oggi",
    tomorrow: "domani",
    places: "Luoghi",
    accepts_ecash: "accetta ecash",
    no_ecash: "ecash non disponibile",
    ecash_only: "Solo chi accetta ecash",
    places_empty: "Nessun luogo ricevuto dai relay — pubblica i dati demo con il seeder (vedi README).",
    place: {
      venue: "Spazi culturali",
      merchant: "Negozi",
      food: "Cibo e ristoro",
      transport: "Trasporti",
      worship: "Luoghi di culto",
      poi: "Punti d'interesse",
      info: "Infopoint",
    },
    published_by: "pubblicato da",
    trusted_publisher: "Organizzazione accreditata dalla città",
    wallet: "Portafoglio",
    wallet_balance: "Saldo",
    wallet_empty: "portafoglio vuoto",
    wallet_redeemed: "riscattato",
    wallet_tickets: "I miei biglietti",
    wallet_pending: "Token in sospeso (v0.4)",
    wallet_redeem_now: "Riscatta ora",
    wallet_send: "Invia",
    wallet_send_btn: "Crea token",
    wallet_send_done: "token creato, consegnalo al destinatario:",
    buy_ticket: "Acquista biglietto",
    ticket_bought: "Biglietto acquistato — lo trovi nel Portafoglio.",
    ticket_token_hint: "Mostra questo token all'ingresso: l'organizzazione lo riscatta al mint.",
    wallet_mints: "Mint della città",
    wallet_no_mints: "Nessun mint configurato per questa città.",
    wallet_receive: "Ricevi token",
    wallet_receive_hint: "Incolla un token Cashu (cashuA…)",
    wallet_receive_btn: "Aggiungi al portafoglio",
    wallet_soon: "Sviluppo: avvia il mint locale (uvicorn tools.dev_mint:app --port 3338) e genera fondi con tools/cashu_cli.py mint.",
    a11y: {
      "wheelchair": "Sedia a rotelle",
      "step-free": "Senza gradini",
      "accessible-toilet": "Bagno accessibile",
      "hearing-loop": "Anello magnetico",
      "sign-language": "LIS",
      "audio-description": "Audiodescrizione",
      "quiet-space": "Spazio tranquillo",
      "family-friendly": "Per famiglie",
    },
  },
  en: {
    tagline: "cultural events · accessibility",
    filters_a11y: "Accessibility",
    filters_cat: "Categories",
    events: "Events",
    when: "When",
    within_days: n => `within ${n} day${n === 1 ? "" : "s"}`,
    all_dates: "all dates",
    empty_title: "No events found.",
    empty_hint: "Try widening the filters or the time window.",
    today: "today",
    tomorrow: "tomorrow",
    places: "Places",
    accepts_ecash: "accepts ecash",
    no_ecash: "ecash not available",
    ecash_only: "Only ecash-accepting",
    places_empty: "No places received from the relays — publish the demo data with the seeder (see README).",
    place: {
      venue: "Cultural venues",
      merchant: "Shops",
      food: "Food & drink",
      transport: "Transport",
      worship: "Places of worship",
      poi: "Points of interest",
      info: "Info points",
    },
    published_by: "published by",
    trusted_publisher: "Organization accredited by the city",
    wallet: "Wallet",
    wallet_balance: "Balance",
    wallet_empty: "wallet is empty",
    wallet_redeemed: "redeemed",
    wallet_tickets: "My tickets",
    wallet_pending: "Pending tokens (v0.4)",
    wallet_redeem_now: "Redeem now",
    wallet_send: "Send",
    wallet_send_btn: "Create token",
    wallet_send_done: "token created, hand it to the recipient:",
    buy_ticket: "Buy ticket",
    ticket_bought: "Ticket purchased — find it in the Wallet.",
    ticket_token_hint: "Show this token at the door: the organization redeems it at the mint.",
    wallet_mints: "City mints",
    wallet_no_mints: "No mints configured for this city.",
    wallet_receive: "Receive token",
    wallet_receive_hint: "Paste a Cashu token (cashuA…)",
    wallet_receive_btn: "Add to wallet",
    wallet_soon: "Development: run the local mint (uvicorn tools.dev_mint:app --port 3338) and create funds with tools/cashu_cli.py mint.",
    a11y: {
      "wheelchair": "Wheelchair accessible",
      "step-free": "Step-free access",
      "accessible-toilet": "Accessible toilet",
      "hearing-loop": "Hearing loop",
      "sign-language": "Sign language",
      "audio-description": "Audio description",
      "quiet-space": "Quiet space",
      "family-friendly": "Family friendly",
    },
  },
};

let LANG = (navigator.language || "it").slice(0, 2) === "en" ? "en" : "it";

function t(key) {
  return I18N[LANG][key] ?? I18N.it[key] ?? key;
}

function tA11y(value) {
  return I18N[LANG].a11y[value] ?? value;
}

function tPlace(value) {
  return I18N[LANG].place[value] ?? value;
}

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const v = t(el.dataset.i18n);
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const v = t(el.dataset.i18nPlaceholder);
    if (typeof v === "string") el.placeholder = v;
  });
  document.getElementById("lang-toggle").textContent =
    LANG === "it" ? "EN" : "IT";
}
