import time

import numpy as np
import pytest
import torch

from backend.app.dqn import DQN, GAMMA, double_targets, pack
from backend.app.game import CerberusEnv
from backend.app.training import TrainConfig, Training


def wait_for(predicate, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("Training did not reach the expected state")


def test_masked_exploration_and_double_dqn_targets():
    agent = DQN(seed=8)
    env = CerberusEnv()
    state = pack(env.reset()[0])
    mask = np.array([0, 1, 0, 1, 0], dtype=np.int8)
    assert {agent.act(state, mask, 1) for _ in range(50)} == {1, 3}
    assert agent.act(state, mask, 0) in (1, 3)

    online = torch.tensor([[100., 4., 20., 3., 9.]] * 3)
    target = torch.tensor([[900., 8., 200., 70., 0.]] * 3)
    masks = torch.tensor([mask.tolist(), mask.tolist(), [0] * 5], dtype=torch.bool)
    rewards = torch.tensor([0., 10., 0.])
    terminated = torch.tensor([False, True, False])
    torch.testing.assert_close(double_targets(online, target, masks, rewards, terminated),
                               torch.tensor([GAMMA * 8, 10., 0.]))


def test_checkpoint_round_trip(tmp_path):
    torch.set_num_threads(1)
    env = CerberusEnv()
    obs, _ = env.reset()
    state = pack(obs)
    next_obs, *_ = env.step(3)
    agent = DQN(19)
    agent.buffer.extend([(state, 3, 1, pack(next_obs), next_obs["valid_actions"], False)] * 64)
    assert agent.learn() > 0
    path = tmp_path / "latest.pt"
    agent.save(path)
    clone = DQN(87)
    clone.load(path)
    assert clone.updates == 1 and clone.optimizer.state
    for expected, actual in zip(agent.online.parameters(), clone.online.parameters()):
        torch.testing.assert_close(expected, actual)


def test_pause_resume_and_stop(tmp_path):
    job = Training(tmp_path / "latest.pt")
    job.start(TrainConfig(episodes=400, evaluation_episodes=1))
    job.control("pause")
    assert job.snapshot()["status"] == "paused"
    with pytest.raises(ValueError):
        job.start(TrainConfig(episodes=1))
    before = job.snapshot()["live_version"]
    time.sleep(0.06)
    assert job.snapshot()["live_version"] == before
    job.control("resume")
    wait_for(lambda: job.snapshot()["episode"] >= 1)
    job.control("pause")
    job.control("stop")
    wait_for(lambda: job.snapshot()["status"] == "stopped")
    assert job.snapshot()["episode"] < 400 and job.checkpoint.is_file()


def test_training_is_seeded_and_max_subscription_cannot_change_results(tmp_path):
    job = Training(tmp_path / "latest.pt")
    config = TrainConfig(episodes=6, seed=14, evaluation_episodes=2, random_maps=True)
    results = []
    for maximum in (False, True):
        job.start(config)
        while job.snapshot()["status"] not in ("completed", "error"):
            snapshot = job.snapshot(max_speed=maximum)
            if maximum:
                assert snapshot["live"] is None
            wait_for(lambda: job.snapshot()["status"] in ("completed", "error"))
        snapshot = job.snapshot()
        assert snapshot["status"] == "completed"
        assert snapshot["episode"] == 6 and snapshot["history"][-1]["stage"] == 4
        assert snapshot["evaluation"]["count"] == 2 and job.replays["evaluation"]["epsilon"] == 0
        assert set(snapshot["replays"]) == {"early", "middle", "late", "evaluation"}
        results.append((snapshot["history"], snapshot["evaluation"], job.replays))
    assert results[0] == results[1]
