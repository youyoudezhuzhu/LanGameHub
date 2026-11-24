"""Verify that the production Hub shares one port for both room protocols."""
import argparse
import asyncio
import json
import re
from urllib.parse import urlsplit

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from lan_protocol import HTTP, Player


class SaltClient(Player):
    async def open(self, base):
        self.ws = await connect(f"ws://{urlsplit(base).netloc}/ws/saltline", origin=base, proxy=None)
        await self.send("hello", name=self.name, v=1)


def get_json(base, path):
    with HTTP.open(base + path, timeout=5) as reply:
        return json.load(reply)


async def check(base):
    assert get_json(base, "/api/status")["saltline"]["revision"]
    host = SaltClient("主机")
    guest = SaltClient("客人")
    try:
        await host.open(base)
        await guest.open(base)
        await host.send("createRoom", mode="coop", visibility="public")
        code = (await host.receive("joined"))["code"]
        assert re.fullmatch(r"S[A-Z0-9]{3}", code)
        assert any(room.get("code") == code and room["phase"] == "lobby"
                   for room in get_json(base, "/api/saltline/rooms")["roomList"])
        await guest.send("joinRoom", code=code)
        await guest.receive("joined")
        players = await host.receive("roomState", lambda msg: len(msg["players"]) == 2)
        assert {p["name"] for p in players["players"]} == {"主机", "客人"}

        await host.send("start")
        await guest.receive("roomState", lambda msg: msg["phase"] == "playing")
        for kind in ("ps", "sh", "ix"):
            payload = {"k": kind, "test": "client"}
            await guest.send("toHost", p=payload)
            assert (await host.receive("toHost"))["p"] == payload
        for kind in ("peers", "snap", "ee", "rm", "pvp"):
            payload = {"k": kind, "test": "host"}
            await host.send("fromHost", p=payload)
            assert (await guest.receive("fromHost"))["p"] == payload

        await host.ws.close()
        assert (await guest.receive("error"))["code"] == "HOST_GONE"
        assert all(room.get("code") != code for room in get_json(base, "/api/saltline/rooms")["roomList"])
        await host.open(base)
        await host.send("createRoom", mode="pvp", visibility="private")
        private = await host.receive("joined")
        assert private["mode"] == "pvp"
        listed = get_json(base, "/api/saltline/rooms")["roomList"]
        assert any(room.get("visible") is False and room["n"] == 1 for room in listed)
        assert all(room.get("code") != private["code"] for room in listed)
        await guest.send("joinRoom", code=private["code"])
        assert (await guest.receive("joined"))["mode"] == "pvp"
        teams = await host.receive("roomState", lambda msg: len(msg["players"]) == 2)
        assert {player["team"] for player in teams["players"]} == {0, 1}
    finally:
        for player in (host, guest):
            if hasattr(player, "ws"):
                await player.ws.close()
    try:
        async with connect(f"ws://{urlsplit(base).netloc}/ws/saltline", origin="http://other.invalid", proxy=None):
            raise AssertionError("unexpected cross-origin connection")
    except InvalidStatus as error:
        assert error.response.status_code == 403
    print("Saltline unified LAN relay: OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    asyncio.run(check(parser.parse_args().base))
