import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { Settings, X, Crosshair } from "lucide-react";
import { playSound } from "../../lib/audioManager";

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

interface WeaponDef {
  id: string;
  name: string;
  fireRate: number; // ms
  damage: number;
  speed: number;
  magSize: number;
  reloadTime: number; // ms
  color: string;
  size: number;
  recoilPitch: number;
  recoilShake: number;
  auto: boolean;
}

const WEAPONS: Record<string, WeaponDef> = {
  LASER_BLASTER: {
    id: "LASER_BLASTER",
    name: "Laser Blaster",
    fireRate: 250,
    damage: 25,
    speed: 60,
    magSize: 15,
    reloadTime: 1200,
    color: "#00ffff",
    size: 0.1,
    recoilPitch: 0.05,
    recoilShake: 0.05,
    auto: false,
  },
  LASER_RIFLE: {
    id: "LASER_RIFLE",
    name: "Laser Rifle",
    fireRate: 100,
    damage: 10,
    speed: 80,
    magSize: 30,
    reloadTime: 1500,
    color: "#ff00ff",
    size: 0.05,
    recoilPitch: 0.02,
    recoilShake: 0.02,
    auto: true,
  },
  LASER_RPG: {
    id: "LASER_RPG",
    name: "Laser RPG",
    fireRate: 1000,
    damage: 75,
    speed: 25,
    magSize: 1,
    reloadTime: 2500,
    color: "#ff0000",
    size: 0.3,
    recoilPitch: 0.2,
    recoilShake: 0.2,
    auto: false,
  },
};

interface Projectile {
  id: string;
  shooterId: string;
  weaponId: string;
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  age: number;
}

