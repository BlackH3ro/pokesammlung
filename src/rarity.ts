// Rarity order (higher = rarer) and short labels, for TCGdex's German and English rarity names.
const TABLE: [rank: number, short: string, names: string[]][] = [
  [1, 'C', ['Häufig', 'Common', 'Une Diamant', 'One Diamond']],
  [2, 'U', ['Ungewöhnlich', 'Uncommon', 'deux Diamant', 'Two Diamond']],
  [3, 'Promo', ['Promo']],
  [4, 'R', ['Selten', 'Rare', 'Trois Diamant', 'Three Diamond']],
  [5, 'Holo', ['Selten, Holografisch', 'Holografisch Selten', 'Rare Holo', 'Holo Rare', 'Quatre Diamant', 'Four Diamond']],
  [6, 'Holo', ['Selten, Holografisch LV.X', 'Rare Holo LV.X', 'selten, Primus', 'Rare PRIME', 'LEGENDE', 'LEGEND']],
  [7, 'V', ['Holografisch Selten V', 'Holo Rare V', 'Holografisch Selten VMAX', 'Holo Rare VMAX', 'Holografisch Selten VSTAR', 'Holo Rare VSTAR']],
  [8, 'ex', ['Doppelselten', 'Double rare']],
  [9, 'ACE', ['ASS-KLASSE', 'ACE SPEC Rare', 'Selten, Strahlend', 'Radiant Rare', 'Atemberaubend', 'Amazing Rare']],
  [10, 'Spezial', ['Pikachu Rare', 'Mega Attack Rare', 'Futuristic Rare', 'Schwarz-Weiß Selten', 'Black White Rare', 'Classic Collection']],
  [11, 'Shiny', ['Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Une Étoile', 'One Star', 'Un Chromatique', 'One Shiny']],
  [12, 'UR', ['Ultra Selten', 'Ultra Rare', 'Vollkunsttrainer', 'Full Art Trainer', 'deux Étoiles', 'Two Star', 'Deux Chromatique', 'Two Shiny']],
  [13, 'IR', ['Selten, Illustration', 'Illustration rare', 'Trois Étoiles', 'Three Star']],
  [14, 'Secret', ['Versteckt Selten', 'Secret Rare', 'ultraselten, Schillernd', 'Shiny Ultra Rare']],
  [15, 'SIR', ['Selten, besondere Illustration', 'Special illustration rare']],
  [16, 'Gold', ['Hyperselten', 'Hyper rare', 'Couronne', 'Crown']],
  [17, 'MUR', ['Mega Hyper Selten', 'Mega Hyper Rare']],
  [18, 'RGB', ['RGB Rare']],
];

const BY_NAME = new Map<string, { rank: number; short: string }>();
for (const [rank, short, names] of TABLE) for (const n of names) BY_NAME.set(n.toLowerCase(), { rank, short });

export function rarityInfo(rarity: string) {
  if (!rarity) return { rank: 0, short: '' };
  return BY_NAME.get(rarity.toLowerCase()) ?? { rank: 0, short: '' };
}
