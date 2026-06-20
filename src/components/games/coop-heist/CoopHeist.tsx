import React, { useEffect, useState, useRef } from 'react';
import { GameState, Vector2 } from './types';
import { generateLevel } from './level-gen';
import { stepEngine } from './engine';

interface CoopHeistProps {
  channels: Map<string, RTCDataChannel>;
  isHost: boolean;
  myId: string;
  myName: string;
  guests: { id: string; name: string }[];
  onBackToLobby: () => void;
}

// Global Asset Cache
const Assets = {
  guard: new Image(),
  player: new Image(),
  wall: new Image(),
  door: new Image(),
  block: new Image()
};
// Setting src will load them asynchronously. They will 404 until user uploads them to /public/assets/.
Assets.guard.src = '/assets/guard.png';
Assets.player.src = '/assets/player.png';
Assets.wall.src = '/assets/wall.png';
Assets.door.src = '/assets/door.png';
Assets.block.src = '/assets/block.png';

export function CoopHeist({ channels, isHost, myId, myName, guests, onBackToLobby }: CoopHeistProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);
  
  // Input tracking
  const inputsRef = useRef<Record<string, { dx: number, dy: number, action: boolean, sneak: boolean }>>({});
  
  // Powerup state for UI
  const [showPowerups, setShowPowerups] = useState(false);
  const [levelInfo, setLevelInfo] = useState({ level: 1, message: '' });

  useEffect(() => {
    // Initialize host state
    if (isHost) {
      if (!stateRef.current || ((stateRef.current as any).stage === 'LOBBY_ROOM')) {
          const allPlayers = [{ id: myId, name: myName }, ...guests.map(g => ({ id: g.id, name: g.name }))];
          const initialLevel = generateLevel(0, allPlayers);
          stateRef.current = initialLevel;
          setGameState(initialLevel);
          setshowLevelMessage(0, 'PREPARE FOR HEIST');
      } else if (stateRef.current) {
          // Mid-game join block
          guests.forEach((g, idx) => {
             if (!stateRef.current!.players[g.id]) {
                 stateRef.current!.players[g.id] = {
                   id: g.id,
                   type: 'PLAYER',
                   pos: { x: 150 + idx * 50, y: 300 },
                   width: 0, height: 0, radius: 20, isStatic: false,
                   health: 100, maxHealth: 100, speed: 180, 
                   stealth: false, weapon: 'RIFLE', score: 0,
                   name: g.name, color: '#' + Math.floor(Math.random()*16777215).toString(16),
                   velocity: {x:0, y:0}, isSlipping: false, powerups: [], facing: {x: 1, y: 0}, shootCooldown: 0
                 };
             }
          });
      }
    }

    // Networking
    const handleMessage = (e: MessageEvent, peerId: string) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'HEIST_INPUT' && isHost) {
          inputsRef.current[peerId] = msg.input;
        } else if (msg.type === 'HEIST_STATE' && !isHost) {
          stateRef.current = msg.state;
          setGameState(msg.state);
        } else if (msg.type === 'HEIST_MSG' && !isHost) {
           if (msg.event === 'LVL_ADV') setshowLevelMessage(msg.level, `INFILTRATION SUCCESS - SECURING LEVEL ${msg.level}`);
           if (msg.event === 'LVL_FAIL') setshowLevelMessage(msg.level, `MISSION FAILED - REGREZZING TO LEVEL ${msg.level}`);
        } else if (msg.type === 'HEIST_POWERUP_SELECT' && isHost) {
           handlePowerupSelect(msg.powerup);
        }
      } catch (err) {}
    };

    channels.forEach((chan, id) => {
      chan.addEventListener('message', (e) => handleMessage(e, id));
    });

    return () => {
      channels.forEach((chan, id) => {
        chan.removeEventListener('message', (e) => handleMessage(e, id));
      });
    };
  }, [channels, isHost, guests, myId, myName]);

  const setshowLevelMessage = (lvl: number, msg: string) => {
    setLevelInfo({ level: lvl, message: msg });
    setTimeout(() => {
       setLevelInfo(prev => ({ ...prev, message: '' }));
    }, 3000);
  };

  const HEAT_COSTS: Record<string, number> = {
    SPEED_BOOST: 15,
    INVIS_CLOAK: 25,
    STUN_BATON: 20,
    HEALTH_PACK: 10,
    LIGHT_FOOT: 15,
    THERMAL_SUIT: 15
  };

  const handlePowerupSelect = (powerupId: string) => {
    if (!isHost || !stateRef.current) return;
    const state = stateRef.current;
    
    // Assign to all players
    Object.values(state.players).forEach((p: any) => {
       if (!p.powerups) p.powerups = [];
       if (!p.powerups.includes(powerupId)) p.powerups.push(powerupId);
    });
    
    const heatIncrease = HEAT_COSTS[powerupId] || 0;
    const nextHeat = Math.min(100, (state.heat || 0) + heatIncrease);

    const allPlayers = Object.values(state.players).map((p: any) => ({ id: p.id, name: p.name, powerups: p.powerups || [] }));
    const newLvl = state.level + 1;
    setshowLevelMessage(newLvl, `INFILTRATION SUCCESS - SECURING LEVEL ${newLvl}`);
    channels.forEach(chan => {
       if (chan.readyState === 'open') chan.send(JSON.stringify({ type: 'HEIST_MSG', event: 'LVL_ADV', level: newLvl }));
    });
    stateRef.current = generateLevel(newLvl, allPlayers, nextHeat);
  };

  const onPowerupClick = (pId: string) => {
     if (isHost) handlePowerupSelect(pId);
     else {
       channels.forEach(chan => {
         if (chan.readyState === 'open') chan.send(JSON.stringify({ type: 'HEIST_POWERUP_SELECT', powerup: pId }));
       });
     }
  };

  // Host Loop
  useEffect(() => {
    if (!isHost) return;
    let lastTime = performance.now();
    let animFrame: number;

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (stateRef.current && (stateRef.current.stage === 'PLAYING' || stateRef.current.stage === 'LOBBY_ROOM')) {
         // Gather my own inputs
         const myInput = inputsRef.current[myId] || { dx:0, dy:0, action:false, sneak:false };
         inputsRef.current[myId] = myInput;
         
         stepEngine(stateRef.current, inputsRef.current, dt);

         // Handle stages
         if (stateRef.current.stage === 'VICTORY') {
           stateRef.current.stage = 'POWERUP_SELECT';
           const pool = ['SPEED_BOOST', 'INVIS_CLOAK', 'STUN_BATON', 'HEALTH_PACK', 'LIGHT_FOOT', 'THERMAL_SUIT'];
           // Shuffle and pick 3
           stateRef.current.powerupChoices = pool.sort(() => 0.5 - Math.random()).slice(0, 3);
         } else if (stateRef.current.stage === 'GAME_OVER') {
           const allPlayers = Object.values(stateRef.current.players).map((p: any) => ({ id: p.id, name: p.name, powerups: p.powerups || [] }));
           const newLvl = Math.max(1, stateRef.current.level - 1);
           setshowLevelMessage(newLvl, `MISSION FAILED - REGREZZING TO LEVEL ${newLvl}`);
           channels.forEach(chan => {
              if (chan.readyState === 'open') chan.send(JSON.stringify({ type: 'HEIST_MSG', event: 'LVL_FAIL', level: newLvl }));
           });
           setTimeout(() => {
              stateRef.current = generateLevel(newLvl, allPlayers, Math.max(0, (stateRef.current?.heat || 0) - 20));
           }, 3000);
         } else if (stateRef.current.stage === 'START_HEIST' as any) {
           const allPlayers = Object.values(stateRef.current.players).map((p: any) => ({ id: p.id, name: p.name, powerups: p.powerups || [] }));
           setshowLevelMessage(1, `INFILTRATION LEVEL 1`);
           channels.forEach(chan => {
              if (chan.readyState === 'open') chan.send(JSON.stringify({ type: 'HEIST_MSG', event: 'LVL_ADV', level: 1 }));
           });
           stateRef.current = generateLevel(1, allPlayers, 0);
         }
      }

      if (stateRef.current && (stateRef.current.stage === 'PLAYING' || stateRef.current.stage === 'LOBBY_ROOM' || stateRef.current.stage === 'POWERUP_SELECT' || stateRef.current.stage === 'GAME_OVER')) {
         // Broadcast state
         const stateStr = JSON.stringify({ type: 'HEIST_STATE', state: stateRef.current });
         channels.forEach(chan => {
            if (chan.readyState === 'open') chan.send(stateStr);
         });
         setGameState({...stateRef.current});
      }

      animFrame = requestAnimationFrame(loop);
    };
    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [isHost, channels, myId]);

  // Input Handling logic
  const handleInputUpdate = (dx: number, dy: number, action: boolean, sneak: boolean, aimDx: number = 0, aimDy: number = 0, shoot: boolean = false) => {
    if (!stateRef.current) return;
    const input = { dx, dy, action, sneak, aimDx, aimDy, shoot };
    inputsRef.current[myId] = input;
    if (!isHost) {
      channels.forEach(chan => {
        if (chan.readyState === 'open') chan.send(JSON.stringify({ type: 'HEIST_INPUT', input }));
      });
    }
  };

  // Keyboard Fallback
  useEffect(() => {
    const keys = { w: false, a: false, s: false, d: false, space: false, shift: false, up: false, down: false, left: false, right: false };
    const update = () => {
       let dx = 0; let dy = 0;
       if (keys.w) dy -= 1;
       if (keys.s) dy += 1;
       if (keys.a) dx -= 1;
       if (keys.d) dx += 1;
       const len = Math.sqrt(dx*dx + dy*dy);
       if (len > 0) { dx /= len; dy /= len; }
       
       let aimDx = 0; let aimDy = 0;
       if (keys.up) aimDy -= 1;
       if (keys.down) aimDy += 1;
       if (keys.left) aimDx -= 1;
       if (keys.right) aimDx += 1;
       const shoot = aimDx !== 0 || aimDy !== 0 || keys.space;

       handleInputUpdate(dx, dy, keys.space, keys.shift, aimDx, aimDy, shoot);
    };

    const down = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof keys> = { w:'w', a:'a', s:'s', d:'d', ' ': 'space', shift: 'shift', arrowup:'up', arrowdown:'down', arrowleft:'left', arrowright:'right' };
      const k = map[e.key.toLowerCase()];
      if (k) { keys[k] = true; update(); }
    };
    const up = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof keys> = { w:'w', a:'a', s:'s', d:'d', ' ': 'space', shift: 'shift', arrowup:'up', arrowdown:'down', arrowleft:'left', arrowright:'right' };
      const k = map[e.key.toLowerCase()];
      if (k) { keys[k] = false; update(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [isHost, myId]);

  // Renderer Loop
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    let animFrame: number;

    const draw = () => {
       const state = stateRef.current;
       if (!state) {
         animFrame = requestAnimationFrame(draw);
         return;
       }

       // Clear background
       ctx.fillStyle = '#0f172a';
       ctx.fillRect(0, 0, cvs.width, cvs.height);

       // Camera follows my player, or host if spectator
       let myP = state.players[myId];
       if (!myP) myP = Object.values(state.players)[0];

       ctx.save();
       if (myP) {
          ctx.translate(Math.floor(cvs.width/2 - myP.pos.x), Math.floor(cvs.height/2 - myP.pos.y));
       }

       // Draw Floor Grid
       ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
       ctx.lineWidth = 1;
       ctx.beginPath();
       for (let x = -2000; x < 5000; x += 50) {
           ctx.moveTo(x, -1000); ctx.lineTo(x, 4000);
       }
       for (let y = -1000; y < 4000; y += 50) {
           ctx.moveTo(-2000, y); ctx.lineTo(5000, y);
       }
       ctx.stroke();

       // Draw Hazard/Heat
       Object.values(state.hazards).forEach((hz: any) => {
         if (hz.type === 'HAZARD_GREASE') {
             ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
             ctx.fillRect(hz.pos.x, hz.pos.y, hz.width, hz.height);
         } else if (hz.type === 'HAZARD_HEAT') {
             ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
             ctx.fillRect(hz.pos.x, hz.pos.y, hz.width, hz.height);
             
             // draw "lasers" randomly
             if (Math.random() > 0.5) {
                ctx.beginPath();
                ctx.moveTo(hz.pos.x + Math.random()*hz.width, hz.pos.y);
                ctx.lineTo(hz.pos.x + Math.random()*hz.width, hz.pos.y + hz.height);
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 2;
                ctx.stroke();
             }
         }
       });

       // Draw switches
       Object.values(state.switches).forEach((sw: any) => {
          ctx.fillStyle = sw.pressed ? '#10b981' : '#f59e0b';
          ctx.beginPath();
          ctx.rect(sw.pos.x, sw.pos.y, sw.width, sw.height);
          ctx.fill();
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 2;
          ctx.stroke();

          if (sw.targetId === 'START_HEIST') {
             ctx.fillStyle = '#fff';
             ctx.font = 'bold 16px sans-serif';
             ctx.textAlign = 'center';
             ctx.fillText('START', sw.pos.x + sw.width/2, sw.pos.y + sw.height/2 + 6);
          }
       });

       // Draw Blocks
       Object.values(state.blocks).forEach((b: any) => {
          if (Assets.block.complete && Assets.block.naturalHeight > 0) {
             ctx.drawImage(Assets.block, b.pos.x, b.pos.y, b.width, b.height);
          } else {
             ctx.fillStyle = '#4b5563'; // Gray box
             ctx.fillRect(b.pos.x, b.pos.y, b.width, b.height);
             ctx.strokeStyle = '#9ca3af';
             ctx.lineWidth = 3;
             ctx.strokeRect(b.pos.x, b.pos.y, b.width, b.height);
          }
       });

       // Draw Doors
       Object.values(state.doors).forEach((d: any) => {
          if (Assets.door.complete && Assets.door.naturalHeight > 0) {
             if (d.open) {
                 ctx.globalAlpha = 0.2;
                 ctx.drawImage(Assets.door, d.pos.x, d.pos.y, d.width, d.height);
                 ctx.globalAlpha = 1.0;
             } else {
                 ctx.drawImage(Assets.door, d.pos.x, d.pos.y, d.width, d.height);
             }
          } else {
             ctx.fillStyle = d.open ? 'rgba(74, 222, 128, 0.2)' : '#1f2937';
             ctx.fillRect(d.pos.x, d.pos.y, d.width, d.height);
             if (!d.open) {
                ctx.strokeStyle = '#3b82f6';
                ctx.strokeRect(d.pos.x, d.pos.y, d.width, d.height);
             }
          }
       });

       // Draw Walls
       Object.values(state.walls).forEach((w: any) => {
          if (Assets.wall.complete && Assets.wall.naturalHeight > 0) {
             ctx.drawImage(Assets.wall, w.pos.x, w.pos.y, w.width, w.height);
          } else {
             ctx.fillStyle = '#1e293b'; // slate-800
             ctx.fillRect(w.pos.x, w.pos.y, w.width, w.height);
             // inner top highlight for faux 3D
             ctx.fillStyle = '#334155'; // slate-700
             ctx.fillRect(w.pos.x, w.pos.y, w.width, 10);
             ctx.strokeStyle = '#0f172a'; // slate-900 border
             ctx.lineWidth = 2;
             ctx.strokeRect(w.pos.x, w.pos.y, w.width, w.height);
          }
       });

       // Draw Loot
       if (state.loot) {
          ctx.fillStyle = '#fde047'; // Gold vault
          ctx.fillRect(state.loot.pos.x, state.loot.pos.y, state.loot.width, state.loot.height);
       }

       // Draw Guards & Vision Cones
       Object.values(state.guards).forEach((g: any) => {
          const baseAngle = Math.atan2(g.facing.y, g.facing.x);

          if (g.stunTimer > 0) {
             ctx.save();
             ctx.translate(g.pos.x, g.pos.y);
             ctx.rotate(baseAngle);
             ctx.fillStyle = '#a855f7';
             ctx.beginPath(); ctx.arc(0, 0, g.radius, 0, Math.PI*2); ctx.fill();
             ctx.restore();
             ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign='center';
             ctx.fillText('STUNNED', g.pos.x, g.pos.y - 30);
          } else {
             // Vision Cone
             ctx.fillStyle = g.state === 'ALERT' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.15)';
             ctx.beginPath();
             ctx.moveTo(g.pos.x, g.pos.y);
             ctx.arc(g.pos.x, g.pos.y, g.viewRadius, baseAngle - g.viewAngle/2, baseAngle + g.viewAngle/2);
             ctx.fill();

             if (g.state === 'ALERT') {
                ctx.fillStyle = '#ef4444';
                ctx.font = 'bold 24px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('!', g.pos.x, g.pos.y - 40);
             }

             ctx.save();
             ctx.translate(g.pos.x, g.pos.y);
             ctx.rotate(baseAngle);

             // Draw Image
             if (Assets.guard.complete && Assets.guard.naturalHeight > 0) {
                 // The image is loaded, draw it. Assuming image points UP natively, but we rotate to point RIGHT
                 // Wait, Math.atan2(y,x) assumes 0 is RIGHT. We will draw it rotated 90 deg if the asset is facing up.
                 // For now, draw centered
                 ctx.rotate(Math.PI / 2); // Rotate 90 deg to map 'UP' oriented assets to 'RIGHT'
                 ctx.drawImage(Assets.guard, -g.radius * 1.5, -g.radius * 1.5, g.radius * 3, g.radius * 3);
             } else {
                 // Fallback
                 ctx.fillStyle = '#334155';
                 ctx.fillRect(-15, -g.radius - 5, 30, g.radius * 2 + 10);
                 ctx.fillStyle = '#1e293b';
                 ctx.beginPath();
                 ctx.arc(0, 0, g.radius, 0, Math.PI*2);
                 ctx.fill();
                 ctx.fillStyle = '#0f172a';
                 ctx.beginPath();
                 ctx.arc(0, 0, g.radius * 0.65, -Math.PI/2, Math.PI/2);
                 ctx.fill();
                 ctx.fillStyle = '#111';
                 ctx.fillRect(g.radius * 0.5, 10, 40, 8);
             }
              
             ctx.restore();
          }
       });

       // Draw Players
       Object.values(state.players).forEach((p: any) => {
          if (p.health > 0) {
              const bodyColor = p.stealth ? '#555' : p.color;
              const headColor = p.stealth ? '#777' : '#fde047';
              const bagColor = p.stealth ? '#333' : '#450a0a';
              
              ctx.globalAlpha = p.stealth ? 0.4 : 1.0;
              
              ctx.save();
              ctx.translate(p.pos.x, p.pos.y);
              let angle = 0;
              if (p.facing) {
                 angle = Math.atan2(p.facing.y, p.facing.x);
              } else if (p.velocity?.x || p.velocity?.y) {
                 angle = Math.atan2(p.velocity.y, p.velocity.x);
              }
              ctx.rotate(angle);

              // Draw Image
              if (Assets.player.complete && Assets.player.naturalHeight > 0) {
                 ctx.rotate(Math.PI / 2);
                 ctx.drawImage(Assets.player, -p.radius * 1.5, -p.radius * 1.5, p.radius * 3, p.radius * 3);
              } else {
                 // Fallback
                 ctx.fillStyle = 'rgba(0,0,0,0.3)';
                 ctx.fillRect(-10, -p.radius - 2, 20, p.radius * 2 + 4);
                 ctx.fillStyle = bodyColor;
                 ctx.beginPath();
                 ctx.arc(0, 0, p.radius, 0, Math.PI*2);
                 ctx.fill();
                 ctx.fillStyle = headColor;
                 ctx.beginPath();
                 ctx.arc(0, 0, p.radius * 0.6, 0, Math.PI*2);
                 ctx.fill();
                 ctx.fillStyle = bagColor;
                 ctx.fillRect(-p.radius - 5, -10, 10, 20);
                 ctx.fillStyle = '#222';
                 ctx.fillRect(p.radius * 0.5, 10, 40, 8);
              }

              ctx.restore();
              
              // Healthbar
              ctx.globalAlpha = 1.0;
              ctx.fillStyle = '#333';
              ctx.fillRect(p.pos.x - 20, p.pos.y - 30, 40, 5);
              ctx.fillStyle = p.health > 50 ? '#10b981' : '#ef4444';
              ctx.fillRect(p.pos.x - 20, p.pos.y - 30, 40 * (Math.max(0, p.health)/p.maxHealth), 5);
              
              const pInput = inputsRef.current[p.id];
              if (pInput && pInput.action) {
                  // Draw attack visual
                  ctx.strokeStyle = '#a855f7';
                  ctx.lineWidth = 4;
                  ctx.beginPath();
                  ctx.arc(p.pos.x, p.pos.y, p.radius + 15, 0, Math.PI*2);
                  ctx.stroke();
              }
          }
       });

       // Draw Bullets
       if (state.bullets) {
           ctx.fillStyle = '#fbbf24'; // amber-400
           state.bullets.forEach(b => {
                ctx.beginPath();
                ctx.arc(b.pos.x, b.pos.y, b.radius * 2, 0, Math.PI * 2);
                ctx.fill();
                // trails
                ctx.strokeStyle = '#f59e0b'; // amber-500
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(b.pos.x, b.pos.y);
                ctx.lineTo(b.pos.x - (b.velocity.x * 0.05), b.pos.y - (b.velocity.y * 0.05));
                ctx.stroke();
           });
       }

       // Draw fog of war overlay
       ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
       ctx.beginPath();
       ctx.rect(-10000, -10000, 20000, 20000);
       
       if (myP && myP.health > 0) {
          // Close vision circle
          ctx.moveTo(myP.pos.x + 100, myP.pos.y);
          ctx.arc(myP.pos.x, myP.pos.y, 100, 0, Math.PI * 2, true);
          
          if (!myP.stealth) {
              // Flashlight cone
              const coneAngle = Math.PI / 2; // 90 degrees
              const coneRadius = 600;
              let facingAngle = 0;
              if (myP.facing) {
                  facingAngle = Math.atan2(myP.facing.y, myP.facing.x);
              }
              
              ctx.moveTo(myP.pos.x, myP.pos.y);
              ctx.arc(myP.pos.x, myP.pos.y, coneRadius, facingAngle + coneAngle/2, facingAngle - coneAngle/2, true);
              ctx.lineTo(myP.pos.x, myP.pos.y);
          }
       }
       ctx.fill();

       // Draw guard vision cones over the fog so players can see them
       Object.values(state.guards).forEach((g: any) => {
          if (g.stunTimer <= 0) {
             const baseAngle = Math.atan2(g.facing.y, g.facing.x);
             ctx.fillStyle = g.state === 'ALERT' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.15)';
             ctx.beginPath();
             ctx.moveTo(g.pos.x, g.pos.y);
             ctx.arc(g.pos.x, g.pos.y, g.viewRadius, baseAngle - g.viewAngle/2, baseAngle + g.viewAngle/2);
             ctx.fill();
          }
       });

       ctx.restore();

       // DEBUG INFO
       ctx.fillStyle = 'white';
       ctx.font = '16px monospace';
       ctx.textAlign = 'left';
       ctx.fillText(`myId: ${myId}`, 10, 30);
       ctx.fillText(`players: ${Object.keys(state.players).join(', ')}`, 10, 50);

       animFrame = requestAnimationFrame(draw);
    };
    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [myId]);

  // Touch joysticks
  const [jPos, setJpos] = useState({x: 0, y: 0});
  const ptrL = useRef<number | null>(null);
  const ptrLStart = useRef({x: 0, y: 0});

  const handlePtrDownL = (e: React.PointerEvent<HTMLDivElement>) => {
     ptrL.current = e.pointerId;
     e.currentTarget.setPointerCapture(e.pointerId);
     ptrLStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePtrMoveL = (e: React.PointerEvent<HTMLDivElement>) => {
     if (ptrL.current !== e.pointerId) return;
     const dxRaw = e.clientX - ptrLStart.current.x;
     const dyRaw = e.clientY - ptrLStart.current.y;
     const dist = Math.sqrt(dxRaw*dxRaw + dyRaw*dyRaw);
     const maxT = 40;
     let nx = dxRaw; let ny = dyRaw;
     if (dist > maxT) { nx = (dxRaw/dist)*maxT; ny = (dyRaw/dist)*maxT; }
     
     setJpos({ x: nx, y: ny });
     
     const nLen = Math.sqrt(nx*nx + ny*ny);
     const nDx = nLen > 0 ? nx/maxT : 0;
     const nDy = nLen > 0 ? ny/maxT : 0;
     const oldInp = inputsRef.current[myId] || {action: false, sneak: false};
     handleInputUpdate(nDx, nDy, oldInp.action, oldInp.sneak);
  };

  const handlePtrUpL = (e: React.PointerEvent<HTMLDivElement>) => {
     if (ptrL.current !== e.pointerId) return;
     ptrL.current = null;
     setJpos({x:0, y:0});
     const oldInp = inputsRef.current[myId] || {action: false, sneak: false, aimDx: 0, aimDy: 0, shoot: false};
     handleInputUpdate(0, 0, oldInp.action, oldInp.sneak, oldInp.aimDx, oldInp.aimDy, oldInp.shoot);
  };

  const [jPosR, setJposR] = useState({x: 0, y: 0});
  const ptrR = useRef<number | null>(null);
  const ptrRStart = useRef({x: 0, y: 0});

  const handlePtrDownR = (e: React.PointerEvent<HTMLDivElement>) => {
     ptrR.current = e.pointerId;
     e.currentTarget.setPointerCapture(e.pointerId);
     ptrRStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePtrMoveR = (e: React.PointerEvent<HTMLDivElement>) => {
     if (ptrR.current !== e.pointerId) return;
     const dxRaw = e.clientX - ptrRStart.current.x;
     const dyRaw = e.clientY - ptrRStart.current.y;
     const dist = Math.sqrt(dxRaw*dxRaw + dyRaw*dyRaw);
     const maxT = 40;
     let nx = dxRaw; let ny = dyRaw;
     if (dist > maxT) { nx = (dxRaw/dist)*maxT; ny = (dyRaw/dist)*maxT; }
     
     setJposR({ x: nx, y: ny });
     
     const oldInp = inputsRef.current[myId] || {dx: 0, dy: 0, action: false, sneak: false};
     handleInputUpdate(oldInp.dx, oldInp.dy, oldInp.action, oldInp.sneak, nx, ny, dist > 20); // Shoot if pushed far
  };

  const handlePtrUpR = (e: React.PointerEvent<HTMLDivElement>) => {
     if (ptrR.current !== e.pointerId) return;
     ptrR.current = null;
     setJposR({x:0, y:0});
     const oldInp = inputsRef.current[myId] || {dx: 0, dy: 0, action: false, sneak: false};
     handleInputUpdate(oldInp.dx, oldInp.dy, oldInp.action, oldInp.sneak, 0, 0, false);
  };

  // Handle window resizing
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const resize = () => { cvs.width = window.innerWidth; cvs.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <div className="absolute inset-0 bg-neutral-950 overflow-hidden select-none touch-none">
      <canvas 
         ref={canvasRef} 
         width={window.innerWidth} 
         height={window.innerHeight} 
         className="absolute inset-0 z-0 pointer-events-none"
      />

      {gameState && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center z-40 bg-black/50 p-4 rounded-xl border border-red-500/20 backdrop-blur-md">
           <div className="text-red-500 font-mono font-bold tracking-widest mb-1 shadow-red-500/50 drop-shadow-md">
              HEAT LEVEL
           </div>
           <div className="w-64 h-4 bg-black/80 rounded-full border border-red-900/50 overflow-hidden">
              <div 
                 className="h-full bg-gradient-to-r from-red-500 to-rose-600 transition-all duration-300 relative"
                 style={{ width: `${gameState.heat || 0}%` }}
              >
                 <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xNSIvPjwvc3ZnPg==')] opacity-50" />
              </div>
           </div>
           {gameState.heat > 80 && (
             <div className="text-red-400 font-mono text-xs mt-1 animate-pulse">LOCKDOWN IMMINENT - DRONES ACTIVE</div>
           )}
        </div>
      )}

      {levelInfo.message && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none bg-black/60 backdrop-blur-sm">
           <div className="text-center animate-bounce">
              <h1 className="text-4xl md:text-6xl font-black italic tracking-widest text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">
                {levelInfo.message}
              </h1>
           </div>
        </div>
      )}

      {gameState?.stage === 'POWERUP_SELECT' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/80 backdrop-blur-md">
           <h2 className="text-4xl font-mono font-bold text-amber-400 mb-8 tracking-wider uppercase text-center animate-pulse drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]">
             Vault Secured.<br/>Select Team Upgrade
           </h2>
           <div className="flex flex-wrap gap-6 justify-center max-w-4xl px-4">
             {gameState.powerupChoices?.map(pId => (
               <button 
                 key={pId}
                 onClick={() => onPowerupClick(pId)}
                 className="p-6 bg-neutral-900 border-2 border-amber-500/50 hover:border-amber-400 rounded-xl hover:scale-105 active:scale-95 transition-all shadow-xl max-w-xs w-full text-left"
               >
                  <div className="flex items-center justify-between mb-2">
                   <div className="flex items-center gap-3">
                     <span className="text-3xl">🔌</span>
                     <h3 className="text-xl font-bold font-mono text-white tracking-widest leading-tight">{pId.replace('_', ' ')}</h3>
                   </div>
                   <div className="text-red-500 font-bold bg-red-500/20 px-2 py-1 rounded border border-red-500/50">+{HEAT_COSTS[pId] || 0} HEAT</div>
                 </div>
                 <p className="text-neutral-400 font-mono text-sm leading-relaxed">
                   {pId === 'SPEED_BOOST' ? 'Increases base movement speed for all agents.' : 
                    pId === 'INVIS_CLOAK' ? 'Reduces the distance guards can spot you while sneaking.' :
                    pId === 'STUN_BATON' ? 'Doubles the duration guards remain stunned when attacked.' :
                    pId === 'HEALTH_PACK' ? 'Increases maximum health capacity to 150%.' :
                    pId === 'LIGHT_FOOT' ? 'Grants immunity to slipping on grease traps.' :
                    pId === 'THERMAL_SUIT' ? 'Massively reduces damage taken from laser heat traps.' : ''}
                 </p>
               </button>
             ))}
           </div>
        </div>
      )}

      {/* On-Screen Controls */}
      <div className="absolute bottom-6 left-6 md:bottom-12 md:left-12 w-32 h-32 md:w-40 md:h-40 bg-white/10 rounded-full border-2 border-white/20 z-40"
           onPointerDown={handlePtrDownL}
           onPointerMove={handlePtrMoveL}
           onPointerUp={handlePtrUpL}
           onPointerCancel={handlePtrUpL}>
           <div className="absolute w-12 h-12 md:w-16 md:h-16 bg-white/40 rounded-full shadow-lg"
                style={{ 
                    left: '50%', top: '50%', 
                    transform: `translate(calc(-50% + ${jPos.x}px), calc(-50% + ${jPos.y}px))` 
                }} 
           />
      </div>

      <div className="absolute bottom-6 right-6 md:bottom-12 md:right-12 flex gap-4 md:gap-6 z-40 items-center">
         <button 
           className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-blue-500/40 border-2 border-blue-400 active:bg-blue-500/80 backdrop-blur"
           onPointerDown={() => { const i = inputsRef.current[myId]; handleInputUpdate(i?.dx||0, i?.dy||0, i?.action||false, true); }}
           onPointerUp={() => { const i = inputsRef.current[myId]; handleInputUpdate(i?.dx||0, i?.dy||0, i?.action||false, false); }}
           onPointerCancel={() => { const i = inputsRef.current[myId]; handleInputUpdate(i?.dx||0, i?.dy||0, i?.action||false, false); }}
         >
           <span className="text-white font-bold opacity-80 md:text-sm tracking-widest tracking-tighter text-xs">SNEAK</span>
         </button>
         
         <div className="w-32 h-32 md:w-40 md:h-40 bg-white/10 rounded-full border-2 border-white/20 relative"
              onPointerDown={handlePtrDownR}
              onPointerMove={handlePtrMoveR}
              onPointerUp={handlePtrUpR}
              onPointerCancel={handlePtrUpR}>
              <div className="absolute w-12 h-12 md:w-16 md:h-16 bg-red-500/40 border-2 border-red-500/80 rounded-full shadow-lg flex items-center justify-center"
                   style={{ 
                       left: '50%', top: '50%', 
                       transform: `translate(calc(-50% + ${jPosR.x}px), calc(-50% + ${jPosR.y}px))` 
                   }} 
              >
                  <span className="text-white font-bold text-xs rotate-45 select-none pointer-events-none">AIM</span>
              </div>
         </div>
      </div>

      <button onClick={onBackToLobby} className="absolute top-4 left-4 z-50 px-4 py-2 bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white rounded shadow text-sm font-mono tracking-wide">
        &larr; ABORT
      </button>

      <div className="absolute top-4 right-4 z-50 bg-neutral-900 border border-neutral-800 p-2 rounded shadow text-emerald-400 font-mono text-sm tracking-widest uppercase">
         Level {gameState?.level || levelInfo.level}
      </div>
    </div>
  );
}
