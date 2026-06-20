import { GameState, Player, Vector2, BaseEntity, Guard, Block, Switch, Door, Hazard, Bullet } from './types';

// Physics & Collision
export function checkCircleRectCollision(circle: BaseEntity, rect: BaseEntity): boolean {
  const cx = circle.pos.x;
  const cy = circle.pos.y;
  const rx = rect.pos.x;
  const ry = rect.pos.y;
  const rw = rect.width;
  const rh = rect.height;

  let testX = cx;
  let testY = cy;

  if (cx < rx) testX = rx;
  else if (cx > rx + rw) testX = rx + rw;
  if (cy < ry) testY = ry;
  else if (cy > ry + rh) testY = ry + rh;

  const distX = cx - testX;
  const distY = cy - testY;
  const distance = Math.sqrt((distX * distX) + (distY * distY));

  return distance <= circle.radius;
}

export function checkRectRectCollision(r1: BaseEntity, r2: BaseEntity): boolean {
  return r1.pos.x < r2.pos.x + r2.width &&
         r1.pos.x + r1.width > r2.pos.x &&
         r1.pos.y < r2.pos.y + r2.height &&
         r1.pos.y + r1.height > r2.pos.y;
}

export function checkCircleCircleCollision(c1: BaseEntity, c2: BaseEntity): boolean {
  const dx = c1.pos.x - c2.pos.x;
  const dy = c1.pos.y - c2.pos.y;
  return Math.sqrt(dx * dx + dy * dy) < (c1.radius + c2.radius);
}

export function lineIntersectRect(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const left = rx, right = rx + rw, top = ry, bottom = ry + rh;
  if ((x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) ||
      (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom)) return true;

  const intersects = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };

  return intersects(x1,y1,x2,y2, left,top, right,top) ||
         intersects(x1,y1,x2,y2, left,bottom, right,bottom) ||
         intersects(x1,y1,x2,y2, left,top, left,bottom) ||
         intersects(x1,y1,x2,y2, right,top, right,bottom);
}

export function checkLineOfSight(x1: number, y1: number, x2: number, y2: number, state: GameState): boolean {
  for (const w of Object.values(state.walls)) {
    if (lineIntersectRect(x1, y1, x2, y2, w.pos.x, w.pos.y, w.width, w.height)) return false;
  }
  for (const d of Object.values(state.doors)) {
    if (!d.open && lineIntersectRect(x1, y1, x2, y2, d.pos.x, d.pos.y, d.width, d.height)) return false;
  }
  for (const b of Object.values(state.blocks)) {
    if (lineIntersectRect(x1, y1, x2, y2, b.pos.x, b.pos.y, b.width, b.height)) return false;
  }
  return true;
}

function resolveRectCollision(movedBlock: BaseEntity, obstacle: BaseEntity) {
  // Push movedBlock out of obstacle
  const overlapX = Math.min(movedBlock.pos.x + movedBlock.width - obstacle.pos.x, obstacle.pos.x + obstacle.width - movedBlock.pos.x);
  const overlapY = Math.min(movedBlock.pos.y + movedBlock.height - obstacle.pos.y, obstacle.pos.y + obstacle.height - movedBlock.pos.y);

  if (overlapX < overlapY) {
    if (movedBlock.pos.x < obstacle.pos.x) movedBlock.pos.x -= overlapX;
    else movedBlock.pos.x += overlapX;
  } else {
    if (movedBlock.pos.y < obstacle.pos.y) movedBlock.pos.y -= overlapY;
    else movedBlock.pos.y += overlapY;
  }
}

