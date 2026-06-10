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
    merchants: "Esercizi ecash",
    show_merchants: "Mostra sulla mappa",
    accepts_ecash: "accetta ecash",
    published_by: "pubblicato da",
    trusted_publisher: "Organizzazione accreditata dalla città",
    wallet: "Portafoglio",
    wallet_balance: "Saldo",
    wallet_unredeemed: "token ricevuti, non ancora riscattati presso il mint",
    wallet_empty: "nessun token ricevuto",
    wallet_mints: "Mint della città",
    wallet_no_mints: "Nessun mint configurato per questa città.",
    wallet_receive: "Ricevi token",
    wallet_receive_hint: "Incolla un token Cashu (cashuA…)",
    wallet_receive_btn: "Aggiungi al portafoglio",
    wallet_soon: "Invio e pagamenti in arrivo nel prossimo passo.",
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
    merchants: "Ecash merchants",
    show_merchants: "Show on map",
    accepts_ecash: "accepts ecash",
    published_by: "published by",
    trusted_publisher: "Organization accredited by the city",
    wallet: "Wallet",
    wallet_balance: "Balance",
    wallet_unredeemed: "tokens received, not yet redeemed at the mint",
    wallet_empty: "no tokens received",
    wallet_mints: "City mints",
    wallet_no_mints: "No mints configured for this city.",
    wallet_receive: "Receive token",
    wallet_receive_hint: "Paste a Cashu token (cashuA…)",
    wallet_receive_btn: "Add to wallet",
    wallet_soon: "Sending and payments arrive in the next step.",
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
