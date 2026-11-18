import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from backend.app.game import CerberusEnv, Tile, make_cave, reachable


@pytest.fixture
def env():
    game = CerberusEnv()
    game.reset()
    return game


def test_gym_contract():
    game = CerberusEnv()
    game.action_space.seed(123)
    check_env(game, skip_render_check=True)


def test_mask_collect_and_exact_escape_reward(env):
    env.grid[17, 1] = Tile.WALL
    assert env.mask().tolist() == [1, 1, 0, 1, 0]
    env.step(3)
    assert env.mask()[2]
    env.step(3)
    assert env.mask()[4] and env.value == 0
    assert not env.mask()[2]
    with pytest.raises(ValueError):
        env.step(2)
    assert env.steps == 2
    obs, reward, terminated, truncated, _ = env.step(4)
    assert reward == 0 and not terminated and not truncated
    assert not obs["valid_actions"][4] and obs["collected_gems"][17, 4]
    assert obs["visited"][17, 3] and obs["map"][17, 4] == Tile.FLOOR
    for action in (0, 2, 2):
        assert env.step(action)[1] == 0
    _, reward, terminated, truncated, info = env.step(1)
    assert (reward, terminated, truncated, info["outcome"]) == (10, True, False, "escaped")


def test_collect_is_available_in_a_dead_end_until_gem_is_used(env):
    env.grid[16, 4] = env.grid[18, 4] = env.grid[17, 5] = Tile.WALL
    env.step(3)
    env.step(3)
    assert env.mask().tolist() == [0, 0, 0, 0, 1]
    _, reward, terminated, truncated, info = env.step(4)
    assert (reward, terminated, truncated, info["outcome"]) == (0, True, False, "dead_end")


def test_return_to_start_without_gems_escapes_for_zero(env):
    env.step(3)
    assert env.mask()[2]
    _, reward, terminated, truncated, info = env.step(2)
    assert (reward, terminated, truncated, info["outcome"]) == (0, True, False, "escaped")


def test_overweight_stays_unmasked_and_dies_with_no_reward(env):
    env.position = (4, 17)
    env.weight, env.value = 29, 120
    assert env.mask()[4]
    assert env.step(4)[1] == 0 and env.weight == 30 and env.outcome == "running"
    env.position = (6, 3)
    assert env.mask()[4]
    _, reward, terminated, _, info = env.step(4)
    assert (reward, terminated, info["death_reason"]) == (0, True, "crushed")


@pytest.mark.parametrize("position", [(4, 17), (6, 3), (10, 3), (17, 4)])
def test_all_gems_add_two_noise(env, position):
    env.position = position
    env.step(4)
    assert env.noise == 2


def test_exact_noise_threshold_and_heavy_movement(env):
    env.noise, env.weight, env.value = 99, 30, 30
    assert env.step(3)[1] == 0
    assert env.noise == 99.5 and env.outcome == "running"
    _, reward, terminated, _, info = env.step(2)
    assert env.noise == 100
    assert (reward, terminated, info["death_reason"]) == (0, True, "cerberus")


def test_noise_crossing_does_not_trigger_silence_first(env):
    env.position, env.noise = (16, 6), 99.5
    env.step(0)
    assert env.noise == 100 and env.outcome == "cerberus"
    assert env.grid[5, 16] == Tile.SILENCE


def test_health_zero_before_heal(env):
    env.position, env.hp = (5, 8), 1
    _, reward, terminated, _, info = env.step(0)
    assert env.hp == 0
    assert (reward, terminated, info["death_reason"]) == (0, True, "hp_depleted")
    assert env.grid[7, 5] == Tile.POTION


def test_potion_is_capped_and_consumed_once(env):
    env.position, env.hp = (5, 8), 95
    obs, *_ = env.step(0)
    assert env.hp == 100 and obs["used_items"][7, 5]
    env.step(1)
    assert not env.mask()[0]
    assert env.hp == 99 and env.grid[7, 5] == Tile.FLOOR


def test_silence_is_clamped_and_consumed_once(env):
    env.position, env.noise = (16, 6), 10
    obs, *_ = env.step(0)
    assert env.hp == 94 and env.noise == 0 and obs["used_items"][5, 16]
    env.step(1)
    assert not env.mask()[0]
    assert env.hp == 93 and env.noise == 0.5


def test_hazards_and_portal_trigger_order(env):
    env.position = (3, 11)
    env.step(1)
    assert (env.hp, env.noise, env.event) == (89, 15.5, "rock")
    env.position = (6, 8)
    env.step(1)
    assert (env.hp, env.noise, env.event) == (73, 16.0, "spike")
    assert env.grid[9, 6] == Tile.SPIKE and env.grid[12, 3] == Tile.ROCK
    env.position = (3, 13)
    env.step(1)
    assert env.position == (16, 2)
    assert {(3, 14), (16, 2)} <= env.visited
    env.position = (3, 13)
    assert not env.mask()[1]
    assert (env.hp, env.noise, env.moves, env.event) == (72, 16.5, 3, "portal")


def test_entering_cerberus_wakes_it_and_pays_zero(env):
    env.position = (9, 9)
    env.value = 60
    _, reward, terminated, truncated, info = env.step(3)
    assert env.noise == 100
    assert (reward, terminated, truncated, info["death_reason"]) == (0, True, False, "cerberus")


def test_timeout_is_truncated_and_pays_zero(env):
    env.steps, env.value = 199, 120
    _, reward, terminated, truncated, info = env.step(3)
    assert (reward, terminated, truncated, info["outcome"]) == (0, False, True, "timeout")


@pytest.mark.parametrize("stage", [1, 2, 3, 4])
def test_seeded_maps_connected_and_have_safe_escape(stage):
    for seed in [None, *range(12)]:
        cave = make_cave(stage, seed)
        np.testing.assert_array_equal(cave.grid, make_cave(stage, seed).grid)
        assert len(reachable(cave, cave.start)) == (cave.grid != Tile.WALL).sum()
        game = CerberusEnv(stage, seed)
        game.reset()
        x, y = cave.start
        dx, dy = next((px - x, py - y) for (px, py), distance in reachable(cave, cave.start, safe=True).items()
                      if distance == 2 and cave.grid[py, px] == Tile.EMERALD)
        action = {(0, -2): 0, (0, 2): 1, (-2, 0): 2, (2, 0): 3}[dx, dy]
        reverse = action ^ 1
        side = {3: 0, 0: 2, 2: 1, 1: 3}[action]
        assert [game.step(move)[1] for move in (action, action, 4, side, reverse, reverse, side ^ 1)] == [0, 0, 0, 0, 0, 0, 10]
