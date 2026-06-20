export interface Vector2 { x: number; y: number; }

export type EntityType = 'PLAYER' | 'GUARD' | 'BLOCK' | 'WALL' | 'BUTTON' | 'DOOR' | 'LASER' | 'LOOT' | 'HAZARD_GREASE' | 'HAZARD_HEAT';

export interface BaseEntity {
  id: string;
  type: EntityType;
  pos: Vector2;
  width: number; // For rects
  height: number;
  radius: number; // For circles
  isStatic: boolean;
}

export interface Player extends BaseEntity {
  type: 'PLAYER';
  health: number;
  maxHealth: number;
  speed: number;
  stealth: boolean;
  weapon: 'NONE' | 'BATON' | 'STUN_GUN';
  score: number;
  name: string;
  color: string;
  velocity: Vector2;
  isSlipping: boolean;
  powerups: string[];
}

export interface Guard extends BaseEntity {
  type: 'GUARD';
  patrolPath: Vector2[];
  currentPatrolIdx: number;
  viewAngle: number;
  viewRadius: number;
  facing: Vector2;
  state: 'PATROL' | 'IDLE' | 'ALERT';
  stunTimer: number;
}

export interface Block extends BaseEntity {
  type: 'BLOCK';
  velocity: Vector2;
}

export interface Switch extends BaseEntity {
  type: 'BUTTON';
  pressed: boolean;
  targetId: string;
}

export interface Door extends BaseEntity {
  type: 'DOOR';
  open: boolean;
}

export interface Hazard extends BaseEntity {
  type: 'HAZARD_GREASE' | 'HAZARD_HEAT';
}

export interface GameState {
  level: number;
  stage: 'PLAYING' | 'POWERUP_SELECT' | 'GAME_OVER' | 'VICTORY';
  heat: number;
  players: Record<string, Player>;
  guards: Record<string, Guard>;
  blocks: Record<string, Block>;
  walls: Record<string, BaseEntity>;
  switches: Record<string, Switch>;
  doors: Record<string, Door>;
  hazards: Record<string, Hazard>;
  loot: BaseEntity | null;
  cameraOffset: Vector2;
  levelTimer: number;
  powerupChoices: string[];
}