const getPlayerColor = (id: string, isHost: boolean) => {
  if (id === "host" || (isHost && id === "host")) return "#ff3366";
  const hash = id
    .split("")
    .reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 80%, 60%)`;
};

export function LaserTagArena({
  channels,
  isHost,
  myId,
  myName,
  guests,
  onBackToLobby,
}: LaserTagArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.005);
  const [gameOver, setGameOver] = useState<{
    winnerId: string;
    winnerName: string;
  } | null>(null);

  const [weaponIndexUI, setWeaponIndexUI] = useState(0);
  const [ammoUI, setAmmoUI] = useState(WEAPONS.LASER_BLASTER.magSize);
  const [isReloadingUI, setIsReloadingUI] = useState(false);

  const gameStateRef = useRef<GameState>({
    players: {
      [myId]: {
        id: myId,
        name: myName,
        position: [(Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20],
        rotationY: 0,
        score: 0,
        health: INITIAL_HEALTH,
        color: getPlayerColor(myId, isHost || myId === "host"),
      },
    },
  });

  const weaponStateRef = useRef({
    weaponIndex: 0,
    weaponId: "LASER_BLASTER",
    isReloading: false,
    ammo: {
      LASER_BLASTER: WEAPONS.LASER_BLASTER.magSize,
      LASER_RIFLE: WEAPONS.LASER_RIFLE.magSize,
      LASER_RPG: WEAPONS.LASER_RPG.magSize,
    } as Record<string, number>,
    lastShotTime: 0,
    isShooting: false,
  });

  useEffect(() => {
    if (isHost) {
      const state = gameStateRef.current;
      guests.forEach((g) => {
        if (!state.players[g.id]) {
          state.players[g.id] = {
            id: g.id,
            name: g.name,
            position: [
              (Math.random() - 0.5) * 20,
              1,
              (Math.random() - 0.5) * 20,
            ],
            rotationY: 0,
            score: 0,
            health: INITIAL_HEALTH,
            color: getPlayerColor(g.id, false),
          };
        }
      });
    }
  }, [isHost, guests]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerMeshesRef = useRef<Record<string, THREE.Mesh>>({});
  const projectilesRef = useRef<Projectile[]>([]);
  const obstaclesRef = useRef<THREE.Mesh[]>([]);

  const cameraEffectRef = useRef({ shake: 0 });

  const inputRef = useRef({
    forward: 0,
    right: 0,
    yaw: 0,
    pitch: 0,
  });

  const keysRef = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
  });

  const pointerLockedRef = useRef(false);

  const touchStateRef = useRef({
    moveTouchId: null as number | null,
    lookTouchId: null as number | null,
    moveStartX: 0,
    moveStartY: 0,
    lastLookX: 0,
    lastLookY: 0,
  });

  const [hudUpdate, setHudUpdate] = useState(0);

  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setHudUpdate(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, [gameOver]);

  const sendHostMessage = useCallback(
    (msg: any) => {
      if (!isHost) {
        const ch = channels.get("host");
        if (ch?.readyState === "open") {
          ch.send(JSON.stringify(msg));
        }
      } else {
        channels.forEach((ch) => {
          if (ch.readyState === "open") {
            ch.send(JSON.stringify(msg));
          }
        });
      }
    },
    [channels, isHost],
  );

  const broadcastMsg = useCallback(
    (msg: any) => {
      channels.forEach((ch) => {
        if (ch.readyState === "open") {
          ch.send(JSON.stringify(msg));
        }
      });
    },
    [channels],
  );

  const spawnProjectile = useCallback((data: any) => {
    if (!sceneRef.current) return;
    const weapon = WEAPONS[data.weaponId];
    if (!weapon) return;
    const geo = new THREE.SphereGeometry(weapon.size, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: weapon.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.start[0], data.start[1], data.start[2]);
    sceneRef.current.add(mesh);

    projectilesRef.current.push({
      id: data.id,
      shooterId: data.shooterId,
      weaponId: data.weaponId,
      mesh,
      dir: new THREE.Vector3(data.dir[0], data.dir[1], data.dir[2]),
      age: 0,
    });
  }, []);

  const handleReloadRef = useRef<() => void>(() => {});
  handleReloadRef.current = () => {
    const state = weaponStateRef.current;
    if (gameOver) return;
    const weapon = WEAPONS[state.weaponId];
    if (state.isReloading || state.ammo[state.weaponId] === weapon.magSize)
      return;

    state.isReloading = true;
    setIsReloadingUI(true);
    playSound(200, "square", 0.1);

    setTimeout(() => {
      state.isReloading = false;
      setIsReloadingUI(false);
      state.ammo[state.weaponId] = weapon.magSize;
      if (weaponStateRef.current.weaponId === weapon.id) {
        setAmmoUI(weapon.magSize);
      }
      playSound(400, "square", 0.1);
    }, weapon.reloadTime);
  };

  const tryShootRef = useRef<() => void>(() => {});
  tryShootRef.current = () => {
    const state = weaponStateRef.current;
    if (gameOver || state.isReloading) return;
    const me = gameStateRef.current.players[myId];
    if (!me || me.health <= 0) return;

    const weapon = WEAPONS[state.weaponId];
    const now = Date.now();
    if (now - state.lastShotTime < weapon.fireRate) return;

    if (state.ammo[state.weaponId] <= 0) {
      handleReloadRef.current();
      return;
    }

    state.lastShotTime = now;
    state.ammo[state.weaponId] -= 1;
    setAmmoUI(state.ammo[state.weaponId]);

    // Apply Recoil & Shake
    inputRef.current.pitch += weapon.recoilPitch;
    inputRef.current.pitch = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, inputRef.current.pitch),
    );
    cameraEffectRef.current.shake = weapon.recoilShake;

    playSound(weapon.id === "LASER_RPG" ? 100 : 600, "sine", 0.1);

    const pos = new THREE.Vector3(me.position[0], 1.5, me.position[2]);
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(
      inputRef.current.pitch,
      me.rotationY,
      0,
      "YXZ",
    );
    dir.applyEuler(euler);

    const pId = Math.random().toString(36).substring(7);

    const projData = {
      id: pId,
      shooterId: myId,
      weaponId: state.weaponId,
      start: [pos.x, pos.y, pos.z],
      dir: [dir.x, dir.y, dir.z],
    };

    spawnProjectile(projData);

    sendHostMessage({
      type: "LASER_TAG_SPAWN_PROJECTILE",
      ...projData,
    });
  };

  const handleShootStart = () => {
    weaponStateRef.current.isShooting = true;
    tryShootRef.current();
  };
  const handleShootEnd = () => {
    weaponStateRef.current.isShooting = false;
  };

  const swapWeaponRef = useRef<(idx: number) => void>(() => {});
  swapWeaponRef.current = (idx: number) => {
    const state = weaponStateRef.current;
    if (state.isReloading) return;
    const ids = Object.keys(WEAPONS);
    if (idx < 0 || idx >= ids.length) return;

    state.weaponIndex = idx;
    state.weaponId = ids[idx];
    setWeaponIndexUI(idx);
    setAmmoUI(state.ammo[state.weaponId]);
    state.isShooting = false;
    playSound(300, "triangle", 0.1);
  };

  const processHitRef = useRef<(msg: any) => void>(() => {});

  processHitRef.current = (msg: any) => {
    const p = gameStateRef.current.players[msg.hitId];
    if (p && p.health > 0) {
      p.health -= msg.damage;
      if (p.health <= 0) {
        p.health = 0;
        playSound(150, "sawtooth", 0.5);

        if (gameStateRef.current.players[msg.shooterId]) {
          gameStateRef.current.players[msg.shooterId].score += 1;

          if (gameStateRef.current.players[msg.shooterId].score >= MAX_SCORE) {
            const winnerMsg = {
              winnerId: msg.shooterId,
              winnerName: gameStateRef.current.players[msg.shooterId].name,
            };
            broadcastMsg({
              type: "LASER_TAG_STATE",
              state: gameStateRef.current,
              winner: winnerMsg,
            });
            setGameOver(winnerMsg);
            return;
          }
        }

        setTimeout(() => {
          if (gameStateRef.current.players[msg.hitId]) {
            gameStateRef.current.players[msg.hitId].health = INITIAL_HEALTH;
            gameStateRef.current.players[msg.hitId].position = [
              (Math.random() - 0.5) * 20,
              1,
              (Math.random() - 0.5) * 20,
            ];
          }
        }, 3000);
      } else {
        playSound(400, "square", 0.1);
      }

      broadcastMsg({
        type: "LASER_TAG_HIT_CONFIRMED",
        shooterId: msg.shooterId,
        hitId: msg.hitId,
      });

      if (msg.shooterId === myId) {
        playSound(400, "square", 0.1); // Hit marker
      } else if (msg.hitId === myId) {
        playSound(100, "sawtooth", 0.2); // Flinch
        cameraEffectRef.current.shake += 0.3;
      }
    }
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "LASER_TAG_STATE" && !isHost) {
          const myCurrent = gameStateRef.current.players[myId];
          gameStateRef.current = msg.state;

          if (
            myCurrent &&
            myCurrent.health > 0 &&
            gameStateRef.current.players[myId]?.health > 0
          ) {
            gameStateRef.current.players[myId].position = myCurrent.position;
            gameStateRef.current.players[myId].rotationY = myCurrent.rotationY;
          }

          if (msg.winner) {
            setGameOver(msg.winner);
          }
        } else if (msg.type === "LASER_TAG_UPDATE" && isHost) {
          const { sourceId, position, rotationY } = msg;
          const p = gameStateRef.current.players[sourceId];
          if (p && p.health > 0) {
            p.position = position;
            p.rotationY = rotationY;
          }
        } else if (msg.type === "LASER_TAG_SPAWN_PROJECTILE") {
          if (msg.shooterId !== myId) {
            spawnProjectile(msg);
          }
        } else if (msg.type === "LASER_TAG_PROJECTILE_HIT" && isHost) {
          processHitRef.current(msg);
        } else if (msg.type === "LASER_TAG_HIT_CONFIRMED") {
          if (!isHost) {
            if (msg.shooterId === myId) {
              playSound(400, "square", 0.1); // Hit marker
            } else if (msg.hitId === myId) {
              playSound(100, "sawtooth", 0.2); // Flinch
              cameraEffectRef.current.shake += 0.3;
            }
          }
        }
      } catch (err) {}
    };

    channels.forEach((ch) => {
      ch.addEventListener("message", handleMessage);
    });

    return () => {
      channels.forEach((ch) => {
        ch.removeEventListener("message", handleMessage);
      });
    };
  }, [channels, isHost, myId, broadcastMsg, spawnProjectile]);

  useEffect(() => {
    let interval: number;
    if (isHost) {
      interval = window.setInterval(() => {
        if (!gameOver) {
          broadcastMsg({
            type: "LASER_TAG_STATE",
            state: gameStateRef.current,
          });
        }
      }, 1000 / 20);
    }
    return () => clearInterval(interval);
  }, [isHost, channels, gameOver, broadcastMsg]);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111827");
    scene.fog = new THREE.Fog("#111827", 10, 40);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    const grid = new THREE.GridHelper(
      ARENA_SIZE,
      ARENA_SIZE,
      0x4f46e5,
      0x374151,
    );
    grid.position.y = 0.01;
    scene.add(grid);

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.8,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.7,
    });
    const wallGeo = new THREE.BoxGeometry(ARENA_SIZE, 4, 1);

    const wall1 = new THREE.Mesh(wallGeo, wallMat);
    wall1.position.set(0, 2, -ARENA_SIZE / 2);
    scene.add(wall1);

    const wall2 = new THREE.Mesh(wallGeo, wallMat);
    wall2.position.set(0, 2, ARENA_SIZE / 2);
    scene.add(wall2);

    const wall3 = new THREE.Mesh(wallGeo, wallMat);
    wall3.rotation.y = Math.PI / 2;
    wall3.position.set(-ARENA_SIZE / 2, 2, 0);
    scene.add(wall3);

    const wall4 = new THREE.Mesh(wallGeo, wallMat);
    wall4.rotation.y = Math.PI / 2;
    wall4.position.set(ARENA_SIZE / 2, 2, 0);
    scene.add(wall4);

    obstaclesRef.current = [];
    const addObstacle = (x: number, z: number, w: number, d: number) => {
      const obs = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wallMat);
      obs.position.set(x, 1.5, z);
      scene.add(obs);
      obstaclesRef.current.push(obs);
    };
    addObstacle(5, 5, 2, 8);
    addObstacle(-5, -5, 8, 2);
    addObstacle(8, -8, 3, 3);
    addObstacle(-8, 8, 3, 3);

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    let animationFrameId: number;
    const clock = new THREE.Clock();
    let lastGuestSync = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);

      if (!gameOver) {
        const me = gameStateRef.current.players[myId];

        if (weaponStateRef.current.isShooting) {
          const wepDef = WEAPONS[weaponStateRef.current.weaponId];
          if (wepDef.auto) {
            tryShootRef.current();
          }
        }

        if (me && me.health > 0) {
          let forwardInput = inputRef.current.forward;
          let rightInput = inputRef.current.right;

          if (keysRef.current.w) forwardInput += 1;
          if (keysRef.current.s) forwardInput -= 1;
          if (keysRef.current.a) rightInput -= 1;
          if (keysRef.current.d) rightInput += 1;

          const moveDir = new THREE.Vector3(rightInput, 0, -forwardInput);
          if (moveDir.length() > 0) moveDir.normalize();

          moveDir.applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            inputRef.current.yaw,
          );

          me.position[0] += moveDir.x * PLAYER_SPEED * dt;
          me.position[2] += moveDir.z * PLAYER_SPEED * dt;

          const half = ARENA_SIZE / 2 - 1;
          me.position[0] = Math.max(-half, Math.min(half, me.position[0]));
          me.position[2] = Math.max(-half, Math.min(half, me.position[2]));

          me.rotationY = inputRef.current.yaw;

          let shakeX = 0,
            shakeY = 0;
          if (cameraEffectRef.current.shake > 0) {
            shakeX = (Math.random() - 0.5) * cameraEffectRef.current.shake;
            shakeY = (Math.random() - 0.5) * cameraEffectRef.current.shake;
            cameraEffectRef.current.shake *= 0.9;
            if (cameraEffectRef.current.shake < 0.001)
              cameraEffectRef.current.shake = 0;
          }

          camera.position.set(
            me.position[0] + shakeX,
            1.5 + shakeY,
            me.position[2],
          );
          camera.rotation.set(
            inputRef.current.pitch,
            inputRef.current.yaw,
            0,
            "YXZ",
          );

          if (!isHost) {
            lastGuestSync += dt;
            if (lastGuestSync > 0.05) {
              lastGuestSync = 0;
              sendHostMessage({
                type: "LASER_TAG_UPDATE",
                sourceId: myId,
                position: me.position,
                rotationY: me.rotationY,
              });
            }
          }
        } else if (me && me.health <= 0) {
          camera.position.set(me.position[0], 0.2, me.position[2]);
          camera.rotation.set(Math.PI / 4, inputRef.current.yaw, 0, "YXZ");
        }

        Object.values(gameStateRef.current.players).forEach((p) => {
          if (p.id !== myId) {
            let mesh = playerMeshesRef.current[p.id];
            if (!mesh) {
              const group = new THREE.Group();
              const bodyMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(p.color),
              });
              const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 1.2, 0.4),
                bodyMat,
              );
              body.position.y = 0.6;
              group.add(body);
              const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.5, 0.5),
                bodyMat,
              );
              head.position.y = 1.45;
              group.add(head);
              const visor = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.15, 0.52),
                new THREE.MeshStandardMaterial({
                  color: 0x00ffff,
                  emissive: 0x00ffff,
                  emissiveIntensity: 0.5,
                }),
              );
              visor.position.y = 1.5;
              group.add(visor);
              const mergedGeo = new THREE.BoxGeometry(0.8, 1.7, 0.5);
              const mainMesh = new THREE.Mesh(
                mergedGeo,
                new THREE.MeshBasicMaterial({ visible: false }),
              );
              mainMesh.add(group);
              scene.add(mainMesh);
              playerMeshesRef.current[p.id] = mainMesh;
              mesh = mainMesh;
            }

            if (p.health <= 0) {
              mesh.visible = false;
            } else {
              mesh.visible = true;
              mesh.position.set(p.position[0], p.position[1], p.position[2]);
              mesh.rotation.y = p.rotationY;
            }
          }
        });

        for (let i = projectilesRef.current.length - 1; i >= 0; i--) {
          const p = projectilesRef.current[i];
          const wep = WEAPONS[p.weaponId] || WEAPONS.LASER_BLASTER;
          p.age += dt;

          if (p.age > 5) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            (p.mesh.material as THREE.Material).dispose();
            projectilesRef.current.splice(i, 1);
            continue;
          }

          p.mesh.position.add(p.dir.clone().multiplyScalar(wep.speed * dt));

          let hitOccurred = false;

          if (p.shooterId === myId) {
            for (const [pid, player] of Object.entries(
              gameStateRef.current.players,
            )) {
              if (pid !== myId && player.health > 0) {
                const dx = p.mesh.position.x - player.position[0];
                const dz = p.mesh.position.z - player.position[2];
                const distSq = dx * dx + dz * dz;
                if (distSq < 0.6) {
                  const dy = p.mesh.position.y - player.position[1];
                  if (dy > -0.5 && dy < 2.0) {
                    hitOccurred = true;
                    const hitMsg = {
                      type: "LASER_TAG_PROJECTILE_HIT",
                      projectileId: p.id,
                      hitId: pid,
                      damage: wep.damage,
                      shooterId: myId,
                    };
                    if (isHost) {
                      processHitRef.current(hitMsg);
                    } else {
                      sendHostMessage(hitMsg);
                    }
                    break;
                  }
                }
              }
            }
          }

          if (!hitOccurred) {
            const hf = ARENA_SIZE / 2;
            if (
              p.mesh.position.x < -hf ||
              p.mesh.position.x > hf ||
              p.mesh.position.z < -hf ||
              p.mesh.position.z > hf ||
              p.mesh.position.y < 0
            ) {
              hitOccurred = true;
            } else {
              // Obstacles check
              for (const obs of obstaclesRef.current) {
                const box = new THREE.Box3().setFromObject(obs);
                if (box.containsPoint(p.mesh.position)) {
                  hitOccurred = true;
                  break;
                }
              }
            }
          }

          if (hitOccurred) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            (p.mesh.material as THREE.Material).dispose();
            projectilesRef.current.splice(i, 1);
          }
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
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
  }, [channels, isHost, myId, sensitivity, gameOver, sendHostMessage]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (showSettings || gameOver) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (
        t.clientX < window.innerWidth * 0.4 &&
        t.clientY > window.innerHeight * 0.4
      ) {
        if (touchStateRef.current.moveTouchId === null) {
          touchStateRef.current.moveTouchId = t.identifier;
          touchStateRef.current.moveStartX = t.clientX;
          touchStateRef.current.moveStartY = t.clientY;
        }
      } else {
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
        const len = Math.sqrt(nx * nx + ny * ny);
        if (len > 1) {
          nx /= len;
          ny /= len;
        }

        inputRef.current.right = nx;
        inputRef.current.forward = -ny;
      } else if (t.identifier === touchStateRef.current.lookTouchId) {
        const dx = t.clientX - touchStateRef.current.lastLookX;
        const dy = t.clientY - touchStateRef.current.lastLookY;

        inputRef.current.yaw -= dx * sensitivity;
        inputRef.current.pitch -= dy * sensitivity;

        inputRef.current.pitch = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(Math.PI / 2 - 0.1, inputRef.current.pitch),
        );

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSettings || gameOver) return;
      switch (e.code) {
        case "KeyW":
          keysRef.current.w = true;
          break;
        case "KeyA":
          keysRef.current.a = true;
          break;
        case "KeyS":
          keysRef.current.s = true;
          break;
        case "KeyD":
          keysRef.current.d = true;
          break;
        case "KeyR":
          handleReloadRef.current();
          break;
        case "Digit1":
          swapWeaponRef.current(0);
          break;
        case "Digit2":
          swapWeaponRef.current(1);
          break;
        case "Digit3":
          swapWeaponRef.current(2);
          break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW":
          keysRef.current.w = false;
          break;
        case "KeyA":
          keysRef.current.a = false;
          break;
        case "KeyS":
          keysRef.current.s = false;
          break;
        case "KeyD":
          keysRef.current.d = false;
          break;
      }
    };

    const handlePointerLockChange = () => {
      pointerLockedRef.current =
        document.pointerLockElement === containerRef.current;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (pointerLockedRef.current && !showSettings && !gameOver) {
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;

        inputRef.current.yaw -= dx * sensitivity * 0.5;
        inputRef.current.pitch -= dy * sensitivity * 0.5;
        inputRef.current.pitch = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(Math.PI / 2 - 0.1, inputRef.current.pitch),
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener(
        "pointerlockchange",
        handlePointerLockChange,
      );
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [showSettings, gameOver, sensitivity]);

  useEffect(() => {
    const preventDef = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", preventDef);
    return () => document.removeEventListener("contextmenu", preventDef);
  }, []);

  const me = gameStateRef.current.players[myId];
  const currentWeapon = WEAPONS[Object.keys(WEAPONS)[weaponIndexUI]];

  return (
    <div
      className="absolute inset-0 w-full h-full overflow-hidden touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onMouseDown={(e) => {
          if (!showSettings && !gameOver) {
            if (
              document.pointerLockElement === containerRef.current &&
              e.button === 0
            ) {
              handleShootStart();
            } else {
              containerRef.current?.requestPointerLock();
            }
          }
        }}
        onMouseUp={() => handleShootEnd()}
      />

      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
        <div className="p-4 flex justify-between items-start">
          <div className="pointer-events-auto">
            <button
              onClick={() => setShowSettings(true)}
              className="p-3 bg-neutral-900/60 backdrop-blur-md rounded-full text-white border border-white/20 active:scale-95 transition-transform"
            >
              <Settings className="w-6 h-6" />
            </button>
          </div>

          <div className="bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-white/10 flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-y-auto">
            {Object.values(gameStateRef.current.players)
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-4 px-2 py-1 ${p.id === myId ? "bg-white/10 rounded-lg" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="font-bold text-white text-sm truncate max-w-[100px]">
                      {p.name} {p.id === "host" && "👑"}
                    </span>
                  </div>
                  <span className="font-bold text-white tracking-widest">
                    {p.score}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center opacity-80">
          <Crosshair
            className="text-white w-8 h-8"
            style={{ color: currentWeapon.color }}
          />
        </div>

        <div className="absolute bottom-6 left-6 max-w-sm pointer-events-none space-y-4">
          <div className="bg-neutral-900/50 backdrop-blur-md border border-white/10 rounded-2xl p-3 flex gap-2 pointer-events-auto">
            {Object.keys(WEAPONS).map((wId, idx) => (
              <button
                key={wId}
                onClick={() => swapWeaponRef.current(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${weaponIndexUI === idx ? "bg-white text-black" : "text-white/50 hover:bg-white/10"}`}
                style={
                  weaponIndexUI === idx
                    ? { boxShadow: `0 0 10px ${WEAPONS[wId].color}` }
                    : {}
                }
              >
                {idx + 1}. {WEAPONS[wId].name.split(" ")[1]}
              </button>
            ))}
          </div>

          <div>
            <div className="text-white font-black mb-1 text-lg italic tracking-widest drop-shadow-md">
              {me?.health > 0 ? `${me.health} HP` : "RESPAWNING..."}
            </div>
            <div className="h-4 w-48 bg-black/50 rounded-full overflow-hidden border border-white/20 backdrop-blur-sm">
              <div
                className={`h-full transition-all duration-300 ${me?.health > 50 ? "bg-emerald-500" : me?.health > 25 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${Math.max(0, me?.health || 0)}%` }}
              />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div
              className="text-4xl font-black italic tracking-tighter drop-shadow-md"
              style={{ color: currentWeapon.color }}
            >
              {isReloadingUI ? "RELOADING" : ammoUI}
            </div>
            {!isReloadingUI && (
              <div className="text-white/50 font-bold mb-1">
                / {currentWeapon.magSize}
              </div>
            )}
          </div>

          <div className="pointer-events-auto">
            <button
              onClick={() => handleReloadRef.current()}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white font-bold text-sm backdrop-blur-md border border-white/20 active:scale-95"
            >
              Reload [R]
            </button>
          </div>
        </div>

        <div className="absolute bottom-8 right-8 pointer-events-auto flex gap-4">
          <button
            onTouchStart={(e) => {
              e.stopPropagation();
              handleShootStart();
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              handleShootEnd();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
            }}
            className="w-24 h-24 rounded-full border-4 active:scale-90 transition-all flex items-center justify-center relative touch-none"
            style={{
              backgroundColor: `${currentWeapon.color}CC`,
              borderColor: currentWeapon.color,
              boxShadow: `0 0 20px ${currentWeapon.color}`,
            }}
          >
            <div className="w-16 h-16 rounded-full border-2 border-white/30" />
          </button>
        </div>
      </div>

      {touchStateRef.current.moveTouchId !== null && (
        <div
          className="absolute w-20 h-20 rounded-full border-2 border-white/30 bg-white/10 pointer-events-none"
          style={{
            left: touchStateRef.current.moveStartX - 40,
            top: touchStateRef.current.moveStartY - 40,
          }}
        >
          <div
            className="absolute w-10 h-10 rounded-full bg-white/50 blur-sm pointer-events-none"
            style={{
              left: 20 + inputRef.current.right * 20 - 5,
              top: 20 + -inputRef.current.forward * 20 - 5,
            }}
          />
        </div>
      )}

      {showSettings && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-[100] pointer-events-auto">
          <div className="bg-neutral-900 border border-white/10 p-8 rounded-3xl w-full max-w-sm text-white relative">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 p-2 text-white/50 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-2xl font-bold mb-6">Settings</h2>

            <div className="mx-auto mb-8 space-y-2">
              <label className="text-sm font-medium text-white/80">
                Look Sensitivity
              </label>
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
                  broadcastMsg({ type: "BACK_TO_LOBBY" });
                }
                onBackToLobby();
              }}
              className="w-full py-4 bg-red-500/20 text-red-400 font-bold rounded-xl border border-red-500/50 hover:bg-red-500/30 active:scale-95 transition-all"
            >
              {isHost ? "End Game & Return to Lobby" : "Leave Game"}
            </button>
          </div>
        </div>
      )}

      {gameOver && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-lg flex flex-col items-center justify-center p-6 z-[90] pointer-events-auto animate-in fade-in duration-500">
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-indigo-500 mb-4 animate-bounce tracking-tighter">
            MATCH OVER
          </h1>
          <p className="text-3xl text-white font-bold mb-12">
            <span
              style={{
                color: gameStateRef.current.players[gameOver.winnerId]?.color,
              }}
            >
              {gameOver.winnerName}
            </span>{" "}
            wins!
          </p>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 w-full max-w-sm mb-8 space-y-3">
            <div className="text-sm font-bold text-white/50 uppercase tracking-widest pl-2 mb-2">
              Final Score
            </div>
            {Object.values(gameStateRef.current.players)
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center bg-black/40 p-4 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-white/30 text-lg w-6">
                      {i + 1}.
                    </span>
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="font-bold text-white text-lg">
                      {p.name} {p.id === "host" && "👑"}
                    </span>
                  </div>
                  <span className="font-black text-2xl text-white">
                    {p.score}
                  </span>
                </div>
              ))}
          </div>

          {isHost && (
            <button
              onClick={() => {
                broadcastMsg({ type: "BACK_TO_LOBBY" });
                onBackToLobby();
              }}
              className="py-5 px-10 bg-white text-black rounded-full font-black text-xl hover:bg-neutral-200 active:scale-95 transition-all"
            >
              Return to Lobby
            </button>
          )}
          {!isHost && (
            <p className="text-white/50 font-bold animate-pulse">
              Waiting for host to close match...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
