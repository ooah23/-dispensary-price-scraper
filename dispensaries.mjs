export const dispensaries = [
  // ── Working stores ──────────────────────────────────────────────────────────
  {
    name: "Housing Works Cannabis Co",
    address: "750 Broadway",
    neighborhood: "NoHo",
    menuUrlOverride: "https://hwcannabis.co/menu/broadway/categories/flower/",
    dealsUrlOverride: null,
    sourceNote: "Official Blaze storefront"
  },
  {
    name: "Smacked Village",
    address: "99 MacDougal St",
    neighborhood: "Greenwich Village",
    menuUrlOverride: "https://getsmacked.online/categories/flower/",
    dealsUrlOverride: null,
    sourceNote: "Joint/Surfside storefront – NOTE: store is actually at 144 Bleecker St per official site; address in this file may be stale"
  },
  {
    name: "The Travel Agency",
    address: "33 Christopher St",
    neighborhood: "West Village",
    menuUrlOverride: "https://www.thetravelagency.co/flower/",
    dealsUrlOverride: null,
    sourceNote: "Official Blaze storefront"
  },
  {
    name: "Dazed",
    address: "287 Hudson St",
    neighborhood: "Hudson Square",
    menuUrlOverride: null,
    dealsUrlOverride: null,
    sourceNote: "Address mismatch: Dazed NYC only has 33 Union Sq W location confirmed online; no 287 Hudson St location found – may be wrong store or closed"
  },
  {
    name: "The Alchemy (Flatiron)",
    address: "22 W 23rd St",
    neighborhood: "Flatiron",
    menuUrlOverride: "https://www.thealchemy.nyc/flatiron/shop-flatiron?dtche%5Bcategory%5D=flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie embed on official site (slug: the-alchemy-flatiron) – NOTE: official address is 12 W 18th St, not 22 W 23rd St"
  },
  {
    name: "The Alchemy (Chelsea)",
    address: "254 W 29th St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://www.thealchemy.nyc/shop?dtche%5Bcategory%5D=flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie embed on official site (slug: blazinup) – NOTE: official address is 302 8th Ave, not 254 W 29th St"
  },
  {
    name: "Stoops NYC",
    address: "182 5th Ave",
    neighborhood: "Flatiron",
    leaflySlug: "stoopsnyc"
  },
  {
    name: "Blue Forest Farms",
    address: "55 W 17th St",
    neighborhood: "Flatiron",
    menuUrlOverride: "https://shop.blueforestfarmsdispensary.com/",
    dealsUrlOverride: null,
    sourceNote: "Official WordPress shop – NOTE: official address appears to be 122 E 25th St, not 55 W 17th St; no direct flower-category URL available (503 on /flower/)"
  },
  {
    name: "Mighty Lucky",
    address: "234 W 14th St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://mighty-lucky.com/collections/all?dtche%5Bpath%5D=products&dtche%5Bcategory%5D=flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie-embedded Shopify storefront (mightylucky.myshopify.com) – NOTE: official address is 259 Bowery, not 234 W 14th St"
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
    menuUrlOverride: "https://shop.newamsterdam.nyc/products?store=245-w-14th-st",
    dealsUrlOverride: null,
    sourceNote: "Mosaic storefront"
  },

  // ── CONBUD – dedicated weight-filter extractor ───────────────────────────────
  {
    name: "CONBUD",
    address: "100 Delancey St",
    neighborhood: "LES",
    menuUrlOverride: "https://conbud.com/stores/conbud-les/products/flower",
    dealsUrlOverride: null,
    sourceNote: "Official CONBUD storefront – weight filters scraped"
  },

  // ── Weedmaps stores (mixed results) ─────────────────────────────────────────
  {
    name: "Green Genius",
    address: "131 W 28th St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://greengeniusnyc.com/shop/",
    dealsUrlOverride: null,
    sourceNote: "Official custom WordPress shop – NOTE: confirmed address is 214 3rd Ave (Gramercy), not 131 W 28th St; flower page at /flower/ returns 403"
  },
  {
    name: "VERDI",
    address: "205 W 28th St",
    neighborhood: "Chelsea",
    menuUrlOverride: null,
    dealsUrlOverride: null,
    sourceNote: "Weedmaps listing removed – business no longer found on Weedmaps"
  },
  {
    name: "KushKlub NYC",
    address: "119 W 25th St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://menu.kushklub.com/nyc",
    dealsUrlOverride: null,
    sourceNote: "Alternative menu URL (menu.kushklub.com) – shop.kushklub.com had cert issues; NYC location confirmed at 186 Orchard St per multiple sources; 119 W 25th may be stale"
  },
  {
    name: "Smiley Exotics",
    address: "218 W 23rd St",
    neighborhood: "Chelsea",
    menuUrlOverride: "https://dutchie.com/dispensary/smiley-exotics/categories/flower",
    dealsUrlOverride: null,
    sourceNote: "Dutchie storefront (slug: smiley-exotics) – NOTE: official address is 201 E 30th St, not 218 W 23rd St; smileyexoticsny.com is live"
  }
];
