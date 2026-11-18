from fastapi.testclient import TestClient

from backend.app.main import app


def test_browser_play_uses_game_rules_and_isolates_connections():
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        with client.websocket_connect("/api/play") as game, client.websocket_connect("/api/play") as other:
            first = game.receive_json()
            assert first["layout"]["start"] == other.receive_json()["frame"]["position"]
            game.send_json({"action": 4})
            assert "error" in game.receive_json()
            for action in (3, 3, 4, 0, 2, 2, 1):
                game.send_json({"action": action})
                result = game.receive_json()
            assert result["reward"] == 10 and result["frame"]["outcome"] == "escaped"
            other.send_json({"action": 3})
            assert other.receive_json()["frame"]["step"] == 1


def test_watch_and_control_input_validation():
    with TestClient(app) as client:
        assert client.post("/api/train", json={"episodes": 0}).status_code == 422
        assert client.post("/api/control", json={"action": "pause"}).status_code == 409
        assert client.get("/api/replays/early").status_code == 404
        with client.websocket_connect("/api/watch") as watch:
            assert watch.receive_json()["status"] == "idle"
            watch.send_json({"max_speed": True})
            assert watch.receive_json()["live"] is None
