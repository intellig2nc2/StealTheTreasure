import asyncio
import mimetypes
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .game import CerberusEnv
from .training import TrainConfig, Training

app = FastAPI(title="SHH! CERBERUS")
training = Training()
origins = {origin.strip() for origin in os.getenv("CERBERUS_ORIGINS", "").split(",") if origin.strip()}
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=sorted(origins), allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"])


class Command(BaseModel):
    action: Literal["pause", "resume", "stop"]


class Watch(BaseModel):
    max_speed: bool = False


class Play(BaseModel):
    action: int | None = Field(None, ge=0, le=4)
    seed: int | None = Field(None, ge=0, le=4294967295)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/train", status_code=202)
def start(config: TrainConfig):
    try:
        training.start(config)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return {"run_id": training.run_id}


@app.post("/api/control")
def control(command: Command):
    try:
        training.control(command.action)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return {"status": training.status}


@app.get("/api/replays/{name}")
def replay(name: Literal["early", "middle", "late", "evaluation"]):
    with training.condition:
        trace = training.replays.get(name)
    if trace is None:
        raise HTTPException(404, "아직 리플레이가 없습니다.")
    return trace


async def allow_socket(socket):
    origin = socket.headers.get("origin")
    if origin and origin not in origins and urlsplit(origin).netloc != socket.headers.get("host"):
        await socket.close(code=1008)
        return False
    await socket.accept()
    return True


@app.websocket("/api/watch")
async def watch(socket: WebSocket):
    if not await allow_socket(socket):
        return
    run_id, cursor, live_version = "", 0, -1
    maximum = False
    last = None
    try:
        while True:
            snapshot = training.snapshot(run_id, cursor, live_version, maximum)
            stamp = (snapshot["run_id"], snapshot["status"], snapshot["cursor"],
                     snapshot["checkpoint"], None if maximum else snapshot["live_version"], maximum)
            if stamp != last:
                await socket.send_json(snapshot)
                last = stamp
                run_id, cursor = snapshot["run_id"], snapshot["cursor"]
                if not maximum:
                    live_version = snapshot["live_version"]
            try:
                packet = await asyncio.wait_for(socket.receive_json(), timeout=1.0 if maximum else 0.16)
            except TimeoutError:
                continue
            try:
                requested_maximum = Watch.model_validate(packet).max_speed
            except ValidationError:
                continue
            if maximum and not requested_maximum:
                live_version = -1
            maximum = requested_maximum
    except WebSocketDisconnect:
        pass


@app.websocket("/api/play")
async def play(socket: WebSocket):
    if not await allow_socket(socket):
        return
    env = CerberusEnv()
    env.reset()
    try:
        await socket.send_json({"layout": env.layout(), "frame": env.frame()})
        while True:
            try:
                request = Play.model_validate(await socket.receive_json())
                if request.action is None:
                    env.reset(options={"map_seed": request.seed})
                    await socket.send_json({"layout": env.layout(), "frame": env.frame()})
                else:
                    _, reward, _, _, _ = env.step(request.action)
                    await socket.send_json({"frame": env.frame(), "reward": reward})
            except (ValueError, TypeError):
                await socket.send_json({"error": "현재 위치에서 실행할 수 없는 행동입니다."})
    except WebSocketDisconnect:
        pass


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.is_dir():
    # Windows can register JavaScript as text/plain, which browsers reject for Vite modules.
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("font/woff2", ".woff2")
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
