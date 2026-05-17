import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GameMessage } from '../../types';

interface PongProps {
  channel: RTCDataChannel;
  isHost: boolean;
  onBackToLobby: () => void;
}

const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 400;
const PADDLE_WIDTH = 60;
const PADDLE_HEIGHT = 10;
const BALL_SIZE = 8;
const PADDLE_SPEED = 5;

export function Pong({ channel, isHost, onBackToLobby }: PongProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Game state
  const [gameState, setGameState] = useState<'WAITING' | 'PLAYING' | 'GAME_OVER'>('WAITING');
  const [winner, setWinner] = useState<string | null>(null);

  // Position references (refs are better for high-frequency animation loop updates)
  const myPaddleRef = useRef({ x: CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2 });
  const theirPaddleRef = useRef({ x: CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2 });
  const ballRef = useRef({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, dx: 3, dy: -3 });
  
  const scoreRef = useRef({ host: 0, guest: 0 });
  const [scores, setScores] = useState({ host: 0, guest: 0 });

  const keysRef = useRef<{ [key: string]: boolean }>({});
  
  // Host controls the ball. Joiner just sends paddle position and receives ball position.
  
  const sendMessage = useCallback((payload: any) => {
    if (channel.readyState === 'open') {
      const msg: GameMessage = {
        type: 'GAME_MESSAGE',
        game: 'PONG',
        payload
      };
      channel.send(JSON.stringify(msg));
    }
  }, [channel]);

  // Handle messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'GAME_MESSAGE' && message.game === 'PONG') {
        const data = message.payload;
        
        if (data.type === 'STATE_SYNC' && !isHost) {
          // Host sends full state to guest
          theirPaddleRef.current.x = CANVAS_WIDTH - data.myPaddleX - PADDLE_WIDTH; // mirror x
          ballRef.current = {
            ...data.ball,
            x: CANVAS_WIDTH - data.ball.x, // mirror x
            y: CANVAS_HEIGHT - data.ball.y // mirror y
          };
          scoreRef.current = data.score;
          setScores(data.score);
        } else if (data.type === 'PADDLE_MOVED') {
          // Guest sends paddle to Host (or host to guest, but STATE_SYNC overrides host to guest later)
          theirPaddleRef.current.x = CANVAS_WIDTH - data.x - PADDLE_WIDTH; 
        } else if (data.type === 'GAME_START') {
          setGameState('PLAYING');
          scoreRef.current = { host: 0, guest: 0 };
          setScores({ host: 0, guest: 0 });
        } else if (data.type === 'GAME_OVER') {
          setGameState('GAME_OVER');
          setWinner(data.winner);
        }
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => channel.removeEventListener('message', handleMessage);
  }, [channel, isHost]);

  // Touch and Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.key] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (gameState !== 'PLAYING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const scaleX = CANVAS_WIDTH / (rect.width || 1);
    const x = (touch.clientX - rect.left) * scaleX - PADDLE_WIDTH / 2;
    
    if (!isNaN(x)) {
      myPaddleRef.current.x = Math.max(0, Math.min(x, CANVAS_WIDTH - PADDLE_WIDTH));
      sendMessage({ type: 'PADDLE_MOVED', x: myPaddleRef.current.x });
    }
  };

  // Game Loop
  useEffect(() => {
    let animationId: number;
    let lastSyncTime = 0;

    const gameLoop = (timestamp: number) => {
      if (gameState !== 'PLAYING') return;

      // Handle local paddle movement via keyboard
      if (keysRef.current['ArrowLeft'] || keysRef.current['a']) {
        myPaddleRef.current.x = Math.max(0, myPaddleRef.current.x - PADDLE_SPEED);
        sendMessage({ type: 'PADDLE_MOVED', x: myPaddleRef.current.x });
      }
      if (keysRef.current['ArrowRight'] || keysRef.current['d']) {
        myPaddleRef.current.x = Math.min(CANVAS_WIDTH - PADDLE_WIDTH, myPaddleRef.current.x + PADDLE_SPEED);
        sendMessage({ type: 'PADDLE_MOVED', x: myPaddleRef.current.x });
      }

      const ball = ballRef.current;

      // Host updates ball physics
      if (isHost) {
        ball.x += ball.dx;
        ball.y += ball.dy;

        // Wall bounce (left/right)
        if (ball.x <= 0 || ball.x >= CANVAS_WIDTH - BALL_SIZE) {
          ball.dx *= -1;
        }

        // Host paddle bounce (bottom)
        if (
          ball.y >= CANVAS_HEIGHT - PADDLE_HEIGHT - BALL_SIZE && 
          ball.y <= CANVAS_HEIGHT &&
          ball.x + BALL_SIZE >= myPaddleRef.current.x && 
          ball.x <= myPaddleRef.current.x + PADDLE_WIDTH
        ) {
          ball.dy *= -1;
          ball.y = CANVAS_HEIGHT - PADDLE_HEIGHT - BALL_SIZE;
        }

        // Guest paddle bounce (top) - remember their paddle is at Y=0
        if (
          ball.y <= PADDLE_HEIGHT && 
          ball.y >= 0 &&
          ball.x + BALL_SIZE >= theirPaddleRef.current.x && 
          ball.x <= theirPaddleRef.current.x + PADDLE_WIDTH
        ) {
          ball.dy *= -1;
          ball.y = PADDLE_HEIGHT;
        }

        // Scoring
        if (ball.y < 0) {
          scoreRef.current.host += 1;
          resetBall();
        } else if (ball.y > CANVAS_HEIGHT) {
          scoreRef.current.guest += 1;
          resetBall();
        }

        setScores({ ...scoreRef.current });

        // Win condition
        if (scoreRef.current.host >= 7) {
          setGameState('GAME_OVER');
          setWinner('Host');
          sendMessage({ type: 'GAME_OVER', winner: 'Host' });
        } else if (scoreRef.current.guest >= 7) {
          setGameState('GAME_OVER');
          setWinner('Joiner');
          sendMessage({ type: 'GAME_OVER', winner: 'Joiner' });
        }

        // Sync state to guest at 30Hz
        if (timestamp - lastSyncTime > 33) {
          sendMessage({
            type: 'STATE_SYNC',
            myPaddleX: myPaddleRef.current.x,
            ball: ballRef.current,
            score: scoreRef.current
          });
          lastSyncTime = timestamp;
        }
      }

      draw();
      animationId = requestAnimationFrame(gameLoop);
    };

    const resetBall = () => {
      ballRef.current = {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        dx: (Math.random() > 0.5 ? 1 : -1) * 3,
        dy: (Math.random() > 0.5 ? 1 : -1) * 3,
      };
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Center Line
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_HEIGHT / 2);
      ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
      ctx.strokeStyle = '#374151';
      ctx.stroke();
      ctx.setLineDash([]);

      // My Paddle (Always Bottom)
      ctx.fillStyle = '#4F46E5'; // Indigo
      const myX = isNaN(myPaddleRef.current.x) ? CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2 : myPaddleRef.current.x;
      ctx.fillRect(myX, CANVAS_HEIGHT - PADDLE_HEIGHT, PADDLE_WIDTH, PADDLE_HEIGHT);

      // Their Paddle (Always Top)
      ctx.fillStyle = '#EF4444'; // Red
      const theirX = isNaN(theirPaddleRef.current.x) ? CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2 : theirPaddleRef.current.x;
      ctx.fillRect(theirX, 0, PADDLE_WIDTH, PADDLE_HEIGHT);

      // Ball
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(ballRef.current.x, ballRef.current.y, BALL_SIZE, BALL_SIZE);
    };

    // Initial Draw if not playing
    if (gameState !== 'PLAYING') {
      draw();
    } else {
      animationId = requestAnimationFrame(gameLoop);
    }

    return () => cancelAnimationFrame(animationId);
  }, [gameState, isHost, sendMessage]);

  const startGame = () => {
    if (isHost) {
      sendMessage({ type: 'GAME_START' });
      setGameState('PLAYING');
      scoreRef.current = { host: 0, guest: 0 };
      setScores({ host: 0, guest: 0 });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-md mx-auto min-h-[60vh] gap-6">
      <div className="flex w-full justify-between items-center px-4">
        <button 
          onClick={onBackToLobby}
          className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          &larr; Lobby
        </button>
        <div className="font-mono text-3xl font-bold font-tabular-nums px-4 py-2 bg-white rounded-2xl shadow-sm border border-neutral-200/60">
          <span className={isHost ? 'text-indigo-600' : 'text-rose-500'}>{scores.host}</span>
          <span className="mx-3 text-neutral-300">-</span>
          <span className={!isHost ? 'text-indigo-600' : 'text-rose-500'}>{scores.guest}</span>
        </div>
      </div>

      <div 
        className="relative bg-neutral-900 rounded-[2rem] overflow-hidden shadow-xl sm:w-[320px] w-full border-[6px] border-neutral-800"
        style={{ aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full touch-none"
          onTouchMove={handleTouchMove}
        />
        
        {gameState === 'WAITING' && (
          <div className="absolute inset-0 bg-neutral-900/80 flex flex-col items-center justify-center text-white p-6 text-center backdrop-blur-sm">
            <h3 className="text-4xl font-display font-bold mb-8 tracking-tight">Pong</h3>
            {isHost ? (
              <button 
                onClick={startGame}
                className="px-8 py-4 bg-white text-neutral-900 rounded-2xl font-bold hover:bg-neutral-100 transition-all active:scale-[0.98] shadow-lg"
              >
                Start Match
              </button>
            ) : (
              <p className="font-medium text-neutral-300 animate-pulse">Waiting for Host to start...</p>
            )}
            <p className="mt-8 text-sm text-neutral-400 text-balance font-medium">
              Drag your finger to move the bottom paddle. First to 7 wins!
            </p>
          </div>
        )}

        {gameState === 'GAME_OVER' && (
          <div className="absolute inset-0 bg-neutral-900/90 flex flex-col items-center justify-center text-white p-6 text-center backdrop-blur-md">
            <h3 className="text-4xl font-display font-bold mb-3 tracking-tight">Game Over</h3>
            <p className="text-2xl mb-8 font-medium text-emerald-400">{winner} Wins!</p>
            {isHost ? (
              <button 
                onClick={startGame}
                className="px-8 py-4 bg-white text-neutral-900 rounded-2xl font-bold hover:bg-neutral-100 transition-all active:scale-[0.98] shadow-lg"
              >
                Play Again
              </button>
            ) : (
              <p className="font-medium text-neutral-300 animate-pulse">Waiting for Host...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
