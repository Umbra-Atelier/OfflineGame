import { GameType, GAMES } from '../types';
import { Gamepad2, ArrowRight, Info } from 'lucide-react';

interface LobbyProps {
  isHost: boolean;
  selectedGame: GameType | null;
  onSelectGame: (game: GameType) => void;
  onStartGame: () => void;
}

export function Lobby({ isHost, selectedGame, onSelectGame, onStartGame }: LobbyProps) {
  return (
    <div className="w-full max-w-md mx-auto min-h-[60vh] flex flex-col p-6 sm:p-2 space-y-6">
      <div className="text-center mb-4">
        <h2 className="text-3xl font-display font-extrabold flex items-center justify-center gap-3 text-neutral-900 tracking-tight">
          <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
            <Gamepad2 className="w-6 h-6" />
          </div>
          Game Lobby
        </h2>
        <p className="text-neutral-500 mt-3 font-medium">
          {isHost ? "You are the Host. Choose a game to play." : "Waiting for Host to choose a game..."}
        </p>
      </div>

      <div className="space-y-4 pt-2 flex-1">
        {Object.values(GAMES).map((game) => {
          const isSelected = selectedGame === game.id;
          return (
            <div key={game.id} className="relative group">
              <button
                onClick={() => isHost && onSelectGame(game.id)}
                disabled={!isHost}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all duration-200 outline-none focus-visible:ring-4 focus-visible:ring-indigo-100 ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                    : 'border-white bg-white shadow-sm hover:border-indigo-200 hover:shadow-md'
                } ${!isHost && 'cursor-default opacity-80'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className={`text-lg font-display font-bold tracking-tight ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                      {game.name}
                    </h3>
                    <p className={`text-sm mt-1 leading-relaxed ${isSelected ? 'text-indigo-700/80' : 'text-neutral-500'}`}>
                      {game.description}
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-1 transition-colors ${isSelected ? 'border-indigo-600 bg-indigo-600' : 'border-neutral-300'}`}>
                    {isSelected && <div className="w-full h-full rounded-full border-2 border-indigo-50 bg-indigo-600"></div>}
                  </div>
                </div>
              </button>
              
              {isSelected && (
                <div className="mt-3 mx-2 p-5 bg-indigo-50/80 backdrop-blur-sm border border-indigo-100/50 rounded-xl animate-in fade-in slide-in-from-top-2">
                  <h4 className="flex items-center gap-2 font-display font-bold text-indigo-900 mb-3 text-xs uppercase tracking-widest opacity-80">
                    <Info className="w-4 h-4" /> How to Play
                  </h4>
                  <ul className="list-disc list-outside pl-5 space-y-2 text-sm text-indigo-900/80 leading-relaxed font-medium">
                    {game.tutorial.map((line, idx) => (
                      <li key={idx} className="pl-1 leading-snug">{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isHost ? (
        <button
          onClick={onStartGame}
          disabled={!selectedGame}
          className="w-full mt-auto py-4 bg-neutral-900 text-white rounded-2xl shadow-lg shadow-neutral-900/20 font-bold text-lg hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          Start Match <ArrowRight className="w-5 h-5" />
        </button>
      ) : (
        <div className="w-full mt-auto py-4 bg-neutral-100 text-neutral-500 rounded-2xl text-center font-medium border border-neutral-200/60 shadow-sm animate-pulse">
          Waiting for Host to start...
        </div>
      )}
    </div>
  );
}
