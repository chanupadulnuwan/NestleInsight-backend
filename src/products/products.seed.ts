type ArtworkConfig = {
  brand: string;
  titleLines: string[];
  subtitle: string;
  badge: string;
  primary: string;
  secondary: string;
  tertiary: string;
  accentText?: string;
};

type SeedProduct = {
  productName: string;
  sku: string;
  categorySlug: string;
  brand: string;
  packSize: string;
  unitPrice: number;
  productsPerCase: number;
  casePrice?: number;
  barcode?: string;
  description?: string;
  imageUrl: string;
};

function createTextBlock(
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  fill: string,
) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-size="${fontSize}" font-weight="800" fill="${fill}" font-family="Arial, Helvetica, sans-serif">${line}</text>`,
    )
    .join('');
}

function createCatalogArtworkDataUrl(config: ArtworkConfig) {
  const titleBlock = createTextBlock(
    config.titleLines,
    66,
    242,
    46,
    56,
    config.accentText ?? '#1f150c',
  );

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="860" viewBox="0 0 640 860" role="img" aria-label="${config.brand} ${config.titleLines.join(' ')}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${config.primary}" />
          <stop offset="100%" stop-color="${config.secondary}" />
        </linearGradient>
        <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.94)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.74)" />
        </linearGradient>
      </defs>
      <rect width="640" height="860" rx="42" fill="url(#bg)" />
      <circle cx="520" cy="154" r="118" fill="${config.tertiary}" opacity="0.18" />
      <circle cx="112" cy="740" r="154" fill="#ffffff" opacity="0.14" />
      <path d="M0 650C112 576 232 560 350 618C464 674 560 694 640 650V860H0Z" fill="#ffffff" opacity="0.12" />
      <rect x="44" y="48" width="552" height="764" rx="36" fill="url(#panel)" stroke="rgba(255,255,255,0.4)" />
      <rect x="66" y="72" width="184" height="58" rx="18" fill="${config.secondary}" />
      <text x="92" y="109" font-size="28" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${config.brand}</text>
      ${titleBlock}
      <text x="66" y="430" font-size="28" font-weight="600" fill="#5f4634" font-family="Arial, Helvetica, sans-serif">${config.subtitle}</text>
      <rect x="66" y="474" width="236" height="54" rx="18" fill="${config.tertiary}" opacity="0.92" />
      <text x="94" y="509" font-size="24" font-weight="700" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${config.badge}</text>
      <rect x="66" y="572" width="508" height="166" rx="32" fill="${config.primary}" opacity="0.16" />
      <path d="M110 682C154 638 206 614 268 614C342 614 404 650 470 706" fill="none" stroke="${config.secondary}" stroke-width="26" stroke-linecap="round" opacity="0.45" />
      <circle cx="510" cy="614" r="44" fill="${config.secondary}" opacity="0.86" />
      <circle cx="510" cy="614" r="18" fill="#ffffff" opacity="0.86" />
      <text x="66" y="782" font-size="24" font-weight="700" fill="#5d4330" font-family="Arial, Helvetica, sans-serif">Nestle Insight Catalog</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const seedProducts: SeedProduct[] = [
  {
    productName: 'Milo',
    sku: 'MILO-400G',
    categorySlug: 'malted-drinks',
    brand: 'Nestle',
    packSize: '400g',
    unitPrice: 1200,
    productsPerCase: 12,
    barcode: '4792004000012',
    description:
      'Chocolate malt beverage powder for everyday retail distribution.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Nestle',
      titleLines: ['MILO', '400g'],
      subtitle: 'Chocolate malt drink',
      badge: 'Malted drinks',
      primary: '#1f8f3a',
      secondary: '#0d6832',
      tertiary: '#d9e95f',
      accentText: '#ffffff',
    }),
  },
  {
    productName: 'Milo',
    sku: 'MILO-1KG',
    categorySlug: 'malted-drinks',
    brand: 'Nestle',
    packSize: '1kg',
    unitPrice: 2850,
    productsPerCase: 6,
    barcode: '4792004000013',
    description: 'Larger household pack for malted drink demand.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Nestle',
      titleLines: ['MILO', '1kg'],
      subtitle: 'Chocolate malt drink',
      badge: 'Large family pack',
      primary: '#207f42',
      secondary: '#0f5f2d',
      tertiary: '#dce95f',
      accentText: '#ffffff',
    }),
  },
  {
    productName: 'Milkmaid',
    sku: 'MILKMAID-510G',
    categorySlug: 'dairy',
    brand: 'Nestle',
    packSize: '510g',
    unitPrice: 650,
    productsPerCase: 24,
    barcode: '4792004000024',
    description:
      'Sweetened condensed milk for dessert and beverage preparation.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Nestle',
      titleLines: ['Milkmaid'],
      subtitle: 'Sweetened condensed milk 510g',
      badge: 'Dairy',
      primary: '#4cc0eb',
      secondary: '#2674b5',
      tertiary: '#f4e1aa',
      accentText: '#ffffff',
    }),
  },
  {
    productName: 'Nescafe Classic',
    sku: 'NESCAFE-CLASSIC-200G',
    categorySlug: 'beverages',
    brand: 'Nescafe',
    packSize: '200g',
    unitPrice: 1750,
    productsPerCase: 12,
    barcode: '4792004000031',
    description: 'Instant coffee jar for beverage shelves and general trade.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Nescafe',
      titleLines: ['Classic', '200g'],
      subtitle: 'Instant coffee',
      badge: 'Beverages',
      primary: '#a61f1b',
      secondary: '#4b120f',
      tertiary: '#e7b185',
      accentText: '#ffffff',
    }),
  },
  {
    productName: 'Maggi Coconut Milk Powder',
    sku: 'MAGGI-COCONUT-300G',
    categorySlug: 'culinary',
    brand: 'Maggi',
    packSize: '300g',
    unitPrice: 980,
    productsPerCase: 24,
    barcode: '4792004000045',
    description: 'Cooking essential for curries, gravies, and sauces.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Maggi',
      titleLines: ['Coconut Milk', 'Powder'],
      subtitle: 'Culinary 300g pack',
      badge: 'Culinary',
      primary: '#d3a85f',
      secondary: '#7d552f',
      tertiary: '#e9d9ab',
      accentText: '#ffffff',
    }),
  },
  {
    productName: 'Cerelac Wheat',
    sku: 'CERELAC-WHEAT-250G',
    categorySlug: 'cereals',
    brand: 'Nestle',
    packSize: '250g',
    unitPrice: 850,
    productsPerCase: 24,
    barcode: '4792004000052',
    description: 'Fortified infant cereal for cereal and nutrition aisles.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'Cerelac',
      titleLines: ['Wheat', '250g'],
      subtitle: 'Infant cereal',
      badge: 'Cereals',
      primary: '#f2d179',
      secondary: '#ca8d2b',
      tertiary: '#dfb04a',
      accentText: '#3d2813',
    }),
  },
  {
    productName: 'KitKat 4 Finger',
    sku: 'KITKAT-4F-41G',
    categorySlug: 'confectionery',
    brand: 'Nestle',
    packSize: '41.5g',
    unitPrice: 180,
    productsPerCase: 24,
    barcode: '4792004000069',
    description: 'Chocolate wafer bar for impulse purchases.',
    imageUrl: createCatalogArtworkDataUrl({
      brand: 'KitKat',
      titleLines: ['4 Finger'],
      subtitle: 'Chocolate wafer 41.5g',
      badge: 'Confectionery',
      primary: '#c92524',
      secondary: '#731715',
      tertiary: '#f4b19f',
      accentText: '#ffffff',
    }),
  },
];
