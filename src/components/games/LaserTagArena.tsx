import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Settings, X } from 'lucide-react';
import { playSound } from '../../lib/audioManager';

interface PlayerState {
  id: string;
  name: string;
  position: [number, number, number];
  rotationY: number;
  score: number;
  health: number;
  color: string;
}

interface GameState {
  players: Record<string, PlayerState>;
}

interface LaserTagArenaProps {
  channels: Map<string, RTCDataChannel>;
  isHost: boolean;
  myId: string;
  myName: string;
  guests: { id: string; name: string }[];
  onBackToLobby: () => void;
}

const ARENA_SIZE = 40;
const PLAYER_SPEED = 10;
const INITIAL_HEALTH = 100;
const MAX_SCORE = 5;

// Generate random bright colors
const getPlayerColor = (id: string, isHost: boolean) => {
   if (id === 'host' || isHost && id === 'host') return '#ff3366'; // Host is pink/red
   const hash = id.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
   const hue = Math.abs(hash % 360);
   return `hsl(${hue}, 80%, 60%)`;
};

export function LaserTagArena({ channels, isHost, myId, myName, guests, onBackToLobby }: LaserTagArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.005);
  const [gameOver, setGameOver] = useState<{ winnerId: string; winnerName: string } | null>(null);
  
  const gameStateRef = useRef<GameState>({
    players: {
      [myId]: {
        id: myId,
        name: myName,
        position: [(Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20],
        rotationY: 0,
        score: 0,
        health: INITIAL_HEALTH,
        color: getPlayerColor(myId, isHost || myId === 'host')
      }
    }
  });

  // Host initialize guests
  useEffect(() => {
     if (isHost) {
        const state = gameStateRef.current;
        guests.forEach(g => {
           if (!state.players[g.id]) {
              state.players[g.id] = {
                 id: g.id,
                 name: g.name,
                 position: [(Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20],
                 rotationY: 0,
                 score: 0,
                 health: INITIAL_HEALTH,
                 color: getPlayerColor(g.id, false)
              };
           }
        });
     }
  }, [isHost, guests]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerMeshesRef = useRef<Record<string, THREE.Mesh>>({});
  const activeLasersRef = useRef<{ line: THREE.Line, age: number }[]>([]);

  // Input State
  const inputRef = useRef({
     forward: 0,
     right: 0,
     yaw: 0,
     pitch: 0
  });

  const keysRef = useRef({
     w: false,
     a: false,
     s: false,
     d: false,
  });
  
  const pointerLockedRef = useRef(false);

  // Touch controls
  const touchStateRef = useRef({
     moveTouchId: null as number | null,
     lookTouchId: null as number | null,
     moveStartX: 0,
     moveStartY: 0,
     lastLookX: 0,
     lastLookY: 0
  });

  const sendHostMessage = (msg: any) => {
     if (!isHost) {
        const ch = channels.get('host');
        if (ch?.readyState === 'open') {
           ch.send(JSON.stringify(msg));
        }
     } else {
        // Broadcast to all
        channels.forEach(ch => {
           if (ch.readyState === 'open') {
              ch.send(JSON.stringify(msg));
           }
        });
     }
  };

  const broadcastMsg = (msg: any) => {
      channels.forEach(ch => {
          if (ch.readyState === 'open') {
              ch.send(JSON.stringify(msg));
          }
      });
  };

  const createLaserVisual = (start: THREE.Vector3, end: THREE.Vector3, color: string) => {
     if (!sceneRef.current) return;
     const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), linewidth: 2, transparent: true, opacity: 1 });
     const points = [];
     points.push(start);
     points.push(end);
     const geometry = new THREE.BufferGeometry().setFromPoints(points);
     const line = new THREE.Line(geometry, material);
     sceneRef.current.add(line);
     activeLasersRef.current.push({ line, age: 0 });
  };

  const handleShoot = () => {
      if (gameOver) return;
      const me = gameStateRef.current.players[myId];
      if (me.health <= 0) return;

      playSound(600, 'sine', 0.1); 
      
      const pos = new THREE.Vector3(me.position[0], 1.5, me.position[2]); // Camera height approx
      const dir = new THREE.Vector3(0, 0, -1);
      
      // Calculate direction from pitch and yaw
      const euler = new THREE.Euler(inputRef.current.pitch, me.rotationY, 0, 'YXZ');
      dir.applyEuler(euler);

      // Perform local raycast
      const raycaster = new THREE.Raycaster(pos, dir);
      
      // Gather targets
      const targets: THREE.Object3D[] = [];
      const idToMesh = new Map<string, THREE.Mesh>();
      Object.entries(playerMeshesRef.current).forEach(([pid, mesh]) => {
          if (pid !== myId && gameStateRef.current.players[pid].health > 0) {
              targets.push(mesh);
              idToMesh.set(mesh.uuid, pid);
          }
      });

      // Also intersect walls? Assume no walls for now, just an open arena
      const intersects = raycaster.intersectObjects(targets);

      let endPos = pos.clone().add(dir.clone().multiplyScalar(100)); // Miss
      let hitId: string | null = null;

      if (intersects.length > 0) {
         endPos = intersects[0].point;
         hitId = idToMesh.get(intersects[0].object.uuid) || null;
      }

      createLaserVisual(pos, endPos, me.color);

      // Tell host we shot
      sendHostMessage({
          type: 'LASER_TAG_SHOOT',
          sourceId: myId,
          start: [pos.x, pos.y, pos.z],
          end: [endPos.x, endPos.y, endPos.z],
          hitId
      });
  };

  // Webrtc message handling
  useEffect(() => {
     const handleMessage = (e: MessageEvent) => {
        try {
           const msg = JSON.parse(e.data);
           if (msg.type === 'LASER_TAG_STATE' && !isHost) {
               // Full state sync from host
               const myCurrent = gameStateRef.current.players[myId];
               gameStateRef.current = msg.state;
               
               // Prevent local player rubberbanding (client-authoritative movement)
               // Only accept host position if we were dead and are respawning
               if (myCurrent && myCurrent.health > 0 && gameStateRef.current.players[myId]?.health > 0) {
                   gameStateRef.current.players[myId].position = myCurrent.position;
                   gameStateRef.current.players[myId].rotationY = myCurrent.rotationY;
               }

               if (msg.winner) {
                  setGameOver(msg.winner);
               }
           } else if (msg.type === 'LASER_TAG_UPDATE' && isHost) {
               // Guest sends their pos to Host
               const { sourceId, position, rotationY } = msg;
               const p = gameStateRef.current.players[sourceId];
               if (p && p.health > 0) {
                   p.position = position;
                   p.rotationY = rotationY;
               }
           } else if (msg.type === 'LASER_TAG_SHOOT') {
               // Someone shot
               if (msg.sourceId !== myId) {
                   createLaserVisual(
                       new THREE.Vector3(...msg.start), 
                       new THREE.Vector3(...msg.end), 
                       gameStateRef.current.players[msg.sourceId]?.color || '#ffffff'
                   );
                   if (isHost && msg.hitId) {
                       // Apply damage!
                       const p = gameStateRef.current.players[msg.hitId];
                       if (p && p.health > 0) {
                           p.health -= 25;
                           if (p.health <= 0) {
                               p.health = 0;
                               playSound(150, 'sawtooth', 0.5); // Death sound
                               
                               // Give score to shooter if they exist
                               if (gameStateRef.current.players[msg.sourceId]) {
                                   gameStateRef.current.players[msg.sourceId].score += 1;
                                   
                                   // Check win
                                   if (gameStateRef.current.players[msg.sourceId].score >= MAX_SCORE) {
                                       const winnerMsg = { winnerId: msg.sourceId, winnerName: gameStateRef.current.players[msg.sourceId].name };
                                       broadcastMsg({ type: 'LASER_TAG_STATE', state: gameStateRef.current, winner: winnerMsg });
                                       setGameOver(winnerMsg);
                                       return; // Skip respawn if game over
                                   }
                               }

                               // Respawn them after 3 seconds
                               setTimeout(() => {
                                  if (gameStateRef.current.players[msg.hitId]) {
                                      gameStateRef.current.players[msg.hitId].health = INITIAL_HEALTH;
                                      gameStateRef.current.players[msg.hitId].position = [(Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20];
                                  }
                               }, 3000);
                           } else {
                               playSound(400, 'square', 0.1); // Hit marker sound
                           }
                       }
                   }
               } else if (!isHost && msg.sourceId === myId) {
                   // host validated our hit, maybe? (not doing strict validation here, just visuals for others)
               }
           }
        } catch (err) {}
     };

     channels.forEach(ch => {
        ch.addEventListener('message', handleMessage);
     });

     return () => {
        channels.forEach(ch => {
           ch.removeEventListener('message', handleMessage);
        });
     };
  }, [channels, isHost, myId]);

  // Host broadcast loop
  useEffect(() => {
      let interval: number;
      if (isHost) {
          interval = window.setInterval(() => {
              if (!gameOver) {
                  broadcastMsg({
                      type: 'LASER_TAG_STATE',
                      state: gameStateRef.current
                  });
              }
          }, 1000 / 20); // 20hz tick
      }
      return () => clearInterval(interval);
  }, [isHost, channels, gameOver]);

  // Three.js Setup
  useEffect(() => {
      if (!containerRef.current) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#111827');
      scene.fog = new THREE.Fog('#111827', 10, 40);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lights
      const ambient = new THREE.AmbientLight(0xffffff, 0.3);
      scene.add(ambient);

      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(10, 20, 10);
      scene.add(dirLight);

      // Arena Floor
      const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
      // Grid texture
      const grid = new THREE.GridHelper(ARENA_SIZE, ARENA_SIZE, 0x4f46e5, 0x374151);
      grid.position.y = 0.01;
      scene.add(grid);

      const floorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      // Walls
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7 });
      const wallGeo = new THREE.BoxGeometry(ARENA_SIZE, 4, 1);
      
      const wall1 = new THREE.Mesh(wallGeo, wallMat);
      wall1.position.set(0, 2, -ARENA_SIZE/2);
      scene.add(wall1);

      const wall2 = new THREE.Mesh(wallGeo, wallMat);
      wall2.position.set(0, 2, ARENA_SIZE/2);
      scene.add(wall2);

      const wall3 = new THREE.Mesh(wallGeo, wallMat);
      wall3.rotation.y = Math.PI / 2;
      wall3.position.set(-ARENA_SIZE/2, 2, 0);
      scene.add(wall3);

      const wall4 = new THREE.Mesh(wallGeo, wallMat);
      wall4.rotation.y = Math.PI / 2;
      wall4.position.set(ARENA_SIZE/2, 2, 0);
      scene.add(wall4);

      // Obstacles
      const addObstacle = (x: number, z: number, w: number, d: number) => {
         const obs = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wallMat);
         obs.position.set(x, 1.5, z);
         scene.add(obs);
      };
      addObstacle(5, 5, 2, 8);
      addObstacle(-5, -5, 8, 2);
      addObstacle(8, -8, 3, 3);
      addObstacle(-8, 8, 3, 3);

      // Handle Resize
      const handleResize = () => {
          if (cameraRef.current && rendererRef.current) {
              cameraRef.current.aspect = window.innerWidth / window.innerHeight;
              cameraRef.current.updateProjectionMatrix();
              rendererRef.current.setSize(window.innerWidth, window.innerHeight);
          }
      };
      window.addEventListener('resize', handleResize);

      // Render Loop
      let animationFrameId: number;
      const clock = new THREE.Clock();
      let lastGuestSync = 0;

      const animate = () => {
          animationFrameId = requestAnimationFrame(animate);
          const dt = clock.getDelta();
          
          if (!gameOver) {
              // Local Player Movement
              const me = gameStateRef.current.players[myId];
              if (me && me.health > 0) {
                  // Forward/Right input in local space
                  let forwardInput = inputRef.current.forward;
                  let rightInput = inputRef.current.right;

                  // Add keyboard input if any key is pressed
                  if (keysRef.current.w) forwardInput += 1;
                  if (keysRef.current.s) forwardInput -= 1;
                  if (keysRef.current.a) rightInput -= 1;
                  if (keysRef.current.d) rightInput += 1;

                  const moveDir = new THREE.Vector3(rightInput, 0, -forwardInput);
                  if (moveDir.length() > 0) moveDir.normalize();
                  
                  moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), inputRef.current.yaw);
                  
                  me.position[0] += moveDir.x * PLAYER_SPEED * dt;
                  me.position[2] += moveDir.z * PLAYER_SPEED * dt;

                  // Clamp to arena
                  const half = (ARENA_SIZE / 2) - 1;
                  me.position[0] = Math.max(-half, Math.min(half, me.position[0]));
                  me.position[2] = Math.max(-half, Math.min(half, me.position[2]));

                  me.rotationY = inputRef.current.yaw;

                  // Update Camera
                  camera.position.set(me.position[0], 1.5, me.position[2]);
                  camera.rotation.set(inputRef.current.pitch, inputRef.current.yaw, 0, 'YXZ');

                  // Guest Sync loop
                  if (!isHost) {
                      lastGuestSync += dt;
                      if (lastGuestSync > 0.05) { // 20hz
                          lastGuestSync = 0;
                          sendHostMessage({
                              type: 'LASER_TAG_UPDATE',
                              sourceId: myId,
                              position: me.position,
                              rotationY: me.rotationY
                          });
                      }
                  }
              } else if (me && me.health <= 0) {
                  // Dead cam
                  camera.position.set(me.position[0], 0.2, me.position[2]);
                  camera.rotation.set(Math.PI/4, inputRef.current.yaw, 0, 'YXZ'); // looking up slightly
              }

              // Update other players visually
              Object.values(gameStateRef.current.players).forEach(p => {
                  if (p.id !== myId) {
                      let mesh = playerMeshesRef.current[p.id];
                      if (!mesh) {
                          // Create player avatar (Robot-ish)
                          const group = new THREE.Group();
                          
                          const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color) });
                          const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
                          body.position.y = 0.6;
                          group.add(body);

                          const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bodyMat);
                          head.position.y = 1.45;
                          group.add(head);

                          // visor
                          const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.52), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 }));
                          visor.position.y = 1.5;
                          group.add(visor);

                          const mergedGeo = new THREE.BoxGeometry(0.8, 1.7, 0.5); // generic hitbox for raycasting
                          const mainMesh = new THREE.Mesh(mergedGeo, new THREE.MeshBasicMaterial({ visible: false }));
                          mainMesh.add(group);

                          scene.add(mainMesh);
                          playerMeshesRef.current[p.id] = mainMesh;
                          mesh = mainMesh;
                      }

                      if (p.health <= 0) {
                          mesh.visible = false;
                      } else {
                          mesh.visible = true;
                          // Intepolate position for smoothness? Just snap for now 
                          mesh.position.set(p.position[0], p.position[1], p.position[2]);
                          mesh.rotation.y = p.rotationY;
                      }
                  }
              });

              // Process lasers
              for (let i = activeLasersRef.current.length - 1; i >= 0; i--) {
                  const laser = activeLasersRef.current[i];
                  laser.age += dt;
                  if (laser.age > 0.15) { // Fade out quickly
                      scene.remove(laser.line);
                      activeLasersRef.current.splice(i, 1);
                  } else {
                      (laser.line.material as THREE.LineBasicMaterial).opacity = 1 - (laser.age / 0.15);
                  }
              }
          }

          renderer.render(scene, camera);
      };
      animate();

      return () => {
          cancelAnimationFrame(animationFrameId);
          window.removeEventListener('resize', handleResize);
          if (containerRef.current && renderer.domElement) {
              containerRef.current.removeChild(renderer.domElement);
          }
          // Clean up Three.js resources to prevent memory leaks
          scene.traverse((object: any) => {
              if (object.isMesh) {
                  object.geometry.dispose();
                  if (object.material.isMaterial) {
                      object.material.dispose();
                  } else if (Array.isArray(object.material)) {
                      object.material.forEach((m: any) => m.dispose());
                  }
              }
          });
          renderer.dispose();
      };
  }, [channels, isHost, myId, sensitivity, gameOver]); // Re-init on gameover state is okay since we want to freeze, but maybe use ref for gameOver. We put it in ref if needed.

  // Multi-touch Controls
  const handleTouchStart = (e: React.TouchEvent) => {
     if (showSettings || gameOver) return;
     for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        
        // Joystick zone (left half, bottom half roughly, but lets say left 40%)
        if (t.clientX < window.innerWidth * 0.4 && t.clientY > window.innerHeight * 0.4) {
           if (touchStateRef.current.moveTouchId === null) {
              touchStateRef.current.moveTouchId = t.identifier;
              touchStateRef.current.moveStartX = t.clientX;
              touchStateRef.current.moveStartY = t.clientY;
           }
        } 
        // Look zone (anywhere else, we will just use dragging)
        else {
           // Wait, the "shoot button" is on the right. We should prevent looking from starting ON the shoot button.
           // Assumed handled by button stopPropagation.
           if (touchStateRef.current.lookTouchId === null) {
              touchStateRef.current.lookTouchId = t.identifier;
              touchStateRef.current.lastLookX = t.clientX;
              touchStateRef.current.lastLookY = t.clientY;
           }
        }
     }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
     if (showSettings || gameOver) return;
     for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        
        if (t.identifier === touchStateRef.current.moveTouchId) {
            const dx = t.clientX - touchStateRef.current.moveStartX;
            const dy = t.clientY - touchStateRef.current.moveStartY;
            const maxR = 50;
            
            let nx = dx / maxR;
            let ny = dy / maxR;
            const len = Math.sqrt(nx*nx + ny*ny);
            if (len > 1) { nx /= len; ny /= len; }
            
            inputRef.current.right = nx;
            inputRef.current.forward = -ny; // forward is negative Y visually
        } else if (t.identifier === touchStateRef.current.lookTouchId) {
            const dx = t.clientX - touchStateRef.current.lastLookX;
            const dy = t.clientY - touchStateRef.current.lastLookY;
            
            inputRef.current.yaw -= dx * sensitivity;
            inputRef.current.pitch -= dy * sensitivity;
            
            // Clamp pitch
            inputRef.current.pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, inputRef.current.pitch));

            touchStateRef.current.lastLookX = t.clientX;
            touchStateRef.current.lastLookY = t.clientY;
        }
     }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === touchStateRef.current.moveTouchId) {
             touchStateRef.current.moveTouchId = null;
             inputRef.current.forward = 0;
             inputRef.current.right = 0;
          } else if (t.identifier === touchStateRef.current.lookTouchId) {
             touchStateRef.current.lookTouchId = null;
          }
      }
  };

  // PC Controls (Keyboard & Mouse)
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (showSettings || gameOver) return;
          switch(e.code) {
              case 'KeyW': keysRef.current.w = true; break;
              case 'KeyA': keysRef.current.a = true; break;
              case 'KeyS': keysRef.current.s = true; break;
              case 'KeyD': keysRef.current.d = true; break;
          }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
          switch(e.code) {
              case 'KeyW': keysRef.current.w = false; break;
              case 'KeyA': keysRef.current.a = false; break;
              case 'KeyS': keysRef.current.s = false; break;
              case 'KeyD': keysRef.current.d = false; break;
          }
      };

      const handlePointerLockChange = () => {
          pointerLockedRef.current = document.pointerLockElement === containerRef.current;
      };

      const handleMouseMove = (e: MouseEvent) => {
          if (pointerLockedRef.current && !showSettings && !gameOver) {
              const dx = e.movementX || 0;
              const dy = e.movementY || 0;
              
              inputRef.current.yaw -= dx * sensitivity * 0.5;
              inputRef.current.pitch -= dy * sensitivity * 0.5;
              inputRef.current.pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, inputRef.current.pitch));
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      document.addEventListener('pointerlockchange', handlePointerLockChange);
      document.addEventListener('mousemove', handleMouseMove);

      return () => {
          window.removeEventListener('keydown', handleKeyDown);
          window.removeEventListener('keyup', handleKeyUp);
          document.removeEventListener('pointerlockchange', handlePointerLockChange);
          document.removeEventListener('mousemove', handleMouseMove);
      };
  }, [showSettings, gameOver, sensitivity]);

  // Prevent default context menu
  useEffect(() => {
     const preventDef = (e: Event) => e.preventDefault();
     document.addEventListener('contextmenu', preventDef);
     return () => document.removeEventListener('contextmenu', preventDef);
  }, []);

  const me = gameStateRef.current.players[myId];
  
  return (
    <div 
      className="absolute inset-0 w-full h-full overflow-hidden touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
        {/* Render Container */}
        <div 
           ref={containerRef} 
           className="absolute inset-0 w-full h-full cursor-crosshair" 
           onMouseDown={(e) => {
               if (!showSettings && !gameOver) {
                   if (document.pointerLockElement === containerRef.current && e.button === 0) {
                       handleShoot();
                   } else {
                       containerRef.current?.requestPointerLock();
                   }
               }
           }}
        />

        {/* HUD UI */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
           {/* Top Bar */}
           <div className="p-4 flex justify-between items-start">
               <div className="pointer-events-auto">
                   <button 
                      onClick={() => setShowSettings(true)}
                      className="p-3 bg-neutral-900/60 backdrop-blur-md rounded-full text-white border border-white/20 active:scale-95 transition-transform"
                   >
                       <Settings className="w-6 h-6" />
                   </button>
               </div>
               
               {/* Scoreboard */}
               <div className="bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-white/10 flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-y-auto">
                   {Object.values(gameStateRef.current.players).sort((a,b) => b.score - a.score).map((p, i) => (
                       <div key={p.id} className={`flex items-center justify-between gap-4 px-2 py-1 ${p.id === myId ? 'bg-white/10 rounded-lg' : ''}`}>
                           <div className="flex items-center gap-2">
                               <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                               <span className="font-bold text-white text-sm truncate max-w-[100px]">{p.name} {p.id === 'host' && '👑'}</span>
                           </div>
                           <span className="font-bold text-white tracking-widest">{p.score}</span>
                       </div>
                   ))}
               </div>
           </div>

           {/* Center Crosshair */}
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="w-1 h-1 bg-white rounded-full"></div>
                <div className="absolute -top-3 left-0 w-[1px] h-2 bg-white/50"></div>
                <div className="absolute top-2 left-0 w-[1px] h-2 bg-white/50"></div>
                <div className="absolute top-0 -left-3 w-2 h-[1px] bg-white/50"></div>
                <div className="absolute top-0 left-2 w-2 h-[1px] bg-white/50"></div>
           </div>

           {/* Health Bar (Local) */}
           <div className="absolute bottom-6 left-6 right-32 max-w-sm pointer-events-none">
                <div className="text-white font-black mb-1 text-lg italic tracking-widest drop-shadow-md">
                   {me?.health > 0 ? `${me.health} HP` : 'RESPAWNING...'}
                </div>
                <div className="h-4 bg-black/50 rounded-full overflow-hidden border border-white/20 backdrop-blur-sm">
                   <div 
                      className={`h-full transition-all duration-300 ${me?.health > 50 ? 'bg-emerald-500' : me?.health > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.max(0, me?.health || 0)}%` }}
                   />
                </div>
           </div>

           {/* Shoot Button */}
           <div className="absolute bottom-8 right-8 pointer-events-auto">
               <button 
                  onTouchStart={(e) => { e.stopPropagation(); handleShoot(); }}
                  onMouseDown={(e) => { e.stopPropagation(); handleShoot(); }}
                  className="w-24 h-24 rounded-full bg-red-600 border-4 border-red-400 active:bg-red-700 active:scale-90 transition-all shadow-[0_0_20px_rgba(220,38,38,0.5)] flex items-center justify-center relative touch-none"
               >
                   <div className="w-16 h-16 rounded-full border-2 border-white/30" />
               </button>
           </div>
        </div>

        {/* Joystick Visual Indicator */}
        {touchStateRef.current.moveTouchId !== null && (
            <div 
                className="absolute w-20 h-20 rounded-full border-2 border-white/30 bg-white/10 pointer-events-none"
                style={{
                   left: touchStateRef.current.moveStartX - 40,
                   top: touchStateRef.current.moveStartY - 40
                }}
            >
                <div 
                   className="absolute w-10 h-10 rounded-full bg-white/50 blur-sm pointer-events-none"
                   style={{
                      left: 20 + (inputRef.current.right * 20) - 5,
                      top: 20 + (-inputRef.current.forward * 20) - 5
                   }}
                />
            </div>
        )}

        {/* Settings Overlay */}
        {showSettings && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-[100] pointer-events-auto">
                <div className="bg-neutral-900 border border-white/10 p-8 rounded-3xl w-full max-w-sm text-white relative">
                   <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 p-2 text-white/50 hover:text-white">
                      <X className="w-6 h-6" />
                   </button>
                   
                   <h2 className="text-2xl font-bold mb-6">Settings</h2>
                   
                   <div className="mx-auto mb-8 space-y-2">
                       <label className="text-sm font-medium text-white/80">Look Sensitivity</label>
                       <input 
                           type="range" 
                           min="0.001" 
                           max="0.015" 
                           step="0.001"
                           value={sensitivity}
                           onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                           className="w-full accent-indigo-500"
                       />
                   </div>

                   <button
                       onClick={() => {
                           if (isHost) {
                               broadcastMsg({ type: 'BACK_TO_LOBBY' });
                           }
                           onBackToLobby();
                       }}
                       className="w-full py-4 bg-red-500/20 text-red-400 font-bold rounded-xl border border-red-500/50 hover:bg-red-500/30 active:scale-95 transition-all"
                   >
                       {isHost ? 'End Game & Return to Lobby' : 'Leave Game'}
                   </button>
                </div>
            </div>
        )}

        {/* Game Over Overlay */}
        {gameOver && (
            <div className="absolute inset-0 bg-black/90 backdrop-blur-lg flex flex-col items-center justify-center p-6 z-[90] pointer-events-auto animate-in fade-in duration-500">
                <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-indigo-500 mb-4 animate-bounce tracking-tighter">
                   MATCH OVER
                </h1>
                <p className="text-3xl text-white font-bold mb-12">
                   <span style={{ color: gameStateRef.current.players[gameOver.winnerId]?.color }}>{gameOver.winnerName}</span> wins!
                </p>
                
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 w-full max-w-sm mb-8 space-y-3">
                   <div className="text-sm font-bold text-white/50 uppercase tracking-widest pl-2 mb-2">Final Score</div>
                   {Object.values(gameStateRef.current.players).sort((a,b) => b.score - a.score).map((p, i) => (
                       <div key={p.id} className="flex justify-between items-center bg-black/40 p-4 rounded-xl">
                          <div className="flex items-center gap-3">
                             <span className="font-bold text-white/30 text-lg w-6">{i + 1}.</span>
                             <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                             <span className="font-bold text-white text-lg">{p.name} {p.id === 'host' && '👑'}</span>
                          </div>
                          <span className="font-black text-2xl text-white">{p.score}</span>
                       </div>
                   ))}
                </div>

                {isHost && (
                    <button
                        onClick={() => {
                           broadcastMsg({ type: 'BACK_TO_LOBBY' });
                           onBackToLobby();
                        }}
                        className="py-5 px-10 bg-white text-black rounded-full font-black text-xl hover:bg-neutral-200 active:scale-95 transition-all"
                    >
                        Return to Lobby
                    </button>
                )}
                {!isHost && (
                    <p className="text-white/50 font-bold animate-pulse">Waiting for host to close match...</p>
                )}
            </div>
        )}
    </div>
  );
}
