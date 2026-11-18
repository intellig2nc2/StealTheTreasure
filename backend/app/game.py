from collections import deque
from dataclasses import dataclass
from enum import IntEnum

import gymnasium as gym
import numpy as np
from gymnasium import spaces

SIZE = 20
WEIGHT_LIMIT = 30
MOVE_NOISE = 0.2
COLLECT_NOISE = 2
ACTIONS = ("UP", "DOWN", "LEFT", "RIGHT", "COLLECT")
DIRECTIONS = ((0, -1), (0, 1), (-1, 0), (1, 0))


class Tile(IntEnum):
    FLOOR = 0
    WALL = 1
    START = 2
    SPIKE = 3
    ROCK = 4
    POTION = 5
    PORTAL = 6
    SILENCE = 7
    CERBERUS = 8
    EMERALD = 9
    SAPPHIRE = 10
    RUBY = 11
    LEGEND = 12


# Value and mass in kg.
GEMS = {
    Tile.EMERALD: (10, 1),
    Tile.SAPPHIRE: (30, 3),
    Tile.RUBY: (60, 5),
    Tile.LEGEND: (120, 8),
}
ITEMS = (Tile.POTION, Tile.SILENCE)


@dataclass
class Cave:
    grid: np.ndarray
    start: tuple[int, int]
    portals: dict[tuple[int, int], tuple[int, int]]


def neighbors(grid, position):
    x, y = position
    for dx, dy in DIRECTIONS:
        nx, ny = x + dx, y + dy
        yield (nx, ny) if 0 <= nx < SIZE and 0 <= ny < SIZE and grid[ny, nx] != Tile.WALL else None


def reachable(cave, start, safe=False):
    frontier = deque([start])
    distances = {start: 0}
    while frontier:
        position = frontier.popleft()
        for entry in neighbors(cave.grid, position):
            if entry is None:
                continue
            x, y = entry
            if safe and cave.grid[y, x] in (Tile.SPIKE, Tile.ROCK, Tile.PORTAL, Tile.SILENCE):
                continue
            destination = cave.portals.get(entry, entry)
            if destination not in distances:
                distances[destination] = distances[position] + 1
                frontier.append(destination)
    return distances


