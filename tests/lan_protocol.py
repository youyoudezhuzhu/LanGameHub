"""Two-client integration checks against the production LAN server."""
import argparse
import asyncio
import json
import uuid
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

GAMES = ("doudizhu", "guandan", "texas", "sichuan", "xiangqi", "chess",
         "spellstones", "onecard", "hexisle", "gemguild")
HTTP = build_opener(ProxyHandler({}))


class Player:
    def __init__(self, name):
        self.name = name
        self.token = uuid.uuid4().hex

    async def open(self, base):
        self.ws = await connect(f"ws://{urlsplit(base).netloc}/ws", origin=base, proxy=None)
        await self.send("hello", token=self.token, name=self.name, v=1)
        message = await self.receive("welcome")
        return message["playerId"]

    async def send(self, kind, **data):
        await self.ws.send(json.dumps({"t": kind, **data}))

    async def receive(self, kind, predicate=lambda message: True):
        async with asyncio.timeout(10):
            async for raw in self.ws:
                message = json.loads(raw)
                if message["t"] == "error" and kind != "error":
                    raise AssertionError(message)
                if message["t"] == kind and predicate(message):
                    return message
        raise AssertionError(f"Connection closed before {kind}")


async def chess(actor, guest, positions):
    # Fool's Mate, using the two seated human clients.
    views = positions
    for index, (start, end) in enumerate(((13, 21), (52, 36), (14, 30), (59, 31))):
        active = actor if index % 2 == 0 else guest
        position = views[index % 2]
        assert any(move["from"] == start and move["to"] == end for move in position["view"]["legal"])
        await active.send("act", action={"type": "move", "from": start, "to": end})
        views = await asyncio.gather(*(
            player.receive("game", lambda frame: frame["version"] > position["version"])
            for player in (actor, guest)
        ))
    assert all(frame["over"] and frame["view"]["result"]["reason"] == "checkmate" for frame in views)
    return views


async def test_game(base, game):
    host, guest = Player("主机玩家"), Player("访客玩家")
    try:
        await host.open(base)
        guest_id = await guest.open(base)
        await host.send("create", gameId=game)
        room = (await host.receive("room"))["room"]
        code = room["code"]
        assert room["gameId"] == game and room["status"] == "waiting"
        await guest.send("join", code=code)
        initial = await guest.receive("room")
        assert initial["you"]["seat"] == 1
        await host.send("start")
        boards = await asyncio.gather(*(
            player.receive("game", lambda frame: frame["view"] is not None)
            for player in (host, guest)
        ))
        assert [frame["seat"] for frame in boards] == [0, 1]
        if game == "chess":
            boards = await chess(host, guest, boards)
        await guest.ws.close()
        await host.receive("room", lambda frame: not frame["room"]["seats"][1]["connected"])
        assert await guest.open(base) == guest_id
        returned = await guest.receive("room")
        assert returned["room"]["code"] == code and returned["you"]["seat"] == 1
        resumed = await guest.receive("game")
        assert resumed["matchNo"] == boards[1]["matchNo"]
        await guest.send("leave")
        await guest.receive("left")
        await host.send("leave")
        await host.receive("left")
        print(f"{game}: create, join, start, state views, reconnect, leave" +
              (", four moves, checkmate" if game == "chess" else ""), flush=True)
    finally:
        for player in (host, guest):
            if hasattr(player, "ws"):
                await player.ws.close()


def http_status(base, path, *, headers=None):
    try:
        with HTTP.open(Request(base + path, headers=headers or {}), timeout=4) as response:
            return response.status
    except HTTPError as error:
        return error.code


async def main(base, cycles):
    assert http_status(base, "/healthz") == 200
    assert http_status(base, "/") == 200
    assert http_status(base, "/not-a-real-asset.js") == 404
    assert http_status(base, "/..%2f..%2fetc%2fpasswd") == 400
    assert http_status(base, "/api/host") == 403
    assert http_status(base, "/", headers={"Host": "external.invalid"}) == 403
    try:
        async with connect(f"ws://{urlsplit(base).netloc}/ws",
                           origin="http://external.invalid", proxy=None):
            raise AssertionError("cross-origin WebSocket accepted")
    except InvalidStatus as error:
        assert error.response.status_code == 403
    print("HTTP status, static resource, path validation, host, admin and WebSocket Origin checks: pass")
    for cycle in range(cycles):
        print(f"Cycle {cycle + 1}/{cycles}", flush=True)
        for offset in range(0, len(GAMES), 3):
            await asyncio.gather(*(test_game(base, game) for game in GAMES[offset:offset + 3]))
    with HTTP.open(base + "/api/status", timeout=4) as response:
        summary = json.load(response)
    assert summary["rooms"] == 0, summary
    print("All rooms released", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base", help="Origin without trailing slash")
    parser.add_argument("--cycles", type=int, default=1)
    args = parser.parse_args()
    if args.cycles < 1:
        parser.error("--cycles must be positive")
    asyncio.run(main(args.base.rstrip("/"), args.cycles))
