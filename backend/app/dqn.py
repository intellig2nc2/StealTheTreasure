import random
from collections import deque

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from .game import ACTIONS, SIZE, Tile

GAMMA = 0.99
BATCH_SIZE = 64
TARGET_INTERVAL = 1000
# Preserve the input scale used by existing checkpoints.
WEIGHT_INPUT_SCALE = 12


def pack(state):
    x, y = state["position"]
    return state["map"], (x / 19, y / 19, float(state["hp"]) / 100,
                          float(state["noise"]) / 100, float(state["weight"]) / WEIGHT_INPUT_SCALE,
                          float(state["gem_value"]) / 200)


class Network(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(len(Tile), 16, 3, stride=2, padding=1), nn.ReLU(),
            nn.Conv2d(16, 24, 3, stride=2, padding=1), nn.ReLU(), nn.Flatten(),
        )
        self.head = nn.Sequential(nn.Linear(24 * 5 * 5 + 6, 128), nn.ReLU(), nn.Linear(128, len(ACTIONS)))

    def forward(self, grid, features):
        channels = F.one_hot(grid, len(Tile)).permute(0, 3, 1, 2).float()
        return self.head(torch.cat((self.encoder(channels), features), dim=1))


def masked_best(q_values, mask):
    return q_values.masked_fill(~mask, -torch.inf).argmax(dim=1)


def double_targets(online_q, target_q, mask, reward, terminated):
    chosen = masked_best(online_q, mask)
    next_q = target_q.gather(1, chosen[:, None]).squeeze(1)
    return reward + GAMMA * torch.where(terminated | ~mask.any(dim=1), 0, next_q)


class DQN:
    def __init__(self, seed=0, device="cpu", buffer_size=100000):
        self.device = torch.device(device)
        self.rng = random.Random(seed)
        torch.manual_seed(seed)
        self.online = Network().to(self.device)
        self.target = Network().to(self.device)
        self.target.load_state_dict(self.online.state_dict())
        self.target.eval()
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=0.0001)
        self.buffer = deque(maxlen=buffer_size)
        self.updates = 0

    def tensors(self, states):
        maps, numbers = zip(*states)
        return (torch.as_tensor(np.stack(maps), dtype=torch.long, device=self.device),
                torch.as_tensor(numbers, dtype=torch.float32, device=self.device))

    @torch.no_grad()
    def act(self, state, mask, epsilon):
        if epsilon and self.rng.random() < epsilon:
            return self.rng.choice(np.flatnonzero(mask).tolist())
        valid = torch.as_tensor(mask[None, :], dtype=torch.bool, device=self.device)
        return int(masked_best(self.online(*self.tensors([state])), valid).item())

    def learn(self):
        if len(self.buffer) < BATCH_SIZE:
            return
        states, actions, rewards, next_states, masks, terminated = zip(*self.rng.sample(self.buffer, BATCH_SIZE))
        actions = torch.as_tensor(actions, dtype=torch.long, device=self.device)
        rewards = torch.as_tensor(rewards, dtype=torch.float32, device=self.device)
        masks = torch.as_tensor(np.stack(masks), dtype=torch.bool, device=self.device)
        terminated = torch.as_tensor(terminated, dtype=torch.bool, device=self.device)
        next_inputs = self.tensors(next_states)
        with torch.no_grad():
            target = double_targets(self.online(*next_inputs), self.target(*next_inputs), masks, rewards, terminated)
        prediction = self.online(*self.tensors(states)).gather(1, actions[:, None]).squeeze(1)
        loss = F.smooth_l1_loss(prediction, target)
        self.optimizer.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(self.online.parameters(), 10.0)
        self.optimizer.step()
        self.updates += 1
        if self.updates % TARGET_INTERVAL == 0:
            self.target.load_state_dict(self.online.state_dict())
        return float(loss.item())

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        torch.save({"version": 1, "online": self.online.state_dict(), "target": self.target.state_dict(),
                    "optimizer": self.optimizer.state_dict(), "updates": self.updates}, temporary)
        temporary.replace(path)

    def load(self, path):
        data = torch.load(path, map_location=self.device, weights_only=True)
        if data["version"] != 1:
            raise ValueError("Unsupported checkpoint version")
        self.online.load_state_dict(data["online"])
        self.target.load_state_dict(data["target"])
        self.optimizer.load_state_dict(data["optimizer"])
        self.updates = data["updates"]
