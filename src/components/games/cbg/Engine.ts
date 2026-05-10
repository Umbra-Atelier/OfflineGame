import { CardDef, CBG_CARDS } from './cards';

const MAP_W = 400;
const MAP_H = 600;

export interface Entity {
  id: string;
  type: 'tower' | 'troop' | 'spell';
  team: number; // 0 = host/bottom, 1 = guest/top
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  color: string;
  targetId?: string;
  attackCooldown: number;
  radius: number;
  cardId?: string; // which card spawned it
}

export interface GameState {
  entities: Entity[];
  projectiles: any[];
  elixir: [number, number]; // [host, guest]
  gameOver: boolean;
  winner: number | null;
}

const TOWER_HP = { king: 2000, archer: 1000 };

export class CBGEngine {
  state: GameState;
  
  constructor() {
    this.state = {
      entities: [],
      projectiles: [],
      elixir: [5, 5],
      gameOver: false,
      winner: null
    };
    this.initTowers();
  }

  initTowers() {
    // Host Towers (team 0)
    this.spawnTower(0, 200, 550, 'king', TOWER_HP.king);
    this.spawnTower(0, 100, 450, 'archer', TOWER_HP.archer);
    this.spawnTower(0, 300, 450, 'archer', TOWER_HP.archer);
    // Guest Towers (team 1)
    this.spawnTower(1, 200, 50, 'king', TOWER_HP.king);
    this.spawnTower(1, 100, 150, 'archer', TOWER_HP.archer);
    this.spawnTower(1, 300, 150, 'archer', TOWER_HP.archer);
  }

  spawnTower(team: number, x: number, y: number, typeStr: string, hp: number) {
    this.state.entities.push({
      id: `tower_${team}_${typeStr}_${x}`,
      type: 'tower',
      team, x, y, hp, maxHp: hp,
      damage: typeStr === 'king' ? 40 : 30,
      range: 120, speed: 0,
      color: team === 0 ? '#3b82f6' : '#ef4444',
      attackCooldown: 0,
      radius: typeStr === 'king' ? 25 : 20,
    });
  }

  update(dt: number) {
    if (this.state.gameOver) return;

    // Elixir
    this.state.elixir[0] = Math.min(10, this.state.elixir[0] + dt * 0.35);
    this.state.elixir[1] = Math.min(10, this.state.elixir[1] + dt * 0.35);

    // Towers and Troops
    for (const e of this.state.entities) {
      if (e.hp <= 0) continue;

      if (e.attackCooldown > 0) e.attackCooldown -= dt;

      // Find target
      let target = this.state.entities.find(t => t.id === e.targetId);
      if (!target || target.hp <= 0 || this.dist(e, target) > (e.range + (e.type === 'tower'? 20 : 100))) {
        e.targetId = undefined;
        // Find new target
        let closestDist = Infinity;
        let closestE = null;
        for (const t of this.state.entities) {
          if (t.team !== e.team && t.hp > 0) {
            const d = this.dist(e, t);
            if (d < closestDist) {
              closestDist = d;
              closestE = t;
            }
          }
        }
        if (closestE) {
          e.targetId = closestE.id;
          target = closestE;
        }
      }

      if (target) {
        const d = this.dist(e, target);
        if (d <= e.range + e.radius + target.radius) {
          // Attack
          if (e.attackCooldown <= 0) {
            if (e.damage < 0) { // healer
              target.hp = Math.min(target.maxHp, target.hp - e.damage);
            } else {
              target.hp -= e.damage;
            }
            e.attackCooldown = 1.0; // 1 attack per sec roughly
          }
        } else if (e.type === 'troop') {
          // Move towards target
          // Simple pathing: move to bridge first if crossed moat
          let tx = target.x;
          let ty = target.y;

          const isTopSide = e.y < 300;
          const targetIsTopSide = target.y < 300;

          if (isTopSide !== targetIsTopSide) {
             // cross moat
             const distLeftBridge = Math.abs(e.x - 100);
             const distRightBridge = Math.abs(e.x - 300);
             const bridgeX = distLeftBridge < distRightBridge ? 100 : 300;
             tx = bridgeX;
             ty = isTopSide ? 320 : 280; // move past the midline
          }

          const angle = Math.atan2(ty - e.y, tx - e.x);
          e.x += Math.cos(angle) * e.speed * dt;
          e.y += Math.sin(angle) * e.speed * dt;
        }
      } else if (e.type === 'troop') {
         // Move to other side passively, considering bridges
         let tx = e.x;
         let ty = e.team === 0 ? 0 : 600;

         const isTopSide = e.y < 300;
         const targetIsTopSide = ty < 300;

         if (isTopSide !== targetIsTopSide) {
            const distLeftBridge = Math.abs(e.x - 100);
            const distRightBridge = Math.abs(e.x - 300);
            const bridgeX = distLeftBridge < distRightBridge ? 100 : 300;
            tx = bridgeX;
            ty = isTopSide ? 320 : 280;
         }

         const angle = Math.atan2(ty - e.y, tx - e.x);
         e.x += Math.cos(angle) * e.speed * dt;
         e.y += Math.sin(angle) * e.speed * dt;
      }
    }

    // Process spells

    // Filter dead
    this.state.entities = this.state.entities.filter(e => e.hp > 0);

    // Check win condition
    const hostKing = this.state.entities.find(e => e.type === 'tower' && e.team === 0 && e.radius === 25);
    const guestKing = this.state.entities.find(e => e.type === 'tower' && e.team === 1 && e.radius === 25);

    if (!hostKing) {
      this.state.gameOver = true;
      this.state.winner = 1;
    } else if (!guestKing) {
      this.state.gameOver = true;
      this.state.winner = 0;
    }
  }

  playCard(team: number, cardId: string, x: number, y: number) {
    const card = CBG_CARDS.find(c => c.id === cardId);
    if (!card) return;

    if (this.state.elixir[team] >= card.cost) {
      this.state.elixir[team] -= card.cost;
      
      if (card.type === 'spell') {
         // Instant effect
         for (const e of this.state.entities) {
            if (this.dist({x, y}, e as any) <= card.stats.radius!) {
               e.hp -= card.stats.damage!;
            }
         }
      } else {
         const count = card.stats.count || 1;
         for (let i = 0; i < count; i++) {
           const ox = count > 1 ? (Math.random() - 0.5) * 20 : 0;
           const oy = count > 1 ? (Math.random() - 0.5) * 20 : 0;
           this.state.entities.push({
             id: `t_${Date.now()}_${Math.random()}`,
             type: 'troop',
             team,
             x: x + ox, y: y + oy,
             hp: card.stats.hp!, maxHp: card.stats.hp!,
             damage: card.stats.damage!,
             range: card.stats.range!,
             speed: card.stats.speed!,
             color: card.color,
             attackCooldown: 0,
             radius: 10,
             cardId
           });
         }
      }
    }
  }

  dist(a: {x: number, y: number}, b: {x: number, y: number}) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
