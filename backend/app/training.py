from collections import Counter, deque
from pathlib import Path
from threading import Condition, Thread
from uuid import uuid4

import torch
from pydantic import BaseModel, Field

from .dqn import DQN, pack
from .game import CerberusEnv

OUTCOMES = ("escaped", "cerberus", "crushed", "hp_depleted", "timeout")
CHECKPOINT = Path(__file__).resolve().parents[1] / "models" / "latest.pt"


class TrainConfig(BaseModel):
    episodes: int = Field(20000, ge=1, le=50000)
    seed: int = Field(42, ge=0, le=2**31 - 1)
    epsilon_decay: int = Field(16000, ge=1, le=50000)
    curriculum: bool = True
    random_maps: bool = False
    gpu: bool = False
    load_checkpoint: bool = False
    evaluation_episodes: int = Field(20, ge=1, le=100)
    evaluation_seed: int = Field(2147483648, ge=2147483648, le=4294967195)


class Summary:
    def __init__(self):
        self.outcomes = Counter(dict.fromkeys(OUTCOMES, 0))
        self.totals = Counter()
        self.count = self.best = self.cumulative = 0
        self.recent = deque(maxlen=100)

    def add(self, env, reward):
        self.count += 1
        self.outcomes[env.outcome] += 1
        self.totals.update(value=env.value, moves=env.moves, hp=env.hp, noise=env.noise, weight=env.weight)
        self.best = max(self.best, env.value)
        self.recent.append(reward)
        self.cumulative += reward

    def result(self):
        return {
            "count": self.count, "escape_rate": 100 * self.outcomes["escaped"] / max(1, self.count),
            "best_value": self.best, **dict(self.outcomes),
            **{f"avg_{name}": total / self.count for name, total in self.totals.items()},
        }


class Training:
    def __init__(self, checkpoint=CHECKPOINT):
        self.condition = Condition()
        self.status = "idle"
        self.config = None
        self.run_id = ""
        self.history = []
        self.replays = {}
        self.live = None
        self.live_version = 0
        self.evaluation = None
        self.error = None
        self.device = None
        self.checkpoint = checkpoint

    def start(self, config):
        with self.condition:
            if self.status in ("running", "paused", "stopping", "evaluating"):
                raise ValueError("이미 실행 중인 학습이 있습니다.")
            if config.gpu and not torch.cuda.is_available():
                raise ValueError("이 서버에서는 CUDA를 사용할 수 없습니다.")
            if config.load_checkpoint and not self.checkpoint.is_file():
                raise ValueError("저장된 체크포인트가 없습니다.")
            self.config = config
            self.run_id = uuid4().hex
            self.history = []
            self.replays = {}
            self.live = None
            self.evaluation = self.error = None
            self.device = "cuda" if config.gpu else "cpu"
            self.status = "running"
            Thread(target=self.run, daemon=True).start()

    def control(self, command):
        with self.condition:
            transitions = {
                ("running", "pause"): "paused",
                ("paused", "resume"): "running",
                ("running", "stop"): "stopping",
                ("paused", "stop"): "stopping",
                ("evaluating", "stop"): "stopping",
            }
            try:
                self.status = transitions[self.status, command]
            except KeyError:
                raise ValueError("현재 상태에서는 이 작업을 실행할 수 없습니다.") from None
            self.condition.notify_all()

    def proceed(self):
        with self.condition:
            self.condition.wait_for(lambda: self.status != "paused")
            return self.status != "stopping"

    def snapshot(self, run_id="", cursor=0, live_version=-1, max_speed=False):
        with self.condition:
            if run_id != self.run_id:
                cursor, live_version = 0, -1
            return {
                "run_id": self.run_id, "status": self.status, "episode": len(self.history),
                "total": self.config.episodes if self.config else 0,
                "config": self.config.model_dump() if self.config else None,
                "history": self.history[cursor:cursor + 1000], "cursor": min(len(self.history), cursor + 1000),
                "live_version": self.live_version,
                "live": self.live if not max_speed and live_version != self.live_version else None,
                "replays": [name for name in ("early", "middle", "late", "evaluation") if name in self.replays],
                "evaluation": self.evaluation, "error": self.error,
                "checkpoint": self.checkpoint.is_file(), "device": self.device,
                "cuda": torch.cuda.is_available(),
            }

    def episode(self, agent, env, number, epsilon, train):
        observation, _ = env.reset()
        state = pack(observation)
        trace = {"episode": number, "epsilon": epsilon, "layout": env.layout(), "frames": [env.frame()]}
        while self.proceed():
            action = agent.act(state, observation["valid_actions"], epsilon)
            observation, reward, terminated, truncated, _ = env.step(action)
            next_state = pack(observation)
            if train:
                agent.buffer.append((state, action, reward, next_state, observation["valid_actions"], terminated))
                agent.learn()
            state = next_state
            trace["frames"].append(env.frame())
            if train and (env.steps == 1 or env.steps % 8 == 0 or terminated or truncated):
                with self.condition:
                    self.live = {**trace, "frames": trace["frames"].copy()}
                    self.live_version += 1
            if terminated or truncated:
                return reward, trace
        return None

    def run(self):
        config = self.config
        agent = None
        try:
            torch.set_num_threads(1)
            agent = DQN(config.seed, self.device)
            if config.load_checkpoint:
                agent.load(self.checkpoint)
            training = Summary()
            for number in range(1, config.episodes + 1):
                stage = min(4, 1 + (number - 1) * 4 // config.episodes) if config.curriculum else 4
                # Reserve the final episode for the full rules even on short smoke runs.
                if number == config.episodes:
                    stage = 4
                # Keep randomized training seeds disjoint from evaluation seeds.
                map_seed = (config.seed + number - 1) % (2**31) if config.random_maps else None
                epsilon = max(0.05, 1 - 0.95 * (number - 1) / config.epsilon_decay)
                env = CerberusEnv(stage, map_seed)
                outcome = self.episode(agent, env, number, epsilon, train=True)
                if outcome is None:
                    break
                reward, trace = outcome
                training.add(env, reward)
                row = {**training.result(), "episode": number, "stage": stage, "epsilon": epsilon,
                       "reward": reward, "cumulative": training.cumulative, "avg100": sum(training.recent) / len(training.recent)}
                with self.condition:
                    self.history.append(row)
                    if number == 1:
                        self.replays["early"] = trace
                    if number == (config.episodes + 1) // 2:
                        self.replays["middle"] = trace
                    self.replays["late"] = trace

            agent.save(self.checkpoint)
            with self.condition:
                self.condition.wait_for(lambda: self.status != "paused")
                if self.status == "stopping":
                    self.status = "stopped"
                    return
                self.status = "evaluating"
            evaluation = Summary()
            for index in range(config.evaluation_episodes):
                env = CerberusEnv(4, config.evaluation_seed + index)
                outcome = self.episode(agent, env, index + 1, 0, train=False)
                if outcome is None:
                    break
                reward, trace = outcome
                evaluation.add(env, reward)
                with self.condition:
                    best = self.replays.get("evaluation")
                    if best is None or reward > best["reward"]:
                        self.replays["evaluation"] = {**trace, "reward": reward}
            with self.condition:
                self.evaluation = evaluation.result() if evaluation.count else None
                self.status = "stopped" if self.status == "stopping" else "completed"
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Training failed")
            with self.condition:
                self.error = "학습에 실패했습니다. 서버 로그에서 자세한 내용을 확인할 수 있습니다."
                self.status = "error"
