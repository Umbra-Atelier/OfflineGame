export type GameType = 'TAP_WAR' | 'PONG' | 'CHESS' | 'HIDDEN_ROLE';

export interface BaseMessage {
  type: 'LOBBY_STATE' | 'START_GAME' | 'GAME_MESSAGE' | 'BACK_TO_LOBBY';
  payload?: any;
}

export interface GameMessage extends BaseMessage {
  type: 'GAME_MESSAGE';
  game: GameType;
  payload: any;
}

export const GAMES: Record<GameType, { id: GameType; name: string; description: string; tutorial: string[] }> = {
  TAP_WAR: {
    id: 'TAP_WAR',
    name: 'Tap War',
    description: 'Tap faster than your opponent to win!',
    tutorial: [
      'Spam the TAP button as fast as you can.',
      'Push the bar all the way to your opponent\'s side to win.'
    ]
  },
  PONG: {
    id: 'PONG',
    name: 'Pong',
    description: 'Classic paddle and ball game.',
    tutorial: [
      'Drag your finger horizontally across the screen to move your paddle.',
      'Bounce the ball past your opponent to score a point.',
      'The first player to reach 7 points wins the match.'
    ]
  },
  CHESS: {
    id: 'CHESS',
    name: 'Chess',
    description: 'A game of strategy and intellect.',
    tutorial: [
      'Drag and drop pieces to move them.',
      'Standard chess rules apply (all pawns automatically promote to Queens).',
      'Checkmate the opponent\'s king to win.'
    ]
  },
  HIDDEN_ROLE: {
    id: 'HIDDEN_ROLE',
    name: "Who's the Murderer?",
    description: 'A hidden role game of deception and deduction.',
    tutorial: [
      'You will be assigned a random secret role at the start.',
      'Murderer: Eliminate one person each night.',
      'Detective: Investigate one person each night to see if they are the Murderer.',
      'Sheriff: Protect one person each night, preventing them from being killed.',
      'Villager/Jester: Survive, deduce, and vote during the day. The Jester WANTS to be voted out to win!',
      'Bots will fill out the rest of the town. During the day, everyone votes on who to eliminate.'
    ]
  }
};
