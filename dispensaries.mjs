export const dispensaries = [
  // ── Working stores ──────────────────────────────────────────────────────────
  {
    name: "Housing Works Cannabis Co",
    address: "750 Broadway",
    neighborhood: "NoHo",
    menuUrlOverride: "https://hwcannabis.co/menu/broadway/categories/flower/",
    dealsUrlOverride: "https://hwcannabis.co/menu/broadway/specials/",
    sourceNote: "Official Blaze storefront"
  },
  {
    name: "Smacked Village",
    address: "144 Bleecker St",
    neighborhood: "Greenwich Village",
    menuUrlOverride: "https://getsmacked.online/categories/flower/",
    dealsUrlOverride: null,
    sourceNote: "Joint/Surfside storefront"
  },
  {
    name: "The Travel Agency",
    address: "835 Broadway",
    neighborhood: "Union Square",
    menuUrlOverride: "https://www.thetravelagency.co/flower/",
    dealsUrlOverride: "https://www.thetravelagency.co/specials/",
    sourceNote: "Official Blaze storefront – chain-wide menu"
  },
  {
    name: "Dazed",
    address: "33 Union Square W",
    neighborhood: "Union Square",
    menuUrlOverride: "https://dazed.fun/menu/union-square-nyc-ny/categories/flower/",
    dealsUrlOverride: "https://dazed.fun/menu/union-square-nyc-ny/specials/",
    sourceNote: "Joint eCommerce storefront (client-side route – base menu: /menu/union-square-nyc-ny/)"
  },
  {
    name: "The Alchemy (Flatiron)",
    address: "12 W 18th St",
    neighborhood: "Flatiron",
    menuUrlOverride: "https://www.thealchemy.nyc/flatiron/shop-flatiron?dtche%5Bcategory%5D=flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie embed on official site (slug: the-alchemy-flatiron)"
  },
  {
    name: "The Alchemy (Chelsea)",
    address: "302 8th Ave",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://www.thealchemy.nyc/shop?dtche%5Bcategory%5D=flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie embed on official site (slug: blazinup)"
  },
  {
    name: "Stoops NYC",
    address: "182 5th Ave",
    neighborhood: "Flatiron",
    leaflySlug: "stoopsnyc"
  },
  {
    name: "Blue Forest Farms",
    address: "122 E 25th St",
    neighborhood: "Gramercy",
    menuUrlOverride: "https://shop.blueforestfarmsdispensary.com/shop-cannabis-flower/",
    dealsUrlOverride: null,
    sourceNote: "Custom WordPress/WooCommerce shop – flower category page"
  },
  {
    name: "Mighty Lucky",
    address: "259 Bowery",
    neighborhood: "Bowery",
    menuUrlOverride: "https://weedmaps.com/dispensaries/mighty-lucky/menu",
    dealsUrlOverride: null,
    sourceNote: "Weedmaps menu (259 Bowery) – updated from legacy moonlight sub-path"
  },

  // ── Gotham – patched to official location-specific menus ────────────────────
  {
    name: "Gotham (Bowery)",
    address: "3 E 3rd St",
    neighborhood: "Bowery",
    menuUrlOverride: "https://gotham.nyc/menu/?category=flower&retailer=bowery",
    dealsUrlOverride: null,
    sourceNote: "Official location-specific flower menu"
  },
  {
    name: "Gotham (Chelsea)",
    address: "146 10th Ave",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://gotham.nyc/menu/?category=flower&retailer=chelsea",
    dealsUrlOverride: null,
    sourceNote: "Official location-specific flower menu"
  },

  // ── New Amsterdam ────────────────────────────────────────────────────────────
  {
    name: "New Amsterdam",
    address: "245 W 14th St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://newamsterdam.nyc/store/categories/flower",
    dealsUrlOverride: "https://newamsterdam.nyc/store/categories/flower",
    sourceNote: "Dispense platform (newamsterdam.nyc) — 170+ flower products"
  },

  // ── CONBUD ───────────────────────────────────────────────────────────────────
  {
    name: "CONBUD",
    address: "85 Delancey St",
    neighborhood: "LES",
    menuUrlOverride: "https://conbud.com/stores/conbud-les/products/flower",
    dealsUrlOverride: "https://conbud.com/stores/conbud-les/specials",
    sourceNote: "Official CONBUD storefront – weight filters scraped"
  },

  // ── Other stores ─────────────────────────────────────────────────────────────
  {
    name: "Green Genius",
    address: "214 3rd Ave",
    neighborhood: "Gramercy",
    menuUrlOverride: "https://greengeniusnyc.com/stores/green-genius-nyc/products/flower",
    dealsUrlOverride: null,
    sourceNote: "Joint/Dutchie Plus SPA — joint extractor with body-text fallback"
  },
  {
    name: "VERDI",
    address: "158 W 23rd St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://verdicannabis.com/stores/verdi/products/flower",
    dealsUrlOverride: "https://verdicannabis.com/stores/verdi/specials",
    sourceNote: "Joint eCommerce storefront (verdicannabis.com – blocks automated fetches with 403, but URL is Google-indexed as 'Cannabis Flower | Verdi - Chelsea')"
  },
  {
    name: "KushKlub NYC",
    address: "186 Orchard St",
    neighborhood: "LES",
    menuUrlOverride: "https://menu.kushklub.com/nyc",
    dealsUrlOverride: null,
    sourceNote: "Official menu URL"
  },
  {
    name: "Smiley Exotics",
    address: "201 E 30th St",
    neighborhood: "Kips Bay",
    menuUrlOverride: "https://dutchie.com/embedded-menu/smiley-exotics",
    dealsUrlOverride: null,
    sourceNote: "Dutchie storefront (slug: smiley-exotics) – /categories/flower suffix returns 404; root embed URL works"
  },

  // ── Expansion stores ─────────────────────────────────────────────────────────
  {
    name: "Housing Works Cannabis Co (NoMad)",
    address: "846 6th Ave",
    neighborhood: "NoMad",
    menuUrlOverride: null,
    dealsUrlOverride: null,
    sourceNote: "No online menu — Leafly listing empty, Weedmaps unclaimed, Blaze only covers Broadway + Delivery locations. Skip until a storefront URL is found."
  },
  {
    name: "Superfly",
    address: "57 W 86th St",
    neighborhood: "Upper West Side",
    menuUrlOverride: "https://dutchie.com/embedded-menu/afny",
    dealsUrlOverride: null,
    sourceNote: "Dutchie storefront (slug: afny) – root embed URL, no /categories/flower suffix"
  },
  {
    name: "Midnight Moon",
    address: "1536 Amsterdam Ave",
    neighborhood: "Washington Heights",
    menuUrlOverride: "https://midnightmoon.nyc/stores/midnight-moon/products/flower",
    dealsUrlOverride: "https://midnightmoon.nyc/stores/midnight-moon/specials",
    sourceNote: "Dutchie standalone storefront (midnightmoon.nyc) — was incorrectly using Leafly slug which returned 0 flower products"
  },
  {
    name: "Terp Bros (Astoria)",
    address: "36-10 Ditmars Blvd",
    neighborhood: "Astoria, Queens",
    menuUrlOverride: "https://dutchie.com/embedded-menu/terp-bros-astoria",
    dealsUrlOverride: null,
    sourceNote: "Dutchie storefront (slug: terp-bros-astoria) – root embed URL, first Queens location"
  }
];
