import { GameState, Vector2, Player, Guard } from './types';

function createRoomFeatures(state: GameState, roomX: number, roomY: number, sizeX: number, sizeY: number, seed: number, doorId: string) {
  const count = Object.keys(state.walls).length;
  // A pseudo-random function based on seed
  const prng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  
  const complexity = Math.floor(prng() * 10); // 0 to 9
  const pattern = Math.floor(prng() * 50); // 50 unique base puzzle setups
  
  // We'll define a few base puzzle components and combine them based on 'pattern'
  const hasGuards = pattern % 2 === 0;
  const hasBlocks = pattern % 3 !== 0;
  const hasHeat = pattern % 5 === 0 || pattern % 7 === 0;
  const hasGrease = pattern % 4 === 0 || pattern % 6 === 0;

  const numSwitches = 1 + (pattern % 3);
  
  // Switch placements
  for (let s = 0; s < numSwitches; s++) {
    const sx = roomX + 100 + prng() * (sizeX - 200);
    const sy = roomY + 100 + prng() * (sizeY - 200);
    state.switches[`sw_${count}_${s}`] = { id: `sw_${count}_${s}`, type: 'BUTTON', pos: {x: sx, y: sy}, width: 40, height: 40, radius: 0, isStatic: true, pressed: false, targetId: doorId };
  }

  // Block placements
  if (hasBlocks) {
    const numBlocks = 1 + (pattern % 2);
    for (let b = 0; b < numBlocks; b++) {
      const bx = roomX + 200 + prng() * (sizeX - 400);
      const by = roomY + 200 + prng() * (sizeY - 400);
      state.blocks[`blk_${count}_${b}`] = { id: `blk_${count}_${b}`, type: 'BLOCK', pos: {x: bx, y: by}, width: 50, height: 50, radius: 0, isStatic: false, velocity: {x:0, y:0} };
    }
  }

  // Hazard placements
  if (hasGrease) {
    const w = 150 + prng() * 150;
    const h = 150 + prng() * 150;
    const hx = roomX + prng() * (sizeX - w);
    const hy = roomY + prng() * (sizeY - h);
    state.hazards[`hz_g_${count}`] = { id: `hz_g_${count}`, type: 'HAZARD_GREASE', pos: {x: hx, y: hy}, width: w, height: h, radius: 0, isStatic: true };
  }
  
  if (hasHeat) {
    const isVertical = prng() > 0.5;
    const w = isVertical ? 60 + prng()*40 : sizeX - 100;
    const h = isVertical ? sizeY - 100 : 60 + prng()*40;
    const hx = roomX + 50 + prng() * (sizeX - w - 100);
    const hy = roomY + 50 + prng() * (sizeY - h - 100);
    state.hazards[`hz_h_${count}`] = { id: `hz_h_${count}`, type: 'HAZARD_HEAT', pos: {x: hx, y: hy}, width: w, height: h, radius: 0, isStatic: true };
  }

  // Guard placements
  const heatGuardBonus = Math.floor(state.heat / 25);
  if (hasGuards || heatGuardBonus > 0) {
     const numGuards = 1 + Math.floor(complexity / 4) + heatGuardBonus;
     const heatViewBonus = state.heat * 1.2;
     const heatSpeedMult = 1 + (state.heat / 100);
     for (let g = 0; g < numGuards; g++) {
       const gx = roomX + 150 + prng() * (sizeX - 300);
       const gy = roomY + 150 + prng() * (sizeY - 300);
       // drones patrol further and faster
       const patrolDist = 150 * heatSpeedMult;
       const p1 = {x: gx, y: gy};
       const angleOffset = prng() * Math.PI * 2;
       
       // Multiple patrol points to spread them out
       const pathLength = 3 + Math.floor(prng() * 4);
       const path = [];
       let cx = gx; let cy = gy;
       for (let pIdx = 0; pIdx < pathLength; pIdx++) {
         path.push({x: cx, y: cy});
         cx += Math.cos(angleOffset + pIdx * Math.PI/2) * patrolDist * (prng() + 0.5);
         cy += Math.sin(angleOffset + pIdx * Math.PI/2) * patrolDist * (prng() + 0.5);
         // bounds check roughly
         cx = Math.max(roomX + 50, Math.min(roomX + sizeX - 50, cx));
         cy = Math.max(roomY + 50, Math.min(roomY + sizeY - 50, cy));
       }
       
       // High heat -> more view angle, maybe 360 drone if heat > 80
       const angle = state.heat > 80 ? Math.PI * 2 : (Math.PI / 3) + state.heat * 0.01;

       state.guards[`grd_${count}_${g}`] = { 
         id: `grd_${count}_${g}`, type: 'GUARD', pos: {x: gx, y: gy}, width: 0, height: 0, radius: 25, isStatic: false,
         patrolPath: path, currentPatrolIdx: 0, viewAngle: angle, viewRadius: 180 + heatViewBonus, facing: {x: 1, y: 0}, state: 'PATROL', stunTimer: 0
       };
     }
  }

  // Inner walls for maze structure
  if (complexity > 5) {
     const w = 20;
     const h = 150;
     const wx = roomX + 250;
     const wy = roomY + 100;
     state.walls[`w_i_${count}`] = { id: `w_i_${count}`, type: 'WALL', pos: {x: wx, y: wy}, width: w, height: h, radius: 0, isStatic: true };
  }
}

