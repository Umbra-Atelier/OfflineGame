import React, { useEffect, useRef, useState } from "react";
import { GameMessage } from "../../types";
import { Settings, Play, ArrowLeft, Trophy } from "lucide-react";
import { playSound } from "../../lib/audioManager";

interface NeonSnakeProps {
  channels: Map<string, RTCDataChannel>;
  isHost: boolean;
  myId: string;
  myName: string;
  guests: { id: string; name: string }[];
  onBackToLobby: () => void;
}

interface SnakeSegment {
  x: number;
  y: number;
}

interface SnakeState {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  score: number;
  segments: SnakeSegment[];
  boost: boolean;
  boostAmount: number; // 0 to 100
  dir: number; // Current movement angle (radians)
  targetAngle: number; // Where they want to go
  isDead: boolean;
}

interface FoodState {
  id: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface GameState {
  phase: "SETTINGS" | "PLAYING" | "GAME_OVER";
  snakes: Record<string, SnakeState>;
  foods: FoodState[];
  winner: string | null;
}

const WORLD_SIZE = 3000;
const MAX_BOOST = 100;
const INITIAL_LENGTH = 10;
const SEGMENT_SPACING = 15;
const SNAKE_SPEED = 6;
const BOOST_MULTIPLIER = 1.8;
const MAX_FOOD = 200;
const TURN_SPEED = 0.15;

const SNAKE_COLORS = [
  "#ff00ff",
  "#00ffff",
  "#ffff00",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ff8800",
  "#8800ff",
];

export function NeonSnake({
  channels,
  isHost,
  myId,
  myName,
  guests,
  onBackToLobby,
}: NeonSnakeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 400 });
  const [gameState, setGameState] = useState<GameState | null>(null);

  // Settings
  const [botCount, setBotCount] = useState(5);

  // Input
  const localInput = useRef({ targetAngle: 0, boost: false });
  const mousePosRef = useRef({ x: 0, y: 0 }); // Local screen coordinates
  const networkInputs = useRef<
    Record<string, { targetAngle: number; boost: boolean }>
  >({});

  // Host Logic Ref
  const hostDataRef = useRef<GameState | null>(null);
  const updateIntervalRef = useRef<number | null>(null);

  // Camera
  const [camera, setCamera] = useState({ x: 0, y: 0 });

  // 1. Setup Data Channels Message Handling
  useEffect(() => {
    const handleMessage = (guestId: string, event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "NEON_SNAKE_INPUT" && isHost) {
          networkInputs.current[guestId] = msg.payload;
        } else if (msg.type === "NEON_SNAKE_SYNC" && !isHost) {
          setGameState(msg.payload);
        }
      } catch (e) {
        // Ignored
      }
    };

    channels.forEach((channel, guestId) => {
      const listener = (e: MessageEvent) => handleMessage(guestId, e);
      channel.addEventListener("message", listener);
      channel.onclose = () => {};
    });

    return () => {
      channels.forEach((channel, guestId) => {
        // We can't easily remove anonymous listeners without reference, so we'll just ignore state updates if unmounted.
      });
    };
  }, [channels, isHost]);

  // 2. Initialize Game (Host)
  useEffect(() => {
    if (!isHost) return;

    const mkSnake = (
      id: string,
      name: string,
      isBot: boolean,
      idx: number,
    ): SnakeState => {
      const startX = Math.random() * (WORLD_SIZE - 400) + 200;
      const startY = Math.random() * (WORLD_SIZE - 400) + 200;
      const startDir = Math.random() * Math.PI * 2;
      const segments = [];
      for (let i = 0; i < INITIAL_LENGTH; i++) {
        segments.push({
          x: startX - Math.cos(startDir) * i * SEGMENT_SPACING,
          y: startY - Math.sin(startDir) * i * SEGMENT_SPACING,
        });
      }
      return {
        id,
        name,
        color: SNAKE_COLORS[idx % SNAKE_COLORS.length],
        isBot,
        score: INITIAL_LENGTH,
        segments,
        boost: false,
        boostAmount: MAX_BOOST,
        dir: startDir,
        targetAngle: startDir,
        isDead: false,
      };
    };

    const initState: GameState = {
      phase: "SETTINGS",
      snakes: {},
      foods: [],
      winner: null,
    };

    hostDataRef.current = initState;
    setGameState(initState);
    broadcastSync(initState);

    return () => {
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    };
  }, [isHost]);

  const broadcastSync = (state: GameState) => {
    channels.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(
          JSON.stringify({ type: "NEON_SNAKE_SYNC", payload: state }),
        );
      }
    });
  };

  const spawnFood = (count: number) => {
    if (!hostDataRef.current) return;
    for (let i = 0; i < count; i++) {
      hostDataRef.current.foods.push({
        id: `food-${Math.random()}`,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: Math.random() * 5 + 3,
        color: SNAKE_COLORS[Math.floor(Math.random() * SNAKE_COLORS.length)],
      });
    }
  };

  const startMatch = () => {
    if (!hostDataRef.current) return;

    // Clear and build snakes
    const snakes: Record<string, SnakeState> = {};
    let idx = 0;
    snakes[myId] = mkSnake(myId, myName, false, idx++);
    guests.forEach((g) => {
      snakes[g.id] = mkSnake(g.id, g.name, false, idx++);
      networkInputs.current[g.id] = {
        targetAngle: snakes[g.id].dir,
        boost: false,
      };
    });
    for (let i = 0; i < botCount; i++) {
      const bId = `bot-${i}`;
      snakes[bId] = mkSnake(bId, `Bot ${i + 1}`, true, idx++);
    }

    hostDataRef.current.snakes = snakes;
    hostDataRef.current.foods = [];
    spawnFood(MAX_FOOD);
    hostDataRef.current.phase = "PLAYING";

    setGameState({ ...hostDataRef.current });
    broadcastSync(hostDataRef.current);

    if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    updateIntervalRef.current = window.setInterval(hostTick, 1000 / 30);
  };

  const mkSnake = (
    id: string,
    name: string,
    isBot: boolean,
    idx: number,
  ): SnakeState => {
    const startX = Math.random() * (WORLD_SIZE - 400) + 200;
    const startY = Math.random() * (WORLD_SIZE - 400) + 200;
    const startDir = Math.random() * Math.PI * 2;
    const segments = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      segments.push({
        x: startX - Math.cos(startDir) * i * SEGMENT_SPACING,
        y: startY - Math.sin(startDir) * i * SEGMENT_SPACING,
      });
    }
    return {
      id,
      name,
      color: SNAKE_COLORS[idx % SNAKE_COLORS.length],
      isBot,
      score: INITIAL_LENGTH,
      segments,
      boost: false,
      boostAmount: MAX_BOOST,
      dir: startDir,
      targetAngle: startDir,
      isDead: false,
    };
  };

  // 3. Host Tick Logic
  const hostTick = () => {
    if (!hostDataRef.current || hostDataRef.current.phase !== "PLAYING") return;

    const state = hostDataRef.current;

    // Process input
    if (state.snakes[myId] && !state.snakes[myId].isDead) {
      state.snakes[myId].targetAngle = localInput.current.targetAngle;
      state.snakes[myId].boost = localInput.current.boost;
    }

    Object.keys(networkInputs.current).forEach((gId) => {
      if (state.snakes[gId] && !state.snakes[gId].isDead) {
        state.snakes[gId].targetAngle = networkInputs.current[gId].targetAngle;
        state.snakes[gId].boost = networkInputs.current[gId].boost;
      }
    });

    const activeSnakes = (Object.values(state.snakes) as SnakeState[]).filter(
      (s: any) => !s.isDead,
    );

    // Bot Logic
    activeSnakes
      .filter((s: SnakeState) => s.isBot)
      .forEach((bot: SnakeState) => {
        // Wandering logic or target nearest food
        if (Math.random() < 0.05) {
          // Find nearest food
          let closeFood = null;
          let closeDist = 1000000;
          for (const f of state.foods) {
            const dist =
              (f.x - bot.segments[0].x) ** 2 + (f.y - bot.segments[0].y) ** 2;
            if (dist < closeDist) {
              closeDist = dist;
              closeFood = f;
            }
          }
          if (closeFood && closeDist < 300000) {
            bot.targetAngle = Math.atan2(
              closeFood.y - bot.segments[0].y,
              closeFood.x - bot.segments[0].x,
            );
          } else {
            bot.targetAngle += (Math.random() - 0.5) * 1.5;
          }
        }

        // Avoid walls
        const head = bot.segments[0];
        const wallMargin = 150;
        if (
          head.x < wallMargin ||
          head.x > WORLD_SIZE - wallMargin ||
          head.y < wallMargin ||
          head.y > WORLD_SIZE - wallMargin
        ) {
          bot.targetAngle = Math.atan2(
            WORLD_SIZE / 2 - head.y,
            WORLD_SIZE / 2 - head.x,
          );
        }

        // Avoid other snakes (simple cast)
        // Omitted for brevity, let bots be reckless sometimes

        bot.boost = false;
        if (Math.random() < 0.01 && bot.score > 15) {
          bot.boost = true;
        } else if (Math.random() < 0.05) {
          bot.boost = false;
        }
      });

    // Move Snakes
    activeSnakes.forEach((snake) => {
      // Turn towards target angle
      let diff = snake.targetAngle - snake.dir;

      // Normalize
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (diff > TURN_SPEED) snake.dir += TURN_SPEED;
      else if (diff < -TURN_SPEED) snake.dir -= TURN_SPEED;
      else snake.dir = snake.targetAngle;

      // Force normalization back to 0-2PI so we don't overflow
      while (snake.dir < 0) snake.dir += Math.PI * 2;
      while (snake.dir >= Math.PI * 2) snake.dir -= Math.PI * 2;

      // Boost logic
      let currentSpeed = SNAKE_SPEED;
      if (snake.boost && snake.boostAmount > 0 && snake.score > 5) {
        currentSpeed = SNAKE_SPEED * BOOST_MULTIPLIER;
        snake.boostAmount -= 2;

        // Lose mass while boosting occasionally
        if (Math.random() < 0.2 && snake.segments.length > 5) {
          snake.score -= 1;
          const tail = snake.segments.pop()!; // visual tail pops
          // Drop food
          state.foods.push({
            id: `dropped-${Math.random()}`,
            x: tail.x,
            y: tail.y,
            size: 5,
            color: snake.color,
          });
        }
      } else {
        snake.boostAmount = Math.min(MAX_BOOST, snake.boostAmount + 0.5);
      }

      const newX = snake.segments[0].x + Math.cos(snake.dir) * currentSpeed;
      const newY = snake.segments[0].y + Math.sin(snake.dir) * currentSpeed;

      // Apply new head, move body
      // We only move segments forward if distance to next is > SEGMENT_SPACING
      const newSegments = [{ x: newX, y: newY }];
      let remainingLength = snake.score;
      let prev = newSegments[0];

      for (let i = 0; i < snake.segments.length; i++) {
        const curr = snake.segments[i];
        const dist = Math.sqrt((prev.x - curr.x) ** 2 + (prev.y - curr.y) ** 2);
        if (dist >= SEGMENT_SPACING && newSegments.length < remainingLength) {
          // Pull it towards prev
          const angle = Math.atan2(prev.y - curr.y, prev.x - curr.x);
          newSegments.push({
            x: curr.x + Math.cos(angle) * (dist - SEGMENT_SPACING),
            y: curr.y + Math.sin(angle) * (dist - SEGMENT_SPACING),
          });
          prev = newSegments[newSegments.length - 1];
        } else if (newSegments.length < remainingLength) {
          newSegments.push(curr);
          prev = curr;
        }
      }

      // Add extra segments if growing
      while (newSegments.length < remainingLength) {
        newSegments.push({ ...newSegments[newSegments.length - 1] });
      }

      snake.segments = newSegments;

      // Wall Collision
      const head = snake.segments[0];
      if (
        head.x < 0 ||
        head.x > WORLD_SIZE ||
        head.y < 0 ||
        head.y > WORLD_SIZE
      ) {
        snake.isDead = true;
      }
    });

    // Food Collision
    activeSnakes.forEach((snake) => {
      if (snake.isDead) return;
      const head = snake.segments[0];
      for (let i = state.foods.length - 1; i >= 0; i--) {
        const f = state.foods[i];
        const distSq = (head.x - f.x) ** 2 + (head.y - f.y) ** 2;
        if (distSq < (20 + f.size) ** 2) {
          snake.score += 1;
          state.foods.splice(i, 1);
        }
      }
    });

    // Respawn Food
    if (state.foods.length < MAX_FOOD / 2) {
      spawnFood(MAX_FOOD - state.foods.length);
    }

    // Snake-to-Snake Collisions
    for (let i = 0; i < activeSnakes.length; i++) {
      for (let j = 0; j < activeSnakes.length; j++) {
        if (i === j) continue;
        const sn1 = activeSnakes[i];
        const sn2 = activeSnakes[j];
        if (sn1.isDead || sn2.isDead) continue;

        const head = sn1.segments[0];

        // Check if sn1 head hit ANY of sn2's segments
        for (let k = 0; k < sn2.segments.length; k++) {
          // Don't check head-to-head instantly if they spawned close, but fine for standard
          const seg = sn2.segments[k];
          const distSq = (head.x - seg.x) ** 2 + (head.y - seg.y) ** 2;
          if (distSq < 15 ** 2) {
            sn1.isDead = true; // sn1 hit sn2
            break;
          }
        }
      }
    }

    // Handle deaths (drop food)
    activeSnakes.forEach((snake) => {
      if (snake.isDead) {
        // Drop food for each segment
        for (let i = 0; i < snake.segments.length; i += 2) {
          if (Math.random() < 0.5) continue;
          state.foods.push({
            id: `drop-${Math.random()}`,
            x: snake.segments[i].x + (Math.random() * 20 - 10),
            y: snake.segments[i].y + (Math.random() * 20 - 10),
            size: Math.random() * 8 + 4,
            color: snake.color,
          });
        }
      }
    });

    // Check Win Condition
    const aliveHumans = (Object.values(state.snakes) as SnakeState[]).filter(
      (s) => !s.isDead && !s.isBot,
    );
    const aliveTotal = (Object.values(state.snakes) as SnakeState[]).filter(
      (s) => !s.isDead,
    );

    if (aliveTotal.length <= 1) {
      // 1 or 0 left
      if (aliveTotal.length === 1) state.winner = aliveTotal[0].name;
      else state.winner = "Draw";
      state.phase = "GAME_OVER";
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    } else if (aliveHumans.length === 0) {
      // Only bots left
      state.winner = "Bots wins!";
      state.phase = "GAME_OVER";
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    }

    setGameState({ ...state });
    broadcastSync(state);
  };

  // 4. Input Handling (Local -> Network)
  useEffect(() => {
    if (gameState?.phase !== "PLAYING") return;

    const pInfo = gameState.snakes[myId];
    if (!pInfo || pInfo.isDead) return;

    // We send input updates on interaction. A loop sends periodic angle updates if using mouse/touch follow.
    const sendInput = () => {
      if (isHost) {
        // Already using localInput ref in host tick
      } else {
        const ch = channels.values().next().value; // Only 1 channel for guest
        if (ch && ch.readyState === "open") {
          ch.send(
            JSON.stringify({
              type: "NEON_SNAKE_INPUT",
              payload: {
                targetAngle: localInput.current.targetAngle,
                boost: localInput.current.boost,
              },
            }),
          );
        }
      }
    };

    const updateTargetFromMouse = () => {
      const screenX = mousePosRef.current.x;
      const screenY = mousePosRef.current.y;
      const centerX = viewport.w / 2;
      const centerY = viewport.h / 2;

      const angle = Math.atan2(screenY - centerY, screenX - centerX);
      localInput.current.targetAngle = angle;
      sendInput();
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX = 0,
        clientY = 0;
      if ("touches" in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("clientX" in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Offset by container ref
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        mousePosRef.current = {
          x: clientX - rect.left,
          y: clientY - rect.top,
        };
        updateTargetFromMouse();
      }
    };

    // Send periodic updates just in case
    const intv = setInterval(sendInput, 100);

    const el = containerRef.current;
    if (el) {
      el.addEventListener("mousemove", handlePointerMove);
      el.addEventListener("touchmove", handlePointerMove, { passive: true });
      el.addEventListener("touchstart", handlePointerMove, { passive: true });
    }

    return () => {
      clearInterval(intv);
      if (el) {
        el.removeEventListener("mousemove", handlePointerMove);
        el.removeEventListener("touchmove", handlePointerMove);
        el.removeEventListener("touchstart", handlePointerMove);
      }
    };
  }, [gameState?.phase, isHost, myId, viewport]);

  // Resize handler
  useEffect(() => {
    const onResize = () => {
      if (containerRef.current) {
        setViewport({
          w: containerRef.current.clientWidth || window.innerWidth,
          h: containerRef.current.clientHeight || window.innerHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [gameState?.phase]);

  // Update Camera
  useEffect(() => {
    if (!gameState || !viewport) return;
    const mySnake = gameState.snakes[myId];
    if (mySnake && !mySnake.isDead && mySnake.segments.length > 0) {
      const head = mySnake.segments[0];
      setCamera((prev) => {
        if (prev.x === 0 && prev.y === 0) {
          return { x: head.x, y: head.y };
        }
        return {
          x: prev.x + (head.x - prev.x) * 0.1,
          y: prev.y + (head.y - prev.y) * 0.1,
        };
      });
    }
  }, [gameState, myId, viewport]);

  // 5. Render
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (!canvas || !gameState) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let vw = viewport.w;
      let vh = viewport.h;
      if (containerRef.current) {
        vw = containerRef.current.clientWidth || window.innerWidth;
        vh = containerRef.current.clientHeight || window.innerHeight;
        if (canvas.width !== vw) canvas.width = vw;
        if (canvas.height !== vh) canvas.height = vh;
      }

      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, vw, vh);

      if (gameState.phase === "SETTINGS") {
        animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }

      ctx.save();
      let cx = isNaN(camera.x) ? 0 : camera.x;
      let cy = isNaN(camera.y) ? 0 : camera.y;

      ctx.translate(vw / 2 - cx, vh / 2 - cy);

      // Draw Grid / Bounds
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 2;
      const gridSize = 100;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_SIZE; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_SIZE);
      }
      for (let y = 0; y <= WORLD_SIZE; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_SIZE, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 0, 255, 0.5)";
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      // Draw Foods
      gameState.foods.forEach((f) => {
        if (isNaN(f.x) || isNaN(f.y)) return;
        ctx.shadowBlur = 15;
        ctx.shadowColor = f.color;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.stroke();
      });

      // Draw Snakes
      (Object.values(gameState.snakes) as SnakeState[]).forEach((snake) => {
        if (snake.isDead || snake.segments.length === 0) return;

        ctx.shadowBlur = 15;
        ctx.shadowColor = snake.color;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 18;
        ctx.strokeStyle = snake.color;

        ctx.beginPath();
        if (!isNaN(snake.segments[0].x) && !isNaN(snake.segments[0].y)) {
          ctx.moveTo(snake.segments[0].x, snake.segments[0].y);
          for (let i = 1; i < snake.segments.length; i++) {
            if (!isNaN(snake.segments[i].x) && !isNaN(snake.segments[i].y)) {
              ctx.lineTo(snake.segments[i].x, snake.segments[i].y);
            }
          }
          ctx.stroke();
        }

        ctx.shadowBlur = 0;

        const head = snake.segments[0];
        if (isNaN(head.x) || isNaN(head.y)) return;

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "14px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${snake.name} (Lvl ${snake.score})`, head.x, head.y - 35);

        const maxLevelVisual = 150;
        const levelPct = Math.min(1, snake.score / maxLevelVisual);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(head.x - 30, head.y - 25, 60, 6);
        ctx.fillStyle = snake.color;
        ctx.fillRect(head.x - 30, head.y - 25, 60 * levelPct, 6);

        ctx.fillStyle = "#000000";
        const eyeOffset = 6;
        const dir = isNaN(snake.dir) ? 0 : snake.dir;
        const e1X = head.x + Math.cos(dir + 0.5) * eyeOffset;
        const e1Y = head.y + Math.sin(dir + 0.5) * eyeOffset;
        const e2X = head.x + Math.cos(dir - 0.5) * eyeOffset;
        const e2Y = head.y + Math.sin(dir - 0.5) * eyeOffset;
        ctx.beginPath();
        ctx.arc(e1X, e1Y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(e2X, e2Y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, viewport, camera]);

  const handleBoostStart = (e?: any) => {
    e?.preventDefault();
    e?.stopPropagation();
    e?.nativeEvent?.stopPropagation();
    localInput.current.boost = true;
  };
  const handleBoostEnd = (e?: any) => {
    e?.preventDefault();
    e?.stopPropagation();
    e?.nativeEvent?.stopPropagation();
    localInput.current.boost = false;
  };

  return (
    <div className="flex flex-col w-full h-[100dvh] bg-neutral-950 font-sans select-none overflow-hidden touch-none relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onBackToLobby}
          className="w-10 h-10 bg-white/10 shrink-0 border border-white/20 rounded-full flex justify-center items-center backdrop-blur text-white hover:bg-white/20 active:scale-95 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        {gameState?.phase === "PLAYING" && (
          <div className="text-white font-black font-display tracking-wider text-xl drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">
            NEON SNAKE
          </div>
        )}
        <div className="w-10 h-10"></div>
      </div>

      {gameState?.phase === "SETTINGS" && isHost && (
        <div className="flex-1 flex items-center justify-center relative p-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-neutral-900 border border-neutral-700/50 p-8 rounded-[2rem] w-full max-w-sm shadow-2xl text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-fuchsia-600/20 rounded-2xl flex items-center justify-center border border-fuchsia-500/50">
                <Trophy className="w-8 h-8 text-fuchsia-400" />
              </div>
            </div>
            <h2 className="text-3xl font-display font-bold text-white mb-2">
              Neon Snake
            </h2>
            <p className="text-neutral-400 font-medium mb-6">
              Slither to win! Choose your bot count to start.
            </p>

            <div className="space-y-6 mb-8 text-left">
              <div>
                <label className="text-neutral-400 text-sm font-bold uppercase tracking-wider mb-2 block">
                  Bot Enemies
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="15"
                    value={botCount}
                    onChange={(e) => setBotCount(parseInt(e.target.value))}
                    className="flex-1 accent-fuchsia-500"
                  />
                  <span className="text-white font-mono font-bold text-xl w-8 text-center">
                    {botCount}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={startMatch}
              className="w-full py-4 bg-fuchsia-600 text-white rounded-2xl font-bold text-lg shadow-[0_0_20px_rgba(192,38,211,0.4)] hover:bg-fuchsia-500 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" /> Start Match
            </button>
          </div>
        </div>
      )}

      {gameState?.phase === "SETTINGS" && !isHost && (
        <div className="flex-1 flex items-center justify-center relative p-6">
          <div className="animate-pulse flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-neutral-700 border-t-fuchsia-500 rounded-full animate-spin mb-4"></div>
            <p className="text-neutral-400 font-medium text-lg">
              Waiting for Host to start...
            </p>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState?.phase === "GAME_OVER" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-in fade-in duration-500">
          <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl w-full max-w-sm shadow-2xl text-center transform hover:scale-105 transition-transform">
            <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h2 className="text-4xl font-display font-black text-white tracking-tight mb-2 uppercase">
              {gameState.winner === "Draw"
                ? "Draw!"
                : `${gameState.winner} Wins!`}
            </h2>
            <p className="text-neutral-400 font-medium mb-8">
              Ready up in the lobby to play again.
            </p>
            {isHost ? (
              <button
                onClick={onBackToLobby}
                className="w-full py-4 bg-white text-black font-bold rounded-2xl active:scale-95 transition-all"
              >
                Return to Lobby
              </button>
            ) : (
              <p className="text-neutral-500 font-bold uppercase tracking-widest text-sm">
                Waiting for host...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Play Area */}
      <div
        ref={containerRef}
        className={`absolute inset-0 z-0 touch-none ${gameState?.phase === "PLAYING" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <canvas
          ref={canvasRef}
          width={viewport.w}
          height={viewport.h}
          className="block bg-neutral-950"
        />

        {/* Boost Controls Overlay */}
        {gameState?.snakes[myId] && !gameState.snakes[myId].isDead && (
          <>
            <div className="absolute bottom-8 left-8 right-8 flex flex-col items-start pointer-events-none">
              {/* Level Bar visually indicated above head, but maybe here too */}
              <div className="mb-4">
                <p className="text-white font-mono font-bold tracking-widest mb-1 text-shadow-sm">
                  SCORE: {gameState.snakes[myId].score}
                </p>
              </div>

              <div className="w-full max-w-[200px] h-3 bg-neutral-800/80 rounded-full border border-neutral-700/50 backdrop-blur overflow-hidden relative">
                <div
                  className="absolute left-0 top-0 bottom-0 bg-yellow-400 transition-all ease-linear"
                  style={{ width: `${gameState.snakes[myId].boostAmount}%` }}
                ></div>
              </div>
            </div>

            {/* Boost Button Left Side (Mobile style) */}
            <div className="absolute bottom-16 w-full flex justify-between px-8 pointer-events-none">
              {/* Left Boost Area */}
              <div className="pointer-events-auto">
                <button
                  onPointerDown={handleBoostStart}
                  onPointerUp={handleBoostEnd}
                  onPointerLeave={handleBoostEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-24 h-24 rounded-full bg-yellow-400/20 border-2 border-yellow-400/50 flex items-center justify-center active:bg-yellow-400/40 active:scale-95 transition-all backdrop-blur"
                >
                  <span className="text-yellow-400 font-black tracking-widest uppercase text-sm drop-shadow-md">
                    BOOST
                  </span>
                </button>
              </div>
            </div>
          </>
        )}

        {gameState?.snakes[myId]?.isDead && (
          <div className="absolute z-30 inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-red-500/10 text-red-400 px-6 py-3 rounded-2xl border border-red-500/20 backdrop-blur font-black tracking-widest uppercase text-2xl shadow-[0_0_30px_rgba(239,68,68,0.3)]">
              WASTED
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
