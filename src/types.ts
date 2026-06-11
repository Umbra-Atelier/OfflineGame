export type GameType = 'TAP_WAR' | 'PONG' | 'CHESS' | 'HIDDEN_ROLE' | 'CARD_BATTLE' | 'ROCKET_LEAGUE' | 'MAGIC_TILES' | 'LASER_TAG' | 'NEON_SNAKE';

export interface BaseMessage {
  type: 'LOBBY_STATE' | 'START_GAME' | 'GAME_MESSAGE' | 'BACK_TO_LOBBY' | 'SET_ID' | 'GO_TO_LOBBY';
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
  },
  CARD_BATTLE: {
    id: 'CARD_BATTLE',
    name: 'Card Battle Ground',
    description: 'Deploy cards to destroy enemy towers like Clash Royale.',
    tutorial: [
      'You get an initial deck of 12 cards, with 4 playable in your hand.',
      'Tap a card to select it, then tap anywhere on your side of the map to deploy it.',
      'Deploy units costing Elixir (which regenerates over time).',
      'Destroy the enemy King Tower to win! Win matches to get Card Secrets to unlock more cards.'
    ]
  },
  ROCKET_LEAGUE: {
    id: 'ROCKET_LEAGUE',
    name: 'Rocket League 2D',
    description: 'Sideswipe-style car soccer! First to 2 goals wins.',
    tutorial: [
      'Use the joystick on the left to move and rotate.',
      'Use the Jump and Boost buttons on the right to fly.',
      'Hit the ball into the opponent\'s goal to score!',
      'Best of 3 rounds (first to 2 goals).'
    ]
  },
  MAGIC_TILES: {
    id: 'MAGIC_TILES',
    name: 'Magic Tiles',
    description: 'Tap the tiles to send them falling to your opponent!',
    tutorial: [
      'Tap the tiles as they appear on your screen.',
      'Tapping a tile sends it to your opponent.',
      'If you miss a tile, you lose a life.',
      'Survive longer than your opponent to win!'
    ]
  },
  LASER_TAG: {
    id: 'LASER_TAG',
    name: 'First Person Laser Tag',
    description: 'Online Multiplayer 3D Laser Tag!',
    tutorial: [
      'Use the joystick on the left to move.',
      'Swipe anywhere else on the screen to look around.',
      'Tap the Shoot button on the right to fire your laser.',
      'First to 5 tags wins the game!'
    ]
  },
  NEON_SNAKE: {
    id: 'NEON_SNAKE',
    name: 'Neon Snake',
    description: 'Slither around, eat food to grow, and outlast your opponents!',
    tutorial: [
      'Drag your finger or mouse to guide your snake.',
      'Use the boost button on the left to speed up, but it costs length!',
      'Cut off other snakes to defeat them.',
      'Watch your boost bar and level above your head!'
    ]
  }
};