function addPuzzleRoom(state: GameState, roomX: number, roomY: number, sizeX: number, sizeY: number, seed: number) {
  const count = Object.keys(state.walls).length;
  
  // Boundary walls
  state.walls[`w_${count}_top`] = { id: `w_${count}_top`, type: 'WALL', pos: {x: roomX, y: roomY}, width: sizeX, height: 20, radius: 0, isStatic: true };
  state.walls[`w_${count}_bot`] = { id: `w_${count}_bot`, type: 'WALL', pos: {x: roomX, y: roomY + sizeY - 20}, width: sizeX, height: 20, radius: 0, isStatic: true };
  state.walls[`w_${count}_left`] = { id: `w_${count}_left`, type: 'WALL', pos: {x: roomX, y: roomY}, width: 20, height: sizeY, radius: 0, isStatic: true };
  
  // Leave right side open for door
  const doorId = `door_${count}`;
  state.walls[`w_${count}_right`] = { id: `w_${count}_right`, type: 'WALL', pos: {x: roomX + sizeX - 20, y: roomY}, width: 20, height: sizeY / 2 - 60, radius: 0, isStatic: true };
  state.walls[`w_${count}_right_2`] = { id: `w_${count}_right_2`, type: 'WALL', pos: {x: roomX + sizeX - 20, y: roomY + sizeY / 2 + 60}, width: 20, height: sizeY / 2 - 60, radius: 0, isStatic: true };
  state.doors[doorId] = { id: doorId, type: 'DOOR', pos: {x: roomX + sizeX - 20, y: roomY + sizeY / 2 - 60}, width: 20, height: 120, radius: 0, isStatic: true, open: false };

  createRoomFeatures(state, roomX, roomY, sizeX, sizeY, seed, doorId);
}

export function generateLevel(levelIdx: number, playersRaw: any[], currentHeat: number = 0): GameState {
  const state: GameState = {
    level: levelIdx,
    stage: 'PLAYING',
    heat: currentHeat,
    players: {},
    guards: {},
    blocks: {},
    walls: {},
    switches: {},
    doors: {},
    hazards: {},
    loot: null,
    cameraOffset: {x: 0, y: 0},
    levelTimer: 0,
    powerupChoices: []
  };

  playersRaw.forEach((p, idx) => {
    state.players[p.id] = {
      id: p.id,
      type: 'PLAYER',
      pos: { x: 100 + (idx * 50), y: 300 },
      width: 0, height: 0, radius: 20, isStatic: false,
      health: 100, maxHealth: 100, speed: 180 + ((p.powerups || []).includes('SPEED_BOOST') ? 40 : 0), 
      stealth: false, weapon: 'NONE', score: 0,
      name: p.name, color: idx === 0 ? '#3b82f6' : idx === 1 ? '#ef4444' : '#10b981',
      velocity: {x:0, y:0}, isSlipping: false, powerups: p.powerups || []
    };
    if ((p.powerups || []).includes('HEALTH_PACK')) {
      state.players[p.id].maxHealth = 150;
      state.players[p.id].health = 150;
    }
  });

  if (levelIdx === 0) {
    // Generate safe exterior starting zone
    const roomW = 800;
    const roomH = 600;
    state.walls[`w_start_top`] = { id: `w_start_top`, type: 'WALL', pos: {x: 0, y: 0}, width: roomW, height: 20, radius: 0, isStatic: true };
    state.walls[`w_start_bot`] = { id: `w_start_bot`, type: 'WALL', pos: {x: 0, y: roomH - 20}, width: roomW, height: 20, radius: 0, isStatic: true };
    state.walls[`w_start_left`] = { id: `w_start_left`, type: 'WALL', pos: {x: 0, y: 0}, width: 20, height: roomH, radius: 0, isStatic: true };
    state.walls[`w_start_right`] = { id: `w_start_right`, type: 'WALL', pos: {x: roomW - 20, y: 0}, width: 20, height: roomH, radius: 0, isStatic: true };
    
    state.switches['sw_start'] = { id: 'sw_start', type: 'BUTTON', pos: {x: roomW / 2 - 40, y: roomH / 2 - 40}, width: 80, height: 80, radius: 0, isStatic: true, pressed: false, targetId: 'START_HEIST' };
    
    state.loot = null;
    return state;
  }

  // Base bounding
  const numRooms = 3 + Math.floor(levelIdx / 5); // 3 rooms initially, increasing by 1 every 5 levels
  const roomW = 600;
  const roomH = 600;

  for (let i = 0; i < numRooms; i++) {
     const seed = levelIdx * 100 + i * 37 + Math.floor(Math.random() * 1000000); // randomize seed
     addPuzzleRoom(state, i * roomW, 0, roomW, roomH, seed);
  }

  // Set loot at the end
  state.loot = {
    id: 'loot', type: 'LOOT', pos: {x: numRooms * roomW + 150, y: roomH / 2}, width: 60, height: 60, radius: 0, isStatic: true
  };
  
  // Close the rightmost end so players don't walk off
  state.walls[`w_end_cap`] = { id: `w_end_cap`, type: 'WALL', pos: {x: numRooms * roomW + 300, y: 0}, width: 20, height: roomH, radius: 0, isStatic: true };
  state.walls[`w_end_top`] = { id: `w_end_top`, type: 'WALL', pos: {x: numRooms * roomW, y: 0}, width: 320, height: 20, radius: 0, isStatic: true };
  state.walls[`w_end_bot`] = { id: `w_end_bot`, type: 'WALL', pos: {x: numRooms * roomW, y: roomH - 20}, width: 320, height: 20, radius: 0, isStatic: true };

  return state;
}
