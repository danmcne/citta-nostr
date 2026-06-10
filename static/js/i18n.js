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
  document.getElementById("lang-toggle").textContent =
    LANG === "it" ? "EN" : "IT";
}
