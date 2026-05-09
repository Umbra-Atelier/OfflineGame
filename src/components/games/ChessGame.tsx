import { useState, useCallback, useEffect } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { GameMessage } from '../../types';

interface ChessGameProps {
  channel: RTCDataChannel;
  isHost: boolean; // Host plays White, Joiner plays Black
  onBackToLobby: () => void;
}

export function ChessGame({ channel, isHost, onBackToLobby }: ChessGameProps) {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [gameOverStr, setGameOverStr] = useState<string | null>(null);

  const myColor = isHost ? 'white' : 'black';
  const isMyTurn = game.turn() === myColor[0];

  const sendMessage = useCallback((payload: any) => {
    if (channel.readyState === 'open') {
      const msg: GameMessage = {
        type: 'GAME_MESSAGE',
        game: 'CHESS',
        payload
      };
      channel.send(JSON.stringify(msg));
    }
  }, [channel]);

  // Handle incoming moves and restarts
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'GAME_MESSAGE' && message.game === 'CHESS') {
        const data = message.payload;
        
        if (data.type === 'MOVE') {
          const gameCopy = new Chess(fen);
          gameCopy.move(data.move);
          setGame(gameCopy);
          setFen(gameCopy.fen());
          checkGameOver(gameCopy);
        } else if (data.type === 'RESTART') {
          const newGame = new Chess();
          setGame(newGame);
          setFen(newGame.fen());
          setGameOverStr(null);
        }
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => channel.removeEventListener('message', handleMessage);
  }, [channel, fen]);

  const checkGameOver = (current_game: Chess) => {
    if (current_game.isCheckmate()) setGameOverStr("Checkmate!");
    else if (current_game.isDraw()) setGameOverStr("Draw!");
    else if (current_game.isStalemate()) setGameOverStr("Stalemate!");
  };

  const onDrop = (sourceSquare: string, targetSquare: string) => {
    // Prevent moving if not our turn or game is over
    if (!isMyTurn || gameOverStr) return false;

    try {
      const gameCopy = new Chess(fen);
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (move === null) return false;

      setGame(gameCopy);
      setFen(gameCopy.fen());
      checkGameOver(gameCopy);

      // Send to peer
      sendMessage({ type: 'MOVE', move });
      return true;
    } catch (e) {
      return false; // Illegal move
    }
  };

  const startNewGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setFen(newGame.fen());
    setGameOverStr(null);
    sendMessage({ type: 'RESTART' });
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-md mx-auto min-h-[60vh]">
      <div className="flex w-full justify-between items-center mb-6">
        <button 
          onClick={onBackToLobby}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          &larr; Lobby
        </button>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
          isMyTurn ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
        }`}>
          {isMyTurn ? "Your Turn" : "Opponent's Turn"}
        </span>
      </div>

      <div className="w-full max-w-[320px] aspect-square rounded overflow-hidden shadow-2xl mb-8">
        <Chessboard 
          {...({
            position: fen,
            onPieceDrop: onDrop,
            boardOrientation: myColor,
            customDarkSquareStyle: { backgroundColor: '#779556' },
            customLightSquareStyle: { backgroundColor: '#ebecd0' }
          } as any)}
        />
      </div>

      {gameOverStr && (
        <div className="text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">{gameOverStr}</h3>
          <button 
            onClick={startNewGame}
            className="px-6 py-2 bg-indigo-600 font-medium rounded-lg text-white shadow hover:bg-indigo-700"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
