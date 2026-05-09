import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { GameMessage } from '../../types';

interface TapWarProps {
  channel: RTCDataChannel;
  isHost: boolean;
  onBackToLobby: () => void;
}

export function TapWar({ channel, isHost, onBackToLobby }: TapWarProps) {
  // Score goes from -50 to +50. 
  // if score > 50, Host wins. if score < -50, Guest wins.
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState<string | null>(null);

  const handleMessage = useCallback((event: MessageEvent) => {
    const message = JSON.parse(event.data);
    if (message.type === 'GAME_MESSAGE' && message.game === 'TAP_WAR') {
      const data = message.payload;
      if (data.type === 'TAP') {
        setScore(data.score);
        if (data.score >= 50) setGameOver("Host wins!");
        if (data.score <= -50) setGameOver("Joiner wins!");
      } else if (data.type === 'REMATCH') {
        setScore(0);
        setGameOver(null);
      }
    }
  }, []);

  useEffect(() => {
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
    };
  }, [channel, handleMessage]);

  const doTap = () => {
    if (gameOver) return;
    
    // Determine new score
    const delta = isHost ? 1 : -1;
    const newScore = score + delta;
    
    // Update locally
    setScore(newScore);

    if (newScore >= 50) setGameOver("Host wins!");
    if (newScore <= -50) setGameOver("Joiner wins!");

    // Send to peer
    if (channel.readyState === 'open') {
      const msg: GameMessage = {
        type: 'GAME_MESSAGE',
        game: 'TAP_WAR',
        payload: { type: 'TAP', score: newScore }
      };
      channel.send(JSON.stringify(msg));
    }
  };

  const requestRematch = () => {
    setScore(0);
    setGameOver(null);
    if (channel.readyState === 'open') {
      const msg: GameMessage = {
        type: 'GAME_MESSAGE',
        game: 'TAP_WAR',
        payload: { type: 'REMATCH' }
      };
      channel.send(JSON.stringify(msg));
    }
  };

  const hostPercentage = 50 + score;

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-md mx-auto min-h-[60vh] gap-8">
      <div className="flex w-full justify-between items-center">
        <button 
          onClick={onBackToLobby}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          &larr; Lobby
        </button>
      </div>
      <div className="text-center mt-[-40px]">
        <h2 className="text-2xl font-bold mb-2">Tap War!</h2>
        <p className="text-gray-500">
          You are the <span className="font-bold text-gray-800">{isHost ? 'Host' : 'Joiner'}</span>.
          Tap faster than your opponent to push the bar!
        </p>
      </div>

      <div className="relative w-full h-8 bg-gray-200 rounded-full overflow-hidden shadow-inner">
        <motion.div
          className="absolute top-0 left-0 h-full bg-blue-500"
          animate={{ width: `${hostPercentage}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        />
        <motion.div
          className="absolute top-0 right-0 h-full bg-red-500"
          animate={{ width: `${100 - hostPercentage}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        />
        <div className="absolute top-0 left-1/2 w-1 h-full bg-white opacity-50 shadow-md transform -translate-x-1/2"></div>
      </div>

      <button
        onClick={doTap}
        disabled={!!gameOver}
        className="w-48 h-48 rounded-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 active:scale-95 text-white shadow-xl transition-all font-bold text-3xl touch-manipulation flex items-center justify-center select-none"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        TAP!
      </button>

      {gameOver && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-white rounded-2xl shadow-xl text-center z-10 space-y-4"
        >
          <h3 className="text-3xl font-extrabold text-gray-900">{gameOver}</h3>
          <button 
            onClick={requestRematch}
            className="px-6 py-2 bg-gray-100 font-medium rounded-lg text-gray-800 hover:bg-gray-200"
          >
            Rematch
          </button>
        </motion.div>
      )}
    </div>
  );
}