export function stepEngine(state: GameState, inputs: Record<string, { dx: number, dy: number, aimDx?: number, aimDy?: number, shoot?: boolean, action: boolean, sneak: boolean }>, dt: number) {
  // Update cooldowns
  Object.values(state.players).forEach(p => { if (p.shootCooldown > 0) p.shootCooldown -= dt; });
  Object.values(state.guards).forEach(g => { if (g.shootCooldown > 0) g.shootCooldown -= dt; });
  state.bullets = state.bullets || [];

  // Reset buttons
  Object.values(state.switches).forEach(s => s.pressed = false);

  // Player Movement
  Object.keys(state.players).forEach(id => {
    const p = state.players[id];
    const input = inputs[id] || { dx: 0, dy: 0, action: false, sneak: false };
    
    // Determine movement speed based on sneaking
    const maxSpeed = p.isSlipping ? p.speed * 1.5 : (input.sneak ? p.speed * 0.4 : p.speed);
    
    p.velocity.x = p.isSlipping ? p.velocity.x * 0.9 + input.dx * (maxSpeed * 0.1) : input.dx * maxSpeed;
    p.velocity.y = p.isSlipping ? p.velocity.y * 0.9 + input.dy * (maxSpeed * 0.1) : input.dy * maxSpeed;
    
    p.pos.x += p.velocity.x * dt;
    p.pos.y += p.velocity.y * dt;

    p.stealth = input.sneak;
    
    if (input.aimDx || input.aimDy) {
        const len = Math.sqrt((input.aimDx || 0)**2 + (input.aimDy || 0)**2);
        if (len > 0) {
            p.facing = { x: input.aimDx! / len, y: input.aimDy! / len };
        }
    } else if (input.dx || input.dy) {
        const len = Math.sqrt((input.dx || 0)**2 + (input.dy || 0)**2);
        if (len > 0) {
            p.facing = { x: input.dx! / len, y: input.dy! / len };
        }
    }

    if (input.shoot && p.weapon === 'RIFLE' && p.shootCooldown <= 0) {
        p.shootCooldown = 0.2; // 5 shots per second
        const bId = 'b_' + Math.random().toString(36).substr(2, 6);
        state.bullets.push({
            id: bId,
            type: 'BULLET',
            pos: { x: p.pos.x + p.facing.x * 25, y: p.pos.y + p.facing.y * 25 },
            width: 0, height: 0, radius: 4,
            isStatic: false,
            ownerId: p.id,
            velocity: { x: p.facing.x * 600, y: p.facing.y * 600 },
            damage: 25,
            life: 1.5
        } as Bullet);
        // Slight recoil or sound info here could be propagated through state if needed
    }

    // Reset slipping
    p.isSlipping = false;

    // Check Wall Collisions
    Object.values(state.walls).forEach(w => {
      if (checkCircleRectCollision(p, w)) {
        // Simple push-out for circles (treating wall as heavy)
        const closeX = Math.max(w.pos.x, Math.min(p.pos.x, w.pos.x + w.width));
        const closeY = Math.max(w.pos.y, Math.min(p.pos.y, w.pos.y + w.height));
        const dist = Math.sqrt(Math.pow(p.pos.x - closeX, 2) + Math.pow(p.pos.y - closeY, 2));
        if (dist < p.radius && dist > 0) {
           const overlap = p.radius - dist;
           p.pos.x += ((p.pos.x - closeX) / dist) * overlap;
           p.pos.y += ((p.pos.y - closeY) / dist) * overlap;
        }
      }
    });

    // Check Door Collisions
    Object.values(state.doors).forEach(d => {
      if (!d.open && checkCircleRectCollision(p, d)) {
        const closeX = Math.max(d.pos.x, Math.min(p.pos.x, d.pos.x + d.width));
        const closeY = Math.max(d.pos.y, Math.min(p.pos.y, d.pos.y + d.height));
        const dist = Math.sqrt(Math.pow(p.pos.x - closeX, 2) + Math.pow(p.pos.y - closeY, 2));
        if (dist < p.radius && dist > 0) {
           const overlap = p.radius - dist;
           p.pos.x += ((p.pos.x - closeX) / dist) * overlap;
           p.pos.y += ((p.pos.y - closeY) / dist) * overlap;
        }
      }
    });

    // Check Block pushing
    Object.values(state.blocks).forEach(b => {
      if (checkCircleRectCollision(p, b)) {
        // Player pushes block
        b.pos.x += input.dx * (maxSpeed * 0.5) * dt;
        b.pos.y += input.dy * (maxSpeed * 0.5) * dt;
        
        // Push player outside of block to avoid overlap
        const closeX = Math.max(b.pos.x, Math.min(p.pos.x, b.pos.x + b.width));
        const closeY = Math.max(b.pos.y, Math.min(p.pos.y, b.pos.y + b.height));
        const dist = Math.sqrt(Math.pow(p.pos.x - closeX, 2) + Math.pow(p.pos.y - closeY, 2));
        if (dist < p.radius && dist > 0) {
           const overlap = p.radius - dist;
           p.pos.x += ((p.pos.x - closeX) / dist) * overlap;
           p.pos.y += ((p.pos.y - closeY) / dist) * overlap;
        }
      }
    });

    // Check Hazards (Grease / Heat)
    Object.values(state.hazards).forEach(h => {
      if (checkCircleRectCollision(p, h)) {
        if (h.type === 'HAZARD_GREASE') {
          if (!p.powerups.includes('LIGHT_FOOT')) {
            p.isSlipping = true;
          }
        } else if (h.type === 'HAZARD_HEAT') {
          const mitigation = p.powerups.includes('THERMAL_SUIT') ? 0.2 : 1.0;
          p.health -= 20 * dt * mitigation;
        }
      }
    });
    
    // Loot
    if (state.loot && checkCircleRectCollision(p, state.loot)) {
       state.stage = 'VICTORY';
    }
  });

  // Block logic
  Object.values(state.blocks).forEach(b => {
    // Blocks vs Walls
    Object.values(state.walls).forEach(w => {
      if (checkRectRectCollision(b, w)) resolveRectCollision(b, w);
    });
    // Blocks vs Doors
    Object.values(state.doors).forEach(d => {
      if (!d.open && checkRectRectCollision(b, d)) resolveRectCollision(b, d);
    });
    Object.values(state.blocks).forEach(ob => {
      if (b.id !== ob.id && checkRectRectCollision(b, ob)) resolveRectCollision(b, ob);
    });
  });

  // Switch logic - Player standing
  Object.values(state.switches).forEach(s => {
    let pushed = false;
    Object.values(state.players).forEach(p => {
      if (checkCircleRectCollision(p, s)) pushed = true;
    });
    Object.values(state.blocks).forEach(b => {
      if (checkRectRectCollision(b, s)) pushed = true;
    });
    s.pressed = pushed;
    
    if (s.targetId === 'START_HEIST' && s.pressed && (state.stage === 'PLAYING' || state.stage === 'LOBBY_ROOM' as any)) {
       state.stage = 'START_HEIST' as any;
    }
  });

  // Door logic driven by switches
  Object.values(state.doors).forEach(d => {
     let allPressed = true;
     let hasSwitches = false;
     Object.values(state.switches).forEach(s => {
       if (s.targetId === d.id) {
         hasSwitches = true;
         if (!s.pressed) allPressed = false;
       }
     });
     
     if (hasSwitches && allPressed) {
       d.open = true;
     }
  });

  // Guards
  Object.values(state.guards).forEach(g => {
    if (g.stunTimer > 0) {
      g.stunTimer -= dt;
      return;
    }

    if (g.state === 'PATROL' && g.patrolPath.length > 0) {
      const target = g.patrolPath[g.currentPatrolIdx];
      const dx = target.x - g.pos.x;
      const dy = target.y - g.pos.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist < 10) {
        g.currentPatrolIdx = (g.currentPatrolIdx + 1) % g.patrolPath.length;
      } else {
        const moveDist = 50 * dt;
        g.pos.x += (dx / dist) * moveDist;
        g.pos.y += (dy / dist) * moveDist;
        g.facing = { x: dx/dist, y: dy/dist };
      }
    } else if (g.state === 'ALERT' && g.lastKnownPlayerPos) {
      const target = g.lastKnownPlayerPos;
      const dx = target.x - g.pos.x;
      const dy = target.y - g.pos.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist < 10) {
        g.state = 'PATROL';
        g.alertedPlayerId = null;
      } else {
        // Find player speed or use default
        const playerSpeed = Object.values(state.players).length > 0 ? Object.values(state.players)[0].speed : 200;
        const slowSpeed = playerSpeed * 0.6; // walk slower than player
        const moveDist = slowSpeed * dt;
        g.pos.x += (dx / dist) * moveDist;
        g.pos.y += (dy / dist) * moveDist;
        g.facing = { x: dx/dist, y: dy/dist };
      }
    }

    // Vision cone check for players
    Object.values(state.players).forEach(p => {
       const dx = p.pos.x - g.pos.x;
       const dy = p.pos.y - g.pos.y;
       const distSq = dx*dx + dy*dy;
       const stealthFactor = p.stealth ? 0.2 : ((p.powerups || []).includes('INVIS_CLOAK') ? 0.25 : 1.0);
       const sightDist = g.viewRadius * stealthFactor;

       if (distSq < sightDist * sightDist) {
         // rough angle check
         const dist = Math.sqrt(distSq);
         const px = dx / dist;
         const py = dy / dist;
         const dot = px * g.facing.x + py * g.facing.y;
         const angle = Math.acos(dot);
         if (angle < g.viewAngle / 2) {
           if (checkLineOfSight(g.pos.x, g.pos.y, p.pos.x, p.pos.y, state)) {
             // Spotted! Update state and shoot
             g.state = 'ALERT';
             g.alertedPlayerId = p.id;
             g.lastKnownPlayerPos = { x: p.pos.x, y: p.pos.y };
             
             if (g.shootCooldown <= 0 && dist > 80) { // keep some distance before shooting? Or just shoot.
               g.shootCooldown = 0.5; // 2 shots per second
               const bId = 'b_' + Math.random().toString(36).substr(2, 6);
               state.bullets.push({
                   id: bId,
                   type: 'BULLET',
                   pos: { x: g.pos.x + px * 25, y: g.pos.y + py * 25 },
                   width: 0, height: 0, radius: 4,
                   isStatic: false,
                   ownerId: g.id,
                   velocity: { x: px * 400, y: py * 400 },
                   damage: 15, // guards do less damage per bullet
                   life: 1.5
               } as Bullet);
             }
           }
         }
       }
    });

    // Simple wall collision for guards
    Object.values(state.walls).forEach(w => {
      if (checkCircleRectCollision(g, w)) {
        const closeX = Math.max(w.pos.x, Math.min(g.pos.x, w.pos.x + w.width));
        const closeY = Math.max(w.pos.y, Math.min(g.pos.y, w.pos.y + w.height));
        const cdist = Math.sqrt(Math.pow(g.pos.x - closeX, 2) + Math.pow(g.pos.y - closeY, 2));
        if (cdist < g.radius && cdist > 0) {
           const overlap = g.radius - cdist;
           g.pos.x += ((g.pos.x - closeX) / cdist) * overlap;
           g.pos.y += ((g.pos.y - closeY) / cdist) * overlap;
        }
      }
    });
  });

  // Bullet Updates
  for (let i = state.bullets.length - 1; i >= 0; i--) {
     const b = state.bullets[i];
     b.pos.x += b.velocity.x * dt;
     b.pos.y += b.velocity.y * dt;
     b.life -= dt;
     
     let hit = false;

     // Wall collision
     Object.values(state.walls).forEach(w => {
       if (!hit && checkCircleRectCollision(b, w)) hit = true;
     });
     Object.values(state.doors).forEach(d => {
       if (!hit && !d.open && checkCircleRectCollision(b, d)) hit = true;
     });

     // Player & Guard collision
     if (!hit) {
        Object.values(state.guards).forEach(g => {
           if (!hit && b.ownerId !== g.id && checkCircleCircleCollision(b, g)) {
               g.health -= b.damage;
               if (g.health <= 0) {
                   g.health = 0;
                   // drop loot or points?
               }
               hit = true;
           }
        });
        Object.values(state.players).forEach(p => {
           if (!hit && b.ownerId !== p.id && checkCircleCircleCollision(b, p)) {
               p.health -= b.damage;
               // getting hit increases heat?
               state.heat += 1;
               hit = true;
           }
        });
     }

     if (b.life <= 0 || hit) {
         state.bullets.splice(i, 1);
     }
  }

  // Remove dead guards
  Object.keys(state.guards).forEach(gid => {
     if (state.guards[gid].health <= 0) delete state.guards[gid];
  });

  // Death
  Object.values(state.players).forEach(p => {
    if (p.health <= 0) p.health = 0; // Trigger defeat or respawn later
  });

  if (state.heat > 100) state.heat = 100;
  
  if (Object.values(state.players).every(p => p.health <= 0)) {
     state.stage = 'GAME_OVER';
  }
}
