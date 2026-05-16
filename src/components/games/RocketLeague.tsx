import React, { useEffect, useRef, useState } from 'react';
import { GameMessage } from '../../types';
import * as MatterPkg from 'matter-js';
import { Trophy, Zap, AlertTriangle, ArrowLeft } from 'lucide-react';
import { triggerHapticClick, playGoalSound, playJumpSound } from '../../lib/audioManager';

interface RocketLeagueProps {
  channel?: RTCDataChannel;
  isHost: boolean;
  onBackToLobby: () => void;
}

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 600;
const MAX_BOOST = 100;
const BOOST_DRAIN = 1.5;
const BOOST_REGEN = 2; // grounded regen
const TICKS_PER_SEC = 60;

export function RocketLeague({ channel, isHost, onBackToLobby }: RocketLeagueProps) {
  // --- UI & Network State ---
  const [gameState, setGameState] = useState<any>(null); // synced state
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 400 });

  // Input Refs
  const localInput = useRef({ dx: 0, dy: 0, jump: false, boost: false });
  const guestInput = useRef({ dx: 0, dy: 0, jump: false, boost: false }); // Host reads this

  // --- Host Physics State ---
  const engineRef = useRef<any>(null);
  const bodiesRef = useRef<any>({});
  const gameData = useRef({
    phase: 'COUNTDOWN', // COUNTDOWN | PLAYING | GOAL | FINISHED
    timer: 3,
    score1: 0,
    score2: 0,
    p1Boost: MAX_BOOST,
    p2Boost: MAX_BOOST,
    p1CanDoubleJump: true,
    p2CanDoubleJump: true,
    p1JumpReset: true,
    p2JumpReset: true,
  });

  // Calculate container scale
  useEffect(() => {
    const onResize = () => {
      if (containerRef.current) {
        setViewport({
            w: containerRef.current.clientWidth,
            h: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Camera tracking
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
      if (!gameState || viewport.w === 0) return;
      const myCar = isHost ? gameState.p1 : gameState.p2;
      const b = gameState.ball;
      
      const fullFieldScale = Math.min(viewport.w / WORLD_WIDTH, viewport.h / WORLD_HEIGHT) * 0.95;
      
      let targetX = WORLD_WIDTH / 2;
      let targetY = WORLD_HEIGHT / 2;
      let idealScale = fullFieldScale || 0.4; // Show whole field by default

      if (gameState.phase === 'PLAYING') {
          // Weight towards the car, but still include ball
          targetX = myCar.x * 0.7 + b.x * 0.3;
          targetY = myCar.y * 0.7 + b.y * 0.3;
          
          const dist = Math.sqrt((myCar.x - b.x)**2 + (myCar.y - b.y)**2);
          
          // Allow zooming in closer when playing, but not too far out
          const minScale = fullFieldScale;
          const maxScale = Math.max(fullFieldScale * 1.5, 0.65);
          idealScale = Math.max(minScale, Math.min(maxScale, 800 / (dist + 600)));
      }

      // Smooth interp
      setCamera(prev => ({
          x: prev.x + (targetX - prev.x) * 0.1,
          y: prev.y + (targetY - prev.y) * 0.1,
          scale: prev.scale + (idealScale - prev.scale) * 0.05
      }));
  }, [gameState, isHost, viewport]);

  // Set up Host physics
  useEffect(() => {
    if (!isHost) return;

    const M = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
    const { Engine, World, Bodies, Body } = M;

    const engine = Engine.create({ gravity: { x: 0, y: 0.4, scale: 0.001 } });
    engineRef.current = engine;

    const cx = WORLD_WIDTH / 2;
    const cy = WORLD_HEIGHT / 2;

    // Static World
    const ceiling = Bodies.rectangle(WORLD_WIDTH/2, -50, WORLD_WIDTH * 2, 100, { isStatic: true });
    const floor = Bodies.rectangle(WORLD_WIDTH/2, WORLD_HEIGHT + 50, WORLD_WIDTH * 2, 100, { isStatic: true, friction: 0.1 });
    
    // Left Wall
    const leftWallTop = Bodies.rectangle(-25, 125, 50, 250, { isStatic: true });
    const leftWallBot = Bodies.rectangle(-25, 525, 50, 150, { isStatic: true });
    // Left Goal
    const leftGoalBack = Bodies.rectangle(-125, 350, 50, 200, { isStatic: true });
    const leftGoalTop = Bodies.rectangle(-75, 240, 100, 20, { isStatic: true });
    const leftGoalBot = Bodies.rectangle(-75, 460, 100, 20, { isStatic: true });

    // Right Wall
    const rightWallTop = Bodies.rectangle(WORLD_WIDTH + 25, 125, 50, 250, { isStatic: true });
    const rightWallBot = Bodies.rectangle(WORLD_WIDTH + 25, 525, 50, 150, { isStatic: true });
    // Right Goal
    const rightGoalBack = Bodies.rectangle(WORLD_WIDTH + 125, 350, 50, 200, { isStatic: true });
    const rightGoalTop = Bodies.rectangle(WORLD_WIDTH + 75, 240, 100, 20, { isStatic: true });
    const rightGoalBot = Bodies.rectangle(WORLD_WIDTH + 75, 460, 100, 20, { isStatic: true });

    // Ramps (Rounded corners)
    const tlRamp = Bodies.circle(150, 150, 150, { isStatic: true });
    const blRamp = Bodies.circle(150, WORLD_HEIGHT - 150, 150, { isStatic: true });
    const trRamp = Bodies.circle(WORLD_WIDTH - 150, 150, 150, { isStatic: true });
    const brRamp = Bodies.circle(WORLD_WIDTH - 150, WORLD_HEIGHT - 150, 150, { isStatic: true });

    const wallOpts = [
        ceiling, floor, 
        leftWallTop, leftWallBot, leftGoalBack, leftGoalTop, leftGoalBot, 
        rightWallTop, rightWallBot, rightGoalBack, rightGoalTop, rightGoalBot, 
        tlRamp, blRamp, trRamp, brRamp
    ];

    // Dynamic Bodies
    const ball = Bodies.circle(cx, cy, 30, {
      restitution: 0.9,
      friction: 0.02,
      frictionAir: 0.005,
      density: 0.0001, // much lighter ball
    });

    const createCar = (isP1: boolean) => {
      const car = Bodies.rectangle(isP1 ? 200 : WORLD_WIDTH - 200, WORLD_HEIGHT - 40, 80, 40, {
        restitution: 0.3,
        friction: 0.05, 
        density: 0.002, // lighter car
        frictionAir: 0.015,
        chamfer: { radius: 10 }
      });
      return car;
    };

    const p1 = createCar(true);
    const p2 = createCar(false);

    World.add(engine.world, [...wallOpts, ball, p1, p2]);

    bodiesRef.current = { ball, p1, p2 };

    const resetPositions = () => {
      const M = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
      const { Body } = M;
      
      Body.setPosition(ball, { x: cx, y: cy - 100 });
      Body.setVelocity(ball, { x: 0, y: 0 });
      Body.setAngularVelocity(ball, 0);

      Body.setPosition(p1, { x: 200, y: WORLD_HEIGHT - 100 });
      Body.setVelocity(p1, { x: 0, y: 0 });
      Body.setAngle(p1, 0);
      Body.setAngularVelocity(p1, 0);

      Body.setPosition(p2, { x: WORLD_WIDTH - 200, y: WORLD_HEIGHT - 100 });
      Body.setVelocity(p2, { x: 0, y: 0 });
      Body.setAngle(p2, Math.PI);
      Body.setAngularVelocity(p2, 0);
      
      gameData.current.p1Boost = MAX_BOOST;
      gameData.current.p2Boost = MAX_BOOST;
    };

    resetPositions();

    const broadcastState = () => {
      if (!channel || channel.readyState !== 'open') return;
      channel.send(JSON.stringify({
        type: 'GAME_MESSAGE',
        game: 'ROCKET_LEAGUE',
        payload: {
          msgType: 'STATE',
          state: {
            ball: { x: ball.position.x, y: ball.position.y, a: ball.angle },
            p1: { x: p1.position.x, y: p1.position.y, a: p1.angle, b: gameData.current.p1Boost, boosting: localInput.current.boost },
            p2: { x: p2.position.x, y: p2.position.y, a: p2.angle, b: gameData.current.p2Boost, boosting: guestInput.current.boost },
            s1: gameData.current.score1,
            s2: gameData.current.score2,
            phase: gameData.current.phase,
            timer: gameData.current.timer,
          }
        }
      }));
    };

    let lastTick = performance.now();
    let tickCount = 0;

    const gameLoop = setInterval(() => {
      const g = gameData.current;
      const b = bodiesRef.current;

      if (g.phase === 'COUNTDOWN') {
        tickCount++;
        if (tickCount > 60) {
          tickCount = 0;
          g.timer--;
          if (g.timer <= 0) g.phase = 'PLAYING';
        }
      } else if (g.phase === 'GOAL') {
        tickCount++;
        if (tickCount > 180) { // 3 seconds
          tickCount = 0;
          if (g.score1 >= 2 || g.score2 >= 2) {
             g.phase = 'FINISHED';
          } else {
             g.phase = 'COUNTDOWN';
             g.timer = 3;
             resetPositions();
          }
        }
      }

      // Process inputs if playing
      if (g.phase === 'PLAYING') {
        // Goal Check
        if (b.ball.position.x < -10 && b.ball.position.y > 250 && b.ball.position.y < 450) {
          const M = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
          
          g.score2++;
          g.phase = 'GOAL';
          playGoalSound();
          // apply little pop to ball
          M.Body.applyForce(b.ball, b.ball.position, {x: -0.05, y: 0});
        }
        if (b.ball.position.x > WORLD_WIDTH + 10 && b.ball.position.y > 250 && b.ball.position.y < 450) {
          const M = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
          g.score1++;
          g.phase = 'GOAL';
          playGoalSound();
          M.Body.applyForce(b.ball, b.ball.position, {x: 0.05, y: 0});
        }

        const applyInput = (car: any, input: any, isP1: boolean) => {
          const M = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
          const grounded = car.position.y > WORLD_HEIGHT - 65 || car.position.y < 90 || car.position.x < 90 || car.position.x > WORLD_WIDTH - 90; // any surface
          let boostRef = isP1 ? 'p1Boost' : 'p2Boost';
          let doubleJumpRef = isP1 ? 'p1CanDoubleJump' : 'p2CanDoubleJump';
          let jumpResetRef = isP1 ? 'p1JumpReset' : 'p2JumpReset';

          // Rotation & Movement
          if (grounded) {
             (g as any)[doubleJumpRef] = true; // reset double jump
             if (!input.jump) (g as any)[jumpResetRef] = true;
             
             // Move horizontally
             if (Math.abs(input.dx) > 0.1) {
                const speed = Math.abs(car.velocity.x);
                const mult = Math.max(0.2, 1 - (speed / 20));
                M.Body.applyForce(car, car.position, { x: input.dx * 0.015 * mult, y: 0 });
             } else {
                // drag
                M.Body.setVelocity(car, { x: car.velocity.x * 0.85, y: car.velocity.y });
             }
             // Keeps car upright
             if (Math.abs(car.angle) > 0.05) {
                M.Body.setAngularVelocity(car, car.angularVelocity * 0.5 - car.angle * 0.05);
             }
             
             // Regen boost
             (g as any)[boostRef] = Math.min(MAX_BOOST, (g as any)[boostRef] + BOOST_REGEN);
          } else {
             // In Air Rotation
             const targetAngle = Math.atan2(input.dy, input.dx);
             const magnitude = Math.sqrt(input.dx*input.dx + input.dy*input.dy);
             if (magnitude > 0.5) {
                 // Rotate towards target
                 const diff = targetAngle - car.angle;
                 // normalize diff
                 const normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
                 M.Body.setAngularVelocity(car, car.angularVelocity * 0.9 + normalizedDiff * 0.05);
             } else {
                 M.Body.setAngularVelocity(car, car.angularVelocity * 0.95);
             }
          }

          // Jump
          if (input.jump && (g as any)[jumpResetRef]) {
             if (grounded) {
                 M.Body.setVelocity(car, { x: car.velocity.x, y: -15 });
                 (g as any)[jumpResetRef] = false;
             } else if ((g as any)[doubleJumpRef]) {
                 // Double jump towards pointing direction
                 const forceY = -12;
                 M.Body.setVelocity(car, { x: car.velocity.x, y: forceY });
                 M.Body.applyForce(car, car.position, { x: input.dx * 0.02, y: 0 });
                 M.Body.setAngularVelocity(car, car.angularVelocity + (Math.sign(input.dx) * 0.2));
                 (g as any)[doubleJumpRef] = false;
                 (g as any)[jumpResetRef] = false;
             }
          }
          if (!input.jump && !grounded) {
             (g as any)[jumpResetRef] = true;
          }

          // Boost
          if (input.boost && (g as any)[boostRef] > 0) {
             (g as any)[boostRef] -= BOOST_DRAIN;
             
             let boostAngle = car.angle;
             const inputMag = Math.sqrt(input.dx*input.dx + input.dy*input.dy);
             
             if (inputMag > 0.1) {
                 boostAngle = Math.atan2(input.dy, input.dx);
             } else if (grounded) {
                 if (Math.abs(car.velocity.x) > 1) {
                     boostAngle = car.velocity.x > 0 ? 0 : Math.PI;
                 }
             }

             // Increased boost for faster launch
             const forceX = Math.cos(boostAngle) * 0.025;
             const forceY = Math.sin(boostAngle) * 0.025;
             M.Body.applyForce(car, car.position, { x: forceX, y: forceY });
          }
        };

        applyInput(b.p1, localInput.current, true);
        applyInput(b.p2, guestInput.current, false);
      }

      const M2 = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
      M2.Engine.update(engine, 1000 / TICKS_PER_SEC);
      broadcastState();
      
      // Also update local ui
      setGameState({
          ball: { x: b.ball.position.x, y: b.ball.position.y, a: b.ball.angle },
          p1: { x: b.p1.position.x, y: b.p1.position.y, a: b.p1.angle, b: g.p1Boost, boosting: localInput.current.boost },
          p2: { x: b.p2.position.x, y: b.p2.position.y, a: b.p2.angle, b: g.p2Boost, boosting: guestInput.current.boost },
          s1: g.score1,
          s2: g.score2,
          phase: g.phase,
          timer: g.timer,
      });

    }, 1000 / TICKS_PER_SEC);

    return () => {
      clearInterval(gameLoop);
      const M3 = MatterPkg.Engine ? MatterPkg : (MatterPkg as any).default || MatterPkg;
      M3.Engine.clear(engine);
    };
  }, [isHost, channel]);

  // Handle incoming network
  useEffect(() => {
    if (!channel) return;
    const onMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'GAME_MESSAGE' && msg.game === 'ROCKET_LEAGUE') {
          if (isHost && msg.payload.msgType === 'INPUT') {
            guestInput.current = msg.payload.input;
          } else if (!isHost && msg.payload.msgType === 'STATE') {
             if (gameState && (msg.payload.state.s1 > gameState.s1 || msg.payload.state.s2 > gameState.s2)) {
                 playGoalSound();
             }
            setGameState(msg.payload.state);
          }
        }
      } catch (err) {}
    };
    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [channel, isHost]);

  // Send input to host (if guest)
  const sendInput = () => {
    if (isHost || !channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify({
      type: 'GAME_MESSAGE',
      game: 'ROCKET_LEAGUE',
      payload: { msgType: 'INPUT', input: localInput.current }
    }));
  };

  const handleInputStart = (action: 'jump' | 'boost') => {
    triggerHapticClick();
    if (action === 'jump') playJumpSound();
    localInput.current[action] = true;
    sendInput();
  };
  const handleInputEnd = (action: 'jump' | 'boost') => {
    localInput.current[action] = false;
    sendInput();
  };

  // Joystick state
  const joystickRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [joystickThumb, setJoystickThumb] = useState({x: 0, y: 0});

  const updateJoystick = (clientX: number, clientY: number) => {
      if (!joystickRef.current) return;
      const rect = joystickRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxDist = rect.width / 2;
      
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
      }
      
      setJoystickThumb({x: dx, y: dy});
      // Increase sensitivity by multiplying by 1.5, cap at [-1, 1]
      const sens = 1.5;
      localInput.current.dx = Math.max(-1, Math.min(1, (dx / maxDist) * sens));
      localInput.current.dy = Math.max(-1, Math.min(1, (dy / maxDist) * sens));
      sendInput();
  };

  const onPointerDown = (e: React.PointerEvent) => {
      if (pointerId.current !== null) return;
      pointerId.current = e.pointerId;
      updateJoystick(e.clientX, e.clientY);
  };
  
  const onPointerMove = (e: React.PointerEvent) => {
      if (e.pointerId === pointerId.current) {
          updateJoystick(e.clientX, e.clientY);
      }
  };

  const onPointerUp = (e: React.PointerEvent) => {
      if (e.pointerId === pointerId.current) {
          pointerId.current = null;
          setJoystickThumb({x: 0, y: 0});
          localInput.current.dx = 0;
          localInput.current.dy = 0;
          sendInput();
      }
  };

  return (
    <div className="w-full max-w-5xl min-h-[300px] aspect-video md:aspect-[21/9] bg-slate-900 flex flex-col items-center justify-center relative touch-none select-none overflow-hidden rounded-[2rem] shadow-2xl" ref={containerRef}>
      
      {/* HUD Info */}
      <div className="absolute top-4 left-0 right-0 flex justify-between px-8 z-20 pointer-events-none">
         <div className="flex bg-slate-800/80 backdrop-blur rounded-2xl p-2 gap-4 border border-slate-700 items-center drop-shadow-xl">
             <div className="text-3xl font-bold bg-indigo-500 text-white w-12 h-12 flex items-center justify-center rounded-xl">{gameState?.s1 ?? 0}</div>
             <div className="text-slate-400 font-bold uppercase tracking-widest text-sm">Score</div>
             <div className="text-3xl font-bold bg-rose-500 text-white w-12 h-12 flex items-center justify-center rounded-xl">{gameState?.s2 ?? 0}</div>
         </div>
         {gameState?.phase === 'FINISHED' && (
             <button onClick={onBackToLobby} className="pointer-events-auto bg-white/20 hover:bg-white/30 text-white p-3 rounded-xl backdrop-blur transition-all">
                 <ArrowLeft />
             </button>
         )}
      </div>

      {/* World Container (Camera View) */}
      <div className="absolute inset-0 z-0 overflow-hidden" style={{ perspective: 1000 }}>
        <div 
          className="absolute border-4 border-slate-700 bg-slate-800 drop-shadow-[0_0_50px_rgba(0,0,0,0.5)] will-change-transform rounded-3xl"
          style={{
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% - ${camera.x - WORLD_WIDTH/2}px), calc(-50% - ${camera.y - WORLD_HEIGHT/2}px)) scale(${camera.scale})`,
            transformOrigin: 'center center'
          }}
        >
          {/* Goals visually */}
        <div className="absolute left-[-100px] top-[250px] w-[100px] h-[200px] border-l-8 border-y-8 border-indigo-500/50 bg-indigo-500/10 rounded-l-3xl shadow-[inset_0_0_50px_rgba(99,102,241,0.2)]" />
        <div className="absolute right-[-100px] top-[250px] w-[100px] h-[200px] border-r-8 border-y-8 border-rose-500/50 bg-rose-500/10 rounded-r-3xl shadow-[inset_0_0_50px_rgba(244,63,94,0.2)]" />
        
        {/* Ramps visually (rounded corners) */}
        <div className="absolute top-0 left-0 w-[150px] h-[150px] border-t-[16px] border-l-[16px] border-slate-600 rounded-tl-full" />
        <div className="absolute bottom-0 left-0 w-[150px] h-[150px] border-b-[16px] border-l-[16px] border-slate-600 rounded-bl-full" />
        <div className="absolute top-0 right-0 w-[150px] h-[150px] border-t-[16px] border-r-[16px] border-slate-600 rounded-tr-full" />
        <div className="absolute bottom-0 right-0 w-[150px] h-[150px] border-b-[16px] border-r-[16px] border-slate-600 rounded-br-full" />

        {/* Outer Bounds styling */}
        <div className="absolute left-0 top-0 bottom-0 w-2 bg-slate-600 rounded-full" />
        <div className="absolute right-0 top-0 bottom-0 w-2 bg-slate-600 rounded-full" />
        <div className="absolute top-0 left-0 right-0 h-2 bg-slate-600 rounded-full" />
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-600 rounded-full" />

        {gameState && (
            <>
               {/* Ball */}
               <div className="absolute top-0 left-0 w-[60px] h-[60px] rounded-full bg-white border-[6px] border-amber-300 shadow-[0_0_30px_rgba(255,200,0,0.5)] flex items-center justify-center will-change-transform z-20"
                     style={{
                        transform: `translate(${gameState.ball.x - 30}px, ${gameState.ball.y - 30}px) rotate(${gameState.ball.a}rad)`
                     }}
                >
                    <div className="w-8 h-2 bg-amber-400 rounded-full" />
                </div>

               {/* Player 1 (Indigo) */}
               <div className="absolute top-0 left-0 w-[80px] h-[40px] will-change-transform z-20"
                    style={{ transform: `translate(${gameState.p1.x - 40}px, ${gameState.p1.y - 20}px) rotate(${gameState.p1.a}rad)` }}>
                    <div className="w-full h-[32px] bg-indigo-500 rounded-xl border-[3px] border-indigo-400 relative shadow-[inset_0_-5px_10px_rgba(0,0,0,0.2)] z-20 overflow-hidden">
                         <div className="absolute right-2 top-1 bottom-1 w-6 bg-indigo-300/80 rounded-sm" />
                    </div>
                    {/* Exhaust visual */}
                    {gameState.p1.boosting && gameState.p1.b > 0 && <div className="absolute left-[-30px] top-1/2 -translate-y-1/2 w-[40px] h-[15px] bg-sky-300 blur-[4px] rounded-full z-10" />}
                    {/* Wheels */}
                    <div className="absolute left-[10%] -bottom-2 w-[24px] h-[24px] bg-slate-800 rounded-full border-[4px] border-slate-950 z-30 flex items-center justify-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full" />
                    </div>
                    <div className="absolute right-[10%] -bottom-2 w-[24px] h-[24px] bg-slate-800 rounded-full border-[4px] border-slate-950 z-30 flex items-center justify-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full" />
                    </div>
               </div>

               {/* Player 2 (Rose) */}
               <div className="absolute top-0 left-0 w-[80px] h-[40px] will-change-transform z-20"
                    style={{ transform: `translate(${gameState.p2.x - 40}px, ${gameState.p2.y - 20}px) rotate(${gameState.p2.a}rad)` }}>
                    <div className="w-full h-[32px] bg-rose-500 rounded-xl border-[3px] border-rose-400 relative shadow-[inset_0_-5px_10px_rgba(0,0,0,0.2)] z-20 overflow-hidden">
                         <div className="absolute left-2 top-1 bottom-1 w-6 bg-rose-300/80 rounded-sm" />
                    </div>
                    {/* Exhaust visual */}
                    {gameState.p2.boosting && gameState.p2.b > 0 && <div className="absolute right-[-30px] top-1/2 -translate-y-1/2 w-[40px] h-[15px] bg-sky-300 blur-[4px] rounded-full z-10" />}
                    {/* Wheels */}
                    <div className="absolute left-[10%] -bottom-2 w-[24px] h-[24px] bg-slate-800 rounded-full border-[4px] border-slate-950 z-30 flex items-center justify-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full" />
                    </div>
                    <div className="absolute right-[10%] -bottom-2 w-[24px] h-[24px] bg-slate-800 rounded-full border-[4px] border-slate-950 z-30 flex items-center justify-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full" />
                    </div>
               </div>
            </>
        )}

        {/* Overlays */}
        {gameState?.phase === 'COUNTDOWN' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-30">
               <span className="text-[150px] font-black text-white drop-shadow-2xl animate-in zoom-in spin-in-12">
                   {gameState.timer > 0 ? gameState.timer : 'GO!'}
               </span>
            </div>
        )}
        {gameState?.phase === 'GOAL' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/10 backdrop-blur-md z-30">
               <span className="text-[100px] font-black text-amber-400 drop-shadow-xl animate-bounce tracking-widest uppercase">Goal!</span>
            </div>
        )}
        {gameState?.phase === 'FINISHED' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-40">
               <Trophy className="w-40 h-40 text-amber-400 mb-8 animate-pulse" />
               <span className="text-[80px] font-black text-white drop-shadow-2xl">
                   {gameState.s1 >= 2 ? 'BLUE WINS' : 'RED WINS'}
               </span>
               {isHost && (
                   <button onClick={onBackToLobby} className="mt-8 px-12 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-full text-3xl font-bold text-white transition-all active:scale-95 shadow-[0_0_40px_rgba(79,70,229,0.5)]">
                       Back to Lobby
                   </button>
               )}
            </div>
        )}
        </div>
      </div>

      {/* On-Screen Controls */}
      {gameState?.phase !== 'FINISHED' && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-between px-16 z-50 pointer-events-none">
            {/* Joystick */}
            <div 
                ref={joystickRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="w-48 h-48 rounded-full bg-white/10 border-2 border-white/20 backdrop-blur-md pointer-events-auto relative shadow-[inset_0_0_30px_rgba(0,0,0,0.2)] touch-none"
            >
                <div 
                   className="absolute w-20 h-20 bg-white/80 rounded-full shadow-lg border border-white/50"
                   style={{
                       left: '50%', top: '50%',
                       transform: `translate(calc(-50% + ${joystickThumb.x}px), calc(-50% + ${joystickThumb.y}px))`
                   }}
                />
            </div>

            {/* Action Buttons & Boost Meters */}
            <div className="flex gap-8 items-end">
                <div className="flex flex-col items-center gap-4">
                     <div className="w-8 h-32 bg-black/40 rounded-full p-1 border border-white/10 backdrop-blur overflow-hidden flex items-end">
                         <div 
                            className="w-full bg-amber-400 rounded-full transition-all duration-75 shadow-[0_0_15px_rgba(251,191,36,0.5)]"
                            style={{ height: `${isHost ? (gameState?.p1?.b || 0) : (gameState?.p2?.b || 0)}%` }}
                         />
                     </div>
                     <button
                        onPointerDown={() => handleInputStart('boost')}
                        onPointerUp={() => handleInputEnd('boost')}
                        onPointerCancel={() => handleInputEnd('boost')}
                        className="w-28 h-28 rounded-full bg-amber-500/80 active:bg-amber-400/90 text-white font-bold text-xl border-4 border-amber-300 pointer-events-auto touch-none shadow-[0_0_40px_rgba(245,158,11,0.4)] flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
                     >
                        <Zap className="w-8 h-8 fill-current" />
                        BOOST
                     </button>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <button
                        onPointerDown={() => handleInputStart('jump')}
                        onPointerUp={() => handleInputEnd('jump')}
                        onPointerCancel={() => handleInputEnd('jump')}
                        className="w-28 h-28 rounded-full bg-white/20 active:bg-white/40 text-white font-bold text-xl border-4 border-white/50 pointer-events-auto touch-none shadow-[0_0_40px_rgba(255,255,255,0.2)] flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform backdrop-blur"
                     >
                        JUMP
                    </button>
                </div>
            </div>
          </div>
      )}
    </div>
  );
}