def make_cave(stage, seed=None, max_steps=200):
    rng = np.random.default_rng(seed) if seed is not None else None
    grid = np.full((SIZE, SIZE), Tile.WALL, dtype=np.uint8)
    portals = {}

    if stage == 1:
        grid[15:18, 2:6] = Tile.FLOOR
        tiles = {(4, 17): Tile.EMERALD}
    elif stage == 2:
        grid[11:18, 2:10] = Tile.FLOOR
        grid[13:16, 5] = Tile.WALL
        tiles = {(4, 17): Tile.EMERALD, (7, 16): Tile.LEGEND, (5, 12): Tile.RUBY,
                 (3, 12): Tile.SAPPHIRE}
    elif stage == 3:
        grid[7:18, 2:15] = Tile.FLOOR
        grid[8:15, 6] = Tile.WALL
        grid[12, 7:13] = Tile.WALL
        grid[12, 9] = Tile.FLOOR
        portals = {(3, 15): (13, 8), (13, 8): (3, 15)}
        tiles = {(4, 17): Tile.EMERALD, (11, 15): Tile.LEGEND, (12, 9): Tile.RUBY,
                 (3, 9): Tile.SAPPHIRE, (7, 15): Tile.SPIKE, (9, 12): Tile.ROCK,
                 (8, 8): Tile.POTION, (13, 16): Tile.SILENCE, (9, 9): Tile.CERBERUS}
    else:
        grid[1:19, 1:19] = Tile.FLOOR
        grid[2:6, 2:5] = Tile.WALL
        grid[2:8, 7] = Tile.WALL
        grid[5, 8:12] = Tile.WALL
        grid[2:6, 14:17] = Tile.WALL
        grid[8:11, 2:5] = Tile.WALL
        grid[7:11, 11] = Tile.WALL
        grid[9, 14:18] = Tile.WALL
        grid[12:16, 5:7] = Tile.WALL
        grid[12, 8:12] = Tile.WALL
        grid[14:18, 13:16] = Tile.WALL
        grid[16, 7:11] = Tile.WALL
        portals = {(3, 14): (16, 2), (16, 2): (3, 14)}
        tiles = {
            (4, 17): Tile.EMERALD, (4, 6): Tile.EMERALD, (16, 16): Tile.EMERALD,
            (6, 3): Tile.SAPPHIRE, (7, 14): Tile.SAPPHIRE, (15, 11): Tile.SAPPHIRE,
            (10, 3): Tile.RUBY, (10, 14): Tile.RUBY, (16, 8): Tile.RUBY,
            (17, 4): Tile.LEGEND, (10, 9): Tile.CERBERUS, (3, 12): Tile.ROCK,
            (13, 8): Tile.ROCK, (11, 17): Tile.ROCK, (6, 9): Tile.SPIKE,
            (8, 15): Tile.SPIKE, (17, 13): Tile.SPIKE, (5, 7): Tile.POTION,
            (12, 13): Tile.POTION, (16, 5): Tile.SILENCE, (8, 10): Tile.SILENCE,
        }
    escape_loop = ((2, 17), (3, 17), (4, 17), (4, 16), (3, 16), (2, 16))
    start = escape_loop[0]
    for (x, y), tile in {**tiles, start: Tile.START, **dict.fromkeys(portals, Tile.PORTAL)}.items():
        grid[y, x] = tile

    if rng is not None:
        movable = [p for p in tiles if p != (4, 17)]
        rng.shuffle(movable)
        for original, destination in zip((p for p in tiles if p != (4, 17)), movable):
            x, y = destination
            grid[y, x] = tiles[original]
        # Preserve both sides of a loop so the first gem has a route back.
        protected = {*escape_loop, *tiles, *portals}

        def valid(candidate):
            distances = reachable(candidate, start)
            return all((x, y) in distances for y, x in zip(*np.where(candidate.grid != Tile.WALL)))

        if stage >= 3:
            floors = np.argwhere(grid == Tile.FLOOR)
            for y, x in floors[rng.permutation(len(floors))[:16]]:
                if (x, y) not in protected:
                    grid[y, x] = Tile.WALL
                    if not valid(Cave(grid, start, portals)):
                        grid[y, x] = Tile.FLOOR

        turns = int(rng.integers(4))
        if turns:
            grid = np.rot90(grid, k=turns).copy()

            def rotate(position):
                x, y = position
                for _ in range(turns):
                    x, y = y, SIZE - 1 - x
                return x, y

            start = rotate(start)
            escape_loop = tuple(map(rotate, escape_loop))
            portals = {rotate(a): rotate(b) for a, b in portals.items()}

    cave = Cave(grid, start, portals)
    distances = reachable(cave, start)
    assert all((x, y) in distances for y, x in zip(*np.where(grid != Tile.WALL)))
    assert max_steps >= len(escape_loop) + 1
    assert all(grid[y, x] in (Tile.FLOOR, Tile.START, *GEMS) for x, y in escape_loop)
    return cave


