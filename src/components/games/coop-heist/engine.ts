import { GameState, Player, Vector2, BaseEntity, Guard, Block, Switch, Door, Hazard } from './types';

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

export function stepEngine(state: GameState, inputs: Record<string, { dx: number, dy: number, action: boolean, sneak: boolean }>, dt: number) {
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
     
     if (hasSwitches) {
       d.open = allPressed;
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
    }

    // Vision cone check for players
    Object.values(state.players).forEach(p => {
       const dx = p.pos.x - g.pos.x;
       const dy = p.pos.y - g.pos.y;
       const distSq = dx*dx + dy*dy;
       const stealthFactor = p.powerups.includes('INVIS_CLOAK') ? 0.25 : 0.5;
       const sightDist = p.stealth ? g.viewRadius * stealthFactor : g.viewRadius;

       if (distSq < sightDist * sightDist) {
         // rough angle check
         const dist = Math.sqrt(distSq);
         const px = dx / dist;
         const py = dy / dist;
         const dot = px * g.facing.x + py * g.facing.y;
         const angle = Math.acos(dot);
         if (angle < g.viewAngle / 2) {
           // Spotted!
           p.health -= 50 * dt;
           state.heat += 10 * dt; // Using loud/caught increases heat
         }
       }
    });
    
    // Player attacking guard
    Object.values(state.players).forEach(p => {
       const input = inputs[p.id];
       if (input && input.action && checkCircleCircleCollision(p, g)) {
         if (g.stunTimer <= 0) {
           state.heat += 15; // Major heat increase for assaulting guards
         }
         g.stunTimer = p.powerups.includes('STUN_BATON') ? 10.0 : 5.0;
       }
    });
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
