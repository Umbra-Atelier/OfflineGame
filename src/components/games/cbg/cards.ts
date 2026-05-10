export interface CardDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  secret: string;
  isBase: boolean;
  type: 'troop' | 'spell' | 'building';
  stats: {
    hp?: number;
    damage?: number;
    range?: number;
    speed?: number;
    count?: number; // swarm
    radius?: number; // spell
    duration?: number;
  };
  color: string;
}

export const CBG_CARDS: CardDef[] = [
  // Base 12
  { id: 'c1', name: 'Squire', description: 'Basic melee unit', cost: 2, secret: 'sword buddy', isBase: true, type: 'troop', color: '#3b82f6', stats: { hp: 100, damage: 20, range: 15, speed: 30, count: 1 } },
  { id: 'c2', name: 'Bowman', description: 'Basic ranged unit', cost: 3, secret: 'arrow shooter', isBase: true, type: 'troop', color: '#10b981', stats: { hp: 50, damage: 15, range: 100, speed: 25, count: 1 } },
  { id: 'c3', name: 'Big Guy', description: 'High HP, slow', cost: 5, secret: 'heavy steps', isBase: true, type: 'troop', color: '#f59e0b', stats: { hp: 300, damage: 30, range: 15, speed: 15, count: 1 } },
  { id: 'c4', name: 'Small Swarm', description: 'Group of weak units', cost: 3, secret: 'many friends', isBase: true, type: 'troop', color: '#8b5cf6', stats: { hp: 20, damage: 5, range: 10, speed: 35, count: 4 } },
  { id: 'c5', name: 'Fire Spell', description: 'Deals damage in an area', cost: 4, secret: 'hot fire', isBase: true, type: 'spell', color: '#ef4444', stats: { damage: 80, radius: 40 } },
  { id: 'c6', name: 'Runner', description: 'Very fast melee', cost: 3, secret: 'speedy legs', isBase: true, type: 'troop', color: '#06b6d4', stats: { hp: 80, damage: 25, range: 15, speed: 50, count: 1 } },
  { id: 'c7', name: 'Defender', description: 'Stationary building', cost: 4, secret: 'wall of stone', isBase: true, type: 'building', color: '#64748b', stats: { hp: 250, damage: 0, range: 0, speed: 0, count: 1 } },
  { id: 'c8', name: 'Spear Guy', description: 'Medium range, fragile', cost: 2, secret: 'pointy stick', isBase: true, type: 'troop', color: '#fcd34d', stats: { hp: 40, damage: 15, range: 60, speed: 30, count: 1 } },
  { id: 'c9', name: 'Healer', description: 'Heals nearby allies', cost: 4, secret: 'magic touch', isBase: true, type: 'troop', color: '#f472b6', stats: { hp: 70, damage: -15, range: 30, speed: 20, count: 1 } },
  { id: 'c10', name: 'Flying Eye', description: 'Flying unit', cost: 3, secret: 'all seeing', isBase: true, type: 'troop', color: '#c084fc', stats: { hp: 60, damage: 18, range: 40, speed: 35, count: 1 } },
  { id: 'c11', name: 'Big Brawler', description: 'Area melee damage', cost: 4, secret: 'spin attack', isBase: true, type: 'troop', color: '#b45309', stats: { hp: 150, damage: 20, range: 25, speed: 25, count: 1 } },
  { id: 'c12', name: 'Arrow Volley', description: 'Wider area, low damage', cost: 3, secret: 'rain of arrows', isBase: true, type: 'spell', color: '#94a3b8', stats: { damage: 30, radius: 60 } },

  // Unlockable 12
  { id: 'c13', name: 'Dragon', description: 'Strong flying unit', cost: 5, secret: 'fire breather', isBase: false, type: 'troop', color: '#e11d48', stats: { hp: 200, damage: 40, range: 40, speed: 30, count: 1 } },
  { id: 'c14', name: 'Kings Guard', description: 'Armored defender', cost: 6, secret: 'royal shield', isBase: false, type: 'troop', color: '#fbbf24', stats: { hp: 400, damage: 25, range: 15, speed: 20, count: 1 } },
  { id: 'c15', name: 'Ice Spirit', description: 'Freezes on impact', cost: 1, secret: 'cold shoulder', isBase: false, type: 'troop', color: '#7dd3fc', stats: { hp: 20, damage: 5, range: 15, speed: 45, count: 1 } },
  { id: 'c16', name: 'Lightning', description: 'Massive damage', cost: 6, secret: 'sky thunder', isBase: false, type: 'spell', color: '#fde047', stats: { damage: 150, radius: 30 } },
  { id: 'c17', name: 'Undead Army', description: 'Huge swarm', cost: 4, secret: 'bone rattle', isBase: false, type: 'troop', color: '#d1d5db', stats: { hp: 10, damage: 5, range: 10, speed: 30, count: 10 } },
  { id: 'c18', name: 'Assassin', description: 'High burst damage', cost: 4, secret: 'shadow strike', isBase: false, type: 'troop', color: '#111827', stats: { hp: 60, damage: 80, range: 15, speed: 55, count: 1 } },
  { id: 'c19', name: 'Siege Engine', description: 'Long range tower damage', cost: 5, secret: 'rock thrower', isBase: false, type: 'troop', color: '#78350f', stats: { hp: 120, damage: 50, range: 120, speed: 15, count: 1 } },
  { id: 'c20', name: 'Poison Cloud', description: 'Damage over time', cost: 4, secret: 'toxic breath', isBase: false, type: 'spell', color: '#166534', stats: { damage: 10, radius: 50, duration: 5 } },
  { id: 'c21', name: 'Giant Zombie', description: 'Spawns units on death', cost: 7, secret: 'undead giant', isBase: false, type: 'troop', color: '#14532d', stats: { hp: 350, damage: 30, range: 15, speed: 12, count: 1 } },
  { id: 'c22', name: 'Twin Archers', description: 'Two ranged units', cost: 5, secret: 'double trouble', isBase: false, type: 'troop', color: '#34d399', stats: { hp: 50, damage: 15, range: 100, speed: 25, count: 2 } },
  { id: 'c23', name: 'Golem', description: 'Immense health', cost: 8, secret: 'rock monster', isBase: false, type: 'troop', color: '#475569', stats: { hp: 600, damage: 40, range: 20, speed: 10, count: 1 } },
  { id: 'c24', name: 'Healing Spell', description: 'Heals area', cost: 3, secret: 'light burst', isBase: false, type: 'spell', color: '#fecdd3', stats: { damage: -50, radius: 45 } },

  // Unlockable Additional 12
  { id: 'c25', name: 'Valkyrie', description: 'Area melee damage', cost: 4, secret: 'spin to win', isBase: false, type: 'troop', color: '#ea580c', stats: { hp: 160, damage: 30, range: 20, speed: 25, count: 1 } },
  { id: 'c26', name: 'Bomb Cart', description: 'Explodes on impact building', cost: 3, secret: 'boom stick', isBase: false, type: 'troop', color: '#1f2937', stats: { hp: 50, damage: 200, range: 15, speed: 45, count: 1 } },
  { id: 'c27', name: 'Ninja', description: 'Fast, double strike', cost: 4, secret: 'shadow walk', isBase: false, type: 'troop', color: '#4c1d95', stats: { hp: 90, damage: 35, range: 15, speed: 50, count: 1 } },
  { id: 'c28', name: 'Frost Tower', description: 'Slows enemies', cost: 5, secret: 'winter hold', isBase: false, type: 'building', color: '#93c5fd', stats: { hp: 300, damage: 10, range: 90, speed: 0, count: 1 } },
  { id: 'c29', name: 'Fire Spirits', description: 'Fragile splash units', cost: 2, secret: 'hot coals', isBase: false, type: 'troop', color: '#ef4444', stats: { hp: 10, damage: 40, range: 10, speed: 60, count: 3 } },
  { id: 'c30', name: 'Log', description: 'Rolls and damages', cost: 2, secret: 'timber fall', isBase: false, type: 'spell', color: '#a16207', stats: { damage: 60, radius: 25 } },
  { id: 'c31', name: 'Electro Wizard', description: 'Stuns targets', cost: 4, secret: 'shock therapy', isBase: false, type: 'troop', color: '#fef08a', stats: { hp: 60, damage: 20, range: 50, speed: 25, count: 1 } },
  { id: 'c32', name: 'Royal Pig', description: 'Jumps river, hits towers', cost: 5, secret: 'oink oink', isBase: false, type: 'troop', color: '#fca5a5', stats: { hp: 200, damage: 45, range: 10, speed: 40, count: 1 } },
  { id: 'c33', name: 'Tornado', description: 'Pulls enemies', cost: 3, secret: 'spin cycle', isBase: false, type: 'spell', color: '#6ee7b7', stats: { damage: 10, radius: 60 } },
  { id: 'c34', name: 'Executioner', description: 'Piercing axe throw', cost: 5, secret: 'axe toss', isBase: false, type: 'troop', color: '#1e293b', stats: { hp: 120, damage: 40, range: 45, speed: 20, count: 1 } },
  { id: 'c35', name: 'Cannon Cart', description: 'Mobile cannon', cost: 5, secret: 'wheel barrel', isBase: false, type: 'troop', color: '#854d0e', stats: { hp: 150, damage: 50, range: 60, speed: 20, count: 1 } },
  { id: 'c36', name: 'Mega Knight', description: 'Huge jump damage', cost: 7, secret: 'heavy drop', isBase: false, type: 'troop', color: '#334155', stats: { hp: 450, damage: 50, range: 15, speed: 18, count: 1 } }
];