class CerberusEnv(gym.Env):
    def __init__(self, stage=4, map_seed=None, max_steps=200):
        self.stage = stage
        self.map_seed = map_seed
        self.max_steps = max_steps
        self.action_space = spaces.Discrete(len(ACTIONS))
        self.observation_space = spaces.Dict({
            "position": spaces.MultiDiscrete([SIZE, SIZE]),
            "hp": spaces.Box(0, 100, (), dtype=np.int16),
            "noise": spaces.Box(0, 125, (), dtype=np.float32),
            "weight": spaces.Box(0, WEIGHT_LIMIT + max(mass for _, mass in GEMS.values()), (), dtype=np.int16),
            "gem_value": spaces.Box(0, 420, (), dtype=np.int16),
            "map": spaces.Box(0, len(Tile) - 1, (SIZE, SIZE), dtype=np.uint8),
            "collected_gems": spaces.MultiBinary((SIZE, SIZE)),
            "used_items": spaces.MultiBinary((SIZE, SIZE)),
            "valid_actions": spaces.MultiBinary(len(ACTIONS)),
            "visited": spaces.MultiBinary((SIZE, SIZE)),
        })

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        map_seed = (options or {}).get("map_seed", self.map_seed)
        self.cave = make_cave(self.stage, map_seed, self.max_steps)
        self.grid = self.cave.grid.copy()
        self.position = self.cave.start
        self.visited = {self.position}
        self.hp, self.noise, self.weight, self.value = 100, 0, 0, 0
        self.steps = self.moves = 0
        self.outcome = "running"
        self.event = "enter"
        return self.observe(), self.info()

    def exits(self):
        def allowed(point):
            return point not in self.visited or (point == self.cave.start)

        for entry in neighbors(self.grid, self.position):
            if entry is not None and allowed(entry) and allowed(self.cave.portals.get(entry, entry)):
                yield entry
            else:
                yield None

    def mask(self):
        x, y = self.position
        return np.array([p is not None for p in self.exits()] + [self.grid[y, x] in GEMS], dtype=np.int8)

    def observe(self):
        visited = np.zeros((SIZE, SIZE), dtype=np.int8)
        for x, y in self.visited:
            visited[y, x] = 1
        return {
            "visited": visited,
            "position": np.array(self.position, dtype=np.int64),
            "hp": np.array(self.hp, dtype=np.int16),
            "noise": np.array(self.noise, dtype=np.float32),
            "weight": np.array(self.weight, dtype=np.int16),
            "gem_value": np.array(self.value, dtype=np.int16),
            "map": self.grid.copy(),
            "collected_gems": (np.isin(self.cave.grid, tuple(GEMS)) & (self.grid == Tile.FLOOR)).astype(np.int8),
            "used_items": (np.isin(self.cave.grid, ITEMS) & (self.grid == Tile.FLOOR)).astype(np.int8),
            "valid_actions": self.mask(),
        }

    def info(self):
        return {"outcome": self.outcome, "event": self.event, "moves": self.moves,
                "death_reason": self.outcome if self.outcome in ("crushed", "cerberus", "hp_depleted") else None}

    def frame(self):
        return {"position": self.position, "hp": self.hp, "noise": self.noise,
                "weight": self.weight, "value": self.value, "step": self.steps,
                "outcome": self.outcome, "event": self.event, "mask": self.mask().tolist()}

    def layout(self):
        return {"grid": self.cave.grid.tolist(), "start": self.cave.start,
                "portals": list(self.cave.portals.items()), "stage": self.stage}

    def step(self, action):
        if self.outcome != "running" or not self.action_space.contains(action) or not self.mask()[action]:
            raise ValueError("Action is unavailable")
        self.steps += 1
        survival = self.stage >= 3
        if action == 4:
            x, y = self.position
            value, mass = GEMS[self.grid[y, x]]
            self.value += value
            self.weight += mass
            self.noise += COLLECT_NOISE if survival else 0
            self.grid[y, x] = Tile.FLOOR
            self.event = "collect"
            if self.stage >= 2 and self.weight > WEIGHT_LIMIT:
                self.outcome = "crushed"
        else:
            self.moves += 1
            self.position = tuple(self.exits())[action]
            self.visited.add(self.position)
            self.event = "move"
            if survival:
                self.hp -= 1
                self.noise = round(self.noise + MOVE_NOISE, 1)
                self.check_survival()
            if self.outcome == "running":
                x, y = self.position
                tile = Tile(self.grid[y, x])
                if tile == Tile.PORTAL:
                    self.position = self.cave.portals[(x, y)]
                    self.visited.add(self.position)
                    self.event = "portal"
                elif tile == Tile.POTION:
                    self.hp = min(100, self.hp + 25)
                    self.event = "potion"
                elif tile == Tile.SILENCE:
                    self.hp -= 5
                    self.noise = max(0, round(self.noise - 20, 1))
                    self.event = "silence"
                elif tile == Tile.SPIKE:
                    self.hp -= 15
                    self.event = "spike"
                elif tile == Tile.ROCK:
                    self.hp -= 10
                    self.noise += 15
                    self.event = "rock"
                if tile in ITEMS:
                    self.grid[y, x] = Tile.FLOOR

        if self.outcome == "running" and survival:
            self.check_survival()
        if self.outcome == "running" and self.position == self.cave.start and self.steps > 0:
            self.outcome = "escaped"
        if self.outcome == "running" and self.steps >= self.max_steps:
            self.outcome = "timeout"
        if self.outcome == "running" and not self.mask().any():
            self.outcome = "dead_end"
        terminated = self.outcome not in ("running", "timeout")
        return self.observe(), self.value if self.outcome == "escaped" else 0, terminated, self.outcome == "timeout", self.info()

    def check_survival(self):
        self.hp = max(0, self.hp)
        if self.noise >= 100:
            self.outcome = "cerberus"
        elif self.hp == 0:
            self.outcome = "hp_depleted"
